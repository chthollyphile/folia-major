import type {
    FoliumSourceAudioQuality, FoliumSourceDef, FoliumSourceLoginMethod, FoliumSourceLoginState, FoliumSourceSearchContext, FoliumSourceSong,
    FoliumSourceUser, FoliumText,
} from '@folia/folium';
import { querySpotify, requestSpotify } from './spotifyTransport';
import type { SpotifyWireAudio, SpotifyWireLoginStart, SpotifyWireLyrics } from './spotifyTransport';
import { normalizeSpotifyUser, present, requireSpotifySong, spotifySongOf, spotifyUri } from './spotifyNormalize';
import type { SpotifyArtistRow, SpotifyTrack } from './spotifyNormalize';
import { clearSpotifyCatalogCache, spotifyCatalog } from './spotifyCatalog';
import { connectSpotifyExplore, spotifyExplore } from './spotifyExplore';
import { createSpotifyLibrary } from './spotifyLibrary';
import { spotifyMutations } from './spotifyMutations';
import { resetSpotifyRecommendations, spotifyRecommendations } from './spotifyRecommendations';
import { describeSpotifyLoginFailure, spotifyLoginFailure } from './spotifyLoginFailure';
import { describeSpotifyFailure } from './spotifyFailure';
import {
    readSpotifyPlaybackMode, spotifyPlaybackMode, spotifyPlaysThroughSoloist, spotifySoloistOffered, spotifySoloistPlayback,
} from './spotifySoloistPlayback';
import { checkSpotifyAfterLogin, connectSpotifySetup, getSpotifySetup, runSpotifySetupAction } from './spotifySetup';

// sources/spotify/client/spotifyProvider.ts
// The Spotify source (what folium.sources.register takes). Sign-in happens in the browser where the person is
// already signed in to Spotify: the main entry opens Spotify's consent page and waits for the answer on a local
// port; nothing is typed here.
// The host's switches follow from the capabilities implemented (the adapter's parts.ts), as the built-in
// provider's hand-written table had them: albums, artists, playlists, the account's albums, likes, playlist edits,
// saving albums and other people's playlists; line-timed lyrics only; a radio tab (a personal FM, daily songs and
// playlists) and an explore tab. It plays two ways (spotifySoloistPlayback.ts): the audio route by default, the
// external one (Soloist) when the desktop side keeps that way; `routeOf` says which.

/** What the definition needs of the host besides the transport. */
export interface SpotifySourceEnv {
    /** A text of the mod's locale files, as a key the host follows across languages. */
    text(key: string, params?: Record<string, string | number>): FoliumText;
    /** The same, written out in the UI language now. */
    translate(key: string): string;
}

const DEFAULT_LOGIN_TTL_MS = 10 * 60 * 1000;
// How much longer than the attempt the window waits. A sign-in Spotify approved near the attempt's end
// has its account read again, after a line that failed, for up to 60 s from the first read
// (ACCOUNT_RETRY_MS in sources/spotify/main/spotifyApiBridge.cjs), and one read takes up to 30 s
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
interface SearchWalk { songs: FoliumSourceSong[]; seen: Set<string>; asked: number; done: boolean; queue: Promise<unknown>; paged: boolean }
// The searches gone back to are few: the one on screen, and the ones the listener returns to.
const MAX_SEARCH_WALKS = 8;
// The searches of callers beside the host's own screen (a mod, through Folium's `folium.omni`),
// which name themselves with a `session`: kept apart from the host's by session and text, under a
// bound of their own, so that such a search never starts the listener's search over and never
// drops it to make room.
const MAX_SESSION_SEARCH_WALKS = 16;
// Makes room for `kept` in `walks`. A search read past its first page is one the listener is in; a
// lookup (a song's lyrics) asks one page and never comes back. So the oldest of those goes first.
const dropSearchWalk = (walks: Map<string, SearchWalk>, kept: SearchWalk): void => {
    const held = [...walks];
    const [text] = held.find(([, walk]) => !walk.paged && walk !== kept) ?? held[0];
    walks.delete(text);
};

// `[mm:ss.xx]` for a time in milliseconds, the LRC line time stamp the host reads: a negative time is
// written as zero, the hundredths are cut and not rounded, and minutes past 99 take three digits.
const lrcTimestamp = (timestampMs: number): string => {
    const totalMs = Math.max(0, Math.floor(timestampMs));
    const minutes = Math.floor(totalMs / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    const centiseconds = Math.floor((totalMs % 1000) / 10);
    return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}]`;
};

/** The source of the manifest's `sources[0]` (id `spotify`). */
export const createSpotifySource = (env: SpotifySourceEnv): FoliumSourceDef => {
    const searchWalks = new Map<string, SearchWalk>();
    const sessionSearchWalks = new Map<string, SearchWalk>();
    // The sign-in attempt in progress; the desktop side decides how long it stays open.
    let activeLogin: SpotifyWireLoginStart | null = null;

    // The desktop side asks for pages in the app's language; an album or artist read before the language changed
    // is named in the previous one. A mod is told of no change of language: the mod's own `pageLanguage` text is
    // one word per language, and every call into the catalogue first checks it against the one its pages were read in.
    let pageLanguage = env.translate('pageLanguage');
    const checkLanguage = (): void => {
        const now = env.translate('pageLanguage');
        if (now === pageLanguage) return;
        pageLanguage = now;
        console.log('[Spotify] The app\'s language changed: the albums and artists read in the previous one are forgotten');
        clearSpotifyCatalogCache();
    };
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

    connectSpotifyExplore(env);
    connectSpotifySetup(env);
    // The way Spotify plays is read at once: a song played right after the start takes its route from it.
    void readSpotifyPlaybackMode();

    // The two ways of signing in: the same sign-in in the browser (the library, the lyrics and the
    // search need it either way), and then one of the two ways Spotify plays (spotifySoloistPlayback.ts).
    const loginMethods = (): FoliumSourceLoginMethod[] => [
        { id: 'standard', label: env.text('soloist.method.standard'), note: env.text('soloist.method.standardNote') },
        { id: 'soloist', label: env.text('soloist.method.soloist'), note: env.text('soloist.method.soloistNote') },
    ];

    return {
        id: 'spotify',
        // The full name stays as the built-in provider wrote it, in every language; the short one is the mod's own.
        displayName: 'Spotify',
        shortName: env.text('name.short'),
        mark: { letter: 'S', color: '#22c55e' },
        describeFailure: describeSpotifyFailure,
        // Through Soloist the host steers that program (playback.external@1); else playback.audio@1 gives a URL.
        routeOf: () => (spotifyPlaysThroughSoloist() ? 'external' : 'audio'),
        capabilities: {
            // Searching needs the account, as it did the built-in provider.
            'search@1': {
                access: 'account' as const,
                // Spotify does not page a search cleanly (2026-10-08: every page holds as many rows as asked
                // for, a fifth of them rows an earlier page gave; its count of the results is the page size
                // plus a fifth; it says "no next page" from the second page on). So a search is walked from
                // its start and kept: a page here is what the next rows add that no earlier row gave. A
                // search the listener comes back to goes on where it was; one no longer kept is walked again
                // from its start as far as the page asked for. A search asked from offset 0 begins anew.
                // A caller with a `session` has walks of its own (`sessionSearchWalks`).
                async searchSongs(query: string, limit: number, offset: number, context?: FoliumSourceSearchContext) {
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
                            const fresh = rows.map(row => spotifySongOf(row.item?.data)).filter(present).filter(song => !current.seen.has(song.id));
                            fresh.forEach(song => current.seen.add(song.id));
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
            'songs@1': {
                async getSong(id: string) {
                    const track = (await querySpotify<TrackAnswer>('getTrack', { uri: spotifyUri('track', id) })).trackUnion;
                    return spotifySongOf(track && { ...track, artists: { items: [...(track.firstArtist?.items ?? []), ...(track.otherArtists?.items ?? [])] } });
                },
            },
            'playback.audio@1': {
                // Spotify's files are Ogg Vorbis at 160 and at 320 kbit/s and nothing above (`BITRATES` on
                // the desktop side): two levels, and a preference above `high` is asked for as `high`.
                audioQualityLevels: ['standard', 'high'] as const,
                // Spotify's own audio, for paying accounts only (Spotify's rule for every player that is not
                // its own): a free account is answered `subscription-required`. The address is served by the
                // main entry itself (its `_media/audio` route) and is new on every call: its key works once.
                async getAudioSource(song: FoliumSourceSong, quality: FoliumSourceAudioQuality) {
                    const id = requireSpotifySong(song);
                    const startedAt = Date.now();
                    const audio = await requestSpotify<SpotifyWireAudio>('audio', { id, quality });
                    console.log(`[Spotify] Audio for "${song.title}" (${id}) is ready as ${audio.format} after ${Date.now() - startedAt}ms`);
                    return { url: audio.url, quality };
                },
                // Spotify's files stay out of the host's audio cache. The desktop side keeps them on disk as
                // Spotify sends them, encrypted and without their key, in the media cache folder, counted in
                // the host's budget (main/index.ts).
                keepAudio: (url: string) => requestSpotify<boolean>('audio_keep', { url }),
                hasKeptAudio: (url: string) => requestSpotify<boolean>('audio_kept', { url }),
            },
            'playback.external@1': spotifySoloistPlayback,
            'lyrics@1': {
                access: 'account' as const,
                // A lyric source of the match windows and the automatic pick: timed by line only, no chorus.
                crossSource: { linesOnly: true },
                // Spotify's own lyrics are timed by line, or not at all. Untimed ones, and a failure to read
                // them, answer "none" instead of an error, so that the cross-source lookup still runs for the song.
                async getLyrics(song: FoliumSourceSong) {
                    const id = requireSpotifySong(song);
                    const data = await requestSpotify<SpotifyWireLyrics | null>('lyrics', { id }).catch(() => null);
                    const lines = data?.timed ? data.lines : [];
                    const worded = lines.filter(line => line.words.trim()).length;
                    console.log(`[Spotify] Own lyrics for ${id}: ${worded ? `${worded} timed lines` : data ? 'untimed' : 'none'}`);
                    if (!worded) return null;
                    return { main: { format: 'lrc' as const, text: lines.map(line => `${lrcTimestamp(line.startMs)}${line.words.replace(/\s*\n\s*/g, ' ')}`).join('\n') } };
                },
            },
            'auth@1': {
                getLoginTexts: () => ({
                    title: env.text('login.title'),
                    note: env.text('login.note'),
                    caseNotes: {
                        'browser-unfinished': env.text('login.unfinished'),
                        'not-authorized': env.text('login.denied'),
                        'cannot-listen': env.text('login.port'),
                    },
                }),
                async getLoginStatus() {
                    const user = await requestSpotify<FoliumSourceUser | null>('login_status');
                    return user ? normalizeSpotifyUser(user) : null;
                },
                async logout() {
                    activeLogin = null;
                    clearSpotifyCatalogCache();
                    resetSpotifyRecommendations();
                    await requestSpotify('logout');
                },
                // Two ways only where Soloist is offered (the desktop side says so); else the one sign-in.
                // The way it plays now is picked to begin with: signing in again does not change it unasked.
                async resolveLoginMethods() {
                    const answer = await readSpotifyPlaybackMode();
                    if (!(answer?.soloist ?? spotifySoloistOffered())) return [];
                    const now = answer?.mode ?? spotifyPlaybackMode();
                    return loginMethods().map(method => ({ ...method, preferred: method.id === now }));
                },
                // The way picked goes with the sign-in: the desktop side keeps it once Spotify approves.
                async startLogin(methodId?: string) {
                    activeLogin = await requestSpotify<SpotifyWireLoginStart>('login_start', methodId ? { method: methodId } : {});
                    return activeLogin.key;
                },
                async openLoginPage(key: string) { await requestSpotify('login_open', { key }); },
                // A sign-in that went through may be another account's (a sign-in Spotify stopped accepting
                // is removed without a sign-out): the FM and the lists of the one before are forgotten.
                async checkLogin(key: string): Promise<FoliumSourceLoginState> {
                    const state = await requestSpotify<{ state: string; message?: string }>('login_check', { key });
                    // The desktop side keeps the way picked with this sign-in now: the route follows it at once,
                    // whether or not the check after the sign-in is reached.
                    if (state.state === 'confirmed') {
                        resetSpotifyRecommendations();
                        void readSpotifyPlaybackMode();
                        return { state: 'confirmed' };
                    }
                    if (state.state === 'error') {
                        const failure = spotifyLoginFailure(state.message);
                        return { state: 'error', ...(state.message ? { message: state.message } : {}), ...(failure ? { failure } : {}) };
                    }
                    return { state: state.state === 'expired' ? 'expired' : state.state === 'scanned' ? 'scanned' : 'waiting' };
                },
                describeLoginFailure: describeSpotifyLoginFailure,
                async cancelLogin(key: string) {
                    if (activeLogin?.key === key) activeLogin = null;
                    await requestSpotify('login_cancel', { key });
                },
                getLoginTtlMs: () => (activeLogin?.expiresInMs || DEFAULT_LOGIN_TTL_MS) + LOGIN_SETTLE_MS,
                // After a sign-in: the way picked was kept with it; whether it can play is checked here.
                checkAfterLogin: checkSpotifyAfterLogin,
                getSetup: getSpotifySetup,
                runSetupAction: runSpotifySetupAction,
            },
            'catalog@1': following(spotifyCatalog),
            'library@1': createSpotifyLibrary(() => env.translate('likedSongs')),
            // The radio tab: a personal FM, daily songs and playlists, each made of what Spotify has for the
            // account (spotifyRecommendations.ts). No FM modes. Spotify's recommendation page is the explore tab.
            'recommendations@1': spotifyRecommendations,
            'explore@1': spotifyExplore,
            'mutations@1': spotifyMutations,
        },
    };
};
