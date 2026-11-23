// src/stores/usePlayerChromeSettingsStore.ts
// What the player page shows around the lyrics: the progress bar, the back and track-switch
// buttons, the titlebar, the transparent background and the auto-hide behaviour.
//
// Split out of useSettingsUiStore.
//
// @note 这里除 player_header_blur 以外的设置（播放页控件、标题栏、鼠标指针、透明背景、系统材质）是用户明确决定
// 「不进外观配置导入导出」的（2026-11-08）：配置码也用于 web 版 OBS 链接，只加 OBS 页面看得到的，
// OBS 页面隐藏了这些控件。不要按 settings-feature-integration「视觉设置必须进
// buildCurrentConfig / compressConfig / decompressConfig / validKeys / handleImportConfig」的规则把它们补进短码或 JSON。

import { create } from 'zustand';
import i18n from '../i18n/config';
import {
    DEFAULT_CAPSULE_ISLAND,
    DEFAULT_PLAYER_CONTROL_SLOT_PRIMARY,
    DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY,
    isPlayerControlSlotActionId,
    normalizeCapsuleIsland,
    placePlayerControl,
    type PlayerControlLayout,
    type PlayerControlSlotActionId,
} from '../types/playerControlSlots';
import { NATIVE_BLUR_SUPPORTED } from '../utils/nativeBlurSupport';
import { PLAYER_BOTTOM_BAR_BASE_OFFSET_PX } from '../utils/playerBottomBarLayout';
import { getStoredBoolean, setStoredBoolean, getStoredString, readStoredString, setStoredString } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';

const PLAYER_BOTTOM_BAR_OFFSET_STORAGE_KEY = 'player_bottom_bar_offset';
const PLAYER_CONTROL_SLOT_PRIMARY_STORAGE_KEY = 'player_control_slot_primary';
const PLAYER_CONTROL_SLOT_SECONDARY_STORAGE_KEY = 'player_control_slot_secondary';
const PLAYER_CAPSULE_ISLAND_STORAGE_KEY = 'player_capsule_island';

/** All platforms default to the right; explicit choices are kept and malformed values ignored. */
const readTitlebarSide = (): 'left' | 'right' => {
    const fallback = 'right';
    const value = getStoredString('window_titlebar_side', fallback);
    return value === 'left' || value === 'right' ? value : fallback;
};

/** Reads the persisted lower-bounded offset; the viewport-dependent upper bound is applied by consumers. */
const readStoredPlayerBottomBarOffset = (): number => {
    if (typeof window === 'undefined') {
        return PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
    }

    const parsed = parseFloat(localStorage.getItem(PLAYER_BOTTOM_BAR_OFFSET_STORAGE_KEY) ?? '');
    if (!Number.isFinite(parsed)) {
        return PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
    }

    return Math.max(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, Math.round(parsed));
};

const readStoredPlayerControlSlot = (
    key: string,
    fallback: PlayerControlSlotActionId,
): PlayerControlSlotActionId => {
    if (typeof window === 'undefined') {
        return fallback;
    }

    const saved = localStorage.getItem(key);
    return isPlayerControlSlotActionId(saved) ? saved : fallback;
};

/** 浮岛清单（JSON 数组）；没存过、坏了都用默认。槽位里已有的去掉。 */
const readStoredCapsuleIsland = (slots: readonly PlayerControlSlotActionId[]): PlayerControlSlotActionId[] => {
    const raw = readStoredString(PLAYER_CAPSULE_ISLAND_STORAGE_KEY);
    if (raw === null) {
        return normalizeCapsuleIsland(DEFAULT_CAPSULE_ISLAND, slots);
    }
    try {
        return normalizeCapsuleIsland(JSON.parse(raw), slots);
    } catch {
        return normalizeCapsuleIsland(DEFAULT_CAPSULE_ISLAND, slots);
    }
};

const writeStoredPlayerControlLayout = (layout: PlayerControlLayout) => {
    setStoredString(PLAYER_CONTROL_SLOT_PRIMARY_STORAGE_KEY, layout.primary);
    setStoredString(PLAYER_CONTROL_SLOT_SECONDARY_STORAGE_KEY, layout.secondary);
    setStoredString(PLAYER_CAPSULE_ISLAND_STORAGE_KEY, JSON.stringify(layout.island));
};

const initialSlotPrimary = readStoredPlayerControlSlot(
    PLAYER_CONTROL_SLOT_PRIMARY_STORAGE_KEY,
    DEFAULT_PLAYER_CONTROL_SLOT_PRIMARY,
);
// 两个槽位存成同一个（旧版本手改过存储）时，右边那个回到默认，不让一个控件出现两次。
const storedSlotSecondary = readStoredPlayerControlSlot(
    PLAYER_CONTROL_SLOT_SECONDARY_STORAGE_KEY,
    DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY,
);
const initialSlotSecondary = storedSlotSecondary !== initialSlotPrimary
    ? storedSlotSecondary
    : initialSlotPrimary === DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY ? DEFAULT_PLAYER_CONTROL_SLOT_PRIMARY : DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY;

export type PlayerChromeSettingsState = {
    hidePlayerProgressBar: boolean;
    /** A small notch in the progress bar where the chorus starts, for lyrics whose source marked it. */
    progressBarChorusMarker: boolean;
    playerBottomBarOffset: number;
    playerControlSlotPrimary: PlayerControlSlotActionId;
    playerControlSlotSecondary: PlayerControlSlotActionId;
    /** 指针停在胶囊上浮出的那一排，按用户摆的顺序（不含两个槽位里的）。 */
    playerCapsuleIsland: readonly PlayerControlSlotActionId[];
    hidePlayerRightPanelButton: boolean;
    alwaysShowPlayerBackButton: boolean;
    alwaysShowTrackSwitchButtons: boolean;
    alwaysShowMainWindowTitlebar: boolean;
    /** A frosted bar behind the window titlebar on the player page, so its buttons read over any picture. */
    playerHeaderBlur: boolean;
    titlebarSide: 'left' | 'right';
    handleSetTitlebarSide: (side: 'left' | 'right') => void;
    hideFullscreenButton: boolean;
    useNativeMacFullscreenButton: boolean;
    useNativeMacTrafficLights: boolean;
    transparentPlayerBackground: boolean;
    enablePlayerPageNativeBlur: boolean;
    autoHidePlayerChrome: boolean;
    autoHideCursorWithPlayerChrome: boolean;
    hideCursorWhenIdle: boolean;
    showOpenPanelCloseButton: boolean;
    setTransparentPlayerBackgroundFromSystem: (enabled: boolean) => void;
    handleTogglePlayerPageNativeBlur: (enable: boolean) => void;
    handleToggleHidePlayerProgressBar: (enable: boolean) => void;
    handleToggleProgressBarChorusMarker: (enable: boolean) => void;
    handleSetPlayerBottomBarOffset: (offsetPx: number) => void;
    /** 放进一个槽位；原来的那个和它互换位置（它从另一个槽位、从浮岛来时），从池子里来的则把原来的换回池子。 */
    handleSetPlayerControlSlot: (slot: 'primary' | 'secondary', actionId: PlayerControlSlotActionId) => void;
    /** 两个槽位和浮岛一次换成这个样子（设置里的摆放编辑器）。 */
    handleSetPlayerControlLayout: (layout: PlayerControlLayout) => void;
    handleResetPlayerControlLayout: () => void;
    handleToggleHidePlayerRightPanelButton: (enable: boolean) => void;
    handleToggleAlwaysShowPlayerBackButton: (enable: boolean) => void;
    handleToggleAlwaysShowTrackSwitchButtons: (enable: boolean) => void;
    handleToggleAlwaysShowMainWindowTitlebar: (enable: boolean) => void;
    handleTogglePlayerHeaderBlur: (enable: boolean) => void;
    handleToggleHideFullscreenButton: (enable: boolean) => void;
    handleToggleNativeMacFullscreenButton: (enable: boolean) => void;
    handleToggleNativeMacTrafficLights: (enable: boolean) => void;
    handleToggleTransparentPlayerBackground: (enable: boolean) => void;
    handleWallpaperTransparentRefused: () => void;
    handleToggleAutoHidePlayerChrome: (enable: boolean) => void;
    handleToggleAutoHideCursorWithPlayerChrome: (enable: boolean) => void;
    handleToggleHideCursorWhenIdle: (enable: boolean) => void;
    handleToggleOpenPanelCloseButton: (enable: boolean) => void;
};

export const usePlayerChromeSettingsStore = create<PlayerChromeSettingsState>((set, get) => ({
    hidePlayerProgressBar: getStoredBoolean('hide_player_progress_bar', false),
    progressBarChorusMarker: getStoredBoolean('progress_bar_chorus_marker', true),
    playerBottomBarOffset: readStoredPlayerBottomBarOffset(),
    playerControlSlotPrimary: initialSlotPrimary,
    playerControlSlotSecondary: initialSlotSecondary,
    playerCapsuleIsland: readStoredCapsuleIsland([initialSlotPrimary, initialSlotSecondary]),
    hidePlayerRightPanelButton: getStoredBoolean('hide_player_right_panel_button', false),
    alwaysShowPlayerBackButton: getStoredBoolean('always_show_player_back_button', false),
    alwaysShowTrackSwitchButtons: getStoredBoolean('always_show_track_switch_buttons', false),
    alwaysShowMainWindowTitlebar: getStoredBoolean('always_show_main_window_titlebar', false),
    playerHeaderBlur: getStoredBoolean('player_header_blur', false),
    titlebarSide: readTitlebarSide(),
    handleSetTitlebarSide: (side) => {
        setStoredString('window_titlebar_side', side);
        set({ titlebarSide: side });
    },
    hideFullscreenButton: getStoredBoolean('hide_fullscreen_button', false),
    useNativeMacFullscreenButton: getStoredBoolean('use_native_mac_fullscreen_button', false),
    useNativeMacTrafficLights: getStoredBoolean('use_native_mac_traffic_lights', false),
    transparentPlayerBackground: getStoredBoolean('transparent_player_background', false),
    // A stored "on" from a system that cannot draw it (e.g. a profile carried over to Windows 10) reads as off.
    enablePlayerPageNativeBlur: NATIVE_BLUR_SUPPORTED && getStoredBoolean('enable_player_page_native_blur', false),
    autoHidePlayerChrome: getStoredBoolean('auto_hide_player_chrome', false),
    // Rides the chrome auto-hide clock rather than owning one: the cursor goes away with the
    // controls it would have clicked. Opt-out, so auto-hide can keep the pointer if wanted.
    autoHideCursorWithPlayerChrome: getStoredBoolean('auto_hide_cursor_with_player_chrome', true),
    hideCursorWhenIdle: getStoredBoolean('hide_cursor_when_idle', false),
    showOpenPanelCloseButton: getStoredBoolean('show_open_panel_close_button', true),
    setTransparentPlayerBackgroundFromSystem: (enabled) => {
        setStoredBoolean('transparent_player_background', enabled);
        set({ transparentPlayerBackground: enabled });
    },
    handleTogglePlayerPageNativeBlur: (enable) => {
        if (enable && !NATIVE_BLUR_SUPPORTED) return;
        setStoredBoolean('enable_player_page_native_blur', enable);
        set({ enablePlayerPageNativeBlur: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('enable_player_page_native_blur', enable);
        }
    },
    handleToggleAutoHidePlayerChrome: (enabled: boolean) => {
        localStorage.setItem('auto_hide_player_chrome', enabled ? 'true' : 'false');
        set({ autoHidePlayerChrome: enabled });
    },
    handleToggleAutoHideCursorWithPlayerChrome: (enable) => {
        setStoredBoolean('auto_hide_cursor_with_player_chrome', enable);
        set({ autoHideCursorWithPlayerChrome: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'cursorAutoHideOn' : 'cursorAutoHideOff')),
        });
    },
    handleToggleHideCursorWhenIdle: (enable) => {
        setStoredBoolean('hide_cursor_when_idle', enable);
        set({ hideCursorWhenIdle: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'cursorIdleHideOn' : 'cursorIdleHideOff')),
        });
    },
    handleToggleHidePlayerProgressBar: (enable) => {
        setStoredBoolean('hide_player_progress_bar', enable);
        set({ hidePlayerProgressBar: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'progressBarHidden' : 'progressBarShown')),
        });
    },
    handleToggleProgressBarChorusMarker: (enable) => {
        setStoredBoolean('progress_bar_chorus_marker', enable);
        set({ progressBarChorusMarker: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'progressBarChorusMarkerOn' : 'progressBarChorusMarkerOff')),
        });
    },
    handleSetPlayerBottomBarOffset: (offsetPx) => {
        const next = Number.isFinite(offsetPx)
            ? Math.max(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, Math.round(offsetPx))
            : PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
        if (typeof window !== 'undefined') {
            localStorage.setItem(PLAYER_BOTTOM_BAR_OFFSET_STORAGE_KEY, String(next));
        }
        set({ playerBottomBarOffset: next });
    },
    handleSetPlayerControlSlot: (slot, actionId) => {
        if (!isPlayerControlSlotActionId(actionId)) {
            return;
        }
        const state = get();
        const next = placePlayerControl({
            primary: state.playerControlSlotPrimary,
            secondary: state.playerControlSlotSecondary,
            island: state.playerCapsuleIsland,
        }, actionId, { kind: 'slot', slot });
        if (next) {
            get().handleSetPlayerControlLayout(next);
        }
    },
    handleSetPlayerControlLayout: (layout) => {
        if (!isPlayerControlSlotActionId(layout.primary) || !isPlayerControlSlotActionId(layout.secondary)
            || layout.primary === layout.secondary) {
            return;
        }
        const next: PlayerControlLayout = {
            primary: layout.primary,
            secondary: layout.secondary,
            island: normalizeCapsuleIsland(layout.island, [layout.primary, layout.secondary]),
        };
        writeStoredPlayerControlLayout(next);
        set({
            playerControlSlotPrimary: next.primary,
            playerControlSlotSecondary: next.secondary,
            playerCapsuleIsland: next.island,
        });
    },
    handleResetPlayerControlLayout: () => {
        get().handleSetPlayerControlLayout({
            primary: DEFAULT_PLAYER_CONTROL_SLOT_PRIMARY,
            secondary: DEFAULT_PLAYER_CONTROL_SLOT_SECONDARY,
            island: DEFAULT_CAPSULE_ISLAND,
        });
    },
    handleToggleAlwaysShowPlayerBackButton: (enable) => {
        setStoredBoolean('always_show_player_back_button', enable);
        set({ alwaysShowPlayerBackButton: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'playerBackButtonAlwaysShown' : 'playerBackButtonAutoHidden')),
        });
    },
    handleToggleAlwaysShowTrackSwitchButtons: (enable) => {
        setStoredBoolean('always_show_track_switch_buttons', enable);
        set({ alwaysShowTrackSwitchButtons: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'trackSwitchButtonsAlwaysShown' : 'trackSwitchButtonsAutoHidden')),
        });
    },
    handleToggleAlwaysShowMainWindowTitlebar: (enable) => {
        setStoredBoolean('always_show_main_window_titlebar', enable);
        set({ alwaysShowMainWindowTitlebar: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'mainWindowTitlebarAlwaysShown' : 'mainWindowTitlebarAutoHidden')),
        });
    },
    handleTogglePlayerHeaderBlur: (enable) => {
        setStoredBoolean('player_header_blur', enable);
        set({ playerHeaderBlur: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'playerHeaderBlurOn' : 'playerHeaderBlurOff')),
        });
    },
    handleToggleHideFullscreenButton: (enable) => {
        setStoredBoolean('hide_fullscreen_button', enable);
        set({ hideFullscreenButton: enable });
    },
    handleToggleNativeMacFullscreenButton: (enable) => {
        setStoredBoolean('use_native_mac_fullscreen_button', enable);
        set({ useNativeMacFullscreenButton: enable });
    },
    handleToggleNativeMacTrafficLights: (enable) => {
        setStoredBoolean('use_native_mac_traffic_lights', enable);
        set({ useNativeMacTrafficLights: enable });
        // The titlebar style is a window-creation option: the switch lands in the main process
        // store and the new value is read the next time the main window is built.
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('USE_NATIVE_MAC_TRAFFIC_LIGHTS', enable);
        }
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.restartToApplyWindowChrome'),
        });
    },
    handleToggleHidePlayerRightPanelButton: (enable) => {
        setStoredBoolean('hide_player_right_panel_button', enable);
        set({ hidePlayerRightPanelButton: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'rightBtnHidden' : 'rightBtnShown')),
        });
    },
    handleToggleTransparentPlayerBackground: (enable) => {
        setStoredBoolean('transparent_player_background', enable);
        set({ transparentPlayerBackground: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'transparentBgOn' : 'transparentBgOff')),
        });
    },
    // Main-process guard fired the refusal (classic Windows wallpaper mode cannot present a
    // transparent wallpaper window): surface why the toggle did not take effect.
    handleWallpaperTransparentRefused: () => {
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.transparentBgWallpaperUnsupported'),
        });
    },
    handleToggleOpenPanelCloseButton: (enable) => {
        setStoredBoolean('show_open_panel_close_button', enable);
        set({ showOpenPanelCloseButton: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'panelCloseBtnShown' : 'panelCloseBtnHidden')),
        });
    },
}));

/**
 * The PlayerChromeSettings half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectPlayerChromeSettingsSnapshot = (state: PlayerChromeSettingsState) => ({
    hidePlayerProgressBar: state.hidePlayerProgressBar,
    progressBarChorusMarker: state.progressBarChorusMarker,
    playerBottomBarOffset: state.playerBottomBarOffset,
    playerControlSlotPrimary: state.playerControlSlotPrimary,
    playerControlSlotSecondary: state.playerControlSlotSecondary,
    playerCapsuleIsland: state.playerCapsuleIsland,
    hidePlayerRightPanelButton: state.hidePlayerRightPanelButton,
    alwaysShowPlayerBackButton: state.alwaysShowPlayerBackButton,
    alwaysShowTrackSwitchButtons: state.alwaysShowTrackSwitchButtons,
    alwaysShowMainWindowTitlebar: state.alwaysShowMainWindowTitlebar,
    playerHeaderBlur: state.playerHeaderBlur,
    titlebarSide: state.titlebarSide,
    handleSetTitlebarSide: state.handleSetTitlebarSide,
    hideFullscreenButton: state.hideFullscreenButton,
    useNativeMacFullscreenButton: state.useNativeMacFullscreenButton,
    useNativeMacTrafficLights: state.useNativeMacTrafficLights,
    handleToggleNativeMacTrafficLights: state.handleToggleNativeMacTrafficLights,
    transparentPlayerBackground: state.transparentPlayerBackground,
    enablePlayerPageNativeBlur: state.enablePlayerPageNativeBlur,
    autoHidePlayerChrome: state.autoHidePlayerChrome,
    autoHideCursorWithPlayerChrome: state.autoHideCursorWithPlayerChrome,
    hideCursorWhenIdle: state.hideCursorWhenIdle,
    showOpenPanelCloseButton: state.showOpenPanelCloseButton,
    handleToggleHidePlayerProgressBar: state.handleToggleHidePlayerProgressBar,
    handleToggleProgressBarChorusMarker: state.handleToggleProgressBarChorusMarker,
    handleSetPlayerBottomBarOffset: state.handleSetPlayerBottomBarOffset,
    handleSetPlayerControlSlot: state.handleSetPlayerControlSlot,
    handleSetPlayerControlLayout: state.handleSetPlayerControlLayout,
    handleResetPlayerControlLayout: state.handleResetPlayerControlLayout,
    handleToggleHidePlayerRightPanelButton: state.handleToggleHidePlayerRightPanelButton,
    handleToggleAlwaysShowPlayerBackButton: state.handleToggleAlwaysShowPlayerBackButton,
    handleToggleAlwaysShowTrackSwitchButtons: state.handleToggleAlwaysShowTrackSwitchButtons,
    handleToggleAlwaysShowMainWindowTitlebar: state.handleToggleAlwaysShowMainWindowTitlebar,
    handleTogglePlayerHeaderBlur: state.handleTogglePlayerHeaderBlur,
    handleToggleHideFullscreenButton: state.handleToggleHideFullscreenButton,
    handleToggleNativeMacFullscreenButton: state.handleToggleNativeMacFullscreenButton,
    handleToggleTransparentPlayerBackground: state.handleToggleTransparentPlayerBackground,
    setTransparentPlayerBackgroundFromSystem: state.setTransparentPlayerBackgroundFromSystem,
    handleTogglePlayerPageNativeBlur: state.handleTogglePlayerPageNativeBlur,
    handleToggleAutoHidePlayerChrome: state.handleToggleAutoHidePlayerChrome,
    handleToggleAutoHideCursorWithPlayerChrome: state.handleToggleAutoHideCursorWithPlayerChrome,
    handleToggleHideCursorWhenIdle: state.handleToggleHideCursorWhenIdle,
    handleToggleOpenPanelCloseButton: state.handleToggleOpenPanelCloseButton,
    handleWallpaperTransparentRefused: state.handleWallpaperTransparentRefused,
});
