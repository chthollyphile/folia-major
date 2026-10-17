// src/stores/useVisualizerSettingsStore.ts
// Visualizer and background settings: the active mode, the background mode and URL background
// list, opacity/frame-rate, and the per-mode tuning objects.
//
// Split out of useSettingsUiStore. Persistence (localStorage reads, clamping, defaults) lives in
// ./visualizerSettingsPersistence; this file owns the state and the actions only.
//
// A lyric style's or a background's tuning has no line here: its tuning.ts says where it is stored
// (its `storage`), its field and its actions are built from that declaration by `tuningFields`,
// and its part of the type comes from VisualizerTuningSettings, which each tuning.ts adds to. A
// background's settings that are no tuning object come whole from its settings.ts.

import { create } from 'zustand';
import { getVisualizerModeLabel } from '../components/visualizer/registry';
import type { StoredTuning, VisualizerTuningSettings } from '../components/visualizer/tuningDefinition';
import { getBackgroundSettingsSlices, getStoredVisualizerTunings } from '../components/visualizer/tuningRegistry';
import { type SmartBeatSettings, type VisualizerBackgroundMode, type VisualizerFrameRate, type VisualizerMode } from '../types';
import { VISUALIZER_FRAME_RATE_STORAGE_KEY, setGlobalVisualizerFrameRate } from '../utils/frameRateLimiter';
import { GLOW_BLUR_QUANTIZE_STORAGE_KEY, readStoredGlowBlurQuantize, setGlowBlurQuantized } from '../utils/glowBlurQuantize';
import i18n from '../i18n/config';
import { setStatusMessage } from './useStatusMessageStore';
import { SMART_BEAT_STORAGE_KEY, VISUALIZER_OPACITY_STORAGE_KEY, readStoredBackgroundOpacity, readStoredSmartBeatSettings, resolveSmartBeatSettings, readStoredTuning, readStoredVisualizerBackgroundMode, readStoredVisualizerFrameRate, readStoredVisualizerMode, readStoredVisualizerOpacity, writeStoredTuning } from './visualizerSettingsPersistence';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

type OwnSettingsState = {
    disableVisualizerVignette: boolean;
    disableVisualizerGeometricBackground: boolean;
    backgroundOpacity: number;
    visualizerOpacity: number;
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
    visualizerFrameRate: VisualizerFrameRate;
    visualizerMode: VisualizerMode;
    randomVisualizerModePerSong: boolean;
    /** Snap animated glow blur radii to a bounded set. See components/visualizer/wordGlow.ts. */
    glowBlurQuantize: boolean;
    /** 智能动感模式, shared by every visualizer and background that draws beat FX: no one style's tuning. */
    smartBeat: SmartBeatSettings;
    handleToggleDisableVisualizerVignette: (disable: boolean) => void;
    handleToggleDisableVisualizerGeometricBackground: (disable: boolean) => void;
    handleSetBackgroundOpacity: (opacity: number) => void;
    handleSetVisualizerOpacity: (opacity: number) => void;
    handleSetVisualizerBackgroundMode: (mode: VisualizerBackgroundMode) => void;
    handleResetVisualizerBackgroundMode: () => void;
    handleSetVisualizerFrameRate: (frameRate: VisualizerFrameRate) => void;
    handleSetVisualizerMode: (mode: VisualizerMode, options?: { notify?: boolean }) => void;
    handleToggleRandomVisualizerModePerSong: (enable: boolean) => void;
    handleToggleGlowBlurQuantize: (enable: boolean) => void;
    handleSetSmartBeat: (patch: Partial<SmartBeatSettings>) => void;
};

export type VisualizerSettingsState = OwnSettingsState & VisualizerTuningSettings;

type Fields = Record<string, unknown>;

/** The names of the store fields the styles' and the backgrounds' folders declared: what a caller that edits them all picks up. */
const declaredFieldNames: string[] = [];

/**
 * What the store holds for one stored tuning, built from its declaration: the tuning as it was
 * read at start-up, the action that lays a patch onto it, the action that puts the defaults
 * back, and the tuning's own further actions. They write the whole tuning under the declared key.
 */
const tuningFields = (
    { settingsKey, settingsSetterKey, settingsResetterKey, defaults, storage }: StoredTuning,
    set: (fields: object) => void,
    get: () => Fields,
): Fields => {
    const held = () => get()[settingsKey];
    const hold = (tuning: unknown) => {
        writeStoredTuning(storage.key, tuning);
        set({ [settingsKey]: tuning });
    };
    return {
        [settingsKey]: readStoredTuning({ defaults, storage }),
        [settingsSetterKey]: (patch: object) => {
            storage.onChange?.(patch);
            hold(storage.merge(held(), patch));
        },
        [settingsResetterKey]: () => {
            hold(defaults);
            if (storage.resetNotice) {
                setStatusMessage({ type: 'info', text: i18n.t(storage.resetNotice) });
            }
        },
        ...storage.actions?.({ held, hold }),
    };
};

/** Everything the styles' and the backgrounds' folders declared for the store: the stored tunings, and the backgrounds' other settings. */
const declaredFields = (set: (fields: object) => void, get: () => Fields) => {
    const fields: Fields = Object.assign(
        {},
        ...getStoredVisualizerTunings().map(tuning => tuningFields(tuning, set, get)),
        ...getBackgroundSettingsSlices().map(slice => slice(set, get)),
    );
    declaredFieldNames.push(...Object.keys(fields));
    return fields as unknown as VisualizerTuningSettings;
};

export const useVisualizerSettingsStore = create<VisualizerSettingsState>((set, get) => ({
    ...declaredFields(set as (fields: object) => void, get as unknown as () => Fields),
    disableVisualizerVignette: getStoredBoolean('disable_visualizer_vignette', false),
    disableVisualizerGeometricBackground: getStoredBoolean('disable_visualizer_geometric_background', false),
    backgroundOpacity: readStoredBackgroundOpacity(),
    visualizerOpacity: readStoredVisualizerOpacity(),
    visualizerBackgroundMode: readStoredVisualizerBackgroundMode(),
    visualizerFrameRate: readStoredVisualizerFrameRate(),
    visualizerMode: readStoredVisualizerMode(),
    randomVisualizerModePerSong: getStoredBoolean('random_visualizer_mode_per_song', false),
    glowBlurQuantize: readStoredGlowBlurQuantize(),
    smartBeat: readStoredSmartBeatSettings(),
    handleSetSmartBeat: (patch) => {
        const next = resolveSmartBeatSettings(patch, get().smartBeat);
        if (typeof window !== 'undefined') localStorage.setItem(SMART_BEAT_STORAGE_KEY, JSON.stringify(next));
        set({ smartBeat: next });
    },
    handleToggleDisableVisualizerVignette: (disable) => {
        setStoredBoolean('disable_visualizer_vignette', disable);
        set({ disableVisualizerVignette: disable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'vignetteOff' : 'vignetteOn')),
        });
    },
    handleToggleDisableVisualizerGeometricBackground: (disable) => {
        setStoredBoolean('disable_visualizer_geometric_background', disable);
        set({ disableVisualizerGeometricBackground: disable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'geometricBgHidden' : 'geometricBgShown')),
        });
    },
    handleSetBackgroundOpacity: (opacity) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('background_opacity', String(opacity));
        }
        set({ backgroundOpacity: opacity });
    },
    handleSetVisualizerOpacity: (opacity) => {
        const next = Math.min(1, Math.max(0.2, opacity));
        if (typeof window !== 'undefined') {
            localStorage.setItem(VISUALIZER_OPACITY_STORAGE_KEY, String(next));
        }
        set({ visualizerOpacity: next });
    },
    handleSetVisualizerBackgroundMode: (mode) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('visualizer_background_mode', mode);
        }
        set({ visualizerBackgroundMode: mode });
    },
    handleResetVisualizerBackgroundMode: () => {
        if (typeof window !== 'undefined') {
            localStorage.removeItem('visualizer_background_mode');
        }
        set({ visualizerBackgroundMode: null });
    },
    handleSetVisualizerFrameRate: (frameRate) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(VISUALIZER_FRAME_RATE_STORAGE_KEY, String(frameRate));
        }
        setGlobalVisualizerFrameRate(frameRate);
        set({ visualizerFrameRate: frameRate });
    },
    handleSetVisualizerMode: (mode, options) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('visualizer_mode', mode);
        }
        set({ visualizerMode: mode });
        if (options?.notify !== false) {
            setStatusMessage({
                type: 'info',
                text: i18n.t('notifications.visualizerSwitched', {
                    mode: getVisualizerModeLabel(mode, key => i18n.t(key)),
                }),
            });
        }
    },
    handleToggleRandomVisualizerModePerSong: (enable) => {
        setStoredBoolean('random_visualizer_mode_per_song', enable);
        set({ randomVisualizerModePerSong: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t(`status.randomVisualizerModePerSong${enable ? 'On' : 'Off'}`),
        });
    },
    handleToggleGlowBlurQuantize: (enable) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(GLOW_BLUR_QUANTIZE_STORAGE_KEY, String(enable));
        }
        // The renderers read the module flag every frame; the store only persists and drives the UI.
        setGlowBlurQuantized(enable);
        set({ glowBlurQuantize: enable });
    },
}));

/**
 * The visualizer half of what selectSettingsUiSnapshot used to expose, kept as one grouped
 * selector for the settings surfaces that legitimately edit the whole domain at once.
 * Ordinary consumers should select the single field they need instead.
 */
export const selectVisualizerSettingsSnapshot = (state: VisualizerSettingsState) => ({
    ...Object.fromEntries(declaredFieldNames.map(name => [name, (state as unknown as Fields)[name]])) as unknown as VisualizerTuningSettings,
    backgroundOpacity: state.backgroundOpacity,
    disableVisualizerGeometricBackground: state.disableVisualizerGeometricBackground,
    disableVisualizerVignette: state.disableVisualizerVignette,
    handleResetVisualizerBackgroundMode: state.handleResetVisualizerBackgroundMode,
    handleSetBackgroundOpacity: state.handleSetBackgroundOpacity,
    handleSetVisualizerBackgroundMode: state.handleSetVisualizerBackgroundMode,
    handleSetVisualizerFrameRate: state.handleSetVisualizerFrameRate,
    handleSetVisualizerMode: state.handleSetVisualizerMode,
    handleSetVisualizerOpacity: state.handleSetVisualizerOpacity,
    handleSetSmartBeat: state.handleSetSmartBeat,
    handleToggleDisableVisualizerGeometricBackground: state.handleToggleDisableVisualizerGeometricBackground,
    handleToggleDisableVisualizerVignette: state.handleToggleDisableVisualizerVignette,
    handleToggleRandomVisualizerModePerSong: state.handleToggleRandomVisualizerModePerSong,
    randomVisualizerModePerSong: state.randomVisualizerModePerSong,
    smartBeat: state.smartBeat,
    visualizerBackgroundMode: state.visualizerBackgroundMode,
    visualizerFrameRate: state.visualizerFrameRate,
    visualizerMode: state.visualizerMode,
    visualizerOpacity: state.visualizerOpacity,
});

// Module-level handle for the assembly layer; an action needs no subscription.
export const handleSetVisualizerMode = (mode: VisualizerMode, options?: { notify?: boolean }) => (
    useVisualizerSettingsStore.getState().handleSetVisualizerMode(mode, options)
);
