import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prewarmSavedVisualizer, prewarmVisualizersWhenIdle } from '@/components/visualizer/prewarmVisualizers';
import {
    DEFAULT_VISUALIZER_MODE,
    VISUALIZER_REGISTRY,
    appendVisualizerEntry,
    getVisualizerRegistryEntry,
    removeVisualizerEntry,
    type VisualizerRegistryEntry,
} from '@/components/visualizer/registry';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import type { VisualizerMode } from '@/types';

// test/unit/visualizer/prewarmVisualizers.test.ts
// Start-up prewarm in two tiers: the saved style's `prewarm` at once; the other styles that declare
// `prewarmWhenIdle` once the page is idle after the first screen. A mode in the store that is not
// registered (the registry falls back to the default style for it) does not set off the default's.

const ADDED = 'mod:test:prewarm' as VisualizerMode;
const OTHER = 'mod:test:prewarm-other' as VisualizerMode;
const savedMode = useVisualizerSettingsStore.getState().visualizerMode;

const added = (mode: VisualizerMode, prewarm?: () => void, prewarmWhenIdle = false): VisualizerRegistryEntry => ({
    mode,
    order: 900,
    labelKey: 'ui.visualizerAdded',
    labelFallback: 'Added',
    previewSeed: mode,
    previewStartOffset: 0,
    render: () => createElement('div'),
    ...(prewarm ? { prewarm } : {}),
    ...(prewarmWhenIdle ? { prewarmWhenIdle } : {}),
});

const save = (mode: VisualizerMode) => useVisualizerSettingsStore.setState({ visualizerMode: mode });

// The built-in styles that prewarm when idle (雾笺) stay out of these counts.
const silenceBuiltins = () => {
    for (const entry of VISUALIZER_REGISTRY) if (entry.prewarm && entry.mode !== ADDED && entry.mode !== OTHER) vi.spyOn(entry, 'prewarm').mockImplementation(() => undefined);
};

describe('prewarmSavedVisualizer', () => {
    afterEach(() => {
        removeVisualizerEntry(ADDED);
        removeVisualizerEntry(OTHER);
        save(savedMode);
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('runs the saved style\'s prewarm once', () => {
        const prewarm = vi.fn();
        appendVisualizerEntry(added(ADDED, prewarm));
        save(ADDED);

        prewarmSavedVisualizer();

        expect(prewarm).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a saved style without one', () => {
        appendVisualizerEntry(added(ADDED));
        save(ADDED);

        expect(() => prewarmSavedVisualizer()).not.toThrow();
    });

    it('does not prewarm the fallback style for a saved mode that is not registered', () => {
        const fallback = getVisualizerRegistryEntry(DEFAULT_VISUALIZER_MODE);
        const prewarm = vi.fn();
        fallback.prewarm = prewarm;
        try {
            save('mod:test:missing' as VisualizerMode);
            prewarmSavedVisualizer();
        } finally {
            delete fallback.prewarm;
        }

        expect(prewarm).not.toHaveBeenCalled();
    });

    it('keeps start-up going when a prewarm throws', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        appendVisualizerEntry(added(ADDED, () => { throw new Error('no GPU'); }));
        save(ADDED);

        expect(() => prewarmSavedVisualizer()).not.toThrow();
        expect(warn).toHaveBeenCalled();
    });

    it('prewarms the other styles that ask for it once the page is idle, not before', () => {
        vi.useFakeTimers();
        silenceBuiltins();
        const idle = vi.fn((callback: IdleRequestCallback) => { callback({ didTimeout: false, timeRemaining: () => 50 }); return 1; });
        vi.stubGlobal('requestIdleCallback', idle);
        const saved = vi.fn();
        const other = vi.fn();
        const notAsked = vi.fn();
        appendVisualizerEntry(added(ADDED, saved, true));
        appendVisualizerEntry(added(OTHER, other, true));
        appendVisualizerEntry(added('mod:test:prewarm-not-asked' as VisualizerMode, notAsked));
        save(ADDED);
        try {
            prewarmVisualizersWhenIdle();
            expect(other).not.toHaveBeenCalled();
            vi.runAllTimers();

            expect(idle).toHaveBeenCalledTimes(1);
            expect(other).toHaveBeenCalledTimes(1);
            // the saved style was prewarmed at start; one without the flag is left alone
            expect(saved).not.toHaveBeenCalled();
            expect(notAsked).not.toHaveBeenCalled();
        } finally {
            removeVisualizerEntry('mod:test:prewarm-not-asked' as VisualizerMode);
            vi.unstubAllGlobals();
        }
    });

    it('is declared by 雾笺 for both tiers: its cold shader compile is long', () => {
        const nebbia = getVisualizerRegistryEntry('nebbia');
        expect(nebbia.prewarm).toBeTypeOf('function');
        expect(nebbia.prewarmWhenIdle).toBe(true);
    });
});
