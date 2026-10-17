import { DEFAULT_SMART_BEAT_SETTINGS, type BeatEffectSetting, type SmartBeatSettings, type VisualizerBackgroundMode, type VisualizerFrameRate, type VisualizerMode } from '../types';
// 只做字符串校验，走 types/visualizerModes 而不是 registry：后者的 eager glob 会把 13 个
// renderer（含 three.js）拉进来，而这里读的只是一个 localStorage 字符串。
// mod 模式在启动时本来就看不到——bootstrap.tsx 的 restoreStoredModVisualizer 在 mods 注册完
// 之后专门补一次，行为不变。
import {
    DEFAULT_VISUALIZER_BACKGROUND_MODE,
    DEFAULT_VISUALIZER_MODE,
    isBuiltinVisualizerBackgroundMode,
    isBuiltinVisualizerMode,
} from '../types/visualizerModes';
import type { StoredTuning } from '../components/visualizer/tuningDefinition';
import { BEAT_EFFECT_DEFAULT, BEAT_EFFECT_STRENGTH_MAX, LEGACY_BEAT_LIST_EFFECT_IDS } from '../services/beatFx/beatEffects';
import { parseVisualizerFrameRate, VISUALIZER_FRAME_RATE_STORAGE_KEY } from '../utils/frameRateLimiter';

export const VISUALIZER_OPACITY_STORAGE_KEY = 'visualizer_opacity';

// src/stores/visualizerSettingsPersistence.ts
// localStorage read/clamp/resolve helpers for every visualizer and background setting.
//
// Moved verbatim out of useSettingsUiStore so the visualizer domain can own its own store
// without either file importing the other. Storage keys and clamping behaviour are unchanged —
// this module is the persistence half of that domain, nothing more.

export const readStoredBackgroundOpacity = () => {
    if (typeof window === 'undefined') {
        return 0.75;
    }

    const saved = localStorage.getItem('background_opacity');
    const parsed = saved ? parseFloat(saved) : 0.75;
    return Number.isFinite(parsed) ? parsed : 0.75;
};

export const readStoredVisualizerOpacity = () => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem(VISUALIZER_OPACITY_STORAGE_KEY);
    const parsed = saved ? parseFloat(saved) : 1;
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0.2, parsed)) : 1;
};

/**
 * Reads one stored tuning the way its tuning.ts declares it: under its key, else under a key of
 * an earlier version. Nothing stored, text that is no JSON and a value the declaration cannot
 * read all give the defaults.
 */
export const readStoredTuning = <T>({ defaults, storage }: Pick<StoredTuning<T>, 'defaults' | 'storage'>): T => {
    if (typeof window === 'undefined') {
        return defaults;
    }

    let saved = localStorage.getItem(storage.key);
    for (const olderKey of storage.olderKeys ?? []) {
        saved ??= localStorage.getItem(olderKey);
    }
    if (!saved) return defaults;

    try {
        return storage.read(JSON.parse(saved));
    } catch {
        return defaults;
    }
};

/** Writes a whole tuning under its key. */
export const writeStoredTuning = (key: string, tuning: unknown) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(tuning));
    }
};

export const readStoredVisualizerMode = (): VisualizerMode => {
    if (typeof window === 'undefined') {
        return DEFAULT_VISUALIZER_MODE;
    }

    const saved = localStorage.getItem('visualizer_mode');
    if (saved === 'cadenza' || saved === 'cadenze') {
        return 'cadenza';
    }

    return isBuiltinVisualizerMode(saved) ? saved : DEFAULT_VISUALIZER_MODE;
};

export const readStoredVisualizerFrameRate = (): VisualizerFrameRate => {
    if (typeof window === 'undefined') {
        return 'off';
    }

    return parseVisualizerFrameRate(localStorage.getItem(VISUALIZER_FRAME_RATE_STORAGE_KEY));
};

export const readStoredVisualizerBackgroundMode = (): VisualizerBackgroundMode | null => {
    if (typeof window === 'undefined') {
        return null;
    }

    const saved = localStorage.getItem('visualizer_background_mode');
    return isBuiltinVisualizerBackgroundMode(saved) ? saved : null;
};

export const resolveVisualizerBackgroundMode = (
    storedMode: VisualizerBackgroundMode | null | undefined,
    _visualizerMode: VisualizerMode,
): VisualizerBackgroundMode => storedMode ?? DEFAULT_VISUALIZER_BACKGROUND_MODE;

export const SMART_BEAT_STORAGE_KEY = 'visualizer_smart_beat';

/** A strength in 0..2, or `fallback` when it is not a finite number. */
const resolveSmartBeatStrength = (value: unknown, fallback: number): number => (
    typeof value === 'number' && Number.isFinite(value) ? Math.min(BEAT_EFFECT_STRENGTH_MAX, Math.max(0, value)) : fallback
);

/** An effect id as stored: `<mode>.<name>`, nothing a hand-edited or imported file could abuse. */
const BEAT_EFFECT_ID = /^[A-Za-z0-9_-]{1,32}\.[A-Za-z0-9_-]{1,32}$/;
const MAX_STORED_BEAT_EFFECTS = 64;

/**
 * A 智能动感模式 patch: the switch, any effects' settings (each one partial), and - from settings
 * stored or exported before effects had their own - the one 轻拍 / 重拍 pair every picture shared.
 */
export interface SmartBeatPatch {
    enabled?: boolean;
    effects?: Readonly<Record<string, Partial<BeatEffectSetting>>>;
    /** Legacy: folded into the beat-list effects (LEGACY_BEAT_LIST_EFFECT_IDS) as their mean. */
    beatIntensity?: number;
    /** Legacy, as `beatIntensity`. */
    downbeatIntensity?: number;
}

/** Clamps a partial 智能动感模式 patch onto `base`; anything missing or malformed keeps base's value. */
export const resolveSmartBeatSettings = (
    patch: SmartBeatPatch | null | undefined,
    base: SmartBeatSettings = DEFAULT_SMART_BEAT_SETTINGS,
): SmartBeatSettings => {
    const effects: Record<string, BeatEffectSetting> = { ...base.effects };
    const legacy = [patch?.beatIntensity, patch?.downbeatIntensity].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (legacy.length && !patch?.effects) {
        // The pair scaled the beat and downbeat layers of the same pictures; one strength per effect is
        // their mean, so a pair left at 1 stays exactly the look it was.
        const strength = resolveSmartBeatStrength(legacy.reduce((sum, value) => sum + value, 0) / legacy.length, 1);
        for (const id of LEGACY_BEAT_LIST_EFFECT_IDS) effects[id] = { ...(effects[id] ?? BEAT_EFFECT_DEFAULT), strength };
    }
    const incoming = patch?.effects && typeof patch.effects === 'object' ? Object.entries(patch.effects) : [];
    for (const [id, value] of incoming) {
        if (!BEAT_EFFECT_ID.test(id) || !value || typeof value !== 'object') continue;
        if (!(id in effects) && Object.keys(effects).length >= MAX_STORED_BEAT_EFFECTS) continue;
        const current = effects[id] ?? BEAT_EFFECT_DEFAULT;
        effects[id] = {
            on: typeof value.on === 'boolean' ? value.on : current.on,
            strength: resolveSmartBeatStrength(value.strength, current.strength),
        };
    }
    return {
        enabled: typeof patch?.enabled === 'boolean' ? patch.enabled : base.enabled,
        effects,
    };
};

export const readStoredSmartBeatSettings = (): SmartBeatSettings => {
    if (typeof window === 'undefined') return DEFAULT_SMART_BEAT_SETTINGS;
    const saved = localStorage.getItem(SMART_BEAT_STORAGE_KEY);
    if (!saved) return DEFAULT_SMART_BEAT_SETTINGS;
    try {
        return resolveSmartBeatSettings(JSON.parse(saved) as SmartBeatPatch);
    } catch {
        return DEFAULT_SMART_BEAT_SETTINGS;
    }
};
