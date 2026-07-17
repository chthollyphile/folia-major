import { describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_VISUALIZER_BACKGROUND_MODE,
    VISUALIZER_BACKGROUND_REGISTRY,
    getVisualizerBackgroundModeLabel,
    getVisualizerBackgroundRegistryEntry,
    hasVisualizerBackgroundMode,
} from '@/components/visualizer/backgrounds/registry';

// test/unit/visualizer/backgroundRegistry.test.ts
// Locks the folder-discovered visualizer background registry contract.

describe('visualizer background registry', () => {
    it('auto-loads built-in backgrounds in stable order', () => {
        expect(VISUALIZER_BACKGROUND_REGISTRY.map(entry => entry.mode)).toEqual([
            'common',
            'monet',
            'nomand',
            'latent',
            'url',
            'sora',
        ]);
    });

    it('keeps background modes unique and renderable', () => {
        const modes = VISUALIZER_BACKGROUND_REGISTRY.map(entry => entry.mode);

        expect(new Set(modes).size).toBe(modes.length);
        expect(VISUALIZER_BACKGROUND_REGISTRY.every(entry => typeof entry.render === 'function')).toBe(true);
    });

    it('falls back to Latent for unknown lookups', () => {
        expect(DEFAULT_VISUALIZER_BACKGROUND_MODE).toBe('latent');
        expect(hasVisualizerBackgroundMode('nomand')).toBe(true);
        expect(hasVisualizerBackgroundMode('latent')).toBe(true);
        expect(hasVisualizerBackgroundMode('missing-mode')).toBe(false);
        expect(getVisualizerBackgroundRegistryEntry('missing-mode').mode).toBe('latent');
    });

    it('uses label fallback when translation is missing', () => {
        expect(getVisualizerBackgroundModeLabel('nomand', key => key)).toBe('Nomand');
        expect(getVisualizerBackgroundModeLabel('latent', key => key)).toBe('Latent');
    });

    it('resets only the active background settings without changing its mode', () => {
        const onModeChange = vi.fn();
        const onResetTuning = vi.fn();

        getVisualizerBackgroundRegistryEntry('nomand').resetSettings?.({
            onModeChange,
            nomand: { onResetTuning },
        });

        expect(onResetTuning).toHaveBeenCalledOnce();
        expect(onModeChange).not.toHaveBeenCalled();
    });
});
