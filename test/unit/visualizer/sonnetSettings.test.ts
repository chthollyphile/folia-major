import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SONNET_TUNING } from '@/types';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import sonnetTuningDefinition from '@/components/visualizer/sonnet/tuning';
import { SonnetPixiRuntime } from '@/components/visualizer/sonnet/createSonnetPixiRuntime';

// test/unit/visualizer/sonnetSettings.test.ts
// Verifies Sonnet visibility tuning at the store boundary.
const createLocalStorageMock = (): Storage => {
    const values = new Map<string, string>();

    return {
        get length() {
            return values.size;
        },
        getItem: key => values.get(key) ?? null,
        key: index => Array.from(values.keys())[index] ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
        clear: () => values.clear(),
    };
};

describe('Sonnet settings', () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createLocalStorageMock();
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        useVisualizerSettingsStore.setState({
            visualizerMode: 'classic',
            sonnetTuning: { ...DEFAULT_SONNET_TUNING },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('updates and persists visibility tuning', () => {
        expect(DEFAULT_SONNET_TUNING.textureResolution).toBe(1.5);
        useVisualizerSettingsStore.getState().handleSetSonnetTuning({
            showOnlyText: true,
            showGuide: false,
            showBackgroundMg: false,
            enableTransitions: true,
            outerFrameMode: 'frame',
            textureResolution: 1.75,
            postProcessLensDistortion: 1.8,
            postProcessLensDispersion: 0.7,
        });

        expect(useVisualizerSettingsStore.getState().sonnetTuning).toMatchObject({
            showOnlyText: true,
            showGuide: false,
            showBackgroundMg: false,
            showFixedGeo: true,
            enableTransitions: true,
            outerFrameMode: 'frame',
            textureResolution: 1.75,
            postProcessLensDistortion: 1.8,
            postProcessLensDispersion: 0.7,
        });
        expect(JSON.parse(storage.getItem('sonnet_tuning') ?? '{}')).toMatchObject({
            showOnlyText: true,
            showGuide: false,
            showBackgroundMg: false,
            enableTransitions: true,
            outerFrameMode: 'frame',
            textureResolution: 1.75,
            postProcessLensDistortion: 1.8,
            postProcessLensDispersion: 0.7,
        });
    });

    it('enters Sonnet directly without an interstitial confirmation', () => {
        useVisualizerSettingsStore.getState().handleSetVisualizerMode('sonnet');

        expect(useVisualizerSettingsStore.getState().visualizerMode).toBe('sonnet');
        expect(storage.getItem('visualizer_mode')).toBe('sonnet');
    });

    it('allows the stronger lens distortion range without accepting out-of-range values', () => {
        useVisualizerSettingsStore.getState().handleSetSonnetTuning({ postProcessLensDistortion: 3 });

        expect(useVisualizerSettingsStore.getState().sonnetTuning.postProcessLensDistortion).toBe(2);
    });
});

describe('Sonnet render override (#929)', () => {
    const read = (stored: object) => sonnetTuningDefinition.storage!.read(stored as never);

    it('reads a save from before the setting as following the global level', () => {
        expect(read({ textureResolution: 2 }).render).toEqual({ scale: 'global', antialias: 'global' });
    });

    it('reads a stored override back and drops values it does not know', () => {
        expect(read({ render: { scale: 1.5, antialias: 'off' } }).render).toEqual({ scale: 1.5, antialias: 'off' });
        expect(read({ render: { scale: 3, antialias: 'auto' } }).render).toEqual({ scale: 'global', antialias: 'global' });
        expect(read({ render: 'sharp' }).render).toEqual({ scale: 'global', antialias: 'global' });
    });

    it('keeps the override when another field changes', () => {
        const held = read({ render: { scale: 0.5, antialias: 'on' } });
        expect(sonnetTuningDefinition.storage!.merge(held, { showGuide: false }).render).toEqual({ scale: 0.5, antialias: 'on' });
        expect(sonnetTuningDefinition.storage!.merge(held, { render: { scale: 2 } as never }).render).toEqual({ scale: 2, antialias: 'on' });
    });
});

describe('Sonnet live render scale (#929)', () => {
    /** A mounted runtime reduced to what setRenderScale and setTuning touch. */
    const mountRuntime = (width: number, height: number) => {
        const resize = vi.fn();
        const rebuilds = vi.fn();
        const renderer = { resolution: 1.5, resize };
        const runtime = Object.create(SonnetPixiRuntime.prototype) as SonnetPixiRuntime;
        Object.assign(runtime, {
            destroyed: false,
            options: { tuning: { ...DEFAULT_SONNET_TUNING }, renderScale: 1, paused: false },
            app: { renderer },
            lastWidth: width,
            lastHeight: height,
            rebuildScenes: rebuilds,
        });
        return { runtime, resize, rebuilds };
    };

    it('multiplies textureResolution in place instead of making a new context', () => {
        // 800x800 at 1.5 x 1.5 = 2.25 sits far from the next pool boundary down, so the snap keeps it.
        const { runtime, resize, rebuilds } = mountRuntime(800, 800);
        runtime.setRenderScale(1.5);
        expect(resize).toHaveBeenCalledWith(800, 800, 2.25);
        expect(rebuilds).toHaveBeenCalledTimes(1);
    });

    it('does not rebuild the scenes for a tuning that only moved its render override', () => {
        const { runtime, rebuilds } = mountRuntime(800, 800);
        runtime.setTuning({ ...DEFAULT_SONNET_TUNING, render: { scale: 2, antialias: 'off' } });
        expect(rebuilds).not.toHaveBeenCalled();
        runtime.setTuning({ ...DEFAULT_SONNET_TUNING, showGuide: false });
        expect(rebuilds).toHaveBeenCalledTimes(1);
    });
});
