import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIORAMA_TUNING, DEFAULT_SONNET_TUNING } from '../../../src/types';
import {
    applyVisualizerTuningsToSettings,
    collectVisualizerTunings,
    getVisualizerTuningModes,
} from '../../../src/components/visualizer/tuningRegistry';

// Verifies that mode-local tuning adapters are auto-discovered for transport and settings bridges.
describe('visualizer tuning registry', () => {
    it('auto-discovers every mode with dedicated tuning', () => {
        expect(getVisualizerTuningModes().sort()).toEqual([
            'cadenza',
            'cappella',
            'claddagh',
            'classic',
            'diorama',
            'fume',
            'monet',
            'partita',
            'pendolo',
            'sonnet',
            'tilt',
        ]);
    });

    it('collects and applies Diorama tuning through its discovered adapter', () => {
        const handleSetDioramaTuning = vi.fn();
        const settings = {
            dioramaTuning: DEFAULT_DIORAMA_TUNING,
            handleSetDioramaTuning,
        };

        expect(collectVisualizerTunings(settings).diorama).toEqual(DEFAULT_DIORAMA_TUNING);
        applyVisualizerTuningsToSettings(settings, { diorama: DEFAULT_DIORAMA_TUNING });
        expect(handleSetDioramaTuning).toHaveBeenCalledWith(DEFAULT_DIORAMA_TUNING);
    });

    it('collects and applies Sonnet tuning through its discovered adapter', () => {
        const handleSetSonnetTuning = vi.fn();
        const settings = {
            sonnetTuning: DEFAULT_SONNET_TUNING,
            handleSetSonnetTuning,
        };

        expect(collectVisualizerTunings(settings).sonnet).toEqual(DEFAULT_SONNET_TUNING);
        applyVisualizerTuningsToSettings(settings, { sonnet: DEFAULT_SONNET_TUNING });
        expect(handleSetSonnetTuning).toHaveBeenCalledWith(DEFAULT_SONNET_TUNING);
    });
});
