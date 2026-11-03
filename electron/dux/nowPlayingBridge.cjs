'use strict';

const { sessionBusAddress } = require('../hifi/mpris/dbusWire.cjs');
const { buildDuxLyricPayload } = require('./qrcLyrics.cjs');
const { createArtworkStore } = require('./artwork.cjs');
const { createDmsLyricsClient } = require('./dmsLyricsClient.cjs');
const { createMprisClient, playerTrackKey, selectActivePlayer } = require('./mprisClient.cjs');
const { createNowPlayingServer } = require('./nowPlayingServer.cjs');
const { createProgressClock } = require('./progressClock.cjs');
const { createTitleResolver } = require('./titleResolver.cjs');

// electron/dux/nowPlayingBridge.cjs
// Linux only: mirrors the player Dux Shell is showing into the local now-playing protocol that
// Folia's stage source already reads. Dux keeps ownership of playback and lyrics; Folia only
// renders. Network access is limited to the art the player itself points at, the lyric lookup Dux
// performs, and (only for Apple Music, only after Dux reports a miss) an iTunes catalog lookup for
// the original title behind Apple's translated one.

const DEFAULT_PORT = 9863;
const MAX_LYRIC_CACHE = 64;

const trackFromPlayer = (player, artwork, port) => {
    if (!player) return null;
    const key = playerTrackKey(player);
    const token = artwork?.register(player.artUrl, key);
    const cover = token ? `http://127.0.0.1:${port}/art/${token}` : null;
    const artists = Array.isArray(player.artists) ? player.artists.filter(Boolean) : [];
    return {
        id: key,
        title: player.title || player.identity || 'Now Playing',
        // The now-playing protocol calls the artist `author`; Folia's normalizer reads that field.
        author: artists.length > 0 ? artists.join(', ') : (player.identity || 'Now Playing'),
        // What Dux should search with. The display fallback above is an app name, not an artist.
        lookupArtist: artists.join(', '),
        // Apple Music translates titles; only its metadata goes through the catalog resolver.
        lookupOriginal: /apple\s*music|itunes/i.test(`${player.identity || ''} ${player.desktopEntry || ''}`),
        album: player.album || '',
        cover,
        duration: player.lengthSec && player.lengthSec > 0 ? player.lengthSec : null,
    };
};

const lyricPayload = (result, track) => {
    const payload = buildDuxLyricPayload(result);
    if (!payload) return null;
    return {
        ...payload,
        title: track?.title ?? '',
        author: track?.author ?? '',
        duration: track?.duration ?? null,
    };
};

/** The fields Folia's now-playing normalizer reads; `lookupArtist` stays internal. */
const trackForWire = track => (track ? {
    id: track.id,
    title: track.title,
    author: track.author,
    album: track.album,
    cover: track.cover,
    duration: track.duration,
} : null);

const sameTrack = (left, right) => (
    left?.id === right?.id
    && left?.title === right?.title
    && left?.author === right?.author
    && left?.album === right?.album
    && left?.cover === right?.cover
    && left?.duration === right?.duration
);

const createDuxNowPlayingBridge = ({
    platform = process.platform,
    runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? 0}`,
    uid = process.getuid?.() ?? 0,
    busAddress = sessionBusAddress(process.env),
    port = DEFAULT_PORT,
    host = '127.0.0.1',
    now = Date.now,
    fetchImpl = globalThis.fetch,
    log = console,
    deps = {
        createArtworkStore,
        createDmsLyricsClient,
        createMprisClient,
        createNowPlayingServer,
        createTitleResolver,
    },
} = {}) => {
    let artwork = null;
    let server = null;
    let mpris = null;
    let dms = null;
    let titleResolver = null;
    let activePlayer = null;
    let activeTrack = null;
    const progressClock = createProgressClock({ now });
    let activeLyric = null;
    let paused = true;
    let positionSec = 0;
    let lastStatus = null;
    let lyricCache = new Map();
    let lyricFetch = null;
    let lyricAbort = null;
    let pendingLyricTrack = null;
    let started = false;
    let stopped = false;

    // The HTTP progress query can arrive between two one-second MPRIS polls; report the clock at
    // request time, not the position sampled by the previous poll, or the stage rewinds slightly.
    const currentPositionSec = () => {
        if (!activeTrack) return 0;
        const durationSec = activeTrack.duration;
        const clockSec = progressClock.currentMs() / 1000;
        return Math.max(0, Math.min(clockSec, durationSec && durationSec > 0 ? durationSec : Number.POSITIVE_INFINITY));
    };

    const snapshot = () => {
        const currentPosition = currentPositionSec();
        return {
            track: trackForWire(activeTrack),
            lyric: activeLyric,
            paused,
            positionSec: currentPosition,
            progressMs: Math.max(0, Math.round(currentPosition * 1000)),
        };
    };

    const broadcastTrack = () => {
        server?.broadcast('Track', trackForWire(activeTrack));
    };

    const broadcastLyric = () => {
        server?.broadcast('Lyric', activeLyric);
    };

    const broadcastPause = () => {
        server?.broadcast('PlayerPauseState', {
            hasSong: Boolean(activeTrack),
            isPaused: paused,
            seekbarCurrentPosition: Math.max(0, positionSec),
        });
    };

    const broadcastProgress = () => {
        server?.broadcast('PlayerProgress', { progress: Math.max(0, Math.round(positionSec * 1000)) });
    };

    const lyricCacheKey = track => `${track.id}|${track.title}|${track.author}|${track.album}|${track.duration ?? ''}`;

    const fetchLyrics = async (track) => {
        if (!track || !dms || stopped) return;
        const key = lyricCacheKey(track);
        if (lyricCache.has(key)) {
            activeLyric = lyricCache.get(key);
            broadcastLyric();
            return;
        }
        if (lyricFetch) {
            pendingLyricTrack = track;
            return;
        }
        const controller = new AbortController();
        lyricAbort = controller;
        lyricFetch = (async () => {
            const { signal } = controller;
            const query = {
                title: track.title,
                artist: typeof track.lookupArtist === 'string' ? track.lookupArtist : track.author,
                album: track.album,
                durationSec: track.duration,
            };
            let result = await dms.lookup(query, { signal });
            let payload = lyricPayload(result, track);
            // Only ask the catalog when Dux itself answered "not found"; a null result means Dux
            // was not reachable, and there is no point in sending the title to Apple too. Apple
            // Music translates titles; other players' metadata stays local.
            if (!payload && result?.found === false && titleResolver && track.lookupOriginal) {
                const variants = await titleResolver.resolve(query, { signal });
                for (const variant of variants) {
                    if (signal.aborted || activeTrack?.id !== track.id) break;
                    result = await dms.lookup({
                        title: variant.title,
                        artist: variant.artist,
                        album: variant.album,
                        durationSec: variant.durationSec,
                    }, { signal });
                    payload = lyricPayload(result, track);
                    if (payload) {
                        log.info('[Dux] lyrics found with a resolved original title');
                        break;
                    }
                }
            }
            if (signal.aborted) return;
            if (payload) {
                if (lyricCache.size >= MAX_LYRIC_CACHE) {
                    const oldest = lyricCache.keys().next().value;
                    lyricCache.delete(oldest);
                }
                lyricCache.set(key, payload);
            } else {
                // A miss may be Dux not running yet; do not pin it for the rest of the track.
                lyricCache.delete(key);
            }
            if (activeTrack?.id === track.id) {
                activeLyric = payload;
                broadcastLyric();
            }
        })().catch(error => {
            log.warn('[Dux] lyric lookup failed', error);
            if (activeTrack?.id === track.id) {
                activeLyric = null;
                broadcastLyric();
            }
        }).finally(() => {
            lyricFetch = null;
            if (lyricAbort === controller) lyricAbort = null;
            if (!stopped && pendingLyricTrack && pendingLyricTrack.id === activeTrack?.id) {
                const next = pendingLyricTrack;
                pendingLyricTrack = null;
                void fetchLyrics(next);
            } else {
                pendingLyricTrack = null;
            }
        });
        await lyricFetch;
    };

    const applyPlayer = (player) => {
        if (!player) {
            if (activePlayer) {
                activePlayer = null;
                activeTrack = null;
                activeLyric = null;
                paused = true;
                positionSec = 0;
                lastStatus = null;
                broadcastTrack();
                broadcastLyric();
                broadcastPause();
            }
            return;
        }

        activePlayer = player;
        const nextPaused = player.playbackStatus !== 'Playing';
        const nextTrack = trackFromPlayer(player, artwork, port);
        const trackChanged = !sameTrack(activeTrack, nextTrack);
        const statusChanged = lastStatus !== player.playbackStatus;

        activeTrack = nextTrack;
        paused = nextPaused;
        lastStatus = player.playbackStatus;

        if (trackChanged) {
            progressClock.reset({ trackId: nextTrack.id, positionSec: player.positionSec, playing: !nextPaused });
        } else {
            progressClock.update({ trackId: nextTrack.id, positionSec: player.positionSec, playing: !nextPaused });
        }
        positionSec = currentPositionSec();

        if (trackChanged) {
            lyricAbort?.abort();
            activeLyric = null;
            broadcastTrack();
            broadcastLyric();
            server?.broadcast('PlayerProgressReplay', {});
            broadcastPause();
            broadcastProgress();
            if (server && server.clientCount() > 0) void fetchLyrics(activeTrack);
            return;
        }

        if (statusChanged) broadcastPause();
        broadcastProgress();
    };

    const onPlayers = (players) => {
        if (stopped) return;
        const selected = selectActivePlayer(players, activePlayer?.name ?? null);
        applyPlayer(selected);
    };

    const onClientCountChange = (count) => {
        if (!activeTrack) return;
        if (count <= 0) {
            // The stage went away: forget the miss so reopening the source asks Dux again.
            lyricCache.delete(lyricCacheKey(activeTrack));
            activeLyric = null;
            return;
        }
        if (!activeLyric && !lyricFetch) void fetchLyrics(activeTrack);
    };

    const start = async () => {
        if (platform !== 'linux' || started || stopped) return false;
        started = true;

        artwork = deps.createArtworkStore({ fetchImpl, log });
        dms = deps.createDmsLyricsClient({ runtimeDir, log });
        titleResolver = deps.createTitleResolver ? deps.createTitleResolver({ fetchImpl, log }) : null;
        server = deps.createNowPlayingServer({
            port,
            host,
            log,
            getSnapshot: snapshot,
            getProgressMs: () => currentPositionSec() * 1000,
            getArtwork: token => artwork.get(token),
            onClientCountChange,
        });

        try {
            await server.start();
        } catch (error) {
            started = false;
            const code = error && typeof error === 'object' ? error.code : null;
            if (code === 'EADDRINUSE') {
                log.info('[Dux] port 9863 is already serving now-playing; leaving that service in charge');
            } else {
                log.warn('[Dux] could not start the now-playing endpoint', error);
            }
            server = null;
            return false;
        }

        if (!busAddress) {
            log.warn('[Dux] no session bus; Folia cannot follow Dux players');
            return true;
        }
        mpris = deps.createMprisClient({
            address: busAddress,
            uid,
            log,
            onPlayers,
        });
        void mpris.start();
        log.info('[Dux] following the player Dux is showing');
        return true;
    };

    const stop = async () => {
        stopped = true;
        lyricAbort?.abort();
        mpris?.stop();
        mpris = null;
        await server?.stop();
        server = null;
        activePlayer = null;
        activeTrack = null;
        activeLyric = null;
        lyricCache = new Map();
    };

    return { start, stop };
};

module.exports = {
    createDuxNowPlayingBridge,
    lyricPayload,
    sameTrack,
    trackForWire,
    trackFromPlayer,
};
