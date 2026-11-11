import type { SongResult } from '../../../types';
import type {
    OnlineMusicProvider, ProviderArtistSummary, ProviderAvailability, ProviderCollection, ProviderExternalPlaybackStatus, ProviderLyricsResult, ProviderUser,
} from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { parseLyricsByFormat } from '../../../utils/lyrics/parserCore';
import { hasRenderableLyrics } from '../../../utils/lyrics/validity';
import {
    APPLE_MUSIC_LIBRARY_PLAYLIST_ID, getAppleMusicCatalogPage, getAppleMusicLibraryAlbums, getAppleMusicLibrarySongs, getAppleMusicLibraryAlbumTracks, getAppleMusicPersonalFm, canAddToAppleMusicPlaylist, updateAppleMusicPlaylistTracks, appleMusicSongLikeId, getAppleMusicLikedSongIds, setAppleMusicSongLiked, appleMusicCatalogSongId, isAppleMusicSongPlayable, getAppleMusicPlaylists, getAppleMusicPlaylistTracks, getAppleMusicTtml, searchAppleMusic,
} from './appleMusicData';
import { appleMusicLiveStationId, getAppleMusicLiveStations, getAppleMusicLiveStationTracks } from './appleMusicRadio';
import { getAppleMusicLyricSearchAlias } from './appleMusicOriginal';
import { normalizeAppleMusicPlaylist, normalizeAppleMusicSong, normalizeAppleMusicUser } from './appleMusicNormalize';
import { getAppleMusicTransportAvailability, requestAppleMusic } from './appleMusicTransport';

// MusicKit's PlaybackStates: ended is 5 and completed is 10 (waiting is 8, stalled is 9). A
// stalled stream must not be taken for the end of the track.
const isEndedState = (state: number | null): boolean => state === 5 || state === 10;

// Name catalog artists given only by ID, one lookup each; null when an ID is malformed or an artist has no name.
async function nameAppleMusicCatalogArtists(ids: readonly unknown[]): Promise<ProviderArtistSummary[] | null> {
    const named: ProviderArtistSummary[] = [];
    for (const id of ids) {
        if (typeof id !== 'string') return null;
        const detail = (await getAppleMusicCatalogPage('catalogArtist', id, 1, 0)).items[0] as ProviderCollection | undefined;
        if (!detail?.name) return null;
        named.push({ id, name: detail.name, catalogRef: { providerId: 'appleMusic', kind: 'artist', id } });
    }
    return named;
}

// Validate the one status shape playback follows: nothing from the page reaches the clock unread.
function externalStatus(value: unknown): ProviderExternalPlaybackStatus {
    const status = value as {
        itemId?: unknown; catalogId?: unknown; isPlaying?: unknown;
        positionMs?: unknown; durationMs?: unknown; state?: unknown; live?: unknown; starting?: unknown;
    } | null;
    const mediaId = typeof status?.catalogId === 'string' && status.catalogId
        ? status.catalogId
        : typeof status?.itemId === 'string' ? status.itemId : '';
    if (!status
        || typeof status.isPlaying !== 'boolean'
        || typeof status.positionMs !== 'number' || !Number.isFinite(status.positionMs) || status.positionMs < 0
        || typeof status.durationMs !== 'number' || !Number.isFinite(status.durationMs) || status.durationMs < 0) {
        console.warn('[AppleMusic] unreadable playback status', {
            itemId: typeof status?.itemId === 'string' ? status.itemId.length : typeof status?.itemId,
            catalogId: typeof status?.catalogId === 'string' ? status.catalogId.length : typeof status?.catalogId,
            isPlaying: typeof status?.isPlaying,
            positionMs: typeof status?.positionMs,
            durationMs: typeof status?.durationMs,
            state: status?.state,
        });
        throw new OnlineProviderError('invalid-response', 'Apple Music playback status is invalid', 'appleMusic');
    }
    const state = typeof status.state === 'number' && Number.isInteger(status.state) ? status.state : null;
    return {
        // Empty means the player has nothing loaded (before the queue starts, or between tracks):
        // a state to wait through, not a malformed answer.
        mediaId,
        isPlaying: mediaId ? status.isPlaying : false,
        positionMs: mediaId ? status.positionMs : 0,
        durationMs: mediaId ? status.durationMs : 0,
        ended: status.live === true ? false : mediaId ? isEndedState(state) : false,
        ...(status.live === true ? { live: true } : {}),
        ...(state === 6 ? { seeking: true } : {}),
        ...(status.starting === true ? { starting: true } : {}),
    };
}

// Apple Music adapter. The page and its signed-in session live in the companion process; this file
// only turns the companion's validated answers into the shared provider types. Playback is a
// separate route (the companion plays; Folia steers it) and is not part of `getAudioSource`.
export function createAppleMusicProvider(getAvailability: () => ProviderAvailability): OnlineMusicProvider {
    let generation = 0;
    let liveStationId: string | null = null;
    let handoffId: string | null = null;
    let playSequence = 0;
    const playNonce = Math.random().toString(36).slice(2);
    let activeLogin: string | null = null;
    let windowTask: Promise<void> = Promise.resolve();
    // Only a change is logged: the player is asked twice a second while a track is loaded.
    let lastHadTrack: boolean | null = null;
    // MusicKit clears nowPlayingItem at completion. Retain only this attempt's observed identity.
    let playback: { catalogId: string; hasPlayed: boolean; durationMs: number; positionMs: number; nextIds: string[]; nativeNextId: string; queueRevision: number } | null = null;

    // Window actions take turns so an older cancellation cannot hide a newer login.
    function scheduleWindowAction(action: () => Promise<void>): Promise<void> {
        const next = windowTask.catch(() => {}).then(action);
        windowTask = next;
        return next;
    }

    // A missing account is different from a network or identity lookup failure.
    async function readUser(): Promise<ProviderUser | null> {
        try {
            return normalizeAppleMusicUser(await requestAppleMusic('accountStatus'));
        } catch (error) {
            if (error instanceof OnlineProviderError && error.code === 'auth-required') return null;
            throw error;
        }
    }

    // Starting a new companion can take a few seconds before its window exists.
    async function showLogin(): Promise<void> {
        for (let attempt = 0; attempt < 40; attempt++) {
            try {
                await requestAppleMusic('showWindow');
                return;
            } catch (error) {
                if (!(error instanceof OnlineProviderError) || error.cause !== 'not-ready' || attempt === 39) throw error;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
    }

    // A song Apple has no timed lyric for answers with no TTML: that is an empty result, not a failure.
    async function readLyrics(song: Parameters<NonNullable<OnlineMusicProvider['lyrics']>['getLyrics']>[0]): Promise<ProviderLyricsResult> {
        if (appleMusicLiveStationId(song)) return { lyrics: null, isPureMusic: false };
        const ttml = await getAppleMusicTtml(song);
        if (ttml === null) return { lyrics: null, isPureMusic: false };
        const lyrics = parseLyricsByFormat('ttml', ttml);
        // Which timing Apple actually supplied is a decision worth a log line; the words themselves
        // never go into it. A line-level file for a song the app shows word-level is a platform gap,
        // not something this adapter can change. The file's own declaration is logged apart from
        // the parsed mode, which the parser infers when the file declares none.
        const declaredTiming = /itunes:timing="([^"]+)"/.exec(ttml)?.[1] ?? null;
        const words = lyrics.lines.reduce((total, line) => total + (line.words?.length ?? 0), 0);
        console.info('[AppleMusic] timed lyric', {
            declaredTiming,
            timingMode: lyrics.ttml?.timingMode ?? null,
            isWordByWord: lyrics.isWordByWord === true,
            lines: lyrics.lines.length,
            words,
            spans: (ttml.match(/<span\b/g) ?? []).length,
            timedSpans: (ttml.match(/<span\b[^>]*\bbegin=/g) ?? []).length,
        });
        // A lyric file with no renderable line is reported as none, never as an empty success.
        return { lyrics: hasRenderableLyrics(lyrics) ? lyrics : null, isPureMusic: false };
    }

    return {
        id: 'appleMusic', displayName: 'Apple Music', shortName: 'Apple Music',
        mark: { letter: 'A', color: '#fa243c' },
        getAvailability,
        // A build without the companion runtime cannot play or read anything from Apple: say that,
        // instead of dressing it up as a network failure the listener could retry.
        describeFailure(_operation, error) {
            if (error instanceof OnlineProviderError && error.cause === 'runtime-unavailable') {
                return { case: 'not-configured' };
            }
            return null;
        },
        // `playback` stays false: Apple's audio is DRM-protected and plays in the companion window,
        // which `externalPlayback` steers. `wordByWordLyrics` is true when Apple actually supplies
        // word-level TTML; the parsed lyric says which timing it got (`LyricData.isWordByWord`).
        capabilities: {
            search: true, playback: false, externalPlayback: true, lyrics: true, wordByWordLyrics: true, auth: true,
            userLibrary: true, userAlbums: true, playlists: true, albums: true, artists: true, recommendations: true, mutations: true, playlistTrackMutations: true, likes: true,
        },
        normalizeSong: normalizeAppleMusicSong,
        normalizeCollection: normalizeAppleMusicPlaylist,
        normalizeUser: normalizeAppleMusicUser,
        search: { searchSongs: (query, limit, offset) => searchAppleMusic(query, limit, offset) },
        recommendations: { getPersonalFm: getAppleMusicPersonalFm, getRecommendedCollections: getAppleMusicLiveStations },
        mutations: {
            likeSong: setAppleMusicSongLiked,
            canAddToPlaylist: canAddToAppleMusicPlaylist,
            canEditPlaylistTracks: () => false,
            updatePlaylistTracks: updateAppleMusicPlaylistTracks,
        },
        library: {
            getSongLikeId: appleMusicSongLikeId,
            getLikedSongIds: () => getAppleMusicLikedSongIds(),
            getUserAlbums: (_userId, limit, offset) => getAppleMusicLibraryAlbums(limit, offset),
            getUserPlaylists: (_userId, limit, offset) => getAppleMusicPlaylists(limit, offset),
        },
        catalog: {
            canResolveSongCatalogRefs: song => { try { appleMusicCatalogSongId(song); return true; } catch { return false; } },
            async resolveSongCatalogRefs(song) {
                const page = await getAppleMusicCatalogPage('catalogSong', appleMusicCatalogSongId(song), 1, 0);
                const resolved = page.items[0] as typeof song | undefined;
                if (!resolved) return song;
                // Apple often returns only artist IDs; resolve each name rather than assigning a combined name to the wrong artist.
                const ids = resolved.sourceRef?.kind === 'online' ? resolved.sourceRef.providerData?.catalogArtistIds : undefined;
                let artists = resolved.artists;
                if (Array.isArray(ids) && ids.length && !artists.some(artist => artist.catalogRef)) {
                    const named = await nameAppleMusicCatalogArtists(ids);
                    if (!named) return song;
                    artists = named;
                }
                return { ...song, album: resolved.album.catalogRef ? resolved.album : song.album,
                    artists: artists.some(artist => artist.catalogRef) ? artists : song.artists };
            },
            getAlbumTracks: async (id, limit = 100, offset = 0) => String(id).startsWith('l.')
                ? getAppleMusicLibraryAlbumTracks(String(id), limit, offset)
                : await getAppleMusicCatalogPage('catalogAlbumTracks', String(id), limit, offset) as import('../../../types/onlineMusic').ProviderPage<import('../../../types').UnifiedSong>,
            getAlbumDetail: async (id, collection) => {
                if (String(id).startsWith('l.')) return collection ?? null;
                const detail = (await getAppleMusicCatalogPage('catalogAlbum', String(id), 1, 0)).items[0] as ProviderCollection | undefined;
                // Several artists came as bare IDs: name each so the album page can open them (one lookup per artist).
                const ids = detail?.providerData?.catalogArtistIds;
                if (!detail || !Array.isArray(ids) || !ids.length || detail.artists?.some(artist => artist.catalogRef)) return detail ?? null;
                try {
                    const named = await nameAppleMusicCatalogArtists(ids);
                    return named ? { ...detail, artists: named } : detail;
                } catch (error) {
                    console.warn('[AppleMusic] could not name album artists', error);
                    return detail;
                }
            },
            getArtistDetail: async id => (await getAppleMusicCatalogPage('catalogArtist', String(id), 1, 0)).items[0] as import('../../../types/onlineMusic').ProviderCollection | undefined ?? null,
            getArtistSongs: async (id, limit, offset) => await getAppleMusicCatalogPage('catalogArtistSongs', String(id), limit, offset) as import('../../../types/onlineMusic').ProviderPage<import('../../../types').UnifiedSong>,
            getArtistAlbums: async (id, limit, offset) => await getAppleMusicCatalogPage('catalogArtistAlbums', String(id), limit, offset) as import('../../../types/onlineMusic').ProviderPage<import('../../../types/onlineMusic').ProviderCollection>,
            getPlaylistTracks: (id, limit, offset) => id === APPLE_MUSIC_LIBRARY_PLAYLIST_ID
                ? getAppleMusicLibrarySongs(limit, offset)
                : String(id).startsWith('ra.')
                    ? getAppleMusicLiveStationTracks(String(id), offset) : getAppleMusicPlaylistTracks(String(id), limit, offset),
        },
        // Apple's TTML carries the song's own word timing (and its translations and voices): where
        // it is word-level, the automatic pick must not replace it with another source's.
        lyrics: { getLyrics: readLyrics, getSearchAlias: getAppleMusicLyricSearchAlias, prefersOwnWordByWord: true },
        // Apple's audio never leaves its page: these calls steer the companion's MusicKit player.
        // A library song is played by its catalog id, which the companion puts in the queue.
        // Nothing is declared about how long a move of the player may take: the twenty seconds the
        // companion's dispatcher waits (createRequestDispatcher in
        // electron/appleMusic/companionRequests.cjs) is the ceiling on the whole request, not how
        // long a move of the song takes, and a longer limit for moves is the general layer's - it is
        // not carried over to this player.
        externalPlayback: {
            canPlay: song => Boolean(appleMusicLiveStationId(song)) || isAppleMusicSongPlayable(song),
            isPrepared(song) {
                try {
                    const id = appleMusicCatalogSongId(song);
                    return handoffId === id || Boolean(playback?.hasPlayed && playback.nativeNextId === id);
                } catch { return false; }
            },
            async prepareNext(song, upcoming) {
                if (appleMusicLiveStationId(song)) return;
                const attempt = playback;
                if (!attempt || attempt.catalogId !== appleMusicCatalogSongId(song)) return;
                const ids: string[] = [];
                for (const next of upcoming.slice(0, 2)) {
                    if (!isAppleMusicSongPlayable(next)) continue;
                    try {
                        const id = appleMusicCatalogSongId(next);
                        if (id === attempt.catalogId || ids.includes(id)) break;
                        ids.push(id);
                    } catch { break; }
                }
                const revision = ++attempt.queueRevision;
                // Preserve the previously approved handoff while an edit races native advancement.
                attempt.nativeNextId ||= attempt.nextIds[0] || '';
                attempt.nextIds = ids;
                try {
                    await requestAppleMusic('prepareNext', { catalogId: attempt.catalogId, nextIds: ids });
                    if (playback === attempt && attempt.queueRevision === revision) attempt.nativeNextId = ids[0] || '';
                } catch (error) {
                    // The prepared successor can start while the tail update is in flight; let status adopt it.
                    if (error instanceof OnlineProviderError && error.cause === 'stale-request') return;
                    if (playback === attempt && attempt.queueRevision === revision) attempt.nextIds = [];
                    throw error;
                }
            },
            async play(song, startSec) {
                const stationId = appleMusicLiveStationId(song);
                if (stationId) {
                    playback = null;
                    handoffId = null;
                    await requestAppleMusic('playStation', { stationId });
                    liveStationId = stationId;
                    console.info('[AppleMusic] Live station started');
                    return;
                }
                liveStationId = null;
                if (!isAppleMusicSongPlayable(song)) {
                    throw new OnlineProviderError('not-playable', 'Apple Music cannot stream this song in the current route', 'appleMusic', 'playback-unavailable');
                }
                const catalogId = appleMusicCatalogSongId(song);
                const seconds = Math.max(0, Math.min(startSec, 604800));
                const adoptCurrent = handoffId === catalogId && seconds === 0;
                handoffId = null;
                const requestKey = `play_${playNonce}_${++playSequence}`;
                const attempt = { catalogId, hasPlayed: false, durationMs: 0, positionMs: 0, nextIds: [] as string[], nativeNextId: '', queueRevision: 0 };
                playback = attempt;
                let result;
                try {
                    result = await requestAppleMusic('playSong', { catalogId, startSec: Math.round(seconds * 1000) / 1000, requestKey, ...(adoptCurrent ? { adoptCurrent: true } : {}) });
                } catch (error) {
                    if (playback === attempt) playback = null;
                    throw error;
                }
                // A start the player accepted but did not begin looks like this; the state and the
                // queue's own keys are the facts worth keeping, the song's words never are.
                console.info('[AppleMusic] play started', result);
            },
            // The previous window's attempt died with it; a fresh one lets prepareNext and the
            // native-advance adoption in getStatus work for the song the companion is still playing.
            adopt(song) {
                const stationId = appleMusicLiveStationId(song);
                handoffId = null;
                if (stationId) {
                    playback = null;
                    liveStationId = stationId;
                    return;
                }
                liveStationId = null;
                playback = { catalogId: appleMusicCatalogSongId(song), hasPlayed: true, durationMs: 0, positionMs: 0, nextIds: [], nativeNextId: '', queueRevision: 0 };
            },
            async pause() {
                await requestAppleMusic('pause');
            },
            async resume() {
                await requestAppleMusic('resume');
            },
            async seek(seconds) {
                if (liveStationId) return;
                if (!Number.isFinite(seconds) || seconds < 0) {
                    throw new OnlineProviderError('invalid-response', 'Apple Music seek position is invalid', 'appleMusic');
                }
                await requestAppleMusic('seek', { seconds: Math.min(seconds, 604800) });
            },
            async setVolume(volume) {
                if (!Number.isFinite(volume)) {
                    throw new OnlineProviderError('invalid-response', 'Apple Music volume is invalid', 'appleMusic');
                }
                await requestAppleMusic('setVolume', { volume: Math.round(Math.min(1, Math.max(0, volume)) * 1000) / 1000 });
            },
            async getStatus(song: SongResult) {
                const attempt = playback;
                const data = await requestAppleMusic<unknown>('playbackStatus');
                let status = externalStatus(data);
                if (attempt && playback === attempt && attempt.catalogId === (appleMusicLiveStationId(song) || appleMusicCatalogSongId(song))) {
                    if (status.mediaId === attempt.catalogId) {
                        attempt.hasPlayed ||= status.isPlaying;
                        if (status.durationMs > 0) attempt.durationMs = status.durationMs;
                        attempt.positionMs = status.positionMs;
                    } else if (status.mediaId && attempt.hasPlayed && (status.mediaId === attempt.nextIds[0] || status.mediaId === attempt.nativeNextId)) {
                        handoffId = status.mediaId;
                        // MusicKit already started the approved next song. Let Folia adopt it without resetting its queue.
                        status = { mediaId: attempt.catalogId, isPlaying: false, ended: true,
                            durationMs: attempt.durationMs, positionMs: attempt.durationMs || attempt.positionMs };
                    } else if (status.mediaId) {
                        // The user selected a different song in the web window: its end is not ours.
                        attempt.hasPlayed = false;
                    } else if (attempt.hasPlayed && isEndedState((data as { state?: number }).state ?? null)) {
                        status = { mediaId: attempt.catalogId, isPlaying: false, ended: true,
                            durationMs: attempt.durationMs, positionMs: attempt.durationMs || attempt.positionMs };
                    }
                }
                // A track the player cannot name, and the state it is in, is what a start that did
                // not take looks like from here. Logged on the change only, never its words.
                const hasTrack = status.mediaId !== '';
                if (lastHadTrack !== hasTrack) {
                    lastHadTrack = hasTrack;
                    console.info('[AppleMusic] player track state', {
                        hasTrack,
                        isPlaying: status.isPlaying,
                        state: (data as { state?: unknown } | null)?.state ?? null,
                        queueLength: (data as { queueLength?: unknown } | null)?.queueLength ?? null,
                        queueKeys: (data as { queueKeys?: unknown } | null)?.queueKeys ?? null,
                    });
                }
                return status;
            },
            // The companion reports the catalog id it was given, so a library song matches too.
            isStatusForSong(song, status) {
                try {
                    return status.mediaId === (appleMusicLiveStationId(song) || appleMusicCatalogSongId(song));
                } catch {
                    return false;
                }
            },
        },
        auth: {
            getLoginTexts: () => ({ title: 'home.loginTitleAppleMusic', note: 'home.loginNoteAppleMusic' }),
            // The companion's window is the sign-in surface: there is no code to show and no
            // separate browser page to open.
            getLoginStatus: readUser,
            // The sign-in lives in the companion's own profile on this machine (WKWebsiteDataStore /
            // WebView2 user data folder), so the kept account shows at app start while the companion
            // is asked, instead of "nobody" for the seconds the companion takes to come up.
            showsKeptAccountAtStart: true,
            async startLogin() {
                const ticket = ++generation;
                await scheduleWindowAction(async () => {
                    if (ticket === generation) await showLogin();
                });
                if (ticket !== generation) throw new OnlineProviderError('unavailable', 'Apple Music login was replaced', 'appleMusic');
                activeLogin = `apple-${ticket}`;
                return activeLogin;
            },
            opensLoginPageItself: () => true,
            async openLoginPage(key) {
                await scheduleWindowAction(async () => {
                    if (activeLogin === key) await showLogin();
                });
            },
            async checkLogin(key) {
                if (key !== activeLogin) return { state: 'expired' };
                try {
                    const user = await readUser();
                    if (key !== activeLogin) return { state: 'expired' };
                    if (!user) return { state: 'waiting' };
                    // The sign-in is done: the companion goes back to a hidden player, and Folia's
                    // own controls are the surface from here on. A failure to hide changes nothing.
                    void requestAppleMusic('hideWindow').catch(() => {});
                    return { state: 'confirmed' };
                } catch (error) {
                    if (key !== activeLogin) return { state: 'expired' };
                    if (error instanceof OnlineProviderError && error.cause === 'not-ready') return { state: 'waiting' };
                    throw error;
                }
            },
            async cancelLogin(key) {
                if (key !== activeLogin) return;
                activeLogin = null;
                const ticket = ++generation;
                await scheduleWindowAction(async () => {
                    if (ticket === generation) await requestAppleMusic('hideWindow');
                });
            },
            // The account left the screen on its own (Apple refused the session): a late check of
            // the old sign-in must not confirm it again.
            signInRanOut() {
                activeLogin = null;
                generation++;
            },
            async logout() {
                activeLogin = null;
                generation++;
                await requestAppleMusic('logout');
            },
            // The companion is the local service this sign-in needs; a missing one is retryable.
            describeLoginFailure(step, error) {
                if (step !== 'start' || !(error instanceof OnlineProviderError)) return null;
                if (error.cause === 'runtime-unavailable' || error.cause === 'not-ready') {
                    return { case: 'local-service-unavailable', code: String(error.cause) };
                }
                return null;
            },
        },
    };
}

// The provider the registry holds. The companion bridge is the only runtime it needs.
export const appleMusicProvider = createAppleMusicProvider(getAppleMusicTransportAvailability);
