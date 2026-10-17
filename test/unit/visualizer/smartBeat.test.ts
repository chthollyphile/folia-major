import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SMART_BEAT_SETTINGS, DEFAULT_SONNET_TUNING, type SmartBeatSettings } from '@/types';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import { readStoredSmartBeatSettings, SMART_BEAT_STORAGE_KEY } from '@/stores/visualizerSettingsPersistence';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';
import { buildImportPlan } from '@/utils/appearanceImportPlan';
import { beatImpact, downbeatImpact } from '@/stores/motionSignals';
import {
    beginBeatFxTrack,
    getBeatFxFiredCounts,
    isBeatFxReady,
    setBeatFxEvents,
    setBeatFxIntensities,
    stopBeatFx,
    tickBeatFx,
} from '@/services/beatFx/beatFxLive';
import { visualizerWantsBeatClock, type BeatClockSettings } from '@/components/visualizer/beatClockTargets';
import {
    SONNET_BEAT_FX,
    applySonnetBeatFxLayers,
    createSonnetBeatFxReader,
    restoreSonnetBeatFxLayers,
} from '@/components/visualizer/sonnet/sonnetBeatFx';
import {
    createDioramaBeatCounter,
    resolveDioramaBeatClusterPulse,
    stepDioramaBeatCounter,
} from '@/components/visualizer/diorama/dioramaBeatRipples';
import { DIORAMA_PARTICLE_AUDIO_SCALE_MAX } from '@/components/visualizer/diorama/cameraPath';
import {
    resolveLatentBeatFxPulse,
    resolveLatentBeatSpeedTarget,
} from '@/components/visualizer/backgrounds/latent/LatentBackground';

// test/unit/visualizer/smartBeat.test.ts
// 智能动感模式 as one setting for the whole picture: the setting at the store, codec and import
// boundaries, which mode / background combinations start the beat clock, how the 轻拍 / 重拍 strengths
// reach the signals, and what Sonnet, Diorama and the Latent background each make of them.

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

const on: SmartBeatSettings = { ...DEFAULT_SMART_BEAT_SETTINGS, enabled: true };

describe('智能动感模式 setting', () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createLocalStorageMock();
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        useVisualizerSettingsStore.setState({ smartBeat: { ...DEFAULT_SMART_BEAT_SETTINGS } });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('is off by default at full strength', () => {
        expect(DEFAULT_SMART_BEAT_SETTINGS).toEqual({ enabled: false, beatIntensity: 1, downbeatIntensity: 1 });
    });

    it('is no longer part of the Sonnet tuning', () => {
        expect(Object.keys(DEFAULT_SONNET_TUNING)).not.toContain('smartBeatEnabled');
    });

    it('persists under its own key and clamps both strengths to 0..2', () => {
        useVisualizerSettingsStore.getState().handleSetSmartBeat({ enabled: true, beatIntensity: 5, downbeatIntensity: -1 });
        const expected = { enabled: true, beatIntensity: 2, downbeatIntensity: 0 };
        expect(useVisualizerSettingsStore.getState().smartBeat).toEqual(expected);
        expect(JSON.parse(storage.getItem(SMART_BEAT_STORAGE_KEY) ?? '{}')).toEqual(expected);
        expect(readStoredSmartBeatSettings()).toEqual(expected);
    });

    it('patches one field at a time', () => {
        useVisualizerSettingsStore.getState().handleSetSmartBeat({ enabled: true });
        useVisualizerSettingsStore.getState().handleSetSmartBeat({ downbeatIntensity: 1.5 });
        expect(useVisualizerSettingsStore.getState().smartBeat).toEqual({ enabled: true, beatIntensity: 1, downbeatIntensity: 1.5 });
    });

    it('reads a malformed stored value as the default', () => {
        storage.setItem(SMART_BEAT_STORAGE_KEY, '{not json');
        expect(readStoredSmartBeatSettings()).toEqual(DEFAULT_SMART_BEAT_SETTINGS);
    });

    it('round-trips through visual config export and import, minified and long-form', () => {
        const smartBeat = { enabled: true, beatIntensity: 1.4, downbeatIntensity: 0.3 };
        expect(decompressConfig(compressConfig({ smartBeat })).smartBeat).toEqual(smartBeat);
        expect(decompressConfig(JSON.stringify({ smartBeat })).smartBeat).toEqual(smartBeat);
    });

    it('leaves a config without it alone', () => {
        expect(decompressConfig(compressConfig({ visualizerMode: 'sonnet' })).smartBeat).toBeUndefined();
    });

    it('is offered by the import plan as a visualizer setting, outside the tuning bundle', () => {
        const plan = buildImportPlan({
            incoming: { smartBeat: on, visualizerTunings: {} },
            current: { smartBeat: DEFAULT_SMART_BEAT_SETTINGS },
            switches: { isCustomThemePreferred: false, songThemeAutoSwitchEnabled: false, songThemeAutoGenerateEnabled: false },
            isCustomThemeActive: true,
        });
        expect(plan.changes).toContainEqual(expect.objectContaining({ key: 'smartBeat', group: 'visualizer' }));
    });
});

describe('when the beat clock runs', () => {
    const settings = (patch: Partial<BeatClockSettings>): BeatClockSettings => ({
        smartBeat: on,
        visualizerMode: 'tempera',
        visualizerBackgroundMode: null,
        ...patch,
    });

    it('never while the switch is off', () => {
        expect(visualizerWantsBeatClock(settings({ smartBeat: DEFAULT_SMART_BEAT_SETTINGS, visualizerMode: 'sonnet' }))).toBe(false);
        expect(visualizerWantsBeatClock(settings({ smartBeat: DEFAULT_SMART_BEAT_SETTINGS, visualizerBackgroundMode: 'latent' }))).toBe(false);
    });

    it('for a mode that draws beat FX, whatever the background', () => {
        expect(visualizerWantsBeatClock(settings({ visualizerMode: 'sonnet', visualizerBackgroundMode: 'common' }))).toBe(true);
        expect(visualizerWantsBeatClock(settings({ visualizerMode: 'diorama', visualizerBackgroundMode: 'common' }))).toBe(true);
        expect(visualizerWantsBeatClock(settings({ visualizerMode: 'pendolo', visualizerBackgroundMode: 'common' }))).toBe(true);
    });

    it('for any other mode over the Latent background, which is also the default one', () => {
        expect(visualizerWantsBeatClock(settings({ visualizerBackgroundMode: 'latent' }))).toBe(true);
        expect(visualizerWantsBeatClock(settings({ visualizerBackgroundMode: null }))).toBe(true);
        expect(visualizerWantsBeatClock(settings({ visualizerBackgroundMode: 'common' }))).toBe(false);
    });

    it('not for Still, which shows no background', () => {
        expect(visualizerWantsBeatClock(settings({ visualizerMode: 'still', visualizerBackgroundMode: 'latent' }))).toBe(false);
    });
});

describe('beat clock readiness across a track change', () => {
    afterEach(() => {
        vi.useRealTimers();
        stopBeatFx();
    });

    it('holds the previous track ready while the next one loads, then drops if it has none', () => {
        vi.useFakeTimers();
        beginBeatFxTrack('a');
        setBeatFxEvents('a', [{ t: 1, kind: 'beat' }], 'beat_this');
        beginBeatFxTrack('b');
        expect(isBeatFxReady()).toBe(true);
        vi.advanceTimersByTime(2000);
        expect(isBeatFxReady()).toBe(false);
    });

    it('does not hold when the previous track had no beats either', () => {
        beginBeatFxTrack('a');
        beginBeatFxTrack('b');
        expect(isBeatFxReady()).toBe(false);
    });

    it('keeps holding across a run of quick skips', () => {
        vi.useFakeTimers();
        beginBeatFxTrack('a');
        setBeatFxEvents('a', [{ t: 1, kind: 'beat' }], 'beat_this');
        beginBeatFxTrack('b');
        vi.advanceTimersByTime(500);
        beginBeatFxTrack('c');
        expect(isBeatFxReady()).toBe(true);
        vi.advanceTimersByTime(1000);
        // 1.5 s after the first skip, but only 1 s after the second.
        expect(isBeatFxReady()).toBe(true);
        vi.advanceTimersByTime(1000);
        expect(isBeatFxReady()).toBe(false);
    });

    it('ends the hold the moment the next track answers', () => {
        beginBeatFxTrack('a');
        setBeatFxEvents('a', [{ t: 1, kind: 'beat' }], 'beat_this');
        beginBeatFxTrack('b');
        setBeatFxEvents('b', [], 'none');
        expect(isBeatFxReady()).toBe(false);
    });
});

describe('the beat clock under the 轻拍 / 重拍 strengths', () => {
    afterEach(() => {
        setBeatFxIntensities(1, 1);
        stopBeatFx();
    });

    const deck = (currentTime: number) => ({ paused: false, ended: false, currentTime }) as HTMLMediaElement;

    const fireDownbeat = (beat: number, downbeat: number) => {
        setBeatFxIntensities(beat, downbeat);
        beginBeatFxTrack('track');
        setBeatFxEvents('track', [{ t: 1, kind: 'downbeat' }], 'beat_this');
        tickBeatFx(deck(0.9), null);
        tickBeatFx(deck(1), null);
    };

    it('scales each envelope by its own strength', () => {
        fireDownbeat(0.5, 2);
        expect(beatImpact.get()).toBeCloseTo(0.5);
        expect(downbeatImpact.get()).toBeCloseTo(2);
    });

    it('silences a layer at strength 0', () => {
        fireDownbeat(0, 1);
        expect(beatImpact.get()).toBe(0);
        expect(downbeatImpact.get()).toBeCloseTo(1);
    });

    it('counts a downbeat as a beat too, and keeps counting across tracks', () => {
        const before = { ...getBeatFxFiredCounts() };
        fireDownbeat(1, 1);
        expect(getBeatFxFiredCounts()).toEqual({ beats: before.beats + 1, downbeats: before.downbeats + 1 });
        fireDownbeat(1, 1);
        expect(getBeatFxFiredCounts()).toEqual({ beats: before.beats + 2, downbeats: before.downbeats + 2 });
    });
});

describe('Sonnet beat FX frame', () => {
    afterEach(() => {
        stopBeatFx();
    });

    const installBeats = () => {
        beginBeatFxTrack('track');
        setBeatFxEvents('track', [{ t: 1, kind: 'beat' }, { t: 2, kind: 'downbeat' }], 'beat_this');
    };

    it('is null while the switch is off, even with beats installed', () => {
        installBeats();
        expect(createSonnetBeatFxReader()(undefined, false)).toBeNull();
    });

    it('is null while the track has no beats yet, so the original frame is drawn', () => {
        beginBeatFxTrack('track');
        expect(createSonnetBeatFxReader()(undefined, true)).toBeNull();
    });

    it('takes the strengths from the signals, which the clock has already scaled', () => {
        installBeats();
        beatImpact.set(0);
        downbeatImpact.set(2);
        const frame = createSonnetBeatFxReader()(undefined, true)!;
        expect(frame.zoom).toBeCloseTo(1 + 2 * SONNET_BEAT_FX.downbeatZoomPercent / 100);
        expect(frame.rotation).toBe(0);
        expect(frame.tear).toBeCloseTo(2 * SONNET_BEAT_FX.tear);
        expect(frame.flare).toBeCloseTo(2 * SONNET_BEAT_FX.flare);
    });

    it('keeps the line flash at rest while nothing is heard', () => {
        installBeats();
        const treble = { get: () => 200 };
        const bands = { treble } as unknown as Parameters<ReturnType<typeof createSonnetBeatFxReader>>[0];
        const read = createSonnetBeatFxReader();
        tickBeatFx(null, null);
        expect(read(bands, true)!.lineLift).toBe(0);
    });

    it('puts the line and halo layers back to their built alpha', () => {
        const view = {
            haloLayer: { alpha: 0.35 },
            haloBaseAlpha: 0.35,
            mgGeoLayer: { alpha: 1 },
            mgFixedGeoLayer: { alpha: 1 },
        };
        applySonnetBeatFxLayers(view, { zoom: 1, rotation: 0, tear: 0, tearSeed: 0, flare: 1, lineLift: 0 });
        expect(view.haloLayer.alpha).toBe(1);
        expect(view.mgGeoLayer.alpha).toBe(SONNET_BEAT_FX.lineBaseAlpha);
        restoreSonnetBeatFxLayers(view);
        expect(view.mgGeoLayer.alpha).toBe(1);
        expect(view.mgFixedGeoLayer.alpha).toBe(1);
        expect(view.haloLayer.alpha).toBe(0.35);
    });
});

describe('Diorama beat ripples', () => {
    it('fires nothing on the first step, whatever the clock has counted before', () => {
        const counter = createDioramaBeatCounter();
        expect(stepDioramaBeatCounter(counter, { beats: 40, downbeats: 10 })).toEqual({ beat: false, downbeat: false });
    });

    it('spawns one mid ripple for a beat and one bass ripple for a downbeat, never both', () => {
        const counter = createDioramaBeatCounter();
        stepDioramaBeatCounter(counter, { beats: 0, downbeats: 0 });
        expect(stepDioramaBeatCounter(counter, { beats: 0, downbeats: 0 })).toEqual({ beat: false, downbeat: false });
        expect(stepDioramaBeatCounter(counter, { beats: 1, downbeats: 0 })).toEqual({ beat: true, downbeat: false });
        expect(stepDioramaBeatCounter(counter, { beats: 2, downbeats: 1 })).toEqual({ beat: false, downbeat: true });
    });

    it('collapses a burst within one long frame into one ripple of each kind', () => {
        const counter = createDioramaBeatCounter();
        stepDioramaBeatCounter(counter, { beats: 0, downbeats: 0 });
        expect(stepDioramaBeatCounter(counter, { beats: 3, downbeats: 1 })).toEqual({ beat: true, downbeat: true });
    });

    it('breathes from the envelopes, at rest with none and capped at full strength', () => {
        expect(resolveDioramaBeatClusterPulse(0, 0)).toBe(1);
        expect(resolveDioramaBeatClusterPulse(1, 0)).toBeGreaterThan(1);
        expect(resolveDioramaBeatClusterPulse(1, 1)).toBeGreaterThan(resolveDioramaBeatClusterPulse(1, 0));
        expect(resolveDioramaBeatClusterPulse(2, 2)).toBeLessThanOrEqual(DIORAMA_PARTICLE_AUDIO_SCALE_MAX);
    });
});

describe('Latent beat pulse', () => {
    it('is the larger of the two envelopes', () => {
        expect(resolveLatentBeatFxPulse(0.4, 0.9)).toBe(0.9);
        expect(resolveLatentBeatFxPulse(1.2, 0)).toBe(1.2);
    });

    it('lands on the same speed curve as the band onset it replaces', () => {
        expect(resolveLatentBeatSpeedTarget(0.2, resolveLatentBeatFxPulse(0, 0))).toBeCloseTo(0.2 * 0.42);
        expect(resolveLatentBeatSpeedTarget(0.2, resolveLatentBeatFxPulse(2, 0))).toBe(1);
    });
});
