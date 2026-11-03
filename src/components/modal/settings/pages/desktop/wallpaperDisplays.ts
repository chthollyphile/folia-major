import { create } from 'zustand';

// src/components/modal/settings/pages/desktop/wallpaperDisplays.ts
// What the settings window knows about the displays wallpaper mode can use: the main process's
// answer (the connected displays, the stored choice, where the wallpaper is), kept in one place
// for the row that draws it and for the settings search, which asks whether that row is drawn
// before it lists it. The main process owns the choice and stores it; nothing is kept here
// between runs.

const useWallpaperDisplaysStore = create<{ state: ElectronWallpaperDisplaysState | null }>(() => ({ state: null }));

const bridge = () => (typeof window === 'undefined' ? undefined : window.electron);

/** Where wallpaper mode has a display to choose: Windows, macOS and Linux X11. On Wayland the compositor places the layer. */
const isOfferedHere = (): boolean => {
    const electron = bridge();
    if (!electron?.getWallpaperDisplays) {
        return false;
    }
    return electron.platform === 'win32' || electron.platform === 'darwin' || (electron.platform === 'linux' && electron.isLinuxX11);
};

const take = (state: ElectronWallpaperDisplaysState | null) => {
    if (state) {
        useWallpaperDisplaysStore.setState({ state });
    }
};

const warn = (error: unknown) => {
    console.warn('[Wallpaper] display list request failed:', error instanceof Error ? error.message : error);
};

let listening = false;

/** Asks the main process again: when this file loads, and when where the wallpaper is may have changed. */
export const refreshWallpaperDisplays = (): void => {
    const electron = bridge();
    if (!electron || !isOfferedHere()) {
        return;
    }
    if (!listening) {
        listening = true;
        electron.onWallpaperDisplaysChanged?.(take);
    }
    void electron.getWallpaperDisplays?.().then(take).catch(warn);
};

/** Chooses a connected display by its id, or automatic with null. A running wallpaper moves at once. */
export const chooseWallpaperDisplay = (displayId: number | null): void => {
    void bridge()?.setWallpaperDisplay?.(displayId).then(take).catch(warn);
};

/** Whether there is a choice to draw: more than one display, where wallpaper mode can use any of them. */
export const hasWallpaperDisplayChoice = (): boolean => (
    isOfferedHere() && (useWallpaperDisplaysStore.getState().state?.displays.length ?? 0) > 1
);

/** The main process's answer while there is a choice to draw, else null. */
export const useWallpaperDisplays = (): ElectronWallpaperDisplaysState | null => {
    const state = useWallpaperDisplaysStore(store => store.state);
    return state && state.displays.length > 1 && isOfferedHere() ? state : null;
};

// Asked once as this file loads, so the settings search has its answer before the desktop page
// was ever opened.
refreshWallpaperDisplays();
