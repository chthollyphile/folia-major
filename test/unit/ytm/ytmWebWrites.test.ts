import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/ytm/ytmWebWrites.test.ts — what changes the account of YouTube Music's web sign-in,
// against a stand-in for youtubei.js: whether a list is saved and its saving, the songs of an own
// playlist, and a song's like. The pages are cut down to what the web client's answers were seen
// to hold on 2026-10-09. Every cookie, name, title and id in this file is made up.

const require = createRequire(import.meta.url);
const { createYtmApiBridge, YTM_OPERATIONS } = require('../../../electron/ytm/ytmApiBridge.cjs');
const { publicAccountId } = require('../../../electron/ytm/session.cjs');
const { createYtmWebSessionRepository, WEB_SESSION_KEY } = require('../../../electron/ytm/webSignIn.cjs');
const webSaves = require('../../../electron/ytm/webSaves.cjs');

const VIDEO = 'm9SMT5ipbxk';
const ALBUM = 'MPREb_fixture01';
// The list the renderer names the album by, and the one the album's save button names.
const ALBUM_LIST = 'OLAK5uy_fixturefixturefixturefixturefixture01';
const BUTTON_LIST = 'OLAK5uy_buttonbuttonbuttonbuttonbuttonbutt01';
const PLAYLIST = 'PLtheirs000001';
const OWN_PLAYLIST = 'PLown_private_01';
const AGENT = 'Mozilla/5.0 (Test) Chrome/140.0.0.0 Safari/537.36';
const COOKIE = 'SAPISID=sapisid-private; SID=sid-private';
const user = { id: publicAccountId('104000000000000000001'), nickname: 'Fixture', avatarUrl: 'https://yt3.ggpht.com/a', premium: false };
const SECRETS = ['sapisid-private', 'sid-private', 'Fixture', 'title-private', OWN_PLAYLIST];

const createStore = () => {
    const values = new Map<string, unknown>();
    return { values, get: (key: string) => values.get(key), set: (key: string, value: unknown) => values.set(key, value), delete: (key: string) => values.delete(key) };
};
const cipher = () => ({ isEncryptionAvailable: () => true,
    encryptString: (text: string) => Buffer.from(Buffer.from(text).map(byte => byte ^ 0xa5)),
    decryptString: (data: Buffer) => Buffer.from(data.map(byte => byte ^ 0xa5)).toString() });

// An answer of the web client, marked as given to a signed-in account ('1') or to nobody ('0').
const marked = (signedIn: string, body: Record<string, unknown> = {}) => ({
    responseContext: { serviceTrackingParams: [{ service: 'GFEEDBACK', params: [{ key: 'logged_in', value: signedIn }] }] },
    ...body,
});
const like = (status: string, playlistId: string, params: Record<string, string> = {}) => ({ likeEndpoint: { status, target: { playlistId }, ...params } });
// The save button of a list's page: a like of the list, and that like taken back.
const saveButton = (isToggled: boolean, list: string, commands: Record<string, unknown> = {}) => ({ toggleButtonRenderer: {
    isToggled, isDisabled: false, defaultIcon: { iconType: 'BOOKMARK_BORDER' }, toggledIcon: { iconType: 'BOOKMARK' },
    defaultServiceEndpoint: like('LIKE', list), toggledServiceEndpoint: like('INDIFFERENT', list), ...commands,
} });
// A page's header: its buttons, and the toggle that opens the description out, which sends nothing.
const header = (buttons: unknown[]) => ({ musicResponsiveHeaderRenderer: {
    title: { runs: [{ text: 'A title-private' }] },
    description: { musicDescriptionShelfRenderer: { moreButton: { toggleButtonRenderer: { isToggled: false, defaultIcon: { iconType: 'EXPAND' }, toggledIcon: { iconType: 'COLLAPSE' } } } } },
    buttons: [...buttons, { musicPlayButtonRenderer: {} }, { menuRenderer: { items: [] } }],
} });
// A row has a like button of its own, which is the song's.
const row = (videoId: string) => ({ musicResponsiveListItemRenderer: { playlistItemData: { videoId }, menu: { menuRenderer: { topLevelButtons: [
    { likeButtonRenderer: { likeStatus: 'INDIFFERENT', serviceEndpoints: [{ likeEndpoint: { status: 'LIKE', target: { videoId } } }] } },
] } } } });
const listPage = (headers: unknown[]) => marked('1', { contents: { twoColumnBrowseResultsRenderer: {
    tabs: [{ tabRenderer: { content: { sectionListRenderer: { contents: headers } } } }],
    secondaryContents: { sectionListRenderer: { contents: [{ musicPlaylistShelfRenderer: { contents: [row(VIDEO)] } }] } },
} } });
const savablePage = (saved: boolean, list: string, commands?: Record<string, unknown>) => listPage([header([saveButton(saved, list, commands)])]);
// The page of the liked-music list, and of a playlist the account made: a header without a save button.
const pageWithoutButton = listPage([header([])]);
// An album asked for by the id of its list: its rows under no header.
const rowsAlone = listPage([]);

const browse = (browseId: string) => ['/browse', { client: 'YTMUSIC', parse: false, browseId }];

// The bridge with a web sign-in stored. `answer` is what a request of the web client is
// answered with; `asked` lists those requests.
const setup = ({ answer = () => marked('1') }: { answer?: (endpoint: string, body: any) => unknown } = {}) => {
    const store = createStore();
    const safeStorage = cipher();
    const time = 1_700_000_000_000;
    createYtmWebSessionRepository({ store, safeStorage, now: () => time, log: vi.fn() }).set({ cookie: COOKIE, userAgent: AGENT, user });
    const asked: unknown[][] = [];
    const created: string[] = [];
    const create = vi.fn(async (options: any) => {
        created.push(options.cookie ? 'web' : 'guest');
        return { actions: { execute: vi.fn(async (endpoint: string, body: any) => {
            asked.push([endpoint, body]);
            return { data: answer(endpoint, body) };
        }) } };
    });
    const libraries = { Innertube: { create }, Platform: { shim: {} as Record<string, unknown> } };
    const [log, warn, wait] = [vi.fn(), vi.fn(), vi.fn(async (_ms: number) => undefined)];
    const browserSignIn = { findBrowser: vi.fn(), openSignIn: vi.fn(), readCookies: vi.fn(), removeProfile: vi.fn() };
    const bridge = createYtmApiBridge({ store, safeStorage, fetch: vi.fn(), evaluate: vi.fn(), loadLibraries: async () => libraries, log, warn, wait,
        mintToken: vi.fn(), now: () => time, browserSignIn, browserName: () => AGENT });
    return { bridge, store, asked, created, log, warn, wait };
};

describe('the save button of a page of YouTube Music\'s web client', () => {
    it('is the toggle among the header\'s buttons that likes a list, and says whether the list is saved', () => {
        expect(webSaves.savedStateOf(savablePage(true, ALBUM_LIST))).toBe(true);
        expect(webSaves.savedStateOf(savablePage(false, PLAYLIST))).toBe(false);
        expect(webSaves.saveCommandOf(savablePage(false, PLAYLIST), true)).toEqual({ playlistId: PLAYLIST });
        expect(webSaves.saveCommandOf(savablePage(true, PLAYLIST), false)).toEqual({ playlistId: PLAYLIST });
        // The toggle of the description and a row's own like button are not it.
        for (const page of [pageWithoutButton, rowsAlone, {}, null]) {
            expect(webSaves.savedStateOf(page)).toBeUndefined();
            expect(webSaves.saveCommandOf(page, true)).toBeUndefined();
        }
        // Nor is a toggle that likes a list anywhere else on the page, or one in the header that likes a song.
        const elsewhere = marked('1', { contents: [saveButton(true, PLAYLIST), header([{ toggleButtonRenderer: {
            isToggled: true, defaultServiceEndpoint: { likeEndpoint: { status: 'LIKE', target: { videoId: VIDEO } } },
        } }])] });
        expect(webSaves.savedStateOf(elsewhere)).toBeUndefined();
    });

    it('names the like to take the list out only where the button has one', () => {
        const page = savablePage(true, PLAYLIST, { toggledServiceEndpoint: { likeEndpoint: { status: 'INDIFFERENT' } } });
        expect(webSaves.savedStateOf(page)).toBe(true);
        expect(webSaves.saveCommandOf(page, true)).toEqual({ playlistId: PLAYLIST });
        expect(webSaves.saveCommandOf(page, false)).toBeUndefined();
    });
});

describe('YouTube Music desktop bridge: changes to the account of the web sign-in', () => {
    it('reads whether an album is saved off the album\'s own page, and whether a playlist is off the page of its id', async () => {
        let saved = true;
        const { bridge, asked, created, log } = setup({ answer: (_endpoint, body) => savablePage(saved, body.browseId === ALBUM ? BUTTON_LIST : PLAYLIST) });
        expect(await bridge.request('list_saved', { id: ALBUM_LIST, albumId: ALBUM })).toEqual({ ok: true, data: { saved: true } });
        expect(log).toHaveBeenLastCalledWith(`[Ytm] List ${ALBUM_LIST} is in the library`);
        saved = false;
        expect(await bridge.request('list_saved', { id: PLAYLIST })).toEqual({ ok: true, data: { saved: false } });
        expect(log).toHaveBeenLastCalledWith(`[Ytm] List ${PLAYLIST} is not in the library`);
        expect(asked).toEqual([browse(ALBUM), browse(`VL${PLAYLIST}`)]);
        expect(created).toEqual(['web']);
    });

    it.each([['true', '/like/like', 'saved to'], ['false', '/like/removelike', 'taken out of']])(
        'changes an album (saved: %s) as the like its page\'s save button names, and is done once that page shows it', async (saved, endpoint, words) => {
            // The page is read first, for its save button; it shows the change on the third read after.
            let reads = 0;
            const { bridge, asked, log, warn, wait } = setup({ answer: asking => (asking === '/browse'
                ? savablePage((++reads >= 4) === (saved === 'true'), BUTTON_LIST)
                : marked('1')) });
            expect(await bridge.request('list_save', { id: ALBUM_LIST, albumId: ALBUM, saved })).toEqual({ ok: true, data: true });
            expect(asked).toEqual([browse(ALBUM), [endpoint, { client: 'YTMUSIC', parse: false, target: { playlistId: BUTTON_LIST } }], browse(ALBUM), browse(ALBUM), browse(ALBUM)]);
            // Each read comes after a wait, the first one too.
            expect(wait.mock.calls).toEqual([[500], [500], [500]]);
            expect(log).toHaveBeenCalledWith(`[Ytm] List ${ALBUM_LIST} is changed as list ${BUTTON_LIST}, which its save button names`);
            expect(log).toHaveBeenLastCalledWith(`[Ytm] List ${ALBUM_LIST} ${words} the library (shown after 3 read(s))`);
            expect(warn).not.toHaveBeenCalled();
        },
    );

    it('saves a playlist that is somebody else\'s by the page of its own id, with the parameters its button carries', async () => {
        let saved = false;
        const commands = { defaultServiceEndpoint: like('LIKE', PLAYLIST, { likeParams: 'save-parameters' }), toggledServiceEndpoint: like('INDIFFERENT', PLAYLIST, { removeLikeParams: 'remove-parameters' }) };
        const { bridge, asked, log } = setup({ answer: asking => {
            if (asking === '/browse') return savablePage(saved, PLAYLIST, commands);
            saved = !saved;
            return marked('1');
        } });
        expect(await bridge.request('list_save', { id: PLAYLIST, saved: 'true' })).toEqual({ ok: true, data: true });
        expect(await bridge.request('list_save', { id: PLAYLIST, saved: 'false' })).toEqual({ ok: true, data: true });
        const read = browse(`VL${PLAYLIST}`);
        expect(asked).toEqual([
            read, ['/like/like', { client: 'YTMUSIC', parse: false, target: { playlistId: PLAYLIST }, params: 'save-parameters' }], read,
            read, ['/like/removelike', { client: 'YTMUSIC', parse: false, target: { playlistId: PLAYLIST }, params: 'remove-parameters' }], read,
        ]);
        // A like of the page's own list is not worth a line.
        expect(log.mock.calls.filter(([line]) => String(line).includes('is changed as'))).toEqual([]);
    });

    it('sends no change for a page without a save button, nor for the liked list or an album id that is none', async () => {
        const { bridge, asked } = setup({ answer: (_endpoint, body) => (body.browseId === `VL${ALBUM_LIST}` ? rowsAlone : pageWithoutButton) });
        const notOffered = { ok: false, error: { code: 'invalid-response', message: 'YouTube Music does not offer to save this list' } };
        // An album the renderer has no page id of: the page of its list has the rows and no header.
        expect(await bridge.request('list_save', { id: ALBUM_LIST, saved: 'true' })).toEqual(notOffered);
        expect(await bridge.request('list_saved', { id: ALBUM_LIST })).toEqual({ ok: false, error: { code: 'invalid-response', message: 'YouTube Music did not say whether the list is saved' } });
        // A playlist the account made.
        expect(await bridge.request('list_save', { id: OWN_PLAYLIST, saved: 'true' })).toEqual(notOffered);
        expect(asked).toEqual([browse(`VL${ALBUM_LIST}`), browse(`VL${ALBUM_LIST}`), browse(`VL${OWN_PLAYLIST}`)]);
        // The liked list is refused by its id, and an album id of another kind before anything is read.
        expect(await bridge.request('list_save', { id: 'LM', saved: 'true' })).toEqual({ ok: false, error: { code: 'invalid-response', message: 'Invalid list change' } });
        for (const albumId of [ALBUM_LIST, 'MPRE/x', '', 7]) {
            for (const [operation, params] of [['list_saved', {}], ['list_save', { saved: 'true' }]] as const) {
                expect(await bridge.request(operation, { id: ALBUM_LIST, albumId, ...params })).toEqual({ ok: false, error: { code: 'invalid-response', message: 'Invalid album id' } });
            }
        }
        expect(asked).toHaveLength(3);
    });

    it('sends no like where the page already shows what is asked for', async () => {
        let saved = true;
        const { bridge, asked, log, wait } = setup({ answer: asking => (asking === '/browse' ? savablePage(saved, PLAYLIST) : marked('1')) });
        expect(await bridge.request('list_save', { id: PLAYLIST, saved: 'true' })).toEqual({ ok: true, data: true });
        expect(log).toHaveBeenLastCalledWith(`[Ytm] List ${PLAYLIST} is already in the library; nothing was sent`);
        saved = false;
        expect(await bridge.request('list_save', { id: PLAYLIST, saved: 'false' })).toEqual({ ok: true, data: true });
        expect(log).toHaveBeenLastCalledWith(`[Ytm] List ${PLAYLIST} is already out of the library; nothing was sent`);
        // One read each, and no wait for a change to show.
        expect(asked).toEqual([browse(`VL${PLAYLIST}`), browse(`VL${PLAYLIST}`)]);
        expect(wait).not.toHaveBeenCalled();
    });

    it('sends nothing for an album whose save button names no like for the change, and the list\'s own id only for the page of that id', async () => {
        // A saved list whose button says how to save it and not how to take it out.
        const commands = { toggledServiceEndpoint: { likeEndpoint: { status: 'INDIFFERENT' } } };
        const album = setup({ answer: asking => (asking === '/browse' ? savablePage(true, BUTTON_LIST, commands) : marked('1')) });
        // The page read is the album's own: a like of the list the renderer named would change a list nobody read.
        expect(await album.bridge.request('list_save', { id: ALBUM_LIST, albumId: ALBUM, saved: 'false' }))
            .toEqual({ ok: false, error: { code: 'invalid-response', message: 'YouTube Music does not offer to save this list' } });
        expect(album.asked).toEqual([browse(ALBUM)]);
        expect(album.warn).toHaveBeenCalledExactlyOnceWith(`[Ytm] The save button on the album page of list ${ALBUM_LIST} names no like; nothing is sent`);

        let saved = true;
        const playlist = setup({ answer: asking => {
            if (asking === '/browse') return savablePage(saved, PLAYLIST, commands);
            saved = false;
            return marked('1');
        } });
        expect(await playlist.bridge.request('list_save', { id: PLAYLIST, saved: 'false' })).toEqual({ ok: true, data: true });
        expect(playlist.asked[1]).toEqual(['/like/removelike', { client: 'YTMUSIC', parse: false, target: { playlistId: PLAYLIST } }]);
        expect(playlist.warn).toHaveBeenCalledExactlyOnceWith(`[Ytm] The save button of list ${PLAYLIST} names no like; the list's own id is used`);
    });

    it('takes a page read that fails for one that has not shown the change yet, and reports a change YouTube never shows', async () => {
        let reads = 0;
        const flaky = setup({ answer: asking => {
            if (asking !== '/browse') return marked('1');
            reads += 1;
            if (reads === 2) throw new Error('fetch failed');
            return savablePage(reads === 1, PLAYLIST);
        } });
        expect(await flaky.bridge.request('list_save', { id: PLAYLIST, saved: 'false' })).toEqual({ ok: true, data: true });
        expect(flaky.asked).toHaveLength(4);
        expect(flaky.log).toHaveBeenLastCalledWith(`[Ytm] List ${PLAYLIST} taken out of the library (shown after 2 read(s))`);

        const never = setup({ answer: asking => (asking === '/browse' ? savablePage(false, PLAYLIST) : marked('1')) });
        expect(await never.bridge.request('list_save', { id: PLAYLIST, saved: 'true' })).toEqual({ ok: false, error: { code: 'unavailable', message: 'YouTube Music did not change the list' } });
        expect(never.asked).toHaveLength(22);
        expect(never.wait).toHaveBeenCalledTimes(20);
        expect(never.warn).toHaveBeenCalledExactlyOnceWith(`[Ytm] List ${PLAYLIST} still not in the library after 20 reads of its page`);
    });

    it('stops reading on an answer given as to a guest, without sending the change a second time', async () => {
        let reads = 0;
        const { bridge, store, asked } = setup({ answer: asking => {
            if (asking !== '/browse') return marked('1');
            reads += 1;
            return reads === 2 ? marked('0') : savablePage(false, PLAYLIST);
        } });
        // The account itself still answers, so the sign-in stays (withWeb).
        expect(await bridge.request('list_save', { id: PLAYLIST, saved: 'true' })).toEqual({ ok: false, error: { code: 'unavailable', message: 'YouTube Music did not answer as the account' } });
        expect(asked.map(([endpoint]) => endpoint)).toEqual(['/browse', '/like/like', '/browse', '/account/accounts_list']);
        expect(store.get(WEB_SESSION_KEY)).toBeDefined();
    });

    it('changes an own playlist as the web client, and says the word YouTube refused with', async () => {
        let answer: unknown = marked('1', { status: 'STATUS_SUCCEEDED' });
        const { bridge, asked, created, log, warn } = setup({ answer: () => {
            if (answer instanceof Error) throw answer;
            return answer;
        } });
        expect(await bridge.request('playlist_edit', { id: OWN_PLAYLIST, action: 'add', videoIds: `${VIDEO},ZRtdQ81jPUQ` })).toEqual({ ok: true, data: true });
        expect(await bridge.request('playlist_edit', { id: OWN_PLAYLIST, action: 'remove', videoIds: VIDEO })).toEqual({ ok: true, data: true });
        expect(asked).toEqual([
            ['/browse/edit_playlist', { client: 'YTMUSIC', parse: false, playlistId: OWN_PLAYLIST, actions: [
                { action: 'ACTION_ADD_VIDEO', addedVideoId: VIDEO, dedupeOption: 'DEDUPE_OPTION_DROP_DUPLICATE' },
                { action: 'ACTION_ADD_VIDEO', addedVideoId: 'ZRtdQ81jPUQ', dedupeOption: 'DEDUPE_OPTION_DROP_DUPLICATE' },
            ] }],
            ['/browse/edit_playlist', { client: 'YTMUSIC', parse: false, playlistId: OWN_PLAYLIST, actions: [{ action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: VIDEO }] }],
        ]);
        expect(log).toHaveBeenCalledWith('[Ytm] Playlist change: add 2 song(s)');
        expect(log).toHaveBeenLastCalledWith('[Ytm] Playlist change: remove 1 song(s)');
        expect(created).toEqual(['web']);

        // An answer that does not say the change was made, with a status word and with none.
        answer = marked('1', { status: 'STATUS_FAILED' });
        const refused = { ok: false, error: { code: 'unavailable', message: 'YouTube Music did not change the playlist' } };
        expect(await bridge.request('playlist_edit', { id: OWN_PLAYLIST, action: 'remove', videoIds: VIDEO })).toEqual(refused);
        expect(warn).toHaveBeenLastCalledWith('[Ytm] Playlist change refused: unavailable (STATUS_FAILED)');
        answer = marked('1');
        expect(await bridge.request('playlist_edit', { id: OWN_PLAYLIST, action: 'remove', videoIds: VIDEO })).toEqual(refused);
        expect(warn).toHaveBeenLastCalledWith('[Ytm] Playlist change refused: unavailable (no status)');
        // A request YouTube does not take at all.
        answer = new Error('Request to https://music.youtube.com/youtubei/v1/browse/edit_playlist?prettyPrint=false failed with status code 400');
        expect(await bridge.request('playlist_edit', { id: OWN_PLAYLIST, action: 'remove', videoIds: VIDEO })).toEqual({ ok: false, error: { code: 'invalid-response', message: 'YouTube Music operation failed' } });
        expect(warn).toHaveBeenLastCalledWith('[Ytm] playlist_edit failed: invalid-response (Request to <address> failed with status code 400)');
        expect(warn).toHaveBeenCalledTimes(3);
    });

    it('removes the row a request names, and a song whose row it does not name by the song\'s id', async () => {
        const other = 'ZRtdQ81jPUQ';
        const { bridge, asked, log } = setup({ answer: () => marked('1', { status: 'STATUS_SUCCEEDED' }) });
        expect(await bridge.request('playlist_edit', { id: OWN_PLAYLIST, action: 'remove', videoIds: `${VIDEO},${other}`, setVideoIds: 'ROW-1_a,' })).toEqual({ ok: true, data: true });
        expect(asked).toEqual([['/browse/edit_playlist', { client: 'YTMUSIC', parse: false, playlistId: OWN_PLAYLIST, actions: [
            { action: 'ACTION_REMOVE_VIDEO', setVideoId: 'ROW-1_a', removedVideoId: VIDEO },
            { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: other },
        ] }]]);
        expect(log).toHaveBeenLastCalledWith('[Ytm] Playlist change: remove 2 song(s), 1 by the id of their row');
        // Rows are named one for each song, for a removal only, and as YouTube writes their ids.
        for (const params of [{ action: 'remove', setVideoIds: 'ROW1' }, { action: 'remove', setVideoIds: 'ROW1,ROW2,ROW3' }, { action: 'remove', setVideoIds: 'ROW1,RO W2' },
            { action: 'remove', setVideoIds: 7 }, { action: 'add', setVideoIds: 'ROW1,ROW2' }, { action: 'add', setVideoIds: ',' }]) {
            expect(await bridge.request('playlist_edit', { id: OWN_PLAYLIST, videoIds: `${VIDEO},${other}`, ...params })).toMatchObject({ ok: false, error: { code: 'invalid-response' } });
        }
        expect(asked).toHaveLength(1);
    });

    it('changes none of the lists the account did not make as a playlist: its liked music, its liked videos, its watch-later list', async () => {
        const { bridge, asked, created } = setup({ answer: () => marked('1', { status: 'STATUS_SUCCEEDED' }) });
        for (const id of ['LM', 'LL', 'WL']) {
            for (const action of ['add', 'remove']) {
                expect(await bridge.request('playlist_edit', { id, action, videoIds: VIDEO })).toEqual({ ok: false, error: { code: 'invalid-response', message: 'Invalid playlist change' } });
            }
        }
        expect(asked).toEqual([]);
        expect(created).toEqual([]);
    });

    it('likes a song as the web client and takes the like back', async () => {
        const { bridge, asked, log } = setup();
        expect(YTM_OPERATIONS).toContain('song_like');
        expect(await bridge.request('song_like', { id: VIDEO, liked: 'true' })).toEqual({ ok: true, data: true });
        expect(log).toHaveBeenLastCalledWith(`[Ytm] Song ${VIDEO} liked`);
        expect(await bridge.request('song_like', { id: VIDEO, liked: 'false' })).toEqual({ ok: true, data: true });
        expect(log).toHaveBeenLastCalledWith(`[Ytm] Song ${VIDEO} no longer liked`);
        expect(asked).toEqual([
            ['/like/like', { client: 'YTMUSIC', parse: false, target: { videoId: VIDEO } }],
            ['/like/removelike', { client: 'YTMUSIC', parse: false, target: { videoId: VIDEO } }],
        ]);
        for (const params of [{ id: 'short', liked: 'true' }, { id: `${VIDEO}/x`, liked: 'true' }, { liked: 'true' }, { id: VIDEO }, { id: VIDEO, liked: true }, { id: VIDEO, liked: 'yes' }]) {
            expect(await bridge.request('song_like', params)).toEqual({ ok: false, error: { code: 'invalid-response', message: 'Invalid song like' } });
        }
        expect(asked).toHaveLength(2);
    });

    it('does not take a like answered as to a guest for done', async () => {
        const { bridge, asked, log } = setup({ answer: asking => marked(asking === '/like/like' ? '0' : '1') });
        expect(await bridge.request('song_like', { id: VIDEO, liked: 'true' })).toEqual({ ok: false, error: { code: 'unavailable', message: 'YouTube Music did not answer as the account' } });
        expect(asked.map(([endpoint]) => endpoint)).toEqual(['/like/like', '/account/accounts_list']);
        expect(log).not.toHaveBeenCalledWith(`[Ytm] Song ${VIDEO} liked`);
    });

    // An answer of status 200 with no mark, with an error's body or with no body says nothing of
    // who was answered; a status word in it does not either.
    it.each([['no mark', {}], ['no body', undefined], ['an error\'s body', { error: { code: 403 } }], ['a status word and no mark', { status: 'STATUS_SUCCEEDED' }]])(
        'takes no change for made whose answer has %s', async (_what, answer) => {
            const { bridge, store, asked, log, warn } = setup({ answer: asking => (asking === '/browse' ? savablePage(false, PLAYLIST) : answer) });
            const notTheAccount = { ok: false, error: { code: 'unavailable', message: 'YouTube Music did not answer as the account' } };
            expect(await bridge.request('song_like', { id: VIDEO, liked: 'true' })).toEqual(notTheAccount);
            expect(await bridge.request('playlist_edit', { id: OWN_PLAYLIST, action: 'add', videoIds: VIDEO })).toEqual(notTheAccount);
            expect(await bridge.request('list_save', { id: PLAYLIST, saved: 'true' })).toEqual(notTheAccount);
            // Each change went out once. The account is not asked for again (the answer was not a
            // guest's), and the list's page is not read for a change nobody knows was made.
            expect(asked.map(([endpoint]) => endpoint)).toEqual(['/like/like', '/browse/edit_playlist', '/browse', '/like/like']);
            expect(warn.mock.calls).toEqual(['/like/like', '/browse/edit_playlist', '/like/like']
                .map(endpoint => [`[Ytm] The answer to ${endpoint} is not marked as given to the account; the change is not taken for made`]));
            expect(log.mock.calls.flat().join('\n')).not.toMatch(/liked|Playlist change|the library/);
            expect(store.get(WEB_SESSION_KEY)).toBeDefined();
        },
    );

    it('keeps the account out of the log and out of its answers', async () => {
        let saved = false;
        const { bridge, log, warn } = setup({ answer: (asking, body) => {
            if (asking === '/browse') return body.browseId === `VL${OWN_PLAYLIST}` ? pageWithoutButton : savablePage(saved, BUTTON_LIST);
            if (asking === '/browse/edit_playlist') return marked('1', { status: body.actions[0].action === 'ACTION_ADD_VIDEO' ? 'STATUS_SUCCEEDED' : 'STATUS_FAILED' });
            if (asking !== '/like/like' || !body.target.playlistId) return marked('1');
            saved = true;
            return marked('1');
        } });
        const answers = [
            await bridge.request('list_saved', { id: ALBUM_LIST, albumId: ALBUM }),
            await bridge.request('list_save', { id: ALBUM_LIST, albumId: ALBUM, saved: 'true' }),
            await bridge.request('list_saved', { id: OWN_PLAYLIST }),
            await bridge.request('list_save', { id: OWN_PLAYLIST, saved: 'true' }),
            await bridge.request('playlist_edit', { id: OWN_PLAYLIST, action: 'add', videoIds: VIDEO }),
            await bridge.request('playlist_edit', { id: OWN_PLAYLIST, action: 'remove', videoIds: VIDEO }),
            await bridge.request('song_like', { id: VIDEO, liked: 'true' }),
        ];
        expect(answers.map(answer => answer.ok)).toEqual([true, true, false, false, true, false, true]);
        const told = JSON.stringify([answers, log.mock.calls, warn.mock.calls]);
        for (const secret of SECRETS) expect(told).not.toContain(secret);
    });
});
