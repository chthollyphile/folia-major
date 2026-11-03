import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmWebSignIn.test.ts — the web sign-in of YouTube Music against stand-ins for the
// browser, youtubei.js and the keychain: how it is stored, how a sign-in goes and ends, where the
// account's headers may go, what an operation asks as the account, and when a sign-in is
// removed. Every cookie, name, address and id in this file is made up.

const require = createRequire(import.meta.url);
const { createYtmApiBridge, YTM_OPERATIONS } = require('../../../electron/ytm/ytmApiBridge.cjs');
const { publicAccountId } = require('../../../electron/ytm/session.cjs');
const { createYtmWebSessionRepository, createYtmWebSignIn, desktopChromeName, guardAccountHeaders, WEB_SESSION_KEY } = require('../../../electron/ytm/webSignIn.cjs');
const { BrowserSignInError } = require('../../../electron/ytm/browserSignIn.cjs');
const { toErrorResult } = require('../../../electron/ytm/errors.cjs');
const webPages = require('../../../electron/ytm/webPages.cjs');

const VIDEO = 'm9SMT5ipbxk';
const GAIA_ID = '104000000000000000001';
const BROWSER = 'C:/Programs/Browser/browser.exe';
const FOLDER = 'X:/folia-fixture/ytm-sign-in';
const AGENT = 'Mozilla/5.0 (Test) Chrome/140.0.0.0 Safari/537.36';
const ALBUM_LIST = 'OLAK5uy_fixturefixturefixturefixturefixture01';
const COOKIE = 'SAPISID=sapisid-private; SID=sid-private';
const cookies = [
    { name: 'SAPISID', value: 'sapisid-private', domain: '.youtube.com', path: '/' },
    { name: 'SID', value: 'sid-private', domain: '.youtube.com', path: '/' },
];
const user = { id: publicAccountId(GAIA_ID), nickname: 'Fixture', avatarUrl: 'https://yt3.ggpht.com/a', premium: false };
const SECRETS = ['sapisid-private', 'sid-private', 'fixture-private', GAIA_ID, FOLDER];

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
    responseContext: { serviceTrackingParams: [
        { service: 'CSI', params: [{ key: 'c', value: 'WEB_REMIX' }, { key: 'yt_li', value: signedIn }] },
        { service: 'GFEEDBACK', params: [{ key: 'browse_id', value: 'fixture' }, { key: 'logged_in', value: signedIn }] },
    ] },
    ...body,
});
const accountItem = (name: string, extra: Record<string, unknown> = {}) => ({ accountItem: { accountName: { runs: [{ text: name }] }, isSelected: false, ...extra } });
const accountsList = (items: unknown[]) => ({ actions: [{ getMultiPageMenuAction: { menu: { multiPageMenuRenderer: { sections: [{ accountSectionListRenderer: {
    contents: [{ accountItemSectionRenderer: { contents: items } }],
    header: { googleAccountHeaderRenderer: { name: { runs: [{ text: 'Fixture' }] }, email: { runs: [{ text: 'fixture-private@example.test' }] } } },
} }] } } } }] });
const webAccounts = marked('1', accountsList([
    accountItem('Other'),
    accountItem('Fixture', {
        isSelected: true, hasChannel: true,
        accountPhoto: { thumbnails: [{ url: 'https://yt3.ggpht.com/a', width: 88, height: 88 }] },
        accountByline: { runs: [{ text: 'fixture-private@example.test' }] }, channelHandle: { runs: [{ text: '@fixture-private' }] },
        serviceEndpoint: { selectActiveIdentityEndpoint: { supportedTokens: [{ offlineCacheKeyToken: {} }, { accountStateToken: { obfuscatedGaiaId: GAIA_ID } }] } },
    }),
]));

const link = (browseId: string, pageType: string) => ({ browseEndpoint: { browseId, browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType } } } });
const art = (name: string) => ({ musicThumbnailRenderer: { thumbnail: { thumbnails: [
    { url: `https://lh3.googleusercontent.com/${name}=w226-h226`, width: 226, height: 226 }, { url: `https://lh3.googleusercontent.com/${name}=w544-h544`, width: 544, height: 544 },
] } } });
const coverOf = (name: string) => `https://lh3.googleusercontent.com/${name}=w544-h544`;
const plays = (playlistId: string) => ({ menuNavigationItemRenderer: { navigationEndpoint: { watchPlaylistEndpoint: { playlistId } } } });
const playlistRow = (id: string, title: string, subtitle: unknown[], menuItems: unknown[] = [plays(id)]) => ({ musicTwoRowItemRenderer: {
    thumbnailRenderer: art(id), title: { runs: [{ text: title, navigationEndpoint: link(`VL${id}`, 'MUSIC_PAGE_TYPE_PLAYLIST') }] },
    subtitle: { runs: subtitle }, navigationEndpoint: link(`VL${id}`, 'MUSIC_PAGE_TYPE_PLAYLIST'), menu: { menuRenderer: { items: menuItems } },
} });
const albumRow = (id: string, title: string, subtitle: unknown[], listId?: string) => ({ musicTwoRowItemRenderer: {
    thumbnailRenderer: art(id), title: { runs: [{ text: title, navigationEndpoint: link(id, 'MUSIC_PAGE_TYPE_ALBUM') }] },
    subtitle: { runs: subtitle }, navigationEndpoint: link(id, 'MUSIC_PAGE_TYPE_ALBUM'), menu: { menuRenderer: { items: [] } },
    ...(listId ? { thumbnailOverlay: { musicItemThumbnailOverlayRenderer: { content: { musicPlayButtonRenderer: { playNavigationEndpoint: { watchPlaylistEndpoint: { playlistId: listId } } } } } } } : {}),
} });
// The tile the playlists tab begins with: it opens a dialog and has no menu.
const newPlaylistTile = { musicTwoRowItemRenderer: { thumbnailRenderer: art('new'), title: { runs: [{ text: 'New playlist' }] }, subtitle: { runs: [] }, navigationEndpoint: { createPlaylistEndpoint: {} } } };
const ownMenu = (id: string) => [plays(id), { menuNavigationItemRenderer: { navigationEndpoint: { playlistEditorEndpoint: { playlistId: id } } } },
    { menuNavigationItemRenderer: { navigationEndpoint: { confirmDialogEndpoint: { content: { confirmDialogRenderer: { confirmButton: { buttonRenderer: { serviceEndpoint: { deletePlaylistEndpoint: { playlistId: id } } } } } } } } } }];
const artistRun = (id: string, name: string) => ({ text: name, navigationEndpoint: link(id, 'MUSIC_PAGE_TYPE_ARTIST') });
// A library tab: its grid under the sort and filter chips, which carry tokens of their own.
const gridPage = (items: unknown[], next?: string) => marked('1', { contents: { singleColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { sectionListRenderer: {
    header: { musicSideAlignedItemRenderer: { startItems: [{ chipCloudRenderer: { chips: [{ chipCloudChipRenderer: {
        navigationEndpoint: { browseSectionListReloadEndpoint: { continuation: { reloadContinuationData: { continuation: 'reload-chip' } } } },
    } }] } }] } },
    contents: [{ gridRenderer: { items, ...(next ? { continuations: [{ nextContinuationData: { continuation: next } }] } : {}) } }],
} } } }] } } });
const playlistsTab = [
    newPlaylistTile,
    playlistRow('LM', 'Liked Music', [{ text: 'Auto playlist' }]),
    playlistRow('PLown01', 'Mine', [{ text: 'Fixture 2 Go', navigationEndpoint: link('UCowner', 'MUSIC_PAGE_TYPE_USER_CHANNEL') }, { text: ' • ' }, { text: '1,204 songs' }], ownMenu('PLown01')),
    playlistRow('PLsaved01', '别人的歌单', [{ text: 'Somebody' }, { text: ' • ' }, { text: '12 首歌曲' }]),
    albumRow('MPREb_fixture01', 'An album', [{ text: 'Album' }, { text: ' • ' }, artistRun('UCartist01', 'The 1975')], ALBUM_LIST),
];

// Stands in for browserSignIn.cjs. `folder` is whether the sign-in folder is on disk: a browser
// started on it makes it, and removing it takes it away unless a browser `holds` it. `ends` is
// whether a browser an earlier run left on the folder could be ended. A window ends when the
// test ends it.
const fakeBrowser = (found: string | null = BROWSER) => {
    const state = { folder: false, holds: false, ends: true, cookies: [] as unknown, windows: [] as Array<{ end: (outcome: string) => void; stop: ReturnType<typeof vi.fn> }> };
    return Object.assign(state, {
        endLeftBrowsers: vi.fn(async (_dir: string) => state.ends),
        findBrowser: vi.fn(() => found),
        openSignIn: vi.fn((_browser: string, _dir: string) => {
            state.folder = true;
            let end!: (outcome: string) => void;
            const closed = new Promise<string>(resolve => { end = resolve; });
            const stop = vi.fn();
            state.windows.push({ end, stop });
            return { closed, stop };
        }),
        readCookies: vi.fn(async (_browser: string, _dir: string) => {
            if (state.cookies instanceof Error) throw state.cookies;
            return state.cookies;
        }),
        removeProfile: vi.fn(async (_dir: string) => {
            if (!state.holds) state.folder = false;
            return !state.holds;
        }),
    });
};

afterEach(() => { vi.useRealTimers(); });

describe('YouTube Music stored web sign-in', () => {
    it('is sealed and read back by a later run', () => {
        const store = createStore();
        const safeStorage = cipher();
        const [log, warn] = [vi.fn(), vi.fn()];
        const repo = createYtmWebSessionRepository({ store, safeStorage, now: () => 5000, log, warn });
        expect(repo.get()).toBeNull();
        expect(log).toHaveBeenLastCalledWith('[Ytm] No stored web sign-in');
        repo.set({ cookie: COOKIE, userAgent: AGENT, user });
        expect(String(store.get(WEB_SESSION_KEY))).not.toContain('sapisid-private');

        const later = createYtmWebSessionRepository({ store, safeStorage, now: () => 5000 + 3 * 3600000, log, warn });
        expect(later.get()).toEqual({ version: 1, cookie: COOKIE, userAgent: AGENT, user, storedAt: 5000 });
        expect(log).toHaveBeenLastCalledWith('[Ytm] Stored web sign-in restored, made 3h ago');
        expect(warn).not.toHaveBeenCalled();
        expect(JSON.stringify(log.mock.calls)).not.toContain('private');
        later.clear();
        expect(store.get(WEB_SESSION_KEY)).toBeUndefined();
        expect(later.get()).toBeNull();
        for (const incomplete of [{ cookie: '', userAgent: AGENT, user }, { cookie: COOKIE, userAgent: AGENT, user: { nickname: 'No id' } }, { cookie: COOKIE, user }]) {
            expect(() => repo.set(incomplete)).toThrow('Invalid');
        }
    });

    it('is kept for this run only on the plaintext Linux backend or without OS encryption, and never written plain', () => {
        const basicText = { ...cipher(), getSelectedStorageBackend: () => 'basic_text' };
        for (const safeStorage of [basicText, { isEncryptionAvailable: () => false }]) {
            const store = createStore();
            const warn = vi.fn();
            const repo = createYtmWebSessionRepository({ store, safeStorage, warn });
            repo.set({ cookie: COOKIE, userAgent: AGENT, user });
            expect(store.values.size).toBe(0);
            expect(repo.get()).toMatchObject({ cookie: COOKIE });
            expect(warn).toHaveBeenLastCalledWith('[Ytm] Web sign-in is kept for this run only: OS encryption is unavailable');
            expect(createYtmWebSessionRepository({ store, safeStorage: cipher(), log: vi.fn() }).get()).toBeNull();
        }
    });

    it('replaces what is stored where a new sign-in cannot be sealed, and leaves it where it cannot be written', () => {
        const store = createStore();
        createYtmWebSessionRepository({ store, safeStorage: cipher(), log: vi.fn() }).set({ cookie: COOKIE, userAgent: AGENT, user });
        const sealed = store.get(WEB_SESSION_KEY);
        const warn = vi.fn();
        const unsealed = createYtmWebSessionRepository({ store, safeStorage: { isEncryptionAvailable: () => false }, warn });
        unsealed.set({ cookie: 'SAPISID=other', userAgent: AGENT, user });
        unsealed.setPremium(true);
        expect(store.get(WEB_SESSION_KEY)).toBeUndefined();
        store.set(WEB_SESSION_KEY, sealed);
        expect(unsealed.get()).toMatchObject({ cookie: 'SAPISID=other' });
        expect(warn).toHaveBeenCalledTimes(1);
        const locked = { ...store, set: () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); } };
        const lockedWarn = vi.fn();
        createYtmWebSessionRepository({ store: locked, safeStorage: cipher(), log: vi.fn(), warn: lockedWarn }).set({ cookie: 'SAPISID=other', userAgent: AGENT, user });
        expect(store.get(WEB_SESSION_KEY)).toBe(sealed);
        expect(lockedWarn).toHaveBeenLastCalledWith('[Ytm] Web sign-in could not be stored; what is stored stays as it was', expect.objectContaining({ code: 'EPERM' }));
        // Another account's sign-in that cannot be written: the one stored before goes, so it does not come back at a later start.
        createYtmWebSessionRepository({ store: locked, safeStorage: cipher(), log: vi.fn(), warn: lockedWarn })
            .set({ cookie: 'SAPISID=another', userAgent: AGENT, user: { ...user, id: publicAccountId('another-gaia-id') } });
        expect(store.get(WEB_SESSION_KEY)).toBeUndefined();
        expect(lockedWarn).toHaveBeenLastCalledWith('[Ytm] Web sign-in could not be stored; the one of another account stored before was removed', expect.objectContaining({ code: 'EPERM' }));
    });

    it('refuses what it cannot unseal, damaged data and an incomplete sign-in', () => {
        const store = createStore();
        const safeStorage = cipher();
        const warn = vi.fn();
        createYtmWebSessionRepository({ store, safeStorage }).set({ cookie: COOKIE, userAgent: AGENT, user });
        const basicText = { ...cipher(), getSelectedStorageBackend: () => 'basic_text' };
        expect(createYtmWebSessionRepository({ store, safeStorage: basicText, warn }).get()).toBeNull();
        expect(warn).toHaveBeenLastCalledWith('[Ytm] Stored web sign-in cannot be read: OS encryption is unavailable');
        store.set(WEB_SESSION_KEY, 'damaged');
        expect(createYtmWebSessionRepository({ store, safeStorage, warn }).get()).toBeNull();
        expect(warn).toHaveBeenLastCalledWith('[Ytm] Stored web sign-in could not be restored');
        store.set(WEB_SESSION_KEY, safeStorage.encryptString(JSON.stringify({ version: 1, cookie: COOKIE, user, storedAt: 1 })).toString('base64'));
        expect(createYtmWebSessionRepository({ store, safeStorage, warn }).get()).toBeNull();
    });
});

describe('YouTube Music web sign-in, from the browser window to the stored account', () => {
    const signInFlow = (found: string | null = BROWSER) => {
        const browser = fakeBrowser(found);
        const kept: unknown[] = [];
        const [log, warn] = [vi.fn(), vi.fn()];
        const accountOf = vi.fn(async (_signIn: unknown): Promise<unknown> => user);
        let time = 0;
        const flow = createYtmWebSignIn({ browser, profileDir: () => FOLDER, accountOf, keep: (signIn: unknown) => { kept.push(signIn); },
            browserName: () => AGENT, exists: () => browser.folder, now: () => time, log, warn });
        return { flow, browser, kept, accountOf, log, warn, advance: (ms: number) => { time += ms; } };
    };

    it('waits for the browser to end, reads its cookies, removes the folder and then asks who signed in', async () => {
        const { flow, browser, kept, accountOf, log, warn, advance } = signInFlow();
        const folderWhenAsked: boolean[] = [];
        accountOf.mockImplementation(async () => { folderWhenAsked.push(browser.folder); return user; });
        expect(await flow.start()).toEqual({});
        expect(browser.openSignIn).toHaveBeenCalledWith(BROWSER, FOLDER);
        expect(browser.removeProfile).not.toHaveBeenCalled();
        expect(flow.check()).toEqual({ state: 'waiting' });

        browser.cookies = cookies;
        advance(48000);
        browser.windows[0].end('closed');
        await settled();
        expect(browser.readCookies).toHaveBeenCalledWith(BROWSER, FOLDER);
        expect(browser.removeProfile).toHaveBeenCalledWith(FOLDER);
        expect(folderWhenAsked).toEqual([false]);
        expect(accountOf).toHaveBeenCalledWith({ cookie: COOKIE, userAgent: AGENT });
        expect(kept).toEqual([{ cookie: COOKIE, userAgent: AGENT, user }]);
        expect(flow.check()).toEqual({ state: 'confirmed', user });
        expect(log).toHaveBeenLastCalledWith('[Ytm] Web sign-in after 48000ms: signed in');
        const lines = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
        for (const secret of [...SECRETS, 'Fixture']) expect(lines).not.toContain(secret);
    });

    it('takes a window closed without a sign-in for an expired sign-in, and stores nothing', async () => {
        const { flow, browser, kept, accountOf, log } = signInFlow();
        await flow.start();
        // Without SAPISID of .youtube.com nobody is signed in, whatever else the folder holds.
        browser.cookies = [{ name: 'VISITOR_INFO1_LIVE', value: 'visitor', domain: '.youtube.com', path: '/' }, { name: 'SAPISID', value: 'other-site', domain: '.google.com', path: '/' }];
        browser.windows[0].end('closed');
        await settled();
        expect(flow.check()).toEqual({ state: 'expired' });
        expect(browser.folder).toBe(false);
        expect(accountOf).not.toHaveBeenCalled();
        expect(kept).toEqual([]);
        expect(log).toHaveBeenLastCalledWith('[Ytm] Web sign-in after 0ms: the browser was closed without a sign-in');
    });

    it('ends the browser on cancel, reads nothing from its folder and removes it', async () => {
        const { flow, browser, kept, log } = signInFlow();
        flow.cancel();
        await flow.start();
        flow.cancel();
        expect(browser.windows[0].stop).toHaveBeenCalledTimes(1);
        expect(flow.check()).toEqual({ state: 'expired' });
        expect(log).toHaveBeenLastCalledWith('[Ytm] Web sign-in after 0ms: cancelled');
        browser.cookies = cookies;
        browser.windows[0].end('stopped');
        await settled();
        expect(browser.readCookies).not.toHaveBeenCalled();
        expect(browser.folder).toBe(false);
        expect(kept).toEqual([]);
        expect(flow.check()).toEqual({ state: 'expired' });
    });

    it('ends the browser 10 minutes after its start and reads what it left: a sign-in made in a window left open is kept', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const { flow, browser, kept } = signInFlow();
        await flow.start();
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000 - 1);
        expect(flow.check()).toEqual({ state: 'waiting' });
        expect(browser.windows[0].stop).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(browser.windows[0].stop).toHaveBeenCalledTimes(1);
        // The browser is being ended: the sign-in waits for what its folder holds.
        expect(flow.check()).toEqual({ state: 'waiting' });
        browser.cookies = cookies;
        browser.windows[0].end('stopped');
        await vi.advanceTimersByTimeAsync(0);
        expect(browser.readCookies).toHaveBeenCalledWith(BROWSER, FOLDER);
        expect(browser.folder).toBe(false);
        expect(kept).toEqual([{ cookie: COOKIE, userAgent: AGENT, user }]);
        expect(flow.check()).toEqual({ state: 'confirmed', user });

        // A folder without a sign-in, or one that cannot be read, ends the sign-in as given up, and keeps nothing.
        for (const left of [[], new BrowserSignInError('exited')]) {
            const empty = signInFlow();
            await empty.flow.start();
            await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
            empty.browser.cookies = left;
            empty.browser.windows[0].end('stopped');
            await vi.advanceTimersByTimeAsync(0);
            expect(empty.flow.check()).toEqual({ state: 'expired' });
            expect(empty.kept).toEqual([]);
            expect(empty.browser.folder).toBe(false);
        }

        // A sign-in that has ended is not given up a second time.
        const other = signInFlow();
        await other.flow.start();
        other.browser.windows[0].end('closed');
        await settled();
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
        expect(other.browser.windows[0].stop).not.toHaveBeenCalled();
    });

    it('answers "unsupported" where no browser is found, and opens nothing', async () => {
        const { flow, browser } = signInFlow(null);
        await expect(flow.start()).rejects.toMatchObject({ name: 'YtmError', code: 'unsupported' });
        expect(browser.openSignIn).not.toHaveBeenCalled();
        expect(flow.check()).toEqual({ state: 'expired' });
    });

    it('lets a second start take the place of the first, once the first browser has ended and its folder is gone', async () => {
        const { flow, browser, kept } = signInFlow();
        await flow.start();
        const second = flow.start();
        await settled();
        expect(browser.windows[0].stop).toHaveBeenCalledTimes(1);
        expect(browser.openSignIn).toHaveBeenCalledTimes(1);
        // A third start arrives before the second has a browser: the second never opens one.
        const third = flow.start();
        browser.cookies = cookies;
        browser.windows[0].end('stopped');
        await expect(second).rejects.toMatchObject({ code: 'unavailable' });
        expect(await third).toEqual({});
        expect(browser.openSignIn).toHaveBeenCalledTimes(2);
        expect(browser.removeProfile.mock.invocationCallOrder[0]).toBeLessThan(browser.openSignIn.mock.invocationCallOrder[1]);
        expect(browser.readCookies).not.toHaveBeenCalled();
        expect(flow.check()).toEqual({ state: 'waiting' });

        browser.windows[1].end('closed');
        await settled();
        expect(flow.check()).toEqual({ state: 'confirmed', user });
        expect(kept).toHaveLength(1);
        expect(browser.folder).toBe(false);
    });

    it('reports a browser that ended at once, one that gave no cookies and a YouTube that did not answer, and removes the folder each time', async () => {
        const atOnce = signInFlow();
        await atOnce.flow.start();
        atOnce.browser.windows[0].end('at-once');
        await settled();
        expect(atOnce.flow.check()).toEqual({ state: 'error', code: 'unavailable', message: 'The browser for the YouTube Music sign-in ended without an answer', reason: 'exited' });
        expect(atOnce.browser.readCookies).not.toHaveBeenCalled();
        expect(atOnce.browser.folder).toBe(false);
        expect(atOnce.warn).toHaveBeenLastCalledWith('[Ytm] Web sign-in after 0ms: failed, unavailable (The browser ended before it answered)');

        const unread = signInFlow();
        await unread.flow.start();
        unread.browser.cookies = new BrowserSignInError('timeout');
        unread.browser.windows[0].end('closed');
        await settled();
        expect(unread.flow.check()).toEqual({ state: 'error', code: 'unavailable', message: 'The browser for the YouTube Music sign-in did not answer in time', reason: 'timeout' });
        expect(unread.browser.folder).toBe(false);

        const offline = signInFlow();
        offline.accountOf.mockRejectedValue(new Error('fetch failed'));
        await offline.flow.start();
        offline.browser.cookies = cookies;
        offline.browser.windows[0].end('closed');
        await settled();
        // A failure this process has no word of its own for comes without a reason.
        expect(offline.flow.check()).toEqual({ state: 'error', code: 'network', message: 'YouTube Music could not be reached' });
        expect(offline.browser.folder).toBe(false);
        expect(offline.kept).toEqual([]);
        expect(JSON.stringify(offline.warn.mock.calls)).not.toContain('private');
    });

    it('asks YouTube who signed in for 45 seconds at most, and a later start waits for none of it', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const { flow, browser, kept, accountOf } = signInFlow();
        // A line that takes the request and then says nothing.
        accountOf.mockReturnValue(new Promise(() => {}));
        await flow.start();
        browser.cookies = cookies;
        browser.windows[0].end('closed');
        await vi.advanceTimersByTimeAsync(45 * 1000 - 1);
        expect(flow.check()).toEqual({ state: 'waiting' });
        await vi.advanceTimersByTimeAsync(1);
        expect(flow.check()).toEqual({ state: 'error', code: 'network', message: 'YouTube Music did not answer', reason: 'no-answer' });
        expect(kept).toEqual([]);
        // The sign-in has settled: the next one opens its browser.
        const next = flow.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(await next).toEqual({});
        expect(browser.openSignIn).toHaveBeenCalledTimes(2);
    });

    it('keeps nothing of a sign-in that is cancelled while YouTube is asked who signed in', async () => {
        const { flow, browser, kept, accountOf } = signInFlow();
        let answer!: (value: unknown) => void;
        accountOf.mockReturnValue(new Promise(resolve => { answer = resolve; }));
        await flow.start();
        browser.cookies = cookies;
        browser.windows[0].end('closed');
        await settled();
        expect(accountOf).toHaveBeenCalledTimes(1);
        flow.cancel();
        answer(user);
        await settled();
        expect(kept).toEqual([]);
        expect(flow.check()).toEqual({ state: 'expired' });
    });

    it('ends a browser an earlier run left and removes its folder before a browser is started there, and starts none while that cannot be done', async () => {
        const left = signInFlow();
        left.browser.folder = true;
        await left.flow.start();
        expect(left.browser.endLeftBrowsers.mock.calls).toEqual([[FOLDER]]);
        expect(left.browser.removeProfile).toHaveBeenCalledTimes(1);
        expect(left.browser.endLeftBrowsers.mock.invocationCallOrder[0]).toBeLessThan(left.browser.removeProfile.mock.invocationCallOrder[0]);
        expect(left.browser.removeProfile.mock.invocationCallOrder[0]).toBeLessThan(left.browser.openSignIn.mock.invocationCallOrder[0]);
        // The browser of this sign-in has ended by the time its folder is removed: none is looked for.
        left.browser.windows[0].end('closed');
        await settled();
        expect(left.browser.removeProfile).toHaveBeenCalledTimes(2);
        expect(left.browser.endLeftBrowsers).toHaveBeenCalledTimes(1);

        // The folder is still held, or the browser left on it could not be ended.
        const inUse = 'The folder of an earlier YouTube Music sign-in could not be removed; a browser may still be open on it';
        for (const stuck of [{ holds: true }, { ends: false }]) {
            const held = signInFlow();
            Object.assign(held.browser, { folder: true, ...stuck });
            await expect(held.flow.start()).rejects.toMatchObject({ name: 'YtmError', code: 'unavailable', message: inUse, reason: 'folder-in-use' });
            expect(held.browser.removeProfile).toHaveBeenCalledTimes(1);
            expect(held.browser.openSignIn).not.toHaveBeenCalled();
            expect(held.flow.check()).toEqual({ state: 'error', code: 'unavailable', message: inUse, reason: 'folder-in-use' });
            expect(JSON.stringify(held.warn.mock.calls)).not.toContain(FOLDER);
        }

        // The removal a request asks for: only when a folder is there.
        const swept = signInFlow();
        expect(await swept.flow.sweep()).toBe(true);
        expect(swept.browser.removeProfile).not.toHaveBeenCalled();
        expect(swept.browser.endLeftBrowsers).not.toHaveBeenCalled();
        swept.browser.folder = true;
        expect(await swept.flow.sweep()).toBe(true);
        expect(swept.browser.removeProfile).toHaveBeenCalledWith(FOLDER);
        expect(swept.browser.folder).toBe(false);
    });

    it('tries the removal of a folder that was left again with a later request, a minute after a try that failed, until it is gone', async () => {
        const { flow, browser, advance } = signInFlow();
        Object.assign(browser, { folder: true, holds: true });
        const request = async (afterMs = 0) => { advance(afterMs); flow.sweepIfLeft(); await settled(); return browser.removeProfile.mock.calls.length; };
        expect(await request()).toBe(1);
        expect(await request()).toBe(1);
        expect(await request(59_999)).toBe(1);
        expect(await request(1)).toBe(2);
        browser.holds = false;
        expect(await request(60_000)).toBe(3);
        expect(browser.folder).toBe(false);
        // Only a success is taken for done.
        expect(await request(600_000)).toBe(3);

        // A removal of this run that fails is taken up the same way.
        await flow.start();
        browser.holds = true;
        flow.cancel();
        browser.windows[0].end('stopped');
        await settled();
        expect(browser.removeProfile).toHaveBeenCalledTimes(4);
        expect(browser.folder).toBe(true);
        browser.holds = false;
        expect(await request(60_000)).toBe(5);
        expect(browser.folder).toBe(false);
    });

    it('refuses cookies that cannot be the value of a header, and puts nothing of them into a message', async () => {
        for (const value of ['sapisid-private\r\nX-Injected: 1', 'sapisid-private\u0000', 'sapisid-私密']) {
            const { flow, browser, kept, accountOf, log, warn } = signInFlow();
            await flow.start();
            browser.cookies = [{ name: 'SAPISID', value, domain: '.youtube.com', path: '/' }, cookies[1]];
            browser.windows[0].end('closed');
            await settled();
            expect(flow.check()).toEqual({ state: 'error', code: 'invalid-response', message: 'The browser for the YouTube Music sign-in gave an answer that could not be used', reason: 'protocol' });
            expect(accountOf).not.toHaveBeenCalled();
            expect(kept).toEqual([]);
            expect(JSON.stringify([...log.mock.calls, ...warn.mock.calls])).not.toMatch(/sapisid|sid-private|Injected|私密/);
        }
    });
});

describe('YouTube Music web sign-in: where the account\'s headers may go', () => {
    const account = { Cookie: COOKIE, Authorization: 'SAPISIDHASH 1_hash-private', 'X-Goog-AuthUser': '0', 'X-Goog-PageId': 'page-private', 'Content-Type': 'application/json' };
    const guarded = () => {
        const fetch = vi.fn(async (_input: unknown, _init?: any) => 'answer');
        return { fetch, send: guardAccountHeaders(fetch) };
    };
    const sent = (fetch: ReturnType<typeof vi.fn>) => Object.fromEntries(new Headers(fetch.mock.calls.at(-1)![1].headers).entries());

    it('sends a request to YouTube\'s two hosts with its headers, and not through a redirect when it carries the account\'s', async () => {
        const { fetch, send } = guarded();
        for (const input of ['https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', new URL('https://music.youtube.com/youtubei/v1/browse'),
            new Request('https://www.youtube.com/youtubei/v1/account/accounts_list', { method: 'POST' })]) {
            // As the library sends it: the headers beside the request, and a redirect to be followed.
            const init = { method: 'POST', headers: new Headers(account), body: '{}', redirect: 'follow', credentials: 'include' };
            expect(await send(input, init)).toBe('answer');
            expect(fetch).toHaveBeenLastCalledWith(input, { ...init, redirect: 'error' });
        }
        // Any one of the account's headers is enough, on the request itself too.
        for (const name of ['cookie', 'AUTHORIZATION', 'X-Goog-AuthUser', 'x-goog-pageid']) {
            await send('https://music.youtube.com/youtubei/v1/browse', { headers: { [name]: 'x' } });
            expect(fetch.mock.calls.at(-1)![1].redirect).toBe('error');
            await send(new Request('https://www.youtube.com/youtubei/v1/browse', { headers: { [name]: 'x' } }));
            expect(fetch.mock.calls.at(-1)![1].redirect).toBe('error');
        }
        // Without them the request is left as it is.
        const plain = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' };
        await send('https://www.youtube.com/youtubei/v1/browse', plain);
        expect(fetch).toHaveBeenLastCalledWith('https://www.youtube.com/youtubei/v1/browse', plain);
    });

    it('takes the account\'s headers off a request to any other address, and nothing else', async () => {
        const { fetch, send } = guarded();
        for (const address of ['https://accounts.google.com/x', 'https://upload.youtube.com/x', 'https://rr1---sn-fixture.googlevideo.com/videoplayback',
            'https://www.youtube.com.example.test/youtubei/v1/browse', 'http://www.youtube.com/youtubei/v1/browse', 'https://youtube.com/x']) {
            await send(address, { method: 'POST', headers: { ...account }, body: '{}' });
            expect(fetch.mock.calls.at(-1)![1]).toMatchObject({ method: 'POST', body: '{}' });
            expect(sent(fetch)).toEqual({ 'content-type': 'application/json' });
        }
        // As the library sends it: a Request, and the headers beside it, in any spelling.
        await send(new Request('https://example.test/x'), { headers: new Headers({ cookie: COOKIE, 'x-goog-authuser': '0', Accept: '*/*' }) });
        expect(sent(fetch)).toEqual({ accept: '*/*' });
        await send(new Request('https://example.test/x', { headers: account }));
        expect(sent(fetch)).toEqual({ 'content-type': 'application/json' });
        await send(new URL('https://example.test/x'));
        expect(sent(fetch)).toEqual({});
    });

    it('names a desktop Chrome of the app\'s own version, never a headless browser or Electron', () => {
        expect(desktopChromeName('140.0.7339.133', 'win32')).toBe('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36');
        for (const platform of ['win32', 'darwin', 'linux']) {
            expect(desktopChromeName('140.0.7339.133', platform)).toMatch(/^Mozilla\/5\.0 \([^)]+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/140\.0\.0\.0 Safari\/537\.36$/);
            expect(desktopChromeName('140.0.7339.133', platform)).not.toMatch(/Headless|Electron/i);
        }
    });

    it('tells the renderer why the browser gave no cookies in codes it knows, and hands its own code on as the reason', () => {
        expect(toErrorResult(new BrowserSignInError('not-started'))).toEqual({ ok: false, error: { code: 'unavailable', message: 'The browser for the YouTube Music sign-in could not be started', reason: 'not-started' } });
        expect(toErrorResult(new BrowserSignInError('exited'))).toEqual({ ok: false, error: { code: 'unavailable', message: 'The browser for the YouTube Music sign-in ended without an answer', reason: 'exited' } });
        expect(toErrorResult(new BrowserSignInError('timeout'))).toEqual({ ok: false, error: { code: 'unavailable', message: 'The browser for the YouTube Music sign-in did not answer in time', reason: 'timeout' } });
        expect(toErrorResult(new BrowserSignInError('protocol'))).toEqual({ ok: false, error: { code: 'invalid-response', message: 'The browser for the YouTube Music sign-in gave an answer that could not be used', reason: 'protocol' } });
    });
});

describe('YouTube Music web client answers', () => {
    it('reads whether an answer was given to a signed-in account', () => {
        expect(webPages.signedInMarkOf(marked('1'))).toBe('1');
        expect(webPages.signedInMarkOf(marked('0'))).toBe('0');
        for (const unmarked of [undefined, {}, { responseContext: {} }, { responseContext: { serviceTrackingParams: [{ service: 'CSI', params: [{ key: 'logged_in', value: '0' }] }] } },
            { responseContext: { serviceTrackingParams: [{ service: 'GFEEDBACK', params: [{ key: 'logged_in', value: 0 }] }] } }]) {
            expect(webPages.signedInMarkOf(unmarked)).toBeUndefined();
        }
    });

    it('reads the selected account of the accounts list, and nothing of its address', () => {
        const account = webPages.accountFromList(webAccounts);
        expect(account).toEqual(user);
        expect(JSON.stringify(account)).not.toContain('private');
        expect(account.id).not.toContain(GAIA_ID);
        // Without Google's id the channel's handle stands for the account, and then its name.
        expect(webPages.accountFromList(accountsList([accountItem('Fixture', { channelHandle: { runs: [{ text: '@handle' }] } })]))).toMatchObject({ id: publicAccountId('@handle'), avatarUrl: '' });
        expect(webPages.accountFromList(accountsList([accountItem('Fixture')]))).toMatchObject({ id: publicAccountId('Fixture') });
        for (const nobody of [undefined, {}, accountsList([]), accountsList([{ accountItem: {} }])]) expect(webPages.accountFromList(nobody)).toBeNull();
    });

    it('reads a library tab\'s cards: playlists and albums, the liked list and the account\'s own marked, any other card left out', () => {
        const page = webPages.readGrid(gridPage(playlistsTab, 'grid-2'));
        expect(page.continuation).toBe('grid-2');
        expect(page.rows.map((row: unknown) => webPages.collectionFromRow(row))).toEqual([
            null,
            { id: 'LM', type: 'playlist', name: 'Liked Music', coverUrl: coverOf('LM'), isLiked: true },
            { id: 'PLown01', type: 'playlist', name: 'Mine', coverUrl: coverOf('PLown01'), trackCount: 1204, isOwned: true },
            { id: 'PLsaved01', type: 'playlist', name: '别人的歌单', coverUrl: coverOf('PLsaved01'), trackCount: 12 },
            { id: 'MPREb_fixture01', type: 'album', name: 'An album', coverUrl: coverOf('MPREb_fixture01'), playlistId: ALBUM_LIST, artists: [{ id: 'UCartist01', name: 'The 1975' }] },
        ]);
        expect(webPages.collectionFromRow(albumRow('MPREb_fixture02', 'Another', [{ text: '专辑' }, { text: ' • ' }, { text: 'Various Artists' }, { text: ' • ' }, { text: '2019' }]).musicTwoRowItemRenderer))
            .toEqual({ id: 'MPREb_fixture02', type: 'album', name: 'Another', coverUrl: coverOf('MPREb_fixture02'), artists: [], year: 2019 });
        for (const other of [undefined, {}, { title: { runs: [{ text: 'An artist' }] }, navigationEndpoint: link('UCartist01', 'MUSIC_PAGE_TYPE_ARTIST') },
            { title: { runs: [{ text: '' }] }, navigationEndpoint: link('VLPLnameless', 'MUSIC_PAGE_TYPE_PLAYLIST') }, { title: { runs: [{ text: 'Short' }] }, navigationEndpoint: link('VLx', 'MUSIC_PAGE_TYPE_PLAYLIST') }]) {
            expect(webPages.collectionFromRow(other)).toBeNull();
        }
    });

    it('takes the next page from the grid alone: the tab\'s chips reload it, and a further page is a grid continuation', () => {
        expect(webPages.readGrid(gridPage(playlistsTab))).toEqual({ rows: playlistsTab.map(item => item.musicTwoRowItemRenderer) });
        const further = { continuationContents: { gridContinuation: { items: [playlistsTab[1], { somethingElse: {} }], continuations: [{ nextContinuationData: { continuation: 'grid-3' } }] } } };
        expect(webPages.readGrid(further)).toEqual({ rows: [playlistsTab[1].musicTwoRowItemRenderer], continuation: 'grid-3' });
        for (const empty of [undefined, {}, marked('0'), { contents: { gridRenderer: {} } }]) expect(webPages.readGrid(empty)).toEqual({ rows: [] });
    });
});

describe('YouTube Music desktop bridge with a web sign-in', () => {
    // Each `Innertube.create` call yields one client: `web` (it was given a cookie) or `guest`.
    // `answer` is what a client's request is answered with.
    const fakeYoutube = (answer: (kind: string, endpoint: string, body: any) => unknown) => {
        const created: any[] = [];
        class MusicPlaylistShelf {}
        const create = vi.fn(async (options: any) => {
            const kind = options.cookie ? 'web' : 'guest';
            const client = { kind, options, actions: { execute: vi.fn(async (endpoint: string, body: any) => answer(kind, endpoint, body)) } };
            created.push(client);
            return client;
        });
        const libraries = { Innertube: { create }, Platform: { shim: {} as Record<string, unknown> },
            Parser: { setParserErrorHandler: () => {}, parseResponse: (data: any) => data.parsed ?? {} }, YTNodes: { MusicPlaylistShelf } };
        return { created, libraries, MusicPlaylistShelf, of: (kind: string) => created.filter(client => client.kind === kind) };
    };
    const signedInAnswer = (_kind: string, endpoint: string, _body?: any): unknown => ({ data: endpoint === '/account/accounts_list' ? webAccounts : marked('1') });
    // `wait` is the bridge's timer: by default one that never runs out. `keychain` is what the
    // bridge's run unseals with: by default the one the stored sign-in was sealed with.
    const setup = ({ web = false, found = BROWSER as string | null, answer = signedInAnswer, signInFolder = () => FOLDER, wait = () => new Promise<void>(() => {}), keychain }:
        { web?: boolean; found?: string | null; answer?: typeof signedInAnswer; signInFolder?: (() => string) | null; wait?: (ms: number) => Promise<void>; keychain?: object } = {}) => {
        const store = createStore();
        const safeStorage = cipher();
        const time = 1_700_000_000_000;
        const clock = { ms: time };
        if (web) createYtmWebSessionRepository({ store, safeStorage, now: () => time, log: vi.fn() }).set({ cookie: COOKIE, userAgent: AGENT, user });
        const yt = fakeYoutube(answer);
        const browser = fakeBrowser(found);
        const [log, warn, fetch] = [vi.fn(), vi.fn(), vi.fn()];
        const bridge = createYtmApiBridge({ store, safeStorage: keychain ?? safeStorage, fetch, evaluate: vi.fn(), loadLibraries: async () => yt.libraries, log, warn, wait,
            mintToken: vi.fn(), now: () => clock.ms, browserSignIn: browser, browserName: () => AGENT, ...(signInFolder ? { signInFolder } : {}) });
        return { bridge, store, yt, browser, log, warn, fetch, time, clock };
    };
    const account = { id: user.id, nickname: 'Fixture', avatarUrl: 'https://yt3.ggpht.com/a', vipType: 0 };

    it.each([
        ['without OS encryption', { ...cipher(), isEncryptionAvailable: (): boolean => false }],
        ['on the plaintext Linux backend', { ...cipher(), getSelectedStorageBackend: (): string => 'basic_text' }],
    ])('does not answer a stored sign-in it cannot read %s as nobody, and nobody once signed out', async (_case, keychain) => {
        const { bridge, store } = setup({ web: true, keychain });
        expect(await bridge.request('login_status')).toEqual({ ok: false, error: { code: 'unavailable', message: 'The stored YouTube Music sign-in cannot be read now' } });
        expect(store.get(WEB_SESSION_KEY)).toEqual(expect.any(String));
        await bridge.request('logout');
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
        await expect(setup().bridge.request('login_status')).resolves.toEqual({ ok: true, data: null });
    });

    it('answers nobody for a stored sign-in the keychain will not unseal while encryption works', async () => {
        const { bridge } = setup({ web: true, keychain: { ...cipher(), decryptString: () => { throw new Error('refused'); } } });
        expect(await bridge.request('login_status')).toEqual({ ok: true, data: null });
    });

    it('signs in through the browser, tells the renderer the account and keeps the cookies to itself', async () => {
        const { bridge, store, yt, browser, log, warn, fetch, time } = setup();
        expect(YTM_OPERATIONS).toEqual(expect.arrayContaining(['web_login_start', 'web_login_check', 'web_login_open', 'web_login_cancel']));
        const started = await bridge.request('web_login_start');
        expect(started).toEqual({ ok: true, data: {} });
        expect(browser.openSignIn).toHaveBeenCalledWith(BROWSER, FOLDER);
        expect(await bridge.request('web_login_check')).toEqual({ ok: true, data: { state: 'waiting' } });
        // Its window is open as far as the bridge can tell: nothing is opened a second time.
        expect(await bridge.request('web_login_open')).toEqual({ ok: true, data: {} });
        expect(browser.openSignIn).toHaveBeenCalledTimes(1);
        expect(yt.created).toHaveLength(0);

        browser.cookies = cookies;
        browser.windows[0].end('closed');
        await settled();
        const confirmed = await bridge.request('web_login_check');
        expect(confirmed).toEqual({ ok: true, data: { state: 'confirmed', account } });
        const status = await bridge.request('login_status');
        expect(status.data).toEqual(account);

        // Who signed in was asked as YouTube Music's web client, on a session made for the cookies.
        const [asked] = yt.created;
        expect(asked.options).toMatchObject({ lang: 'zh-CN', cookie: COOKIE, retrieve_player: false, user_agent: AGENT });
        expect(asked.options.client_type).toBeUndefined();
        expect(asked.actions.execute.mock.calls).toEqual([['/account/accounts_list', { client: 'YTMUSIC', parse: false }]]);
        // That session's requests go through the guard.
        await asked.options.fetch('https://example.test/x', { headers: { Cookie: COOKIE, Accept: '*/*' } });
        expect(Object.fromEntries(new Headers(fetch.mock.calls.at(-1)![1].headers).entries())).toEqual({ accept: '*/*' });

        expect(String(store.get(WEB_SESSION_KEY))).not.toContain('sapisid-private');
        expect(unseal(store)).toEqual({ version: 1, cookie: COOKIE, userAgent: AGENT, user, storedAt: time });
        // What the account is asked for next is asked on a session made from what was stored.
        expect(await bridge.request('user_playlists')).toEqual({ ok: true, data: { items: [] } });
        expect(yt.of('web')).toHaveLength(2);
        expect(yt.of('web')[1].options).toMatchObject({ cookie: COOKIE, user_agent: AGENT, retrieve_player: false });

        const lines = JSON.stringify([...log.mock.calls, ...warn.mock.calls]);
        for (const secret of [...SECRETS, 'Fixture']) expect(lines).not.toContain(secret);
        const answers = JSON.stringify([started, confirmed, status]);
        for (const secret of SECRETS) expect(answers).not.toContain(secret);
    });

    it('stores nothing when YouTube does not answer the cookies as a signed-in account', async () => {
        const notTaken = { code: 'unavailable', message: 'YouTube Music did not take the sign-in', reason: 'not-taken' };
        for (const [answer, failure] of [
            [() => ({ data: marked('0', accountsList([accountItem('Fixture')])) }), notTaken],
            [() => ({ data: accountsList([accountItem('Fixture')]) }), notTaken],
            [() => ({ data: marked('1', accountsList([])) }), { code: 'invalid-response', message: 'YouTube Music account is missing', reason: 'account-missing' }],
        ] as const) {
            const { bridge, store, browser } = setup({ answer });
            await bridge.request('web_login_start');
            browser.cookies = cookies;
            browser.windows[0].end('closed');
            await settled();
            expect(await bridge.request('web_login_check')).toEqual({ ok: true, data: { state: 'error', ...failure } });
            expect(store.get(WEB_SESSION_KEY)).toBeUndefined();
            expect((await bridge.request('login_status')).data).toBeNull();
        }
    });

    it('answers "unsupported" to a start without a browser or without a folder for its window', async () => {
        const without = setup({ found: null });
        expect(await without.bridge.request('web_login_start')).toEqual({ ok: false, error: { code: 'unsupported', message: 'No browser for the YouTube Music sign-in was found', reason: 'no-browser' } });
        const nowhere = setup({ signInFolder: null });
        expect(await nowhere.bridge.request('web_login_start')).toMatchObject({ ok: false, error: { code: 'unsupported' } });
        expect(nowhere.browser.openSignIn).not.toHaveBeenCalled();
    });

    it('ends a sign-in under way on cancel and on sign-out, and sign-out removes the stored sign-in', async () => {
        const { bridge, store, browser, log } = setup({ web: true });
        expect(await bridge.request('web_login_check')).toEqual({ ok: true, data: { state: 'expired' } });
        await bridge.request('web_login_start');
        expect(await bridge.request('web_login_cancel')).toEqual({ ok: true, data: {} });
        expect(browser.windows[0].stop).toHaveBeenCalledTimes(1);
        expect((await bridge.request('web_login_check')).data).toEqual({ state: 'expired' });
        browser.windows[0].end('stopped');

        await bridge.request('web_login_start');
        expect(await bridge.request('logout')).toEqual({ ok: true, data: true });
        expect(log).toHaveBeenLastCalledWith('[Ytm] Signed out');
        expect(browser.windows[1].stop).toHaveBeenCalledTimes(1);
        expect(store.values.size).toBe(0);
        expect((await bridge.request('login_status')).data).toBeNull();
        // The browser's end after that signs nobody in.
        browser.cookies = cookies;
        browser.windows[1].end('stopped');
        await settled();
        expect((await bridge.request('web_login_check')).data).toEqual({ state: 'expired' });
        expect(store.get(WEB_SESSION_KEY)).toBeUndefined();
        expect(await bridge.request('user_playlists')).toMatchObject({ ok: false, error: { code: 'auth-required' } });
    });

    it('reads the explore page as the web client', async () => {
        const { bridge, yt } = setup({ web: true });
        expect(await bridge.request('explore')).toEqual({ ok: true, data: { sections: [], continuation: 'FEmusic_explore' } });
        expect(yt.of('web').at(-1).actions.execute.mock.calls).toEqual([['/browse', { client: 'YTMUSIC', parse: false, browseId: 'FEmusic_home' }]]);
    });

    it('ends the browser of a sign-in under way when the app quits, and has the quit wait until its folder is removed', async () => {
        const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-ytm-sign-in-'));
        try {
            const { bridge, browser } = setup({ signInFolder: () => folder });
            // No sign-in under way: nothing for a quit to wait for.
            expect(bridge.shutdown()).toBeNull();
            await bridge.request('web_login_start');
            let removed!: () => void;
            browser.removeProfile.mockImplementation(() => new Promise<boolean>(resolve => { removed = () => resolve(true); }));
            const gone = bridge.shutdown();
            expect(browser.windows[0].stop).toHaveBeenCalledTimes(1);
            expect((await bridge.request('web_login_check')).data).toEqual({ state: 'expired' });
            let held = true;
            void gone.then(() => { held = false; });
            // The browser has ended, the folder is still being removed.
            browser.windows[0].end('stopped');
            await settled();
            expect(browser.removeProfile).toHaveBeenLastCalledWith(folder);
            expect(held).toBe(true);
            removed();
            await settled();
            expect(held).toBe(false);
            expect(bridge.shutdown()).toBeNull();
        } finally {
            fs.rmSync(folder, { recursive: true, force: true });
        }
    });

    it('has a quit wait 3 seconds at most for a sign-in\'s browser to end', async () => {
        let limitReached!: () => void;
        const wait = vi.fn((_ms: number) => new Promise<void>(resolve => { limitReached = resolve; }));
        const { bridge, browser } = setup({ wait });
        await bridge.request('web_login_start');
        const gone = bridge.shutdown();
        expect(wait.mock.calls).toEqual([[3000]]);
        limitReached();
        await gone;
        // That browser never ended: its folder is the next run's to remove.
        expect(browser.removeProfile).not.toHaveBeenCalled();
    });

    it('removes a sign-in folder an earlier run left with the first request of this run, and after a failure with a later request', async () => {
        const left = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-ytm-sign-in-'));
        try {
            const { bridge, browser, clock } = setup({ signInFolder: () => left });
            browser.holds = true;
            await bridge.request('no_such_operation');
            expect(browser.removeProfile).not.toHaveBeenCalled();
            await bridge.request('login_status');
            await settled();
            expect(browser.endLeftBrowsers.mock.calls).toEqual([[left]]);
            expect(browser.removeProfile.mock.calls).toEqual([[left]]);
            await bridge.request('login_status');
            await settled();
            expect(browser.removeProfile).toHaveBeenCalledTimes(1);
            // The removal failed: a request a minute later tries it again, and a success is the end of it.
            browser.holds = false;
            clock.ms += 60_000;
            await bridge.request('login_status');
            await settled();
            expect(browser.removeProfile).toHaveBeenCalledTimes(2);
            clock.ms += 600_000;
            await bridge.request('login_status');
            await settled();
            expect(browser.removeProfile).toHaveBeenCalledTimes(2);
        } finally {
            fs.rmSync(left, { recursive: true, force: true });
        }
    });

    it('asks the account\'s library, playlists and saves as YouTube Music\'s web client', async () => {
        const asked: string[] = [];
        const answer = (kind: string, endpoint: string, body: any) => {
            asked.push(`${kind} ${endpoint} ${body?.client} ${body?.parse} ${body?.browseId ?? body?.continuation ?? ''}`);
            return { data: marked('1') };
        };
        const webOnly = setup({ web: true, answer });
        expect((await webOnly.bridge.request('login_status')).data).toEqual(account);
        expect(await webOnly.bridge.request('user_playlists')).toEqual({ ok: true, data: { items: [] } });
        expect(await webOnly.bridge.request('user_albums', { continuation: 'grid-2' })).toEqual({ ok: true, data: { items: [] } });
        expect(await webOnly.bridge.request('playlist', { id: 'LM' })).toEqual({ ok: true, data: { items: [] } });
        expect(asked).toEqual(['web /browse YTMUSIC false FEmusic_liked_playlists', 'web /browse YTMUSIC false grid-2', 'web /browse YTMUSIC false VLLM']);
        // Saving and playlist changes go the same way (ytmWebWrites.test.ts).
        expect(await webOnly.bridge.request('list_saved', { id: ALBUM_LIST })).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        expect(await webOnly.bridge.request('playlist_edit', { id: 'PLown01', action: 'add', videoIds: VIDEO })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
        expect(asked.slice(3)).toEqual([`web /browse YTMUSIC false VL${ALBUM_LIST}`, 'web /browse/edit_playlist YTMUSIC false ']);
        for (const params of [{ continuation: '' }, { continuation: 7 }, { continuation: 'x'.repeat(8193) }]) {
            expect(await webOnly.bridge.request('user_playlists', params)).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
        // All of it was asked on one session, made for the cookies.
        expect(webOnly.yt.created.map(client => client.kind)).toEqual(['web']);
    });

    it('answers the library tabs with the cards of their own kind: playlists on one, albums on the other', async () => {
        const answer = (_kind: string, _endpoint: string, body: any) => ({ data: body.continuation ? { continuationContents: { gridContinuation: { items: [playlistsTab[3]] } } } : gridPage(playlistsTab, 'grid-2') });
        const { bridge } = setup({ web: true, answer });
        expect(await bridge.request('user_playlists')).toEqual({ ok: true, data: { continuation: 'grid-2', items: [
            { id: 'LM', type: 'playlist', name: 'Liked Music', coverUrl: coverOf('LM'), isLiked: true },
            { id: 'PLown01', type: 'playlist', name: 'Mine', coverUrl: coverOf('PLown01'), trackCount: 1204, isOwned: true },
            { id: 'PLsaved01', type: 'playlist', name: '别人的歌单', coverUrl: coverOf('PLsaved01'), trackCount: 12 },
        ] } });
        expect((await bridge.request('user_playlists', { continuation: 'grid-2' })).data).toEqual({ items: [expect.objectContaining({ id: 'PLsaved01' })] });
        expect((await bridge.request('user_albums')).data).toEqual({ continuation: 'grid-2', items: [expect.objectContaining({ id: 'MPREb_fixture01', type: 'album', playlistId: ALBUM_LIST })] });
    });

    it('reads a playlist of the account as the guest read of a public one is read: a shelf, then the rows each further page appends', async () => {
        let yt!: ReturnType<typeof fakeYoutube>;
        const row = (id: string) => ({ type: 'MusicResponsiveListItem', id, title: `Song ${id}`, artists: [{ name: 'Artist', channel_id: 'UCartist' }], duration: { seconds: 60 } });
        const pages: Record<string, unknown> = {
            VLPLown01: { contents_memo: { getType: (type: unknown) => (type === yt.MusicPlaylistShelf ? [{ contents: [row(VIDEO), row('bad'), { type: 'ContinuationItem', endpoint: { payload: { token: 'more-rows' } } }] }] : []) } },
            'more-rows': { on_response_received_actions: [{ type: 'AppendContinuationItemsAction', contents: [row('ZRtdQ81jPUQ')] }] },
            'no-rows': {},
        };
        const calls: unknown[] = [];
        const context = setup({ web: true, answer: (_kind, endpoint, body) => { calls.push([endpoint, body]); return { data: marked('1', { parsed: pages[body.browseId ?? body.continuation] }) }; } });
        yt = context.yt;
        expect(await context.bridge.request('playlist', { id: 'PLown01' })).toEqual({ ok: true, data: {
            continuation: 'more-rows',
            items: [{ id: VIDEO, name: `Song ${VIDEO}`, artists: [{ id: 'UCartist', name: 'Artist' }], album: { id: '', name: '', coverUrl: '' }, durationMs: 60000 }],
        } });
        expect((await context.bridge.request('playlist', { id: 'PLown01', continuation: 'more-rows' })).data).toEqual({ items: [expect.objectContaining({ id: 'ZRtdQ81jPUQ' })] });
        expect(calls).toEqual([['/browse', { client: 'YTMUSIC', parse: false, browseId: 'VLPLown01' }], ['/browse', { client: 'YTMUSIC', parse: false, continuation: 'more-rows' }]]);
        // A playlist the account cannot see has no shelf; a further page without rows is in a shape not known here.
        expect(await context.bridge.request('playlist', { id: 'PLgone01' })).toEqual({ ok: true, data: { items: [] } });
        expect(await context.bridge.request('playlist', { id: 'PLown01', continuation: 'no-rows' })).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
    });

    it('fails a first page without a shelf whose header names songs, and reads one that names 0 as an empty list', async () => {
        const header = (count: string) => ({ musicResponsiveHeaderRenderer: { secondSubtitle: { runs: [{ text: count }] } } });
        const raw: Record<string, unknown> = { VLPLmoved01: header('3 songs'), VLPLempty01: header('0 songs') };
        const { bridge } = setup({ web: true, answer: (_kind, _endpoint, body) => ({ data: marked('1', { parsed: {}, header: raw[body.browseId] }) }) });
        expect(await bridge.request('playlist', { id: 'PLmoved01' })).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        expect(await bridge.request('playlist', { id: 'PLempty01' })).toEqual({ ok: true, data: { items: [], trackCount: 0 } });
        expect(await bridge.request('playlist', { id: 'PLnone01' })).toEqual({ ok: true, data: { items: [] } });
    });

    it('gives each song of the account\'s playlist the id the page gives its row, so that two rows of one song are told apart', async () => {
        let yt!: ReturnType<typeof fakeYoutube>;
        const other = 'ZRtdQ81jPUQ';
        const row = (id: string) => ({ type: 'MusicResponsiveListItem', id, title: `Song ${id}`, artists: [], duration: { seconds: 60 } });
        const raw = (videoId: string, playlistSetVideoId?: unknown) => ({ musicResponsiveListItemRenderer: { playlistItemData: { videoId, playlistSetVideoId } } });
        const context = setup({ web: true, answer: () => ({ data: marked('1', {
            parsed: { contents_memo: { getType: (type: unknown) => (type === yt.MusicPlaylistShelf ? [{ contents: [row(VIDEO), row(other), row(VIDEO), row(other), row(VIDEO)] }] : []) } },
            contents: [
                // Another list of the page is not the playlist's, whatever its rows say.
                { musicShelfRenderer: { contents: [raw(VIDEO, 'ROW-0_x')] } },
                // A first row of a song with no id of its own does not take the id of that song's
                // next row; an id not written as YouTube writes them is none.
                { musicPlaylistShelfRenderer: { contents: [raw(VIDEO, 'ROW-1_a'), raw(other), raw(VIDEO, 'not an id'), raw(other, 'ROW-3_c'), raw(VIDEO, 'ROW-4_d')] } },
            ],
        }) }) });
        yt = context.yt;
        const { items } = (await context.bridge.request('playlist', { id: 'PLown01' })).data;
        expect(items.map((item: { id: string; setVideoId?: string }) => [item.id, item.setVideoId]))
            .toEqual([[VIDEO, 'ROW-1_a'], [other, undefined], [VIDEO, undefined], [other, 'ROW-3_c'], [VIDEO, 'ROW-4_d']]);
        expect(context.log).toHaveBeenLastCalledWith('[Ytm] Playlist page: 5 song(s), 3 with the id of their row');
    });

    describe('when YouTube no longer answers as the account', () => {
        const refused = new Error('Request to https://www.youtube.com/youtubei/v1/browse?prettyPrint=false failed with status code 401');
        // The web client's answers in turn; an Error is a request that fails with it.
        const answering = (...answers: unknown[]) => {
            const endpoints: string[] = [];
            const context = setup({ web: true, answer: (_kind, endpoint) => {
                endpoints.push(endpoint);
                const next = answers.shift();
                if (next instanceof Error) throw next;
                return { data: next };
            } });
            return { ...context, endpoints, answers };
        };
        const REMOVED = '[Ytm] Google no longer accepts the stored web sign-in; it was removed';

        it('keeps the sign-in after one answer given as to a guest, when the account itself still answers', async () => {
            const { bridge, store, warn, endpoints, answers } = answering(marked('0'), webAccounts);
            expect(await bridge.request('user_playlists')).toEqual({ ok: false, error: { code: 'unavailable', message: 'YouTube Music did not answer as the account' } });
            expect(endpoints).toEqual(['/browse', '/account/accounts_list']);
            expect(store.get(WEB_SESSION_KEY)).toBeDefined();
            expect((await bridge.request('login_status')).data).toEqual(account);
            expect(warn).toHaveBeenCalledWith('[Ytm] A request was not answered as the account, the account itself still is; the web sign-in is kept');
            expect(warn).not.toHaveBeenCalledWith(REMOVED);
            answers.push(gridPage(playlistsTab));
            expect((await bridge.request('user_playlists')).data.items).toHaveLength(3);
        });

        it.each([
            ['two answers given as to a guest', [marked('0'), marked('0')]],
            ['status 401 twice', [refused, refused]],
            ['a guest\'s answer and then status 401', [marked('0'), refused]],
        ])('removes the sign-in after %s', async (_name, answers) => {
            const { bridge, store, warn, endpoints, yt } = answering(...answers);
            expect(await bridge.request('playlist', { id: 'LM' })).toEqual({ ok: false, error: { code: 'auth-required', message: 'YouTube Music sign-in is no longer valid' } });
            expect(endpoints).toEqual(['/browse', '/account/accounts_list']);
            expect(store.get(WEB_SESSION_KEY)).toBeUndefined();
            expect((await bridge.request('login_status')).data).toBeNull();
            expect(warn.mock.calls.filter(([line]) => line === REMOVED)).toHaveLength(1);
            expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
            expect(await bridge.request('user_albums')).toMatchObject({ ok: false, error: { code: 'auth-required' } });
            expect(yt.of('web')).toHaveLength(1);
        });

        it('keeps the sign-in when the second question cannot be asked, and leaves any other failure as it is', async () => {
            const offline = answering(refused, new Error('fetch failed'));
            expect(await offline.bridge.request('user_playlists')).toMatchObject({ ok: false, error: { code: 'unavailable' } });
            expect(offline.store.get(WEB_SESSION_KEY)).toBeDefined();

            const other = answering(new Error('fetch failed'));
            expect(await other.bridge.request('user_playlists')).toMatchObject({ ok: false, error: { code: 'network' } });
            expect(other.endpoints).toEqual(['/browse']);
            expect(other.store.get(WEB_SESSION_KEY)).toBeDefined();
        });

        it('removes nothing when the listener signed out while the request was under way', async () => {
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const { bridge, warn } = setup({ web: true, answer: async () => { await gate; return { data: marked('0') }; } });
            const pending = bridge.request('user_playlists');
            await settled();
            await bridge.request('logout');
            release();
            expect(await pending).toEqual({ ok: false, error: { code: 'unavailable', message: 'YouTube Music sign-in changed during the request' } });
            expect(warn).not.toHaveBeenCalledWith(REMOVED);
        });
    });

    describe('when the listener signs out while a request is under way', () => {
        const changed = { ok: false, error: { code: 'unavailable', message: 'YouTube Music sign-in changed during the request' } };

        it('does not hand the account\'s answer to the renderer', async () => {
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const { bridge } = setup({ web: true, answer: async () => { await gate; return { data: gridPage(playlistsTab) }; } });
            const pending = bridge.request('user_playlists');
            await settled();
            await bridge.request('logout');
            release();
            expect(await pending).toEqual(changed);
        });

        it('asks nothing as that account once its session is there', async () => {
            let release!: () => void;
            const gate = new Promise<void>(resolve => { release = resolve; });
            const { bridge, yt } = setup({ web: true });
            const create = yt.libraries.Innertube.create;
            yt.libraries.Innertube.create = vi.fn(async (options: any) => { await gate; return create(options); });
            const pending = bridge.request('user_playlists');
            await settled();
            await bridge.request('logout');
            release();
            expect(await pending).toEqual(changed);
            expect(yt.of('web')).toHaveLength(1);
            expect(yt.of('web')[0].actions.execute).not.toHaveBeenCalled();
        });
    });
});
