import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DIORAMA_TUNING, DEFAULT_SONNET_TUNING, type VisualizerMode } from '../../../src/types';
import type { VisualizerSharedProps } from '../../../src/components/visualizer/definition';
import dioramaTuning from '../../../src/components/visualizer/diorama/tuning';
import {
    applyVisualizerTuning,
    applyVisualizerTuningsToSettings,
    collectVisualizerTunings,
    getVisualizerTuningModes,
} from '../../../src/components/visualizer/tuningRegistry';
import { useVisualizerTunings } from '../../../src/components/visualizer/useVisualizerTunings';
import { useVisualizerSettingsStore } from '../../../src/stores/useVisualizerSettingsStore';

// Verifies that mode-local tuning adapters are auto-discovered for transport and settings bridges.
describe('visualizer tuning registry', () => {
    // The folders are the list: a style with a tuning.ts is found under its folder's name.
    it('auto-discovers every mode with dedicated tuning', () => {
        const visualizerDir = path.resolve(__dirname, '../../../src/components/visualizer');
        const foldersWithTuning = readdirSync(visualizerDir)
            .filter(name => existsSync(path.join(visualizerDir, name, 'tuning.ts')));

        expect(foldersWithTuning.length).toBeGreaterThan(0);
        expect(getVisualizerTuningModes().sort()).toEqual(foldersWithTuning.sort());
    });

    it('reads a style its own tuning: the stored object itself, or its defaults when there is none', () => {
        const stored = { ...DEFAULT_DIORAMA_TUNING };

        expect(dioramaTuning.read({ diorama: stored })).toBe(stored);
        expect(dioramaTuning.read({})).toBe(DEFAULT_DIORAMA_TUNING);
        expect(dioramaTuning.read()).toBe(DEFAULT_DIORAMA_TUNING);
    });

    // The mod export window hands the bundle over only as the third argument; a style without `apply`
    // reads it from the props.
    it('puts the bundle on the props for a style with apply and for one without', () => {
        const stored = { ...DEFAULT_DIORAMA_TUNING };
        const bundle = { diorama: stored };
        const bare = {} as VisualizerSharedProps;

        const withApply = applyVisualizerTuning('diorama', bare, bundle);
        const withoutApply = applyVisualizerTuning('no-such-style' as VisualizerMode, bare, bundle);

        expect(withApply.visualizerTunings).toBe(bundle);
        expect(withoutApply.visualizerTunings).toBe(bundle);
        expect(dioramaTuning.read(withoutApply.visualizerTunings)).toBe(stored);
        expect(applyVisualizerTuning('diorama', bare)).toBe(bare);
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

    // The renderer, the OBS source and the mod export all take the bundle from this hook.
    it('hands the hook every style that has a tuning file, as the store holds it', () => {
        let tunings: Partial<ReturnType<typeof useVisualizerTunings>> = {};
        renderToString(createElement(() => {
            tunings = useVisualizerTunings();
            return null;
        }));

        const state = useVisualizerSettingsStore.getState();

        expect(Object.keys(tunings).sort()).toEqual(getVisualizerTuningModes().sort());
        expect(tunings.diorama).toBe(state.dioramaTuning);
        expect(tunings.sonnet).toBe(state.sonnetTuning);
    });
});
