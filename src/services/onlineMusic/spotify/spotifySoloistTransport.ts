// Adapted from Duckey86/folia-major-spotify-aeskey-fix, AGPL-3.0.
import type { SongResult } from '../../../types';
import type { AudioQualityPreference } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { useAudioSettingsStore } from '../../../stores/useAudioSettingsStore';
import i18n from '../../../i18n/config';

// src/services/onlineMusic/spotify/spotifySoloist.ts
// Soloist outputs audio through the operating system; Folia retains the queue and lyric clock.
// A silent WAV keeps Folia's <audio> timeline usable; its waveform is NOT Soloist's audio.
// Soloist's unauthenticated WebSocket must only listen on localhost.
const SOLOIST_URL = 'ws://127.0.0.1:9090';
const SAMPLE_RATE = 8000;
const MAX_SILENCE_MS = 3 * 60 * 60 * 1000;
const MAX_TRACKS = 4;
const REPEAT_OFF_RETRY_MS = 2500;


type RegisteredTrack = { uri: string; durationMs: number };
type SoloistEvent = {
    type: string;
    logged_in?: boolean;
    message?: string;
    status?: string;
    item?: { uri?: string };
    options?: { repeat?: 'off' | 'context' | 'track' };
    position?: { position_ms?: number; timestamp_ms?: number; speed?: number };
};
const tracks = new Map<string, RegisteredTrack>();
let conn: WebSocket | null = null;
let latestSocket: WebSocket | null = null;
let connecting: Promise<WebSocket> | null = null;
let remoteLoggedIn = false;
let currentAudio: HTMLAudioElement | null = null;
let currentUri: string | null = null;
let currentSourceUrl: string | null = null;
let remoteUri: string | null = null;
let expectingPlayUntil = 0;
let listenersInstalled = false;
const cleanup: Array<() => void> = [];
let playbackGeneration = 0;
let wantsPlayback = false;
let playStartedAt = 0;
let pendingStartPosition: { uri: string; generation: number; positionMs: number } | null = null;
let remoteRepeat: 'off' | 'context' | 'track' | null = null;
let repeatOffPendingAt: number | null = null;
// Loaded only when playback starts: the store's cover resolver itself uses the provider registry.
let playbackStore: typeof import('../../../stores/usePlaybackStore').usePlaybackStore;
// Internal silent-timeline corrections must never be echoed to Soloist as user seeks.
const suppressedSeekUntil = new WeakMap<HTMLAudioElement, { target: number; startedAt: number }>();
const suppressedRemotePauseUntil = new WeakMap<HTMLAudioElement, number>();
const soloistVolume = () => {
    const { volume, isMuted } = useAudioSettingsStore.getState();
    return Math.round(Math.max(0, Math.min(1, isMuted ? 0 : volume)) * 100);
};

/** Duration-bearing silent media; the real audio is output by the separate Soloist process. */
export function createSilentWav(durationMs: number): Blob {
    if (Number.isFinite(durationMs) && durationMs > MAX_SILENCE_MS) {
        throw new OnlineProviderError('unsupported', i18n.t('soloist.errors.duration'), 'spotify');
    }
    const boundedMs = Math.max(1000, Number.isFinite(durationMs) ? durationMs : 180000);
    const frames = Math.ceil(boundedMs / 1000) * SAMPLE_RATE;
    const buffer = new ArrayBuffer(44 + frames);
    const view = new DataView(buffer);
    const put = (at: number, text: string) => {
        for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
    };
    put(0, 'RIFF');
    view.setUint32(4, 36 + frames, true);
    put(8, 'WAVE');
    put(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM format chunk
    view.setUint16(20, 1, true);  // PCM
    view.setUint16(22, 1, true);  // mono
    view.setUint32(24, SAMPLE_RATE, true);
    view.setUint32(28, SAMPLE_RATE, true); // byte rate (8-bit samples)
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    put(36, 'data');
    view.setUint32(40, frames, true);
    // 8-bit unsigned PCM silence is 128, not zero.
    new Uint8Array(buffer, 44).fill(128);
    return new Blob([buffer], { type: 'audio/wav' });
}

function infoOf(audio: HTMLAudioElement): RegisteredTrack | undefined {
    // currentSrc can still name the outgoing resource after React has assigned the next src.
    if (audio.currentSrc && audio.currentSrc !== audio.src) return undefined;
    return tracks.get(audio.currentSrc || audio.src);
}

const isSelectedAudio = (audio: HTMLAudioElement) => (
    audio.currentSrc === audio.src && audio.currentSrc === playbackStore.getState().audioSrc
);
const ownsTimeline = (audio: HTMLAudioElement) => (
    audio === currentAudio && audio.currentSrc === currentSourceUrl && isSelectedAudio(audio)
);

// Identify the silent timeline so it never overwrites captured audio bands.
export function isSoloistTimelineAudio(audio: HTMLAudioElement | null): boolean {
    return audio !== null && Boolean(infoOf(audio));
}

function syncPosition(position: SoloistEvent['position']) {
    if (!position || !currentAudio || !currentUri) return;
    const audio = currentAudio;
    if (!ownsTimeline(audio) || infoOf(audio)?.uri !== currentUri || audio.seeking || audio.ended) return;
    if (typeof position.timestamp_ms === 'number' && position.timestamp_ms < playStartedAt) return;
    const baseMs = position.position_ms;
    if (typeof baseMs !== 'number' || !Number.isFinite(baseMs)) return;
    const elapsedMs = typeof position.timestamp_ms === 'number' && position.speed === 1
        ? Math.max(0, Date.now() - position.timestamp_ms) : 0;
    const next = Math.max(0, Math.min((baseMs + elapsedMs) / 1000, Math.max(0, audio.duration - 0.1)));
    // Correct persistent offset, including differences smaller than the previous 1.3s dead zone.
    if (Number.isFinite(next) && Math.abs(audio.currentTime - next) > 0.35) {
        suppressedSeekUntil.set(audio, { target: next, startedAt: performance.now() });
        audio.currentTime = next;
    }
}

// Folia owns the queue in every loop mode. Soloist's context is just one track, so context
// repeat must never stand for Folia's repeat-all; repeat-one already restarts the silent timeline.
// Send this pair on the connected socket before play, independently of track-command generations.
function ensureRemoteRepeatOff(socket: WebSocket): void {
    if (socket !== latestSocket) return;
    if (remoteRepeat === 'off') return;
    const now = performance.now();
    if (repeatOffPendingAt !== null && now - repeatOffPendingAt < REPEAT_OFF_RETRY_MS) return;
    repeatOffPendingAt = now;
    try {
        socket.send(JSON.stringify({ type: 'command', command: 'set_repeat_track', enabled: false }));
        socket.send(JSON.stringify({ type: 'command', command: 'set_repeat_context', enabled: false }));
    } catch (error) {
        repeatOffPendingAt = null;
        throw error;
    }
}

function onEvent(event: SoloistEvent) {
    // Options describe the daemon, not the age of this track's position anchor. Process them
    // even when the snapshot below is too old to drive the current timeline.
    if (event.type === 'playback_state' || event.type === 'options_changed') {
        const repeat = event.options?.repeat;
        if (repeat === 'off' || repeat === 'context' || repeat === 'track') {
            remoteRepeat = repeat;
            // Dispatch acceptance is not state confirmation. Coalesce intermediate/duplicate
            // non-off snapshots until the options actually confirm off. If they never do, the
            // existing status poll can retry after a cooldown; there is no separate retry loop.
            if (repeat === 'off') repeatOffPendingAt = null;
            if (currentAudio && ownsTimeline(currentAudio) && remoteLoggedIn && conn?.readyState === WebSocket.OPEN) {
                try { ensureRemoteRepeatOff(conn); }
                catch (error) { console.warn('[Soloist] Could not disable remote repeat', error); }
            }
        }
    }
    // A late snapshot for an earlier play of the same URI must not pause or rewind its new play.
    if (typeof event.position?.timestamp_ms === 'number' && event.position.timestamp_ms < playStartedAt) return;
    if (event.type === 'auth_state') {
        remoteLoggedIn = event.logged_in === true;
        if (!remoteLoggedIn) {
            remoteRepeat = null;
            repeatOffPendingAt = null;
            pauseLocalTimeline();
        } else if (currentAudio && ownsTimeline(currentAudio) && conn?.readyState === WebSocket.OPEN) {
            try { ensureRemoteRepeatOff(conn); }
            catch (error) { console.warn('[Soloist] Could not restore remote repeat mode', error); }
        }
    }
    if (event.type === 'track_changed' || event.type === 'playback_state') {
        remoteUri = event.item?.uri ?? null;
    }
    // A restored HTMLAudioElement may already be at a saved position before its first playing.
    // Wait for Soloist to identify the requested track before seeking, so an outgoing track is untouched.
    if ((event.type === 'track_changed' || event.type === 'playback_state')
        && pendingStartPosition && pendingStartPosition.generation === playbackGeneration
        && remoteUri === pendingStartPosition.uri && currentAudio && ownsTimeline(currentAudio)) {
        const { positionMs } = pendingStartPosition;
        pendingStartPosition = null;
        expectingPlayUntil = Date.now() + 1300;
        playStartedAt = Date.now();
        command('seek', { position_ms: positionMs });
        return;
    }
    if (event.type === 'position_sync' || event.type === 'playback_state') {
        // Soloist's position_sync event contains no URI. Never apply an old
        // track's position to the silent timeline of a newly selected track.
        if (remoteUri === currentUri && Date.now() >= expectingPlayUntil) syncPosition(event.position);
    }
    // When a Spotify app pauses the same Soloist track, reflect it in Folia too.
    if ((event.type === 'playback_changed' || event.type === 'playback_state')
        && remoteUri === currentUri
        && currentAudio && ownsTimeline(currentAudio) && !currentAudio.ended && infoOf(currentAudio)?.uri === currentUri
        && Date.now() >= expectingPlayUntil) {
        if (event.status === 'paused' && !currentAudio.paused) {
            const audio = currentAudio;
            // Do not echo this remote pause back as a second pause command.
            suppressedRemotePauseUntil.set(audio, performance.now() + 1000);
            wantsPlayback = false;
            audio.pause();
        }
    }
}

/** Stop the lyric clock when its audible output disappears; a later Play reconnects at this position. */
function pauseLocalTimeline(): void {
    pendingStartPosition = null;
    wantsPlayback = false;
    if (currentAudio && ownsTimeline(currentAudio) && !currentAudio.paused && !currentAudio.ended) {
        suppressedRemotePauseUntil.set(currentAudio, performance.now() + 1000);
        currentAudio.pause();
    }
}

/** Connect only to Soloist on loopback. The saved API key never enters this transport. */
function ready(): Promise<WebSocket> {
    if (conn?.readyState === WebSocket.OPEN && remoteLoggedIn) return Promise.resolve(conn);
    if (connecting) return connecting;
    const previous = latestSocket;
    latestSocket = null; conn = null;
    previous?.close();
    connecting = new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(SOLOIST_URL);
        latestSocket = socket;
        remoteUri = null;
        remoteRepeat = null;
        repeatOffPendingAt = null;
        let settled = false;
        const limit = setTimeout(() => {
            if (settled) return;
            settled = true;
            socket.close();
            reject(new OnlineProviderError('unavailable', i18n.t('soloist.errors.connection'), 'spotify'));
        }, 5000);
        const fail = (reason: 'connection' | 'pairing') => {
            if (settled) return;
            settled = true;
            clearTimeout(limit);
            reject(new OnlineProviderError('unavailable', i18n.t(`soloist.errors.${reason}`), 'spotify'));
        };
        socket.addEventListener('message', raw => {
            if (socket !== latestSocket) return;
            let data: SoloistEvent;
            try {
                data = JSON.parse(String(raw.data)) as SoloistEvent;
            } catch { return; }
            onEvent(data);
            if (!settled && data.type === 'auth_state') {
                if (!data.logged_in) {
                    fail('pairing');
                    socket.close();
                } else {
                    conn = socket;
                    try { ensureRemoteRepeatOff(socket); }
                    catch (error) {
                        console.warn('[Soloist] Could not initialize remote repeat', error);
                        fail('connection');
                        socket.close();
                        return;
                    }
                    settled = true;
                    clearTimeout(limit);
                    console.info('[Soloist] Connected to Spotify Soloist on localhost');
                    resolve(socket);
                }
            } else if (data.type === 'error') {
                // A rejected control must not leave repeat synchronization permanently pending.
                repeatOffPendingAt = null;
                remoteRepeat = null;
                console.warn('[Soloist] Command rejected:', data.message);
                pauseLocalTimeline();
            }
        });
        socket.addEventListener('error', () => fail('connection'));
        socket.addEventListener('close', () => {
            if (socket !== latestSocket) return;
            if (conn === socket) conn = null;
            pauseLocalTimeline();
            remoteLoggedIn = false;
            remoteUri = null;
            if (!settled) fail('connection');
        });
    }).finally(() => { connecting = null; });
    return connecting;
}

// Re-anchor Folia's silent timeline when returning from a background window.
// Soloist position_sync is an anchor update, NOT a periodic clock tick; get_state
// supplies a fresh position even when no new position_sync has been broadcast.
let lastPositionRequestMs = 0;
function requestPositionSnapshot(): void {
    if (!currentUri || !currentAudio || !remoteLoggedIn || conn?.readyState !== WebSocket.OPEN) return;
    if (!ownsTimeline(currentAudio) || currentAudio.ended) return;
    if (Date.now() - lastPositionRequestMs < 600) return;
    lastPositionRequestMs = Date.now();
    try {
        conn.send(JSON.stringify({ type: 'command', command: 'get_state' }));
    } catch (error) {
        console.warn('[Soloist] Could not refresh playback position', error);
    }
}

let commandChain: Promise<void> = Promise.resolve();
function command(name: string, fields: Record<string, unknown> = {}): void {
    // Commands are ordered to avoid a stale pause overtaking the next track's play.
    // Ordering alone is insufficient: a selection or pause can supersede work awaiting ready().
    const generation = playbackGeneration;
    commandChain = commandChain.catch(() => undefined).then(async () => {
        if (generation !== playbackGeneration) return;
        const socket = await ready();
        if (generation !== playbackGeneration) return;
        if (name === 'play') ensureRemoteRepeatOff(socket);
        socket.send(JSON.stringify({ type: 'command', command: name, ...fields }));
    }).catch(error => {
        if (generation !== playbackGeneration) return;
        console.error(`[Soloist] ${name} failed`, error);
        // A failed play must remain retryable by the normal play control.
        if (name === 'play' && currentAudio && ownsTimeline(currentAudio)) currentAudio.pause();
    });
}

/** Capture non-bubbling media events, and forward Folia's existing transport to Soloist. */
function installControls() {
    if (listenersInstalled) return;
    listenersInstalled = true;
    let snapshotTimer: number | undefined;
    cleanup.push(() => window.clearTimeout(snapshotTimer));
    const listen = (target: EventTarget, name: string, listener: EventListener, capture = false) => {
        target.addEventListener(name, listener, capture);
        cleanup.push(() => target.removeEventListener(name, listener, capture));
    };

    listen(document, 'playing', event => {
        const audio = event.target;
        if (!(audio instanceof HTMLAudioElement)) return;
        if (!isSelectedAudio(audio) || audio.paused || audio.ended) return;
        const info = infoOf(audio);
        if (!info) {
            if (currentAudio) command('pause');
            currentAudio = null;
            currentUri = null;
            currentSourceUrl = null;
            return;
        }
        const sourceUrl = audio.currentSrc;
        const changed = info.uri !== currentUri || currentAudio !== audio || currentSourceUrl !== sourceUrl;
        // Seeking and rebuffering can emit playing again before Soloist confirms the first play.
        if (!changed && wantsPlayback) return;
        playbackGeneration += 1;
        const generation = playbackGeneration;
        wantsPlayback = true;
        suppressedSeekUntil.delete(audio);
        suppressedRemotePauseUntil.delete(audio);
        currentAudio = audio;
        currentUri = info.uri;
        currentSourceUrl = sourceUrl;
        expectingPlayUntil = Date.now() + 1300;
        playStartedAt = Date.now();
        const startsTrack = changed || remoteUri !== info.uri;
        pendingStartPosition = startsTrack && Number.isFinite(audio.currentTime) && audio.currentTime > 0
            ? { uri: info.uri, generation, positionMs: Math.round(audio.currentTime * 1000) } : null;
        command('play', startsTrack ? { uri: info.uri } : {});
        command('set_volume', { volume: soloistVolume() });
        // Re-check after Soloist has processed play and the track guard has expired.
        window.clearTimeout(snapshotTimer);
        snapshotTimer = window.setTimeout(() => {
            if (generation === playbackGeneration && ownsTimeline(audio) && !audio.paused) requestPositionSnapshot();
        }, 1700);
        console.info(`[Soloist] ${changed ? 'Starting' : 'Resuming'} ${info.uri}`);
    }, true);

    listen(document, 'pause', event => {
        const audio = event.target;
        if (!(audio instanceof HTMLAudioElement) || !ownsTimeline(audio) || !audio.paused) return;
        wantsPlayback = false;
        playbackGeneration += 1;
        pendingStartPosition = null;
        if (performance.now() < (suppressedRemotePauseUntil.get(audio) ?? 0)) return;
        command('pause');
    }, true);

    listen(document, 'seeking', event => {
        const audio = event.target;
        if (!(audio instanceof HTMLAudioElement) || !ownsTimeline(audio)) return;
        const correction = suppressedSeekUntil.get(audio);
        if (correction) {
            suppressedSeekUntil.delete(audio);
            const ageSeconds = (performance.now() - correction.startedAt) / 1000;
            // The seeking event can be delayed by background throttling. Compare with the
            // corrected position extrapolated forward, not a short fixed 400ms timeout.
            if (ageSeconds < 15 && Math.abs(audio.currentTime - (correction.target + ageSeconds)) < 1.0) return;
        }
        if (Number.isFinite(audio.currentTime)) {
            expectingPlayUntil = Date.now() + 1300;
            playStartedAt = Date.now();
            // Native repeat-one wraps without ended. Explicitly restart this URI, since the
            // remote single-track context may already have stopped or advanced at its real end.
            if (audio.loop && !audio.paused && audio.currentTime < 0.5 && currentUri) {
                playbackGeneration += 1;
                command('play', { uri: currentUri });
            } else {
                command('seek', { position_ms: Math.round(audio.currentTime * 1000) });
            }
        }
    }, true);

    // Folia's selected source, not whichever deck emits last, owns the remote player.
    // A source change also invalidates outgoing callbacks while the next track is loading.
    cleanup.push(playbackStore.subscribe((next, previous) => {
        if (next.audioSrc === previous.audioSrc || !currentAudio || next.audioSrc === currentSourceUrl) return;
        playbackGeneration += 1;
        wantsPlayback = false;
        currentAudio = null;
        currentUri = null;
        currentSourceUrl = null;
        command('pause');
    }));

    // Folia applies volume in its Web Audio graph, so element.volume may stay 1.
    // Read the actual listener volume from Folia's audio settings instead.
    cleanup.push(useAudioSettingsStore.subscribe((next, previous) => {
        if (currentAudio && (next.volume !== previous.volume || next.isMuted !== previous.isMuted)) {
            command('set_volume', { volume: soloistVolume() });
        }
    }));

    listen(document, 'ended', event => {
        const audio = event.target;
        if (!(audio instanceof HTMLAudioElement) || !ownsTimeline(audio) || !audio.ended) return;
        wantsPlayback = false;
        playbackGeneration += 1;
        // Even a one-song repeat-all queue can reuse this URL: its next playing is a fresh start.
        currentSourceUrl = null;
        command('pause');
    }, true);

    // Keep the clock anchored while visible, and always re-check immediately on Alt+Tab back.
    // This is lightweight metadata polling; it does not stream audio over WebSocket.
    const positionTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible' && currentAudio && !currentAudio.paused) {
            requestPositionSnapshot();
        }
    }, 2500);
    cleanup.push(() => window.clearInterval(positionTimer));
    listen(window, 'focus', requestPositionSnapshot);
    listen(document, 'visibilitychange', () => {
        if (document.visibilityState === 'visible') requestPositionSnapshot();
    });

    listen(window, 'beforeunload', disposeSoloistTransport);
}

/** Release media hooks and pause the remote device when this renderer leaves or is hot-reloaded. */
export function disposeSoloistTransport(): void {
    if (currentAudio && conn?.readyState === WebSocket.OPEN && remoteLoggedIn) {
        conn.send(JSON.stringify({ type: 'command', command: 'pause' }));
    }
    playbackGeneration += 1;
    pendingStartPosition = null;
    cleanup.splice(0).forEach(dispose => dispose());
    listenersInstalled = false;
    currentAudio = null;
    currentUri = null;
    currentSourceUrl = null;
    latestSocket?.close();
    latestSocket = null;
    conn = null;
    for (const url of tracks.keys()) URL.revokeObjectURL(url);
    tracks.clear();
}
if (import.meta.hot) import.meta.hot.dispose(disposeSoloistTransport);

/** Returns playable timeline media, while the actual audible sound is delegated to Soloist. */
export async function soloistSource(song: SongResult, trackId: string, quality: AudioQualityPreference): Promise<{ url: string; fetchedAt: number; quality: AudioQualityPreference }> {
    if (!/^[0-9A-Za-z]{22}$/.test(trackId)) throw new Error('Invalid Spotify track ID');
    playbackStore ??= (await import('../../../stores/usePlaybackStore')).usePlaybackStore;
    const setup = await window.electron?.soloistPrepare?.();
    if (!setup?.ok) throw new OnlineProviderError('unavailable', i18n.t(`soloist.errors.${setup?.message || 'unavailable'}`), 'spotify');
    await ready();
    installControls();
    const durationMs = createProviderSongMetadata(song).durationMs || 180000;
    const url = URL.createObjectURL(createSilentWav(durationMs));
    tracks.set(url, { uri: `spotify:track:${trackId}`, durationMs });
    // Limit blob memory; never revoke the current audio element's source.
    if (tracks.size > MAX_TRACKS) {
        for (const key of tracks.keys()) {
            if (tracks.size <= MAX_TRACKS) break;
            if (currentAudio && (currentAudio.currentSrc === key || currentAudio.src === key)) continue;
            tracks.delete(key);
            URL.revokeObjectURL(key);
        }
    }
    return { url, fetchedAt: Date.now(), quality };
}


/** Prefetched blob URLs can outlive this transport's bounded media registry. */
export const isSoloistSourceValid = (url: string): boolean => tracks.has(url);
