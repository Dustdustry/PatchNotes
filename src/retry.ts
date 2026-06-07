import {sleep} from "bun";

export type RetryOptions = {
    retryTimes?: number;
    interval?: number;
    onError?: (error: unknown) => void;
};

export async function retry<T>(fn: () => T | Promise<T>, options: RetryOptions = {}) {
    const {retryTimes = 10, interval = 1_000} = options;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retryTimes; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            options.onError?.(error);
            if (attempt >= retryTimes) break;
            if (interval) await sleep(interval);
        }
    }

    throw lastError;
}
