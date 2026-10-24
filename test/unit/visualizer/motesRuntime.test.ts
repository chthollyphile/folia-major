// @vitest-environment jsdom
import { act, createElement, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMotesRuntime, type MotesRuntimeSnapshot } from '@/components/visualizer/motes/motesRuntime';
import VisualizerMotes from '@/components/visualizer/motes/VisualizerMotes';
import { DEFAULT_MOTES_TUNING } from '@/components/visualizer/motes/types';
import type { AudioBands, Line, Theme } from '@/types';

// The real runtime and React owner retain control of subscriptions and scheduling; raster IO is counted separately.
const io = vi.hoisted(() => ({
    prepare: vi.fn((line: unknown, options: unknown) => ({ line, options })),
    clearMeasurements: vi.fn(), draw: vi.fn(), createSpace: vi.fn((seed: unknown) => ({ seed })), drawSpace: vi.fn(),
}));
vi.mock('@/components/visualizer/motes/motesLayout', () => ({ prepareMotesLine: io.prepare, clearMotesMeasurementCache: io.clearMeasurements }));
vi.mock('@/components/visualizer/motes/motesCanvas', () => ({ drawMotesLine: io.draw }));
vi.mock('@/components/visualizer/motes/motesSpace', () => ({ createMotesSpace: io.createSpace, drawMotesSpace: io.drawSpace }));
vi.mock('@/components/visualizer/VisualizerShell', () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/visualizer/VisualizerSubtitleOverlay', () => ({ default: () => null }));

let state: MotesRuntimeSnapshot;
let canvas: HTMLCanvasElement;
let runtime: ReturnType<typeof createMotesRuntime>;
let root: Root | null;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let observers: { resize: () => void; disconnect: ReturnType<typeof vi.fn> }[];
let bounds: { width: number; height: number };
let fonts: EventTarget;
let finishFonts: () => void;
let readBounds: ReturnType<typeof vi.spyOn>;
const context = { clearRect: vi.fn(), setTransform: vi.fn(), save: vi.fn(), translate: vi.fn(), restore: vi.fn() };
const line = (start: number): Line => ({ fullText: `Line ${start}`, startTime: start, endTime: start + 2, words: [] });
const tick = () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(100));
};

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    frames = new Map(); let handle = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++handle, callback); return handle; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    bounds = { width: 640, height: 320 };
    readBounds = vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => bounds as DOMRect);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => context) as never);
    vi.stubGlobal('devicePixelRatio', 3);
    observers = [];
    vi.stubGlobal('ResizeObserver', class {
        disconnect = vi.fn();
        constructor(resize: () => void) { observers.push({ resize, disconnect: this.disconnect }); }
        observe() {}
    });
    fonts = new EventTarget();
    Object.assign(fonts, { ready: new Promise<void>(resolve => { finishFonts = resolve; }) });
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    const bass = motionValue(128);
    state = {
        lines: [line(0), line(5)], currentLineIndex: 0, currentTime: motionValue(1), audioPower: bass,
        audioBands: { bass, lowMid: bass, mid: bass, vocal: bass, treble: bass } as AudioBands,
        theme: { primaryColor: '#ffffff', accentColor: '#ff0000', fontStyle: 'sans' } as Theme,
        tuning: { ...DEFAULT_MOTES_TUNING }, fontFamily: 'sans-serif', fontWeight: 600,
        reducedMotion: false, recentCompletedLine: null, upcomingLine: null,
    };
    canvas = document.createElement('canvas');
    runtime = null; root = null;
    host = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
    runtime?.dispose();
    if (root) act(() => root!.unmount());
    host.remove();
    Reflect.deleteProperty(document, 'fonts');
    vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('Motes runtime ownership', () => {
    it('reuses its raster between frames and invalidates it for size, font readiness and font weight', () => {
        runtime = createMotesRuntime(canvas, () => state);
        expect(io.prepare).toHaveBeenCalledTimes(1);
        tick(); tick(); tick();
        expect(io.prepare).toHaveBeenCalledTimes(1);
        expect(readBounds).toHaveBeenCalledTimes(1);
        expect(canvas.width).toBe(1280);
        expect(io.drawSpace.mock.calls[0][2]).toMatchObject({ width: 640, height: 320 });
        expect(io.prepare.mock.calls[0][1]).toMatchObject({ width: 588.8, height: 204.8 });
        expect(context.translate).toHaveBeenCalledWith(25.6, 38.4);
        bounds = { width: 320, height: 160 };
        observers[0].resize(); observers[0].resize();
        expect(io.prepare).toHaveBeenCalledTimes(2);
        expect(canvas.width).toBe(640);
        fonts.dispatchEvent(new Event('loadingdone'));
        expect(io.clearMeasurements).toHaveBeenCalledTimes(1);
        expect(io.prepare).toHaveBeenCalledTimes(3);
        state = { ...state, fontWeight: 700 };
        runtime!.update();
        expect(io.prepare).toHaveBeenCalledTimes(4);
    });

    it('stops on pause, retains audio intensity, and avoids stale lyrics when the clock seeks ahead of the index', () => {
        runtime = createMotesRuntime(canvas, () => state);
        const level = io.draw.mock.calls.at(-1)![2].audioLevel;
        state = { ...state, paused: true };
        state.audioPower.set(0);
        runtime!.update();
        expect(frames.size).toBe(0);
        expect(io.draw.mock.calls.at(-1)![2].audioLevel).toBe(level);
        io.draw.mockClear();
        io.drawSpace.mockClear();
        state.currentTime.set(5.5);
        expect(io.draw).not.toHaveBeenCalled();
        expect(io.drawSpace).toHaveBeenCalledTimes(1);
        expect(io.drawSpace.mock.calls[0][2].time).toBe(5.5);
        state = { ...state, currentLineIndex: 1 };
        runtime!.update();
        expect(io.draw.mock.calls.at(-1)![1].line).toBe(state.lines[1]);
        expect(frames.size).toBe(0);
    });

    it('reads a replacement clock immediately before the React effect recreates the runtime', () => {
        runtime = createMotesRuntime(canvas, () => state);
        const oldClock = state.currentTime;
        state = { ...state, currentTime: motionValue(5.5), currentLineIndex: 1 };
        io.draw.mockClear();
        runtime!.update();
        expect(io.draw).toHaveBeenCalledTimes(1);
        expect(io.draw.mock.calls[0][1].line).toBe(state.lines[1]);
        expect(io.draw.mock.calls[0][2].time).toBe(5.5);
        expect(frames.size).toBe(1);
        runtime!.dispose();
        io.draw.mockClear();
        oldClock.set(1.5);
        state.currentTime.set(6);
        expect(io.draw).not.toHaveBeenCalled();
        expect(frames.size).toBe(0);
    });

    it.each([{ staticMode: true }, { isPreviewMode: true }, { reducedMotion: true }])('keeps %j free of continuous animation', patch => {
        state = { ...state, ...patch };
        runtime = createMotesRuntime(canvas, () => state);
        expect(io.draw).toHaveBeenCalledTimes(1);
        expect(io.drawSpace).toHaveBeenCalledTimes(1);
        expect(frames.size).toBe(0);
        state.currentTime.set(1.5);
        tick();
        expect(io.draw).toHaveBeenCalledTimes(1);
        expect(io.drawSpace).toHaveBeenCalledTimes(1);
    });

    it('stops in an instrumental gap and leaves an empty song with no loop', () => {
        runtime = createMotesRuntime(canvas, () => state);
        expect(frames.size).toBe(1);
        state.currentTime.set(3);
        state = { ...state, currentLineIndex: -1, recentCompletedLine: state.lines[0] };
        runtime!.update();
        expect(frames.size).toBe(0);
        io.draw.mockClear(); io.drawSpace.mockClear();
        state.currentTime.set(3.2); state.currentTime.set(3.4); state.currentTime.set(3.6);
        expect(io.draw).not.toHaveBeenCalled();
        expect(io.drawSpace).not.toHaveBeenCalled();
        expect(frames.size).toBe(0);
        state = { ...state, lines: [], recentCompletedLine: null };
        runtime!.update();
        expect(frames.size).toBe(0);
    });

    it('shares one loop for the depth field and lyrics, rebuilding the field only when its seed changes', () => {
        state = { ...state, seed: 'first' };
        runtime = createMotesRuntime(canvas, () => state);
        tick(); tick(); runtime!.update();
        expect(frames.size).toBe(1);
        expect(io.createSpace).toHaveBeenCalledTimes(1);
        expect(io.drawSpace.mock.calls.length).toBe(io.draw.mock.calls.length);
        state = { ...state, seed: 'second' };
        runtime!.update();
        expect(io.createSpace).toHaveBeenCalledTimes(2);
        expect(io.drawSpace.mock.calls.at(-1)![1]).toEqual({ seed: 'second' });
        expect(frames.size).toBe(1);
    });

    it('stops the shared loop while hidden or text is disabled and resumes with the current clock', () => {
        runtime = createMotesRuntime(canvas, () => state);
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(frames.size).toBe(0);
        io.draw.mockClear(); io.drawSpace.mockClear();
        state.currentTime.set(1.5); tick();
        expect(io.draw).not.toHaveBeenCalled();
        expect(io.drawSpace).not.toHaveBeenCalled();
        vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
        document.dispatchEvent(new Event('visibilitychange'));
        expect(io.drawSpace.mock.calls.at(-1)![2].time).toBe(1.5);
        expect(frames.size).toBe(1);
        state = { ...state, showText: false };
        runtime!.update();
        expect(frames.size).toBe(0);
        io.draw.mockClear(); io.drawSpace.mockClear(); context.clearRect.mockClear();
        state.currentTime.set(1.7); state.currentTime.set(1.8); tick();
        expect(io.draw).not.toHaveBeenCalled();
        expect(io.drawSpace).not.toHaveBeenCalled();
        expect(context.clearRect).not.toHaveBeenCalled();
        expect(frames.size).toBe(0);
    });

    it('does not revive an expired line when the next lyric begins after a long gap', () => {
        state = { ...state, currentLineIndex: 1, currentTime: motionValue(5.1) };
        runtime = createMotesRuntime(canvas, () => state);
        expect(io.draw).toHaveBeenCalledTimes(1);
        expect(io.draw.mock.calls[0][1].line).toBe(state.lines[1]);
    });

    it('keeps only three rasterized lines while seeking through a song', () => {
        state = { ...state, lines: [line(0), line(4), line(8), line(12)] };
        runtime = createMotesRuntime(canvas, () => state);
        const seek = (index: number) => {
            state = { ...state, currentLineIndex: index };
            state.currentTime.set(state.lines[index].startTime + 1);
            runtime!.update();
        };
        seek(1); seek(2); seek(3);
        expect(io.prepare).toHaveBeenCalledTimes(4);
        seek(1);
        expect(io.prepare).toHaveBeenCalledTimes(4);
        seek(0);
        expect(io.prepare).toHaveBeenCalledTimes(5);
    });

    it('releases both StrictMode mounts, including deferred font work and clock subscriptions', async () => {
        root = createRoot(host);
        act(() => root!.render(createElement(StrictMode, null, createElement(VisualizerMotes, state))));
        expect(frames.size).toBe(1);
        expect(observers).toHaveLength(2);
        const queued = [...frames.values()][0];
        act(() => root!.unmount()); root = null;
        expect(frames.size).toBe(0);
        observers.forEach(observer => expect(observer.disconnect).toHaveBeenCalledTimes(1));
        const draws = io.draw.mock.calls.length;
        const spaceDraws = io.drawSpace.mock.calls.length;
        await act(async () => { finishFonts(); await Promise.resolve(); });
        state.currentTime.set(1.5);
        queued(200);
        observers.forEach(observer => observer.resize());
        fonts.dispatchEvent(new Event('loadingdone'));
        document.dispatchEvent(new Event('visibilitychange'));
        expect(io.draw).toHaveBeenCalledTimes(draws);
        expect(io.drawSpace).toHaveBeenCalledTimes(spaceDraws);
        expect(frames.size).toBe(0);
    });
});
