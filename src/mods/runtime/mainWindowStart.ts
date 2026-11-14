import { isModsBridgeAvailable, reportModsStartAlive, reportModsStartSettled } from '../ipc';
import { foliumSourceClientsSettled, initFoliumClients, onFoliumClientStarted } from './clientLoader';
import { installFoliumSourceStatesSync } from './sourceStatesSync';
import { installDefaultSourcePlaybackStop, installSourcesStoppingListener } from './sourceSwitches';
import { setBuiltinSourcesSettled } from '@/services/onlineMusic/sourceReadiness';
import { FOLIUM_SHARED_LIMITS } from '../folium/shared';
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
// Folium 2.0 (plan §5.2): the source mods' clients are a group of their own and the first screen waits for
// them first, up to SOURCE_FIRST_SCREEN_MS (3 s, foliumShared.json), and only then gives the rest
// `firstScreenWaitMs`. A source that is not up by then keeps starting; the selected platform, the queue's songs
// and the kept accounts come back when it is (S1). What the session restore waits for
// (sourceReadiness.builtinSourcesSettled) is that group with the same cap, and the source states.
//
// Until then the page also tells the main process once a second that it is
// answering. If the user leaves the app while a slow mod is still starting,
// that is how the main process knows the start had not gone wrong, and takes
// the note up; a page stuck on a mod cannot say it, and its note stays.

/** How often the page says it is answering while its start is under way. */
const START_ALIVE_INTERVAL_MS = 1000;

/** The first screen's own wait for the source group (plan §5.2). */
export const SOURCE_FIRST_SCREEN_MS = FOLIUM_SHARED_LIMITS.source.start.firstScreenMs;

/* `promise`, or the end of `ms`, whichever comes first. Never rejects. */
const within = (promise: Promise<unknown>, ms: number): Promise<void> => new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    void promise.then(() => undefined, () => undefined).then(() => {
        clearTimeout(timer);
        resolve();
    });
});

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
    // Folium 2.0: a source about to stop has its playing song paused first (sourceSwitches.ts).
    installDefaultSourcePlaybackStop();
    installSourcesStoppingListener();
    // Folium 2.0: the source states first (they decide what counts as enabled), then the clients.
    const statesRead = installFoliumSourceStatesSync();
    const started = initFoliumClients();
    // The source states answer at once (they do not wait for the start question) and say whether a source mod
    // runs: without one there is no group to wait for, and the start is timed as before Folium 2.0.
    const sourcesUp = statesRead.then((hasSourceMods) => (
        hasSourceMods ? within(foliumSourceClientsSettled(), SOURCE_FIRST_SCREEN_MS) : undefined
    ));
    setBuiltinSourcesSettled(Promise.all([statesRead, sourcesUp]));
    void Promise.all([started, firstScreenMounted]).then(() => {
        if (alive !== null) clearInterval(alive);
        return reportModsStartSettled();
    });
    await sourcesUp;
    await within(started, firstScreenWaitMs);
};
