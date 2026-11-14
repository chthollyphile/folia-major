import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
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
    autoCompleteControl?: boolean;
    autoCompleteQueue?: boolean;
    onPlayRequest?: (payload: any) => void;
    onControlRequest?: (payload: any) => void;
    onQueueRequest?: (payload: any) => void;
    onSearchRequest?: (payload: any, stageApi: ReturnType<typeof createStageApi>) => void;
    onChannel?: (channel: string, payload: any) => void;
    connectionFilePath?: (tempRoot: string) => string;
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
                    options.onChannel?.(channel, payload);
                    if (channel === 'stage-external-play-request') {
                        options.onPlayRequest?.(payload);
                    }
                    if (channel === 'stage-player-control-request') {
                        options.onControlRequest?.(payload);
                    }
                    if (channel === 'stage-player-queue-request') {
                        options.onQueueRequest?.(payload);
                    }
                    if (channel === 'stage-player-search-request') {
                        queueMicrotask(() => options.onSearchRequest?.(payload, stageApi));
                    }
                    if (options.autoCompletePlay && channel === 'stage-external-play-request') {
                        queueMicrotask(() => {
                            stageApi.completeStageExternalPlayRequest({
                                requestId: payload.requestId,
                                ok: true,
                            });
                        });
                    }
                    if (options.autoCompleteControl && channel === 'stage-player-control-request') {
                        queueMicrotask(() => {
                            stageApi.completeStagePlayerControlRequest({
                                requestId: payload.requestId,
                                ok: true,
                            });
                        });
                    }
                    if (options.autoCompleteQueue && channel === 'stage-player-queue-request') {
                        queueMicrotask(() => {
                            stageApi.completeStagePlayerQueueRequest({
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
        searchStageSongs: options.searchStageSongs,
        connectionFilePath: options.connectionFilePath?.(tempRoot) ?? null,
    });

    await stageApi.setStageEnabled(true);
    const token = stageApi.buildStageStatus().token as string;
    const baseUrl = `http://127.0.0.1:${port}`;

    return {
        baseUrl,
        token,
        stageApi,
        tempRoot,
        port,
        cleanup: async () => {
            await stageApi.stopStageServer();
            await rm(tempRoot, { recursive: true, force: true });
        },
    };
};

const publishNormalPlayerSnapshot = (stageApi: ReturnType<typeof createStageApi>, overrides: Record<string, any> = {}, options?: Record<string, any>) => stageApi.publishStagePlayerSnapshot({
    playbackContext: 'normal-playback',
    current: {
        id: '42',
        source: 'netease',
        title: 'String Theocracy',
        artist: 'Mili',
        album: 'Library Of Ruina',
        durationMs: 188000,
        coverUrl: 'https://example.com/cover.jpg',
    },
    playerState: 'PLAYING',
    positionMs: 1000,
    durationMs: 188000,
    sampledAtMs: Date.now(),
    updatedAt: Date.now(),
    controlCapabilities: {
        play: true,
        pause: true,
        resume: true,
        seek: true,
        previous: true,
        next: true,
    },
    queueCapabilities: {
        append: true,
        insertNext: true,
        remove: true,
        move: true,
        select: true,
        clear: true,
    },
    queue: {
        currentIndex: 0,
        items: [{
            queueItemId: 'netease:42:0',
            id: '42',
            source: 'netease',
            title: 'String Theocracy',
            artist: 'Mili',
            album: 'Library Of Ruina',
            durationMs: 188000,
            coverUrl: 'https://example.com/cover.jpg',
        }],
    },
    ...overrides,
}, options);

const buildStageQueueItems = (count: number) => Array.from({ length: count }, (_, index) => ({
    queueItemId: `netease:${42 + index}:${index}`,
    id: String(42 + index),
    source: 'netease',
    title: `Track ${index + 1}`,
    artist: 'Folia',
    album: 'Stage',
    durationMs: 180000 + index,
    coverUrl: null,
}));

const waitForWebSocketMessage = (socket: WebSocket, timeoutMs = 500) => new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Timed out waiting for WebSocket message.'));
    }, timeoutMs);
    const cleanup = () => {
        clearTimeout(timeout);
        socket.off('message', handleMessage);
        socket.off('error', handleError);
    };
    const handleMessage = (data: any) => {
        cleanup();
        resolve(JSON.parse(String(data)));
    };
    const handleError = (error: Error) => {
        cleanup();
        reject(error);
    };

    socket.once('message', handleMessage);
    socket.once('error', handleError);
});

const expectNoWebSocketMessage = (socket: WebSocket, timeoutMs = 100) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
        cleanup();
        resolve();
    }, timeoutMs);
    const cleanup = () => {
        clearTimeout(timeout);
        socket.off('message', handleMessage);
        socket.off('error', handleError);
    };
    const handleMessage = (data: any) => {
        cleanup();
        reject(new Error(`Unexpected WebSocket message: ${String(data)}`));
    };
    const handleError = (error: Error) => {
        cleanup();
        reject(error);
    };

    socket.once('message', handleMessage);
    socket.once('error', handleError);
});

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
        expect(postPayload).toMatchObject({
            domain: 'stage-input',
            direction: 'outside-in',
        });
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
        expect(statusPayload).toMatchObject({
            domain: 'stage-input',
            direction: 'outside-in',
        });
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
        expect(sessionPayload).toMatchObject({
            domain: 'stage-input',
            direction: 'outside-in',
        });
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
        expect(payload).toMatchObject({
            domain: 'player-playback',
            direction: 'outside-in',
            deprecated: true,
            replacement: '/stage/player/search',
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
        expect(payload).toMatchObject({
            domain: 'player-playback',
            direction: 'outside-in',
            deprecated: true,
            replacement: '/stage/player/play',
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
        expect(payload).toMatchObject({
            domain: 'player-playback',
            direction: 'outside-in',
            deprecated: true,
            replacement: '/stage/player/play',
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

    it('serves player search and play through the new player routes', async () => {
        const receivedRequests: Array<{ songId: number; appendToQueue?: boolean; }> = [];
        const context = await withStageApi({
            autoCompletePlay: true,
            onPlayRequest: payload => receivedRequests.push(payload),
            searchStageSongs: async () => [{
                songId: 7,
                title: 'Player Route',
                artists: ['Folia'],
                album: 'Stage',
                durationMs: 123000,
                coverUrl: null,
            }],
        });
        activeCleanups.push(context.cleanup);

        const searchResponse = await fetch(`${context.baseUrl}/stage/player/search`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: 'Player Route' }),
        });
        const searchPayload = await searchResponse.json();
        expect(searchPayload).toMatchObject({
            domain: 'player-playback',
            direction: 'outside-in',
            query: 'Player Route',
            provider: 'netease',
            songs: [{ songId: 7, provider: 'netease', songRef: 'netease:7' }],
        });
        expect(searchPayload.deprecated).toBeUndefined();

        const playResponse = await fetch(`${context.baseUrl}/stage/player/play`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ songId: 7, appendToQueue: true }),
        });
        const playPayload = await playResponse.json();
        expect(playPayload).toMatchObject({
            domain: 'player-playback',
            direction: 'outside-in',
            ok: true,
            songId: 7,
            appendToQueue: true,
        });
        expect(receivedRequests[0]).toMatchObject({ songId: 7, appendToQueue: true });
    });

    // Folium 2.0 方案 §7：不带 provider 的搜索也问渲染进程的 omni（默认平台），不再直连主进程里网易云的本机端口；回答的形状不变。
    it('asks the renderer\'s omni for the default provider when a search names no provider, answering in the same shape', async () => {
        const receivedSearchRequests: any[] = [];
        const context = await withStageApi({
            onSearchRequest: (payload, stageApi) => {
                receivedSearchRequests.push(payload);
                stageApi.completeStagePlayerSearchRequest({
                    requestId: payload.requestId,
                    ok: true,
                    songs: [{ songId: 186016, title: '晴天', artists: ['周杰伦'], album: '叶惠美', durationMs: 269000, coverUrl: 'https://p1.example/cover.jpg' }],
                });
            },
        });
        activeCleanups.push(context.cleanup);

        const response = await fetch(`${context.baseUrl}/stage/player/search`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: '晴天', limit: 5 }),
        });

        expect(response.status).toBe(200);
        expect(receivedSearchRequests[0]).toMatchObject({ providerId: 'netease', query: '晴天', limit: 5 });
        expect(await response.json()).toMatchObject({
            query: '晴天',
            provider: 'netease',
            songs: [{
                songId: 186016,
                title: '晴天',
                artists: ['周杰伦'],
                album: '叶惠美',
                durationMs: 269000,
                coverUrl: 'https://p1.example/cover.jpg',
                provider: 'netease',
                songRef: 'netease:186016',
            }],
        });
    });

    it('searches an omni provider through the renderer and tags each song with its reference', async () => {
        const receivedSearchRequests: any[] = [];
        const context = await withStageApi({
            searchStageSongs: async () => {
                throw new Error('The local Netease search must not run for a provider search.');
            },
            onSearchRequest: (payload, stageApi) => {
                receivedSearchRequests.push(payload);
                stageApi.completeStagePlayerSearchRequest({
                    requestId: payload.requestId,
                    ok: true,
                    songs: [
                        { songId: 97773, title: '晴天', artists: ['周杰伦'], album: '叶惠美', durationMs: 269000, coverUrl: null },
                        { songId: '', title: 'No id' },
                        { songId: 'kept', title: 'Second' },
                    ],
                });
            },
        });
        activeCleanups.push(context.cleanup);

        const response = await fetch(`${context.baseUrl}/stage/player/search`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ query: '晴天 周杰伦', provider: 'qq', limit: 3 }),
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload).toMatchObject({
            query: '晴天 周杰伦',
            provider: 'qq',
            songs: [{
                songId: '97773',
                title: '晴天',
                artists: ['周杰伦'],
                album: '叶惠美',
                durationMs: 269000,
                coverUrl: null,
                provider: 'qq',
                songRef: 'qq:97773',
            }, {
                // The song without an id is left out; the one after it keeps its place.
                songId: 'kept',
                title: 'Second',
                artists: [],
                album: '',
                durationMs: null,
                coverUrl: null,
                provider: 'qq',
                songRef: 'qq:kept',
            }],
        });
        expect(receivedSearchRequests[0]).toMatchObject({ providerId: 'qq', query: '晴天 周杰伦', limit: 3 });
    });

    it('rejects a malformed search provider and reports a provider search the renderer refused', async () => {
        const context = await withStageApi({
            onSearchRequest: (payload, stageApi) => {
                stageApi.completeStagePlayerSearchRequest({
                    requestId: payload.requestId,
                    ok: false,
                    error: 'Online music provider "nowhere" is not registered.',
                });
            },
        });
        activeCleanups.push(context.cleanup);
        const search = (body: Record<string, unknown>) => fetch(`${context.baseUrl}/stage/player/search`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        for (const provider of ['QQ Music!', '', 42, 'qq:1']) {
            const response = await search({ query: 'x', provider });
            expect(response.status).toBe(400);
            expect((await response.json()).code).toBe('INVALID_STAGE_PLAYER_SEARCH_PROVIDER');
        }

        const rejected = await search({ query: 'x', provider: 'nowhere' });
        expect(rejected.status).toBe(502);
        expect((await rejected.json()).code).toBe('STAGE_SEARCH_REJECTED');
    });

    it('plays a provider song reference and keeps bare numeric ids on the local Netease service', async () => {
        const receivedRequests: any[] = [];
        const context = await withStageApi({
            autoCompletePlay: true,
            onPlayRequest: payload => receivedRequests.push(payload),
        });
        activeCleanups.push(context.cleanup);
        const play = (songId: unknown) => fetch(`${context.baseUrl}/stage/player/play`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ songId, appendToQueue: true }),
        });

        const qqResponse = await play('qq:97773');
        expect(qqResponse.status).toBe(200);
        expect(await qqResponse.json()).toMatchObject({
            ok: true,
            songId: '97773',
            provider: 'qq',
            songRef: 'qq:97773',
            appendToQueue: true,
        });

        const numericResponse = await play(123456);
        expect(await numericResponse.json()).toMatchObject({ songId: 123456, provider: 'netease', songRef: 'netease:123456' });
        const prefixedResponse = await play('netease:123456');
        expect(await prefixedResponse.json()).toMatchObject({ songId: 123456, provider: 'netease' });

        expect(receivedRequests).toEqual([
            expect.objectContaining({ providerId: 'qq', songId: '97773', appendToQueue: true }),
            expect.objectContaining({ providerId: 'netease', songId: 123456 }),
            expect.objectContaining({ providerId: 'netease', songId: 123456 }),
        ]);

        for (const songId of ['qq:', ':123', 'netease:abc', 'netease:0', -1, 'a b:1', `qq:${'9'.repeat(257)}`]) {
            const response = await play(songId);
            expect(response.status).toBe(400);
            expect((await response.json()).code).toBe('INVALID_STAGE_PLAYER_PLAY_SONG_ID');
        }
        expect(receivedRequests).toHaveLength(3);
    });

    it('queues songs of several providers in one request', async () => {
        const receivedQueueRequests: any[] = [];
        const context = await withStageApi({
            autoCompleteQueue: true,
            onQueueRequest: payload => receivedQueueRequests.push(payload),
        });
        activeCleanups.push(context.cleanup);
        publishNormalPlayerSnapshot(context.stageApi);
        const queue = (body: Record<string, unknown>) => fetch(`${context.baseUrl}/stage/player/queue`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
        });

        await queue({ action: 'append', songIds: [7, 'qq:97773', 'bad', 'kugou:abc123'], songId: 99 });
        await queue({ action: 'append', songIds: ['bad'], songId: 'qq:1' });

        expect(receivedQueueRequests[0].songs).toEqual([
            { providerId: 'netease', songId: 7 },
            { providerId: 'qq', songId: '97773' },
            { providerId: 'kugou', songId: 'abc123' },
        ]);
        expect(receivedQueueRequests[1].songs).toEqual([{ providerId: 'qq', songId: '1' }]);
    });

    it('returns player status with context and capabilities', async () => {
        const context = await withStageApi();
        activeCleanups.push(context.cleanup);
        publishNormalPlayerSnapshot(context.stageApi);

        const response = await fetch(`${context.baseUrl}/stage/player/status`, {
            headers: { Authorization: `Bearer ${context.token}` },
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload).toMatchObject({
            domain: 'player-playback',
            direction: 'inside-out',
            playbackContext: 'normal-playback',
            current: {
                id: '42',
                source: 'netease',
                title: 'String Theocracy',
            },
            controlCapabilities: {
                next: true,
                previous: true,
            },
            queueCapabilities: {
                append: true,
                insertNext: true,
                select: true,
            },
            queue: {
                currentIndex: 0,
                length: 1,
            },
        });
        expect(payload.queue.items).toBeUndefined();
    });

    it('reports precise player time with playback compensation only while playing', async () => {
        const context = await withStageApi();
        activeCleanups.push(context.cleanup);

        publishNormalPlayerSnapshot(context.stageApi, {
            playerState: 'PLAYING',
            positionMs: 1000,
            durationMs: 10000,
            sampledAtMs: Date.now() - 5000,
        });
        const playingResponse = await fetch(`${context.baseUrl}/stage/player/time`, {
            headers: { Authorization: `Bearer ${context.token}` },
        });
        const playingPayload = await playingResponse.json();
        expect(playingPayload.positionMs).toBeGreaterThanOrEqual(5500);
        expect(playingPayload.positionMs).toBeLessThanOrEqual(10000);

        publishNormalPlayerSnapshot(context.stageApi, {
            playerState: 'PAUSED',
            positionMs: 2000,
            durationMs: 10000,
            sampledAtMs: Date.now() - 5000,
        });
        const pausedResponse = await fetch(`${context.baseUrl}/stage/player/time`, {
            headers: { Authorization: `Bearer ${context.token}` },
        });
        const pausedPayload = await pausedResponse.json();
        expect(pausedPayload).toMatchObject({
            domain: 'player-playback',
            direction: 'inside-out',
            playerState: 'PAUSED',
            positionMs: 2000,
        });
    });

    it('rejects unsupported player control actions and forwards allowed ones', async () => {
        const receivedControls: any[] = [];
        const context = await withStageApi({
            autoCompleteControl: true,
            onControlRequest: payload => receivedControls.push(payload),
        });
        activeCleanups.push(context.cleanup);

        const unsupportedResponse = await fetch(`${context.baseUrl}/stage/player/control`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'next' }),
        });
        expect(unsupportedResponse.status).toBe(409);

        publishNormalPlayerSnapshot(context.stageApi);
        const invalidSeekResponse = await fetch(`${context.baseUrl}/stage/player/control`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'seek' }),
        });
        expect(invalidSeekResponse.status).toBe(400);
        const invalidSeekPayload = await invalidSeekResponse.json();
        expect(invalidSeekPayload).toMatchObject({
            code: 'INVALID_STAGE_PLAYER_SEEK_POSITION',
        });
        expect(receivedControls).toHaveLength(0);

        const response = await fetch(`${context.baseUrl}/stage/player/control`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'seek', positionMs: 5000 }),
        });
        const payload = await response.json();
        expect(payload).toMatchObject({
            domain: 'player-playback',
            direction: 'outside-in',
            accepted: true,
            action: 'seek',
        });
        expect(receivedControls[0]).toMatchObject({
            action: 'seek',
            positionMs: 5000,
        });
    });

    it('reads and forwards player queue operations', async () => {
        const receivedQueueRequests: any[] = [];
        const context = await withStageApi({
            autoCompleteQueue: true,
            onQueueRequest: payload => receivedQueueRequests.push(payload),
        });
        activeCleanups.push(context.cleanup);
        const queueItems = buildStageQueueItems(3);
        publishNormalPlayerSnapshot(context.stageApi, {
            queue: {
                currentIndex: 1,
                items: queueItems,
            },
        });

        const getResponse = await fetch(`${context.baseUrl}/stage/player/queue?offset=1&limit=1`, {
            headers: { Authorization: `Bearer ${context.token}` },
        });
        const getPayload = await getResponse.json();
        expect(getPayload).toMatchObject({
            domain: 'player-playback',
            direction: 'inside-out',
            queue: {
                currentIndex: 1,
                length: 3,
                offset: 1,
                limit: 1,
                returned: 1,
                hasMore: true,
                nextOffset: 2,
                items: [{
                    id: '43',
                    queueItemId: 'netease:43:1',
                }],
            },
        });

        const emptyWindowResponse = await fetch(`${context.baseUrl}/stage/player/queue?offset=99&limit=1`, {
            headers: { Authorization: `Bearer ${context.token}` },
        });
        const emptyWindowPayload = await emptyWindowResponse.json();
        expect(emptyWindowPayload.queue).toMatchObject({
            length: 3,
            offset: 3,
            returned: 0,
            hasMore: false,
            items: [],
        });

        const postResponse = await fetch(`${context.baseUrl}/stage/player/queue`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'insert-next', songId: 99 }),
        });
        const postPayload = await postResponse.json();
        expect(postPayload).toMatchObject({
            domain: 'player-playback',
            direction: 'outside-in',
            accepted: true,
            action: 'insert-next',
        });
        expect(postPayload.queue).toMatchObject({
            currentIndex: 1,
            length: 3,
        });
        expect(postPayload.queue.items).toBeUndefined();
        expect(receivedQueueRequests[0]).toMatchObject({
            action: 'insert-next',
            songs: [{ providerId: 'netease', songId: 99 }],
        });

        const selectResponse = await fetch(`${context.baseUrl}/stage/player/queue`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${context.token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'select', index: 0 }),
        });
        const selectPayload = await selectResponse.json();
        expect(selectPayload).toMatchObject({
            domain: 'player-playback',
            direction: 'outside-in',
            accepted: true,
            action: 'select',
        });
        expect(receivedQueueRequests[1]).toMatchObject({
            action: 'select',
            index: 0,
        });
    });

    it('streams player WebSocket events with token authentication', async () => {
        const context = await withStageApi();
        activeCleanups.push(context.cleanup);
        publishNormalPlayerSnapshot(context.stageApi);

        const socket = new WebSocket(`${context.baseUrl.replace('http://', 'ws://')}/stage/player/ws?token=${context.token}`);
        activeCleanups.push(async () => {
            socket.close();
        });

        const firstMessage = await waitForWebSocketMessage(socket);
        expect(firstMessage).toMatchObject({
            event: 'STATUS',
            domain: 'player-playback',
            direction: 'inside-out',
        });
        expect(firstMessage.queue.items).toBeUndefined();

        publishNormalPlayerSnapshot(context.stageApi, {
            playerState: 'PLAYING',
            positionMs: 2000,
            durationMs: 30024,
            sampledAtMs: Date.now(),
        });
        await expectNoWebSocketMessage(socket);

        const seekMessagePromise = waitForWebSocketMessage(socket);
        publishNormalPlayerSnapshot(context.stageApi, {
            playerState: 'PLAYING',
            positionMs: 5000,
            durationMs: 30024,
            sampledAtMs: Date.now(),
        }, { forcePlaybackEvent: true });
        const seekMessage = await seekMessagePromise;
        expect(seekMessage).toMatchObject({
            event: 'PLAYBACK_UPDATED',
            domain: 'player-playback',
            direction: 'inside-out',
            playbackContext: 'normal-playback',
            playerState: 'PLAYING',
            durationMs: 30024,
        });
        expect(seekMessage.positionMs).toBeGreaterThanOrEqual(5000);
        expect(seekMessage.positionMs).toBeLessThanOrEqual(10000);
        expect(seekMessage.current).toBeUndefined();
        expect(seekMessage.controlCapabilities).toBeUndefined();
        expect(seekMessage.queue).toBeUndefined();

        const pauseMessagePromise = waitForWebSocketMessage(socket);
        publishNormalPlayerSnapshot(context.stageApi, {
            playerState: 'PAUSED',
            positionMs: 2500,
            durationMs: 30024,
            sampledAtMs: Date.now(),
        });
        const pauseMessage = await pauseMessagePromise;
        expect(pauseMessage).toMatchObject({
            event: 'PLAYBACK_UPDATED',
            domain: 'player-playback',
            direction: 'inside-out',
            playbackContext: 'normal-playback',
            playerState: 'PAUSED',
            positionMs: 2500,
            durationMs: 30024,
        });
        expect(pauseMessage.current).toBeUndefined();
        expect(pauseMessage.controlCapabilities).toBeUndefined();
        expect(pauseMessage.queue).toBeUndefined();

        const nextMessagePromise = waitForWebSocketMessage(socket);
        publishNormalPlayerSnapshot(context.stageApi, {
            current: {
                id: '43',
                source: 'netease',
                title: 'Next Track',
                artist: 'Folia',
                album: 'Stage',
                durationMs: 90000,
                coverUrl: null,
            },
        });
        const nextMessage = await nextMessagePromise;
        expect(nextMessage).toMatchObject({
            event: 'TRACK_CHANGED',
            current: {
                id: '43',
                title: 'Next Track',
            },
        });
        expect(nextMessage.positionMs).toBeUndefined();
        expect(nextMessage.durationMs).toBeUndefined();
        expect(nextMessage.queue.items).toBeUndefined();
    });
});

describe('stageApi external player sessions', () => {
    const postJson = (context: { baseUrl: string; token: string }, route: string, body: unknown) => fetch(`${context.baseUrl}${route}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${context.token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    it('accepts a lyrics session without lyrics when it names its track, with its length and clock', async () => {
        const context = await withStageApi();
        activeCleanups.push(context.cleanup);

        const response = await postJson(context, '/stage/lyrics', {
            title: 'Spring Thief',
            artist: 'yorushika',
            durationMs: 263500.4,
            coverUrl: 'https://example.com/cover.jpg',
            positionMs: 12000,
            paused: true,
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.activeEntryKind).toBe('lyrics');
        expect(payload.lyricsSession).toMatchObject({
            title: 'Spring Thief',
            artist: 'yorushika',
            durationMs: 263500,
            coverUrl: 'https://example.com/cover.jpg',
            clock: { positionMs: 12000, paused: true },
        });
        expect(payload.lyricsSession.lyricSource).toBeUndefined();
        expect(typeof payload.lyricsSession.clock.sampledAtMs).toBe('number');
    });

    it('still asks a lyrics session for lyrics or a title, and rejects a bad cover or clock', async () => {
        const context = await withStageApi();
        activeCleanups.push(context.cleanup);

        const cases: Array<[unknown, string]> = [
            [{ artist: 'nobody' }, 'INVALID_STAGE_LYRICS'],
            [{ title: 'x', coverUrl: 'file:///home/me/.cache/cover.png' }, 'INVALID_STAGE_COVER'],
            [{ title: 'x', coverUrl: 'https://example.com/a.png', cover: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } }, 'INVALID_STAGE_COVER'],
            [{ title: 'x', cover: { mimeType: 'text/html', data: 'PGI+' } }, 'INVALID_STAGE_COVER'],
            [{ title: 'x', positionMs: -1 }, 'INVALID_STAGE_LYRICS_CLOCK'],
            [{ title: 'x', positionMs: 1, paused: 'yes' }, 'INVALID_STAGE_LYRICS_CLOCK'],
            [{ title: 'x', durationMs: 0 }, 'INVALID_STAGE_DURATION'],
        ];
        for (const [body, code] of cases) {
            const response = await postJson(context, '/stage/lyrics', body);
            expect(response.status, JSON.stringify(body)).toBe(400);
            expect((await response.json()).code).toBe(code);
        }
    });

    it('serves an uploaded cover from its session with its image type', async () => {
        const context = await withStageApi();
        activeCleanups.push(context.cleanup);
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

        const response = await postJson(context, '/stage/lyrics', {
            title: 'Cover',
            cover: { mimeType: 'image/png', data: png.toString('base64') },
        });
        expect(response.status).toBe(200);
        const coverUrl = (await response.json()).lyricsSession.coverUrl as string;
        expect(coverUrl.startsWith(`http://127.0.0.1:${context.port}/stage/media/session/`)).toBe(true);
        expect(coverUrl).toMatch(/\/cover\?v=\d+$/);

        // An <img> loads it without the token, like a media session's cover.
        const cover = await fetch(coverUrl);
        expect(cover.status).toBe(200);
        expect(cover.headers.get('content-type')).toContain('image/png');
        expect(Buffer.from(await cover.arrayBuffer())).toEqual(png);

        // Only from its session's address: the token-free "current" cover any page could poll does not show it.
        expect((await fetch(`${context.baseUrl}/stage/media/current/cover`)).status).toBe(404);
    });

    it('moves the clock of the lyrics session on screen without loading it again', async () => {
        const sent: Array<{ channel: string; payload: any }> = [];
        const context = await withStageApi({ onChannel: (channel, payload) => sent.push({ channel, payload }) });
        activeCleanups.push(context.cleanup);

        const inactive = await postJson(context, '/stage/lyrics/clock', { positionMs: 1000 });
        expect(inactive.status).toBe(409);
        expect((await inactive.json()).code).toBe('STAGE_LYRICS_SESSION_INACTIVE');

        // A session pushed without positionMs keeps Folia's own clock.
        await postJson(context, '/stage/lyrics', { title: 'Own clock', lyricSource: { type: 'local', lrcContent: '[00:01.00]a' } });
        const unclocked = await postJson(context, '/stage/lyrics/clock', { positionMs: 1000 });
        expect(unclocked.status).toBe(409);
        expect((await unclocked.json()).code).toBe('STAGE_LYRICS_SESSION_UNCLOCKED');

        const session = (await (await postJson(context, '/stage/lyrics', { title: 'Clock', positionMs: 0, paused: true })).json()).lyricsSession;
        sent.length = 0;

        const response = await postJson(context, '/stage/lyrics/clock', { positionMs: 42000, durationMs: 200000, sessionUpdatedAt: session.updatedAt });
        expect(response.status).toBe(200);
        const payload = await response.json();
        // paused is kept from the clock before when it is not sent.
        expect(payload).toMatchObject({
            domain: 'stage-input',
            sessionUpdatedAt: session.updatedAt,
            clock: { positionMs: 42000, paused: true },
            durationMs: 200000,
        });
        expect(sent.map(entry => entry.channel)).toEqual(['stage-lyrics-clock-updated']);
        expect(sent[0].payload).toMatchObject({ sessionUpdatedAt: session.updatedAt, clock: { positionMs: 42000 } });

        const status = await (await fetch(`${context.baseUrl}/stage/status`, { headers: { Authorization: `Bearer ${context.token}` } })).json();
        expect(status.lyricsSession).toMatchObject({ updatedAt: session.updatedAt, durationMs: 200000, clock: { positionMs: 42000 } });

        const stale = await postJson(context, '/stage/lyrics/clock', { positionMs: 1, sessionUpdatedAt: session.updatedAt - 1 });
        expect(stale.status).toBe(409);
        expect((await stale.json()).code).toBe('STAGE_LYRICS_SESSION_CHANGED');

        const unauthorized = await fetch(`${context.baseUrl}/stage/lyrics/clock`, { method: 'POST', body: JSON.stringify({ positionMs: 1 }) });
        expect(unauthorized.status).toBe(401);
    });

    it('writes its address and token to the connection file while it serves, and removes it when stopped', async () => {
        const context = await withStageApi({ connectionFilePath: tempRoot => path.join(tempRoot, 'run', 'folia', 'stage.json') });
        activeCleanups.push(context.cleanup);
        const filePath = path.join(context.tempRoot, 'run', 'folia', 'stage.json');

        const written = JSON.parse(await readFile(filePath, 'utf-8'));
        expect(written).toEqual({
            version: 1,
            pid: process.pid,
            port: context.port,
            baseUrl: `http://127.0.0.1:${context.port}`,
            token: context.token,
        });
        if (process.platform !== 'win32') {
            expect((await stat(filePath)).mode & 0o777).toBe(0o600);
        }

        const regenerated = await context.stageApi.regenerateStageToken();
        expect(JSON.parse(await readFile(filePath, 'utf-8')).token).toBe(regenerated.token);

        await context.stageApi.stopStageServer();
        await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
