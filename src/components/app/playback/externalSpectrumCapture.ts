// src/components/app/playback/externalSpectrumCapture.ts
// On the Windows desktop build the external route can analyse what the machine is actually playing:
// Chromium's loopback Streams hands the renderer the system's own sound, which is analysed in memory
// here and read by the visualizer in place of the simulated bands. Nothing is recorded or written.

import type { ExternalSpectrumBands } from './externalSpectrum';
import { SPECTRUM_BINS } from './externalSpectrum';
import { emptySpectrumBandLevels, readSpectrumBandLevels } from './spectrumBands';

/** Silent this long and the simulated bands take over again (a muted player, a paused one). */
const SILENCE_LIMIT_MS = 2000;
/** The first refusal waits this long before another attempt; each one after doubles it. */
const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 10 * 60_000;

type CaptureState = 'idle' | 'starting' | 'running';

let state: CaptureState = 'idle';
let stream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let analyserBins: Uint8Array<ArrayBuffer> | null = null;
let silentSinceMs: number | null = null;
/** Bumped whenever the capture is released, so an attempt still in flight sees that it is unwanted. */
let generation = 0;
let failures = 0;
let retryAfterMs = 0;

// Read every frame, so both are made once and written in place: no frame allocates (M3).
const BANDS: ExternalSpectrumBands = { ...emptySpectrumBandLevels(), spectrum: new Uint8Array(SPECTRUM_BINS) };

const bridge = () => (typeof window === 'undefined' ? undefined : window.electron);

/**
 * Whether this build can capture the machine's sound at all. Off Windows there is no loopback in
 * Streams; in the browser there is no main process to arm, and its own picker would ask the listener
 * to share a screen for nothing.
 */
const canCapture = (): boolean => {
    const api = bridge();
    return api?.platform === 'win32'
        && typeof api.armExternalSpectrumCapture === 'function'
        && typeof navigator !== 'undefined'
        && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
};

const stopTracks = (target: MediaStream | null) => {
    if (!target) return;
    for (const track of target.getTracks()) {
        try {
            track.stop();
        } catch (error) {
            console.warn('[ExternalSpectrum] Could not stop a capture track', error);
        }
    }
};

const release = () => {
    generation += 1;
    const held = stream;
    const context = audioContext;
    stream = null;
    audioContext = null;
    analyser = null;
    analyserBins = null;
    silentSinceMs = null;
    state = 'idle';
    // Leaving the route ends the episode: the next one may try again at once.
    failures = 0;
    retryAfterMs = 0;
    stopTracks(held);
    if (context) {
        try {
            void Promise.resolve(context.close()).catch(() => {});
        } catch (error) {
            console.warn('[ExternalSpectrum] Could not close the capture context', error);
        }
    }
};

/**
 * Records the failure and puts the next attempt behind a growing delay: a machine that cannot hand
 * over its sound (no loopback device, a session that refuses it) must not be asked again on every
 * song change. The error itself goes to the log, as every thrown thing here does.
 */
const noteFailure = (reason: string, error: unknown) => {
    failures += 1;
    retryAfterMs = Date.now() + Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS);
    if (error === null) console.warn(`[ExternalSpectrum] ${reason}`);
    else console.warn(`[ExternalSpectrum] ${reason}`, error);
};

/**
 * Arms the main process, takes the machine's sound and starts analysing it. Resolves when there is
 * something to read or when the attempt was refused; a refusal is logged once and then backed off.
 */
export const startExternalSpectrumCapture = async (): Promise<void> => {
    if (state !== 'idle' || Date.now() < retryAfterMs) return;
    if (!canCapture()) return;

    const api = bridge();
    if (!api?.armExternalSpectrumCapture) return;

    state = 'starting';
    const attemptGeneration = generation;
    let granted: MediaStream | null = null;
    let armFailed: unknown = null;
    try {
        await api.armExternalSpectrumCapture(true);
    } catch (error) {
        // Unarmed, the handler refuses and getDisplayMedia would fail with a message about the
        // listener's choice; the real cause is this one, so it is reported instead.
        armFailed = error;
    }

    if (armFailed === null) {
        try {
            granted = await navigator.mediaDevices.getDisplayMedia({
                // A picture is required by getDisplayMedia and never wanted here: the smallest, slowest
                // one the handler can hand over. No frame is ever read from that track.
                video: { frameRate: { max: 1 }, width: { max: 16 }, height: { max: 16 } },
                audio: true,
            });
        } catch (error) {
            state = 'idle';
            noteFailure('could not capture the machine\'s sound', error);
        } finally {
            // The main process spends the arm on the grant itself; this undoes one that bought nothing
            // (a refused request, or a call that never reached the handler).
            try {
                await api.armExternalSpectrumCapture(false);
            } catch (error) {
                console.warn('[ExternalSpectrum] Could not disarm the system-sound capture', error);
            }
        }
    }

    if (armFailed !== null) {
        state = 'idle';
        noteFailure('could not arm the system-sound capture', armFailed);
        return;
    }

    if (!granted) return;

    if (attemptGeneration !== generation) {
        // The route left the external player while the sound was being handed over.
        stopTracks(granted);
        return;
    }

    if (granted.getAudioTracks().length === 0) {
        stopTracks(granted);
        state = 'idle';
        noteFailure('the granted stream carries no audio', null);
        return;
    }

    try {
        const AudioContextClass = window.AudioContext
            || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        const context = new AudioContextClass();
        const node = context.createAnalyser();
        node.fftSize = 2048;
        node.smoothingTimeConstant = 0.6;
        const source = context.createMediaStreamSource(granted);
        source.connect(node);
        // An analyser alone is not pulled by the graph and would stop being fed: a silent gain on the
        // way to the speakers keeps the frames coming without anything being heard twice.
        const sink = context.createGain();
        sink.gain.value = 0;
        node.connect(sink);
        sink.connect(context.destination);

        stream = granted;
        audioContext = context;
        analyser = node;
        analyserBins = new Uint8Array(node.frequencyBinCount);
        silentSinceMs = null;
        state = 'running';
        failures = 0;
        retryAfterMs = 0;
        // The capture can end on its own (a revoked sharing session, a device that went away): the
        // next frame finds nothing to read and the simulated bands take over.
        for (const track of granted.getTracks()) {
            track.addEventListener?.('ended', release);
        }
        console.log('[ExternalSpectrum] Analysing the machine\'s sound');
    } catch (error) {
        stopTracks(granted);
        state = 'idle';
        noteFailure('could not analyse the captured sound', error);
    }
};

/**
 * The bands of the machine's sound, or null when there is nothing to show - not capturing, or silent
 * long enough that the simulated bands should move with the song again. Written in place: the
 * visualizer calls this every frame (M3).
 */
export const readCapturedExternalSpectrum = (): ExternalSpectrumBands | null => {
    const node = analyser;
    const data = analyserBins;
    if (state !== 'running' || !node || !data) return null;

    // Deliberately no exception guard: without it the attempt is dead and the simulated bands are
    // what the listener sees, which is the right answer for a capture that broke mid-song.
    node.getByteFrequencyData(data);

    let loudest = 0;
    for (let index = 0; index < data.length; index += 1) {
        if (data[index] > loudest) loudest = data[index];
    }

    if (loudest === 0) {
        const now = Date.now();
        if (silentSinceMs === null) {
            silentSinceMs = now;
        } else if (now - silentSinceMs >= SILENCE_LIMIT_MS) {
            // Silence is a muted player or a paused one: the simulated bands keep the song moving.
            // The analyser keeps being read, so sound coming back is noticed at once.
            return null;
        }
    } else {
        silentSinceMs = null;
    }

    readSpectrumBandLevels(data, BANDS);

    // The analyser answers with 1024 bins, the bars take 128: each output bin averages the run of
    // bins it stands for, in place.
    const binCount = data.length;
    for (let index = 0; index < SPECTRUM_BINS; index += 1) {
        const start = Math.floor((index * binCount) / SPECTRUM_BINS);
        const end = Math.max(start + 1, Math.floor(((index + 1) * binCount) / SPECTRUM_BINS));
        let sum = 0;
        for (let bin = start; bin < end; bin += 1) {
            sum += data[bin] | 0;
        }
        BANDS.spectrum[index] = Math.round(sum / (end - start));
    }
    return BANDS;
};

/**
 * Drives the capture from the route the playback store reports: held exactly as long as the route is
 * the external player's, because Folia's own decks would otherwise be captured too once it sounds a
 * song itself. A new song gets a fresh attempt, in case the capture died with the player that carried
 * the last one; every other store change leaves the running capture alone.
 */
export const syncExternalSpectrumForRoute = (route: string, songChanged: boolean): void => {
    if (route !== 'external') {
        stopExternalSpectrumCapture();
        return;
    }
    if (!songChanged) return;
    void startExternalSpectrumCapture();
};

/** Stops the capture and closes its context. Called when the route leaves the external player. */
export const stopExternalSpectrumCapture = (): void => {
    if (state === 'idle' && !stream && !audioContext) {
        failures = 0;
        retryAfterMs = 0;
        return;
    }
    release();
};
