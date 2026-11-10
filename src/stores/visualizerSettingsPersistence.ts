import { DEFAULT_SMART_BEAT_SETTINGS, type LyricRenderQuality, type SmartBeatSettings, type VisualizerBackgroundMode, type VisualizerFrameRate, type VisualizerMode } from '../types';
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
import { resolveSmartBeatSettings, type SmartBeatPatch } from '../services/beatFx/smartBeatSettings';
import { parseVisualizerFrameRate, VISUALIZER_FRAME_RATE_STORAGE_KEY } from '../utils/frameRateLimiter';
import { DEFAULT_LYRIC_RENDER_QUALITY, LYRIC_RENDER_QUALITY_STORAGE_KEY, normalizeLyricRenderQuality } from '../utils/lyricRenderQuality';

import { getStoredString } from './storagePrimitives';
import { normalizeRandomVisualizerModes } from '../utils/randomVisualizerModes';

export const RANDOM_VISUALIZER_MODES_STORAGE_KEY = 'random_visualizer_modes';

export const readStoredRandomVisualizerModes = () => {
    try {
        return normalizeRandomVisualizerModes(JSON.parse(getStoredString(RANDOM_VISUALIZER_MODES_STORAGE_KEY, 'null')));
    } catch {
        return normalizeRandomVisualizerModes(null);
    }
};

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

/** 歌词画布的全局分辨率与抗锯齿挡位（utils/lyricRenderQuality.ts）。 */
export const readStoredLyricRenderQuality = (): LyricRenderQuality => {
    const saved = getStoredString(LYRIC_RENDER_QUALITY_STORAGE_KEY, '');
    if (!saved) return DEFAULT_LYRIC_RENDER_QUALITY;
    try {
        return normalizeLyricRenderQuality(JSON.parse(saved));
    } catch {
        return DEFAULT_LYRIC_RENDER_QUALITY;
    }
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

// The pure 智能动感模式 settings moved to services/beatFx/smartBeatSettings.ts: utils must not import stores (from the PR #750 re-review, 2026-10-19).
export { resolveSmartBeatSettings, toStoredSmartBeat, type SmartBeatPatch } from '../services/beatFx/smartBeatSettings';

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
