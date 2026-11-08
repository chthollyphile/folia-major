// src/stores/useThemeSettingsStore.ts
// Day/night mode and the background-derivation switches.
//
// Split out of useSettingsUiStore so the theme has one owner. Consumers deliberately keep
// receiving isDaylight as a prop for now: it is read in 187 files, and giving each of them its
// own subscription would wake 187 components on every toggle without removing the re-render.
// Changing how it is consumed is a separate, one-shot migration.
//
// @note default_theme_daylight（OBS 链接另有 isDaylight 参数）、disable_home_dynamic_background（以及只在迁移时读的旧键 enable_home_dynamic_background） 是用户明确决定「不进外观配置导入导出」的设置（2026-11-08）：配置码也用于 web 版 OBS 链接，
// 只加 OBS 页面看得到的，这些在 OBS 页面上看不到。不要按 settings-feature-integration「视觉设置必须进
// buildCurrentConfig / compressConfig / decompressConfig / validKeys / handleImportConfig」的规则把它们补进短码或 JSON。

import { create } from 'zustand';
import i18n from '../i18n/config';

import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';

export const FOLLOW_SYSTEM_THEME_STORAGE_KEY = 'follow_system_theme';

export const readSystemThemeIsDaylight = (): boolean | null => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return null;
    }

    return window.matchMedia('(prefers-color-scheme: light)').matches;
};

const initialFollowSystemTheme = getStoredBoolean(FOLLOW_SYSTEM_THEME_STORAGE_KEY, false);
const initialStoredDaylight = getStoredBoolean('default_theme_daylight', false);
const initialDaylight = initialFollowSystemTheme
    ? (readSystemThemeIsDaylight() ?? initialStoredDaylight)
    : initialStoredDaylight;

const readStoredDisableHomeDynamicBackground = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    const saved = localStorage.getItem('disable_home_dynamic_background');
    if (saved !== null) {
        return saved === 'true';
    }

    const legacySaved = localStorage.getItem('enable_home_dynamic_background');
    if (legacySaved !== null) {
        return legacySaved !== 'true';

    }

    return false;
};

export type ThemeSettingsState = {
    useCoverColorBg: boolean;
    staticMode: boolean;
    disableHomeDynamicBackground: boolean;
    isDaylight: boolean;
    followSystemTheme: boolean;
    handleToggleCoverColorBg: (enable: boolean) => void;
    handleToggleStaticMode: (enable: boolean) => void;
    handleToggleDisableHomeDynamicBackground: (disable: boolean) => void;
    setDaylightPreference: (isDaylight: boolean) => void;
    setDaylightPreferenceFromSystem: (isDaylight: boolean) => void;
    setFollowSystemTheme: (enabled: boolean) => void;
};

export const useThemeSettingsStore = create<ThemeSettingsState>((set, get) => ({
    useCoverColorBg: getStoredBoolean('use_cover_color_bg', false),
    staticMode: getStoredBoolean('static_mode', false),
    disableHomeDynamicBackground: readStoredDisableHomeDynamicBackground(),
    followSystemTheme: initialFollowSystemTheme,
    isDaylight: initialDaylight,
    handleToggleCoverColorBg: (enable) => {
        setStoredBoolean('use_cover_color_bg', enable);
        set({ useCoverColorBg: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'coverColorAdded' : 'coverColorDefault')),
        });
    },
    handleToggleStaticMode: (enable) => {
        setStoredBoolean('static_mode', enable);
        set({ staticMode: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'staticModeOn' : 'staticModeOff')),
        });
    },
    handleToggleDisableHomeDynamicBackground: (disable) => {
        setStoredBoolean('disable_home_dynamic_background', disable);
        set({ disableHomeDynamicBackground: disable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (disable ? 'homeBgDisabled' : 'homeBgEnabled')),
        });
    },
    // System updates are kept separate from the manual setter so a user click can disable auto-follow.
    setDaylightPreferenceFromSystem: (enabled) => {
        if (!get().followSystemTheme) {
            return;
        }

        setStoredBoolean('default_theme_daylight', enabled);
        set({ isDaylight: enabled });
        if (typeof window !== 'undefined' && window.electron?.setNativeTheme) {
            void window.electron.setNativeTheme('system');
        }
    },
    setFollowSystemTheme: (enabled) => {
        setStoredBoolean(FOLLOW_SYSTEM_THEME_STORAGE_KEY, enabled);
        set({ followSystemTheme: enabled });

        if (typeof window !== 'undefined' && window.electron?.setNativeTheme) {
            void window.electron.setNativeTheme(enabled ? 'system' : (get().isDaylight ? 'light' : 'dark'));
        }

        if (enabled) {
            const systemThemeIsDaylight = readSystemThemeIsDaylight();
            if (systemThemeIsDaylight !== null) {
                get().setDaylightPreferenceFromSystem(systemThemeIsDaylight);
            }
        }
    },
    setDaylightPreference: (enabled) => {
        const wasFollowingSystem = get().followSystemTheme;
        if (wasFollowingSystem) {
            setStoredBoolean(FOLLOW_SYSTEM_THEME_STORAGE_KEY, false);
        }
        setStoredBoolean('default_theme_daylight', enabled);
        set({ isDaylight: enabled, ...(wasFollowingSystem ? { followSystemTheme: false } : {}) });
        if (typeof window !== 'undefined' && window.electron?.setNativeTheme) {
            void window.electron.setNativeTheme(enabled ? 'light' : 'dark');
        }
    },
}));

/**
 * The ThemeSettings half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectThemeSettingsSnapshot = (state: ThemeSettingsState) => ({
    isDaylight: state.isDaylight,
    followSystemTheme: state.followSystemTheme,
    useCoverColorBg: state.useCoverColorBg,
    staticMode: state.staticMode,
    disableHomeDynamicBackground: state.disableHomeDynamicBackground,
    setDaylightPreference: state.setDaylightPreference,
    setDaylightPreferenceFromSystem: state.setDaylightPreferenceFromSystem,
    setFollowSystemTheme: state.setFollowSystemTheme,
    handleToggleCoverColorBg: state.handleToggleCoverColorBg,
    handleToggleStaticMode: state.handleToggleStaticMode,
    handleToggleDisableHomeDynamicBackground: state.handleToggleDisableHomeDynamicBackground,
});

// Seed Electron's native theme from the stored preference at startup. Lives here rather than in
// useSettingsUiStore because it reads nothing but this domain.
if (typeof window !== 'undefined' && window.electron?.setNativeTheme) {
    const initialTheme = useThemeSettingsStore.getState();
    void window.electron.setNativeTheme(
        initialTheme.followSystemTheme ? 'system' : (initialTheme.isDaylight ? 'light' : 'dark'),
    );
}

// Module-level handle for the assembly layer; an action needs no subscription.
export const handleToggleCoverColorBg = (enable: boolean) => useThemeSettingsStore.getState().handleToggleCoverColorBg(enable);
