import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmUltra.test.ts — the quality level 'ultra' of YouTube Music (about
// 256 kbit/s, offered to a Premium member). On the desktop side, against stand-ins for
// youtubei.js, the browser and the keychain: which format it takes, which session asks for it
// and for whom, what a track is served and named as when it cannot be had at that level, how
// the account's Premium is read and stored, and where the account's headers may go. On the
// renderer side: when the level is listed, what a stored 'ultra' means to the other providers,
// what a kept copy of a song is labelled as, and when the note of the account is made and
// dropped. Every cookie, name, address and id in this file is made up, and so is the shape of
// the account menu around its icons (the reader looks at the icons only).

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/ytm/ytmTransport', () => ({
    requestYtm: request, getYtmTransportAvailability: () => ({ configured: true }),
}));
import { omni } from '@/services/onlineMusic/omni';
import { registerOnlineMusicProvider, unregisterOnlineMusicProvider } from '@/services/onlineMusic/providerRegistry';
import { noteYtmAccount } from '@/services/onlineMusic/ytm/ytmAccount';
import { normalizeYtmSong } from '@/services/onlineMusic/ytm/ytmNormalize';
import { ytmProvider } from '@/services/onlineMusic/ytm/ytmProvider';
import { resolveStoredAudioQuality } from '@/stores/useAudioSettingsStore';
import type { AudioQualityPreference, OnlineMusicProvider } from '@/types/onlineMusic';

const require = createRequire(import.meta.url);
const { createYtmApiBridge, pickAudioFormat } = require('../../../electron/ytm/ytmApiBridge.cjs');
const { publicAccountId } = require('../../../electron/ytm/session.cjs');
const { createYtmWebSessionRepository, WEB_SESSION_KEY } = require('../../../electron/ytm/webSignIn.cjs');
const webPages = require('../../../electron/ytm/webPages.cjs');

const VIDEO = 'm9SMT5ipbxk';
const OTHER_VIDEO = 'ZRtdQ81jPUQ';
const THIRD_VIDEO = 'AAAAAAAAAAA';
const FOURTH_VIDEO = 'BBBBBBBBBBB';
const GAIA_ID = '104000000000000000001';
const BROWSER = 'C:/Programs/Browser/browser.exe';
const FOLDER = 'X:/folia-fixture/ytm-sign-in';
const AGENT = 'Mozilla/5.0 (Test) Chrome/140.0.0.0 Safari/537.36';
const COOKIE = 'SAPISID=sapisid-private; SID=sid-private';
const cookies = [
    { name: 'SAPISID', value: 'sapisid-private', domain: '.youtube.com', path: '/' },
    { name: 'SID', value: 'sid-private', domain: '.youtube.com', path: '/' },
];
const user = { id: publicAccountId(GAIA_ID), nickname: 'Fixture', avatarUrl: 'https://yt3.ggpht.com/a', premium: false };
const SECRETS = ['sapisid-private', 'sid-private', 'fixture-private', 'Fixture', GAIA_ID, FOLDER, 'googlevideo', 'http', 'token-', 'k='];

const createStore = () => {
    const values = new Map<string, unknown>();
    return { values, get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
};
const cipher = () => ({ isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (data: Buffer) => Buffer.from(data.map(byte => byte ^ 0xa5)).toString() });
const unseal = (store: ReturnType<typeof createStore>) => JSON.parse(cipher().decryptString(Buffer.from(String(store.get(WEB_SESSION_KEY)), 'base64')));
// Lets everything that waits on nothing but other promises run.
const settled = () => new Promise(resolve => { setImmediate(resolve); });

// An answer of the web client, marked as given to a signed-in account ('1') or to nobody ('0').
const marked = (signedIn: string, body: Record<string, unknown> = {}) => ({
    responseContext: { serviceTrackingParams: [{ service: 'GFEEDBACK', params: [{ key: 'logged_in', value: signedIn }] }] },
    ...body,
});
const webAccounts = marked('1', { actions: [{ getMultiPageMenuAction: { menu: { multiPageMenuRenderer: { sections: [{ accountSectionListRenderer: {
    contents: [{ accountItemSectionRenderer: { contents: [{ accountItem: {
        accountName: { runs: [{ text: 'Fixture' }] }, isSelected: true, accountPhoto: { thumbnails: [{ url: 'https://yt3.ggpht.com/a' }] },
        accountByline: { runs: [{ text: 'fixture-private@example.test' }] },
        serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [{ accountStateToken: { obfuscatedGaiaId: GAIA_ID } }] } },
    } }] } }],
} }] } } } }] });
// The account menu: a list of entries, each with an icon.
const menuBody = (...icons: string[]) => ({ actions: [{ openPopupAction: { popup: { multiPageMenuRenderer: { sections: [{ multiPageMenuSectionRenderer: {
    items: icons.map(iconType => ({ compactLinkRenderer: { icon: { iconType }, title: { runs: [{ text: 'Entry' }] } } })),
} }] } } } }] });
const memberMenu = marked('1', menuBody('ACCOUNT_BOX', 'MONETIZATION_ON', 'SETTINGS'));
const nonMemberMenu = marked('1', menuBody('ACCOUNT_BOX', 'UNLIMITED', 'SETTINGS'));
const silentMenu = marked('1', menuBody('ACCOUNT_BOX', 'SETTINGS'));

const HIGH = { audio_quality: 'AUDIO_QUALITY_HIGH' };
const MEDIUM = { audio_quality: 'AUDIO_QUALITY_MEDIUM' };
const AAC = { mime_type: 'audio/mp4; codecs="mp4a.40.2"' };
// A format with an address of its own, locked until the player script has seen it. Its file is
// 1000 + itag bytes long.
const format = (itag: number, bitrate: number, extra: Record<string, unknown> = {}) => ({
    itag, bitrate, has_audio: true, has_video: false, content_length: 1000 + itag, mime_type: 'audio/webm; codecs="opus"', signature_cipher: 's=locked',
    decipher: vi.fn(async (_player: unknown) => `https://rr2.googlevideo.com/videoplayback?itag=${itag}&n=unlocked`), ...extra,
});
// What a guest is offered, and what a member is offered beside it (as measured 2026-10-09).
const guestFormats = () => [format(249, 48_000, { audio_quality: 'AUDIO_QUALITY_LOW' }), format(250, 64_000, { audio_quality: 'AUDIO_QUALITY_LOW' }),
    format(251, 130_000, MEDIUM), format(140, 129_000, { ...MEDIUM, ...AAC })];
const memberFormats = () => [...guestFormats(), format(141, 258_000, { ...HIGH, ...AAC }), format(774, 257_000, HIGH)];
const playable = (formats: unknown[]) => ({ playability_status: { status: 'OK' }, streaming_data: { adaptive_formats: formats } });
const refused = (reason: string, status = 'UNPLAYABLE') => ({ playability_status: { status, reason } });
const audioFile = (length: number) => ({
    ok: true, status: 206,
    body: new ReadableStream({ start: controller => { controller.enqueue(new Uint8Array(length)); controller.close(); } }),
});

// Each `Innertube.create` call yields one client. Its kind is told by what it was made with:
// `member` (the cookie and the player script), `web` (the cookie alone), `player` (a guest
// with the player script) or `guest`. `info(kind, videoId)` is a client's player answer, and
// `answer(kind, endpoint, body)` its answer to any other request; an Error is a request that
// fails with it.
const fakeYoutube = (info: (kind: string, videoId: string) => unknown, answer: (kind: string, endpoint: string, body: any) => unknown) => {
    const created: any[] = [];
    const given = (value: unknown) => { if (value instanceof Error) throw value; return value; };
    const create = vi.fn(async (options: any) => {
        const kind = options.cookie ? (options.retrieve_player ? 'member' : 'web') : options.retrieve_player ? 'player' : 'guest';
        const client = { kind, options, session: { player: { script: kind } },
            actions: { execute: vi.fn(async (endpoint: string, body: any) => ({ data: given(answer(kind, endpoint, body)) })) },
            getBasicInfo: vi.fn(async (videoId: string, _options: unknown) => given(info(kind, videoId))) };
        created.push(client);
        return client;
    });
    const libraries = { Innertube: { create },
        Constants: { CLIENT_NAME_IDS: { WEB_REMIX: '67' }, CLIENTS: { YTMUSIC: { NAME: 'WEB_REMIX', VERSION: '1.20250219' } } },
        Platform: { shim: {} as Record<string, unknown> }, Parser: { setParserErrorHandler: () => {} }, YTNodes: {},
        SabrStream: class {}, buildSabrFormat: (given: any) => given, EnabledTrackTypes: { AUDIO_ONLY: 1 } };
    return { created, libraries, of: (kind: string) => created.filter(client => client.kind === kind) };
};
// Stands in for browserSignIn.cjs: a sign-in window ends when the test ends it.
const fakeBrowser = () => {
    const state = { cookies: [] as unknown, windows: [] as Array<{ end: (outcome: string) => void }> };
    return Object.assign(state, {
        findBrowser: () => BROWSER,
        openSignIn: () => {
            let end!: (outcome: string) => void;
            const closed = new Promise<string>(resolve => { end = resolve; });
            state.windows.push({ end });
            return { closed, stop: () => {} };
        },
        readCookies: async () => state.cookies,
        removeProfile: async () => true,
    });
};

// `web` is the web sign-in a run before stored, with or without Premium. By default every
// client is offered what a guest is, the member session what a member is, and the account menu
// says nothing. `menu` is the account menu's
// answer, or what gives it each time it is asked; `accounts` likewise for the list of accounts.
// `clock.now` is the time, which a test moves.
const MINUTE = 60_000;
const setup = ({ web, info = (kind: string): unknown => playable(kind === 'member' ? memberFormats() : guestFormats()),
    menu = silentMenu as unknown, accounts = webAccounts as unknown }: {
    web?: 'member' | 'non-member'; info?: (kind: string, videoId: string) => unknown; menu?: unknown; accounts?: unknown } = {}) => {
    const store = createStore();
    const safeStorage = cipher();
    const clock = { now: 1_700_000_000_000 };
    if (web) createYtmWebSessionRepository({ store, safeStorage, now: () => clock.now - 3_600_000, log: vi.fn() }).set({ cookie: COOKIE, userAgent: AGENT, user: { ...user, premium: web === 'member' } });
    const said = (answer: unknown) => (typeof answer === 'function' ? answer() : answer);
    const yt = fakeYoutube(info, (_kind, endpoint) => (endpoint === '/account/accounts_list' ? said(accounts) : endpoint === '/account/account_menu' ? said(menu) : marked('1')));
    const browser = fakeBrowser();
    const [log, warn, fetch] = [vi.fn(), vi.fn(), vi.fn()];
    const mintToken = vi.fn(async (binding: string) => `token-${binding}`);
    let keys = 0;
    const bridge = createYtmApiBridge({ store, safeStorage, fetch, evaluate: vi.fn(), loadLibraries: async () => yt.libraries, log, warn,
        mintToken, now: () => clock.now, randomKey: () => `key-${++keys}`, browserSignIn: browser, browserName: () => AGENT, signInFolder: () => FOLDER });
    const lines = () => [...log.mock.calls, ...warn.mock.calls].map(call => call.join(' '));
    // How often the account menu was asked for, on whichever session.
    const menuReads = () => yt.of('web').flatMap(client => client.actions.execute.mock.calls).filter(([endpoint]) => endpoint === '/account/account_menu').length;
    return { bridge, store, yt, browser, log, warn, fetch, mintToken, lines, clock, menuReads };
};
const ultraUrl = (key: number, video = VIDEO) => `folia-ytm://audio/${video}/ultra?k=key-${key}`;
const highUrl = (key: number, video = VIDEO) => `folia-ytm://audio/${video}/high?k=key-${key}`;
// What a track asked at 'ultra' is answered with when it is served at 'high' by the guest web player.
const servedAtHigh = (key: number) => ({ ok: true, data: { url: highUrl(key), route: 'web', itag: 251, bitrate: 130_000, level: 'high' } });

describe('the format of the level ultra', () => {
    const opus = format(774, 257_000, HIGH);
    const aac = format(141, 258_000, { ...HIGH, ...AAC });

    it('is itag 774, then itag 141, and none where neither is offered', () => {
        expect(pickAudioFormat([...guestFormats(), aac, opus], 'ultra')).toBe(opus);
        expect(pickAudioFormat([...guestFormats(), aac], 'ultra')).toBe(aac);
        expect(pickAudioFormat(guestFormats(), 'ultra')).toBeUndefined();
        expect(pickAudioFormat([], 'ultra')).toBeUndefined();
    });

    it('is one marked as a member\'s, of the original track, and no other format stands in for it', () => {
        // The number alone is not the mark, and neither is a high bitrate.
        expect(pickAudioFormat([format(774, 257_000, MEDIUM), format(141, 258_000, AAC)], 'ultra')).toBeUndefined();
        expect(pickAudioFormat([format(251, 510_000, HIGH)], 'ultra')).toBeUndefined();
        // A dubbed copy is passed over while the original is offered.
        expect(pickAudioFormat([format(774, 257_000, { ...HIGH, is_dubbed: true }), aac], 'ultra')).toBe(aac);
        // The other levels pick as before among a member's formats and a guest's.
        expect(pickAudioFormat(guestFormats(), 'high').itag).toBe(251);
        expect(pickAudioFormat([...guestFormats(), aac, opus], 'standard').itag).toBe(250);
    });
});

describe('YouTube Music desktop bridge at the level ultra', () => {
    it('plays a member\'s track as the account of the web sign-in, and fetches the file without a header of the account', async () => {
        const { bridge, yt, fetch, mintToken, log, lines } = setup({ web: 'member' });
        const issued = await bridge.request('audio', { id: VIDEO, quality: 'ultra' });
        expect(issued).toEqual({ ok: true, data: { url: ultraUrl(1), route: 'member', itag: 774, bitrate: 257_000 } });
        expect(log).toHaveBeenCalledWith(`[Ytm] Plan for ${VIDEO} at ultra: the member route, itag 774 at 257 kbit/s, 0ms`);

        // The player request was made on a session of the account that has the player script.
        const [member] = yt.of('member');
        expect(member.options).toMatchObject({ cookie: COOKIE, user_agent: AGENT, retrieve_player: true });
        expect(mintToken).toHaveBeenCalledExactlyOnceWith(VIDEO);
        expect(member.getBasicInfo.mock.calls).toEqual([[VIDEO, { client: 'YTMUSIC', po_token: `token-${VIDEO}` }]]);
        const chosen = (await member.getBasicInfo.mock.results[0].value).streaming_data.adaptive_formats.at(-1);
        expect(chosen.decipher).toHaveBeenCalledExactlyOnceWith(member.session.player);
        // No other player was asked, and nothing was fetched before the bytes are asked for.
        expect(yt.of('player')).toHaveLength(0);
        expect(fetch).not.toHaveBeenCalled();

        // The file comes from the format's own address, by the app's plain fetch, with a range and nothing else.
        fetch.mockResolvedValueOnce(audioFile(1774));
        const response = await bridge.handleAudioRequest(new Request(issued.data.url));
        expect(response.status).toBe(200);
        expect((await response.arrayBuffer()).byteLength).toBe(1774);
        expect(fetch).toHaveBeenCalledTimes(1);
        const [address, sent] = fetch.mock.calls[0];
        expect(address).toBe(`https://rr2.googlevideo.com/videoplayback?itag=774&n=unlocked&pot=token-${VIDEO}`);
        expect(sent.headers).toEqual({ Range: 'bytes=0-1773' });

        // The session's own requests go through the guard: the account's headers leave towards
        // YouTube's two hosts and are taken off a request to any other, the audio servers among them.
        const account = { Cookie: COOKIE, Authorization: 'SAPISIDHASH sapisid-private', 'X-Goog-AuthUser': '0', 'X-Goog-PageId': 'page-private', Accept: '*/*' };
        for (const elsewhere of ['https://rr2.googlevideo.com/videoplayback?itag=774', 'https://www.google.com/x', 'https://youtube.com.example.test/youtubei/v1/player']) {
            await member.options.fetch(elsewhere, { headers: account });
            expect(Object.fromEntries(new Headers(fetch.mock.calls.at(-1)![1].headers).entries())).toEqual({ accept: '*/*' });
        }
        for (const youtube of ['https://www.youtube.com/youtubei/v1/player', 'https://music.youtube.com/youtubei/v1/player']) {
            await member.options.fetch(youtube, { headers: account });
            expect(fetch.mock.calls.at(-1)![1].headers).toBe(account);
        }

        // A second request for the track finds it planned; a request at 'high' is another file, by the guest player.
        expect((await bridge.request('audio', { id: VIDEO, quality: 'ultra' })).data.url).toBe(ultraUrl(2));
        expect(member.getBasicInfo).toHaveBeenCalledTimes(1);
        expect((await bridge.request('audio', { id: VIDEO, quality: 'high' })).data).toEqual({ url: highUrl(3), route: 'web', itag: 251, bitrate: 130_000 });
        expect(yt.of('player')[0].options.cookie).toBeUndefined();
        expect(member.getBasicInfo).toHaveBeenCalledTimes(1);

        for (const line of lines()) for (const secret of SECRETS) expect(line).not.toContain(secret);
        for (const secret of SECRETS.filter(word => word !== 'k=')) expect(JSON.stringify(issued)).not.toContain(secret);
    });

    it.each([
        ['nobody is signed in', {}, 'auth-required (Nobody is signed in to YouTube Music)'],
        ['the account of the web sign-in is not stored as a member', { web: 'non-member' as const }, 'unavailable (The YouTube Music account is not stored as having Premium)'],
    ])('serves and names a track "high" when %s, without a player request as the account', async (_case, signIn, why) => {
        const { bridge, yt, fetch, log, warn } = setup(signIn);
        const first = await bridge.request('audio', { id: VIDEO, quality: 'ultra' });
        expect(first).toEqual(servedAtHigh(1));
        expect(yt.of('member')).toHaveLength(0);
        expect(warn).toHaveBeenCalledWith(`[Ytm] No plan for ${VIDEO} at ultra after 0ms (member: ${why})`);
        expect(log).toHaveBeenCalledWith(`[Ytm] ${VIDEO} is served at high in place of ultra`);
        expect(log).toHaveBeenCalledWith(`[Ytm] Plan for ${VIDEO} at high: the web route, itag 251 at 130 kbit/s, 0ms`);

        // It is the 'high' track in everything: a request at 'high' finds it planned, its key does
        // not answer under the other level's address, and its bytes are the 'high' file's.
        expect((await bridge.request('audio', { id: VIDEO, quality: 'high' })).data).toEqual({ url: highUrl(2), route: 'web', itag: 251, bitrate: 130_000 });
        expect(yt.of('player')[0].getBasicInfo.mock.calls).toEqual([[VIDEO, { client: 'YTMUSIC', po_token: `token-${VIDEO}` }]]);
        expect((await bridge.handleAudioRequest(new Request(ultraUrl(1)))).status).toBe(503);
        fetch.mockResolvedValueOnce(audioFile(1251));
        expect((await (await bridge.handleAudioRequest(new Request(first.data.url))).arrayBuffer()).byteLength).toBe(1251);
        expect(fetch.mock.calls[0][0]).toContain('itag=251');
    });

    it.each([
        ['refuses the track', refused('This video is not available', 'UNPLAYABLE'), 'not-playable (UNPLAYABLE: This video is not available)'],
        ['cannot be reached', new TypeError('fetch failed'), 'network (fetch failed)'],
        ['answers status 401', new Error('Request failed with status code 401'), 'invalid-response (Request failed with status code 401)'],
    ])('serves a member\'s track at "high" when the member route %s, and the account stays a member', async (_case, answer, why) => {
        const { bridge, store, yt, warn } = setup({ web: 'member', info: kind => (kind === 'member' ? answer : playable(guestFormats())) });
        expect(await bridge.request('audio', { id: VIDEO, quality: 'ultra' })).toEqual(servedAtHigh(1));
        expect(yt.of('member')[0].getBasicInfo).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(`[Ytm] No plan for ${VIDEO} at ultra after 0ms (member: ${why})`);
        expect(unseal(store).user.premium).toBe(true);
        expect((await bridge.request('login_status')).data).toMatchObject({ vipType: 1 });
        // The next track is asked at its level again.
        await bridge.request('audio', { id: OTHER_VIDEO, quality: 'ultra' });
        expect(yt.of('member')[0].getBasicInfo).toHaveBeenCalledTimes(2);
    });

    it('serves a member\'s track that has no format of the level at "high": the account stays a member, and the track is not asked for as the account again while its plan stands', async () => {
        // The menu says member; one track is offered to the account without a member's format.
        const { bridge, store, yt, warn, clock, menuReads } = setup({ web: 'member', menu: memberMenu,
            info: (kind, videoId) => playable(kind === 'member' && videoId !== VIDEO ? memberFormats() : guestFormats()) });
        expect(await bridge.request('audio', { id: VIDEO, quality: 'ultra' })).toEqual(servedAtHigh(1));
        await settled();
        expect(warn).toHaveBeenCalledWith(`[Ytm] No plan for ${VIDEO} at ultra after 0ms (member: not-playable (YouTube Music offered no audio of the level ultra for this track))`);
        // The track does not decide whether the account has Premium: the sign-in is stored as it was.
        expect(unseal(store)).toEqual({ version: 1, cookie: COOKIE, userAgent: AGENT, user: { ...user, premium: true }, storedAt: 1_700_000_000_000 - 3_600_000 });
        expect((await bridge.request('login_status')).data).toMatchObject({ vipType: 1 });
        // So the next track is played as the account.
        expect((await bridge.request('audio', { id: OTHER_VIDEO, quality: 'ultra' })).data).toMatchObject({ url: ultraUrl(2, OTHER_VIDEO), route: 'member', itag: 774 });

        // The first one again: served from the 'high' plan it has, with no request as the account.
        const [member] = yt.of('member');
        const asked = () => member.getBasicInfo.mock.calls.map(([videoId]: [string]) => videoId);
        expect(await bridge.request('audio', { id: VIDEO, quality: 'ultra' })).toEqual(servedAtHigh(3));
        expect(asked()).toEqual([VIDEO, OTHER_VIDEO]);
        expect(yt.of('player')[0].getBasicInfo).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls.filter(([line]) => line.startsWith(`[Ytm] No plan for ${VIDEO}`))).toHaveLength(1);
        // That plan is not used after half an hour, and then the account is asked for the track again.
        clock.now += 31 * MINUTE;
        expect(await bridge.request('audio', { id: VIDEO, quality: 'ultra' })).toEqual(servedAtHigh(4));
        expect(asked()).toEqual([VIDEO, OTHER_VIDEO, VIDEO]);
        await settled();
        expect(menuReads()).toBe(2);
        expect(unseal(store).user.premium).toBe(true);
    });

    it('has the account menu read again when a member is offered a track without a format of the level, no sooner than five minutes after the read before, and stores what the menu says', async () => {
        // The membership ends after the menu was read: every track comes as to a non-member.
        let menu: unknown = memberMenu;
        const { bridge, store, yt, log, clock, menuReads } = setup({ web: 'member', menu: () => menu, info: () => playable(guestFormats()) });
        expect(await bridge.request('audio', { id: VIDEO, quality: 'ultra' })).toEqual(servedAtHigh(1));
        await settled();
        expect(menuReads()).toBe(1);
        expect(unseal(store).user.premium).toBe(true);

        menu = nonMemberMenu;
        clock.now += 4 * MINUTE;
        await bridge.request('audio', { id: OTHER_VIDEO, quality: 'ultra' });
        await settled();
        expect(menuReads()).toBe(1);
        expect(yt.of('member')[0].getBasicInfo).toHaveBeenCalledTimes(2);

        clock.now += MINUTE;
        await bridge.request('audio', { id: THIRD_VIDEO, quality: 'ultra' });
        await settled();
        expect(menuReads()).toBe(2);
        expect(log).toHaveBeenCalledWith('[Ytm] The account menu says Premium: no, which is stored in place of what was');
        expect(unseal(store).user.premium).toBe(false);
        expect((await bridge.request('login_status')).data).toMatchObject({ vipType: 0 });
        // From then on the account's cookies go with no player request.
        expect((await bridge.request('audio', { id: FOURTH_VIDEO, quality: 'ultra' })).data).toMatchObject({ route: 'web', itag: 251, level: 'high' });
        expect(yt.of('member')[0].getBasicInfo).toHaveBeenCalledTimes(3);
    });

    it('reads the account\'s Premium again with a later track when a read gave no answer, no sooner than five minutes later, and lets an answer stand for the run', async () => {
        let menu: unknown = new TypeError('fetch failed');
        const { bridge, store, log, clock, menuReads } = setup({ web: 'non-member', menu: () => menu });
        const track = async () => {
            await bridge.request('audio', { id: VIDEO, quality: 'high' });
            await settled();
            return menuReads();
        };
        expect(await track()).toBe(1);
        menu = silentMenu;
        clock.now += 4 * MINUTE;
        expect(await track()).toBe(1);
        clock.now += MINUTE;
        expect(await track()).toBe(2);
        expect(unseal(store).user.premium).toBe(false);

        // The menu answers: that is stored, and is not asked for again in the run.
        menu = memberMenu;
        clock.now += 5 * MINUTE;
        expect(await track()).toBe(3);
        expect(log).toHaveBeenCalledWith('[Ytm] The account menu says Premium: yes, which is stored in place of what was');
        expect((await bridge.request('login_status')).data).toMatchObject({ vipType: 1 });
        clock.now += 60 * MINUTE;
        expect(await track()).toBe(3);
    });

    it('reads the account menu for Premium: a member\'s, a non-member\'s, and one that does not say', () => {
        expect(webPages.premiumFromMenu(memberMenu)).toBe(true);
        expect(webPages.premiumFromMenu(nonMemberMenu)).toBe(false);
        // The offer to upgrade decides, whatever else the menu holds.
        expect(webPages.premiumFromMenu(menuBody('MONETIZATION_ON', 'UNLIMITED'))).toBe(false);
        expect(webPages.premiumFromMenu(silentMenu)).toBeUndefined();
        for (const nothing of [undefined, null, {}, [], 'UNLIMITED']) expect(webPages.premiumFromMenu(nothing)).toBeUndefined();
    });

    it('reads a stored account\'s Premium anew with the first track of a run, once, and says it at the next login_status', async () => {
        const { bridge, store, yt, log } = setup({ web: 'non-member', menu: memberMenu });
        // The status is answered from the store, without the network.
        expect((await bridge.request('login_status')).data).toMatchObject({ vipType: 0 });
        expect(yt.created).toHaveLength(0);

        expect((await bridge.request('audio', { id: VIDEO, quality: 'high' })).data).toEqual({ url: highUrl(1), route: 'web', itag: 251, bitrate: 130_000 });
        await settled();
        const [web] = yt.of('web');
        expect(web.options).toMatchObject({ cookie: COOKIE, retrieve_player: false });
        expect(web.actions.execute.mock.calls).toEqual([['/account/account_menu', { client: 'YTMUSIC', parse: false }]]);
        expect(log).toHaveBeenCalledWith('[Ytm] The account menu says Premium: yes, which is stored in place of what was');
        expect(unseal(store).user.premium).toBe(true);
        expect((await bridge.request('login_status')).data).toMatchObject({ vipType: 1 });
        // The track asked at 'high' was not played as the account.
        expect(yt.of('member')).toHaveLength(0);

        // No second read in this run; and the level is the account's from here on.
        expect((await bridge.request('audio', { id: OTHER_VIDEO, quality: 'ultra' })).data).toMatchObject({ url: ultraUrl(2, OTHER_VIDEO), route: 'member', itag: 774 });
        await settled();
        expect(web.actions.execute).toHaveBeenCalledTimes(1);
        expect(yt.of('web')).toHaveLength(1);
    });

    it('stores a membership that has ended, and leaves what is stored when the menu does not say or cannot be read', async () => {
        const ended = setup({ web: 'member', menu: nonMemberMenu });
        await ended.bridge.request('audio', { id: VIDEO, quality: 'high' });
        await settled();
        expect(ended.log).toHaveBeenCalledWith('[Ytm] The account menu says Premium: no, which is stored in place of what was');
        expect((await ended.bridge.request('login_status')).data).toMatchObject({ vipType: 0 });

        const unchanged = setup({ web: 'member', menu: memberMenu });
        await unchanged.bridge.request('audio', { id: VIDEO, quality: 'high' });
        await settled();
        expect(unchanged.log).toHaveBeenCalledWith('[Ytm] The account menu says Premium: yes');

        // A menu without either icon, one not marked as the account's, and a read that fails.
        for (const [menu, said] of [
            [silentMenu, '[Ytm] The account menu does not say whether the account has Premium; what is stored stays'],
            [menuBody('UNLIMITED'), '[Ytm] The account menu does not say whether the account has Premium; what is stored stays'],
            [marked('0', menuBody('UNLIMITED')), '[Ytm] Whether the account has Premium could not be read: unavailable (YouTube Music did not answer as the account)'],
            [new TypeError('fetch failed'), '[Ytm] Whether the account has Premium could not be read: network (fetch failed)'],
        ] as const) {
            const { bridge, store, yt, warn } = setup({ web: 'member', menu });
            await bridge.request('audio', { id: VIDEO, quality: 'high' });
            await settled();
            expect(warn).toHaveBeenCalledWith(said);
            expect(unseal(store).user.premium).toBe(true);
            expect((await bridge.request('login_status')).data).toMatchObject({ vipType: 1 });
            // Not asked again so soon.
            const asked = yt.of('web')[0].actions.execute.mock.calls.length;
            await bridge.request('audio', { id: OTHER_VIDEO, quality: 'high' });
            await settled();
            expect(yt.of('web')[0].actions.execute).toHaveBeenCalledTimes(asked);
        }
    });

    it('reads no account menu for a guest', async () => {
        const { bridge, yt } = setup();
        await bridge.request('audio', { id: VIDEO, quality: 'high' });
        await settled();
        expect(yt.created.map(client => client.kind)).toEqual(['player']);
    });

    it('tells the renderer a confirmed web sign-in with its account\'s Premium, read once', async () => {
        const { bridge, store, yt, browser, lines } = setup({ menu: memberMenu });
        await bridge.request('web_login_start');
        browser.cookies = cookies;
        browser.windows[0].end('closed');
        await settled();
        const account = { id: user.id, nickname: 'Fixture', avatarUrl: 'https://yt3.ggpht.com/a', vipType: 1 };
        expect(await bridge.request('web_login_check')).toEqual({ ok: true, data: { state: 'confirmed', account } });
        expect((await bridge.request('login_status')).data).toEqual(account);
        expect(unseal(store).user).toEqual({ ...user, premium: true });
        // The sign-in's own session asked who signed in; the menu was asked on the session requests use.
        expect(yt.created.map(client => [client.kind, client.actions.execute.mock.calls.map(([endpoint]: [string]) => endpoint)]))
            .toEqual([['web', ['/account/accounts_list']], ['web', ['/account/account_menu']]]);
        // Neither a further poll nor the first track reads it again.
        await bridge.request('web_login_check');
        expect((await bridge.request('audio', { id: VIDEO, quality: 'ultra' })).data).toMatchObject({ url: ultraUrl(1), route: 'member' });
        await settled();
        expect(yt.of('web')[1].actions.execute).toHaveBeenCalledTimes(1);
        for (const line of lines()) for (const secret of SECRETS) expect(line).not.toContain(secret);
    });

    it('hands out nothing planned as the account once it has signed out or another sign-in took its place', async () => {
        const signedOut = setup({ web: 'member' });
        const before = await signedOut.bridge.request('audio', { id: VIDEO, quality: 'ultra' });
        await signedOut.bridge.request('logout');
        expect((await signedOut.bridge.handleAudioRequest(new Request(before.data.url))).status).toBe(503);
        expect(await signedOut.bridge.request('audio', { id: VIDEO, quality: 'ultra' })).toEqual(servedAtHigh(2));
        expect(signedOut.yt.of('member')).toHaveLength(1);

        // A new web sign-in: the track is planned anew, on a session made for the cookies stored now.
        const { bridge, yt, browser } = setup({ web: 'member', menu: memberMenu });
        const old = await bridge.request('audio', { id: VIDEO, quality: 'ultra' });
        await bridge.request('web_login_start');
        browser.cookies = [{ ...cookies[0], value: 'sapisid-second' }];
        browser.windows[0].end('closed');
        await settled();
        expect((await bridge.request('web_login_check')).data).toMatchObject({ state: 'confirmed', account: { vipType: 1 } });
        expect((await bridge.handleAudioRequest(new Request(old.data.url))).status).toBe(503);
        expect((await bridge.request('audio', { id: VIDEO, quality: 'ultra' })).data).toMatchObject({ route: 'member', itag: 774 });
        expect(yt.of('member').map(client => client.options.cookie)).toEqual([COOKIE, 'SAPISID=sapisid-second']);
        expect(yt.of('member')[1].getBasicInfo).toHaveBeenCalledTimes(1);
    });

    it('leaves what a guest\'s route planned alone when the web sign-in is removed or another takes its place', async () => {
        // YouTube no longer takes the stored sign-in: the read of its Premium, begun with the
        // track, is answered as to a guest twice, and the sign-in is removed.
        const expired = setup({ web: 'non-member', menu: marked('0'), accounts: marked('0') });
        const issued = await expired.bridge.request('audio', { id: VIDEO, quality: 'high' });
        await settled();
        expect(expired.warn).toHaveBeenCalledWith('[Ytm] Google no longer accepts the stored web sign-in; it was removed');
        expect((await expired.bridge.request('login_status')).data).toBeNull();
        // The track was planned once, and the URL handed out for it still answers.
        expect(issued.data).toEqual({ url: highUrl(1), route: 'web', itag: 251, bitrate: 130_000 });
        expect(expired.yt.of('player')[0].getBasicInfo).toHaveBeenCalledTimes(1);
        expired.fetch.mockResolvedValueOnce(audioFile(1251));
        expect((await expired.bridge.handleAudioRequest(new Request(issued.data.url))).status).toBe(200);

        // A new web sign-in: the URL of the track planned as the account before is given up,
        // the URL of the one planned by the guest's route is not.
        const { bridge, yt, browser, fetch } = setup({ web: 'member', menu: memberMenu });
        const asAccount = await bridge.request('audio', { id: VIDEO, quality: 'ultra' });
        const asGuest = await bridge.request('audio', { id: VIDEO, quality: 'high' });
        await bridge.request('web_login_start');
        browser.cookies = [{ ...cookies[0], value: 'sapisid-second' }];
        browser.windows[0].end('closed');
        await settled();
        expect((await bridge.request('web_login_check')).data).toMatchObject({ state: 'confirmed' });
        expect((await bridge.handleAudioRequest(new Request(asAccount.data.url))).status).toBe(503);
        fetch.mockResolvedValueOnce(audioFile(1251));
        expect((await bridge.handleAudioRequest(new Request(asGuest.data.url))).status).toBe(200);
        expect((await bridge.request('audio', { id: VIDEO, quality: 'high' })).data).toMatchObject({ route: 'web', itag: 251 });
        expect(yt.of('player')[0].getBasicInfo).toHaveBeenCalledTimes(1);
    });
});

describe('YouTube Music adapter at the level ultra', () => {
    const song = normalizeYtmSong({ id: VIDEO, name: 'Song', artists: [{ id: '', name: 'Artist' }], album: { id: '', name: '', coverUrl: '' }, durationMs: 60000 });
    const LEVELS: AudioQualityPreference[] = ['standard', 'high', 'ultra', 'lossless', 'hires'];
    // The account as a `login_status` answer names it.
    const signedIn = async (vipType: number) => {
        request.mockResolvedValueOnce({ id: 'abc', nickname: 'Fixture', avatarUrl: 'a', vipType });
        await ytmProvider.auth!.getLoginStatus();
    };
    // A provider that lists no levels and serves the level under the one it is asked at.
    const unlisted: OnlineMusicProvider = {
        id: 'ultra-test-unlisted', displayName: 'Unlisted',
        capabilities: { search: false, playback: true, lyrics: false, auth: false, userLibrary: false, playlists: false, albums: false, artists: false,
            recommendations: false, mutations: false, wordByWordLyrics: false },
        normalizeSong: () => song,
        playback: {
            getSongDetail: async () => song,
            getAudioSource: async (_song, quality) => ({ url: `https://unlisted.test/${quality}`, fetchedAt: 1, quality: quality === 'lossless' ? 'high' : quality }),
        },
    };

    beforeEach(() => {
        request.mockReset();
        noteYtmAccount(null);
    });
    afterEach(() => {
        unregisterOnlineMusicProvider(unlisted.id);
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.resetModules();
    });

    it('lists the level only while the signed-in account has Premium', async () => {
        const levels = () => ytmProvider.playback!.audioQualityLevels;
        expect(levels()).toEqual(['standard', 'high']);
        await signedIn(0);
        expect(levels()).toEqual(['standard', 'high']);
        await signedIn(1);
        expect(levels()).toEqual(['standard', 'high', 'ultra']);
        expect(omni.getAudioQualityLevels('ytm')).toEqual(['standard', 'high', 'ultra']);
        // The level stands for itself and for the two above it; the two below are as before.
        expect(LEVELS.map(level => omni.resolveAudioQuality('ytm', level))).toEqual(['standard', 'high', 'ultra', 'ultra', 'ultra']);

        request.mockResolvedValueOnce(null);
        await ytmProvider.auth!.getLoginStatus();
        expect(levels()).toEqual(['standard', 'high']);
        await signedIn(1);
        await ytmProvider.auth!.logout();
        expect(levels()).toEqual(['standard', 'high']);
        expect(LEVELS.map(level => omni.resolveAudioQuality('ytm', level))).toEqual(['standard', 'high', 'high', 'high', 'high']);
    });

    it('notes the account of a confirmed browser sign-in from that answer, and nobody once a sign-out has answered', async () => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
        const levels = () => ytmProvider.playback!.audioQualityLevels;
        const member = { id: 'abc', nickname: 'Fixture', avatarUrl: 'a', vipType: 1 };
        const auth = ytmProvider.auth!;
        request.mockResolvedValueOnce({}).mockResolvedValueOnce({ state: 'waiting' }).mockResolvedValueOnce({ state: 'confirmed', account: member });
        const key = await auth.startLogin!();
        await auth.checkLogin!(key);
        expect(levels()).toEqual(['standard', 'high']);
        expect(await auth.checkLogin!(key)).toEqual({ state: 'confirmed' });
        expect(levels()).toEqual(['standard', 'high', 'ultra']);
        // The sign-in status was not asked for.
        expect(request.mock.calls).toEqual([['web_login_start'], ['web_login_check'], ['web_login_check']]);

        // A sign-in status asked for before a sign-out and answered during it is noted, and then
        // is nobody's: the sign-out notes nobody once more when it has answered.
        let answerStatus!: (account: unknown) => void;
        let answerLogout!: (done: unknown) => void;
        request.mockReturnValueOnce(new Promise(resolve => { answerStatus = resolve; })).mockReturnValueOnce(new Promise(resolve => { answerLogout = resolve; }));
        const status = auth.getLoginStatus();
        const signedOut = auth.logout();
        expect(levels()).toEqual(['standard', 'high']);
        answerStatus(member);
        await status;
        expect(levels()).toEqual(['standard', 'high', 'ultra']);
        answerLogout(true);
        await signedOut;
        expect(levels()).toEqual(['standard', 'high']);
    });

    it('means "high" to every provider that does not list it', () => {
        registerOnlineMusicProvider(unlisted);
        // One that lists no levels keeps the four it had, and one that lists two keeps its two.
        expect(omni.getAudioQualityLevels(unlisted.id)).toEqual(['standard', 'high', 'lossless', 'hires']);
        expect(LEVELS.map(level => omni.resolveAudioQuality(unlisted.id, level))).toEqual(['standard', 'high', 'high', 'lossless', 'hires']);
        expect(omni.getAudioQualityLevels('netease')).toEqual(['standard', 'high', 'lossless', 'hires']);
        expect(omni.resolveAudioQuality('netease', 'ultra')).toBe('high');
        expect(omni.getAudioQualityLevels('spotify')).toEqual(['standard', 'high']);
        expect(omni.resolveAudioQuality('spotify', 'ultra')).toBe('high');
        // The stored preference survives a restart as it is.
        expect(resolveStoredAudioQuality('ultra')).toBe('ultra');
    });

    it('hands back the level a song was served at, and a copy kept of it is labelled by that level', async () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        await signedIn(1);
        request.mockResolvedValueOnce({ url: `folia-ytm://audio/${VIDEO}/ultra?k=one`, route: 'member', itag: 774, bitrate: 257_000 })
            .mockResolvedValueOnce({ url: `folia-ytm://audio/${VIDEO}/high?k=two`, route: 'web', itag: 251, bitrate: 130_000, level: 'high' });

        const had = await omni.getAudioSource(song, 'ultra');
        expect(request).toHaveBeenLastCalledWith('audio', { id: VIDEO, quality: 'ultra' });
        expect(had).toMatchObject({ url: `folia-ytm://audio/${VIDEO}/ultra?k=one`, quality: 'ultra' });
        expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^\[Ytm\] Audio for "Song" \(m9SMT5ipbxk\) at ultra is ready by the member route \(itag 774, 257 kbit\/s\) after \d+ms$/));
        expect(omni.levelOfAudioSource(had!.url)).toBe('ultra');

        // The same song once more, under a stored preference above the level: it could not be had at 'ultra'.
        const lower = await omni.getAudioSource(song, 'hires');
        expect(request).toHaveBeenLastCalledWith('audio', { id: VIDEO, quality: 'ultra' });
        expect(lower).toMatchObject({ url: `folia-ytm://audio/${VIDEO}/high?k=two`, quality: 'high' });
        expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^\[Ytm\] Audio for "Song" \(m9SMT5ipbxk\) at ultra \(served at high\) is ready by the web route \(itag 251, 130 kbit\/s\) after \d+ms$/));
        // The media cache labels a copy by this: the 130 kbit/s file is kept as 'high', not as 'ultra'.
        expect(omni.levelOfAudioSource(lower!.url)).toBe('high');
    });

    it('goes on labelling a copy by the level asked for where the provider lists no levels', async () => {
        registerOnlineMusicProvider(unlisted);
        const other = { ...song, sourceRef: { kind: 'online' as const, providerId: unlisted.id, mediaId: '1' } };
        const source = await omni.getAudioSource(other, 'lossless');
        expect(source).toMatchObject({ url: 'https://unlisted.test/lossless', quality: 'high' });
        expect(omni.levelOfAudioSource(source!.url)).toBe('lossless');
    });

    it('knows the account from the last run before the sign-in status is read', async () => {
        const kept = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => { kept.set(key, String(value)); }, removeItem: (key: string) => { kept.delete(key); },
        });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        // One run: the sign-in status is read, and the fact is kept.
        vi.resetModules();
        const lastRun = await import('@/services/onlineMusic/ytm/ytmAccount');
        expect(lastRun.ytmHasPremium()).toBe(false);
        lastRun.noteYtmAccount({ id: 'abc', nickname: 'Fixture', vipType: 1 });
        expect([...kept]).toEqual([['folia_ytm_account', '{"premium":true}']]);

        // The next run, before anything was asked of the desktop side: the level is listed at once.
        vi.resetModules();
        request.mockClear();
        const { ytmProvider: restarted } = await import('@/services/onlineMusic/ytm/ytmProvider');
        expect(restarted.playback!.audioQualityLevels).toEqual(['standard', 'high', 'ultra']);
        expect(request).not.toHaveBeenCalled();
        // What the sign-in status then says replaces it, and nobody signed in leaves nothing kept.
        request.mockResolvedValueOnce({ id: 'abc', nickname: 'Fixture', avatarUrl: 'a', vipType: 0 }).mockResolvedValueOnce(null);
        await restarted.auth!.getLoginStatus();
        expect(restarted.playback!.audioQualityLevels).toEqual(['standard', 'high']);
        expect(kept.get('folia_ytm_account')).toBe('{"premium":false}');
        await restarted.auth!.getLoginStatus();
        expect(kept.size).toBe(0);

        const keptAs = async (note: string) => {
            kept.set('folia_ytm_account', note);
            vi.resetModules();
            return (await import('@/services/onlineMusic/ytm/ytmAccount')).ytmHasPremium();
        };
        // A note from when the app had two sign-ins names its own: the browser one's still stands,
        // the one of the device sign-in, which is gone, is nobody's.
        expect(await keptAs('{"signIn":"web","premium":true}')).toBe(true);
        expect(await keptAs('{"signIn":"tv","premium":true}')).toBe(false);
        // Anything else found there is nobody.
        for (const damaged of ['not json', '{"premium":"yes"}', '[]', 'null']) expect(await keptAs(damaged)).toBe(false);
    });
});
