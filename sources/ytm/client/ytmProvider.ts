import type {
    FoliumSourceAudioQuality, FoliumSourceCollection, FoliumSourceDef, FoliumSourcePage, FoliumSourcePageStore, FoliumSourceSearchContext,
    FoliumSourceSong, FoliumSourceUser, FoliumText,
} from '@folia/folium';
import { noteYtmAccount, ytmHasPremium } from './ytmAccount';
import { requestYtm } from './ytmTransport';
import type { YtmWireCollection, YtmWirePage, YtmWireSong, YtmWireWebLoginState } from './ytmTransport';
import { createYtmPager, normalizeYtmCollection, normalizeYtmSong, normalizeYtmUser } from './ytmNormalize';
import { clearYtmCatalogCache, ytmCatalog } from './ytmCatalog';
import { clearYtmLibraryCache, createYtmLibrary } from './ytmLibrary';
import { connectYtmExplore, forgetYtmMusicPage, ytmExplore } from './ytmExplore';
import { ytmMutations } from './ytmMutations';
import { resetYtmRecommendations, ytmRecommendations } from './ytmRecommendations';
import { describeYtmLoginFailure, ytmLoginFailure } from './ytmLoginFailure';
import { describeYtmFailure } from './ytmFailure';

// sources/ytm/client/ytmProvider.ts
// The YouTube Music source (what folium.sources.register takes). Sign-in is made in the person's own browser:
// the main entry opens a window of it, the person signs in to Google there and closes the window.
// The host's switches follow from the capabilities implemented (the adapter's parts.ts), as the built-in
// provider's hand-written table had them: albums, artists, playlists, the account's albums, likes, playlist
// edits, saving albums and other people's playlists; line-timed lyrics only; a radio tab (the personal FM and
// the account's music page) and an explore tab; no daily songs.

/** What the definition needs of the host besides the transport. */
export interface YtmSourceEnv {
    /** A text of the mod's locale files, as a key the host follows across languages. */
    text(key: string, params?: Record<string, string | number>): FoliumText;
    /** The same, written out in the UI language now. */
    translate(key: string): string;
    /** The source's page store (the Premium note, the account's own playlists); null where there is none. */
    store: FoliumSourcePageStore | null;
    /** Whether the app runs on macOS: a browser there goes on running after its last window is closed. */
    isMac: boolean;
}

// How long the window waits for a sign-in in the browser. The main entry ends a browser still open after
// 10 minutes and then reads what it left, and settles every sign-in itself (main/webSignIn.cjs); this limit
// comes after that read is over, or a sign-in made in a window left open would be cancelled while it is read.
const WEB_LOGIN_TTL_MS = 12 * 60 * 1000;

// A letter of any script but Latin.
const NON_LATIN_LETTER = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
// A line of LRC with its time and some words: the lyrics are timed where there is one.
const TIMED_LINE = /^[^\S\r\n]*(?:\[\d{1,4}:\d{1,2}(?:[.:]\d{1,3})?\])+[^\S\r\n]*\S/gm;

/** The source of the manifest's `sources[0]` (id `ytm`). */
export const createYtmSource = (env: YtmSourceEnv): FoliumSourceDef => {
    const searchPager = createYtmPager<FoliumSourceSong>();
    // The searches of callers beside the host's own screen (a mod, through Folium's `folium.omni`), which name
    // themselves with a `session`: walked in a pager of their own, by session and text, so that such a search
    // never starts the listener's search over, and the walks it keeps only ever make room among themselves.
    const sessionSearchPager = createYtmPager<FoliumSourceSong>();
    // Album and playlist searches, walked by kind and text as songs are.
    const collectionSearchPager = createYtmPager<FoliumSourceCollection>();
    const searchYtmCollections = (kind: 'album' | 'playlist', query: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>> => {
        const text = query.trim();
        if (!text) return Promise.resolve({ items: [], total: 0, nextOffset: offset, hasMore: false });
        return collectionSearchPager.page(`${kind}:${text}`, offset, limit, async continuation => {
            const page = await requestYtm<YtmWirePage<YtmWireCollection>>(
                kind === 'album' ? 'search_albums' : 'search_playlists',
                continuation ? { continuation } : { query: text },
            );
            return { items: page.items.map(item => normalizeYtmCollection(item, kind)), continuation: page.continuation };
        });
    };
    // The key of the sign-in in progress.
    let activeLogin: string | null = null;
    // Sign-in attempts begun. The main entry has one sign-in at a time and no key for it, so its key is made
    // here. Only the newest attempt becomes `activeLogin`: an earlier one that is answered late and then given
    // up must not cancel the newest one's window.
    let loginStarts = 0;

    const forgetPages = (): void => {
        searchPager.clear();
        sessionSearchPager.clear();
        collectionSearchPager.clear();
        clearYtmCatalogCache();
        clearYtmLibraryCache();
        forgetYtmMusicPage();
    };
    // The main entry asks for pages in the app's language, and one read before the language changed names its
    // songs in the previous one. A mod is told of no change of language: the mod's own `pageLanguage` text is one
    // word per language (the host makes the Traditional Chinese one of the Simplified one), and every call into
    // the source first checks it against the one its pages were read in.
    let pageLanguage = env.translate('pageLanguage');
    const checkLanguage = (): void => {
        const now = env.translate('pageLanguage');
        if (now === pageLanguage) return;
        pageLanguage = now;
        console.log('[Ytm] The app\'s language changed: the pages read in the previous one are forgotten');
        forgetPages();
    };
    // A capability whose methods check the language first; getters and plain values stay as they are.
    const following = <T extends object>(members: T): T => {
        const wrapped = {} as T;
        for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(members))) {
            const value: unknown = descriptor.value;
            if (typeof value === 'function') {
                const method = value as (...args: unknown[]) => unknown;
                Object.defineProperty(wrapped, name, {
                    ...descriptor,
                    value: (...args: unknown[]) => { checkLanguage(); return method.apply(members, args); },
                });
            } else {
                Object.defineProperty(wrapped, name, descriptor);
            }
        }
        return wrapped;
    };

    connectYtmExplore(name => env.text('exploreSimilar', { name }));

    return {
        id: 'ytm',
        // The full name stays as the built-in provider wrote it, in every language; the short one is the mod's own.
        displayName: 'YouTube Music',
        shortName: env.text('name.short'),
        mark: { letter: 'Y', color: '#e11d48' },
        describeFailure: describeYtmFailure,
        capabilities: {
            // Searching needs no account, but the federated search lists a source with sign-in only once signed
            // in, as it did the built-in provider (crossSource.ts: a platform with auth and no declaration).
            'search@1': following({
                access: 'account' as const,
                async searchSongs(query: string, limit: number, offset: number, context?: FoliumSourceSearchContext) {
                    const text = query.trim();
                    if (!text) return { items: [], total: 0, nextOffset: offset, hasMore: false };
                    const session = context?.session;
                    const pager = session === undefined ? searchPager : sessionSearchPager;
                    const key = session === undefined ? `search:${text}` : `search:${session}\n${text}`;
                    return pager.page(key, offset, limit, async continuation => {
                        const page = await requestYtm<YtmWirePage<YtmWireSong>>('search_songs', continuation ? { continuation } : { query: text });
                        return { items: page.items.map(normalizeYtmSong), continuation: page.continuation };
                    });
                },
                searchAlbums: (query: string, limit: number, offset: number) => searchYtmCollections('album', query, limit, offset),
                searchPlaylists: (query: string, limit: number, offset: number) => searchYtmCollections('playlist', query, limit, offset),
            }),
            'songs@1': following({
                async getSong(id: string) {
                    const detail = await requestYtm<YtmWireSong | null>('song_detail', { id });
                    return detail ? normalizeYtmSong(detail) : null;
                },
                // A music video a list showed as itself, its song not known in time, is played as that song.
                async getPlayedSong(song: FoliumSourceSong) {
                    const { song: played } = await requestYtm<{ song: YtmWireSong | null }>('played_as', { id: song.id });
                    return played && normalizeYtmSong(played);
                },
            }),
            'playback.audio@1': following({
                // The levels YouTube Music's audio differs at: the main entry picks the format by the level
                // (`pickAudioFormat` in main/ytmApiBridge.cjs). 'ultra' (about 256 kbit/s) is offered to a Premium
                // member only: it is listed while the signed-in account has Premium (ytmAccount.ts, which has the
                // host read this again when that flips).
                get audioQualityLevels(): readonly FoliumSourceAudioQuality[] {
                    return ytmHasPremium() ? ['standard', 'high', 'ultra'] : ['standard', 'high'];
                },
                // The address is served by the main entry itself (its `_media/audio` route) and is new on every
                // call: its key works once. It names the level, and the main entry keeps a track once for each
                // level: a song buffered at one level is fetched anew when asked at the other. A song that cannot
                // be had at 'ultra' is served at 'high': the answer then names that level, so a copy kept of the
                // song is of the level it was served at.
                async getAudioSource(song: FoliumSourceSong, quality: FoliumSourceAudioQuality) {
                    const startedAt = Date.now();
                    const audio = await requestYtm<{ url: string; route: string; itag?: number; bitrate?: number; level?: 'high'; loudnessDb?: number }>('audio', { id: song.id, quality });
                    const served = audio.level ?? quality;
                    const format = audio.itag ? ` (itag ${audio.itag}, ${Math.round((audio.bitrate ?? 0) / 1000)} kbit/s)` : '';
                    console.log(`[Ytm] Audio for "${song.title}" (${song.id}) at ${quality}${served === quality ? '' : ` (served at ${served})`} is ready by the ${audio.route} route${format} after ${Date.now() - startedAt}ms`);
                    // YouTube turns a track down by how much louder than its playback level it is: that is its
                    // track gain. A quieter one it leaves as it is, and so does this: with no peak known, a lift could clip.
                    const replayGain = typeof audio.loudnessDb === 'number' && Number.isFinite(audio.loudnessDb) ? { trackGain: Math.min(0, -audio.loudnessDb) } : undefined;
                    return { url: audio.url, quality: served, ...(replayGain ? { replayGain } : {}) };
                },
            }),
            'lyrics@1': following({
                // YouTube Music's own lyrics are timed by line only. A failure to read them answers "none" instead
                // of an error, so that the cross-source lookup still runs for the song.
                async getLyrics(song: FoliumSourceSong) {
                    const data = await requestYtm<{ mainText: string } | null>('lyrics', { id: song.id }).catch(() => null);
                    const timed = data?.mainText ? data.mainText.match(TIMED_LINE)?.length ?? 0 : 0;
                    console.log(`[Ytm] Own lyrics for ${song.id}: ${timed ? `${timed} timed lines` : 'none'}`);
                    return data && timed ? { main: { format: 'lrc' as const, text: data.mainText } } : null;
                },
                // A song is named as the pages of the app's language name it, and each language renames some
                // artists: the Chinese pages give a few non-Chinese acts a Chinese name ("绿洲合唱团" for Oasis),
                // the English ones romanise Chinese names ("Eason Chan"). Other sources list an artist under one of
                // the two. A name that is not in Latin letters is looked up on the English page, any other on the
                // Chinese one; the name itself decides, because a song may have been read in another language.
                async getAlternateArtistName(song: FoliumSourceSong) {
                    const english = song.artists.some(artist => NON_LATIN_LETTER.test(artist.name));
                    const detail = await requestYtm<YtmWireSong | null>(english ? 'song_detail_en' : 'song_detail_zh', { id: song.id }).catch(() => null);
                    const other = detail?.artists.map(artist => artist.name).join(', ') || null;
                    // A playlist row names two artists in one string ("A & B") where the song page lists them
                    // apart. The same letters in the same order are the same name, not another one.
                    const letters = (names: string) => names.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
                    const same = other !== null && letters(other) === letters(song.artists.map(artist => artist.name).join(', '));
                    console.log(`[Ytm] ${english ? 'English' : 'Chinese'}-page artist of ${song.id}: ${other ?? 'none'}${same ? ' (the same)' : ''}`);
                    return same ? null : other;
                },
            }),
            'auth@1': following({
                // On macOS a browser goes on running after its last window is closed: the note says to quit it.
                getLoginTexts: () => ({
                    title: env.text('login.title'),
                    note: env.text(env.isMac ? 'login.noteMac' : 'login.note'),
                    // The main entry found none of the browsers it opens: the window then says which ones the sign-in needs.
                    caseNotes: { 'browser-unfinished': env.text('login.unfinished'), 'no-browser': env.text('login.noBrowser') },
                }),
                async getLoginStatus() {
                    const user = await requestYtm<FoliumSourceUser | null>('login_status');
                    noteYtmAccount(user);
                    return user ? normalizeYtmUser(user) : null;
                },
                // The quality levels listed depend on the account noted: the note goes with the account.
                signInRanOut() {
                    noteYtmAccount(null);
                },
                async logout() {
                    activeLogin = null;
                    noteYtmAccount(null);
                    forgetPages();
                    resetYtmRecommendations();
                    await requestYtm('logout');
                    // A sign-in status asked before the sign-out may have been answered during it, with the
                    // account that is now signed out.
                    noteYtmAccount(null);
                },
                // A sign-in begins in the browser, and a start that fails is a sign-in that failed.
                async startLogin() {
                    resetYtmRecommendations();
                    const ticket = ++loginStarts;
                    await requestYtm('web_login_start');
                    console.log('[Ytm] Sign-in begun in the browser');
                    const key = `web-${ticket}`;
                    if (ticket === loginStarts) activeLogin = key;
                    return key;
                },
                describeLoginFailure: describeYtmLoginFailure,
                async openLoginPage() { await requestYtm('web_login_open'); },
                // The window of the sign-in is opened by its start, and closing it ends the sign-in.
                opensLoginPageItself: () => true,
                // A sign-in that went through may be another account's. Until it did, the account before was
                // still signed in, and its liked list and music page may have been read again since the sign-in
                // began: the FM and the lists of the one before are forgotten here too.
                async checkLogin(key: string) {
                    // A key that is not the sign-in in progress is of one given up or replaced. The main entry has
                    // no key: a step sent for such a one would be taken for the one in progress.
                    if (activeLogin !== key) return { state: 'expired' as const };
                    const answer = await requestYtm<YtmWireWebLoginState>('web_login_check');
                    if (answer.state === 'error') {
                        const failure = ytmLoginFailure(answer.code, answer.reason, answer.message);
                        return { state: 'error' as const, message: answer.message, ...(failure ? { failure } : {}) };
                    }
                    if (answer.state === 'confirmed') {
                        // The account comes with the confirmation, as `login_status` gives it.
                        noteYtmAccount(answer.account);
                        resetYtmRecommendations();
                    }
                    return { state: answer.state };
                },
                async cancelLogin(key: string) {
                    if (activeLogin !== key) return;
                    activeLogin = null;
                    await requestYtm('web_login_cancel');
                },
                getLoginTtlMs: () => WEB_LOGIN_TTL_MS,
            }),
            'catalog@1': following(ytmCatalog),
            'library@1': following(createYtmLibrary(env.store)),
            // The radio tab (ytmRecommendations.ts): a personal FM made of song radios, and the playlists of the
            // account's music page. No daily songs, which YouTube Music has no counterpart of.
            'recommendations@1': following(ytmRecommendations),
            'explore@1': following(ytmExplore),
            'mutations@1': ytmMutations,
        },
    };
};
