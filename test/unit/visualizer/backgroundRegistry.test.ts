import { describe, expect, it } from 'vitest';
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
            'url',
            'sora',
        ]);
    });

    it('keeps background modes unique and renderable', () => {
        const modes = VISUALIZER_BACKGROUND_REGISTRY.map(entry => entry.mode);

        expect(new Set(modes).size).toBe(modes.length);
        expect(VISUALIZER_BACKGROUND_REGISTRY.every(entry => typeof entry.render === 'function')).toBe(true);
    });

    it('falls back to common for unknown lookups', () => {
        expect(DEFAULT_VISUALIZER_BACKGROUND_MODE).toBe('common');
        expect(hasVisualizerBackgroundMode('nomand')).toBe(true);
        expect(hasVisualizerBackgroundMode('missing-mode')).toBe(false);
        expect(getVisualizerBackgroundRegistryEntry('missing-mode').mode).toBe('common');
    });

    it('uses label fallback when translation is missing', () => {
        expect(getVisualizerBackgroundModeLabel('nomand', key => key)).toBe('Nomand');
    });
});
