import fs from "fs";
import path from "path";

import type {ContributionNotesData, IndexData, NoteData, NoteFields, ProcessorContext, TranslationMap} from "./types";
import {getCurrentData, getCurrentVersionTag} from "./fetch";
import {contributionConfig, indexConfig, langConfig} from "./config";
import pLimit from "p-limit";
import {translate} from "./translate";
import type {CompletionUsage} from "openai/resources";
import {retry} from "./retry";

const rootPath = process.cwd();
const notesPath = path.resolve(rootPath, indexConfig.outPath);
const indexPath = path.resolve(notesPath, indexConfig.indexFile);
const contributionPath = path.resolve(rootPath, contributionConfig.path);

await main();

async function main() {
    const currentTag = await retry(getCurrentVersionTag);
    if (!currentTag) {
        console.error("Failed to get version tag");
        return;
    }

    console.log("Current tag", currentTag);
    const context: ProcessorContext = {
        currentTag,
        dirty: false,
    };

    await processMissingTranslation(context);
    await processData(context);
    await dumpIndex(context);
}

async function processData(ctx: ProcessorContext) {
    const {currentTag} = ctx;

    if (fs.existsSync(indexPath)) {
        const indexData = (await Bun.file(indexPath).json()) as IndexData;

        if (indexData.currentVersionTag == currentTag) {
            console.log("No change for wiki version tag.");
            return;
        }
    }

    console.log("\n");
    console.log("=".repeat(4), "Fetching Notes");

    const currentData = await getCurrentData();
    if (!currentData) {
        return;
    }

    ctx.dirty = true;

    console.log("\n");
    console.log("=".repeat(4), "Merge Contribution Notes");

    const contributors = [] as string[];
    const mergedNotes = new Map<string, string>();
    const contributionNotes = await getContributionNotes();
    contributionNotes.forEach((data, index) => {
        if (data.status === "rejected") {
            console.log(data.reason);
            return;
        }

        if (index != 0) console.log("\n");
        console.log(">", `Merging ${data.value.name} by ${data.value.contributors}`);

        const {value} = data;
        let mergeCount = 0,
            conflictCount = 0;
        Object.entries(value.notes).forEach(([type, typeNotes]) => {
            Object.entries(typeNotes).forEach(([fieldName, fieldNote]) => {
                const fieldKey = type + "." + fieldName;
                const other = mergedNotes.get(fieldKey);
                if (other) {
                    conflictCount++;
                    const otherNote = currentData[type]![fieldName]!;
                    console.log(`${conflictCount}. Conflicted: '${fieldKey}'`);
                    console.log(`[√] ${other}: ${otherNote}`);
                    console.log(`[x] ${value.name}: ${fieldNote}`);
                } else {
                    mergedNotes.set(fieldKey, value.name);
                    const typeData = currentData[type] ?? (currentData[type] = {});
                    typeData[fieldName] = fieldNote;
                    mergeCount++;
                }
            });
        });

        if (mergeCount == 0) {
            console.log(`No fields available.`);
            return;
        }

        contributors.push(...value.contributors);
        console.log(`Merged ${mergeCount} notes.`);
    });

    console.log("\n");
    console.log("=".repeat(4), "Translating");

    const translationMap: TranslationMap = {};
    translationMap["en"] = structuredClone(currentData);

    const usage: CompletionUsage = {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
    };

    const limit = pLimit(3);
    const translateJobs = langConfig.targetLang.map(lang =>
        limit(async () => {
            const tag = `Translated to ${lang}`;
            console.time(tag);
            const result = await translate(currentData, lang);
            console.timeEnd(tag);
            if (!result.data) {
                console.error("Failed to translate to", lang);
                return null;
            }

            usage.completion_tokens += result.usage?.completion_tokens ?? 0;
            usage.prompt_tokens += result.usage?.prompt_tokens ?? 0;
            usage.total_tokens += result.usage?.total_tokens ?? 0;

            translationMap[lang] = structuredClone(result.data);
        }),
    );
    await Promise.all(translateJobs);

    console.log("Tokens usage:", usage);

    // dump notes
    await Promise.all(
        Object.entries(translationMap).map(async ([lang, notes]) => {
            const fileName = `notes-${currentTag}.json`;
            const noteData = {
                versionTag: currentTag,
                updateTime: Date.now(),
                lang,
                contributors,
                notes,
            } satisfies NoteData;
            await Bun.write(path.join(notesPath, lang, fileName), JSON.stringify(noteData));
        }),
    );
}

async function processMissingTranslation(ctx: ProcessorContext) {
    // check missing translation files.
    const missingMap = await getMissingTranslation();
    if (!missingMap) {
        console.log("No missing translation found.");
        return;
    }

    ctx.dirty = true;

    console.log("\n");
    console.log("=".repeat(4), "Translating missing");
    console.log("Missing:", missingMap);

    await Promise.all(
        Object.entries(missingMap).map(async ([lang, files]) => {
            console.log("Translating missing files for", lang);

            for (const fileName of files) {
                const enFile = path.join(notesPath, "en", fileName);
                const {versionTag, notes: enNotes, contributors} = (await Bun.file(enFile).json()) as NoteData;

                const tag = `Translated ${fileName} to ${lang}`;
                console.time(tag);
                const result = await translate(enNotes, lang);
                console.timeEnd(tag);
                if (!result.data) {
                    console.error("Failed to translate to", lang);
                    continue;
                }

                const noteData: NoteData = {
                    versionTag,
                    updateTime: Date.now(),
                    lang,
                    contributors,
                    notes: result.data,
                };
                await Bun.write(path.join(notesPath, lang, fileName), JSON.stringify(noteData));
            }
        }),
    );
}

async function getContributionNotes() {
    const files = fs
        .readdirSync(contributionPath, {withFileTypes: true, recursive: true})
        .filter(d => d.isFile() && d.name.endsWith(".json"));

    return await Promise.allSettled(
        files.map(async f => {
            const filePath = path.join(f.parentPath, f.name);
            try {
                return (await Bun.file(filePath).json()) as ContributionNotesData;
            } catch (e) {
                throw new Error(`Failed to read contribution file: ${filePath}`);
            }
        }),
    );
}

async function getMissingTranslation() {
    const enDir = path.join(notesPath, "en");
    if (!fs.existsSync(enDir)) {
        console.log("English notes directory not found.");
        return null;
    }

    const enFiles = fs.readdirSync(enDir).filter(f => f.endsWith(".json"));

    const missingMap: Record<string, string[]> = {};

    for (const lang of langConfig.targetLang) {
        const langDir = path.join(notesPath, lang);
        const langFiles = fs.existsSync(langDir)
            ? new Set(fs.readdirSync(langDir).filter(f => f.endsWith(".json")))
            : new Set<string>();

        const missing = enFiles.filter(f => !langFiles.has(f));
        if (missing.length) {
            missingMap[lang] = missing;
        }
    }

    if (Object.keys(missingMap).length === 0) {
        return null;
    }

    return missingMap;
}

async function dumpIndex(ctx: ProcessorContext) {
    const {currentTag, dirty} = ctx;

    if (!dirty) {
        console.log("No change for index.json.");
        return;
    }

    console.log("\n");
    console.log("=".repeat(4), "Dump index.json");

    // dump index.json based on files.
    const newIndexData: IndexData = {
        currentVersionTag: currentTag,
        notes: [],
    };

    const dumpNotesTag = "Dump index.json";
    console.time(dumpNotesTag);
    const noteFiles = fs
        .readdirSync(notesPath, {
            withFileTypes: true,
            recursive: true,
        })
        .filter(dirent => {
            const {name} = dirent;
            const ext = path.parse(name).ext;
            return dirent.isFile() && name != "index.json" && ext === ".json";
        });

    await Promise.all(
        noteFiles.map(async (file, index) => {
            const filePath = path.join(file.parentPath, file.name);
            const {versionTag, updateTime, lang, notes, contributors} = (await Bun.file(filePath).json()) as NoteData;

            newIndexData.notes[index] = {
                versionTag,
                updateTime,
                lang,
                contributors,

                noteCount: countNotes(notes),
                fileName: file.name,
                fileUrl: toRawFileUrl(filePath, rootPath, indexConfig.repoRawBaseUrl),
            };
        }),
    );

    await Bun.write(indexPath, JSON.stringify(newIndexData));
    console.timeEnd(dumpNotesTag);
}

function toRawFileUrl(filePath: string, rootPath: string, baseUrl: URL): string {
    let rel = path.relative(rootPath, filePath);

    if (rel.startsWith("..") || path.isAbsolute(rel)) {
        throw new Error(`File ${filePath} is outside repository root ${rootPath}`);
    }

    const posixRel = rel.split(path.sep).join("/");

    const encoded = posixRel.split("/").map(encodeURIComponent).join("/");

    const baseStr = baseUrl.href.replace(/\/$/, "");
    return `${baseStr}/${encoded}`;
}

function countNotes(notes: NoteFields) {
    return Object.values(notes).reduce((count, cur) => count + Object.keys(cur).length, 0);
}
