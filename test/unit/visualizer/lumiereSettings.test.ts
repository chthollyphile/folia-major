import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LUMIERE_TUNING, type LumiereTuning } from '@/types';
import { DEFAULT_LYRIC_RENDER_OVERRIDE } from '@/utils/lyricRenderQuality';
import { normalizeLumiereTuning } from '@/utils/lumiereTuning';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { buildVisualSettingsConfig } from '@/services/obs/visualSettingsConfig';
import { buildSyncedVisualSettings, readSyncableSettingsState } from '@/services/sync/settingsSnapshot';

// test/unit/visualizer/lumiereSettings.test.ts
// Verifies 绘光 tuning normalization, its appearance short-code round trip and the store setter/reset.
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

// render 留默认：旧的 lmt 短码不带它（见下面「分辨率与抗锯齿」一组），这样短码的测试都能整份比较。
const NON_DEFAULT_TUNING: LumiereTuning = {
    render: { ...DEFAULT_LYRIC_RENDER_OVERRIDE },
    lightIntensity: 1.6,
    audioResponse: 0,
    fogDensity: 0.4,
    darkField: 0.25,
    moteAmount: 1.8,
    bloom: 0.3,
    textBloom: 1.5,
    unlitOpacity: 0.4,
    windowNeighbors: 1,
    decay: 0.2,
    echo: 0,
    fogOctaves: 3,
    lineArt: false,
    frontBokeh: false,
    trails: false,
    hideTrails: true,
    seamlessTransitions: false,
    overlayFrame: false,
    textOnly: true,
    keywordColors: false,
    themeIcons: false,
    themeColorMix: 0.35,
    renderQuality: 'balanced',
};

describe('normalizeLumiereTuning', () => {
    it('returns defaults for non-object input', () => {
        expect(normalizeLumiereTuning(undefined)).toEqual(DEFAULT_LUMIERE_TUNING);
        expect(normalizeLumiereTuning('nope')).toEqual(DEFAULT_LUMIERE_TUNING);
        expect(normalizeLumiereTuning(null)).toEqual(DEFAULT_LUMIERE_TUNING);
    });

    it('keeps a valid tuning unchanged', () => {
        expect(normalizeLumiereTuning(NON_DEFAULT_TUNING)).toEqual(NON_DEFAULT_TUNING);
    });

    it('clamps ranges, rounds octaves and rejects bad enums', () => {
        const normalized = normalizeLumiereTuning({
            lightIntensity: 0,
            audioResponse: 9,
            unlitOpacity: 0.9,
            fogOctaves: 4.6,
            windowNeighbors: 3,
            renderQuality: 'ultra',
            lineArt: 'yes',
            decay: Number.NaN,
            darkField: 1.4,
        });
        expect(normalized.lightIntensity).toBe(0.3);
        expect(normalized.audioResponse).toBe(2);
        expect(normalized.unlitOpacity).toBe(0.6);
        expect(normalized.fogOctaves).toBe(5);
        expect(normalized.windowNeighbors).toBe(DEFAULT_LUMIERE_TUNING.windowNeighbors);
        expect(normalized.renderQuality).toBe(DEFAULT_LUMIERE_TUNING.renderQuality);
        expect(normalized.lineArt).toBe(DEFAULT_LUMIERE_TUNING.lineArt);
        expect(normalized.decay).toBe(DEFAULT_LUMIERE_TUNING.decay);
        expect(normalized.darkField).toBe(1);
        expect(normalizeLumiereTuning({ darkField: -0.5 }).darkField).toBe(0);
        expect(normalizeLumiereTuning({ fogOctaves: 12 }).fogOctaves).toBe(6);
        expect(normalizeLumiereTuning({ fogOctaves: 0 }).fogOctaves).toBe(2);
    });
});

describe('Lumiere render override (#929)', () => {
    const OVERRIDDEN: LumiereTuning = { ...NON_DEFAULT_TUNING, render: { scale: 1.5, antialias: 'on' } };

    it('reads an old saved tuning without render as following the global preset', () => {
        const { render: _omitted, ...legacy } = OVERRIDDEN;
        expect(normalizeLumiereTuning(legacy).render).toEqual({ scale: 'global', antialias: 'global' });
        expect(DEFAULT_LUMIERE_TUNING.render).toEqual({ scale: 'global', antialias: 'global' });
    });

    it('reads a valid render back as is and falls back per field on bad values', () => {
        expect(normalizeLumiereTuning(OVERRIDDEN)).toEqual(OVERRIDDEN);
        expect(normalizeLumiereTuning({ render: { scale: 0.5, antialias: 'off' } }).render).toEqual({ scale: 0.5, antialias: 'off' });
        expect(normalizeLumiereTuning({ render: { scale: 3, antialias: 'auto' } }).render).toEqual({ scale: 'global', antialias: 'global' });
        expect(normalizeLumiereTuning({ render: { scale: 2, antialias: 'msaa' } }).render).toEqual({ scale: 2, antialias: 'global' });
        expect(normalizeLumiereTuning({ render: 'high' }).render).toEqual({ scale: 'global', antialias: 'global' });
    });

    it('keeps the renderQuality preset alongside the render override', () => {
        const tuning = normalizeLumiereTuning({ renderQuality: 'low', render: { scale: 2, antialias: 'global' } });
        expect(tuning.renderQuality).toBe('low');
        expect(tuning.render).toEqual({ scale: 2, antialias: 'global' });
    });

    it('carries render through JSON configs and the visualizerTunings bundle, but not the legacy lmt short code', () => {
        expect(decompressConfig(JSON.stringify({ lumiereTuning: OVERRIDDEN })).lumiereTuning).toEqual(OVERRIDDEN);
        expect(decompressConfig(compressConfig({ visualizerTunings: { lumiere: OVERRIDDEN } })).visualizerTunings?.lumiere).toEqual(OVERRIDDEN);
        expect(decompressConfig(compressConfig({ lumiereTuning: OVERRIDDEN })).lumiereTuning?.render).toEqual(DEFAULT_LYRIC_RENDER_OVERRIDE);
    });
});

describe('Lumiere appearance codec', () => {
    it('round-trips every Lumiere tuning field through the short code', () => {
        const decoded = decompressConfig(compressConfig({ lumiereTuning: NON_DEFAULT_TUNING }));
        expect(decoded.lumiereTuning).toEqual(NON_DEFAULT_TUNING);
    });

    it('decodes an old short code without the darkField key to the default', () => {
        const encoded = compressConfig({ lumiereTuning: NON_DEFAULT_TUNING });
        // 短码是 base64 的 JSON：解开、去掉 df（旧版本没有这个短键）再编回去。
        const prefix = 'folia-theme://';
        const legacy = JSON.parse(atob(encoded.slice(prefix.length)));
        expect(legacy.lmt.df).toBe(0.25);
        delete legacy.lmt.df;
        const decoded = decompressConfig(`${prefix}${btoa(JSON.stringify(legacy))}`);
        expect(decoded.lumiereTuning).toEqual({ ...NON_DEFAULT_TUNING, darkField: DEFAULT_LUMIERE_TUNING.darkField });
    });

    it('decodes an old short code without the seamlessTransitions key to the default (on)', () => {
        const encoded = compressConfig({ lumiereTuning: NON_DEFAULT_TUNING });
        const prefix = 'folia-theme://';
        const legacy = JSON.parse(atob(encoded.slice(prefix.length)));
        expect(legacy.lmt.st).toBe(false);
        delete legacy.lmt.st;
        const decoded = decompressConfig(`${prefix}${btoa(JSON.stringify(legacy))}`);
        expect(DEFAULT_LUMIERE_TUNING.seamlessTransitions).toBe(true);
        expect(decoded.lumiereTuning).toEqual({ ...NON_DEFAULT_TUNING, seamlessTransitions: true });
    });

    it('decodes an old short code without the textOnly key to the default (off)', () => {
        const encoded = compressConfig({ lumiereTuning: NON_DEFAULT_TUNING });
        const prefix = 'folia-theme://';
        const legacy = JSON.parse(atob(encoded.slice(prefix.length)));
        expect(legacy.lmt.txo).toBe(true);
        delete legacy.lmt.txo;
        const decoded = decompressConfig(`${prefix}${btoa(JSON.stringify(legacy))}`);
        expect(DEFAULT_LUMIERE_TUNING.textOnly).toBe(false);
        expect(decoded.lumiereTuning).toEqual({ ...NON_DEFAULT_TUNING, textOnly: false });
    });

    it('preserves legacy trajectory visibility and validates the new hiding switch', () => {
        const { hideTrails: _omitted, ...oldTuning } = NON_DEFAULT_TUNING;
        expect(normalizeLumiereTuning(oldTuning).hideTrails).toBe(false);
        expect(normalizeLumiereTuning({ hideTrails: 'true' }).hideTrails).toBe(false);
        expect(normalizeLumiereTuning({ hideTrails: true }).hideTrails).toBe(true);
        const prefix = 'folia-theme://';
        const legacy = JSON.parse(atob(compressConfig({ lumiereTuning: NON_DEFAULT_TUNING }).slice(prefix.length)));
        expect(legacy.lmt.ht).toBe(true);
        delete legacy.lmt.ht;
        expect(decompressConfig(`${prefix}${btoa(JSON.stringify(legacy))}`).lumiereTuning)
            .toEqual({ ...NON_DEFAULT_TUNING, hideTrails: false });
    });

    it('clamps themeColorMix and fills it with the default for old tunings / short codes', () => {
        expect(normalizeLumiereTuning({ themeColorMix: 1.6 }).themeColorMix).toBe(1);
        expect(normalizeLumiereTuning({ themeColorMix: -1 }).themeColorMix).toBe(0);
        const { themeColorMix: _omitted, ...legacyTuning } = NON_DEFAULT_TUNING;
        expect(normalizeLumiereTuning(legacyTuning).themeColorMix).toBe(DEFAULT_LUMIERE_TUNING.themeColorMix);
        const encoded = compressConfig({ lumiereTuning: NON_DEFAULT_TUNING });
        const prefix = 'folia-theme://';
        const legacy = JSON.parse(atob(encoded.slice(prefix.length)));
        expect(legacy.lmt.tcm).toBe(0.35);
        delete legacy.lmt.tcm;
        const decoded = decompressConfig(`${prefix}${btoa(JSON.stringify(legacy))}`);
        expect(decoded.lumiereTuning).toEqual({ ...NON_DEFAULT_TUNING, themeColorMix: DEFAULT_LUMIERE_TUNING.themeColorMix });
    });

    it('fills seamlessTransitions with the default and rejects non-boolean values', () => {
        const { seamlessTransitions: _omitted, ...legacy } = NON_DEFAULT_TUNING;
        expect(normalizeLumiereTuning(legacy).seamlessTransitions).toBe(true);
        expect(normalizeLumiereTuning({ seamlessTransitions: 1 }).seamlessTransitions).toBe(true);
        expect(normalizeLumiereTuning({ seamlessTransitions: false }).seamlessTransitions).toBe(false);
    });

    it('fills darkField with the default for old saved / synced tunings', () => {
        const { darkField: _omitted, ...legacy } = NON_DEFAULT_TUNING;
        expect(normalizeLumiereTuning(legacy)).toEqual({ ...NON_DEFAULT_TUNING, darkField: DEFAULT_LUMIERE_TUNING.darkField });
    });

    it('accepts lumiereTuning as a valid JSON config key', () => {
        const decoded = decompressConfig(JSON.stringify({ lumiereTuning: NON_DEFAULT_TUNING }));
        expect(decoded.lumiereTuning).toEqual(NON_DEFAULT_TUNING);
    });
});

describe('Lumiere store tuning', () => {
    afterEach(() => {
        useVisualizerSettingsStore.setState({ lumiereTuning: { ...DEFAULT_LUMIERE_TUNING } });
        vi.unstubAllGlobals();
    });

    it('normalizes patches, persists them and resets to defaults', () => {
        const storage = createLocalStorageMock();
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        useVisualizerSettingsStore.setState({ lumiereTuning: { ...DEFAULT_LUMIERE_TUNING } });

        useVisualizerSettingsStore.getState().handleSetLumiereTuning({ renderQuality: 'low', unlitOpacity: 5, hideTrails: true });
        const next = useVisualizerSettingsStore.getState().lumiereTuning;
        expect(next.renderQuality).toBe('low');
        expect(next.unlitOpacity).toBe(0.6);
        expect(next.hideTrails).toBe(true);
        expect(JSON.parse(storage.getItem('lumiere_tuning') ?? '{}').renderQuality).toBe('low');
        expect(JSON.parse(storage.getItem('lumiere_tuning') ?? '{}').hideTrails).toBe(true);

        useVisualizerSettingsStore.getState().handleResetLumiereTuning();
        expect(useVisualizerSettingsStore.getState().lumiereTuning).toEqual(DEFAULT_LUMIERE_TUNING);
    });

    it('carries hidden trajectories through appearance / OBS and sync tuning bundles', () => {
        useVisualizerSettingsStore.setState({ lumiereTuning: NON_DEFAULT_TUNING });
        const appearance = buildVisualSettingsConfig();
        const synced = buildSyncedVisualSettings(readSyncableSettingsState());
        for (const config of [appearance, synced]) {
            expect(config.lumiereTuning).toEqual(NON_DEFAULT_TUNING);
            expect(config.visualizerTunings).toMatchObject({ lumiere: NON_DEFAULT_TUNING });
        }
        const decoded = decompressConfig(compressConfig(appearance));
        expect(decoded.visualizerTunings?.lumiere).toEqual(NON_DEFAULT_TUNING);
        useVisualizerSettingsStore.getState().handleSetLumiereTuning({ hideTrails: false });
        useVisualizerSettingsStore.getState().handleSetLumiereTuning(decoded.visualizerTunings.lumiere);
        expect(useVisualizerSettingsStore.getState().lumiereTuning.hideTrails).toBe(true);
    });

    it('imports an old JSON tuning without darkField and keeps the current dark field', () => {
        const storage = createLocalStorageMock();
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        useVisualizerSettingsStore.setState({ lumiereTuning: { ...DEFAULT_LUMIERE_TUNING } });

        const { darkField: _omitted, ...legacy } = NON_DEFAULT_TUNING;
        const decoded = decompressConfig(JSON.stringify({ lumiereTuning: legacy }));
        useVisualizerSettingsStore.getState().handleSetLumiereTuning(decoded.lumiereTuning);
        expect(useVisualizerSettingsStore.getState().lumiereTuning)
            .toEqual({ ...NON_DEFAULT_TUNING, darkField: DEFAULT_LUMIERE_TUNING.darkField });
    });
});
