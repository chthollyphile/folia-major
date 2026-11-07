// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The external route's real spectrum: what the desktop build does with the machine's own sound, from
// arming the main process to handing the visualizer bands it can draw.
//
// The module holds one capture for the app, so every test imports a fresh copy.

type FakeTrack = {
    kind: string;
    stop: () => void;
    addEventListener?: (type: string, listener: () => void) => void;
};

const makeStream = (kinds: string[]) => {
    const tracks: FakeTrack[] = kinds.map(kind => ({ kind, stop: vi.fn() }));
    const stream = {
        getTracks: () => tracks,
        getAudioTracks: () => tracks.filter(track => track.kind === 'audio'),
    };
    return { stream: stream as unknown as MediaStream, tracks };
};

// 1024 bins answer a 2048-point analyser, as the real one does.
const makeAnalyser = (data: Uint8Array) => {
    const analyser = {
        fftSize: 0,
        smoothingTimeConstant: 0,
        get frequencyBinCount() {
            return analyser.fftSize / 2;
        },
        getByteFrequencyData: vi.fn((target: Uint8Array) => {
            target.set(data.subarray(0, Math.min(data.length, target.length)));
        }),
        connect: vi.fn(),
    };
    return analyser;
};

type InstallOptions = {
    audioTracks?: number;
    refuse?: unknown;
    /** What the context's state says once resume() has settled. */
    contextState?: string;
    /** resume() rejects with this. */
    resumeFails?: unknown;
    /** The step after the context exists throws, as a device that cannot be analysed would. */
    analyserFails?: boolean;
    /** getDisplayMedia answers only when resolveGrant() is called. */
    defer?: boolean;
};

type Harness = {
    data: Uint8Array;
    analyser: ReturnType<typeof makeAnalyser>;
    context: { close: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn>; state: string };
    arm: ReturnType<typeof vi.fn>;
    stopped: ReturnType<typeof vi.fn>;
    getDisplayMedia: ReturnType<typeof vi.fn>;
    granted: ReturnType<typeof makeStream>;
    resolveGrant: () => void;
};

const BIN_COUNT = 1024;

const install = (options: InstallOptions = {}): Harness => {
    const data = new Uint8Array(BIN_COUNT);
    const analyser = makeAnalyser(data);
    const context = {
        close: vi.fn(() => Promise.resolve()),
        resume: vi.fn(async () => {
            if (options.resumeFails !== undefined) throw options.resumeFails;
        }),
        state: options.contextState ?? 'running',
    };
    const AudioContextStub = class {
        destination = { name: 'destination' };
        state = options.contextState ?? 'running';
        createAnalyser() {
            if (options.analyserFails) throw new Error('the analyser could not be made');
            return analyser;
        }
        createMediaStreamSource() {
            return { connect: vi.fn() };
        }
        createGain() {
            return { gain: { value: 1 }, connect: vi.fn() };
        }
        close() {
            return context.close();
        }
        resume() {
            return context.resume();
        }
    };
    (window as unknown as { AudioContext: unknown }).AudioContext = AudioContextStub;

    // The picture half of the request comes back too: kept, never read.
    const audioTracks = Array.from({ length: options.audioTracks ?? 1 }, () => 'audio');
    const granted = makeStream(['video', ...audioTracks]);
    let pending: ((grantedStream: MediaStream) => void) | null = null;
    const getDisplayMedia = vi.fn(async () => {
        if (options.defer) {
            return new Promise<MediaStream>(resolve => {
                pending = resolve;
            });
        }
        if (options.refuse !== undefined) throw options.refuse;
        return granted.stream;
    });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });

    const arm = vi.fn(async () => true);
    const stopped = vi.fn(async () => true);
    (window as unknown as { electron: unknown }).electron = {
        platform: 'win32',
        armExternalSpectrumCapture: arm,
        noteExternalSpectrumCaptureStopped: stopped,
    };

    return {
        data,
        analyser,
        context,
        arm,
        stopped,
        getDisplayMedia,
        granted,
        resolveGrant: () => pending?.(granted.stream),
    };
};

const importCapture = async () => {
    vi.resetModules();
    return import('../../../src/components/app/playback/externalSpectrumCapture');
};

let warned: ReturnType<typeof vi.spyOn>;
let logged: ReturnType<typeof vi.spyOn>;
let informed: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logged = vi.spyOn(console, 'log').mockImplementation(() => {});
    informed = vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (window as unknown as { electron?: unknown }).electron;
    Reflect.deleteProperty(navigator, 'mediaDevices');
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe('externalSpectrumCapture', () => {
    it('arms the main process around the one display-media call and reads real bands', async () => {
        const harness = install();
        // A loud low band and some treble: exactly what the analyser hands over.
        for (let index = 0; index < 600; index += 1) harness.data[index] = 180;
        const capture = await importCapture();

        await capture.startExternalSpectrumCapture();

        expect(harness.arm.mock.calls).toEqual([[true], [false]]);
        expect(harness.getDisplayMedia).toHaveBeenCalledOnce();
        expect(harness.getDisplayMedia.mock.calls[0][0]).toMatchObject({ audio: true, video: expect.any(Object) });
        expect(harness.analyser.fftSize).toBe(2048);
        expect(harness.analyser.smoothingTimeConstant).toBe(0.6);

        const bands = capture.readCapturedExternalSpectrum();
        expect(bands).not.toBeNull();
        expect(bands!.spectrum).toBeInstanceOf(Uint8Array);
        expect(bands!.spectrum).toHaveLength(128);
        for (const key of ['power', 'bass', 'lowMid', 'mid', 'vocal', 'treble'] as const) {
            expect(Number.isFinite(bands![key])).toBe(true);
            expect(bands![key]).toBeGreaterThan(0);
        }
        expect(bands!.spectrum.some(value => value > 0)).toBe(true);
        expect(bands!.spectrum.every(value => value <= 255)).toBe(true);

        capture.stopExternalSpectrumCapture();
    });

    it('hands back the same bands object and bin array every frame, with nothing allocated', async () => {
        const harness = install();
        harness.data[10] = 200;
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();

        const first = capture.readCapturedExternalSpectrum();
        const spectrum = first!.spectrum;
        const second = capture.readCapturedExternalSpectrum();

        expect(second).toBe(first);
        expect(second!.spectrum).toBe(spectrum);

        capture.stopExternalSpectrumCapture();
    });

    it('holds the last frame it heard while the machine is silent, so a pause never jumps', async () => {
        const harness = install();
        for (let index = 0; index < 600; index += 1) harness.data[index] = 180;
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();

        const playing = capture.readCapturedExternalSpectrum()!;
        const held = {
            power: playing.power,
            bass: playing.bass,
            lowMid: playing.lowMid,
            mid: playing.mid,
            vocal: playing.vocal,
            treble: playing.treble,
        };
        const heldSpectrum = Array.from(playing.spectrum);
        // Paused: the analyser falls to zero within a fifth of a second and stays there.
        harness.data.fill(0);
        vi.useFakeTimers();

        for (let frame = 0; frame < 10; frame += 1) {
            vi.advanceTimersByTime(250);
            const stillHeld = capture.readCapturedExternalSpectrum();
            expect(stillHeld).toBe(playing);
            expect(stillHeld).toMatchObject(held);
            expect(Array.from(stillHeld!.spectrum)).toEqual(heldSpectrum);
        }

        // The song resumes: the real bands are read again at once, with no step back up from zero.
        harness.data[10] = 200;
        const resumed = capture.readCapturedExternalSpectrum();
        expect(resumed).not.toBeNull();
        expect(Array.from(resumed!.spectrum)).not.toEqual(heldSpectrum);

        capture.stopExternalSpectrumCapture();
    });

    it('falls back to the simulated bands when the capture has never carried sound', async () => {
        const harness = install();
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();
        vi.useFakeTimers();

        // The first frames of silence still draw the bands it has (all zero).
        expect(capture.readCapturedExternalSpectrum()).not.toBeNull();

        vi.advanceTimersByTime(1999);
        expect(capture.readCapturedExternalSpectrum()).not.toBeNull();

        vi.advanceTimersByTime(1);
        expect(capture.readCapturedExternalSpectrum()).toBeNull();

        // Sound comes back: the capture is still being read, so the bands return at once.
        harness.data[10] = 200;
        expect(capture.readCapturedExternalSpectrum()).not.toBeNull();

        capture.stopExternalSpectrumCapture();
    });

    it('starts the capture context and treats a context that will not run as a failed attempt', async () => {
        const suspended = install({ contextState: 'suspended' });
        let capture = await importCapture();
        await capture.startExternalSpectrumCapture();

        expect(suspended.context.resume).toHaveBeenCalledOnce();
        expect(capture.readCapturedExternalSpectrum()).toBeNull();
        expect(suspended.context.close).toHaveBeenCalledOnce();
        for (const track of suspended.granted.tracks) expect(track.stop).toHaveBeenCalledOnce();
        expect(suspended.stopped).toHaveBeenCalledOnce();
        expect(warned.mock.calls[0][1]).toBeInstanceOf(Error);
        expect((warned.mock.calls[0][1] as Error).message).toContain('suspended');

        // A resume that rejects is the same failure, reported with the reason it gave.
        const resumeError = new Error('not allowed to play audio');
        const rejected = install({ resumeFails: resumeError });
        capture = await importCapture();
        await capture.startExternalSpectrumCapture();

        expect(rejected.context.close).toHaveBeenCalledOnce();
        expect(capture.readCapturedExternalSpectrum()).toBeNull();
        expect(warned.mock.calls[1][1]).toBe(resumeError);
    });

    it('closes the context it made when a later step throws', async () => {
        const harness = install({ analyserFails: true });
        const capture = await importCapture();

        await capture.startExternalSpectrumCapture();

        expect(harness.context.close).toHaveBeenCalledOnce();
        for (const track of harness.granted.tracks) expect(track.stop).toHaveBeenCalledOnce();
        expect(harness.stopped).toHaveBeenCalledOnce();
        expect(capture.readCapturedExternalSpectrum()).toBeNull();
        expect(warned).toHaveBeenCalledTimes(1);
    });

    it('gives a stream with no audio back without counting it as a failure', async () => {
        const harness = install({ audioTracks: 0 });
        const capture = await importCapture();

        await capture.startExternalSpectrumCapture();

        for (const track of harness.granted.tracks) expect(track.stop).toHaveBeenCalledOnce();
        expect(capture.readCapturedExternalSpectrum()).toBeNull();
        expect(warned).not.toHaveBeenCalled();
        expect(informed).toHaveBeenCalledWith(expect.stringContaining('carries no audio'));

        // Nothing is backed off: the next song asks the machine again at once.
        await capture.startExternalSpectrumCapture();
        expect(harness.getDisplayMedia).toHaveBeenCalledTimes(2);
    });

    it('warns once when the capture is refused and does not ask again straight away', async () => {
        const harness = install({ refuse: new Error('no loopback device') });
        const capture = await importCapture();

        await capture.startExternalSpectrumCapture();
        expect(warned).toHaveBeenCalledTimes(1);
        expect(warned.mock.calls[0][0]).toContain('[ExternalSpectrum]');
        expect(warned.mock.calls[0][1]).toBeInstanceOf(Error);
        expect(capture.readCapturedExternalSpectrum()).toBeNull();

        // A song change within the back-off asks nothing of the machine again.
        await capture.startExternalSpectrumCapture();
        expect(harness.getDisplayMedia).toHaveBeenCalledOnce();
        expect(warned).toHaveBeenCalledTimes(1);

        // Armed and disarmed around every attempt, the refusal included.
        expect(harness.arm.mock.calls).toEqual([[true], [false]]);

        capture.stopExternalSpectrumCapture();
    });

    it('logs the first failure of an episode and only counts the ones after it', async () => {
        const harness = install({ refuse: new Error('no loopback device') });
        const capture = await importCapture();

        await capture.startExternalSpectrumCapture();
        expect(warned).toHaveBeenCalledTimes(1);

        // Past the back-off the same machine fails again, and the line was already written.
        vi.useFakeTimers();
        vi.advanceTimersByTime(61_000);
        await capture.startExternalSpectrumCapture();
        expect(harness.getDisplayMedia).toHaveBeenCalledTimes(2);
        expect(warned).toHaveBeenCalledTimes(1);

        // Leaving the route ends the episode: the next one may speak up again.
        capture.stopExternalSpectrumCapture();
        await capture.startExternalSpectrumCapture();
        expect(warned).toHaveBeenCalledTimes(2);
    });

    it('logs each switch between the captured sound and the simulated bands once', async () => {
        const harness = install();
        harness.data[10] = 150;
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();

        capture.readCapturedExternalSpectrum();
        capture.readCapturedExternalSpectrum();
        expect(informed).toHaveBeenCalledTimes(1);
        expect(informed.mock.calls[0][0]).toContain("machine's sound");

        // A held frame is still the captured sound: no second line.
        harness.data.fill(0);
        capture.readCapturedExternalSpectrum();
        expect(informed).toHaveBeenCalledTimes(1);

        // Leaving the route is the switch back to the simulation.
        capture.stopExternalSpectrumCapture();
        expect(informed).toHaveBeenCalledTimes(2);
        expect(informed.mock.calls[1][0]).toContain('simulated bands');
    });

    it('reports the end of a capture it stops, so the window may be throttled again', async () => {
        const harness = install();
        harness.data[10] = 120;
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();
        expect(harness.stopped).not.toHaveBeenCalled();

        capture.stopExternalSpectrumCapture();
        expect(harness.stopped).toHaveBeenCalledOnce();
    });

    it('warns when the context refuses to close', async () => {
        const harness = install();
        harness.context.close.mockRejectedValueOnce(new Error('the context was already closed'));
        harness.data[10] = 120;
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();

        capture.stopExternalSpectrumCapture();

        await vi.waitFor(() => {
            expect(warned).toHaveBeenCalledWith(
                expect.stringContaining('Could not close the capture context'),
                expect.any(Error),
            );
        });
    });

    it('starts with the external route, keeps the one capture across songs and stops when it leaves', async () => {
        const harness = install();
        harness.data[10] = 140;
        const capture = await importCapture();

        // Another route sounds its own decks: the machine is never captured.
        capture.syncExternalSpectrumForRoute('standard', true);
        expect(harness.getDisplayMedia).not.toHaveBeenCalled();

        capture.syncExternalSpectrumForRoute('external', true);
        await vi.waitFor(() => expect(capture.readCapturedExternalSpectrum()).not.toBeNull());

        // A song change asks for nothing new while the capture is up.
        capture.syncExternalSpectrumForRoute('external', true);
        expect(harness.getDisplayMedia).toHaveBeenCalledOnce();

        capture.syncExternalSpectrumForRoute('standard', false);
        for (const track of harness.granted.tracks) expect(track.stop).toHaveBeenCalledOnce();
        expect(harness.context.close).toHaveBeenCalledOnce();
        expect(capture.readCapturedExternalSpectrum()).toBeNull();
    });

    it('stops every track and closes its context when the route leaves the external player', async () => {
        const harness = install();
        harness.data[10] = 120;
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();
        expect(capture.readCapturedExternalSpectrum()).not.toBeNull();

        capture.stopExternalSpectrumCapture();

        for (const track of harness.granted.tracks) expect(track.stop).toHaveBeenCalledOnce();
        expect(harness.context.close).toHaveBeenCalledOnce();
        expect(capture.readCapturedExternalSpectrum()).toBeNull();
    });

    it('owes the main process nothing when the route leaves while the sound is handed over', async () => {
        const harness = install({ defer: true });
        const capture = await importCapture();

        const attempt = capture.startExternalSpectrumCapture();
        await vi.waitFor(() => expect(harness.getDisplayMedia).toHaveBeenCalledOnce());
        // The route leaves the external player while getDisplayMedia is still pending.
        capture.stopExternalSpectrumCapture();
        harness.resolveGrant();
        await attempt;

        // The disarm is not sent for an attempt the route already released.
        expect(harness.arm.mock.calls).toEqual([[true]]);
        for (const track of harness.granted.tracks) expect(track.stop).toHaveBeenCalledOnce();
        expect(capture.readCapturedExternalSpectrum()).toBeNull();
    });

    it('does nothing in a build without the main process to arm', async () => {
        const harness = install();
        (window as unknown as { electron: unknown }).electron = { platform: 'linux' };
        const capture = await importCapture();

        await capture.startExternalSpectrumCapture();

        expect(harness.getDisplayMedia).not.toHaveBeenCalled();
        expect(capture.readCapturedExternalSpectrum()).toBeNull();
    });
});
