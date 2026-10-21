import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MONET_TUNING } from '@/types';
import { resolveStoredMonetTuning } from '@/components/visualizer/monet/tuning';
import { applyVisualizerTuningsToSettings } from '@/components/visualizer/tuningRegistry';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { buildVisualSettingsConfig } from '@/services/obs/visualSettingsConfig';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';
import { buildObsAppearanceFromShortcode } from '@/utils/obsWebAppearance';

// Monet audio placement and gain survive storage and the same appearance bundle used by export and OBS.

const createStorage = (): Storage => {
    const values = new Map<string, string>();
    return {
        get length() { return values.size; },
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => { values.set(key, String(value)); },
        removeItem: key => { values.delete(key); },
        key: index => [...values.keys()][index] ?? null,
        clear: () => values.clear(),
    };
};

beforeEach(() => {
    const storage = createStorage();
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
    useVisualizerSettingsStore.setState({ monetTuning: { ...DEFAULT_MONET_TUNING } });
});

afterEach(() => {
    useVisualizerSettingsStore.setState({ monetTuning: { ...DEFAULT_MONET_TUNING } });
    vi.unstubAllGlobals();
});

describe('Monet audio settings', () => {
    it('keeps the bottom rail at normal gain for an older saved tuning', () => {
        expect(resolveStoredMonetTuning({ audioStyle: 'line', fontScale: 1.2 })).toMatchObject({
            audioStyle: 'line', fontScale: 1.2, audioPlacement: 'bottom', audioGain: 1,
        });
        expect(resolveStoredMonetTuning({})).toEqual(DEFAULT_MONET_TUNING);
    });

    it.each([
        [{ audioPlacement: 'lyrics', audioGain: 1.4 }, 'lyrics', 1.4],
        [{ audioPlacement: 'bottom', audioGain: 0 }, 'bottom', 0.5],
        [{ audioPlacement: 'unknown', audioGain: 9 }, 'bottom', 2],
        [{ audioPlacement: null, audioGain: Number.NaN }, 'bottom', 1],
        [{ audioGain: Number.POSITIVE_INFINITY }, 'bottom', 1],
        [{ audioGain: '1.5' }, 'bottom', 1],
    ])('normalizes stored audio options %j', (stored, placement, gain) => {
        const tuning = resolveStoredMonetTuning(stored as never);
        expect(tuning.audioPlacement).toBe(placement);
        expect(tuning.audioGain).toBe(gain);
    });

    it('persists both options through the real setter and preserves them in unrelated patches', () => {
        const store = useVisualizerSettingsStore.getState();
        store.handleSetMonetTuning({ audioPlacement: 'lyrics', audioGain: 1.5 });
        store.handleSetMonetTuning({ fontScale: 1.2 });

        const held = useVisualizerSettingsStore.getState().monetTuning;
        const saved = JSON.parse(localStorage.getItem('monet_tuning')!);
        expect(held).toMatchObject({ audioPlacement: 'lyrics', audioGain: 1.5, fontScale: 1.2 });
        expect(saved).toEqual(held);
        expect(resolveStoredMonetTuning(saved)).toEqual(held);

        store.handleSetMonetTuning({ audioGain: 99 });
        expect(JSON.parse(localStorage.getItem('monet_tuning')!).audioGain).toBe(2);
        store.handleResetMonetTuning();
        expect(useVisualizerSettingsStore.getState().monetTuning).toEqual(DEFAULT_MONET_TUNING);
        expect(JSON.parse(localStorage.getItem('monet_tuning')!)).toEqual(DEFAULT_MONET_TUNING);
    });

    it('restores the audio settings from an exported bundle without the legacy Monet field', () => {
        useVisualizerSettingsStore.getState().handleSetMonetTuning({
            audioPlacement: 'lyrics', audioGain: 1.75, audioStyle: 'line',
        });
        const exported = buildVisualSettingsConfig();
        delete exported.monetTuning;
        const shortcode = compressConfig(exported);
        const incoming = decompressConfig(shortcode);
        useVisualizerSettingsStore.setState({ monetTuning: { ...DEFAULT_MONET_TUNING } });

        applyVisualizerTuningsToSettings(
            useVisualizerSettingsStore.getState() as unknown as Record<string, unknown>,
            incoming.visualizerTunings,
        );
        const expected = { audioPlacement: 'lyrics', audioGain: 1.75, audioStyle: 'line' };
        expect(useVisualizerSettingsStore.getState().monetTuning).toMatchObject(expected);
        expect(JSON.parse(localStorage.getItem('monet_tuning')!)).toMatchObject(expected);
        expect(buildObsAppearanceFromShortcode(shortcode, {
            isDaylight: false, transparent: false,
        }).visualizerTunings?.monet).toMatchObject(expected);
    });
});
