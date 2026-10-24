import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmApiBridge.test.ts — the YouTube Music host bridge against a stand-in for
// youtubei.js: what the renderer may ask for, what it is told, and what never leaves the process.
// Every cookie, name, address and id in this file is made up.

const require = createRequire(import.meta.url);
const { createYtmApiBridge, pickAudioFormat, YTM_OPERATIONS } = require('../../../electron/ytm/ytmApiBridge.cjs');
const { publicAccountId, SESSION_KEY } = require('../../../electron/ytm/session.cjs');
const { createYtmWebSessionRepository, WEB_SESSION_KEY } = require('../../../electron/ytm/webSignIn.cjs');

const VIDEO = 'm9SMT5ipbxk';
const ALBUM_LIST = 'OLAK5uy_fixturefixturefixturefixturefixture01';
const errorWords = require('../../../electron/ytm/errors.cjs');
const GAIA_ID = '104000000000000000001';
const AGENT = 'Mozilla/5.0 (Test) Chrome/140.0.0.0 Safari/537.36';
const COOKIE = 'SAPISID=sapisid-private; SID=sid-private';
const storedUser = { id: publicAccountId(GAIA_ID), nickname: 'Fixture', avatarUrl: 'https://yt3.ggpht.com/a', premium: false };

const createStore = () => {
    const values = new Map<string, unknown>();
    return { values, get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
};
const cipher = () => ({ isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (data: Buffer) => Buffer.from(data.map(byte => byte ^ 0xa5)).toString() });
const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// An answer of the web client that is marked as given to a signed-in account.
const asTheAccount = { responseContext: { serviceTrackingParams: [{ service: 'GFEEDBACK', params: [{ key: 'logged_in', value: '1' }] }] } };
const asAGuest = { responseContext: { serviceTrackingParams: [{ service: 'GFEEDBACK', params: [{ key: 'logged_in', value: '0' }] }] } };

const audioFormat = (itag: number, bitrate: number, extra: Record<string, unknown> = {}) => ({
    itag, bitrate, has_audio: true, has_video: false, content_length: 1000 + itag, mime_type: 'audio/webm; codecs="opus"', ...extra,
});

// Each `Innertube.create` call yields one client, named by what it was made with: `member` (the
// cookie of the web sign-in and the player script), `web` (the cookie alone), `player` (a guest
// with the player script) or `guest`.
// `configure` prepares a client before the bridge first sees it.
const fakeYoutube = (configure: (client: any) => void = () => {}) => {
    const clients: Record<string, any> = {};
    const created: any[] = [];
    const sabr: any[] = [];
    class PlaylistPanelVideo {}
    class PlaylistPanelVideoWrapper {}
    class MusicTwoRowItem {}
    class MusicPlaylistShelf {}
    class SabrStream {
        config: unknown;
        started: unknown;
        abort = vi.fn();
        constructor(config: unknown) { this.config = config; sabr.push(this); }
        async start(options: unknown) {
            this.started = options;
            return { audioStream: new ReadableStream({ start: controller => { controller.enqueue(new Uint8Array(1251)); controller.close(); } }) };
        }
    }
    const create = vi.fn(async (options: any) => {
        const kind = options.cookie ? (options.retrieve_player ? 'member' : 'web') : options.retrieve_player ? 'player' : 'guest';
        const client = {
            kind, options,
            session: { player: { decipher: vi.fn(async (url: string) => `${url}&deciphered=1`) } },
            actions: { execute: vi.fn(async (_endpoint: string, _body?: unknown): Promise<unknown> => ({ data: options.cookie ? asTheAccount : {} })) },
            music: { search: vi.fn(), getAlbum: vi.fn(), getArtist: vi.fn() },
            getBasicInfo: vi.fn(),
        };
        clients[kind] = client;
        created.push(client);
        configure(client);
        return client;
    });
    const libraries = {
        Innertube: { create },
        Constants: { CLIENT_NAME_IDS: { WEB_REMIX: '67' }, CLIENTS: { YTMUSIC: { NAME: 'WEB_REMIX', VERSION: '1.20250219' } } },
        Platform: { shim: {} as Record<string, unknown> }, Parser: { setParserErrorHandler: vi.fn(), parseResponse: vi.fn() },
        YTNodes: { PlaylistPanelVideo, PlaylistPanelVideoWrapper, MusicTwoRowItem, MusicPlaylistShelf }, SabrStream,
        buildSabrFormat: (format: any) => ({ sabr: format.itag }), EnabledTrackTypes: { AUDIO_ONLY: 1 },
    };
    return { clients, created, sabr, libraries, create, PlaylistPanelVideo, PlaylistPanelVideoWrapper, MusicTwoRowItem, MusicPlaylistShelf };
};

// `web` is a web sign-in a run before stored, of an account without Premium.
const setup = ({ web = false, safeStorage = cipher(), configure, sessionLimitMs, language }: {
    web?: boolean; safeStorage?: Record<string, unknown>; configure?: (client: any) => void; sessionLimitMs?: number; language?: () => string } = {}) => {
    const store = createStore();
    let time = 1_700_000_000_000;
    if (web) createYtmWebSessionRepository({ store, safeStorage, now: () => time, log: vi.fn() }).set({ cookie: COOKIE, userAgent: AGENT, user: storedUser });
    const yt = fakeYoutube(configure);
    const loadLibraries = vi.fn(async () => yt.libraries);
    const fetch = vi.fn();
    const evaluate = vi.fn();
    const warn = vi.fn();
    const log = vi.fn();
    const mintToken = vi.fn(async (binding: string) => `token-${binding}`);
    const wait = vi.fn(async (_ms: number) => undefined);
    let keys = 0;
    const bridge = createYtmApiBridge({ store, safeStorage, fetch, evaluate, loadLibraries, log, warn, mintToken, wait,
        now: () => time, randomKey: () => `key-${++keys}`, sessionLimitMs, language, browserName: () => AGENT });
    return { bridge, store, safeStorage, yt, loadLibraries, fetch, evaluate, log, warn, mintToken, wait, advance: (ms: number) => { time += ms; } };
};

describe('YouTube Music desktop bridge', () => {
    it('answers only whitelisted operations with object parameters, before loading anything', async () => {
        const { bridge, loadLibraries } = setup();
        // The last five were operations of the device sign-in and of the TV client's explore page.
        for (const operation of ['fetch', 'constructor', '__proto__', 'liked_songs', '', 42, null, 'login_start', 'login_check', 'login_cancel', 'login_open', 'explore_more']) {
            expect(await bridge.request(operation, {})).toEqual({ ok: false, error: { code: 'unsupported', message: 'Unsupported YouTube Music operation' } });
        }
        for (const params of [null, [], 'x', 7]) {
            expect(await bridge.request('search_songs', params)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
        expect(loadLibraries).not.toHaveBeenCalled();
        expect(Object.isFrozen(YTM_OPERATIONS)).toBe(true);
    });

    it('asks for what is the account\'s only as a signed-in account, without creating a session', async () => {
        const { bridge, loadLibraries } = setup();
        for (const [operation, params] of [['user_playlists', {}], ['user_albums', {}], ['playlist', { id: 'LM' }], ['explore', {}],
            ['list_save', { id: ALBUM_LIST, saved: 'true' }], ['list_saved', { id: ALBUM_LIST }],
            ['playlist_edit', { id: 'PLfixture01', action: 'add', videoIds: VIDEO }], ['song_like', { id: VIDEO, liked: 'true' }]] as const) {
            expect(await bridge.request(operation, params)).toEqual({ ok: false, error: { code: 'auth-required', message: 'Sign in to YouTube Music' } });
        }
        expect(loadLibraries).not.toHaveBeenCalled();
    });

    it('looks at what a request names before it asks anything as the account', async () => {
        const { bridge, yt } = setup({ web: true });
        const refuses = async (operation: string, message: string, requests: unknown[]) => {
            for (const params of requests) expect(await bridge.request(operation, params)).toEqual({ ok: false, error: { code: 'invalid-response', message } });
        };
        await refuses('playlist', 'Invalid playlist id', [{ id: '../x' }, {}]);
        await refuses('playlist', 'Invalid page token', [{ id: 'LM', continuation: '' }, { id: 'LM', continuation: 7 }]);
        await refuses('explore', 'Invalid page token', [{ continuation: '' }, { continuation: 7 }, { continuation: 'x'.repeat(8193) }]);
        await refuses('list_save', 'Invalid list change', [{ id: ALBUM_LIST }, { id: ALBUM_LIST, saved: true }, { id: ALBUM_LIST, saved: 'yes' }, { id: 'OLAK5uy_/x', saved: 'true' }, { saved: 'true' }]);
        await refuses('list_saved', 'Invalid list id', [{ id: 'OLAK5uy_/x' }, { id: 'x' }, {}]);
        const many = Array.from({ length: 101 }, () => VIDEO).join(',');
        await refuses('playlist_edit', 'Invalid playlist change', [{ id: 'PLfixture01', action: 'add' }, { id: 'PLfixture01', action: 'add', videoIds: '' },
            { id: 'PLfixture01', action: 'add', videoIds: `${VIDEO},short` }, { id: 'PLfixture01', action: 'move', videoIds: VIDEO },
            { id: '../x', action: 'add', videoIds: VIDEO }, { id: 'PLfixture01', action: 'add', videoIds: many }]);
        expect(yt.created).toHaveLength(0);
    });

    it('stops waiting for a session that is slow to build, and uses it once it is there', async () => {
        const { bridge, yt } = setup({ sessionLimitMs: 20 });
        const build = yt.create.getMockImplementation()!;
        let finish!: () => void;
        yt.create.mockImplementationOnce(async (options: unknown) => {
            await new Promise<void>(resolve => { finish = resolve; });
            return build(options);
        });
        expect(await bridge.request('album', { id: 'MPREb_fixture' })).toMatchObject({ ok: false, error: { code: 'network' } });
        const next = bridge.request('album', { id: 'MPREb_fixture' });
        finish();
        await next;
        expect(yt.create).toHaveBeenCalledTimes(1);
        expect(yt.clients.guest.music.getAlbum).toHaveBeenCalledTimes(1);
    });

    it('starts a session over when a build never finishes', async () => {
        const { bridge, yt, advance } = setup({ sessionLimitMs: 20 });
        yt.create.mockReturnValueOnce(new Promise(() => {}));
        for (let attempt = 0; attempt < 2; attempt += 1) {
            expect(await bridge.request('album', { id: 'MPREb_fixture' })).toMatchObject({ ok: false, error: { code: 'network' } });
        }
        expect(yt.create).toHaveBeenCalledTimes(1);
        advance(3 * 60 * 1000 + 1);
        await bridge.request('album', { id: 'MPREb_fixture' });
        expect(yt.create).toHaveBeenCalledTimes(2);
        expect(yt.clients.guest.music.getAlbum).toHaveBeenCalledTimes(1);
    });

    it('searches and browses the public catalog on a session with no account attached', async () => {
        const row = (id: string) => ({ type: 'MusicResponsiveListItem', id, title: `Song ${id}`, artists: [{ name: 'Artist', channel_id: 'UCartist' }], duration: { seconds: 60 } });
        const { bridge, yt } = setup({ web: true, configure: client => {
            client.music.search.mockResolvedValue({ contents: [{ type: 'ItemSection' }, { type: 'MusicShelf', contents: [row(VIDEO), row('bad')], continuation: 'more-songs' }] });
        } });
        const searched = await bridge.request('search_songs', { query: '  yoasobi  ' });
        const guest = yt.clients.guest;
        expect(searched).toEqual({ ok: true, data: { continuation: 'more-songs', items: [expect.objectContaining({ id: VIDEO, name: `Song ${VIDEO}` })] } });
        expect(guest.music.search).toHaveBeenCalledWith('yoasobi', { type: 'song' });
        expect(guest.options).toMatchObject({ retrieve_player: false });
        expect(guest.options.cookie).toBeUndefined();

        guest.actions.execute.mockResolvedValueOnce({ continuation_contents: { contents: [row('ZRtdQ81jPUQ')] } });
        expect((await bridge.request('search_songs', { continuation: 'more-songs' })).data).toEqual({ items: [expect.objectContaining({ id: 'ZRtdQ81jPUQ' })] });
        expect(guest.actions.execute).toHaveBeenLastCalledWith('/search', { continuation: 'more-songs', client: 'YTMUSIC', parse: true });

        const entry = Object.assign(new yt.PlaylistPanelVideo(), { video_id: VIDEO, title: 'Song', artists: [{ name: 'Artist', channel_id: 'UCartist' }], album: { id: 'MPREb_album', name: 'Album' } });
        guest.actions.execute.mockResolvedValueOnce({ contents_memo: { getType: () => [Object.assign(new yt.PlaylistPanelVideo(), { video_id: 'ZRtdQ81jPUQ' }), entry] } });
        expect((await bridge.request('song_detail', { id: VIDEO })).data).toMatchObject({ id: VIDEO, album: { id: 'MPREb_album' }, artists: [{ id: 'UCartist' }] });
        guest.actions.execute.mockResolvedValueOnce({ contents_memo: { getType: () => [] } });
        expect(await bridge.request('song_detail', { id: VIDEO })).toEqual({ ok: true, data: null });

        guest.music.getAlbum.mockResolvedValue({ header: { title: 'Album' }, contents: [row(VIDEO)] });
        expect((await bridge.request('album', { id: 'MPREb_album' })).data).toMatchObject({ collection: { id: 'MPREb_album', type: 'album', trackCount: 1 }, items: [{ id: VIDEO }] });

        for (const [operation, params] of [['search_songs', { query: '   ' }], ['search_songs', { query: 'x'.repeat(201) }], ['song_detail', { id: 'nope' }],
            ['album', { id: 'OLAK5uy_x' }], ['artist', { id: 'MPREb_album' }]] as const) {
            expect(await bridge.request(operation, params)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
        // Somebody is signed in, and none of it was asked as the account.
        expect(Object.keys(yt.clients)).toEqual(['guest']);
    });

    it('reads a track\'s names in English or in Chinese with a request of its own, on no session', async () => {
        const { bridge, yt, fetch } = setup();
        const entry = Object.assign(new yt.PlaylistPanelVideo(), { video_id: VIDEO, title: 'Wonderwall', artists: [{ name: 'Oasis', channel_id: 'UCoasis' }], album: { id: 'MPREb_album', name: 'Album' } });
        yt.libraries.Parser.parseResponse.mockReturnValue({ contents_memo: { getType: () => [entry] } });
        fetch.mockResolvedValueOnce(json({ answer: 'raw' }));
        expect((await bridge.request('song_detail_en', { id: VIDEO })).data).toMatchObject({ id: VIDEO, artists: [{ id: 'UCoasis', name: 'Oasis' }] });
        const [address, request] = fetch.mock.calls[0];
        expect(address).toBe('https://music.youtube.com/youtubei/v1/next?prettyPrint=false');
        expect(request.method).toBe('POST');
        expect(JSON.parse(request.body)).toEqual({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250219', hl: 'en' } }, videoId: VIDEO });
        expect(yt.libraries.Parser.parseResponse).toHaveBeenCalledWith({ answer: 'raw' });
        fetch.mockResolvedValueOnce(json({}));
        await bridge.request('song_detail_zh', { id: VIDEO });
        expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20250219', hl: 'zh-CN' } }, videoId: VIDEO });
        // The sessions that name songs go on asking in the app's language: none was built or touched for this.
        expect(yt.create).not.toHaveBeenCalled();

        yt.libraries.Parser.parseResponse.mockReturnValue({ contents_memo: { getType: () => [] } });
        fetch.mockResolvedValueOnce(json({}));
        expect(await bridge.request('song_detail_en', { id: VIDEO })).toEqual({ ok: true, data: null });
        fetch.mockResolvedValueOnce(json({}, 500));
        expect(await bridge.request('song_detail_zh', { id: VIDEO })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        for (const operation of ['song_detail_en', 'song_detail_zh']) {
            expect(await bridge.request(operation, { id: 'nope' })).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
        expect(fetch).toHaveBeenCalledTimes(4);
    });

    it('follows an artist\'s full release list and falls back to the carousel when that fails', async () => {
        const card = (id: string) => ({ type: 'MusicTwoRowItem', item_type: 'album', id, title: id, year: '2024', artists: [], thumbnail: [] });
        const more = (call: unknown) => ({ more_content: { endpoint: { payload: { browseId: 'MPADUCartist' }, call } } });
        const full = vi.fn(async () => ({ contents_memo: { getType: () => [card('MPREb_1'), card('MPREb_2'), card('MPREb_3')] } }));
        const failing = vi.fn(async () => { throw new Error('boom'); });
        const { bridge, yt } = setup({ configure: client => {
            client.music.getArtist.mockResolvedValue({ header: { title: 'Artist' }, sections: [
                { type: 'MusicShelf', contents: [] },
                { type: 'MusicCarouselShelf', header: more(full), contents: [card('MPREb_1')] },
                { type: 'MusicCarouselShelf', header: more(failing), contents: [card('MPREb_2'), card('MPREb_9')] },
            ] });
        } });
        const result = await bridge.request('artist', { id: 'UCartist' });
        expect(result.data.albums.map((album: { id: string }) => album.id)).toEqual(['MPREb_1', 'MPREb_2', 'MPREb_3', 'MPREb_9']);
        expect(result.data).toMatchObject({ collection: { id: 'UCartist', type: 'artist', name: 'Artist' }, songs: [] });
        expect(result.data).not.toHaveProperty('albumShelves');
        expect(full).toHaveBeenCalledWith(yt.clients.guest.actions, { client: 'YTMUSIC', parse: true });
    });

    const playable = (formats: unknown[] = [audioFormat(251, 160_000)]) => ({
        playability_status: { status: 'OK' },
        streaming_data: { adaptive_formats: formats, server_abr_streaming_url: 'https://rr1.googlevideo.com/videoplayback?n=locked' },
        player_config: { media_common_config: { media_ustreamer_request_config: { video_playback_ustreamer_config: 'ustreamer' } } },
    });
    const refused = (reason: string, status = 'UNPLAYABLE') => ({ playability_status: { status, reason } });
    // Answers of the web player on its two sessions: the guest's (asked first) and the one of
    // the account of the web sign-in.
    const answers = (guest: unknown, account?: unknown) => (client: any) => {
        const answer = client.kind === 'member' ? account : guest;
        if (answer instanceof Error) client.getBasicInfo.mockRejectedValue(answer);
        else client.getBasicInfo.mockResolvedValue(answer);
    };

    // A format of the web player: its own address, locked until the player script has seen it.
    const addressed = (itag: number, bitrate: number, extra: Record<string, unknown> = {}) => ({
        ...audioFormat(itag, bitrate, extra), signature_cipher: 's=locked',
        decipher: vi.fn(async (_player: unknown) => `https://rr2.googlevideo.com/videoplayback?itag=${itag}&n=unlocked`),
    });
    const audioFile = (status = 206) => ({
        ok: status < 300, status,
        body: new ReadableStream({ start: controller => { controller.enqueue(new Uint8Array(1251)); controller.close(); } }),
    });

    it('issues a keyed stream URL as the web player with no account, and fetches the best original-language audio from its own address', async () => {
        const best = addressed(251, 160_000);
        const formats = [addressed(140, 130_000, { mime_type: 'audio/mp4; codecs="mp4a.40.2"' }), best,
            addressed(251, 170_000, { is_dubbed: true }), { itag: 18, bitrate: 900_000, has_audio: true, has_video: true, content_length: 9 }];
        const { bridge, yt, fetch, mintToken } = setup({ configure: answers(playable(formats)) });
        const issued = await bridge.request('audio', { id: VIDEO });
        expect(issued).toEqual({ ok: true, data: { url: `folia-ytm://audio/${VIDEO}/high?k=key-1`, route: 'web', itag: 251, bitrate: 160_000 } });
        expect(mintToken).toHaveBeenCalledWith(VIDEO);
        expect(yt.clients.player.options).toMatchObject({ retrieve_player: true });
        expect(yt.clients.player.getBasicInfo).toHaveBeenCalledWith(VIDEO, { client: 'YTMUSIC', po_token: `token-${VIDEO}` });
        expect(best.decipher).toHaveBeenCalledWith(yt.clients.player.session.player);
        expect(fetch).not.toHaveBeenCalled();

        fetch.mockResolvedValueOnce(audioFile());
        const response = await bridge.handleAudioRequest(new Request(issued.data.url));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('audio/webm');
        expect((await response.arrayBuffer()).byteLength).toBe(1251);
        expect(fetch).toHaveBeenCalledTimes(1);
        const [address, request] = fetch.mock.calls[0];
        expect(address).toBe(`https://rr2.googlevideo.com/videoplayback?itag=251&n=unlocked&pot=token-${VIDEO}`);
        expect(request.headers).toEqual({ Range: 'bytes=0-1250' });
        expect(yt.sabr).toHaveLength(0);
        expect((await bridge.handleAudioRequest(new Request(`folia-ytm://audio/${VIDEO}/high?k=guess`))).status).toBe(503);
    });

    it('picks the format for the quality level the renderer asks at, and names the level in the URL', async () => {
        const formats = [addressed(249, 48_000), addressed(250, 64_000), addressed(251, 130_000)];
        const { bridge, log } = setup({ configure: answers(playable(formats)) });
        expect((await bridge.request('audio', { id: VIDEO, quality: 'standard' })).data)
            .toEqual({ url: `folia-ytm://audio/${VIDEO}/standard?k=key-1`, route: 'web', itag: 250, bitrate: 64_000 });
        // (Any other word is the high level.)
        expect((await bridge.request('audio', { id: VIDEO, quality: 'lossless' })).data)
            .toEqual({ url: `folia-ytm://audio/${VIDEO}/high?k=key-2`, route: 'web', itag: 251, bitrate: 130_000 });
        expect(log.mock.calls.map(([line]) => String(line)).filter(line => line.includes('Plan for'))).toEqual([
            `[Ytm] Plan for ${VIDEO} at standard: the web route, itag 250 at 64 kbit/s, 0ms`,
            `[Ytm] Plan for ${VIDEO} at high: the web route, itag 251 at 130 kbit/s, 0ms`,
        ]);
    });

    it('asks for a long file in pieces, one after the other', async () => {
        const MiB = 1024 * 1024;
        const { bridge, fetch } = setup({ configure: answers(playable([addressed(251, 160_000, { content_length: 21 * MiB })])) });
        const issued = await bridge.request('audio', { id: VIDEO });
        const ranges: string[] = [];
        fetch.mockImplementation(async (_address: string, request: { headers: { Range: string } }) => {
            ranges.push(request.headers.Range);
            const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(request.headers.Range)!;
            const piece = new Uint8Array(Number(end) - Number(start) + 1).fill(ranges.length);
            return { ok: true, status: 206, body: new ReadableStream({ start: controller => { controller.enqueue(piece); controller.close(); } }) };
        });
        const file = new Uint8Array(await (await bridge.handleAudioRequest(new Request(issued.data.url))).arrayBuffer());
        expect(ranges).toEqual([`bytes=0-${10 * MiB - 1}`, `bytes=${10 * MiB}-${20 * MiB - 1}`, `bytes=${20 * MiB}-${21 * MiB - 1}`]);
        expect(file.length).toBe(21 * MiB);
        expect([file[0], file[10 * MiB - 1], file[10 * MiB], file[20 * MiB], file[21 * MiB - 1]]).toEqual([1, 1, 2, 3, 3]);
    });

    it('carries on from where a piece ended when it came shorter than asked, and fails on one that brings nothing', async () => {
        const MiB = 1024 * 1024;
        const piece = (length: number, value: number) => ({ ok: true, status: 206, body: new ReadableStream({ start: controller => {
            if (length > 0) controller.enqueue(new Uint8Array(length).fill(value));
            controller.close();
        } }) });
        const { bridge, fetch } = setup({ configure: answers(playable([addressed(251, 160_000, { content_length: 12 * MiB })])) });
        const ranges: string[] = [];
        fetch.mockImplementation(async (_address: string, request: { headers: { Range: string } }) => {
            ranges.push(request.headers.Range);
            const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(request.headers.Range)!;
            // The first answer stops 4 MiB in.
            return piece(ranges.length === 1 ? 4 * MiB : Number(end) - Number(start) + 1, ranges.length);
        });
        const issued = await bridge.request('audio', { id: VIDEO });
        const file = new Uint8Array(await (await bridge.handleAudioRequest(new Request(issued.data.url))).arrayBuffer());
        expect(ranges).toEqual([`bytes=0-${10 * MiB - 1}`, `bytes=${4 * MiB}-${12 * MiB - 1}`]);
        expect(file.length).toBe(12 * MiB);
        expect([file[0], file[4 * MiB - 1], file[4 * MiB], file[12 * MiB - 1]]).toEqual([1, 1, 2, 2]);

        const empty = setup({ configure: answers(playable([addressed(251, 160_000)])) });
        empty.fetch.mockImplementation(async () => piece(0, 0));
        const { data: { url } } = await empty.bridge.request('audio', { id: VIDEO });
        await expect((await empty.bridge.handleAudioRequest(new Request(url))).arrayBuffer()).rejects.toThrow();
        expect(empty.fetch).toHaveBeenCalledTimes(1);
    });

    it('keeps the account out of playback while the guest\'s player works', async () => {
        const { bridge, yt } = setup({ web: true, configure: answers(playable([addressed(251, 160_000)]), playable([addressed(251, 160_000)])) });
        expect(await bridge.request('audio', { id: VIDEO })).toMatchObject({ ok: true, data: { route: 'web' } });
        expect(yt.clients.player.getBasicInfo).toHaveBeenCalledTimes(1);
        expect(yt.clients.member).toBeUndefined();
    });

    it('reads the web player\'s stream by SABR, with the token, when its formats carry no address', async () => {
        const { bridge, yt, fetch } = setup({ configure: answers(playable([audioFormat(140, 130_000), audioFormat(251, 160_000)])) });
        const issued = await bridge.request('audio', { id: VIDEO });
        expect(yt.sabr).toHaveLength(0);
        expect((await (await bridge.handleAudioRequest(new Request(issued.data.url))).arrayBuffer()).byteLength).toBe(1251);
        expect(yt.sabr).toHaveLength(1);
        expect(yt.sabr[0].config).toMatchObject({
            fetch, serverAbrStreamingUrl: 'https://rr1.googlevideo.com/videoplayback?n=locked&deciphered=1',
            videoPlaybackUstreamerConfig: 'ustreamer', clientInfo: { clientName: 67, clientVersion: '1.20250219' },
            poToken: `token-${VIDEO}`,
        });
        expect(yt.sabr[0].started).toMatchObject({ audioFormat: { sabr: 251 }, enabledTrackTypes: 1 });
    });

    const ageGate = refused('Sign in to confirm your age', 'LOGIN_REQUIRED');

    it.each([
        ['is refused', ageGate],
        ['cannot be reached', new TypeError('fetch failed')],
    ])('plays as the account of the web sign-in, which needs no Premium for it, when the guest\'s player %s', async (_case, guest) => {
        const { bridge, yt, fetch } = setup({ web: true, configure: answers(guest, playable([addressed(251, 160_000)])) });
        const issued = await bridge.request('audio', { id: VIDEO });
        expect(issued.data).toEqual({ url: `folia-ytm://audio/${VIDEO}/high?k=key-1`, route: 'member', itag: 251, bitrate: 160_000 });
        // The account's player was asked after the guest's, on a session made for the cookies,
        // with a token minted as the guest's is.
        expect(yt.clients.player.getBasicInfo).toHaveBeenCalledTimes(1);
        expect(yt.clients.member.options).toMatchObject({ cookie: COOKIE, user_agent: AGENT, retrieve_player: true });
        expect(yt.clients.member.getBasicInfo.mock.calls).toEqual([[VIDEO, { client: 'YTMUSIC', po_token: `token-${VIDEO}` }]]);
        // The file comes from the format's own address, by the app's plain fetch, with a range and nothing else.
        fetch.mockResolvedValueOnce(audioFile());
        expect((await (await bridge.handleAudioRequest(new Request(issued.data.url))).arrayBuffer()).byteLength).toBe(1251);
        expect(fetch.mock.calls).toHaveLength(1);
        const [address, request] = fetch.mock.calls[0];
        expect(address).toBe(`https://rr2.googlevideo.com/videoplayback?itag=251&n=unlocked&pot=token-${VIDEO}`);
        expect(request.headers).toEqual({ Range: 'bytes=0-1250' });
    });

    it('asks the account first for a track whose download by the guest\'s plan broke, and the guest\'s player again when the account cannot take over', async () => {
        const breakFirstDownload = async ({ bridge, fetch }: ReturnType<typeof setup>) => {
            const first = await bridge.request('audio', { id: VIDEO });
            expect(first.data.route).toBe('web');
            fetch.mockResolvedValueOnce(audioFile(403));
            await expect((await bridge.handleAudioRequest(new Request(first.data.url))).arrayBuffer()).rejects.toThrow();
        };
        const taken = setup({ web: true, configure: answers(playable([addressed(251, 160_000)]), playable([addressed(251, 160_000)])) });
        await breakFirstDownload(taken);
        expect(taken.yt.clients.member).toBeUndefined();
        expect((await taken.bridge.request('audio', { id: VIDEO })).data).toMatchObject({ route: 'member' });
        expect(taken.yt.clients.player.getBasicInfo).toHaveBeenCalledTimes(1);

        const left = setup({ web: true, configure: answers(playable([addressed(251, 160_000)]), refused('This video is not available')) });
        await breakFirstDownload(left);
        expect((await left.bridge.request('audio', { id: VIDEO })).data).toMatchObject({ route: 'web' });
        expect(left.yt.clients.member.getBasicInfo).toHaveBeenCalledTimes(1);
        expect(left.yt.clients.player.getBasicInfo).toHaveBeenCalledTimes(2);
    });

    it('asks nothing as an account when nobody is signed in, not after a broken download either', async () => {
        const gated = setup({ configure: answers(ageGate, playable()) });
        expect(await gated.bridge.request('audio', { id: VIDEO })).toMatchObject({ ok: false, error: { code: 'not-playable' } });
        expect(Object.keys(gated.yt.clients)).toEqual(['player']);

        const { bridge, yt, fetch } = setup({ configure: answers(playable([addressed(251, 160_000)]), playable()) });
        const first = await bridge.request('audio', { id: VIDEO });
        fetch.mockResolvedValueOnce(audioFile(403));
        await expect((await bridge.handleAudioRequest(new Request(first.data.url))).arrayBuffer()).rejects.toThrow();
        yt.clients.player.getBasicInfo.mockRejectedValue(new TypeError('fetch failed'));
        expect(await bridge.request('audio', { id: VIDEO })).toMatchObject({ ok: false, error: { code: 'network' } });
        expect(Object.keys(yt.clients)).toEqual(['player']);
    });

    it.each([
        ['refuses the track', refused('This video is not available')],
        ['answers status 401', new Error('Request failed with status code 401')],
    ])('reports what the guest\'s player said when the account\'s %s as well, and keeps the sign-in', async (_case, account) => {
        const { bridge, store, yt } = setup({ web: true, configure: answers(new TypeError('fetch failed'), account) });
        expect(await bridge.request('audio', { id: VIDEO })).toMatchObject({ ok: false, error: { code: 'network' } });
        expect(yt.clients.member.getBasicInfo).toHaveBeenCalledTimes(1);
        expect(store.get(WEB_SESSION_KEY)).toBeDefined();
    });

    it('reports a request that ran out of time as a network failure', async () => {
        const { bridge, mintToken } = setup({ configure: answers(playable()) });
        for (const [message, name] of [['The operation was aborted due to timeout', 'TimeoutError'], ['This operation was aborted', 'AbortError']]) {
            mintToken.mockRejectedValue(new DOMException(message, name));
            expect(await bridge.request('audio', { id: VIDEO })).toMatchObject({ ok: false, error: { code: 'network' } });
        }
    });

    it('does not ask as the account when the listener signs out while the guest\'s player is asked', async () => {
        let release!: (answer: unknown) => void;
        const { bridge, yt } = setup({ web: true, configure: client => {
            if (client.kind === 'player') client.getBasicInfo.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
            else client.getBasicInfo.mockResolvedValue(playable([addressed(251, 160_000)]));
        } });
        const pending = bridge.request('audio', { id: VIDEO });
        await vi.waitFor(() => expect(yt.clients.player?.getBasicInfo).toHaveBeenCalled());
        await bridge.request('logout');
        release(ageGate);
        // Not "sign in again": the listener has just signed out.
        expect(await pending).toMatchObject({ ok: false, error: { code: 'not-playable' } });
        expect(yt.clients.member).toBeUndefined();
    });

    it('does not hand out a plan made as the account when the listener signed out while it was made', async () => {
        let release!: (answer: unknown) => void;
        const { bridge, yt } = setup({ web: true, configure: client => {
            if (client.kind === 'member') client.getBasicInfo.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
            else client.getBasicInfo.mockResolvedValue(ageGate);
        } });
        const pending = bridge.request('audio', { id: VIDEO });
        await vi.waitFor(() => expect(yt.clients.member?.getBasicInfo).toHaveBeenCalled());
        await bridge.request('logout');
        release(playable([addressed(251, 160_000)]));
        // The track is planned once more, for nobody, and a guest is refused it.
        expect(await pending).toMatchObject({ ok: false, error: { code: 'not-playable' } });
        expect(yt.clients.player.getBasicInfo).toHaveBeenCalledTimes(2);
        expect(yt.clients.member.getBasicInfo).toHaveBeenCalledTimes(1);
    });

    it('asks nothing as the account when the listener signs out while the session of its player is built', async () => {
        const { bridge, yt } = setup({ web: true, configure: answers(ageGate, playable([addressed(251, 160_000)])) });
        const { create } = yt.libraries.Innertube;
        let finish: (() => void) | undefined;
        yt.libraries.Innertube.create = vi.fn(async (options: any) => {
            if (options.cookie && options.retrieve_player) await new Promise<void>(resolve => { finish = resolve; });
            return create(options);
        });
        const pending = bridge.request('audio', { id: VIDEO });
        await vi.waitFor(() => expect(finish).toBeDefined());
        await bridge.request('logout');
        // The session comes up for a sign-in that is not stored any more.
        finish!();
        expect(await pending).toMatchObject({ ok: false, error: { code: 'not-playable' } });
        expect(yt.clients.member.getBasicInfo).not.toHaveBeenCalled();
    });

    it.each([
        // The renderer stops the queue on `region-restricted`; one blocked track is skipped instead.
        [refused('This video is not available in your country'), 'not-playable'],
        [ageGate, 'not-playable'],
        [{ playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: [] } }, 'not-playable'],
        // A removed or unknown video is an exception rather than a status.
        [new Error('This video is unavailable'), 'not-playable'],
        [new TypeError('fetch failed'), 'network'],
    ])('explains why a track cannot be played (%#)', async (answer, code) => {
        const { bridge, store } = setup({ web: true, configure: answers(answer, answer) });
        expect(await bridge.request('audio', { id: VIDEO })).toMatchObject({ ok: false, error: { code } });
        expect(store.get(WEB_SESSION_KEY)).toBeDefined();
    });

    it('tells a listener who is signed in what the account\'s player said, not the guest\'s "sign in"', async () => {
        const verdict = async (account: unknown, web = true) => (await setup({ web, configure: answers(ageGate, account) }).bridge.request('audio', { id: VIDEO })).error;
        expect(await verdict(refused('Confirm your age', 'AGE_CHECK_REQUIRED'))).toEqual({ code: 'not-playable', message: 'YouTube Music cannot play this track (AGE_CHECK_REQUIRED)' });
        expect(await verdict(new TypeError('fetch failed'))).toMatchObject({ code: 'network' });
        // The account's sign-in was not taken (401), or nobody is signed in: the guest's word stands.
        expect(await verdict(new Error('Request failed with status code 401'))).toEqual({ code: 'not-playable', message: 'YouTube Music cannot play this track (LOGIN_REQUIRED)' });
        expect(await verdict(undefined, false)).toEqual({ code: 'not-playable', message: 'YouTube Music cannot play this track (LOGIN_REQUIRED)' });
    });

    it('logs one line per plan: the route that made it, and what the route before it said', async () => {
        const guest = setup({ configure: answers(playable()) });
        await guest.bridge.request('audio', { id: VIDEO });
        expect(guest.log).toHaveBeenCalledWith('[Ytm] The player session is ready after 0ms');
        expect(guest.log.mock.calls.filter(([line]) => String(line).includes('Plan for'))).toEqual([[`[Ytm] Plan for ${VIDEO} at high: the web route, itag 251 at 160 kbit/s, 0ms`]]);

        // The account's route is named apart from the guest's, with the level it was asked at.
        const signedIn = setup({ web: true, configure: answers(ageGate, playable()) });
        await signedIn.bridge.request('audio', { id: VIDEO, quality: 'standard' });
        expect(signedIn.log).toHaveBeenCalledWith('[Ytm] The member session is ready after 0ms');
        expect(signedIn.log).toHaveBeenCalledWith(
            `[Ytm] Plan for ${VIDEO} at standard: the member route, itag 251 at 160 kbit/s, 0ms (web: not-playable (LOGIN_REQUIRED: Sign in to confirm your age))`);

        const refusedGuest = setup({ configure: answers(ageGate) });
        // The renderer's log gets YouTube's status word; the sentence stays in the main process.
        expect(await refusedGuest.bridge.request('audio', { id: VIDEO })).toEqual(
            { ok: false, error: { code: 'not-playable', message: 'YouTube Music cannot play this track (LOGIN_REQUIRED)' } });
        expect(refusedGuest.warn.mock.calls).toEqual([[
            `[Ytm] No plan for ${VIDEO} after 0ms (web: not-playable (LOGIN_REQUIRED: Sign in to confirm your age); member: nobody is signed in)`]]);

        // A failure of the network is told once, by the plan line.
        const offline = setup({ configure: answers(new TypeError('fetch failed')) });
        await offline.bridge.request('audio', { id: VIDEO });
        expect(offline.warn.mock.calls).toEqual([[`[Ytm] No plan for ${VIDEO} after 0ms (web: network (fetch failed); member: nobody is signed in)`]]);
    });

    it('keeps the words of a library exception in the log when the renderer gets a fixed sentence', async () => {
        const { bridge, warn } = setup({ configure: client => {
            client.music.search.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'contents')"));
        } });
        expect(await bridge.request('search_songs', { query: 'x' })).toEqual(
            { ok: false, error: { code: 'invalid-response', message: 'YouTube Music operation failed' } });
        expect(warn.mock.calls).toEqual([["[Ytm] search_songs failed: invalid-response (Cannot read properties of undefined (reading 'contents'))"]]);
        // An error the bridge worded itself needs no second line.
        expect((await bridge.request('song_detail', { id: 'not an id' })).ok).toBe(false);
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('says once that a session is slow to build, however many requests gave up waiting', async () => {
        const { bridge, yt, warn } = setup({ sessionLimitMs: 20 });
        yt.create.mockImplementation(() => new Promise(() => {}));
        const answers = await Promise.all([bridge.request('search_songs', { query: 'x' }), bridge.request('search_songs', { query: 'y' })]);
        expect(answers.map(answer => answer.error.code)).toEqual(['network', 'network']);
        expect(warn.mock.calls).toEqual([['[Ytm] The guest session is not ready 0ms after its build began; requests stop waiting for it']]);
    });

    it('keeps addresses, keys and the account out of every log line', async () => {
        const leaky = new Error('Request to https://music.youtube.com/youtubei/v1/player?key=AIzaSyFixturePrivate failed with ya29.fixture-private-access-token-0123456789abcdef');
        const { bridge, fetch, log, warn } = setup({ web: true, configure: answers(playable([addressed(251, 160_000)]), leaky) });
        const first = await bridge.request('audio', { id: VIDEO });
        fetch.mockResolvedValueOnce(audioFile(403));
        await expect((await bridge.handleAudioRequest(new Request(first.data.url))).arrayBuffer()).rejects.toThrow();
        // The account's player, asked first after the broken download, fails with a library exception.
        expect((await bridge.request('audio', { id: VIDEO })).ok).toBe(true);
        await bridge.request('logout');

        const lines = [...log.mock.calls, ...warn.mock.calls].map(call => call.join(' '));
        expect(lines).toContain(`[Ytm] Download of ${VIDEO} by the web route broke at 0 of 1251 bytes after 0ms: invalid-response (YouTube Music audio answered 403)`);
        expect(lines).toContain(`[Ytm] Plan for ${VIDEO} at high: the web route, itag 251 at 160 kbit/s, 0ms (after a broken web download; member: not-playable (Request to <address> failed with <long>))`);
        expect(lines).toContain('[Ytm] Signed out');
        for (const secret of ['http', 'googlevideo', 'key-', 'k=', 'token-', 'sapisid-private', 'sid-private', 'AIzaSy', 'ya29', 'Fixture', GAIA_ID]) {
            for (const line of lines) expect(line).not.toContain(secret);
        }
    });

    it('reads line-timed lyrics as the mobile app, without the account', async () => {
        const watchPage = (browseId?: string) => ({ data: { contents: { singleColumnMusicWatchNextResultsRenderer: { tabbedRenderer: {
            watchNextTabbedResultsRenderer: { tabs: [
                { tabRenderer: { title: 'Up next' } },
                { tabRenderer: browseId ? { endpoint: { browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: {
                    browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_TRACK_LYRICS' } } } } } : { unselectable: true } },
                { tabRenderer: { endpoint: { browseEndpoint: { browseId: 'MPTRt_related', browseEndpointContextSupportedConfigs: {
                    browseEndpointContextMusicConfig: { pageType: 'MUSIC_PAGE_TYPE_TRACK_RELATED' } } } } } },
            ] } } } } } });
        const cue = (lyricLine: string, start: number) => ({ lyricLine, cueRange: { startTimeMilliseconds: String(start), endTimeMilliseconds: String(start + 1000) } });
        const lyricsPage = (timedLyricsData: unknown) => ({ contents: { elementRenderer: { newElement: { type: { componentType: { model: {
            timedLyricsModel: { lyricsData: { timedLyricsData, sourceMessage: 'Source: Fixture' } } } } } } } } });

        const { bridge, yt, fetch } = setup();
        await bridge.request('search_songs', { query: 'x' });
        yt.clients.guest.actions.execute.mockResolvedValue(watchPage('MPLYt_fixture'));
        fetch.mockResolvedValueOnce(json(lyricsPage([cue('♪', 0), cue('first line', 880), cue(' two\nrows ', 61_500), cue('♪', 70_000), cue('last', 3_600_000)])));
        expect(await bridge.request('lyrics', { id: VIDEO })).toEqual({ ok: true, data: {
            mainText: '[00:00.880]first line\n[01:01.500]two rows\n[60:00.000]last',
        } });
        expect(yt.clients.guest.actions.execute).toHaveBeenLastCalledWith('/next', { videoId: VIDEO, client: 'YTMUSIC', parse: false });
        const [url, request] = fetch.mock.calls[0];
        expect(url).toBe('https://music.youtube.com/youtubei/v1/browse?prettyPrint=false');
        expect(JSON.parse(request.body)).toEqual({ context: { client: { clientName: 'ANDROID_MUSIC', clientVersion: '7.21.50' } }, browseId: 'MPLYt_fixture' });

        // Plain-text lyrics only, an instrumental, and a track with no lyrics tab all answer "none".
        fetch.mockResolvedValueOnce(json({ contents: { sectionListRenderer: { contents: [{ musicDescriptionShelfRenderer: {} }] } } }));
        expect(await bridge.request('lyrics', { id: VIDEO })).toEqual({ ok: true, data: null });
        fetch.mockResolvedValueOnce(json(lyricsPage([cue('♪', 0)])));
        expect(await bridge.request('lyrics', { id: VIDEO })).toEqual({ ok: true, data: null });
        yt.clients.guest.actions.execute.mockResolvedValue(watchPage());
        expect(await bridge.request('lyrics', { id: VIDEO })).toEqual({ ok: true, data: null });
        expect(fetch).toHaveBeenCalledTimes(3);

        yt.clients.guest.actions.execute.mockResolvedValue(watchPage('MPLYt_fixture'));
        fetch.mockResolvedValueOnce(json({}, 403));
        expect(await bridge.request('lyrics', { id: VIDEO })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(await bridge.request('lyrics', { id: '../x' })).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
    });

    it('runs player code only through the injected evaluator', async () => {
        const { bridge, yt, evaluate } = setup();
        await bridge.request('search_songs', { query: 'x' });
        evaluate.mockResolvedValue({ n: 'unlocked' });
        expect(await (yt.libraries.Platform.shim.eval as (data: unknown) => Promise<unknown>)({ output: 'return { n: transform("locked") };' })).toEqual({ n: 'unlocked' });
        expect(evaluate).toHaveBeenCalledWith('(() => { return { n: transform("locked") };\n })()');
    });

    it('asks for the pages that name songs in the app\'s language, and builds those sessions anew when it changes', async () => {
        let appLanguage = 'en';
        const { bridge, yt, log } = setup({ web: true, language: () => appLanguage, configure: client => {
            client.music.search.mockResolvedValue({ contents: [] });
            client.getBasicInfo.mockResolvedValue(playable([addressed(251, 160_000)]));
        } });
        const built = () => yt.create.mock.calls.map(([options]: any[]) => `${options.cookie ? 'web' : options.retrieve_player ? 'player' : 'guest'} ${options.lang}`);
        const ask = async () => {
            for (const [operation, params] of [['search_songs', { query: 'x' }], ['user_playlists', {}], ['audio', { id: VIDEO }]] as const) {
                expect(await bridge.request(operation, params)).toMatchObject({ ok: true });
            }
        };
        await ask();
        await ask();
        // The session that only plays names nothing, and asks in no language.
        expect(built()).toEqual(['guest en', 'web en', 'player undefined']);

        // `in` is the app's key for Indonesian, which YouTube calls `id`.
        appLanguage = 'in';
        await ask();
        expect(built().slice(3)).toEqual(['guest id', 'web id']);
        expect(log).toHaveBeenCalledWith('[Ytm] The web session (pages in id) is ready after 0ms');
        appLanguage = 'zh-CN';
        await ask();
        expect(built().slice(5)).toEqual(['guest zh-CN', 'web zh-CN']);
    });

    it('rebuilds a session that has aged past its player script', async () => {
        const { bridge, yt, advance } = setup({ configure: client => { client.music.search.mockResolvedValue({ contents: [] }); } });
        await bridge.request('search_songs', { query: 'x' });
        await bridge.request('search_songs', { query: 'x' });
        expect(yt.created).toHaveLength(1);
        advance(6 * 60 * 60 * 1000 + 1);
        await bridge.request('search_songs', { query: 'x' });
        expect(yt.created).toHaveLength(2);
    });
});

describe('what a log line says about a failure', () => {
    const { describeError, ytmError } = errorWords;
    it('gives the code, and the failure\'s own words without addresses and long tokens', () => {
        expect(describeError(new Error('Request to https://music.youtube.com/youtubei/v1/next?key=1 failed with status code 400')))
            .toBe('invalid-response (Request to <address> failed with status code 400)');
        expect(describeError(new Error('{"url":"https:\\/\\/rr3.googlevideo.com\\/videoplayback?sig=abc"}'))).toBe('invalid-response ({"url":"<address>)');
        expect(describeError(new Error(String.raw`a https:\\/\\/rr3.googlevideo.com\\/videoplayback?sig=abc`))).toBe('invalid-response (a <address>)');
    });

    // A file path names the computer's user, in a folder whose name may hold a space.
    it('leaves out file paths, of Windows and of a person\'s folder elsewhere', () => {
        for (const [words, left] of [
            [String.raw`EBUSY: resource busy or locked, rmdir 'C:\Users\Jo Private\AppData\Roaming\Folia\ytm-sign-in\Default'`, `EBUSY: resource busy or locked, rmdir '<path>'`],
            [String.raw`spawn C:\Users\Jo Private\AppData\Local\Google\Chrome\Application\chrome.exe ENOENT`, 'spawn <path> ENOENT'],
            [String.raw`EPERM: operation not permitted, open '\\server\share\Jo Private\notes.txt'`, `EPERM: operation not permitted, open '<path>'`],
            [String.raw`{"path":"c:\\Users\\private\\x"} was refused`, '{"path":"<path>"} was refused'],
            [`EACCES: permission denied, rmdir '/Users/jo/Library/Application Support/Folia/ytm-sign-in/Default'`, `EACCES: permission denied, rmdir '<path>'`],
            [`EACCES: permission denied, rmdir '/home/private/.config/Folia'`, `EACCES: permission denied, rmdir '<path>'`],
            ['a ratio of 3:/4 at 12:30', 'a ratio of 3:/4 at 12:30'],
        ]) {
            expect(describeError(new Error(words))).toBe(`invalid-response (${left})`);
        }
    });

    it('writes through the console as it is when a line is written, which the app replaces after the bridge is built', async () => {
        const bridge = createYtmApiBridge({ store: createStore(), safeStorage: cipher(), fetch: vi.fn(), evaluate: vi.fn(),
            loadLibraries: vi.fn(async () => { throw new Error('no library'); }) });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(await bridge.request('search_songs', { query: 'a' })).toMatchObject({ ok: false });
        expect(warn).toHaveBeenCalledWith('[Ytm] The guest session could not be built: invalid-response (no library)');
        warn.mockRestore();
        expect(describeError(new Error(`token ${'a1'.repeat(16)} refused`))).toBe('invalid-response (token <long> refused)');
        expect(describeError(new TypeError('fetch failed'))).toBe('network (fetch failed)');
        expect(describeError('plain text')).toBe('invalid-response (plain text)');
    });

    it('prefers what the other side said over the fixed sentence, and cuts a long text', () => {
        expect(describeError(ytmError('not-playable', 'Fixed sentence', 'UNPLAYABLE: gone'))).toBe('not-playable (UNPLAYABLE: gone)');
        expect(describeError(ytmError('unavailable', 'Fixed sentence'))).toBe('unavailable (Fixed sentence)');
        expect(describeError(new Error('word '.repeat(100)))).toHaveLength('invalid-response ()'.length + 160);
    });
});

describe('audio format choice', () => {
    it('prefers the highest bitrate among original, uncompressed-dynamics audio', () => {
        expect(pickAudioFormat([audioFormat(250, 70_000), audioFormat(251, 160_000), audioFormat(140, 130_000)]).itag).toBe(251);
        // The two formats of 'ultra' are that level's alone, while another format is offered.
        const member = [audioFormat(250, 70_000), audioFormat(251, 160_000), audioFormat(774, 256_000, { audio_quality: 'AUDIO_QUALITY_HIGH' }), audioFormat(141, 258_000, { audio_quality: 'AUDIO_QUALITY_HIGH' })];
        expect([pickAudioFormat(member).itag, pickAudioFormat(member, 'standard').itag, pickAudioFormat(member, 'ultra').itag]).toEqual([251, 250, 774]);
        expect(pickAudioFormat([audioFormat(774, 256_000)]).itag).toBe(774);
        expect(pickAudioFormat([audioFormat(251, 160_000, { is_drc: true }), audioFormat(140, 130_000)]).itag).toBe(140);
        expect(pickAudioFormat([audioFormat(251, 160_000, { audio_track: { audio_is_default: false } }), audioFormat(251, 150_000, { audio_track: { audio_is_default: true } })]).bitrate).toBe(150_000);
        // Only dubbed tracks exist: one of them still plays.
        expect(pickAudioFormat([audioFormat(251, 160_000, { is_dubbed: true })]).itag).toBe(251);
        expect(pickAudioFormat([{ itag: 18, has_audio: true, has_video: true, content_length: 5 }, audioFormat(251, 1, { content_length: 0 })])).toBeUndefined();
    });

    it('takes itag 250 for the standard level, and the best format for the high one', () => {
        // What a guest was offered for one public video (measured 2026-10-08).
        const [low, middle, best, aac] = [audioFormat(249, 48_000), audioFormat(250, 64_000), audioFormat(251, 130_000),
            audioFormat(140, 130_000, { mime_type: 'audio/mp4; codecs="mp4a.40.2"' })];
        const offered = [low, middle, best, aac];
        expect(pickAudioFormat(offered, 'standard').itag).toBe(250);
        expect(pickAudioFormat(offered, 'high').itag).toBe(251);
        expect(pickAudioFormat(offered).itag).toBe(251);
        // Without itag 250: the Opus format nearest 64 kbit/s, and Opus before a nearer format of another kind.
        expect(pickAudioFormat([low, best, aac], 'standard').itag).toBe(249);
        expect(pickAudioFormat([best, audioFormat(139, 60_000, { mime_type: 'audio/mp4; codecs="mp4a.40.5"' })], 'standard').itag).toBe(251);
        // Never a format under the floor while another is offered.
        expect(pickAudioFormat([audioFormat(600, 35_000), best], 'standard').itag).toBe(251);
        // A track offered in one format plays in that one at both levels.
        expect(pickAudioFormat([best], 'standard').itag).toBe(251);
        expect(pickAudioFormat([audioFormat(600, 35_000)], 'standard').itag).toBe(600);
        // The original track comes before the level: itag 250 of a loudness-compressed variant is not taken.
        expect(pickAudioFormat([audioFormat(250, 64_000, { is_drc: true }), best], 'standard').itag).toBe(251);
    });
});

describe('a device sign-in an earlier version of YouTube Music stored', () => {
    const seal = (value: unknown) => cipher().encryptString(JSON.stringify(value)).toString('base64');
    const deviceSignIn = { version: 1, user: storedUser,
        credentials: { access_token: 'access-private', refresh_token: 'refresh-private', expiry_date: '2099-01-01T00:00:00.000Z' } };
    const linesOf = ({ log, warn }: ReturnType<typeof setup>) => [...log.mock.calls, ...warn.mock.calls].map(call => call.join(' '));
    const saidOfIt = (context: ReturnType<typeof setup>) => linesOf(context).filter(line => line.includes('device sign-in'));

    it('is removed with the first request of a run, and its grant is given back to Google without the request waiting for that', async () => {
        const context = setup({ web: true });
        const { bridge, store, fetch } = context;
        store.set(SESSION_KEY, seal(deviceSignIn));
        // Google never answers.
        fetch.mockReturnValue(new Promise(() => {}));
        expect(await bridge.request('login_status')).toMatchObject({ ok: true, data: { nickname: 'Fixture' } });
        // The web sign-in stored beside it stays.
        expect([...store.values.keys()]).toEqual([WEB_SESSION_KEY]);
        expect(fetch).toHaveBeenCalledTimes(1);
        const [address, sent] = fetch.mock.calls[0];
        expect(String(address)).toBe('https://www.youtube.com/o/oauth2/revoke?token=refresh-private');
        expect(sent).toMatchObject({ method: 'POST' });
        // The request gives up by itself when Google stays silent.
        expect(sent.signal).toBeInstanceOf(AbortSignal);
        expect(saidOfIt(context)).toEqual(['[Ytm] A device sign-in of an earlier version was stored; it was removed, and its grant is given back to Google']);
        for (const line of linesOf(context)) expect(line).not.toMatch(/refresh-private|access-private/);
        // Once a run.
        await bridge.request('login_status');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['is damaged, or was sealed by another OS account', 'cannot-be-opened', true],
        ['names no grant', seal({ version: 1, user: storedUser, credentials: { access_token: 'access-private' } }), true],
        ['is met without OS encryption', seal(deviceSignIn), false],
        ['is no text', 7, true],
    ])('is removed without a word to Google when it %s', async (_case, stored, encrypts) => {
        const noEncryption: Record<string, unknown> = { isEncryptionAvailable: () => false };
        const context = setup({ safeStorage: encrypts ? cipher() : noEncryption });
        const { bridge, store, fetch } = context;
        store.set(SESSION_KEY, stored);
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
        expect(store.values.size).toBe(0);
        expect(fetch).not.toHaveBeenCalled();
        expect(saidOfIt(context)).toEqual(['[Ytm] A device sign-in of an earlier version was stored with no grant that could be read; it was removed, and nothing was given back to Google']);
        for (const line of linesOf(context)) expect(line).not.toContain('access-private');
    });

    it('leaves the store as it is where none is stored', async () => {
        const context = setup({ web: true });
        const { bridge, store, fetch } = context;
        const before = [...store.values];
        expect(await bridge.request('login_status')).toMatchObject({ ok: true, data: { nickname: 'Fixture' } });
        expect([...store.values]).toEqual(before);
        expect(fetch).not.toHaveBeenCalled();
        expect(saidOfIt(context)).toEqual([]);
    });
});

describe('the YouTube Music account id the renderer is told', () => {
    it('is stable and does not reveal Google\'s', () => {
        expect(publicAccountId(GAIA_ID)).toBe(publicAccountId(GAIA_ID));
        expect(publicAccountId(GAIA_ID)).toMatch(/^[a-f0-9]{24}$/);
        expect(publicAccountId(GAIA_ID)).not.toBe(publicAccountId('104000000000000000002'));
    });
});

describe('YouTube Music mixes and public playlists', () => {
    const MIX = 'RDEMfixturefixturefixture01';
    // A queue entry of `kind` (OMV: an official music video, ATV: a song), as the session of `nodes` reads it.
    const queuedAs = (nodes: any, id: string, kind: string) => Object.assign(new nodes.PlaylistPanelVideo(), {
        video_id: id, title: `Title ${id}`, artists: [{ name: 'Artist', channel_id: 'UCartist' }], album: { id: 'MPREb_x', name: 'Album' }, duration: { seconds: 141 }, thumbnail: [],
        endpoint: { payload: { watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: `MUSIC_VIDEO_TYPE_${kind}` } } } },
    });
    const queueOf = (nodes: any, entries: Array<[string, string]>) => ({ contents_memo: { getType: (type: unknown) => (
        type === nodes.PlaylistPanelVideo ? entries.map(([id, kind]) => queuedAs(nodes, id, kind)) : []) } });
    // The account's watch pages: each video asked about is paired with its song in `songs`.
    const pairing = (yt: any, songs: Record<string, string>) => yt.libraries.Parser.parseResponse.mockImplementation((data: any) => ({ contents_memo: { getType: (type: unknown) => (
        type === yt.PlaylistPanelVideoWrapper && data.videoId
            ? [{ primary: queuedAs(yt, data.videoId, 'OMV'), counterpart: songs[data.videoId] ? [queuedAs(yt, songs[data.videoId], 'ATV')] : [] }] : []) } }));

    it('answers a list after a short wait for the songs of its music videos, asks on for the rest, and plays a video shown as itself as its song', async () => {
        vi.useFakeTimers();
        try {
            const LATE = 'lateVideo01';
            const SONG = 'UNOtbkQxECI';
            const answers: Array<() => void> = [];
            const { bridge, yt, log } = setup({ web: true, configure: client => {
                if (client.kind === 'guest') client.actions.execute.mockImplementation(async () => queueOf(yt, [[LATE, 'OMV']]));
                if (client.kind !== 'web') return;
                client.actions.execute.mockImplementation(async (endpoint: string, body: any) => {
                    if (endpoint !== '/next') return { data: asTheAccount };
                    await new Promise<void>(resolve => { answers.push(resolve); });
                    return { data: { ...asTheAccount, videoId: body.videoId } };
                });
            } });
            pairing(yt, { [LATE]: SONG });
            const read = bridge.request('mix', { id: MIX });
            await vi.advanceTimersByTimeAsync(1500);
            expect((await read).data.items.map((song: any) => song.id)).toEqual([LATE]);
            expect(log).toHaveBeenCalledWith('[Ytm] 1 music video(s) in a list, 0 shown as their song; 1 not answered within 1500ms are shown as they are and asked on');
            // The ask goes on, and its answer is the next read's.
            answers.forEach(answer => answer());
            await vi.advanceTimersByTimeAsync(0);
            expect(log).toHaveBeenCalledWith('[Ytm] The 1 music video(s) a list showed as they are were asked on: 1 more have a song, shown from the next read');
            expect((await bridge.request('mix', { id: MIX })).data.items.map((song: any) => song.id)).toEqual([SONG]);
            expect(yt.clients.web.actions.execute.mock.calls.filter(([endpoint]: [string]) => endpoint === '/next')).toHaveLength(1);
            // The video the first read showed as itself is played as its song, in its place; a song as itself.
            expect((await bridge.request('played_as', { id: LATE })).data.song.id).toBe(SONG);
            expect((await bridge.request('played_as', { id: SONG })).data.song).toBeNull();
            expect(yt.clients.web.actions.execute.mock.calls.filter(([endpoint]: [string]) => endpoint === '/next')).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps one row of a song that pairing made stand twice, and leaves a video\'s own song out of its radio', async () => {
        const [VIDEO_ONE, VIDEO_TWO, SONG, OTHER, NEXT] = ['videoOne001', 'videoTwo001', 'UNOtbkQxECI', 'otherSong01', 'nextSong001'];
        const RADIO = `RDAMVM${VIDEO_ONE}`;
        const { bridge, yt } = setup({ web: true, configure: client => {
            if (client.kind === 'guest') client.actions.execute.mockImplementation(async (_endpoint: string, body: any) => queueOf(yt, body.playlistId === RADIO
                ? [[VIDEO_ONE, 'OMV'], [SONG, 'ATV'], [NEXT, 'ATV']]
                : [[VIDEO_ONE, 'OMV'], [OTHER, 'ATV'], [SONG, 'ATV'], [VIDEO_TWO, 'OMV'], [OTHER, 'ATV']]));
            if (client.kind === 'web') client.actions.execute.mockImplementation(async (_endpoint: string, body: any) => ({ data: { ...asTheAccount, videoId: body?.videoId } }));
        } });
        pairing(yt, { [VIDEO_ONE]: SONG, [VIDEO_TWO]: SONG });
        const ids = async (params: Record<string, string>) => (await bridge.request('mix', params)).data.items.map((song: any) => song.id);
        // Both videos are the song the list holds: one row of it, where the first stood. The list's own second row of a song stays.
        expect(await ids({ id: MIX })).toEqual([SONG, OTHER, OTHER]);
        // A radio asked with a video lists the video as itself and not its song.
        expect(await ids({ id: RADIO, videoId: VIDEO_ONE })).toEqual([VIDEO_ONE, NEXT]);
    });

    it('leaves a song shown for a video liked, and says so, when the video\'s like cannot be taken back', async () => {
        const [MUSIC_VIDEO, SONG] = ['GrAchTdepsU', 'UNOtbkQxECI'];
        const { bridge, yt } = setup({ web: true, configure: client => {
            if (client.kind === 'guest') client.actions.execute.mockImplementation(async () => queueOf(yt, [[MUSIC_VIDEO, 'OMV']]));
            if (client.kind !== 'web') return;
            client.actions.execute.mockImplementation(async (endpoint: string, body: any) => (
                // The video's like: an answer not marked as the account's, which is not taken for a change made.
                endpoint === '/like/removelike' && body.target.videoId === MUSIC_VIDEO ? { data: {} } : { data: { ...asTheAccount, videoId: body?.videoId } }));
        } });
        pairing(yt, { [MUSIC_VIDEO]: SONG });
        expect((await bridge.request('mix', { id: MIX })).data.items.map((song: any) => song.id)).toEqual([SONG]);
        expect(await bridge.request('song_like', { id: SONG, liked: 'false' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        const unliked = yt.clients.web.actions.execute.mock.calls.filter(([endpoint]: [string]) => endpoint === '/like/removelike');
        expect(unliked.map(([, body]: [string, any]) => body.target.videoId)).toEqual([MUSIC_VIDEO]);
    });

    it('reads a mix as the guest queue of its list id, with its first song where the card names one', async () => {
        const { bridge, yt, log } = setup({ web: true });
        const entry = Object.assign(new yt.PlaylistPanelVideo(), { video_id: VIDEO, title: 'Queued', artists: [{ name: 'Artist', channel_id: 'UCartist' }], album: { id: 'MPREb_x', name: 'Album' }, duration: { seconds: 61 }, thumbnail: [] });
        const answer = { contents_memo: { getType: (type: unknown) => (type === yt.PlaylistPanelVideo ? [entry, Object.assign(new yt.PlaylistPanelVideo(), { video_id: 'bad' })] : []) } };
        // An answer with no queue in it is an empty mix, not a failure.
        expect(await bridge.request('mix', { id: 'RDEMfixturefixturefixture01', videoId: VIDEO })).toEqual({ ok: true, data: { items: [] } });
        const guest = yt.clients.guest;
        guest.actions.execute.mockResolvedValue(answer);
        expect((await bridge.request('mix', { id: 'RDEMfixturefixturefixture01', videoId: VIDEO })).data).toEqual({ items: [
            { id: VIDEO, name: 'Queued', artists: [{ id: 'UCartist', name: 'Artist' }], album: { id: 'MPREb_x', name: 'Album', coverUrl: '' }, durationMs: 61000 },
        ] });
        expect(guest.actions.execute).toHaveBeenLastCalledWith('/next', { playlistId: 'RDEMfixturefixturefixture01', videoId: VIDEO, client: 'YTMUSIC', parse: true });
        expect(log).toHaveBeenLastCalledWith('[Ytm] Mix RDEMfixturefixturefixture01: 1 song(s)');
        await bridge.request('mix', { id: 'RDEMfixturefixturefixture01' });
        expect(guest.actions.execute).toHaveBeenLastCalledWith('/next', { playlistId: 'RDEMfixturefixturefixture01', client: 'YTMUSIC', parse: true });
        expect(Object.keys(yt.clients)).toEqual(['guest']);
        for (const params of [{}, { id: '../x' }, { id: 'RDEMfixture', videoId: 'short' }, { id: 'RDEMfixture', videoId: 7 }]) {
            expect(await bridge.request('mix', params)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
    });

    it('shows an official music video as the song YouTube pairs it with for the account, and takes a like back from both', async () => {
        const MUSIC_VIDEO = 'GrAchTdepsU';
        const SONG = 'UNOtbkQxECI';
        const queued = (id: string, kind: string, title: string) => Object.assign(new yt.PlaylistPanelVideo(), {
            video_id: id, title, artists: [{ name: 'Artist', channel_id: 'UCartist' }], album: { id: 'MPREb_x', name: 'Album' }, duration: { seconds: 141 }, thumbnail: [],
            endpoint: { payload: { watchEndpointMusicSupportedConfigs: { watchEndpointMusicConfig: { musicVideoType: `MUSIC_VIDEO_TYPE_${kind}` } } } },
        });
        // The guest's queue of a mix, as the session of `nodes` reads it.
        const mixOf = (nodes: any) => ({ contents_memo: { getType: (type: unknown) => (type === nodes.PlaylistPanelVideo ? [queued(MUSIC_VIDEO, 'OMV', 'Mood (Official Video)'), queued(VIDEO, 'ATV', 'Queued')] : []) } });
        // The account's watch page of the video holds the video and its song as a pair; its first
        // answer is given as to a guest, which holds none.
        let asGuest = true;
        const { bridge, yt, log } = setup({ web: true, configure: client => {
            if (client.kind === 'guest') client.actions.execute.mockImplementation(async () => mixOf(yt));
            if (client.kind !== 'web') return;
            client.actions.execute.mockImplementation(async (endpoint: string, body: any) => {
                if (endpoint !== '/next') return { data: asTheAccount };
                const answer = { data: asGuest ? asAGuest : { ...asTheAccount, videoId: body.videoId } };
                asGuest = false;
                return answer;
            });
        } });
        // The song's own watch page pairs it with the video the other way round: the song has no other song.
        const pairOf = (id: string) => (id === SONG
            ? { primary: queued(SONG, 'ATV', 'Mood'), counterpart: [queued(MUSIC_VIDEO, 'OMV', 'Mood (Official Video)')] }
            : { primary: queued(id, 'OMV', 'Mood (Official Video)'), counterpart: [queued(SONG, 'ATV', 'Mood')] });
        // A page whose queue does not hold the track asked about.
        const ELSEWHERE = 'elsewhere01';
        yt.libraries.Parser.parseResponse.mockImplementation((data: any) => ({ contents_memo: { getType: (type: unknown) => (type === yt.PlaylistPanelVideoWrapper && data.videoId && data.videoId !== ELSEWHERE
            ? [pairOf(data.videoId)] : []) } }));
        const songOf = (id: string, name: string) => ({ id, name, artists: [{ id: 'UCartist', name: 'Artist' }], album: { id: 'MPREb_x', name: 'Album', coverUrl: '' }, durationMs: 141000 });
        // Answered as to a guest, the video stays itself for that read only, said to be a video.
        expect((await bridge.request('mix', { id: 'RDEMfixturefixturefixture01' })).data).toEqual({ items: [{ ...songOf(MUSIC_VIDEO, 'Mood (Official Video)'), video: true }, songOf(VIDEO, 'Queued')] });
        expect((await bridge.request('mix', { id: 'RDEMfixturefixturefixture01' })).data).toEqual({ items: [songOf(SONG, 'Mood'), songOf(VIDEO, 'Queued')] });
        expect(log).toHaveBeenCalledWith('[Ytm] 1 music video(s) in a list, 1 shown as their song');
        // Asked once a run for each video.
        await bridge.request('mix', { id: 'RDEMfixturefixturefixture01' });
        expect(yt.clients.web.actions.execute.mock.calls.filter(([endpoint]: [string]) => endpoint === '/next')).toHaveLength(2);
        // The app's record of the songs played here asks with the tracks it holds; the pair is the one known.
        expect((await bridge.request('song_versions', { ids: MUSIC_VIDEO })).data).toEqual({ songs: { [MUSIC_VIDEO]: songOf(SONG, 'Mood') } });
        expect(yt.clients.web.actions.execute.mock.calls.filter(([endpoint]: [string]) => endpoint === '/next')).toHaveLength(2);
        expect((await bridge.request('song_versions', { ids: `${MUSIC_VIDEO},not an id` })).ok).toBe(false);
        // The song of a pair found is a song, with no other song of its own: it is answered with null and not asked about.
        expect((await bridge.request('song_versions', { ids: `${MUSIC_VIDEO},${SONG}` })).data).toEqual({ songs: { [MUSIC_VIDEO]: songOf(SONG, 'Mood'), [SONG]: null } });
        expect(log).toHaveBeenCalledWith('[Ytm] 2 recorded track(s) asked about (0 of them asked of YouTube): 1 shown as their song, 0 not answered');
        expect(yt.clients.web.actions.execute.mock.calls.filter(([endpoint]: [string]) => endpoint === '/next')).toHaveLength(2);
        // A track that could not be asked about is left out, and asked about again.
        const OTHER = 'otherVideo1';
        asGuest = true;
        expect((await bridge.request('song_versions', { ids: OTHER })).data).toEqual({ songs: {} });
        expect(log).toHaveBeenCalledWith('[Ytm] 1 recorded track(s) asked about (1 of them asked of YouTube): 0 shown as their song, 1 not answered');
        expect((await bridge.request('song_versions', { ids: OTHER })).data).toEqual({ songs: { [OTHER]: songOf(SONG, 'Mood') } });
        expect((await bridge.request('song_versions', { ids: ELSEWHERE })).data).toEqual({ songs: {} });

        expect(await bridge.request('song_like', { id: SONG, liked: 'false' })).toEqual({ ok: true, data: true });
        const unliked = yt.clients.web.actions.execute.mock.calls.filter(([endpoint]: [string]) => endpoint === '/like/removelike');
        expect(unliked.map(([, body]: [string, any]) => body.target.videoId)).toEqual([MUSIC_VIDEO, SONG]);

        // Nobody signed in: the video stays itself.
        const guestOnly = setup({ configure: client => { if (client.kind === 'guest') client.actions.execute.mockImplementation(async () => mixOf(guestOnly.yt)); } });
        expect((await guestOnly.bridge.request('mix', { id: 'RDEMfixturefixturefixture01' })).data).toEqual({ items: [{ ...songOf(MUSIC_VIDEO, 'Mood (Official Video)'), video: true }, songOf(VIDEO, 'Queued')] });
        expect(Object.keys(guestOnly.yt.clients)).toEqual(['guest']);
    });

    it('reads a public playlist as a guest of YouTube Music, a shelf first and then the rows each further page appends', async () => {
        const { bridge, yt } = setup({ web: true });
        const row = (id: string) => ({ type: 'MusicResponsiveListItem', id, title: `Song ${id}`, artists: [{ name: 'Artist', channel_id: 'UCartist' }], duration: { seconds: 60 } });
        const next =(token: unknown) => ({ type: 'ContinuationItem', endpoint: { payload: { token } } });
        const shelf = (contents: unknown[], continuation?: string) => ({ contents_memo: { getType: (type: unknown) => (type === yt.MusicPlaylistShelf ? [{ contents, continuation }] : []) } });
        // A playlist that is not public has no shelf: no rows, and no failure.
        expect(await bridge.request('public_playlist', { id: 'PLfixture01' })).toEqual({ ok: true, data: { items: [] } });
        const guest = yt.clients.guest;
        expect(guest.actions.execute).toHaveBeenLastCalledWith('/browse', { browseId: 'VLPLfixture01', client: 'YTMUSIC', parse: true });

        guest.actions.execute.mockResolvedValueOnce(shelf([row(VIDEO), row('bad'), next('more-rows')]));
        expect((await bridge.request('public_playlist', { id: 'PLfixture01' })).data).toEqual({
            continuation: 'more-rows',
            items: [{ id: VIDEO, name: `Song ${VIDEO}`, artists: [{ id: 'UCartist', name: 'Artist' }], album: { id: '', name: '', coverUrl: '' }, durationMs: 60000 }],
        });
        guest.actions.execute.mockResolvedValueOnce({ on_response_received_actions: [{ type: 'Other' }, { type: 'AppendContinuationItemsAction', contents: [row('ZRtdQ81jPUQ')] }] });
        expect((await bridge.request('public_playlist', { id: 'PLfixture01', continuation: 'more-rows' })).data).toEqual({ items: [expect.objectContaining({ id: 'ZRtdQ81jPUQ' })] });
        expect(guest.actions.execute).toHaveBeenLastCalledWith('/browse', { continuation: 'more-rows', client: 'YTMUSIC', parse: true });
        // The shelf's own field names the next page where no row does.
        guest.actions.execute.mockResolvedValueOnce(shelf([row(VIDEO)], 'shelf-token'));
        expect((await bridge.request('public_playlist', { id: 'PLfixture01' })).data).toMatchObject({ continuation: 'shelf-token' });
        // A token that is not a text names no further page.
        guest.actions.execute.mockResolvedValueOnce(shelf([row(VIDEO), next(7)]));
        expect((await bridge.request('public_playlist', { id: 'PLfixture01' })).data).not.toHaveProperty('continuation');

        // A further page with no rows is not the end of the list: its shape is not the one known here.
        guest.actions.execute.mockResolvedValueOnce(shelf([row(VIDEO)]));
        expect(await bridge.request('public_playlist', { id: 'PLfixture01', continuation: 'more-rows' })).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        const asked = guest.actions.execute.mock.calls.length;
        for (const params of [{}, { id: '../x' }, { id: 'PLfixture01', continuation: 7 }, { id: 'PLfixture01', continuation: 'x'.repeat(8193) }]) {
            expect(await bridge.request('public_playlist', params)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
        expect(guest.actions.execute).toHaveBeenCalledTimes(asked);
        // Nothing of it is asked as the account.
        expect(Object.keys(yt.clients)).toEqual(['guest']);
    });
});
