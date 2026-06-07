export const fetchConfig = {
    baseUrl: "https://mindustrygame.github.io/wiki/",
    asyncLimit: 3,
    delayTime: 1000,
    estimateTimeMs: 500,
    testAmount: 20,
    onlyTypes: [] as string[],
};

export const indexConfig = {
    outPath: "notes",
    indexFile: "index.json",
};

export const langConfig = {
    defaultLang: "en",
    targetLang: ["zh_CN"],
};
