import { isModsBridgeAvailable, reportModsStartAlive, reportModsStartSettled } from '../ipc';
import { initFoliumClients, onFoliumClientStarted } from './clientLoader';
import { installFoliumCommandPaletteSync } from '../folium/registries/commandPaletteSync';
import { installFoliumFaultNotice } from './faultNotice';
import { installFoliumHostEvents } from './hostEvents';
import { installFoliumHostAccount } from './hostAccount';
import { installFoliumHostOmni } from './omni/hostOmni';
import { installFoliumHostEqualizer } from './equalizer/hostEqualizer';
import { installFoliumHostVisualizer } from './visualizer/hostVisualizer';
import { restoreSavedFoliumSelections } from './missingEntries';

// src/mods/runtime/mainWindowStart.ts
// How the main window starts the mods' clients before its first screen.
//
// The first screen waits for the clients, because a lyric style or background
// of a mod that was saved as the user's choice can only be shown once that mod
// has registered it. It waits for all of them together for at most
// `firstScreenWaitMs`, a number src/bootstrap.tsx owns: the wait is this
// window's alone. The loader (clientLoader.ts) has no such cap, so the export
// window, which must not draw before its style's mod is there, waits in full.
//
// A client that was not up at the first screen keeps starting. Each time one
// has started, the saved selections are restored again, so its style or
// background comes back then. What it cannot get back: the first song's
// `lyrics.transform` and `playback.beforePlay`, if that song began before it
// was listening.
//
// The end of the start is reported to the main process, which then takes up
// its start note (electron/modSystem/safeStart.cjs): once every client's start
// has returned (or run past its limit) and the first screen has been mounted,
// which is when every mod `mount` of that screen has returned too. A mod that
// freezes or crashes the window before that leaves the note in place.
//
// Until then the page also tells the main process once a second that it is
// answering. If the user leaves the app while a slow mod is still starting,
// that is how the main process knows the start had not gone wrong, and takes
// the note up; a page stuck on a mod cannot say it, and its note stays.

/** How often the page says it is answering while its start is under way. */
const START_ALIVE_INTERVAL_MS = 1000;

export interface FoliumMainWindowStartOptions {
    /** The longest the first screen waits for the clients, all of them together. */
    firstScreenWaitMs: number;
}

let markFirstScreenMounted: () => void = () => {};
const firstScreenMounted = new Promise<void>((resolve) => {
    markFirstScreenMounted = resolve;
});

/**
 * The first screen has been mounted: call it from an effect of a component that wraps the app,
 * which runs after the effects of everything inside it, mod mounts included.
 */
export const noteFoliumFirstScreenMounted = () => markFirstScreenMounted();

/** Starts the clients. Resolves when the first screen may be drawn: all are up, or the wait is over. */
export const startFoliumForMainWindow = async ({ firstScreenWaitMs }: FoliumMainWindowStartOptions): Promise<void> => {
    installFoliumCommandPaletteSync();
    installFoliumHostEvents();
    installFoliumHostAccount();
    // Folium 1.7 `folium.omni`: installed before any client starts, so a mod's `activate` may read through it.
    installFoliumHostOmni();
    // Folium 1.7 `folium.equalizer`: likewise before any client starts, and before the first mod list arrives.
    installFoliumHostEqualizer();
    // Folium 1.8 `folium.visualizer`: likewise before any client starts.
    installFoliumHostVisualizer();
    // Before the clients start: a mod that fails while starting is announced too.
    installFoliumFaultNotice();
    // On time or late: a saved selection comes back when the mod that provides it is up.
    onFoliumClientStarted(restoreSavedFoliumSelections);
    // Said before the first client starts, then every second until the start has ended.
    let alive: ReturnType<typeof setInterval> | null = null;
    if (isModsBridgeAvailable()) {
        void reportModsStartAlive();
        alive = setInterval(() => { void reportModsStartAlive(); }, START_ALIVE_INTERVAL_MS);
    }
    const started = initFoliumClients();
    void Promise.all([started, firstScreenMounted]).then(() => {
        if (alive !== null) clearInterval(alive);
        return reportModsStartSettled();
    });
    await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, firstScreenWaitMs);
        void started.then(() => {
            clearTimeout(timer);
            resolve();
        });
    });
};
