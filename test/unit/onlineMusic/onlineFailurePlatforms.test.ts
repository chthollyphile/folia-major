import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBodianApi } from 'bodian-music-api';
import { omni } from '@/services/onlineMusic/omni';
import { QQ_ONLINE_REQUEST_LIMIT_MS, resetQqTransportRuntimeCache } from '@/services/onlineMusic/qq/qqTransport';
import { NETEASE_ONLINE_REQUEST_LIMIT_MS } from '@/services/onlineMusic/netease/netease';
import { onlineFailureOf, stopsPlayback } from '@/services/onlineMusic/failure/onlineFailureCase';
import type { UnifiedSong } from '@/types';
import type { OnlineFailureOperation, OnlineProviderId, ProviderCollection } from '@/types/onlineMusic';

// test/unit/onlineMusic/onlineFailurePlatforms.test.ts
// Which case each platform's own failure to give a song's audio or a collection's tracks sorts
// to, through the real facade, adapter and transport: only the outermost thing is a stand-in
// (fetch, or the desktop side's answer). Each test is named after the case it ends in.
// The shapes of the answers are the ones the code reads today; no platform was asked.
// The shared rules are in onlineFailureCase.test.ts.

vi.mock('@/services/onlineMusic/providerAccountCache', () => ({ saveProviderAccountSnapshot: vi.fn() }));

const require = createRequire(import.meta.url);
const { normalizeBridgeError } = require('../../../electron/kugou/kugouApiBridge.cjs');
const { toErrorResult: ytmErrorResult } = require('../../../electron/ytm/errors.cjs');
const { createSpotifyApiBridge } = require('../../../electron/spotify/spotifyApiBridge.cjs');
const { publicAccountId, SESSION_KEY: SPOTIFY_SESSION_KEY } = require('../../../electron/spotify/session.cjs');
const { createWire } = require('../../helpers/bodianWire.cjs');

const songOf = (providerId: OnlineProviderId, mediaId: string, extra: Partial<UnifiedSong> = {}): UnifiedSong => ({
    id: mediaId, name: 'Song', artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId, mediaId },
    ...extra,
});
const collectionOf = (providerId: OnlineProviderId, type: 'playlist' | 'album', id: string) => ({ providerId, id, name: 'List', type }) as ProviderCollection;

// The failure of a request that threw, put together as playback and the grid put it together.
const failed = async (operation: OnlineFailureOperation, providerId: OnlineProviderId, run: () => Promise<unknown>) => {
    const error = await run().then(() => { throw new Error('the request did not fail'); }, (thrown: unknown) => thrown);
    const { case: id, facts } = onlineFailureOf({ operation, providerId }, { error });
    return { id, ...facts };
};
const audio = (song: UnifiedSong) => failed('audio', song.sourceRef!.kind === 'online' ? song.sourceRef.providerId : 'netease', () => omni.getAudioSource(song, 'high'));
const tracks = (collection: ProviderCollection) => failed('collection', collection.providerId, () => omni.getCollectionTracks(collection, { limit: 50, offset: 0 }));

const offline = () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
const answers = (body: unknown, status = 200) => vi.fn(async () => Response.json(body, { status }));
// A fetch that never answers (except the requests `answered` names, with {}). Like the real one, it
// ends only when the request is aborted.
const silent = (answered: (url: unknown) => boolean = () => false) => vi.fn((url: unknown, init?: RequestInit) => (answered(url)
    ? Promise.resolve(Response.json({}))
    : new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    })));
// A read whose request is never answered (under fake timers): nothing ends until the platform's limit,
// then it fails, the request is aborted and no timer is left. Answers what `failed` does.
const unanswered = async <T>(run: () => Promise<T>, asked: ReturnType<typeof silent>, limitMs: number): Promise<T> => {
    let ended = false;
    const outcome = run().finally(() => { ended = true; });
    await vi.advanceTimersByTimeAsync(limitMs - 1);
    expect(ended).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const read = await outcome;
    expect(asked.mock.calls.at(-1)![1]?.signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    return read;
};

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => { });
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'warn').mockImplementation(() => { });
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('NetEase', () => {
    // The desktop app: the local service's port, or none while it is down.
    const desktop = (port: number | null) => vi.stubGlobal('window', {
        electron: { getNeteasePort: async () => port, getNeteaseApiStatus: async () => ({ status: port ? 'running' : 'error' }) },
    });
    const song = songOf('netease', '42');

    it('local-service-stopped: the local service is not listening', async () => {
        desktop(null);
        expect(await audio(song)).toMatchObject({ id: 'local-service-stopped' });
        expect(await tracks(collectionOf('netease', 'playlist', '7'))).toMatchObject({ id: 'local-service-stopped' });
    });

    it('unreachable: the local service could not start for want of the network; once it is back, the next request starts it', async () => {
        let port: number | null = null;
        let status: Record<string, unknown> = { status: 'error', port: null, error: 'getaddrinfo ENOTFOUND interface.music.163.com', offline: true, updatedAt: 1 };
        // Still down: the main process answers the status as it is (too soon, or the start failed again).
        const restartNeteaseApi = vi.fn(async (_reason?: string) => status);
        vi.stubGlobal('window', { electron: { getNeteasePort: async () => port, getNeteaseApiStatus: async () => status, restartNeteaseApi } });
        expect((await audio(song)).id).toBe('unreachable');
        expect(restartNeteaseApi).toHaveBeenCalledExactlyOnceWith('needed');

        // The network is back: the start the next request asks for comes up, and the request goes through.
        restartNeteaseApi.mockImplementationOnce(async () => {
            port = 35001;
            status = { status: 'running', port, error: null, offline: false, updatedAt: 2 };
            return status;
        });
        vi.stubGlobal('fetch', answers({ code: 200, data: [{ id: 42, url: 'https://m701.music.126.net/whole.mp3', code: 200 }] }));
        await expect(omni.getAudioSource(song, 'high')).resolves.toMatchObject({ url: 'https://m701.music.126.net/whole.mp3' });
    });

    it('unreachable: the request does not get through', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', offline());
        expect((await audio(song)).id).toBe('unreachable');
    });

    it('sign-in-needed: the answer says 301, and the error goes on as auth-required', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', answers({ code: 301, msg: '需要登录' }));
        expect(await audio(song)).toMatchObject({ id: 'sign-in-needed', errorCode: 'auth-required', code: '301', message: '需要登录' });
    });

    it('refused: the answer says another code, with NetEase\'s words quoted', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', answers({ code: -462, message: '绑定手机号后才能继续操作' }));
        expect(await audio(song)).toMatchObject({ id: 'refused', code: '-462', message: '绑定手机号后才能继续操作' });
    });

    it('unreachable: the local service cannot reach NetEase and answers 502, for a song and a playlist; NetEase\'s own 502 comes with 200', async () => {
        desktop(35001);
        // util/request.js's answer for a request that does not get through (2026-10-16 log: getaddrinfo ENOTFOUND).
        vi.stubGlobal('fetch', answers({ code: 502, msg: 'getaddrinfo ENOTFOUND interfacepc.music.163.com' }, 502));
        expect(await audio(song)).toMatchObject({ id: 'unreachable', httpStatus: 502 });
        expect(await tracks(collectionOf('netease', 'playlist', '7'))).toMatchObject({ id: 'unreachable', httpStatus: 502 });
        vi.stubGlobal('fetch', answers({ code: 502, message: 'NetEase said 502' }));
        expect((await audio(song)).id).toBe('refused');
    });

    it('unknown: a module of the local service threw, which it answers as 404 Not Found', async () => {
        desktop(35001);
        // server.js, for a module that threw without a body (module/playlist_track_all.js on an answer with no playlist).
        vi.stubGlobal('fetch', answers({ code: 404, data: null, msg: 'Not Found' }, 404));
        expect((await tracks(collectionOf('netease', 'playlist', '7'))).id).toBe('unknown');
    });

    // No case: a trial clip is no failure. It is handed out marked as a preview, and omni notes the
    // mark with the URL, where playback (the notice) and the media cache (never stored) ask.
    it('no failure for a trial clip: its URL comes marked as a preview; the unblocked whole song does not', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', answers({ code: 200, data: [{ id: 42, url: 'https://m701.music.126.net/trial.mp3', code: 200, fee: 1, freeTrialInfo: { start: 0, end: 30 } }] }));
        await expect(omni.getAudioSource(song, 'high')).resolves.toMatchObject({ url: 'https://m701.music.126.net/trial.mp3', preview: true });
        expect(omni.isPreviewAudioSource('https://m701.music.126.net/trial.mp3')).toBe(true);
        // The upstream's two unblocks give a whole song: the general one writes JS null (server.js),
        // the module's own one the string 'null' (module/song_url_v1.js).
        for (const [file, freeTrialInfo] of [['whole-general.mp3', null], ['whole-module.mp3', 'null']] as const) {
            vi.stubGlobal('fetch', answers({ code: 200, data: [{ id: 42, url: `https://m701.music.126.net/${file}`, code: 200, fee: 1, freeTrialInfo }] }));
            const source = await omni.getAudioSource(song, 'high');
            expect(source).toMatchObject({ url: `https://m701.music.126.net/${file}` });
            expect(source?.preview).toBeUndefined();
            expect(omni.isPreviewAudioSource(source!.url)).toBe(false);
        }
    });

    it('unreachable: a song\'s address or a playlist\'s tracks not answered within the limit', async () => {
        vi.useFakeTimers();
        desktop(35001);
        // Past the anonymous registration of a listener who is signed out, which is answered.
        const asked = silent(url => String(url).includes('/register/anonimous'));
        vi.stubGlobal('fetch', asked);
        expect((await unanswered(() => audio(song), asked, NETEASE_ONLINE_REQUEST_LIMIT_MS)).id).toBe('unreachable');
        expect((await unanswered(() => tracks(collectionOf('netease', 'playlist', '7')), asked, NETEASE_ONLINE_REQUEST_LIMIT_MS)).id).toBe('unreachable');
    });

    it('unreachable: an anonymous registration never answered is given up at the limit, and the request then has a limit of its own', async () => {
        vi.useFakeTimers();
        desktop(35001);
        const asked = silent();
        vi.stubGlobal('fetch', asked);
        let ended = false;
        const outcome = audio(song).finally(() => { ended = true; });
        await vi.advanceTimersByTimeAsync(NETEASE_ONLINE_REQUEST_LIMIT_MS);
        // The registration was aborted, and the request for the address went on without its cookie.
        expect(String(asked.mock.calls[0][0])).toContain('/register/anonimous');
        expect(asked.mock.calls[0][1]?.signal?.aborted).toBe(true);
        expect(String(asked.mock.calls[1][0])).toContain('/song/url/v1');
        expect(ended).toBe(false);
        expect((await unanswered(() => outcome, asked, NETEASE_ONLINE_REQUEST_LIMIT_MS)).id).toBe('unreachable');
    });

    it('no-audio: the answer says 200 and the song has no URL, with the song\'s own code', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', answers({ code: 200, data: [{ id: 42, url: null, code: 404, fee: 1 }] }));
        expect(await audio(song)).toMatchObject({ id: 'no-audio', errorCode: 'not-playable', code: '404' });
    });

    it('unknown: an answer that cannot be read', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));
        expect((await audio(song)).id).toBe('unknown');
    });

    // An answer that refuses was read as an empty list: a playlist that failed showed as one with no songs.
    it('refused and sign-in-needed: a playlist or album read the answer refuses throws instead of coming back empty', async () => {
        desktop(35001);
        vi.stubGlobal('fetch', answers({ code: 404, msg: '歌单不存在' }));
        expect(await tracks(collectionOf('netease', 'playlist', '7'))).toMatchObject({ id: 'refused', code: '404', message: '歌单不存在' });
        vi.stubGlobal('fetch', answers({ code: 401 }));
        expect((await tracks(collectionOf('netease', 'album', '8'))).id).toBe('sign-in-needed');
        vi.stubGlobal('fetch', answers({ code: 200, songs: [], privileges: [] }));
        await expect(omni.getCollectionTracks(collectionOf('netease', 'playlist', '7'), { limit: 50, offset: 0 })).resolves.toMatchObject({ items: [] });
    });
});

describe('QQ Music', () => {
    const desktop = (port: number | null) => {
        resetQqTransportRuntimeCache();
        vi.stubGlobal('window', { electron: { getQqPort: async () => port } });
    };
    const song = songOf('qq', '003rJSwm3TechU');

    it('local-service-stopped: the embedded backend has no port', async () => {
        desktop(null);
        expect((await audio(song)).id).toBe('local-service-stopped');
    });

    it('unreachable: no level\'s request gets through, and the first error is the one thrown', async () => {
        desktop(3300);
        const asked = offline();
        vi.stubGlobal('fetch', asked);
        expect((await audio(song)).id).toBe('unreachable');
        expect(asked.mock.calls.length).toBeGreaterThan(1);
    });

    it('unreachable: the backend answers 503', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ message: 'Service Unavailable' }, 503));
        expect(await audio(song)).toMatchObject({ id: 'unreachable', httpStatus: 503, errorCode: 'network' });
    });

    it('unreachable: a song\'s address or a playlist\'s tracks not answered within the limit; no lower level is asked after it', async () => {
        vi.useFakeTimers();
        desktop(3300);
        const asked = silent();
        vi.stubGlobal('fetch', asked);
        expect((await unanswered(() => audio(song), asked, QQ_ONLINE_REQUEST_LIMIT_MS)).id).toBe('unreachable');
        expect(asked).toHaveBeenCalledOnce();
        expect((await unanswered(() => tracks(collectionOf('qq', 'playlist', '7039468011')), asked, QQ_ONLINE_REQUEST_LIMIT_MS)).id).toBe('unreachable');
    });

    it('retry-later: the backend answers 429 with a wait', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ retryAfterMs: 31000 }, 429));
        expect(await audio(song)).toMatchObject({ id: 'retry-later', httpStatus: 429, retryAfterMs: 31000 });
    });

    it('refused: QQ Music turns the playlist read down in its answer, with its code, subcode and words', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ response: { code: 2000, subcode: 4000, message: 'request refused' } }));
        expect(await tracks(collectionOf('qq', 'playlist', '7039468011'))).toMatchObject({
            id: 'refused', code: '2000', upstreamCode: '4000', message: 'request refused',
        });
    });

    it('no-audio: every level answers with an empty play link', async () => {
        desktop(3300);
        vi.stubGlobal('fetch', answers({ data: { playUrl: { '003rJSwm3TechU': { url: '', error: '暂无播放链接' } } } }));
        expect(await audio(song)).toMatchObject({ id: 'no-audio', errorCode: 'not-playable' });
    });

    it('unknown: a song with no songmid', async () => {
        const nameless = { ...songOf('qq', ''), sourceRef: { kind: 'online', providerId: 'qq', mediaId: '' } } as UnifiedSong;
        expect(await audio(nameless)).toMatchObject({ id: 'unknown', errorCode: 'invalid-response' });
    });
});

describe('KuGou', () => {
    // What the desktop app's request rejects with: the bridge's one line, behind Electron's prefix.
    const rejection = (operation: string, answer: unknown) => new Error(
        `Error invoking remote method 'kugou-api-request': KuGouApiError: ${normalizeBridgeError(operation, answer).message}`,
    );
    // The desktop app; the legacy mobile endpoint, asked last, goes through the lyric relay.
    const desktop = (kugouRequest: (...args: unknown[]) => unknown, legacy: unknown = { ok: false, status: 502, bodyText: '' }) => {
        const fetchLyricProxy = vi.fn(async () => legacy);
        vi.stubGlobal('window', { electron: { kugouRequest, fetchLyricProxy } });
        return fetchLyricProxy;
    };
    const song = songOf('kugou', 'ABC123', { kgHash: 'ABC123' } as Partial<UnifiedSong>);

    // The transport wraps an ended session as auth-required, while what it shares with the sign-in reads
    // error_code 152 as a refusal: the refusal in the shared code comes first.
    it('sign-in-needed: KuGou answers error_code 152, said at once and the queue stops', async () => {
        const kugouRequest = vi.fn().mockRejectedValue(rejection('song_url', { status: 200, body: { error_code: 152 } }));
        const legacy = desktop(kugouRequest);
        const error = await omni.getAudioSource(song, 'high').catch((thrown: unknown) => thrown);
        const shown = onlineFailureOf({ operation: 'audio', providerId: 'kugou' }, { error });
        expect(shown).toMatchObject({ case: 'sign-in-needed', facts: { errorCode: 'auth-required', code: '152' } });
        expect(stopsPlayback(shown)).toBe(true);
        expect(kugouRequest).toHaveBeenCalledOnce();
        expect(legacy).not.toHaveBeenCalled();
    });

    it('no-audio: KuGou answers without a URL, with its error code', async () => {
        desktop(vi.fn().mockResolvedValue({ status: 0, error_code: 20010 }), { ok: true, status: 200, bodyText: '{"status":0}' });
        expect(await audio(song)).toMatchObject({ id: 'no-audio', errorCode: 'not-playable', code: '20010' });
    });

    it('unreachable: KuGouMusicApi answers 502 with no error code of KuGou\'s, at every level', async () => {
        desktop(vi.fn().mockRejectedValue(rejection('song_url', { status: 502, body: { msg: 'connect ETIMEDOUT' } })));
        expect(await audio(song)).toMatchObject({ id: 'unreachable', httpStatus: 502, errorCode: 'network' });
    });

    it('refused: KuGou answers with an error code of its own', async () => {
        desktop(vi.fn().mockRejectedValue(rejection('song_url', { status: 502, body: { error_code: 20028, msg: '本次请求需要验证' } })));
        expect(await audio(song)).toMatchObject({ id: 'refused', code: '20028', message: '本次请求需要验证', httpStatus: 502 });
    });

    it('local-service-stopped: the desktop side could not load KuGouMusicApi', async () => {
        const unloaded = normalizeBridgeError('song_url', new Error("Cannot find module 'kugoumusicapi'"), true);
        desktop(vi.fn().mockRejectedValue(new Error(`Error invoking remote method 'kugou-api-request': KuGouApiError: ${unloaded.message}`)));
        expect((await audio(song)).id).toBe('local-service-stopped');
    });

    it('unknown: the desktop side fails before KuGou is asked', async () => {
        desktop(vi.fn().mockRejectedValue(rejection('song_url', new Error('KuGou device registration did not return a dfid'))));
        expect(await audio(song)).toMatchObject({ id: 'unknown', errorCode: 'network' });
    });
});

describe('YouTube Music', () => {
    // The desktop side's answers, by operation.
    const desktop = (byOperation: Record<string, unknown>) => vi.stubGlobal('window', {
        electron: { ytmRequest: async (operation: string) => byOperation[operation] ?? { ok: true, data: {} } },
    });
    const song = songOf('ytm', 'a0000000006');

    it('no-audio: YouTube\'s playability status word is quoted', async () => {
        // As electron/ytm/ytmApiBridge.cjs answers it (test/unit/ytm/ytmApiBridge.test.ts).
        for (const word of ['UNPLAYABLE', 'AGE_CHECK_REQUIRED']) {
            desktop({ audio: { ok: false, error: { code: 'not-playable', message: `YouTube Music cannot play this track (${word})` } } });
            expect(await audio(song)).toMatchObject({ id: 'no-audio', code: word });
        }
        desktop({ audio: { ok: false, error: { code: 'not-playable', message: 'YouTube Music offered no audio for this track' } } });
        expect(await audio(song)).toEqual({ id: 'no-audio', errorCode: 'not-playable' });
    });

    it('sign-in-needed: YouTube wants a sign-in for the track (LOGIN_REQUIRED), said at once and the queue stops', async () => {
        desktop({ audio: { ok: false, error: { code: 'not-playable', message: 'YouTube Music cannot play this track (LOGIN_REQUIRED)' } } });
        const error = await omni.getAudioSource(song, 'high').then(() => { throw new Error('the request did not fail'); }, (thrown: unknown) => thrown);
        const shown = onlineFailureOf({ operation: 'audio', providerId: 'ytm' }, { error });
        expect(shown).toMatchObject({ case: 'sign-in-needed', facts: { code: 'LOGIN_REQUIRED' } });
        expect(stopsPlayback(shown)).toBe(true);
    });

    it('retry-later: YouTube answers 429, which is not a network that fails', async () => {
        desktop({ audio: ytmErrorResult(new Error('Request failed with status code 429')) });
        expect(await audio(song)).toMatchObject({ id: 'retry-later', httpStatus: 429 });
        desktop({ audio: ytmErrorResult(new Error('Request failed with status code 503')) });
        expect(await audio(song)).toMatchObject({ id: 'unreachable', errorCode: 'network' });
        desktop({ audio: ytmErrorResult(new TypeError('fetch failed')) });
        expect((await audio(song)).id).toBe('unreachable');
    });
});

describe('Spotify', () => {
    // The real bridge, signed in, over a stand-in for Spotify's services.
    const desktop = (respond: () => unknown) => {
        const values = new Map<string, unknown>([[SPOTIFY_SESSION_KEY, Buffer.from(JSON.stringify({
            version: 1, credentials: { access_token: 'access-private', refresh_token: 'refresh-private', expires_at: Date.now() + 3600_000 },
            user: { id: publicAccountId('fixture-private'), nickname: 'Fixture', avatarUrl: '', premium: true },
        })).toString('base64')]]);
        const bridge = createSpotifyApiBridge({
            store: { get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) },
            safeStorage: { isEncryptionAvailable: () => true, encryptString: (text: string) => Buffer.from(text), decryptString: (data: Buffer) => data.toString() },
            fetch: async () => respond(), openExternal: async () => { }, log: () => { }, warn: () => { },
        });
        vi.stubGlobal('window', { electron: { spotifyRequest: bridge.request } });
    };
    const list = collectionOf('spotify', 'playlist', '37i9dQZF1DXcBWIGoYBM5M');

    it('retry-later: Spotify answers 429, which is not a network that fails', async () => {
        desktop(() => Response.json({}, { status: 429 }));
        expect(await tracks(list)).toMatchObject({ id: 'retry-later', httpStatus: 429 });
        desktop(() => Response.json({}, { status: 503 }));
        expect(await tracks(list)).toMatchObject({ id: 'unreachable', errorCode: 'network' });
        desktop(() => { throw new TypeError('fetch failed'); });
        expect((await tracks(list)).id).toBe('unreachable');
    });
});

describe('Bodian', () => {
    // The real package, as the desktop side runs it, over a stand-in for the network.
    const desktop = (respond: () => unknown) => {
        const api = createBodianApi({ deviceId: 'a'.repeat(32), requestFactory: createWire(respond).factory });
        vi.stubGlobal('window', { electron: { bodianRequest: api.request } });
    };
    const song = songOf('bodian', '1001');

    it('unreachable: Bodian answers 503', async () => {
        desktop(() => ({ httpStatus: 503 }));
        expect(await audio(song)).toMatchObject({ id: 'unreachable', httpStatus: 503, errorCode: 'network' });
    });

    it('no-audio: Bodian answers code 20018, which is quoted', async () => {
        desktop(() => ({ code: 20018, msg: 'no rights' }));
        expect(await audio(song)).toMatchObject({ id: 'no-audio', errorCode: 'not-playable', code: '20018' });
    });

    it('region-restricted: Bodian answers code 407, and its own sentence is quoted', async () => {
        desktop(() => ({ code: 407, msg: '由于版权保护，该资源仅限中国大陆地区使用' }));
        expect(await audio(song)).toMatchObject({ id: 'region-restricted', message: '由于版权保护，该资源仅限中国大陆地区使用' });
    });

    it('refused: Bodian answers another code of its own', async () => {
        desktop(() => ({ code: 500, msg: 'fail' }));
        expect(await tracks(collectionOf('bodian', 'playlist', '42'))).toMatchObject({ id: 'refused', code: '500', errorCode: 'invalid-response' });
    });
});
