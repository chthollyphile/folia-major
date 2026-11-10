import { create } from 'zustand';
import { getStoredBoolean, getStoredString, setStoredBoolean } from './storagePrimitives';

// src/stores/useLatticeSettingsStore.ts
// Persistent queue-collage preferences. Deliberately separate from useLatticeControlsStore: that
// store only publishes runtime state of the currently mounted wall.
//
// @note lattice_vignette、lattice_auto_focus_on_song_change、lattice_lights_on、lattice_poster_tint_*（4 个）、wall_tools_queue_island_open 是用户明确决定「不进外观配置导入导出」的设置（2026-11-08）：配置码也用于 web 版 OBS 链接，
// 只加 OBS 页面看得到的，这些在 OBS 页面上看不到。不要按 settings-feature-integration「视觉设置必须进
// buildCurrentConfig / compressConfig / decompressConfig / validKeys / handleImportConfig」的规则把它们补进短码或 JSON。

const LATTICE_VIGNETTE_KEY = 'lattice_vignette';
const LATTICE_AUTO_FOCUS_ON_SONG_CHANGE_KEY = 'lattice_auto_focus_on_song_change';
const LATTICE_LIGHTS_ON_KEY = 'lattice_lights_on';
const LATTICE_POSTER_TINT_ENABLED_KEY = 'lattice_poster_tint_enabled';
const LATTICE_POSTER_TINT_USE_CUSTOM_COLOR_KEY = 'lattice_poster_tint_use_custom_color';
const LATTICE_POSTER_TINT_COLOR_KEY = 'lattice_poster_tint_color';
const LATTICE_POSTER_TINT_INTENSITY_KEY = 'lattice_poster_tint_intensity';
const LATTICE_BADGE_CURRENT_ONLY_KEY = 'lattice_badge_current_only';
const WALL_TOOLS_QUEUE_ISLAND_OPEN_KEY = 'wall_tools_queue_island_open';
const DEFAULT_POSTER_TINT_COLOR = '#161419';

const clampPosterTintIntensity = (value: number) => Math.max(0, Math.min(1, value));
const normalizePosterTintColor = (value: string) => (
    /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : DEFAULT_POSTER_TINT_COLOR
);

const getStoredPosterTintIntensity = () => {
    const stored = Number(getStoredString(LATTICE_POSTER_TINT_INTENSITY_KEY, '0.5'));
    return Number.isFinite(stored) ? clampPosterTintIntensity(stored) : 0.5;
};

export type LatticeSettingsState = {
    latticeVignette: boolean;
    autoFocusOnSongChange: boolean;
    latticeLightsOn: boolean;
    latticePosterTintEnabled: boolean;
    latticePosterTintUseCustomColor: boolean;
    latticePosterTintColor: string;
    latticePosterTintIntensity: number;
    /**
     * 封面墙上只给正在播放的那首留序号角标（#930）：队列拼贴（Lattice）与 bravais 墙面上其他歌曲卡片的纯数字序号不画，
     * 歌单 / 文件夹等卡片的类型标签照旧。默认关（保持原样）。放在这个 store 里，两面墙读同一份。
     */
    latticeBadgeCurrentOnly: boolean;
    /**
     * 墙面工具面板（bravais 与 Lattice 共用）上方的队列浮岛上次是否展开着：下次打开面板时照旧。
     * 这是面板的开合状态，不是设置——不进外观导入导出，也不注册命令面板（完整的队列编辑已经有 Ctrl+P 的队列命令）。
     * 放在这个 store 里，bravais ↔ Lattice 交接时两面墙读同一份。
     */
    wallToolsQueueIslandOpen: boolean;
    handleToggleLatticeVignette: (enabled: boolean) => void;
    handleToggleAutoFocusOnSongChange: (enabled: boolean) => void;
    handleToggleLatticeLights: (enabled: boolean) => void;
    handleToggleLatticePosterTint: (enabled: boolean) => void;
    handleToggleLatticePosterTintCustomColor: (enabled: boolean) => void;
    handleSetLatticePosterTintColor: (color: string) => void;
    handleSetLatticePosterTintIntensity: (intensity: number) => void;
    handleToggleLatticeBadgeCurrentOnly: (enabled: boolean) => void;
    setWallToolsQueueIslandOpen: (open: boolean) => void;
};

export const useLatticeSettingsStore = create<LatticeSettingsState>(set => ({
    latticeVignette: getStoredBoolean(LATTICE_VIGNETTE_KEY, true),
    autoFocusOnSongChange: getStoredBoolean(LATTICE_AUTO_FOCUS_ON_SONG_CHANGE_KEY, true),
    latticeLightsOn: getStoredBoolean(LATTICE_LIGHTS_ON_KEY, true),
    latticePosterTintEnabled: getStoredBoolean(LATTICE_POSTER_TINT_ENABLED_KEY, true),
    latticePosterTintUseCustomColor: getStoredBoolean(LATTICE_POSTER_TINT_USE_CUSTOM_COLOR_KEY, false),
    latticePosterTintColor: normalizePosterTintColor(getStoredString(LATTICE_POSTER_TINT_COLOR_KEY, DEFAULT_POSTER_TINT_COLOR)),
    latticePosterTintIntensity: getStoredPosterTintIntensity(),
    latticeBadgeCurrentOnly: getStoredBoolean(LATTICE_BADGE_CURRENT_ONLY_KEY, false),
    wallToolsQueueIslandOpen: getStoredBoolean(WALL_TOOLS_QUEUE_ISLAND_OPEN_KEY, false),
    handleToggleLatticeVignette: (enabled) => {
        set({ latticeVignette: enabled });
        setStoredBoolean(LATTICE_VIGNETTE_KEY, enabled);
    },
    handleToggleAutoFocusOnSongChange: (enabled) => {
        set({ autoFocusOnSongChange: enabled });
        setStoredBoolean(LATTICE_AUTO_FOCUS_ON_SONG_CHANGE_KEY, enabled);
    },
    handleToggleLatticeLights: (enabled) => {
        set({ latticeLightsOn: enabled });
        setStoredBoolean(LATTICE_LIGHTS_ON_KEY, enabled);
    },
    handleToggleLatticePosterTint: (enabled) => {
        set({ latticePosterTintEnabled: enabled });
        setStoredBoolean(LATTICE_POSTER_TINT_ENABLED_KEY, enabled);
    },
    handleToggleLatticePosterTintCustomColor: (enabled) => {
        set({ latticePosterTintUseCustomColor: enabled });
        setStoredBoolean(LATTICE_POSTER_TINT_USE_CUSTOM_COLOR_KEY, enabled);
    },
    handleSetLatticePosterTintColor: (color) => {
        const normalized = normalizePosterTintColor(color);
        set({ latticePosterTintColor: normalized });
        if (typeof window !== 'undefined') localStorage.setItem(LATTICE_POSTER_TINT_COLOR_KEY, normalized);
    },
    handleSetLatticePosterTintIntensity: (intensity) => {
        const normalized = clampPosterTintIntensity(intensity);
        set({ latticePosterTintIntensity: normalized });
        if (typeof window !== 'undefined') localStorage.setItem(LATTICE_POSTER_TINT_INTENSITY_KEY, String(normalized));
    },
    handleToggleLatticeBadgeCurrentOnly: (enabled) => {
        set({ latticeBadgeCurrentOnly: enabled });
        setStoredBoolean(LATTICE_BADGE_CURRENT_ONLY_KEY, enabled);
    },
    setWallToolsQueueIslandOpen: (open) => {
        set({ wallToolsQueueIslandOpen: open });
        setStoredBoolean(WALL_TOOLS_QUEUE_ISLAND_OPEN_KEY, open);
    },
}));
