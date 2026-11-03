import type { HifiReadRequest, HifiReadResponse } from '../../types/hifi';

// src/services/hifi/hifiSourceResponder.ts
// 本地歌曲交给 mpv 时，主进程的源桥按块向渲染端要字节；这里记着 sourceKey → File，按请求切片回送。

export type HifiSourceResponder = {
    register: (sourceKey: string, file: Blob) => void;
    unregister: (sourceKey: string) => void;
    clear: () => void;
    has: (sourceKey: string) => boolean;
    /** 读出请求的那一段，交给 respond，并把同一个回应返回给调用方。 */
    handleRead: (request: HifiReadRequest) => Promise<HifiReadResponse>;
};

export type HifiSourceResponderOptions = {
    /** 把回应送回主进程，通常是 window.electron.hifi.respondRead。 */
    respond: (readId: string, response: HifiReadResponse) => void | Promise<void>;
};

const isValidRange = (offset: number, length: number) => (
    Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(length) && length >= 0
);

export const createHifiSourceResponder = ({ respond }: HifiSourceResponderOptions): HifiSourceResponder => {
    const sources = new Map<string, Blob>();

    const read = async ({ sourceKey, offset, length }: HifiReadRequest): Promise<HifiReadResponse> => {
        const file = sources.get(sourceKey);
        if (!file) {
            return { status: 'unknown-source' };
        }
        if (!isValidRange(offset, length)) {
            console.warn('[HiFi] source read rejected: invalid range', { offset, length });
            return { status: 'failed' };
        }
        try {
            // slice 自己会把越过文件尾的部分截掉，尾块和越界都回实际读到的字节。
            const buffer = await file.slice(offset, offset + length).arrayBuffer();
            return { status: 'ok', data: new Uint8Array(buffer) };
        } catch (error) {
            console.warn('[HiFi] source read failed', error);
            return { status: 'failed' };
        }
    };

    return {
        register: (sourceKey, file) => {
            sources.set(sourceKey, file);
        },
        unregister: (sourceKey) => {
            sources.delete(sourceKey);
        },
        clear: () => {
            sources.clear();
        },
        has: (sourceKey) => sources.has(sourceKey),
        handleRead: async (request) => {
            const response = await read(request);
            try {
                await respond(request.readId, response);
            } catch (error) {
                console.warn('[HiFi] source read reply failed', error);
            }
            return response;
        },
    };
};

/** 本地源的随机键：32 位十六进制，符合主进程对 sourceKey 的校验。 */
export const createSourceKey = (): string => {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
};
