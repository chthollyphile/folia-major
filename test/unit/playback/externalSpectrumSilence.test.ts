// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/playback/externalSpectrumSilence.test.ts
// What the machine's own sound does while it carries nothing. A player that is sounding a song can go
// quiet for a moment - a drop being loaded, a buffer running dry - and the bars the visualizer draws
// from that sound must fall away as they do on the app's own deck, not stand where they were. A player
// that is really stopped is the one case where standing still is right: a paused song's bars stay put.
//
// The module holds one capture for the app, so every test imports a fresh copy and arms it the way the
// capture test beside this one does.

const BIN_COUNT = 1024;
const BANDS_KEYS = ['power', 'bass', 'lowMid', 'mid', 'vocal', 'treble'] as const;

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

/** Arms a capture of the machine's sound and answers the analyser it reads. */
const install = () => {
    const data = new Uint8Array(BIN_COUNT);
    const analyser = makeAnalyser(data);
    const AudioContextStub = class {
        destination = { name: 'destination' };
        state = 'running';
        createAnalyser() { return analyser; }
        createMediaStreamSource() { return { connect: vi.fn() }; }
        createGain() { return { gain: { value: 1 }, connect: vi.fn() }; }
        close() { return Promise.resolve(); }
        resume() { return Promise.resolve(); }
    };
    (window as unknown as { AudioContext: unknown }).AudioContext = AudioContextStub;
    const track = { kind: 'audio', stop: vi.fn(), addEventListener: vi.fn() };
    const stream = {
        getTracks: () => [{ kind: 'video', stop: vi.fn(), addEventListener: vi.fn() }, track],
        getAudioTracks: () => [track],
    };
    Object.defineProperty(navigator, 'mediaDevices', {
        value: { getDisplayMedia: vi.fn(async () => stream) },
        configurable: true,
    });
    (window as unknown as { electron: unknown }).electron = {
        platform: 'win32',
        armExternalSpectrumCapture: vi.fn(async () => true),
        noteExternalSpectrumCaptureStopped: vi.fn(async () => true),
    };
    return { data, analyser };
};

const importCapture = async () => {
    vi.resetModules();
    return import('../../../src/components/app/playback/externalSpectrumCapture');
};

/** Fills the analyser's answer with sound, then with nothing. */
const sound = (data: Uint8Array) => { for (let index = 0; index < data.length; index += 1) data[index] = 200; };
const silence = (data: Uint8Array) => { data.fill(0); };

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
    delete (window as unknown as { electron?: unknown }).electron;
    Reflect.deleteProperty(navigator, 'mediaDevices');
    delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

describe('the machine sound while it carries nothing', () => {
    it('falls away frame by frame while the song is sounding', async () => {
        const harness = install();
        sound(harness.data);
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();

        const loud = capture.readCapturedExternalSpectrum(true);
        expect(loud).not.toBeNull();
        const before = loud!.power;
        expect(before).toBeGreaterThan(0);

        silence(harness.data);
        const levels: number[] = [];
        for (let frame = 0; frame < 30; frame += 1) {
            const bands = capture.readCapturedExternalSpectrum(true);
            expect(bands, 'a sounding song still answers').not.toBeNull();
            levels.push(bands!.power);
        }
        console.log('[silence playing] first=' + levels[0].toFixed(1) + ' last=' + levels[29].toFixed(1));
        // The bars fall away instead of standing still: every frame is at or below the one before it,
        // and the first of them is already lower. The last few hold at the floor a rounded level
        // reaches, which is where a real analyser's own answer bottoms out too.
        for (let index = 1; index < levels.length; index += 1) {
            expect(levels[index], 'frame ' + index).toBeLessThanOrEqual(levels[index - 1]);
        }
        expect(levels[0], 'fallen on the very first silent frame').toBeLessThan(before);
        expect(levels[levels.length - 1], 'fallen a long way in half a second').toBeLessThan(before / 2);

        capture.stopExternalSpectrumCapture();
    });

    it('stands where it was while the song is stopped', async () => {
        const harness = install();
        sound(harness.data);
        const capture = await importCapture();
        await capture.startExternalSpectrumCapture();

        const loud = capture.readCapturedExternalSpectrum(false);
        expect(loud).not.toBeNull();
        const held = { ...loud! };

        silence(harness.data);
        for (let frame = 0; frame < 30; frame += 1) {
            const bands = capture.readCapturedExternalSpectrum(false);
            expect(bands).not.toBeNull();
            for (const key of BANDS_KEYS) expect(bands![key], key + ' frame ' + frame).toBe(held[key]);
        }

        capture.stopExternalSpectrumCapture();
    });
});
