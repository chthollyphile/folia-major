import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
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
                    if (channel === 'stage-player-control-request') {
                        options.onControlRequest?.(payload);
                    }
                    if (channel === 'stage-player-queue-request') {
                        options.onQueueRequest?.(payload);
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

const publishNormalPlayerSnapshot = (stageApi: ReturnType<typeof createStageApi>, overrides: Record<string, any> = {}) => stageApi.publishStagePlayerSnapshot({
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
});

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
        publishNormalPlayerSnapshot(context.stageApi);

        const getResponse = await fetch(`${context.baseUrl}/stage/player/queue`, {
            headers: { Authorization: `Bearer ${context.token}` },
        });
        const getPayload = await getResponse.json();
        expect(getPayload).toMatchObject({
            domain: 'player-playback',
            direction: 'inside-out',
            queue: {
                length: 1,
            },
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
        expect(receivedQueueRequests[0]).toMatchObject({
            action: 'insert-next',
            songId: 99,
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

        publishNormalPlayerSnapshot(context.stageApi, {
            playerState: 'PLAYING',
            positionMs: 2000,
            sampledAtMs: Date.now(),
        });
        await expectNoWebSocketMessage(socket);

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
    });
});
