import type { UnifiedSong } from '../../../types';
import type { OnlineMusicProvider, ProviderUser, LoginState } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { parseLyricsByFormat } from '../../../utils/lyrics/parserCore';
import { formatLrcTimestamp } from '../../../utils/lyrics/lrcTimestamp';
import i18n from '../../../i18n/config';
import { cacheLimitBytes } from '../../audioCache';
import { getSpotifyTransportAvailability, querySpotify, requestSpotify } from './spotifyTransport';
import type { SpotifyWireAudio, SpotifyWireLoginStart, SpotifyWireLyrics } from './spotifyTransport';
import {
    normalizeSpotifyCollection, normalizeSpotifySong, normalizeSpotifyUser, present, requireSpotifySong, spotifySongOf, spotifyUri,
} from './spotifyNormalize';
import type { SpotifyArtistRow, SpotifyTrack } from './spotifyNormalize';
import { clearSpotifyCatalogCache, spotifyCatalog } from './spotifyCatalog';
import { spotifyExplore } from './spotifyExplore';
import { spotifyLibrary } from './spotifyLibrary';
import { spotifyMutations } from './spotifyMutations';
import { resetSpotifyRecommendations, spotifyRecommendations } from './spotifyRecommendations';
import { describeSpotifyLoginFailure, spotifyLoginFailure } from './spotifyLoginFailure';
import { describeSpotifyFailure } from './spotifyFailure';

// src/services/onlineMusic/spotify/spotifyProvider.ts
// Spotify adapter. Sign-in happens in the browser where the person is already signed in to
// Spotify: the app opens Spotify's consent page and waits for the answer; nothing is typed here.

const DEFAULT_LOGIN_TTL_MS = 10 * 60 * 1000;
// How much longer than the attempt the window waits. A sign-in Spotify approved near the attempt's end
// has its account read again, after a line that failed, for up to 60 s from the first read
// (ACCOUNT_RETRY_MS in electron/spotify/spotifyApiBridge.cjs), and one read takes up to 30 s
// (REQUEST_LIMIT_MS there). Ending sooner would tell that sign-in as not finished in the browser,
// where the desktop side was about to say why it stopped. An attempt nobody approved still ends at its
// own time: the desktop side answers it expired then.
const LOGIN_SETTLE_MS = 60 * 1000 + 30 * 1000;
const SEARCH_ROWS = 50;
// A search is walked this many rows deep at most.
const SEARCH_MAX_ROWS = 300;

interface SearchAnswer { searchV2?: { tracksV2?: { items?: Array<{ item?: { data?: SpotifyTrack } }> } } }
// A track read on its own lists its first artist apart from the others.
interface TrackAnswer {
    trackUnion?: SpotifyTrack & { firstArtist?: { items?: SpotifyArtistRow[] }; otherArtists?: { items?: SpotifyArtistRow[] } };
}

// How far one search has been read: `asked` rows of Spotify's, which made `songs`. Calls for one
// search take turns (`queue`), so that two of them do not ask for the same rows.
interface SearchWalk { songs: UnifiedSong[]; seen: Set<string>; asked: number; done: boolean; queue: Promise<unknown>; paged: boolean }
// The searches gone back to are few: the one on screen, and the ones the listener returns to.
const MAX_SEARCH_WALKS = 8;
const searchWalks = new Map<string, SearchWalk>();
// The searches of callers beside the host's own screen (a mod, through Folium's `folium.omni`),
// which name themselves with a `session`: kept apart from the host's by session and text, under a
// bound of their own, so that such a search never starts the listener's search over and never
// drops it to make room.
const MAX_SESSION_SEARCH_WALKS = 16;
const sessionSearchWalks = new Map<string, SearchWalk>();
// Makes room for `kept` in `walks`. A search read past its first page is one the listener is in; a
// lookup (a song's lyrics) asks one page and never comes back. So the oldest of those goes first.
const dropSearchWalk = (walks: Map<string, SearchWalk>, kept: SearchWalk): void => {
    const held = [...walks];
    const [text] = held.find(([, walk]) => !walk.paged && walk !== kept) ?? held[0];
    walks.delete(text);
};
// The sign-in attempt in progress; the desktop side decides how long it stays open.
let activeLogin: SpotifyWireLoginStart | null = null;

// The desktop side asks for pages in the app's language; an album or artist read before the
// language changed is named in the previous one.
i18n.on('languageChanged', clearSpotifyCatalogCache);

export const spotifyProvider: OnlineMusicProvider = {
    id: 'spotify', displayName: 'Spotify', shortName: 'Spotify',
    mark: { letter: 'S', color: '#000000', icon: 'spotify' },
    getAvailability: getSpotifyTransportAvailability,
    describeFailure: describeSpotifyFailure,
    // `recommendations` is the radio tab: a personal FM, daily songs and playlists, each made of
    // what Spotify has for the account (spotifyRecommendations.ts). `personalFmModes` stays off:
    // the FM here has no modes. Spotify's recommendation page is the explore tab.
    capabilities: {
        search: true, playback: true, lyrics: true, wordByWordLyrics: false, auth: true,
        userLibrary: true, playlists: true, albums: true, artists: true, userAlbums: true,
        // `playlistSubscription` is albums and other people's playlists (`mutations.canSubscribe`).
        recommendations: true, explore: true, mutations: true, likes: true, playlistTrackMutations: true,
        playlistSubscription: true,
    },
    normalizeSong: normalizeSpotifySong, normalizeUser: normalizeSpotifyUser, normalizeCollection: normalizeSpotifyCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        // Spotify does not page a search cleanly (2026-10-08: every page holds as many rows as asked
        // for, a fifth of them rows an earlier page gave; its count of the results is the page size
        // plus a fifth; it says "no next page" from the second page on). So a search is walked from
        // its start and kept: a page here is what the next rows add that no earlier row gave. A
        // search the listener comes back to goes on where it was; one no longer kept is walked again
        // from its start as far as the page asked for. A search asked from offset 0 begins anew.
        // A caller with a `session` has walks of its own (`sessionSearchWalks`).
        async searchSongs(query, limit, offset, context) {
            const text = query.trim();
            if (!text) return { items: [], total: 0, nextOffset: offset, hasMore: false };
            const session = context?.session;
            const walks = session === undefined ? searchWalks : sessionSearchWalks;
            const maxWalks = session === undefined ? MAX_SEARCH_WALKS : MAX_SESSION_SEARCH_WALKS;
            const key = session === undefined ? text : `${session}\n${text}`;
            let walk = offset === 0 ? undefined : walks.get(key);
            if (!walk) {
                walk = { songs: [], seen: new Set(), asked: 0, done: false, queue: Promise.resolve(), paged: false };
                walks.delete(key);
                walks.set(key, walk);
                while (walks.size > maxWalks) dropSearchWalk(walks, walk);
            }
            if (offset > 0) walk.paged = true;
            const current = walk;
            const turn = current.queue.catch(() => undefined).then(async () => {
                while (!current.done && current.songs.length <= offset) {
                    const answer = await querySpotify<SearchAnswer>('searchTracks', {
                        searchTerm: text, offset: current.asked, limit: Math.min(limit, SEARCH_ROWS),
                        includePreReleases: false, numberOfTopResults: 20, includeAudiobooks: true, includeAuthors: false,
                    });
                    const rows = answer.searchV2?.tracksV2?.items ?? [];
                    const fresh = rows.map(row => spotifySongOf(row.item?.data)).filter(present).filter(song => !current.seen.has(String(song.id)));
                    fresh.forEach(song => current.seen.add(String(song.id)));
                    current.songs.push(...fresh);
                    current.asked += rows.length;
                    current.done = fresh.length === 0 || current.asked >= SEARCH_MAX_ROWS;
                }
            });
            current.queue = turn;
            await turn;
            const items = current.songs.slice(offset, offset + limit);
            const nextOffset = offset + items.length;
            return { items, nextOffset, hasMore: !current.done || nextOffset < current.songs.length };
        },
    },
    playback: {
        async getSongDetail(id) {
            const track = (await querySpotify<TrackAnswer>('getTrack', { uri: spotifyUri('track', String(id)) })).trackUnion;
            return spotifySongOf(track && { ...track, artists: { items: [...(track.firstArtist?.items ?? []), ...(track.otherArtists?.items ?? [])] } });
        },
        // Spotify's files are Ogg Vorbis at 160 and at 320 kbit/s and nothing above (`BITRATES` on
        // the desktop side): two levels, and a preference above `high` is asked for as `high`.
        audioQualityLevels: ['standard', 'high'],
        // Spotify's own audio, for paying accounts only (Spotify's rule for every player that is not
        // its own): a free account is answered `subscription-required`. The URL is the desktop app's own.
        async getAudioSource(song, quality) {
            const id = requireSpotifySong(song);
            const startedAt = Date.now();
            const audio = await requestSpotify<SpotifyWireAudio>('audio', { id, quality });
            console.log(`[Spotify] Audio for "${song.name}" (${id}) is ready as ${audio.format} after ${Date.now() - startedAt}ms`);
            return { url: audio.url, fetchedAt: Date.now(), quality };
        },
        // Spotify's files stay out of the media cache. The desktop side keeps them on disk as
        // Spotify sends them, encrypted and without their key, under the media cache's size limit.
        keepAudio: url => requestSpotify<boolean>('audio_keep', { url, limitBytes: cacheLimitBytes() }),
        hasKeptAudio: url => requestSpotify<boolean>('audio_kept', { url }),
    },
    lyrics: {
        // Spotify's own lyrics are timed by line, or not at all. Untimed ones, and a failure to read
        // them, answer "none" instead of an error, so that the cross-source lookup still runs for the song.
        async getLyrics(song) {
            const id = requireSpotifySong(song);
            const data = await requestSpotify<SpotifyWireLyrics | null>('lyrics', { id }).catch(() => null);
            const mainText = data?.timed ? data.lines.map(line => `${formatLrcTimestamp(line.startMs)}${line.words.replace(/\s*\n\s*/g, ' ')}`).join('\n') : '';
            const lyrics = mainText ? parseLyricsByFormat('lrc', mainText) : null;
            console.log(`[Spotify] Own lyrics for ${id}: ${lyrics?.lines.length ? `${lyrics.lines.length} timed lines` : data ? 'untimed' : 'none'}`);
            if (!lyrics?.lines.length) return { lyrics: null, isPureMusic: false };
            return { lyrics, mainText, isPureMusic: false };
        },
    },
    auth: {
        getLoginTexts: () => ({
            title: 'home.loginTitleSpotify',
            note: 'home.loginNoteSpotify',
            caseNotes: {
                'browser-unfinished': 'home.loginCaseSpotifyUnfinished',
                'not-authorized': 'home.loginCaseSpotifyDenied',
                'cannot-listen': 'home.loginCaseSpotifyPort',
            },
        }),
        async getLoginStatus() {
            const user = await requestSpotify<ProviderUser | null>('login_status');
            return user ? normalizeSpotifyUser(user) : null;
        },
        async logout() {
            activeLogin = null;
            clearSpotifyCatalogCache();
            resetSpotifyRecommendations();
            await requestSpotify('logout');
        },
        async startLogin() {
            activeLogin = await requestSpotify<SpotifyWireLoginStart>('login_start');
            return activeLogin.key;
        },
        async openLoginPage(key) { await requestSpotify('login_open', { key }); },
        // A sign-in that went through may be another account's (a sign-in Spotify stopped accepting
        // is removed without a sign-out): the FM and the lists of the one before are forgotten.
        async checkLogin(key) {
            const state = await requestSpotify<LoginState>('login_check', { key });
            if (state.state === 'confirmed') resetSpotifyRecommendations();
            if (state.state !== 'error') return state;
            const failure = spotifyLoginFailure(state.message);
            return failure ? { ...state, failure } : state;
        },
        describeLoginFailure: describeSpotifyLoginFailure,
        async cancelLogin(key) {
            if (activeLogin?.key === key) activeLogin = null;
            await requestSpotify('login_cancel', { key });
        },
        getLoginTtlMs: () => (activeLogin?.expiresInMs || DEFAULT_LOGIN_TTL_MS) + LOGIN_SETTLE_MS,
    },
    catalog: spotifyCatalog,
    library: spotifyLibrary,
    mutations: spotifyMutations,
    recommendations: spotifyRecommendations,
    explore: spotifyExplore,
};
