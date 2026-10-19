// src/stores/useDesktopSettingsStore.ts
// Desktop-shell behaviour: tray and taskbar, wallpaper mode, display-sleep and voice-input
// interlocks, launch target, and the experimental mod system switch.
//
// Split out of useSettingsUiStore.

import { create } from 'zustand';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';
import i18n from '../i18n/config';

export const MINIMIZE_TO_TRAY_STORAGE_KEY = 'minimize_to_tray';

// Mirrored from the main process's CLOSE_TO_TRAY, which the titlebar X (window-close IPC) consults.
export const CLOSE_TO_TRAY_STORAGE_KEY = 'close_to_tray';

export const VOICE_INPUT_PAUSE_STORAGE_KEY = 'voice_input_pause_enabled';

export const PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_STORAGE_KEY = 'prevent_display_sleep_during_playback';

export const MOD_SYSTEM_ENABLED_STORAGE_KEY = 'mod_system_enabled';

export const HIDE_TASKBAR_ICON_STORAGE_KEY = 'hide_taskbar_icon';

export const REMOTE_CONTROL_SKIP_TASKBAR_STORAGE_KEY = 'remote_control_skip_taskbar';

export const REMOTE_CONTROL_HIDE_TITLEBAR_STORAGE_KEY = 'remote_control_hide_titlebar';

export const REMOTE_CONTROL_CLICK_THROUGH_STORAGE_KEY = 'remote_control_click_through';

export const REMOTE_CONTROL_EXPAND_COVER_STORAGE_KEY = 'remote_control_expand_cover';

export const REMOTE_CONTROL_DRAG_BEYOND_EDGE_STORAGE_KEY = 'remote_control_drag_beyond_edge';

export const WALLPAPER_MODE_STORAGE_KEY = 'wallpaper_mode';

export const WALLPAPER_ENTRY_CONFIRMED_STORAGE_KEY = 'wallpaper_entry_confirmed';

// macOS-only: auto-hide the Dock while a wallpaper session is active. On by default (a bottom Dock
// is hidden automatically; the switch is the explicit override the main process honours).
export const WALLPAPER_MAC_AUTOHIDE_DOCK_STORAGE_KEY = 'wallpaper_mac_autohide_dock';

export const OPEN_PLAYER_ON_LAUNCH_STORAGE_KEY = 'open_player_on_launch';

export type DesktopSettingsState = {
    minimizeToTray: boolean;
    /** Close button hides the main window to the tray instead of quitting the app. */
    closeToTray: boolean;
    voiceInputPauseEnabled: boolean;
    preventDisplaySleepDuringPlayback: boolean;
    /**
     * Master switch for the experimental mod system. Off by default: while it is
     * off the main process loads no mod at all and the mod commands stay out of
     * the palette, so an unfinished apiVersion 1 is opt-in rather than ambient.
     */
    modSystemEnabled: boolean;
    hideTaskbarIcon: boolean;
    hideRemoteControlTaskbarIcon: boolean;
    /** Remote control window: never reveal the top floating window-control bar. */
    hideRemoteControlTitlebar: boolean;
    /** Remote control window ignores the mouse (main process owns it; unlock from tray / palette). */
    remoteControlClickThrough: boolean;
    /** Remote control window: when idle, the cover opens into the large sleeve. On by default. */
    remoteControlExpandCover: boolean;
    /** Remote control window: in use, the card counts as the edge instead of the whole window, so it
     *  can be dragged to the screen's left edge. On by default. */
    remoteControlDragBeyondEdge: boolean;
    wallpaperMode: boolean;
    /** Persisted: the one-time entry explanation has been accepted, so later entries go straight in. */
    wallpaperEntryConfirmed: boolean;
    /** Transient (never persisted): the "enter wallpaper mode?" confirmation is on screen. */
    wallpaperEntryConfirmOpen: boolean;
    /** macOS-only: auto-hide the Dock while wallpaper mode is active. On by default — a bottom Dock
     *  is hidden automatically; switching it off overrides the automatic rule. */
    wallpaperMacAutohideDock: boolean;
    openPlayerOnLaunch: boolean;
    /** Transient (never persisted), from the main process: false on native Wayland, where always-on-top is silently ignored. */
    windowAlwaysOnTopSupported: boolean;
    setDesktopPreferenceSnapshot: (settings: { MINIMIZE_TO_TRAY?: unknown; CLOSE_TO_TRAY?: unknown; HIDE_TASKBAR_ICON?: unknown; REMOTE_CONTROL_SKIP_TASKBAR?: unknown; REMOTE_CONTROL_HIDE_TITLEBAR?: unknown; REMOTE_CONTROL_CLICK_THROUGH?: unknown; REMOTE_CONTROL_EXPAND_COVER?: unknown; REMOTE_CONTROL_DRAG_BEYOND_EDGE?: unknown; VOICE_INPUT_PAUSE_ENABLED?: unknown; PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK?: unknown; MOD_SYSTEM_ENABLED?: unknown; wallpaper_mode?: unknown; wallpaper_entry_confirmed?: unknown; wallpaper_mac_autohide_dock?: unknown; window_always_on_top_supported?: unknown; }) => void;
    handleToggleMinimizeToTray: (enable: boolean) => void;
    handleToggleCloseToTray: (enable: boolean) => void;
    handleToggleVoiceInputPause: (enable: boolean) => void;
    handleToggleModSystem: (enable: boolean) => void;
    handleTogglePreventDisplaySleepDuringPlayback: (enable: boolean) => void;
    handleToggleHideTaskbarIcon: (enable: boolean) => void;
    handleToggleHideRemoteControlTaskbarIcon: (enable: boolean) => void;
    handleToggleHideRemoteControlTitlebar: (enable: boolean) => void;
    handleToggleRemoteControlClickThrough: (enable: boolean) => void;
    handleToggleRemoteControlDragBeyondEdge: (enable: boolean) => void;
    handleToggleRemoteControlExpandCover: (enable: boolean) => void;
    /**
     * The user-facing wallpaper switch (settings card, command palette, tray request). Leaving
     * applies at once; the first-ever entry opens the confirmation and waits for
     * confirmWallpaperEntry, later entries apply directly.
     */
    handleToggleWallpaperMode: (enable: boolean) => void;
    /** Unconfirmed apply. Only the confirmation and programmatic callers may use it. */
    applyWallpaperMode: (enable: boolean) => void;
    confirmWallpaperEntry: () => void;
    cancelWallpaperEntry: () => void;
    handleToggleWallpaperMacAutohideDock: (enable: boolean) => void;
    handleToggleOpenPlayerOnLaunch: (enable: boolean) => void;
};

export const useDesktopSettingsStore = create<DesktopSettingsState>((set, get) => ({
    minimizeToTray: getStoredBoolean(MINIMIZE_TO_TRAY_STORAGE_KEY, false),
    closeToTray: getStoredBoolean(CLOSE_TO_TRAY_STORAGE_KEY, false),
    voiceInputPauseEnabled: getStoredBoolean(VOICE_INPUT_PAUSE_STORAGE_KEY, false),
    preventDisplaySleepDuringPlayback: getStoredBoolean(PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_STORAGE_KEY, false),
    modSystemEnabled: getStoredBoolean(MOD_SYSTEM_ENABLED_STORAGE_KEY, false),
    hideTaskbarIcon: getStoredBoolean(HIDE_TASKBAR_ICON_STORAGE_KEY, false),
    hideRemoteControlTaskbarIcon: getStoredBoolean(REMOTE_CONTROL_SKIP_TASKBAR_STORAGE_KEY, false),
    hideRemoteControlTitlebar: getStoredBoolean(REMOTE_CONTROL_HIDE_TITLEBAR_STORAGE_KEY, false),
    remoteControlClickThrough: getStoredBoolean(REMOTE_CONTROL_CLICK_THROUGH_STORAGE_KEY, false),
    remoteControlExpandCover: getStoredBoolean(REMOTE_CONTROL_EXPAND_COVER_STORAGE_KEY, true),
    remoteControlDragBeyondEdge: getStoredBoolean(REMOTE_CONTROL_DRAG_BEYOND_EDGE_STORAGE_KEY, true),
    wallpaperMode: getStoredBoolean(WALLPAPER_MODE_STORAGE_KEY, false),
    wallpaperEntryConfirmed: getStoredBoolean(WALLPAPER_ENTRY_CONFIRMED_STORAGE_KEY, false),
    wallpaperEntryConfirmOpen: false,
    wallpaperMacAutohideDock: getStoredBoolean(WALLPAPER_MAC_AUTOHIDE_DOCK_STORAGE_KEY, true),
    openPlayerOnLaunch: getStoredBoolean(OPEN_PLAYER_ON_LAUNCH_STORAGE_KEY, false),
    windowAlwaysOnTopSupported: true,
    setDesktopPreferenceSnapshot: (settings) => {
        const patch: Partial<DesktopSettingsState> = {};
        if (typeof settings.MINIMIZE_TO_TRAY === 'boolean') {
            patch.minimizeToTray = settings.MINIMIZE_TO_TRAY;
            setStoredBoolean(MINIMIZE_TO_TRAY_STORAGE_KEY, settings.MINIMIZE_TO_TRAY);
        }
        if (typeof settings.CLOSE_TO_TRAY === 'boolean') {
            patch.closeToTray = settings.CLOSE_TO_TRAY;
            setStoredBoolean(CLOSE_TO_TRAY_STORAGE_KEY, settings.CLOSE_TO_TRAY);
        }
        if (typeof settings.VOICE_INPUT_PAUSE_ENABLED === 'boolean') {
            patch.voiceInputPauseEnabled = settings.VOICE_INPUT_PAUSE_ENABLED;
            setStoredBoolean(VOICE_INPUT_PAUSE_STORAGE_KEY, settings.VOICE_INPUT_PAUSE_ENABLED);
        }
        if (typeof settings.PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK === 'boolean') {
            patch.preventDisplaySleepDuringPlayback = settings.PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK;
            setStoredBoolean(PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_STORAGE_KEY, settings.PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK);
        }
        if (typeof settings.MOD_SYSTEM_ENABLED === 'boolean') {
            patch.modSystemEnabled = settings.MOD_SYSTEM_ENABLED;
            setStoredBoolean(MOD_SYSTEM_ENABLED_STORAGE_KEY, settings.MOD_SYSTEM_ENABLED);
        }
        if (typeof settings.HIDE_TASKBAR_ICON === 'boolean') {
            patch.hideTaskbarIcon = settings.HIDE_TASKBAR_ICON;
            setStoredBoolean(HIDE_TASKBAR_ICON_STORAGE_KEY, settings.HIDE_TASKBAR_ICON);
        }
        if (typeof settings.REMOTE_CONTROL_SKIP_TASKBAR === 'boolean') {
            patch.hideRemoteControlTaskbarIcon = settings.REMOTE_CONTROL_SKIP_TASKBAR;
            setStoredBoolean(REMOTE_CONTROL_SKIP_TASKBAR_STORAGE_KEY, settings.REMOTE_CONTROL_SKIP_TASKBAR);
        }
        if (typeof settings.REMOTE_CONTROL_HIDE_TITLEBAR === 'boolean') {
            patch.hideRemoteControlTitlebar = settings.REMOTE_CONTROL_HIDE_TITLEBAR;
            setStoredBoolean(REMOTE_CONTROL_HIDE_TITLEBAR_STORAGE_KEY, settings.REMOTE_CONTROL_HIDE_TITLEBAR);
        }
        if (typeof settings.REMOTE_CONTROL_CLICK_THROUGH === 'boolean') {
            patch.remoteControlClickThrough = settings.REMOTE_CONTROL_CLICK_THROUGH;
            setStoredBoolean(REMOTE_CONTROL_CLICK_THROUGH_STORAGE_KEY, settings.REMOTE_CONTROL_CLICK_THROUGH);
        }
        if (typeof settings.REMOTE_CONTROL_EXPAND_COVER === 'boolean') {
            patch.remoteControlExpandCover = settings.REMOTE_CONTROL_EXPAND_COVER;
            setStoredBoolean(REMOTE_CONTROL_EXPAND_COVER_STORAGE_KEY, settings.REMOTE_CONTROL_EXPAND_COVER);
        }
        if (typeof settings.REMOTE_CONTROL_DRAG_BEYOND_EDGE === 'boolean') {
            patch.remoteControlDragBeyondEdge = settings.REMOTE_CONTROL_DRAG_BEYOND_EDGE;
            setStoredBoolean(REMOTE_CONTROL_DRAG_BEYOND_EDGE_STORAGE_KEY, settings.REMOTE_CONTROL_DRAG_BEYOND_EDGE);
        }
        if (typeof settings.wallpaper_mode === 'boolean') {
            patch.wallpaperMode = settings.wallpaper_mode;
            setStoredBoolean(WALLPAPER_MODE_STORAGE_KEY, settings.wallpaper_mode);
        }
        if (typeof settings.wallpaper_entry_confirmed === 'boolean') {
            const confirmed = get().wallpaperEntryConfirmed || settings.wallpaper_entry_confirmed;
            patch.wallpaperEntryConfirmed = confirmed;
            setStoredBoolean(WALLPAPER_ENTRY_CONFIRMED_STORAGE_KEY, confirmed);
        }
        if (typeof settings.wallpaper_mac_autohide_dock === 'boolean') {
            patch.wallpaperMacAutohideDock = settings.wallpaper_mac_autohide_dock;
            setStoredBoolean(WALLPAPER_MAC_AUTOHIDE_DOCK_STORAGE_KEY, settings.wallpaper_mac_autohide_dock);
        }
        if (typeof settings.window_always_on_top_supported === 'boolean') {
            patch.windowAlwaysOnTopSupported = settings.window_always_on_top_supported;
        }
        set(patch);
    },
    handleToggleMinimizeToTray: (enable) => {
        setStoredBoolean(MINIMIZE_TO_TRAY_STORAGE_KEY, enable);
        set({ minimizeToTray: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('MINIMIZE_TO_TRAY', enable);
        }
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'minimizeToTray' : 'minimizeToTaskbar')),
        });
    },
    handleToggleCloseToTray: (enable) => {
        setStoredBoolean(CLOSE_TO_TRAY_STORAGE_KEY, enable);
        set({ closeToTray: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('CLOSE_TO_TRAY', enable);
        }
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'closeToTray' : 'closeToQuit')),
        });
    },
    handleToggleVoiceInputPause: (enable) => {
        setStoredBoolean(VOICE_INPUT_PAUSE_STORAGE_KEY, enable);
        set({ voiceInputPauseEnabled: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('VOICE_INPUT_PAUSE_ENABLED', enable);
        }
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'voiceInputPauseOn' : 'voiceInputPauseOff')),
        });
    },
    // The main process owns the authoritative value: it decides whether any mod
    // is loaded at all, so the switch is persisted there and only mirrored here.
    handleToggleModSystem: (enable) => {
        setStoredBoolean(MOD_SYSTEM_ENABLED_STORAGE_KEY, enable);
        set({ modSystemEnabled: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('MOD_SYSTEM_ENABLED', enable);
        }
    },
    handleTogglePreventDisplaySleepDuringPlayback: (enable) => {
        setStoredBoolean(PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK_STORAGE_KEY, enable);
        set({ preventDisplaySleepDuringPlayback: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK', enable);
        }
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'preventDisplaySleepOn' : 'preventDisplaySleepOff')),
        });
    },
    handleToggleHideTaskbarIcon: (enable) => {
        setStoredBoolean(HIDE_TASKBAR_ICON_STORAGE_KEY, enable);
        set({ hideTaskbarIcon: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('HIDE_TASKBAR_ICON', enable);
        }
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'taskbarHidden' : 'taskbarRestored')),
        });
    },
    handleToggleHideRemoteControlTaskbarIcon: (enable) => {
        setStoredBoolean(REMOTE_CONTROL_SKIP_TASKBAR_STORAGE_KEY, enable);
        set({ hideRemoteControlTaskbarIcon: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('REMOTE_CONTROL_SKIP_TASKBAR', enable);
        }
    },
    handleToggleHideRemoteControlTitlebar: (enable) => {
        setStoredBoolean(REMOTE_CONTROL_HIDE_TITLEBAR_STORAGE_KEY, enable);
        set({ hideRemoteControlTitlebar: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('REMOTE_CONTROL_HIDE_TITLEBAR', enable);
        }
    },
    handleToggleRemoteControlClickThrough: (enable) => {
        setStoredBoolean(REMOTE_CONTROL_CLICK_THROUGH_STORAGE_KEY, enable);
        set({ remoteControlClickThrough: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('REMOTE_CONTROL_CLICK_THROUGH', enable);
        }
    },
    handleToggleRemoteControlExpandCover: (enable) => {
        setStoredBoolean(REMOTE_CONTROL_EXPAND_COVER_STORAGE_KEY, enable);
        set({ remoteControlExpandCover: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('REMOTE_CONTROL_EXPAND_COVER', enable);
        }
    },
    handleToggleRemoteControlDragBeyondEdge: (enable) => {
        setStoredBoolean(REMOTE_CONTROL_DRAG_BEYOND_EDGE_STORAGE_KEY, enable);
        set({ remoteControlDragBeyondEdge: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings('REMOTE_CONTROL_DRAG_BEYOND_EDGE', enable);
        }
    },
    handleToggleWallpaperMode: (enable) => {
        // Entering sinks the window under the desktop and takes the keyboard away, so the first
        // entry asks first. Startup restore never lands here: it arrives through
        // setDesktopPreferenceSnapshot. Cancelling does not consume the warning.
        if (enable && !get().wallpaperMode && !get().wallpaperEntryConfirmed) {
            set({ wallpaperEntryConfirmOpen: true });
            return;
        }
        get().applyWallpaperMode(enable);
    },
    confirmWallpaperEntry: () => {
        // The dialog's buttons stay clickable during its exit animation: a second click, or a
        // Confirm after Cancel, must not apply (or re-apply) the entry.
        if (!get().wallpaperEntryConfirmOpen) {
            return;
        }
        set({ wallpaperEntryConfirmOpen: false });
        get().applyWallpaperMode(true);
    },
    cancelWallpaperEntry: () => {
        set({ wallpaperEntryConfirmOpen: false });
    },
    applyWallpaperMode: (enable) => {
        setStoredBoolean(WALLPAPER_MODE_STORAGE_KEY, enable);
        set({ wallpaperMode: enable });
        if (enable) {
            setStoredBoolean(WALLPAPER_ENTRY_CONFIRMED_STORAGE_KEY, true);
            set({ wallpaperEntryConfirmed: true });
            if (window.electron?.saveSettings) {
                void window.electron.saveSettings('wallpaper_entry_confirmed', true);
            }
        }
        if (window.electron?.saveSettings) {
            // The main process schedules a full relaunch after this IPC returns.
            void window.electron.saveSettings('wallpaper_mode', enable);
        }
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'wallpaperModeOn' : 'wallpaperModeOff')),
        });
    },
    // macOS-only: explicit override for the position-aware Dock auto-hide. The main process applies
    // it live on an already-active wallpaper session; otherwise it takes effect on the next entry.
    handleToggleWallpaperMacAutohideDock: (enable) => {
        setStoredBoolean(WALLPAPER_MAC_AUTOHIDE_DOCK_STORAGE_KEY, enable);
        set({ wallpaperMacAutohideDock: enable });
        if (window.electron?.saveSettings) {
            void window.electron.saveSettings(WALLPAPER_MAC_AUTOHIDE_DOCK_STORAGE_KEY, enable);
        }
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'macWallpaperAutohideDockOn' : 'macWallpaperAutohideDockOff')),
        });
    },
    handleToggleOpenPlayerOnLaunch: (enable) => {
        setStoredBoolean(OPEN_PLAYER_ON_LAUNCH_STORAGE_KEY, enable);
        set({ openPlayerOnLaunch: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'openPlayerOnLaunch' : 'openHomeOnLaunch')),
        });
    },
}));

/**
 * The DesktopSettings half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectDesktopSettingsSnapshot = (state: DesktopSettingsState) => ({
    minimizeToTray: state.minimizeToTray,
    closeToTray: state.closeToTray,
    voiceInputPauseEnabled: state.voiceInputPauseEnabled,
    preventDisplaySleepDuringPlayback: state.preventDisplaySleepDuringPlayback,
    modSystemEnabled: state.modSystemEnabled,
    hideTaskbarIcon: state.hideTaskbarIcon,
    hideRemoteControlTaskbarIcon: state.hideRemoteControlTaskbarIcon,
    hideRemoteControlTitlebar: state.hideRemoteControlTitlebar,
    remoteControlClickThrough: state.remoteControlClickThrough,
    remoteControlExpandCover: state.remoteControlExpandCover,
    remoteControlDragBeyondEdge: state.remoteControlDragBeyondEdge,
    wallpaperMode: state.wallpaperMode,
    wallpaperMacAutohideDock: state.wallpaperMacAutohideDock,
    openPlayerOnLaunch: state.openPlayerOnLaunch,
    handleToggleMinimizeToTray: state.handleToggleMinimizeToTray,
    handleToggleCloseToTray: state.handleToggleCloseToTray,
    handleToggleVoiceInputPause: state.handleToggleVoiceInputPause,
    handleToggleModSystem: state.handleToggleModSystem,
    handleTogglePreventDisplaySleepDuringPlayback: state.handleTogglePreventDisplaySleepDuringPlayback,
    handleToggleHideTaskbarIcon: state.handleToggleHideTaskbarIcon,
    handleToggleHideRemoteControlTaskbarIcon: state.handleToggleHideRemoteControlTaskbarIcon,
    handleToggleHideRemoteControlTitlebar: state.handleToggleHideRemoteControlTitlebar,
    handleToggleRemoteControlClickThrough: state.handleToggleRemoteControlClickThrough,
    handleToggleRemoteControlDragBeyondEdge: state.handleToggleRemoteControlDragBeyondEdge,
    handleToggleRemoteControlExpandCover: state.handleToggleRemoteControlExpandCover,
    handleToggleWallpaperMode: state.handleToggleWallpaperMode,
    handleToggleWallpaperMacAutohideDock: state.handleToggleWallpaperMacAutohideDock,
    handleToggleOpenPlayerOnLaunch: state.handleToggleOpenPlayerOnLaunch,
    setDesktopPreferenceSnapshot: state.setDesktopPreferenceSnapshot,
});
