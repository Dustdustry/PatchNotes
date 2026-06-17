import OpenAI from "openai";
import type {NoteFields} from "./types";
import type {CompletionUsage} from "openai/resources";
import pLimit from "p-limit";
import {retry} from "./retry";

// Very simple way to translate the notes.
const systemPrompt = `
你是一个翻译者,负责将用户的json数据翻译到目标语言。

翻译要求：
- 用户的json数据结构很大,你只需要翻译用户目前给出的json片段,并仅给出此片段的结果。 
- 只翻译字符串内容，不要翻译键名。
- 不要添加任何额外的文本或注释。
- 翻译的内容是源文件的注释,翻译的结果给一般玩家查阅,请注意用词通俗易懂
- 特定词需要按照要求翻译

翻译场景:这是Mindustry的modding文档中的字段备注信息,包含字段名称、备注。请根据上下文准确翻译备注内容,确保技术术语的正确性。

特定词：
- tick: 游戏中的时间单位,1秒等于60tick,请保持原文不变

输出要求：
- 输出的json结构与输入的json结构相同
`;

const openai = new OpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: process.env.DEEPSEEK_API_KEY,
});

export async function translate(notes: NoteFields, targetLang: string) {
    const logs: string[] = [];

    const splitNotesArray: NoteFields[] = [];

    let counter = 0,
        splitIndex = 0;
    Object.entries(notes).forEach(([type, fields]) => {
        const notesCount = Object.keys(fields).length;
        if (counter > 50 && notesCount > 50) {
            splitIndex++;
            counter = 0;
        }

        if (!splitNotesArray[splitIndex]) splitNotesArray[splitIndex] = {};
        const splitData = splitNotesArray[splitIndex]!;
        splitData[type] = fields;
        counter += notesCount;

        if (counter > 100) {
            splitIndex++;
            counter = 0;
        }
    });

    const translatedNotes: NoteFields = {};

    const usage: CompletionUsage = {
        completion_tokens: 0,
        prompt_tokens: 0,
        total_tokens: 0,
    };

    const limit = pLimit(4);
    const translateJobs = splitNotesArray.map(splitNotes =>
        limit(async () => {
            const types = Object.keys(splitNotes);
            const tag = `Translated types: ${types}`;

            console.time(tag);
            const data = await retry(async () => requestTranslation(splitNotes), {
                retryTimes: 5,
                interval: 1500,
                onError(e) {
                    console.error("Failed to translate types:", types);
                },
            });

            Object.assign(translatedNotes, data);

            console.timeEnd(tag);
        }),
    );

    await Promise.all(translateJobs);

    return {
        data: Object.keys(translatedNotes).length ? translatedNotes : null,
        logs,
        usage,
    };

    async function requestTranslation(requestNotes: NoteFields) {
        const completion = await openai.chat.completions.create({
            messages: [
                {role: "system", content: systemPrompt},
                {
                    role: "user",
                    content: `目标语言：${targetLang},json数据: ${JSON.stringify(requestNotes)})`,
                },
            ],
            model: "deepseek-v4-flash",
            response_format: {
                type: "json_object",
            },
        });

        const {prompt_tokens = 0, completion_tokens = 0, total_tokens = 0} = completion.usage ?? {};
        usage.prompt_tokens += prompt_tokens;
        usage.completion_tokens += completion_tokens;
        usage.total_tokens += total_tokens;

        // logs.push(`
        //         ${new Date().toLocaleString()}
        //         Cost: ${JSON.stringify(completion.usage, null, 4)}
        //         Content: ${completion.choices[0]!.message.content!}
        //     `);

        return JSON.parse(completion.choices[0]!.message.content!) as NoteFields;
    }
}
