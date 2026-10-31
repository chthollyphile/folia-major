import type { UnifiedSong } from '../../../types';
import type { OnlineMusicProvider, ProviderCollection, ProviderPage, ProviderUser } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { isMacPlatform } from '../../../utils/platform';
import { parseLyricsByFormat } from '../../../utils/lyrics/parserCore';
import { noteYtmAccount, ytmHasPremium } from './ytmAccount';
import { getYtmTransportAvailability, requestYtm } from './ytmTransport';
import type { YtmWireCollection, YtmWirePage, YtmWireSong, YtmWireWebLoginState } from './ytmTransport';
import { createYtmPager, normalizeYtmCollection, normalizeYtmSong, normalizeYtmUser, requireYtmSong } from './ytmNormalize';
import { clearYtmCatalogCache, ytmCatalog } from './ytmCatalog';
import { clearYtmLibraryCache, ytmLibrary } from './ytmLibrary';
import { forgetYtmMusicPage, ytmExplore } from './ytmExplore';
import { ytmMutations } from './ytmMutations';
import { resetYtmRecommendations, ytmRecommendations } from './ytmRecommendations';
import { describeYtmLoginFailure, ytmLoginFailure } from './ytmLoginFailure';
import { describeYtmFailure } from './ytmFailure';
import i18n from '../../../i18n/config';

// src/services/onlineMusic/ytm/ytmProvider.ts
// YouTube Music adapter. Sign-in is made in the person's own browser: the desktop side opens a
// window of it, the person signs in to Google there and closes the window.

// How long the window waits for a sign-in in the browser. The desktop side ends a browser still
// open after 10 minutes and then reads what it left, and settles every sign-in itself
// (electron/ytm/webSignIn.cjs); this limit comes after that read is over, or a sign-in made in a
// window left open would be cancelled while it is read.
const WEB_LOGIN_TTL_MS = 12 * 60 * 1000;

const searchPager = createYtmPager<UnifiedSong>();
// The searches of callers beside the host's own screen (a mod, through Folium's `folium.omni`),
// which name themselves with a `session`: walked in a pager of their own, by session and text, so
// that such a search never starts the listener's search over, and the walks it keeps (the pager
// holds as many as `searchPager`) only ever make room among themselves.
const sessionSearchPager = createYtmPager<UnifiedSong>();
// Album and playlist searches, walked by kind and text as songs are.
const collectionSearchPager = createYtmPager<ProviderCollection>();
const searchYtmCollections = (kind: 'album' | 'playlist', query: string, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>> => {
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
// A letter of any script but Latin.
const NON_LATIN_LETTER = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
// The key of the sign-in in progress.
let activeLogin: string | null = null;
// Sign-in attempts begun. The desktop side has one sign-in at a time and no key for it, so its
// key is made here. Only the newest attempt becomes `activeLogin`: an earlier one that is
// answered late and then given up must not cancel the newest one's window.
let loginStarts = 0;

const forgetPages = (): void => {
    searchPager.clear();
    sessionSearchPager.clear();
    collectionSearchPager.clear();
    clearYtmCatalogCache();
    clearYtmLibraryCache();
    forgetYtmMusicPage();
};
// The desktop side asks for pages in the app's language. One read before the language changed
// names its songs in the previous one.
i18n.on('languageChanged', forgetPages);

export const ytmProvider: OnlineMusicProvider = {
    id: 'ytm', displayName: 'YouTube Music', shortName: 'YT Music',
    mark: { letter: 'Y', color: '#e11d48' },
    getAvailability: getYtmTransportAvailability,
    describeFailure: describeYtmFailure,
    // `recommendations` is the radio tab (ytmRecommendations.ts): a personal FM made of song
    // radios, and the playlists of the account's music page. It has no daily songs, which YouTube
    // Music has no counterpart of. Its recommendation page is the explore tab.
    capabilities: {
        search: true, playback: true, lyrics: true, wordByWordLyrics: false, auth: true,
        userLibrary: true, playlists: true, albums: true, artists: true, userAlbums: true,
        recommendations: true, explore: true, mutations: true, playlistTrackMutations: true, likes: true,
        // Albums and other people's playlists (`mutations.canSubscribe`).
        playlistSubscription: true,
    },
    normalizeSong: normalizeYtmSong, normalizeUser: normalizeYtmUser, normalizeCollection: normalizeYtmCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        async searchSongs(query, limit, offset, context) {
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
        searchAlbums: (query, limit, offset) => searchYtmCollections('album', query, limit, offset),
        searchPlaylists: (query, limit, offset) => searchYtmCollections('playlist', query, limit, offset),
    },
    playback: {
        async getSongDetail(id) {
            const detail = await requestYtm<YtmWireSong | null>('song_detail', { id: String(id) });
            return detail ? normalizeYtmSong(detail) : null;
        },
        // The levels YouTube Music's audio differs at: the desktop side picks the format by the
        // level (`pickAudioFormat` in electron/ytm/ytmApiBridge.cjs). 'ultra' (about 256 kbit/s)
        // is offered to a Premium member only: it is listed while the signed-in account has Premium
        // and for nobody else (ytmAccount.ts).
        get audioQualityLevels() {
            return ytmHasPremium() ? ['standard', 'high', 'ultra'] as const : ['standard', 'high'] as const;
        },
        // The URL is served by the desktop app itself and is new on every call.
        // It names the level, and the desktop side keeps a track once for each level: a song buffered
        // at one level is fetched anew when asked at the other.
        // A song that cannot be had at 'ultra' is served at 'high'. The answer then names that
        // level (`level`), and so does the source handed back: a copy kept of the song is of the
        // level it was served at.
        async getAudioSource(song, quality) {
            const id = requireYtmSong(song);
            const startedAt = Date.now();
            const audio = await requestYtm<{ url: string; route: string; itag?: number; bitrate?: number; level?: 'high'; loudnessDb?: number }>('audio', { id, quality });
            const served = audio.level ?? quality;
            const format = audio.itag ? ` (itag ${audio.itag}, ${Math.round((audio.bitrate ?? 0) / 1000)} kbit/s)` : '';
            console.log(`[Ytm] Audio for "${song.name}" (${id}) at ${quality}${served === quality ? '' : ` (served at ${served})`} is ready by the ${audio.route} route${format} after ${Date.now() - startedAt}ms`);
            // YouTube turns a track down by how much louder than its playback level it is: that is its track gain.
            // A quieter one it leaves as it is, and so does this: with no peak known, a lift could clip.
            const replayGain = typeof audio.loudnessDb === 'number' && Number.isFinite(audio.loudnessDb) ? { trackGain: Math.min(0, -audio.loudnessDb) } : undefined;
            return { url: audio.url, fetchedAt: Date.now(), quality: served, ...(replayGain ? { replayGain } : {}) };
        },
        // A music video a list showed as itself, its song not known in time, is played as that song.
        async getPlayedSong(song) {
            const { song: played } = await requestYtm<{ song: YtmWireSong | null }>('played_as', { id: requireYtmSong(song) });
            return played && normalizeYtmSong(played);
        },
    },
    lyrics: {
        // YouTube Music's own lyrics are timed by line only. A failure to read them answers "none"
        // instead of an error, so that the cross-source lookup still runs for the song.
        async getLyrics(song) {
            const id = requireYtmSong(song);
            const data = await requestYtm<{ mainText: string } | null>('lyrics', { id }).catch(() => null);
            const lyrics = data ? parseLyricsByFormat('lrc', data.mainText) : null;
            console.log(`[Ytm] Own lyrics for ${id}: ${lyrics?.lines.length ? `${lyrics.lines.length} timed lines` : 'none'}`);
            if (!data || !lyrics?.lines.length) return { lyrics: null, isPureMusic: false };
            return { lyrics, mainText: data.mainText, isPureMusic: false };
        },
        // A song is named as the pages of the app's language name it, and each language renames some
        // artists: the Chinese pages give a few non-Chinese acts a Chinese name ("绿洲合唱团" for
        // Oasis), the English ones romanise Chinese names ("Eason Chan"). Other sources list an
        // artist under one of the two. A name that is not in Latin letters is looked up on the
        // English page, any other on the Chinese one; the name itself decides, because a song may
        // have been read when the app was in another language.
        async getAlternateArtistName(song) {
            const id = requireYtmSong(song);
            const english = song.artists.some(artist => NON_LATIN_LETTER.test(artist.name));
            const detail = await requestYtm<YtmWireSong | null>(english ? 'song_detail_en' : 'song_detail_zh', { id }).catch(() => null);
            const other = detail?.artists.map(artist => artist.name).join(', ') || null;
            // A playlist row names two artists in one string ("A & B") where the song page lists
            // them apart. The same letters in the same order are the same name, not another one.
            const letters = (names: string) => names.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
            const same = other !== null && letters(other) === letters(song.artists.map(artist => artist.name).join(', '));
            console.log(`[Ytm] ${english ? 'English' : 'Chinese'}-page artist of ${id}: ${other ?? 'none'}${same ? ' (the same)' : ''}`);
            return same ? null : other;
        },
    },
    auth: {
        // On macOS a browser goes on running after its last window is closed: the note says to quit it.
        getLoginTexts: () => ({
            title: 'home.loginTitleYtm',
            note: isMacPlatform ? 'home.loginNoteYtmBrowserMac' : 'home.loginNoteYtmBrowser',
            // The desktop side found none of the browsers it opens: the window then says which ones the sign-in needs.
            caseNotes: { 'browser-unfinished': 'home.loginCaseYtmUnfinished', 'no-browser': 'home.loginNoBrowserYtm' },
        }),
        async getLoginStatus() {
            const user = await requestYtm<ProviderUser | null>('login_status');
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
        // A sign-in that went through may be another account's. Until it did, the account before
        // was still signed in, and its liked list and music page may have been read again since
        // the sign-in began: the FM and the lists of the one before are forgotten here too.
        async checkLogin(key) {
            // A key that is not the sign-in in progress is of one given up or replaced. The desktop
            // side has no key: a step sent for such a one would be taken for the one in progress.
            if (activeLogin !== key) return { state: 'expired' };
            const answer = await requestYtm<YtmWireWebLoginState>('web_login_check');
            if (answer.state === 'error') {
                const failure = ytmLoginFailure(answer.code, answer.reason, answer.message);
                return { state: 'error', message: answer.message, ...(failure ? { failure } : {}) };
            }
            if (answer.state === 'confirmed') {
                // The account comes with the confirmation, as `login_status` gives it.
                noteYtmAccount(answer.account);
                resetYtmRecommendations();
            }
            return { state: answer.state };
        },
        async cancelLogin(key) {
            if (activeLogin !== key) return;
            activeLogin = null;
            await requestYtm('web_login_cancel');
        },
        getLoginTtlMs: () => WEB_LOGIN_TTL_MS,
    },
    catalog: ytmCatalog,
    library: ytmLibrary,
    recommendations: ytmRecommendations,
    explore: ytmExplore,
    mutations: ytmMutations,
};
