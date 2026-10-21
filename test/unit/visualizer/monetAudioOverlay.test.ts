// @vitest-environment jsdom
import { act, createElement, StrictMode, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioOverlay from '@/components/visualizer/monet/AudioOverlay';
import { createMonetAudioPainter } from '@/components/visualizer/monet/monetAudioCanvas';
import { MONET_AUDIO_BAR_COUNT, sampleMonetSpectrum } from '@/components/visualizer/monet/monetAudioSpectrum';
import type { AudioBands, Theme } from '@/types';

// Exercise the real canvas lifecycle with controlled frame and resize callbacks, without wall-clock waits.

const createContext = () => ({
    clearRect: vi.fn(), setTransform: vi.fn(), fillRect: vi.fn(),
    beginPath: vi.fn(), closePath: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
});
let context: ReturnType<typeof createContext>;
let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[];
let bounds: { width: number; height: number };
let audioBands: AudioBands;
let props: ComponentProps<typeof AudioOverlay>;

const render = (patch: Partial<typeof props> = {}, strict = false) => act(() => {
    props = { ...props, ...patch };
    const element = createElement(AudioOverlay, props);
    root.render(strict ? createElement(StrictMode, null, element) : element);
});
const tick = () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(100));
});
const bars = () => context.fillRect.mock.calls.slice(-MONET_AUDIO_BAR_COUNT) as number[][];

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    context = createContext();
    bounds = { width: 720, height: 160 };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => bounds as DOMRect);
    vi.spyOn(performance, 'now').mockReturnValue(100);
    vi.stubGlobal('devicePixelRatio', 3);
    frames = new Map();
    let handle = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
        frames.set(++handle, callback);
        return handle;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    observers = [];
    vi.stubGlobal('ResizeObserver', class {
        disconnect = vi.fn();
        constructor(callback: () => void) { observers.push({ callback, disconnect: this.disconnect }); }
        observe() {}
    });
    audioBands = {
        bass: motionValue(128), lowMid: motionValue(100), mid: motionValue(80),
        vocal: motionValue(60), treble: motionValue(40),
    };
    props = {
        audioPower: audioBands.bass, audioBands, mode: 'bar', centered: true,
        theme: { primaryColor: '#ffffff' } as Theme,
    };
    host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
});

afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Monet audio canvas scheduling', () => {
    it('freezes its last sampled frame on pause and resumes with the current audio', () => {
        const readBass = vi.spyOn(audioBands.bass, 'get');
        render();
        tick();
        const lastBars = bars();
        render({ paused: true });
        expect(frames.size).toBe(0);
        expect(bars()).toEqual(lastBars);
        const readsAtPause = readBass.mock.calls.length;

        audioBands.bass.set(0);
        audioBands.lowMid.set(0);
        audioBands.mid.set(0);
        audioBands.vocal.set(0);
        audioBands.treble.set(0);
        render({ gain: 1.5 });
        expect(readBass).toHaveBeenCalledTimes(readsAtPause);
        expect(bars()[35][3]).toBeGreaterThan(lastBars[35][3]);
        expect(frames.size).toBe(0);

        render({ paused: false, gain: 1 });
        expect(frames.size).toBe(1);
        expect(bars()[35][3]).toBeLessThan(lastBars[35][3]);
    });

    it.each([{ staticMode: true }, { isPreviewMode: true }, { paused: true }])(
        'draws %j once and only repaints when its measured size changes',
        patch => {
            render(patch);
            expect(context.clearRect).toHaveBeenCalledTimes(1);
            expect(frames.size).toBe(0);
            const canvas = host.querySelector('canvas')!;
            expect(canvas.width).toBe(1440);
            expect(canvas.height).toBe(320);
            act(() => observers.at(-1)!.callback());
            expect(context.clearRect).toHaveBeenCalledTimes(1);

            bounds = { width: 360, height: 100 };
            act(() => observers.at(-1)!.callback());
            expect(context.clearRect).toHaveBeenCalledTimes(2);
            expect(canvas.width).toBe(720);
            expect(canvas.height).toBe(200);
            tick();
            expect(frames.size).toBe(0);
        },
    );

    it('disconnects every observer and prevents queued callbacks from reviving an unmounted loop', () => {
        render({}, true);
        expect(frames.size).toBe(1);
        const queuedFrame = [...frames.values()][0];
        act(() => root.unmount());
        expect(frames.size).toBe(0);
        expect(observers).toHaveLength(2);
        observers.forEach(observer => expect(observer.disconnect).toHaveBeenCalledTimes(1));
        const draws = context.clearRect.mock.calls.length;
        bounds = { width: 500, height: 300 };
        queuedFrame(200);
        observers.forEach(observer => observer.callback());
        window.dispatchEvent(new Event('resize'));
        expect(context.clearRect).toHaveBeenCalledTimes(draws);
        expect(frames.size).toBe(0);
        root = createRoot(host);
    });
});

describe('Monet audio geometry and input', () => {
    it('uses raw FFT data when present and falls back to bands for absent or short data', () => {
        const bands = [0.2, 0.4, 0.6, 0.8, 1];
        const fallback = sampleMonetSpectrum(bands);
        expect(sampleMonetSpectrum(bands, new Uint8Array(6))).toEqual(fallback);
        expect(fallback.some(value => value > 0)).toBe(true);
        const raw = new Uint8Array(128);
        const target = new Float32Array(MONET_AUDIO_BAR_COUNT);
        expect(sampleMonetSpectrum(bands, raw, target)).toBe(target);
        expect([...target].every(value => value === 0)).toBe(true);
        raw.fill(255);
        sampleMonetSpectrum(bands, raw, target);
        expect([...target].every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
        expect([...raw].every(value => value === 255)).toBe(true);
    });

    it('keeps centered bars symmetric and in bounds while increasing gain', () => {
        const frame = { spectrum: new Float32Array(MONET_AUDIO_BAR_COUNT).fill(0.8), energy: 1, time: 100 };
        const draw = (gain: number) => {
            createMonetAudioPainter(context as unknown as CanvasRenderingContext2D, {
                color: '#ffffff', mode: 'bar', centered: true, gain, placeholder: false,
            })(720, 160, frame);
            return bars();
        };
        const quiet = draw(0.5);
        const loud = draw(2);
        loud.forEach(([x, y, width, height], index) => {
            expect([x, y, width, height].every(Number.isFinite)).toBe(true);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x + width).toBeLessThanOrEqual(720);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y + height).toBeLessThanOrEqual(160);
            expect(y + height / 2).toBeCloseTo(80);
            expect(height).toBeGreaterThanOrEqual(quiet[index][3]);
        });
        expect(loud[35][3]).toBeGreaterThan(quiet[35][3]);
    });

    it('keeps the mirrored curve and its control points inside the canvas at maximum gain', () => {
        createMonetAudioPainter(context as unknown as CanvasRenderingContext2D, {
            color: '#ffffff', mode: 'line', centered: true, gain: 2, placeholder: false,
        })(720, 160, { spectrum: new Float32Array(MONET_AUDIO_BAR_COUNT).fill(1), energy: 1, time: 100 });
        const curves = context.quadraticCurveTo.mock.calls as number[][];
        expect(curves.length).toBeGreaterThan(0);
        curves.forEach(([x, y, endX, endY]) => {
            expect([x, y, endX, endY].every(Number.isFinite)).toBe(true);
            expect(x).toBeGreaterThanOrEqual(0);
            expect(endX).toBeLessThanOrEqual(720);
            expect(y).toBeGreaterThanOrEqual(1);
            expect(y).toBeLessThanOrEqual(159);
            expect(endY).toBeGreaterThanOrEqual(1);
            expect(endY).toBeLessThanOrEqual(159);
        });
        const half = MONET_AUDIO_BAR_COUNT - 1;
        const upperStroke = curves.slice(-half * 2, -half);
        const lowerStroke = curves.slice(-half);
        upperStroke.forEach(([x, y, endX, endY], index) => {
            expect(lowerStroke[index][0]).toBe(x);
            expect(lowerStroke[index][1]).toBeCloseTo(160 - y);
            expect(lowerStroke[index][2]).toBe(endX);
            expect(lowerStroke[index][3]).toBeCloseTo(160 - endY);
        });
    });
});
