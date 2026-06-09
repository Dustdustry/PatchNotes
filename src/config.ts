export const fetchConfig = {
    baseUrl: "https://mindustrygame.github.io/wiki/",
    asyncLimit: 3,
    delayTime: 1000,
    estimateTimeMs: 500,
    testAmount: -1,
    onlyTypes: [] as string[],
};

export const rawBaseUrl = "https://raw.githubusercontent.com";
export const githubRepo = "Dustdustry/PatchNotes";
export const repoBranch = "main";

export const indexConfig = {
    outPath: "notes",
    indexFile: "index.json",
    repoRawBaseUrl: new URL(`${rawBaseUrl}/${githubRepo}/${repoBranch}`),
};

export const langConfig = {
    defaultLang: "en",
    targetLang: ["zh_CN"],
};
