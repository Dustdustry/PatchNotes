import {JSDOM} from "jsdom";
import pLimit from "p-limit";

import {fetchConfig} from "./config";
import type {FieldMeta, NoteFields, TypeMeta, WikiDoc, WikiDocResult, WikiSearchResult} from "./types";

export async function getCurrentVersionTag() {
    const wikiDocsData = await fetchWikiDocs();
    return wikiDocsData.versionTag;
}

export async function getCurrentData() {
    console.time("Fetching modding docs");
    const wikiDocsData = await fetchWikiDocs();

    const allDocs = clearDuplicateBy(wikiDocsData.modding, "title");
    console.timeEnd("Fetching modding docs");

    const fetchDocs = fetchConfig.onlyTypes.length
        ? allDocs.filter(d => fetchConfig.onlyTypes.includes(d.title))
        : allDocs;

    if (fetchDocs.length == 0) {
        console.log("No docs needed to fetch meta.");
        return;
    }

    console.log("Found", fetchDocs.length, "modding docs.");
    console.log(
        "May take",
        ((fetchConfig.estimateTimeMs + fetchConfig.delayTime) * fetchDocs.length) / fetchConfig.asyncLimit / 1000,
        "s",
        "to fetch all field meta.",
    );

    const {meta: metaArray, errors: errorsTitle} = await getMeta(fetchDocs);
    if (errorsTitle.length) console.log("Errors:", errorsTitle);

    const notes: NoteFields = {};

    await Promise.all(
        metaArray.map(async meta => {
            const comments = meta.fields.filter(f => f.notes);
            if (comments.length) {
                const fieldMap: Record<string, string> = {};
                comments.forEach(f => (fieldMap[f.name] = f.notes));
                notes[meta.type] = fieldMap;
            }
        }),
    );

    return notes;
}

async function getMeta(docs: WikiDoc[]) {
    const typeMetaArray = new Array<TypeMeta>();
    const errorsTitle: string[] = [];

    const limit = pLimit(fetchConfig.asyncLimit);

    let count = 0;
    // prettier-ignore
    await Promise.all(docs.map((doc) => limit(async () => {
        if (fetchConfig.testAmount >= 0 && count > fetchConfig.testAmount) return;

        const tag = `Fetching fieldMeta for ${doc.title}`;

        console.time(tag);
        try {
            const meta = await fetchTypeMeta(doc);
            if (meta) {
                typeMetaArray.push(meta);
            } else {
                console.warn("No field meta found for", doc.title);
            }
        } catch (e) {
            console.error("Failed to fetch meta for", doc.title);
            errorsTitle.push(doc.title);
        }
        console.timeEnd(tag);

        count++;

        await delay(fetchConfig.delayTime);
    })));

    return {
        meta: typeMetaArray,
        errors: errorsTitle,
    };
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTypeMeta(doc: WikiDoc): Promise<TypeMeta | null> {
    const response = await fetch(new URL(doc.location, fetchConfig.baseUrl));
    if (!response.ok) return null;

    const dom = new JSDOM(await response.text());
    const extendElem = dom.window.document.querySelector("em a");
    if (!extendElem) return null;

    const table = dom.window.document.querySelector("table");
    if (!table) return null;

    return {
        type: doc.title,
        parentType: extendElem.textContent ?? "Object",
        fields: parseTable(table),
    };
}

async function fetchWikiDocs() {
    const response = await fetch(new URL("search/search_index.json", fetchConfig.baseUrl));
    const result = (await response.json()) as WikiSearchResult;

    const versionDoc = result.docs.find(doc => doc.location.includes("#latest-game-version"));
    const match = versionDoc?.text.match(/(\d+(?:\.\d+)?)/) ?? versionDoc?.title.match(/(\d+(?:\.\d+)?)/);
    const versionTag = match?.[1] ?? null;

    return {
        modding: result.docs.filter(doc => doc.location.includes("Modding")),
        versionTag,
    } satisfies WikiDocResult;
}

function parseTable(table: HTMLTableElement): FieldMeta[] {
    return Array.from(table.rows)
        .map((rowElem, index) => {
            if (index === 0) return null;
            return {
                name: rowElem.cells[0]?.textContent?.trim() ?? "",
                type: rowElem.cells[1]?.textContent?.trim() ?? "",
                defaultValue: rowElem.cells[2]?.textContent?.trim() ?? "",
                notes: rowElem.cells[3]?.textContent?.trim() ?? "",
            } satisfies FieldMeta;
        })
        .filter(Boolean) as FieldMeta[];
}

function clearDuplicateBy<T>(array: T[], key: keyof T): T[] {
    const set = new Set();
    return array.filter(elem => elem[key] && !set.has(elem[key]) && set.add(elem[key]));
}
