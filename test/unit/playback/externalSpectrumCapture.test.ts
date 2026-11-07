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

type Harness = {
    data: Uint8Array;
    analyser: ReturnType<typeof makeAnalyser>;
    context: { close: ReturnType<typeof vi.fn> };
    arm: ReturnType<typeof vi.fn>;
    getDisplayMedia: ReturnType<typeof vi.fn>;
    granted: ReturnType<typeof makeStream>;
};

const BIN_COUNT = 1024;

const install = (options: { audioTracks?: number; refuse?: unknown } = {}): Harness => {
    const data = new Uint8Array(BIN_COUNT);
    const analyser = makeAnalyser(data);
    const context = { close: vi.fn(() => Promise.resolve()) };
    const AudioContextStub = class {
        destination = { name: 'destination' };
        createAnalyser() {
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
    };
    (window as unknown as { AudioContext: unknown }).AudioContext = AudioContextStub;

    // The picture half of the request comes back too: kept, never read.
    const audioTracks = Array.from({ length: options.audioTracks ?? 1 }, () => 'audio');
    const granted = makeStream(['video', ...audioTracks]);
    const getDisplayMedia = vi.fn(async () => {
        if (options.refuse !== undefined) throw options.refuse;
        return granted.stream;
    });
    Object.defineProperty(navigator, 'mediaDevices', { value: { getDisplayMedia }, configurable: true });

    const arm = vi.fn(async () => true);
    (window as unknown as { electron: unknown }).electron = { platform: 'win32', armExternalSpectrumCapture: arm };

    return { data, analyser, context, arm, getDisplayMedia, granted };
};

const importCapture = async () => {
    vi.resetModules();
    return import('../../../src/components/app/playback/externalSpectrumCapture');
};

let warned: ReturnType<typeof vi.spyOn>;
let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logged = vi.spyOn(console, 'log').mockImplementation(() => {});
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

    it('returns null once the machine has been silent for about two seconds, and reads again after that', async () => {
        const harness = install();
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();
        vi.useFakeTimers();

        // The first frame of silence still draws the bands it has (all zero).
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

    it('does nothing in a build without the main process to arm', async () => {
        const harness = install();
        (window as unknown as { electron: unknown }).electron = { platform: 'linux' };
        const capture = await importCapture();

        await capture.startExternalSpectrumCapture();

        expect(harness.getDisplayMedia).not.toHaveBeenCalled();
        expect(capture.readCapturedExternalSpectrum()).toBeNull();
    });
});
