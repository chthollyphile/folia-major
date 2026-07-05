import { describe, expect, it } from 'vitest';
import {
    DEFAULT_VISUALIZER_MODE,
    VISUALIZER_REGISTRY,
    getVisualizerModeLabel,
    getVisualizerRegistryEntry,
    hasVisualizerMode,
} from '@/components/visualizer/registry';

// test/unit/visualizer/registry.test.ts
// Locks the discoverable visualizer registry contract.
describe('visualizer registry', () => {
    it('auto-loads the built-in visualizer entries in stable order', () => {
        expect(VISUALIZER_REGISTRY.map(entry => entry.mode)).toEqual([
            'classic',
            'cadenza',
            'partita',
            'fume',
            'tilt',
            'claddagh',
            'monet',
            'cappella',
        ]);
    });

    it('keeps visualizer modes unique', () => {
        const modes = VISUALIZER_REGISTRY.map(entry => entry.mode);

        expect(new Set(modes).size).toBe(modes.length);
    });

    it('recognizes registered modes and rejects unknown modes', () => {
        expect(hasVisualizerMode('classic')).toBe(true);
        expect(hasVisualizerMode('fume')).toBe(true);
        expect(hasVisualizerMode('missing-mode')).toBe(false);
        expect(DEFAULT_VISUALIZER_MODE).toBe('classic');
    });

    it('falls back to classic for an unknown lookup', () => {
        expect(getVisualizerRegistryEntry('missing-mode').mode).toBe('classic');
    });

    it('uses label fallback when the translation key is missing', () => {
        const label = getVisualizerModeLabel('partita', key => key);

        expect(label).toBe('云阶');
    });
});
