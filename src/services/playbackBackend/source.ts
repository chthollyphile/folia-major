import type { PlaybackBackendSource } from './types';

// Blob/custom-protocol bytes cross the preload bridge, never JSON RPC or Web Audio decoding.

export interface PlaybackSourceBridge {
    stage(data: ArrayBuffer): Promise<{ id: string; filePath: string }>;
    release(id: string): Promise<void>;
}

export const prepareBackendSource = async (url: string, sourceId: string, allowHttp: boolean) => {
    if (allowHttp && /^https?:\/\//i.test(url)) {
        return { source: { sourceId, url } as PlaybackBackendSource, release: async () => {} };
    }
    if (!/^(blob:|https?:|folia-)/i.test(url)) throw new Error('unsupported-playback-source');
    const bridge = window.electron?.playbackSources;
    if (!bridge) throw new Error('playback-source-bridge-unavailable');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`playback-source-http:${response.status}`);
    const length = Number(response.headers.get('content-length'));
    if (length > 512 * 1024 * 1024) throw new Error('playback-source-too-large');
    if (!response.body) throw new Error('playback-source-empty');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 512 * 1024 * 1024) {
                await reader.cancel();
                throw new Error('playback-source-too-large');
            }
            chunks.push(value);
        }
    } finally { reader.releaseLock(); }
    const data = new ArrayBuffer(size);
    const bytes = new Uint8Array(data);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const staged = await bridge.stage(data);
    return {
        source: { sourceId, filePath: staged.filePath },
        release: () => bridge.release(staged.id),
    };
};
