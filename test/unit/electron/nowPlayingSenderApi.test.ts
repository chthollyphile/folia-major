import http from 'node:http';
import net from 'node:net';
import WebSocket from 'ws';
import { afterEach, describe, expect, it } from 'vitest';

// test/unit/electron/nowPlayingSenderApi.test.ts
// Verifies the outbound now-playing wire shapes (track / lyric / progress) and the
// loopback HTTP + WebSocket contract of mode 1.

const {
    createNowPlayingSenderApi,
    formatNowPlayingSenderHumanTime,
    normalizeNowPlayingSenderProgressIntervalSec,
    serializeNowPlayingSenderLyric,
    serializeNowPlayingSenderTrack,
} = require('../../../electron/nowPlayingSenderApi.cjs') as {
    createNowPlayingSenderApi: (options: Record<string, unknown>) => {
        buildStatus: () => { enabled: boolean; running: boolean; port: number; url: string | null; wsUrl: string | null; progressIntervalSec: number };
        setProgressIntervalSec: (intervalSec: unknown) => { progressIntervalSec: number };
        publishLyric: (payload: unknown) => void;
        publishPlayback: (playback: unknown) => void;
        publishTrack: (snapshot: unknown) => void;
        setEnabled: (enabled: boolean) => Promise<{ enabled: boolean; running: boolean; url: string | null; error: string | null }>;
        start: () => Promise<unknown>;
        stop: () => Promise<unknown>;
    };
    formatNowPlayingSenderHumanTime: (totalSeconds: number) => string;
    normalizeNowPlayingSenderProgressIntervalSec: (value: unknown, fallback?: number) => number;
    serializeNowPlayingSenderLyric: (payload: unknown) => Record<string, unknown> | null;
    serializeNowPlayingSenderTrack: (snapshot: unknown) => Record<string, unknown> | null;
};

const activeApis: Array<{ stop: () => Promise<unknown> }> = [];

afterEach(async () => {
    await Promise.all(activeApis.splice(0).map(api => api.stop()));
});

const getFreePort = () => new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
            reject(new Error('Failed to resolve a free port.'));
            return;
        }
        server.close(error => error ? reject(error) : resolve(address.port));
    });
    server.on('error', reject);
});

const createStore = () => {
    const values = new Map<string, unknown>();
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => values.set(key, value),
    };
};

const getJson = (url: string) => new Promise<{ body: unknown; status: number }>((resolve, reject) => {
    http.get(url, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => resolve({ body: JSON.parse(body), status: response.statusCode ?? 0 }));
    }).on('error', reject);
});

describe('now playing sender shapes', () => {
    // now-playing-service's own Track/Lyric entities carry seconds, and its frontend feeds them
    // straight into a seconds-based progress bar. ServerAPI.md says milliseconds, but it documents
    // the MusicBee plugin — a different implementation from the one these clients connect to.
    it('reports duration in seconds, like now-playing-service does', () => {
        expect(serializeNowPlayingSenderTrack({
            id: 42,
            title: 'Song',
            artist: 'Artist',
            album: 'Album',
            coverUrl: 'http://cover',
            durationMs: 170_500,
        })).toEqual({
            id: '42',
            title: 'Song',
            author: 'Artist',
            album: 'Album',
            cover: 'http://cover',
            duration: 171,
        });
    });

    it('maps a lyric payload onto the lrc / karaokeLyric fields', () => {
        expect(serializeNowPlayingSenderLyric({
            source: 'folia',
            title: 'Song',
            artist: 'Artist',
            durationMs: 180_000,
            hasLyric: true,
            hasTranslatedLyric: false,
            hasKaraokeLyric: true,
            lrc: '[00:01.00]line\n',
            translatedLyric: null,
            karaokeLyric: '[0]line(1000,1000)\n',
        })).toEqual({
            source: 'folia',
            title: 'Song',
            author: 'Artist',
            duration: 180,
            hasLyric: true,
            hasTranslatedLyric: false,
            hasKaraokeLyric: true,
            lrc: '[00:01.00]line\n',
            translatedLyric: '',
            karaokeLyric: '[0]line(1000,1000)\n',
        });
    });
});

const createSender = async (port: number, store = createStore()) => {
    const api = createNowPlayingSenderApi({
        store,
        getMainWindow: () => null,
        enabledSettingKey: 'TEST_NOW_PLAYING_SENDER_ENABLED',
        progressIntervalSettingKey: 'TEST_NOW_PLAYING_SENDER_INTERVAL',
        getPort: () => port,
    });
    activeApis.push(api);
    return api;
};

const SONG = { id: '1', title: 'Song', artist: 'Artist', album: 'A', coverUrl: null, durationMs: 186_000 };

// Publishing is best-effort fan-out: there is no result the renderer could act on, so the IPC
// handlers must not pretend otherwise with a constant `true`.
it('returns nothing from the publishers', async () => {
    const port = await getFreePort();
    const api = await createSender(port);
    await api.setEnabled(true);

    expect(api.publishTrack(SONG)).toBeUndefined();
    expect(api.publishLyric(null)).toBeUndefined();
    expect(api.publishPlayback({ progressMs: 1_000, isPaused: false, volumePercent: 80, repeatType: 'NONE' })).toBeUndefined();
});

describe('now playing sender progress interval', () => {
    // The heartbeat is the one dial the user gets: 1-decimal seconds, `0` meaning "no timer".
    // Anything the store hands back that is not a finite number has to land on the default
    // instead of producing a `setTimeout(NaN)` that fires immediately forever.
    it('normalizes to one decimal inside 0..10 and falls back on junk', () => {
        expect(normalizeNowPlayingSenderProgressIntervalSec(0)).toBe(0);
        expect(normalizeNowPlayingSenderProgressIntervalSec(0.14)).toBe(0.1);
        expect(normalizeNowPlayingSenderProgressIntervalSec(0.15)).toBe(0.2);
        expect(normalizeNowPlayingSenderProgressIntervalSec(1.24)).toBe(1.2);
        expect(normalizeNowPlayingSenderProgressIntervalSec(-3)).toBe(0);
        expect(normalizeNowPlayingSenderProgressIntervalSec(60)).toBe(10);
        expect(normalizeNowPlayingSenderProgressIntervalSec('0.7')).toBe(0.7);
        expect(normalizeNowPlayingSenderProgressIntervalSec(Number.NaN)).toBe(0.5);
        expect(normalizeNowPlayingSenderProgressIntervalSec(undefined)).toBe(0.5);
        expect(normalizeNowPlayingSenderProgressIntervalSec(undefined, 2)).toBe(2);
    });

    it('persists the interval and reports it in the status', async () => {
        const port = await getFreePort();
        const store = createStore();
        const api = await createSender(port, store);

        expect(api.buildStatus().progressIntervalSec).toBe(0.5);
        expect(api.setProgressIntervalSec(2.5).progressIntervalSec).toBe(2.5);
        expect(store.get('TEST_NOW_PLAYING_SENDER_INTERVAL')).toBe(2.5);
        expect(api.buildStatus().progressIntervalSec).toBe(2.5);
        // Clamped on the way in, so a hand-edited store cannot produce an absurd heartbeat.
        expect(api.setProgressIntervalSec(999).progressIntervalSec).toBe(10);
    });

    it('does not restart the listener when the interval changes', async () => {
        const port = await getFreePort();
        const api = await createSender(port);
        await api.setEnabled(true);

        const status = api.setProgressIntervalSec(0);
        expect(status.progressIntervalSec).toBe(0);
        expect(api.buildStatus()).toMatchObject({ enabled: true, running: true });
    });
});

describe('now playing sender human time', () => {
    it('renders the documented m:ss / h:mm:ss shapes', () => {
        expect(formatNowPlayingSenderHumanTime(0)).toBe('0:00');
        expect(formatNowPlayingSenderHumanTime(37)).toBe('0:37');
        expect(formatNowPlayingSenderHumanTime(186)).toBe('3:06');
        expect(formatNowPlayingSenderHumanTime(3725)).toBe('1:02:05');
    });
});

describe('now playing sender query snapshot', () => {
    // The now-playing `/api/query` contract: seconds everywhere, `statePercent` a 0..1 ratio,
    // and a Track object even when the queue is empty.
    it('serves the documented player / track snapshot', async () => {
        const port = await getFreePort();
        const api = await createSender(port);

        const status = await api.setEnabled(true);
        expect(status).toMatchObject({ enabled: true, running: true, port });

        api.publishTrack(SONG);
        api.publishPlayback({ progressMs: 37_000, isPaused: false, volumePercent: 50, repeatType: 'ALL' });

        const base = `http://127.0.0.1:${port}`;
        const snapshot = (await getJson(`${base}/api/query`)).body as {
            player: Record<string, unknown>;
            track: Record<string, unknown>;
        };
        expect(snapshot).toEqual({
            player: {
                hasSong: true,
                isPaused: false,
                volumePercent: 50,
                seekbarCurrentPosition: 37,
                seekbarCurrentPositionHuman: '0:37',
                statePercent: 37 / 186,
                likeStatus: 'INDIFFERENT',
                repeatType: 'ALL',
            },
            track: {
                id: '1', title: 'Song', author: 'Artist', album: 'A', cover: '',
                duration: 186, durationHuman: '3:06',
                url: '', isVideo: false, isAdvertisement: false, inLibrary: false,
            },
        });

        // The split routes stay for lighter polling, and answer with the entity itself.
        expect((await getJson(`${base}/api/query/progress`)).body).toEqual({ progress: 37_000 });
        expect((await getJson(`${base}/api/query/player`)).body).toEqual(snapshot.player);
        expect((await getJson(`${base}/api/query/track`)).body).toEqual(snapshot.track);
        expect((await getJson(`${base}/api/query/hasSong`)).body).toEqual({ data: true });
        expect((await getJson(`${base}/api/query/isConnected`)).body).toEqual({ data: true });
        // `now` is an alias of the documented snapshot.
        expect((await getJson(`${base}/api/query/now`)).body).toEqual(snapshot);
    });

    // /api/lyric is the endpoint now-playing-service exposes alongside the WS stream; without it
    // every client that polls for lyrics gets the 404 the unified handler used to answer with.
    it('serves the lyric record at /api/lyric', async () => {
        const port = await getFreePort();
        const api = await createSender(port);
        await api.setEnabled(true);

        api.publishLyric({
            source: 'folia',
            title: 'Song',
            artist: 'Artist',
            durationMs: 186_000,
            hasLyric: true,
            hasTranslatedLyric: false,
            hasKaraokeLyric: false,
            lrc: '[00:01.00]line\n',
            translatedLyric: null,
            karaokeLyric: null,
        });

        expect((await getJson(`http://127.0.0.1:${port}/api/lyric`)).body).toEqual({
            source: 'folia',
            title: 'Song',
            author: 'Artist',
            duration: 186,
            hasLyric: true,
            hasTranslatedLyric: false,
            hasKaraokeLyric: false,
            lrc: '[00:01.00]line\n',
            translatedLyric: '',
            karaokeLyric: '',
        });
    });

    it('answers /api/lyric with a blank lyric rather than a 404 before any song', async () => {
        const port = await getFreePort();
        const api = await createSender(port);
        await api.setEnabled(true);

        const response = await getJson(`http://127.0.0.1:${port}/api/lyric`);
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ hasLyric: false, lrc: '', translatedLyric: '', karaokeLyric: '' });
    });

    // An empty queue must look like "nothing playing", not like a broken service, and the track
    // still has to be an object: clients dereference `track.title` before checking `hasSong`.
    it('reports hasSong false with a blank track before anything is published', async () => {
        const port = await getFreePort();
        const api = await createSender(port);
        await api.setEnabled(true);

        const snapshot = (await getJson(`http://127.0.0.1:${port}/api/query`)).body as {
            player: { hasSong: boolean; isPaused: boolean; seekbarCurrentPosition: number };
            track: Record<string, unknown> | null;
        };
        expect(snapshot.track).toMatchObject({ title: '', author: '', duration: 0, durationHuman: '0:00' });
        expect(snapshot.player).toMatchObject({ hasSong: false, isPaused: true, seekbarCurrentPosition: 0 });
    });

    // Clearing the track has to clear the whole player, not just hasSong: the progress and pause
    // bit describe the retired song, so leaving them made `/api/query` answer `hasSong: false`
    // beside `seekbarCurrentPosition: 37, isPaused: false` — a client drawing that bar sees a
    // stopped player mid-song. Leaving Stage mode for normal playback is exactly this path.
    it('drops the player clock along with hasSong when the track is cleared', async () => {
        const port = await getFreePort();
        const api = await createSender(port);
        await api.setEnabled(true);

        api.publishTrack(SONG);
        api.publishPlayback({ progressMs: 37_000, isPaused: false, volumePercent: 80, repeatType: 'NONE' });
        api.publishTrack(null);

        const snapshot = (await getJson(`http://127.0.0.1:${port}/api/query`)).body as {
            player: { hasSong: boolean; isPaused: boolean; seekbarCurrentPosition: number; seekbarCurrentPositionHuman: string; statePercent: number };
            track: Record<string, unknown> | null;
        };
        expect(snapshot.track).toMatchObject({ title: '', duration: 0 });
        expect(snapshot.player).toMatchObject({
            hasSong: false,
            isPaused: true,
            seekbarCurrentPosition: 0,
            seekbarCurrentPositionHuman: '0:00',
            statePercent: 0,
        });

        // The split routes have to agree with the snapshot they are cut from.
        expect((await getJson(`http://127.0.0.1:${port}/api/query/player`)).body).toEqual(snapshot.player);
        expect((await getJson(`http://127.0.0.1:${port}/api/query/hasSong`)).body).toEqual({ data: false });
    });

    // Disabling must not leave a stale song readable on the (closed) port or after re-enabling.
    it('clears the cached state when stopped', async () => {
        const port = await getFreePort();
        const api = await createSender(port);
        await api.setEnabled(true);

        api.publishTrack(SONG);
        api.publishPlayback({ progressMs: 5_000, isPaused: false, volumePercent: 80, repeatType: 'NONE' });
        await api.stop();
        await api.setEnabled(true);

        const snapshot = (await getJson(`http://127.0.0.1:${port}/api/query`)).body as {
            player: { hasSong: boolean; isPaused: boolean; seekbarCurrentPosition: number };
            track: Record<string, unknown> | null;
        };
        expect(snapshot.track).toMatchObject({ title: '', duration: 0 });
        expect(snapshot.player).toMatchObject({ hasSong: false, isPaused: true, seekbarCurrentPosition: 0 });
    });

    it('never opens a listener while disabled', async () => {
        const port = await getFreePort();
        const api = createNowPlayingSenderApi({
            store: createStore(),
            getMainWindow: () => null,
            enabledSettingKey: 'TEST_NOW_PLAYING_SENDER_ENABLED',
            getPort: () => port,
        });
        activeApis.push(api);

        const status = await api.setEnabled(false);
        expect(status).toMatchObject({ enabled: false, running: false });
        await expect(getJson(`http://127.0.0.1:${port}/api/query/track`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });

    // The port is resolved on every start, so a restart picks up wherever it points now.
    it('rebinds to a new port reported by getPort', async () => {
        const firstPort = await getFreePort();
        const secondPort = await getFreePort();
        let currentPort = firstPort;
        const api = createNowPlayingSenderApi({
            store: createStore(),
            getMainWindow: () => null,
            enabledSettingKey: 'TEST_NOW_PLAYING_SENDER_ENABLED',
            getPort: () => currentPort,
        });
        activeApis.push(api);

        await api.setEnabled(true);
        expect(api.buildStatus()).toMatchObject({ running: true, port: firstPort });
        api.publishTrack({ id: '1', title: 'Song', artist: 'Artist', album: '', coverUrl: null, durationMs: 180_000 });

        currentPort = secondPort;
        await api.stop();
        await api.start();
        // stop() clears the cached state by design, so the track has to be republished.
        api.publishTrack({ id: '1', title: 'Song', artist: 'Artist', album: '', coverUrl: null, durationMs: 180_000 });

        expect(api.buildStatus()).toMatchObject({ running: true, port: secondPort });
        expect((await getJson(`http://127.0.0.1:${secondPort}/api/query/track`)).body).toMatchObject({
            id: '1', title: 'Song', author: 'Artist', album: '', cover: '', duration: 180,
        });
        await expect(getJson(`http://127.0.0.1:${firstPort}/api/query/track`)).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    });
});

// A fixed port means the interesting failure is a collision, and the UI only shows `status.error`.
describe('now playing sender bind failure', () => {
    it('reports the occupied port and leaves nothing listening', async () => {
        const port = await getFreePort();
        const blocker = net.createServer();
        await new Promise<void>((resolve, reject) => {
            blocker.once('error', reject);
            blocker.listen(port, '127.0.0.1', () => resolve());
        });

        const api = await createSender(port);
        try {
            const status = await api.setEnabled(true);
            expect(status).toMatchObject({ enabled: true, running: false });
            expect(status.error).toContain(String(port));
        } finally {
            await new Promise<void>((resolve) => blocker.close(() => resolve()));
        }

        // The port is fixed, so recovery is exactly "retry once it is free" — no reconfiguration.
        const status = await api.start();
        expect(status).toMatchObject({ running: true, error: null });
    });
});

// One unit on the wire: seconds, in both the WebSocket messages and the HTTP snapshot.
describe('now playing sender units', () => {
    it('keeps the WebSocket Track in seconds', async () => {
        const port = await getFreePort();
        const api = await createSender(port);
        await api.setEnabled(true);
        api.publishTrack(SONG);

        const track = await new Promise<Record<string, unknown>>((resolve, reject) => {
            const socket = new WebSocket(`ws://127.0.0.1:${port}/api/ws/lyric`);
            socket.on('message', (raw: string) => {
                const message = JSON.parse(raw) as { event?: string; data?: Record<string, unknown> };
                if (message.event === 'Track') {
                    socket.close();
                    resolve(message.data ?? {});
                }
            });
            socket.on('error', reject);
        });

        expect(track.duration).toBe(186);
    });

    it('reports the same duration over HTTP', async () => {
        const port = await getFreePort();
        const api = await createSender(port);
        await api.setEnabled(true);
        api.publishTrack(SONG);

        const snapshot = (await getJson(`http://127.0.0.1:${port}/api/query`)).body as {
            track: { duration: number };
        };
        expect(snapshot.track.duration).toBe(186);
    });
});
