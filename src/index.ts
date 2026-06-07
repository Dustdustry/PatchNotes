import fs from "fs";
import path from "path";

import type {IndexData, NoteData, TranslationMap} from "./types";
import {getCurrentData, getCurrentVersionTag} from "./fetch";
import {retry} from "./retry";
import {indexConfig, langConfig} from "./config";
import pLimit from "p-limit";
import {translate} from "./translate";
import type {CompletionUsage} from "openai/resources";

const notesPath = path.resolve(process.cwd(), indexConfig.outPath);
const indexPath = path.resolve(notesPath, indexConfig.indexFile);

await main();

async function main() {
    const currentTag = await retry(getCurrentVersionTag);
    if (!currentTag) {
        console.error("Failed to get version tag");
        return;
    }

    // check missing translation.
    console.log("\n");
    console.log("=".repeat(4), "Check missing translation");
    checkTranslation();

    if (fs.existsSync(indexPath)) {
        const indexData = (await Bun.file(indexPath).json()) as IndexData;

        if (indexData.currentVersionTag == currentTag) {
            console.log("Wiki have no update. Current version tag:", currentTag);
            return;
        }
    }

    console.log("\n");
    console.log("=".repeat(4), "Fetching Notes");

    const currentData = await getCurrentData();
    if (!currentData) {
        return;
    }

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
            const result = await retry(() => translate(currentData, lang));
            console.timeEnd(tag);
            if (!result) {
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
                notes,
            } satisfies NoteData;
            await Bun.write(path.join(notesPath, lang, fileName), JSON.stringify(noteData));
        }),
    );

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
            const {versionTag, updateTime, lang, notes} = (await Bun.file(filePath).json()) as NoteData;

            const noteCount = Object.values(notes).reduce((counter, fields) => counter + Object.keys(fields).length, 0);

            newIndexData.notes[index] = {
                versionTag,
                updateTime,
                lang,

                noteCount,
                fileName: file.name,
            };
        }),
    );

    await Bun.write(indexPath, JSON.stringify(newIndexData));
    console.timeEnd(dumpNotesTag);
}

function checkTranslation() {}
