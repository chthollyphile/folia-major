import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { createStageApi } from '../../../electron/stageApi.cjs';

// HTTP-level Stage API tests exercise the simplified desktop-local contract
// without depending on the real Electron window or Netease backend.

const getFreePort = async () => await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
            reject(new Error('Failed to resolve a free port.'));
            return;
        }

        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(address.port);
        });
    });
    server.on('error', reject);
});

const createStore = () => {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        has: (key: string) => values.has(key),
        set: (key: string, value: unknown) => {
            values.set(key, value);
        },
    };
};

const withStageApi = async (options: {
    searchStageSongs?: (query: string, limit: number) => Promise<any[]>;
    autoCompletePlay?: boolean;
    onPlayRequest?: (payload: any) => void;
} = {}) => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'folia-stage-api-'));
    const port = await getFreePort();
    const store = createStore();
    const settings = {
        enabled: 'TEST_STAGE_MODE_ENABLED',
        source: 'TEST_STAGE_MODE_SOURCE',
        token: 'TEST_STAGE_TOKEN',
        port: 'TEST_STAGE_PORT',
    };
    store.set(settings.port, port);

    let stageApi: ReturnType<typeof createStageApi>;
    stageApi = createStageApi({
        app: {
            getPath: () => tempRoot,
        },
        store,
        getMainWindow: () => ({
            isDestroyed: () => false,
            webContents: {
                send: (channel: string, payload: any) => {
                    if (channel === 'stage-external-play-request') {
                        options.onPlayRequest?.(payload);
                    }
                    if (options.autoCompletePlay && channel === 'stage-external-play-request') {
                        queueMicrotask(() => {
                            stageApi.completeStageExternalPlayRequest({
                                requestId: payload.requestId,
                                ok: true,
                            });
                        });
                    }
                },
            },
        }),
        stageModeEnabledSettingKey: settings.enabled,
        stageModeSourceSettingKey: settings.source,
        stageApiTokenSettingKey: settings.token,
        stageApiPortSettingKey: settings.port,
        defaultStageApiPort: port,
        getNeteasePort: () => 39999,
        searchStageSongs: options.searchStageSongs,
    });

    await stageApi.setStageEnabled(true);
    const token = stageApi.buildStageStatus().token as string;
    const baseUrl = `http://127.0.0.1:${port}`;

    return {
        baseUrl,
        token,
        stageApi,
        cleanup: async () => {
            await stageApi.stopStageServer();
            await rm(tempRoot, { recursive: true, force: true });
        },
    };
};

const activeCleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
    while (activeCleanups.length > 0) {
        const cleanup = activeCleanups.pop();
        if (cleanup) {
            await cleanup();
        }
    }
});

describe('stageApi http contract', () => {
    it('accepts a parser-compatible lyrics payload and exposes it through status', async () => {
        const context = await withStageApi();
        activeCleanups.push(context.cleanup);

        const postResponse = await fetch(`${context.baseUrl}/stage/lyrics`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: 'Stage Lyrics',
                artist: 'Folia',
                lyricSource: {
                    type: 'local',
                    lrcContent: '[00:00.00]Hello world',
                    tLrcContent: '[00:00.00]你好，世界',
                    formatHint: 'lrc',
                },
            }),
        });

        expect(postResponse.status).toBe(200);
        const postPayload = await postResponse.json();
        expect(postPayload.activeEntryKind).toBe('lyrics');
        expect(postPayload.lyricsSession).toMatchObject({
            title: 'Stage Lyrics',
            artist: 'Folia',
            lyricSource: {
                type: 'local',
                lrcContent: '[00:00.00]Hello world',
                tLrcContent: '[00:00.00]你好，世界',
                formatHint: 'lrc',
            },
        });

        const statusResponse = await fetch(`${context.baseUrl}/stage/status`, {
            headers: {
                Authorization: `Bearer ${context.token}`,
            },
        });
        const statusPayload = await statusResponse.json();
        expect(statusPayload.lyricsSession?.lyricSource?.type).toBe('local');
        expect(statusPayload.mediaSession).toBeNull();
    });

    it('accepts a JSON media session and clears it through DELETE /stage/state', async () => {
        const context = await withStageApi();
        activeCleanups.push(context.cleanup);

        const sessionResponse = await fetch(`${context.baseUrl}/stage/session`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                title: 'Example',
                artist: 'Artist',
                audioUrl: 'https://example.com/demo.mp3',
                lyricsText: '[00:00.00]Hello',
            }),
        });

        expect(sessionResponse.status).toBe(200);
        const sessionPayload = await sessionResponse.json();
        expect(sessionPayload.activeEntryKind).toBe('media');
        expect(sessionPayload.mediaSession).toMatchObject({
            title: 'Example',
            artist: 'Artist',
            audioUrl: 'https://example.com/demo.mp3',
        });

        const clearResponse = await fetch(`${context.baseUrl}/stage/state`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${context.token}`,
            },
        });
        const clearPayload = await clearResponse.json();
        expect(clearPayload.activeEntryKind).toBeNull();
        expect(clearPayload.lyricsSession).toBeNull();
        expect(clearPayload.mediaSession).toBeNull();
    });

    it('returns normalized local search results', async () => {
        const context = await withStageApi({
            searchStageSongs: async () => [{
                songId: 42,
                title: 'String Theocracy',
                artists: ['Mili'],
                album: 'Library Of Ruina',
                durationMs: 188000,
                coverUrl: 'https://example.com/cover.jpg',
            }],
        });
        activeCleanups.push(context.cleanup);

        const response = await fetch(`${context.baseUrl}/stage/search`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                query: 'String Theocracy',
                limit: 5,
            }),
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload).toEqual({
            query: 'String Theocracy',
            songs: [{
                songId: 42,
                title: 'String Theocracy',
                artists: ['Mili'],
                album: 'Library Of Ruina',
                durationMs: 188000,
                coverUrl: 'https://example.com/cover.jpg',
            }],
        });
    });

    it('bridges /stage/play into a renderer request and resolves on completion', async () => {
        const context = await withStageApi({ autoCompletePlay: true });
        activeCleanups.push(context.cleanup);

        const response = await fetch(`${context.baseUrl}/stage/play`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                songId: 123456,
            }),
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload).toEqual({
            ok: true,
            songId: 123456,
            appendToQueue: false,
        });
    });

    it('passes appendToQueue through /stage/play requests', async () => {
        const receivedRequests: Array<{ appendToQueue?: boolean; songId: number; }> = [];
        const context = await withStageApi({
            autoCompletePlay: true,
            onPlayRequest: (payload) => {
                receivedRequests.push(payload);
            },
        });
        activeCleanups.push(context.cleanup);

        const response = await fetch(`${context.baseUrl}/stage/play`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                songId: 654321,
                appendToQueue: true,
            }),
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload).toEqual({
            ok: true,
            songId: 654321,
            appendToQueue: true,
        });
        expect(receivedRequests).toHaveLength(1);
        expect(receivedRequests[0]).toMatchObject({
            songId: 654321,
            appendToQueue: true,
        });
    });
});
