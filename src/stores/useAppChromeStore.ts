import { create } from 'zustand';
import type React from 'react';
import { getStoredBoolean, setStoredBoolean } from './storagePrimitives';

// src/stores/useAppChromeStore.ts
// Runtime state of the window chrome: whether the titlebar is revealed, the transparent-window
// border, click-through and its hotspot, whether the player chrome is hidden, the panel guide
// hotspot, and the two developer overlays.
//
// Distinct from usePlayerChromeSettingsStore, which holds the persisted *preferences* about that
// chrome (always-show buttons, auto-hide, and so on). This store is what the chrome is doing right
// now. Only `isPlayerChromeHidden` outlives a session, and it keeps its original storage key.
//
// Split out of App.tsx, which owned all eight as useState and handed them down.

export const PLAYER_CHROME_HIDDEN_STORAGE_KEY = 'player_chrome_hidden';

type AppChromeState = {
    isTitlebarRevealed: boolean;
    /** 鼠标按在窗口控制按钮上（可能正在按住拖动）时为 true，期间标题栏不自动收起。 */
    isTitlebarHeld: boolean;
    showTransparentWindowBorder: boolean;
    isMainWindowClickThroughEnabled: boolean;
    isClickThroughToggleHotspotActive: boolean;
    isPlayerPanelGuideHotspotActive: boolean;
    /** Persisted: the listener's last choice of a bare lyrics page. */
    isPlayerChromeHidden: boolean;
    isDevDebugOverlayVisible: boolean;
    isMemoryMonitorVisible: boolean;

    setIsTitlebarRevealed: React.Dispatch<React.SetStateAction<boolean>>;
    setIsTitlebarHeld: React.Dispatch<React.SetStateAction<boolean>>;
    setShowTransparentWindowBorder: React.Dispatch<React.SetStateAction<boolean>>;
    setIsMainWindowClickThroughEnabled: React.Dispatch<React.SetStateAction<boolean>>;
    setIsClickThroughToggleHotspotActive: React.Dispatch<React.SetStateAction<boolean>>;
    setIsPlayerPanelGuideHotspotActive: React.Dispatch<React.SetStateAction<boolean>>;
    setIsPlayerChromeHidden: React.Dispatch<React.SetStateAction<boolean>>;
    setIsDevDebugOverlayVisible: React.Dispatch<React.SetStateAction<boolean>>;
    setIsMemoryMonitorVisible: React.Dispatch<React.SetStateAction<boolean>>;
};

/** Consumers pass the updater form (`setX(prev => !prev)`), so resolve it the way useState does. */
const resolve = (next: React.SetStateAction<boolean>, previous: boolean) => (
    typeof next === 'function' ? (next as (prev: boolean) => boolean)(previous) : next
);

export const useAppChromeStore = create<AppChromeState>((set, get) => ({
    isTitlebarRevealed: false,
    isTitlebarHeld: false,
    showTransparentWindowBorder: false,
    isMainWindowClickThroughEnabled: false,
    isClickThroughToggleHotspotActive: false,
    isPlayerPanelGuideHotspotActive: false,
    isPlayerChromeHidden: getStoredBoolean(PLAYER_CHROME_HIDDEN_STORAGE_KEY, false),
    isDevDebugOverlayVisible: false,
    isMemoryMonitorVisible: false,

    setIsTitlebarRevealed: (next) => set({ isTitlebarRevealed: resolve(next, get().isTitlebarRevealed) }),
    setIsTitlebarHeld: (next) => set({ isTitlebarHeld: resolve(next, get().isTitlebarHeld) }),
    setShowTransparentWindowBorder: (next) => set({ showTransparentWindowBorder: resolve(next, get().showTransparentWindowBorder) }),
    setIsMainWindowClickThroughEnabled: (next) => set({ isMainWindowClickThroughEnabled: resolve(next, get().isMainWindowClickThroughEnabled) }),
    setIsClickThroughToggleHotspotActive: (next) => set({ isClickThroughToggleHotspotActive: resolve(next, get().isClickThroughToggleHotspotActive) }),
    setIsPlayerPanelGuideHotspotActive: (next) => set({ isPlayerPanelGuideHotspotActive: resolve(next, get().isPlayerPanelGuideHotspotActive) }),
    // Written through on every change, the way App.tsx's effect used to.
    setIsPlayerChromeHidden: (next) => {
        const hidden = resolve(next, get().isPlayerChromeHidden);
        setStoredBoolean(PLAYER_CHROME_HIDDEN_STORAGE_KEY, hidden);
        set({ isPlayerChromeHidden: hidden });
    },
    setIsDevDebugOverlayVisible: (next) => set({ isDevDebugOverlayVisible: resolve(next, get().isDevDebugOverlayVisible) }),
    setIsMemoryMonitorVisible: (next) => set({ isMemoryMonitorVisible: resolve(next, get().isMemoryMonitorVisible) }),
}));

// Module-level handles for the assembly layer; actions need no subscription.
export const setIsDevDebugOverlayVisible: AppChromeState['setIsDevDebugOverlayVisible'] = (next) => useAppChromeStore.getState().setIsDevDebugOverlayVisible(next);
export const setIsMemoryMonitorVisible: AppChromeState['setIsMemoryMonitorVisible'] = (next) => useAppChromeStore.getState().setIsMemoryMonitorVisible(next);
