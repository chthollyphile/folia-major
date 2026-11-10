// src/stores/useLyricSettingsStore.ts
// How lyrics are sourced, filtered and timed: which provider wins, the staff-credits policy,
// the rules that remove lyric lines, and this machine's timeline offset.
//
// Split out of useSettingsUiStore. Deliberately separate from typography, which is about how
// lyrics look rather than which lyrics are chosen.

import { create } from 'zustand';
import { getLyricStaffPatternError } from '../utils/lyrics/staffCredits';
import { legacyLyricFilterSetting, readLyricLineRules, storedLyricLineRules, type LyricLineRule } from '../utils/lyrics/lyricLineRules';
import i18n from '../i18n/config';
import { type LocalLyricsPriority, type LyricProviderSource } from '../types';
import { getLyricProviderPreferenceLabel } from '../utils/lyrics/lyricSourceLabels';
import { normalizeLocalLyricFormatOrder, type LocalLyricFileFormat } from '../utils/lyrics/localLyricFormatOrder';
import { DEFAULT_PREFERRED_LYRIC_SOURCE, migratePreferredLyricSource } from '../utils/lyrics/sourcePriority';
import { DEFAULT_LYRIC_STAFF_ABSORB_MODE, DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS, DEFAULT_LYRIC_STAFF_POLICY, LYRIC_STAFF_MIN_DWELL_RANGE, type LyricStaffAbsorbMode, type LyricStaffPolicy } from '../utils/lyrics/staffCreditsPolicy';
import { getStoredBoolean, getStoredString, removeStoredKey, setStoredBoolean, setStoredString } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';

export const GLOBAL_LYRIC_TIMELINE_OFFSET_STORAGE_KEY = 'global_lyric_timeline_offset_ms';

// Device-local audio/visual latency compensation (Bluetooth headphones and the like). Deliberately
// NOT part of the synced visual config: the right value belongs to this machine's output path.
export const GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS = 2000;

export const clampGlobalLyricTimelineOffsetMs = (value: number): number => {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.round(Math.min(GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS, Math.max(-GLOBAL_LYRIC_TIMELINE_OFFSET_LIMIT_MS, value)));
};

const readStoredGlobalLyricTimelineOffsetMs = (): number => {
    if (typeof window === 'undefined') {
        return 0;
    }

    return clampGlobalLyricTimelineOffsetMs(Number(localStorage.getItem(GLOBAL_LYRIC_TIMELINE_OFFSET_STORAGE_KEY)));
};

const PREFERRED_LYRIC_SOURCE_STORAGE_KEY_V2 = 'preferred_alternative_lyric_source_v2';

export const LOCAL_LYRICS_PRIORITY_STORAGE_KEY = 'local_lyrics_priority';

export const readStoredLocalLyricsPriority = (): LocalLyricsPriority => {
    if (typeof window === 'undefined') return 'local';
    return localStorage.getItem(LOCAL_LYRICS_PRIORITY_STORAGE_KEY) === 'online' ? 'online' : 'local';
};

export const LOCAL_LYRIC_FORMAT_ORDER_STORAGE_KEY = 'local_lyric_format_order';

// Only read at import time: the winning sidecar file is chosen during a scan, so a change applies
// on the next resync of the local folders.
const readStoredLocalLyricFormatOrder = (): LocalLyricFileFormat[] => {
    if (typeof window === 'undefined') return normalizeLocalLyricFormatOrder(null);
    try {
        return normalizeLocalLyricFormatOrder(JSON.parse(localStorage.getItem(LOCAL_LYRIC_FORMAT_ORDER_STORAGE_KEY) || 'null'));
    } catch {
        return normalizeLocalLyricFormatOrder(null);
    }
};

const readStoredPreferredAlternativeLyricSource = (): LyricProviderSource => {
    if (typeof window === 'undefined') return DEFAULT_PREFERRED_LYRIC_SOURCE;
    const versioned = localStorage.getItem(PREFERRED_LYRIC_SOURCE_STORAGE_KEY_V2);
    const legacy = localStorage.getItem('preferred_alternative_lyric_source');
    const migrated = migratePreferredLyricSource(versioned, legacy);
    if (versioned !== migrated) {
        localStorage.setItem(PREFERRED_LYRIC_SOURCE_STORAGE_KEY_V2, migrated);
    }
    return migrated;
};

const LYRIC_LINE_RULES_KEY = 'lyrics_filter_rules';
const AUTO_AI_LYRIC_SEGMENTATION_KEY = 'lyrics_auto_ai_segmentation';
const KEEP_PROVIDER_WORD_TIMING_KEY = 'lyrics_keep_provider_word_timing';
// The single expression older versions saved. Read once into a rule; written back on every save
// (or removed with that rule), so an older version still filters the same lines.
const LEGACY_LYRIC_FILTER_PATTERN_KEY = 'lyrics_filter_pattern';
const LEGACY_LYRIC_FILTER_ENABLED_KEY = 'lyrics_filter_enabled';

const readStoredLyricLineRules = (): LyricLineRule[] => {
    if (typeof window === 'undefined') {
        return [];
    }

    return readLyricLineRules({
        rules: localStorage.getItem(LYRIC_LINE_RULES_KEY),
        pattern: localStorage.getItem(LEGACY_LYRIC_FILTER_PATTERN_KEY),
        enabled: localStorage.getItem(LEGACY_LYRIC_FILTER_ENABLED_KEY),
    });
};

const readStoredLyricStaffPolicy = (): LyricStaffPolicy => {
    if (typeof window === 'undefined') {
        return DEFAULT_LYRIC_STAFF_POLICY;
    }

    const saved = localStorage.getItem('lyrics_staff_policy');
    return saved === 'keep' || saved === 'hide' || saved === 'smart' ? saved : DEFAULT_LYRIC_STAFF_POLICY;
};

const readStoredLyricStaffMinDwellSeconds = (): number => {
    if (typeof window === 'undefined') {
        return DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS;
    }

    const parsed = Number.parseFloat(localStorage.getItem('lyrics_staff_min_dwell') || '');
    if (!Number.isFinite(parsed)) {
        return DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS;
    }

    return Math.min(LYRIC_STAFF_MIN_DWELL_RANGE.max, Math.max(LYRIC_STAFF_MIN_DWELL_RANGE.min, parsed));
};

const readStoredLyricStaffAbsorbMode = (): LyricStaffAbsorbMode => {
    if (typeof window === 'undefined') {
        return DEFAULT_LYRIC_STAFF_ABSORB_MODE;
    }

    const saved = localStorage.getItem('lyrics_staff_absorb_mode');
    return saved === 'before' || saved === 'both' || saved === 'off' ? saved : DEFAULT_LYRIC_STAFF_ABSORB_MODE;
};

export type LyricSettingsState = {
    autoUseBestLyric: boolean;
    preferredAlternativeLyricSource: LyricProviderSource;
    /**
     * Keep a platform's own word-level lyrics (`prefersOwnWordByWord`) over every source but the preferred
     * one in the automatic pick; off, they are matched like any other source's (issue #1127).
     */
    keepProviderWordTiming: boolean;
    localLyricsPriority: LocalLyricsPriority;
    localLyricFormatOrder: LocalLyricFileFormat[];
    globalLyricTimelineOffsetMs: number;
    lyricLineRules: LyricLineRule[];
    // 开头制作人员信息的处理策略，与上面的通用逐行过滤是两套独立机制。
    lyricStaffPolicy: LyricStaffPolicy;
    lyricStaffMinDwellSeconds: number;
    lyricStaffAbsorbMode: LyricStaffAbsorbMode;
    lyricStaffPattern: string;
    /** Run AI word segmentation by itself on a song that has none saved yet (issue #960). */
    autoAiLyricSegmentation: boolean;
    handleToggleAutoUseBestLyric: (enable: boolean) => void;
    handleSetPreferredAlternativeLyricSource: (source: LyricProviderSource) => void;
    handleToggleKeepProviderWordTiming: (enable: boolean) => void;
    handleSetLocalLyricsPriority: (priority: LocalLyricsPriority) => void;
    handleSetLocalLyricFormatOrder: (order: LocalLyricFileFormat[]) => void;
    handleSetGlobalLyricTimelineOffsetMs: (offsetMs: number) => void;
    handleSetLyricLineRules: (rules: LyricLineRule[]) => void;
    handleSetLyricStaffPolicy: (policy: LyricStaffPolicy) => void;
    handleSetLyricStaffMinDwellSeconds: (seconds: number) => void;
    handleSetLyricStaffAbsorbMode: (mode: LyricStaffAbsorbMode) => void;
    handleSetLyricStaffPattern: (pattern: string) => void;
    handleToggleAutoAiLyricSegmentation: (enable: boolean) => void;
};

export const useLyricSettingsStore = create<LyricSettingsState>((set, get) => ({
    autoUseBestLyric: getStoredBoolean('auto_use_best_lyric', true),
    preferredAlternativeLyricSource: readStoredPreferredAlternativeLyricSource(),
    keepProviderWordTiming: getStoredBoolean(KEEP_PROVIDER_WORD_TIMING_KEY, true),
    localLyricsPriority: readStoredLocalLyricsPriority(),
    localLyricFormatOrder: readStoredLocalLyricFormatOrder(),
    globalLyricTimelineOffsetMs: readStoredGlobalLyricTimelineOffsetMs(),
    lyricLineRules: readStoredLyricLineRules(),
    lyricStaffPolicy: readStoredLyricStaffPolicy(),
    lyricStaffMinDwellSeconds: readStoredLyricStaffMinDwellSeconds(),
    lyricStaffAbsorbMode: readStoredLyricStaffAbsorbMode(),
    lyricStaffPattern: getStoredString('lyrics_staff_pattern', ''),
    // Off by default: every song it runs on is a paid model request.
    autoAiLyricSegmentation: getStoredBoolean(AUTO_AI_LYRIC_SEGMENTATION_KEY, false),
    handleToggleAutoUseBestLyric: (enable) => {
        setStoredBoolean('auto_use_best_lyric', enable);
        set({ autoUseBestLyric: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'autoBestLyricOn' : 'autoBestLyricOff')),
        });
    },
    handleSetPreferredAlternativeLyricSource: (source) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(PREFERRED_LYRIC_SOURCE_STORAGE_KEY_V2, source);
        }
        set({ preferredAlternativeLyricSource: source });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.lyricSourceChanged', { source: getLyricProviderPreferenceLabel(source) }),
        });
    },
    handleToggleKeepProviderWordTiming: (enable) => {
        setStoredBoolean(KEEP_PROVIDER_WORD_TIMING_KEY, enable);
        set({ keepProviderWordTiming: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'keepProviderWordTimingOn' : 'keepProviderWordTimingOff')),
        });
    },
    handleSetLocalLyricsPriority: (priority) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(LOCAL_LYRICS_PRIORITY_STORAGE_KEY, priority);
        }
        set({ localLyricsPriority: priority });
    },
    handleSetLocalLyricFormatOrder: (order) => {
        const next = normalizeLocalLyricFormatOrder(order);
        if (typeof window !== 'undefined') {
            localStorage.setItem(LOCAL_LYRIC_FORMAT_ORDER_STORAGE_KEY, JSON.stringify(next));
        }
        set({ localLyricFormatOrder: next });
    },
    handleSetGlobalLyricTimelineOffsetMs: (offsetMs) => {
        const nextOffsetMs = clampGlobalLyricTimelineOffsetMs(offsetMs);
        if (typeof window !== 'undefined') {
            localStorage.setItem(GLOBAL_LYRIC_TIMELINE_OFFSET_STORAGE_KEY, String(nextOffsetMs));
        }
        set({ globalLyricTimelineOffsetMs: nextOffsetMs });
    },
    handleSetLyricLineRules: (rules) => {
        set({ lyricLineRules: rules });
        setStoredString(LYRIC_LINE_RULES_KEY, storedLyricLineRules(rules, typeof window === 'undefined' ? null : localStorage.getItem(LYRIC_LINE_RULES_KEY)));
        const legacy = legacyLyricFilterSetting(rules);
        if (legacy) {
            setStoredString(LEGACY_LYRIC_FILTER_PATTERN_KEY, legacy.pattern);
            setStoredBoolean(LEGACY_LYRIC_FILTER_ENABLED_KEY, legacy.enabled);
        } else {
            removeStoredKey(LEGACY_LYRIC_FILTER_PATTERN_KEY);
            removeStoredKey(LEGACY_LYRIC_FILTER_ENABLED_KEY);
        }
    },
    handleSetLyricStaffPolicy: (policy) => {
        set({ lyricStaffPolicy: policy });

        if (typeof window === 'undefined') {
            return;
        }

        localStorage.setItem('lyrics_staff_policy', policy);
    },
    handleSetLyricStaffMinDwellSeconds: (seconds) => {
        const next = Number.isFinite(seconds)
            ? Math.min(LYRIC_STAFF_MIN_DWELL_RANGE.max, Math.max(LYRIC_STAFF_MIN_DWELL_RANGE.min, seconds))
            : DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS;

        set({ lyricStaffMinDwellSeconds: next });

        if (typeof window === 'undefined') {
            return;
        }

        localStorage.setItem('lyrics_staff_min_dwell', String(next));
    },
    handleSetLyricStaffAbsorbMode: (mode) => {
        set({ lyricStaffAbsorbMode: mode });

        if (typeof window === 'undefined') {
            return;
        }

        localStorage.setItem('lyrics_staff_absorb_mode', mode);
    },
    handleSetLyricStaffPattern: (pattern) => {
        const next = pattern.trim();
        set({ lyricStaffPattern: next });

        if (typeof window === 'undefined') {
            return;
        }

        if (next) {
            localStorage.setItem('lyrics_staff_pattern', next);
        } else {
            localStorage.removeItem('lyrics_staff_pattern');
        }
    },
    handleToggleAutoAiLyricSegmentation: (enable) => {
        setStoredBoolean(AUTO_AI_LYRIC_SEGMENTATION_KEY, enable);
        set({ autoAiLyricSegmentation: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'autoAiLyricSegmentationOn' : 'autoAiLyricSegmentationOff')),
        });
    },
}));

/** The lyric-sourcing half of the former settings snapshot. */
export const selectLyricSettingsSnapshot = (state: LyricSettingsState) => ({
    autoUseBestLyric: state.autoUseBestLyric,
    preferredAlternativeLyricSource: state.preferredAlternativeLyricSource,
    keepProviderWordTiming: state.keepProviderWordTiming,
    localLyricsPriority: state.localLyricsPriority,
    localLyricFormatOrder: state.localLyricFormatOrder,
    globalLyricTimelineOffsetMs: state.globalLyricTimelineOffsetMs,
    lyricLineRules: state.lyricLineRules,
    lyricStaffPolicy: state.lyricStaffPolicy,
    lyricStaffMinDwellSeconds: state.lyricStaffMinDwellSeconds,
    lyricStaffAbsorbMode: state.lyricStaffAbsorbMode,
    lyricStaffPattern: state.lyricStaffPattern,
    autoAiLyricSegmentation: state.autoAiLyricSegmentation,
    handleToggleAutoUseBestLyric: state.handleToggleAutoUseBestLyric,
    handleSetPreferredAlternativeLyricSource: state.handleSetPreferredAlternativeLyricSource,
    handleToggleKeepProviderWordTiming: state.handleToggleKeepProviderWordTiming,
    handleSetLocalLyricsPriority: state.handleSetLocalLyricsPriority,
    handleSetLocalLyricFormatOrder: state.handleSetLocalLyricFormatOrder,
    handleSetGlobalLyricTimelineOffsetMs: state.handleSetGlobalLyricTimelineOffsetMs,
    handleSetLyricLineRules: state.handleSetLyricLineRules,
    handleSetLyricStaffPolicy: state.handleSetLyricStaffPolicy,
    handleSetLyricStaffMinDwellSeconds: state.handleSetLyricStaffMinDwellSeconds,
    handleSetLyricStaffAbsorbMode: state.handleSetLyricStaffAbsorbMode,
    handleSetLyricStaffPattern: state.handleSetLyricStaffPattern,
    handleToggleAutoAiLyricSegmentation: state.handleToggleAutoAiLyricSegmentation,
    lyricStaffPatternError: getLyricStaffPatternError(state.lyricStaffPattern),
});
