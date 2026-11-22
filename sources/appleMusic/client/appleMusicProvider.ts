import type {
    FoliumSourceCollection, FoliumSourceDef, FoliumSourceExternalStatus, FoliumSourceLyricsResult, FoliumSourceNamedRef,
    FoliumSourceSong, FoliumSourceUser, FoliumText,
} from '@folia/folium';
import {
    APPLE_MUSIC_LIBRARY_PLAYLIST_ID, getAppleMusicCatalogPage, getAppleMusicLibraryAlbums, getAppleMusicLibrarySongs, getAppleMusicLibraryAlbumTracks, getAppleMusicPersonalFm, canAddToAppleMusicPlaylist, updateAppleMusicPlaylistTracks, appleMusicSongLikeId, getAppleMusicLikedSongIds, setAppleMusicSongLiked, appleMusicCatalogSongId, appleMusicPlaybackSongId, isAppleMusicLibraryPlaybackId, isAppleMusicSongPlayable, getAppleMusicPlaylists, getAppleMusicPlaylistTracks, getAppleMusicTtml, searchAppleMusic,
} from './appleMusicData';
import { appleMusicLiveStationId, getAppleMusicLiveStations, getAppleMusicLiveStationTracks } from './appleMusicRadio';
import { getAppleMusicLyricSearchAlias } from './appleMusicOriginal';
import { normalizeAppleMusicUser } from './appleMusicNormalize';
import { appleMusicAvailability, appleMusicCauseOf, appleMusicCodeOf, appleMusicError, requestAppleMusic } from './appleMusicTransport';

// sources/appleMusic/client/appleMusicProvider.ts
// The Apple Music source (what folium.sources.register takes). The page and its signed-in session live in the
// companion process; this file only turns the companion's validated answers into the source DTOs. Playback is
// `playback.external@1` (the companion plays; the host steers it and follows its clock, and takes over a player still
// sounding after the main window is rebuilt through `adopt`); no `playback.surface@1`, no `mount`: the companion's
// player is not a picture in the app, and a source with `mount` would be played again instead of adopted.

/** What the definition needs of the host besides the transport. */
export interface AppleMusicSourceEnv {
    /** A text of the mod's locale files, as a key the host follows across languages. */
    text(key: string): FoliumText;
    /** The system the app runs on (`win32`, `darwin`, `linux`). */
    platform: string;
}

// MusicKit's PlaybackStates: ended is 5 and completed is 10 (waiting is 8, stalled is 9). A
// stalled stream must not be taken for the end of the track.
const isEndedState = (state: number | null): boolean => state === 5 || state === 10;
// MusicKit's PlaybackStates.stopped. At a natural end MusicKit sometimes clears its item and gives
// this instead of ended (#1142, macOS WKWebView): read as the end only when the song was last heard
// this close to its end.
const STOPPED_STATE = 4;
const STOPPED_AT_END_SLACK_MS = 3000;
// Chromium's intensive throttling lets a hidden page's chained timers run once a minute.
const HEARD_GAP_LIMIT_MS = 90_000;
// MusicKit's PlayerRepeatMode.one: going round passes through a stopped answer with no item, which
// is the track repeating, not its end.
const REPEAT_ONE_MODE = 1;

// A player with no item, stopped, not repeating one track, whose song had reached the slack of its
// known end: that song finished. `positionMs` already counts the time the song went on after the
// last answer that named it, so this holds when answers come slowly (a throttled hidden window).
function stoppedAtEnd(data: unknown, heard: { durationMs: number; positionMs: number }): boolean {
    const raw = data as { state?: unknown; repeatMode?: unknown } | null;
    return raw?.state === STOPPED_STATE && raw.repeatMode !== REPEAT_ONE_MODE
        && heard.durationMs > 0 && heard.positionMs >= heard.durationMs - STOPPED_AT_END_SLACK_MS;
}

// Name catalog artists given only by ID, one lookup each; null when an ID is malformed or an artist has no name.
async function nameAppleMusicCatalogArtists(ids: readonly unknown[]): Promise<FoliumSourceNamedRef[] | null> {
    const named: FoliumSourceNamedRef[] = [];
    for (const id of ids) {
        if (typeof id !== 'string') return null;
        const detail = (await getAppleMusicCatalogPage('catalogArtist', id, 1, 0)).items[0] as FoliumSourceCollection | undefined;
        if (!detail?.name) return null;
        named.push({ id, name: detail.name });
    }
    return named;
}

// Whether an artist of a song opens a catalog page: it has an id (the host makes no link of an empty one).
const opensPage = (artist: FoliumSourceNamedRef): boolean => Boolean(artist.id) && artist.ref !== false;

// Validate the one status shape playback follows: nothing from the page reaches the clock unread.
function externalStatus(value: unknown): FoliumSourceExternalStatus {
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
        throw appleMusicError('invalid-response', 'Apple Music playback status is invalid');
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

/** The source of the manifest's `sources[0]` (id `appleMusic`). */
export function createAppleMusicSource(env: AppleMusicSourceEnv): FoliumSourceDef {
    // Asked whenever a row of the source is drawn: made once, the system does not change while the app runs.
    const availability = appleMusicAvailability(env.platform, env.text('linuxUnsupported'));
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
    let playback: { catalogId: string; hasPlayed: boolean; durationMs: number; positionMs: number; heardAtMs: number; heardPlaying: boolean; nextIds: string[]; nativeNextId: string; queueRevision: number } | null = null;
    // Attempts whose stopped-at-end reading has been logged: the player is asked again until Folia moves on.
    const stoppedEndLogged = new WeakSet();

    // Window actions take turns so an older cancellation cannot hide a newer login.
    function scheduleWindowAction(action: () => Promise<void>): Promise<void> {
        const next = windowTask.catch(() => {}).then(action);
        windowTask = next;
        return next;
    }

    // A missing account is different from a network or identity lookup failure.
    async function readUser(): Promise<FoliumSourceUser | null> {
        try {
            return normalizeAppleMusicUser(await requestAppleMusic('accountStatus'));
        } catch (error) {
            if (appleMusicCodeOf(error) === 'auth-required') return null;
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
                if (appleMusicCauseOf(error) !== 'not-ready' || attempt === 39) throw error;
                await new Promise(resolve => setTimeout(resolve, 250));
            }
        }
    }

    // A song Apple has no timed lyric for answers with no TTML: that is an empty result, not a failure. The TTML goes
    // to the host as it is, which parses it (word-level where Apple supplies word timing, the parsed lyric says which)
    // and reports a file with no line as none.
    async function readLyrics(song: FoliumSourceSong): Promise<FoliumSourceLyricsResult | null> {
        if (appleMusicLiveStationId(song)) return null;
        const ttml = await getAppleMusicTtml(song);
        if (ttml === null) return null;
        // Which timing Apple actually supplied is a decision worth a log line; the words themselves
        // never go into it. A line-level file for a song the app shows word-level is a platform gap,
        // not something this adapter can change. The file's own declaration and its timed spans are
        // what is known here; the parsed mode is the host's.
        console.info('[AppleMusic] timed lyric', {
            declaredTiming: /itunes:timing="([^"]+)"/.exec(ttml)?.[1] ?? null,
            lines: (ttml.match(/<p\b/g) ?? []).length,
            spans: (ttml.match(/<span\b/g) ?? []).length,
            timedSpans: (ttml.match(/<span\b[^>]*\bbegin=/g) ?? []).length,
        });
        return { main: { format: 'ttml', text: ttml } };
    }

    return {
        id: 'appleMusic',
        // The full name stays as the built-in provider wrote it, in every language; the short one is the mod's own.
        displayName: 'Apple Music',
        shortName: env.text('name.short'),
        mark: { letter: 'A', color: '#fa243c' },
        getAvailability: () => availability,
        // A build without the companion runtime cannot play or read anything from Apple: say that,
        // instead of dressing it up as a network failure the listener could retry.
        describeFailure(_operation, error) {
            if (appleMusicCauseOf(error) === 'runtime-unavailable') return { case: 'not-configured' };
            return null;
        },
        // The switches follow from what is implemented (no `playback.audio@1`: Apple's audio is DRM-protected and
        // plays in the companion window, which `playback.external@1` steers). Searching needs no account of the
        // listener's own here, but the federated search lists a source with sign-in only once signed in, as it did
        // the built-in provider: `access: 'account'`.
        capabilities: {
            'search@1': {
                access: 'account' as const,
                searchSongs: (query: string, limit: number, offset: number) => searchAppleMusic(query, limit, offset),
            },
            // Apple's audio never leaves its page: these calls steer the companion's MusicKit player.
            // A library song is played by its catalog id, which the companion puts in the queue; an upload
            // with no catalog counterpart is played by its library id (`appleMusicPlaybackSongId`).
            'playback.external@1': {
                canPlay: (song: FoliumSourceSong) => Boolean(appleMusicLiveStationId(song)) || isAppleMusicSongPlayable(song),
                isPrepared(song: FoliumSourceSong) {
                    try {
                        const id = appleMusicPlaybackSongId(song);
                        return handoffId === id || Boolean(playback?.hasPlayed && playback.nativeNextId === id);
                    } catch { return false; }
                },
                async prepareNext(song: FoliumSourceSong, upcoming: FoliumSourceSong[]) {
                    if (appleMusicLiveStationId(song)) return;
                    const attempt = playback;
                    if (!attempt || attempt.catalogId !== appleMusicPlaybackSongId(song)) return;
                    const ids: string[] = [];
                    for (const next of upcoming.slice(0, 2)) {
                        if (!isAppleMusicSongPlayable(next)) continue;
                        try {
                            const id = appleMusicPlaybackSongId(next);
                            // An upload is not put in the prepared tail: whether MusicKit's playLater takes a
                            // library id beside catalog ids is unverified, so it starts through playSong instead.
                            if (isAppleMusicLibraryPlaybackId(id)) break;
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
                        if (appleMusicCauseOf(error) === 'stale-request') return;
                        if (playback === attempt && attempt.queueRevision === revision) attempt.nextIds = [];
                        throw error;
                    }
                },
                async play(song: FoliumSourceSong, startSec: number) {
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
                        throw appleMusicError('not-playable', 'Apple Music cannot stream this song in the current route', 'playback-unavailable');
                    }
                    const catalogId = appleMusicPlaybackSongId(song);
                    const seconds = Math.max(0, Math.min(startSec, 604800));
                    const adoptCurrent = handoffId === catalogId && seconds === 0;
                    handoffId = null;
                    const requestKey = `play_${playNonce}_${++playSequence}`;
                    const attempt = { catalogId, hasPlayed: false, durationMs: 0, positionMs: 0, heardAtMs: 0, heardPlaying: false, nextIds: [] as string[], nativeNextId: '', queueRevision: 0 };
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
                adopt(song: FoliumSourceSong) {
                    const stationId = appleMusicLiveStationId(song);
                    handoffId = null;
                    if (stationId) {
                        playback = null;
                        liveStationId = stationId;
                        return;
                    }
                    liveStationId = null;
                    playback = { catalogId: appleMusicPlaybackSongId(song), hasPlayed: true, durationMs: 0, positionMs: 0, heardAtMs: 0, heardPlaying: false, nextIds: [], nativeNextId: '', queueRevision: 0 };
                },
                async pause() {
                    await requestAppleMusic('pause');
                },
                async resume() {
                    await requestAppleMusic('resume');
                },
                async seek(seconds: number) {
                    if (liveStationId) return;
                    if (!Number.isFinite(seconds) || seconds < 0) {
                        throw appleMusicError('invalid-response', 'Apple Music seek position is invalid');
                    }
                    await requestAppleMusic('seek', { seconds: Math.min(seconds, 604800) });
                },
                async setVolume(volume: number) {
                    if (!Number.isFinite(volume)) {
                        throw appleMusicError('invalid-response', 'Apple Music volume is invalid');
                    }
                    await requestAppleMusic('setVolume', { volume: Math.round(Math.min(1, Math.max(0, volume)) * 1000) / 1000 });
                },
                // Folia's single loop as MusicKit's own repeat of one track; its list repeat stays off.
                async setRepeatOne(enabled: boolean) {
                    // A live station has no track to go round: its repeat stays off (playStation sets it so).
                    if (liveStationId && enabled) return;
                    await requestAppleMusic('setRepeatOne', { enabled });
                },
                async getStatus(song: FoliumSourceSong) {
                    const attempt = playback;
                    const data = await requestAppleMusic<unknown>('playbackStatus');
                    const answeredAtMs = Date.now();
                    let status = externalStatus(data);
                    if (attempt && playback === attempt && attempt.catalogId === (appleMusicLiveStationId(song) || appleMusicPlaybackSongId(song))) {
                        if (status.mediaId === attempt.catalogId) {
                            attempt.hasPlayed ||= status.isPlaying;
                            if (status.durationMs > 0) attempt.durationMs = status.durationMs;
                            // At its end MusicKit seeks back to 0 just before it clears the item: a stopped
                            // answer at 0 right after the song was heard at its end keeps where it was heard.
                            const wentBackAtEnd = !status.isPlaying && status.positionMs === 0 && attempt.heardPlaying
                                && attempt.durationMs > 0 && attempt.positionMs >= attempt.durationMs - STOPPED_AT_END_SLACK_MS;
                            if (!wentBackAtEnd) {
                                attempt.positionMs = status.positionMs;
                                attempt.heardAtMs = answeredAtMs;
                                attempt.heardPlaying = status.isPlaying && status.seeking !== true;
                            }
                        } else if (status.mediaId && attempt.hasPlayed && (status.mediaId === attempt.nextIds[0] || status.mediaId === attempt.nativeNextId)) {
                            handoffId = status.mediaId;
                            // MusicKit already started the approved next song. Let Folia adopt it without resetting its queue.
                            status = { mediaId: attempt.catalogId, isPlaying: false, ended: true,
                                durationMs: attempt.durationMs, positionMs: attempt.durationMs || attempt.positionMs };
                        } else if (status.mediaId) {
                            // The user selected a different song in the web window: its end is not ours.
                            attempt.hasPlayed = false;
                        } else {
                            // The item went away since the answer before: a song heard playing then went on
                            // until about now. Counted once, so a player that stays empty does not run on.
                            if (attempt.heardPlaying) {
                                attempt.heardPlaying = false;
                                // A gap longer than a throttled window's slowest answer is a sleep or a silent
                                // companion, not listening time.
                                const gapMs = answeredAtMs - attempt.heardAtMs;
                                const reachedMs = attempt.positionMs + (gapMs > 0 && gapMs <= HEARD_GAP_LIMIT_MS ? gapMs : 0);
                                attempt.positionMs = attempt.durationMs > 0 ? Math.min(attempt.durationMs, reachedMs) : reachedMs;
                            }
                            const endedState = isEndedState((data as { state?: number }).state ?? null);
                            if (attempt.hasPlayed && (endedState || stoppedAtEnd(data, attempt))) {
                                if (!endedState && !stoppedEndLogged.has(attempt)) {
                                    // The decision is logged once per song, not on every answer until Folia moves on.
                                    stoppedEndLogged.add(attempt);
                                    console.info('[AppleMusic] stopped with no item at the end of the song: taken as its end',
                                        { positionMs: attempt.positionMs, durationMs: attempt.durationMs });
                                }
                                status = { mediaId: attempt.catalogId, isPlaying: false, ended: true,
                                    durationMs: attempt.durationMs, positionMs: attempt.durationMs || attempt.positionMs };
                            }
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
                // The companion reports the catalog id it was given (an upload: its library id), so a library song matches too.
                isStatusForSong(song: FoliumSourceSong, status: FoliumSourceExternalStatus) {
                    try {
                        return status.mediaId === (appleMusicLiveStationId(song) || appleMusicPlaybackSongId(song));
                    } catch {
                        return false;
                    }
                },
            },
            // Apple's TTML carries the song's own word timing (and its translations and voices): where
            // it is word-level, the automatic pick must not replace it with another source's. It is a lyric
            // source of the match windows and the automatic pick, with the listener's account only.
            'lyrics@1': {
                access: 'account' as const,
                crossSource: {},
                getLyrics: readLyrics,
                getSearchAlias: getAppleMusicLyricSearchAlias,
                prefersOwnWordByWord: true,
            },
            'auth@1': {
                getLoginTexts: () => ({ title: env.text('login.title'), note: env.text('login.note') }),
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
                    if (ticket !== generation) throw appleMusicError('unavailable', 'Apple Music login was replaced');
                    activeLogin = `apple-${ticket}`;
                    return activeLogin;
                },
                opensLoginPageItself: () => true,
                async openLoginPage(key: string) {
                    await scheduleWindowAction(async () => {
                        if (activeLogin === key) await showLogin();
                    });
                },
                async checkLogin(key: string) {
                    if (key !== activeLogin) return { state: 'expired' as const };
                    try {
                        const user = await readUser();
                        if (key !== activeLogin) return { state: 'expired' as const };
                        if (!user) return { state: 'waiting' as const };
                        // The sign-in is done: the companion goes back to a hidden player, and Folia's
                        // own controls are the surface from here on. A failure to hide changes nothing.
                        void requestAppleMusic('hideWindow').catch(() => {});
                        return { state: 'confirmed' as const };
                    } catch (error) {
                        if (key !== activeLogin) return { state: 'expired' as const };
                        if (appleMusicCauseOf(error) === 'not-ready') return { state: 'waiting' as const };
                        throw error;
                    }
                },
                async cancelLogin(key: string) {
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
                    if (step !== 'start') return null;
                    const cause = appleMusicCauseOf(error);
                    if (cause === 'runtime-unavailable' || cause === 'not-ready') {
                        return { case: 'local-service-unavailable', code: cause };
                    }
                    return null;
                },
            },
            'library@1': {
                getSongLikeId: appleMusicSongLikeId,
                getLikedSongIds: () => getAppleMusicLikedSongIds(),
                getUserAlbums: (_userId: string, limit: number, offset: number) => getAppleMusicLibraryAlbums(limit, offset),
                getUserPlaylists: (_userId: string, limit: number, offset: number) => getAppleMusicPlaylists(limit, offset),
            },
            'catalog@1': {
                canResolveSongCatalogRefs: (song: FoliumSourceSong) => { try { appleMusicCatalogSongId(song); return true; } catch { return false; } },
                async resolveSongCatalogRefs(song: FoliumSourceSong) {
                    const page = await getAppleMusicCatalogPage('catalogSong', appleMusicCatalogSongId(song), 1, 0);
                    const resolved = page.items[0] as FoliumSourceSong | undefined;
                    if (!resolved) return song;
                    // Apple often returns only artist IDs; resolve each name rather than assigning a combined name to the wrong artist.
                    const ids = resolved.data?.catalogArtistIds;
                    let artists = resolved.artists;
                    if (Array.isArray(ids) && ids.length && !artists.some(opensPage)) {
                        const named = await nameAppleMusicCatalogArtists(ids);
                        if (!named) return song;
                        artists = named;
                    }
                    const resolvedAlbum = resolved.album;
                    return { ...song, album: resolvedAlbum?.id ? resolvedAlbum : song.album,
                        artists: artists.some(opensPage) ? artists : song.artists };
                },
                getAlbumTracks: async (id: string, limit = 100, offset = 0) => (id.startsWith('l.')
                    ? getAppleMusicLibraryAlbumTracks(id, limit, offset)
                    : await getAppleMusicCatalogPage('catalogAlbumTracks', id, limit, offset) as Awaited<ReturnType<typeof getAppleMusicLibraryAlbumTracks>>),
                getAlbumDetail: async (id: string, collection?: FoliumSourceCollection) => {
                    if (id.startsWith('l.')) return collection ?? null;
                    const detail = (await getAppleMusicCatalogPage('catalogAlbum', id, 1, 0)).items[0] as FoliumSourceCollection | undefined;
                    // Several artists came as bare IDs: name each so the album page can open them (one lookup per artist).
                    const ids = detail?.data?.catalogArtistIds;
                    if (!detail || !Array.isArray(ids) || !ids.length || detail.artists?.some(opensPage)) return detail ?? null;
                    try {
                        const named = await nameAppleMusicCatalogArtists(ids);
                        return named ? { ...detail, artists: named } : detail;
                    } catch (error) {
                        console.warn('[AppleMusic] could not name album artists', error);
                        return detail;
                    }
                },
                getArtistDetail: async (id: string) => (await getAppleMusicCatalogPage('catalogArtist', id, 1, 0)).items[0] as FoliumSourceCollection | undefined ?? null,
                getArtistSongs: async (id: string, limit: number, offset: number) => await getAppleMusicCatalogPage('catalogArtistSongs', id, limit, offset) as Awaited<ReturnType<typeof getAppleMusicLibraryAlbumTracks>>,
                getArtistAlbums: async (id: string, limit: number, offset: number) => await getAppleMusicCatalogPage('catalogArtistAlbums', id, limit, offset) as Awaited<ReturnType<typeof getAppleMusicLibraryAlbums>>,
                getPlaylistTracks: (id: string, limit: number, offset: number) => (id === APPLE_MUSIC_LIBRARY_PLAYLIST_ID
                    ? getAppleMusicLibrarySongs(limit, offset)
                    : id.startsWith('ra.')
                        ? getAppleMusicLiveStationTracks(id, offset) : getAppleMusicPlaylistTracks(id, limit, offset)),
            },
            'recommendations@1': {
                getPersonalFm: () => getAppleMusicPersonalFm(),
                getRecommendedCollections: () => getAppleMusicLiveStations(),
            },
            'mutations@1': {
                likeSong: setAppleMusicSongLiked,
                canAddToPlaylist: canAddToAppleMusicPlaylist,
                canEditPlaylistTracks: () => false,
                updatePlaylistTracks: updateAppleMusicPlaylistTracks,
            },
        },
    };
}
