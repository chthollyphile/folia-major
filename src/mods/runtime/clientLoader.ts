import type { ModRuntimeInfo } from '../types';
import { isModsBridgeAvailable, listMods } from '../ipc';
import type { FoliumClientApi, FoliumClientModule, FoliumContextKind, FoliumDisposer } from '../folium/contract';
import { announceFoliumSlowStart, clearFoliumIssues, reportFoliumFault } from './status';
import { removeFoliumEventHandlers } from '../folium/events';
import { callFoliumMod, timeFoliumMod } from './guard';
import { clearFoliumOldNames } from '../folium/deprecated/warnings';

// src/mods/runtime/clientLoader.ts
// Activates mods' `client` entries in this renderer and keeps them in step
// with the loader's mod list. A client is imported from its digest-versioned
// folia-mod:// URL, so an edited mod is a different module and re-imports.
// Teardown runs the mod's own disposer and then removes every registration it
// made, so disabling a mod leaves no mode, command or layer behind. What the
// client subscribed or started through host objects (its settings values, its
// timers) goes with it, and from then on that activation's register calls are
// refused: a mod that registers lazily cannot add to a generation after its own.
//
// Reconciles are serialized: a reload that lands while the previous one is
// still importing waits for it instead of racing it.
//
// A mod gets FOLIUM_START_LIMIT_MS for its import plus its `activate`. Past
// that the queue goes on to the next mod and the user is told, once, that this
// mod has not finished starting. That is slowness, not a failure: nothing is
// recorded against the mod. Its start is not cancelled (an import cannot be):
// when it does finish, what it registered is there, and whoever asked to hear
// of late starts (onFoliumClientStarted) is told. A start that throws, in time
// or late, is the failure. One that throws after its mod was stopped (disabled,
// or replaced by newer code) is nobody's: it is logged and not counted.
//
// The client API — and through it every registry adapter and the host
// registries they wire into (all background types, settings panels, icons…) —
// is imported only when there is a client to activate. The export window and
// sessions without mods import this file but never pay for that graph.

interface ActiveClient {
    url: string;
    dispose: FoliumDisposer | null;
    /** Set at teardown. Each activation has its own, so the refusal is not per mod id. */
    stopped: boolean;
    /** What this activation holds through host objects; run at teardown. */
    releases: Array<() => void>;
}

/** How long one mod has for its import plus its `activate` before the queue goes on without it. */
export const FOLIUM_START_LIMIT_MS = 5000;

/** Where the start of a mod's client stands: its import plus its `activate`. */
export type FoliumClientStart =
    /** Still going. `late` once it ran past the limit: the queue went on, the start did too. */
    | { readonly state: 'starting'; readonly late: boolean }
    /** It ended, in time or late, after `ms` milliseconds. */
    | { readonly state: 'started'; readonly ms: number }
    /** Its import or its `activate` threw. What it registered before that stays until the mod is stopped. */
    | { readonly state: 'failed' };

const STARTING: FoliumClientStart = Object.freeze({ state: 'starting', late: false });
const STARTING_LATE: FoliumClientStart = Object.freeze({ state: 'starting', late: true });
const FAILED: FoliumClientStart = Object.freeze({ state: 'failed' });

const activeClients = new Map<string, ActiveClient>();
// The name each mod was last started under, for sentences that name it (the failure notice).
const modNames = new Map<string, string>();
const startedListeners = new Set<(modId: string) => void>();
// Where each active client's start stands.
const starts = new Map<string, FoliumClientStart>();
let queue: Promise<void> = Promise.resolve();
// Folium 1.7 (runtime/equalizer/): the mod list the main window last reconciled, and who wants to hear of a new one.
let latestMainModList: readonly ModRuntimeInfo[] | null = null;
const modListListeners = new Set<() => void>();
let experimentalPromise: Promise<typeof import('../folium/experimental')> | null = null;
let apiPromise: Promise<typeof import('../folium/api')> | null = null;

const loadApi = () => {
    apiPromise ??= import('../folium/api');
    return apiPromise;
};

// Experimental surfaces (Omni providers/hooks, Ponder targets): main window only, on first opt-in.
const loadExperimental = () => {
    experimentalPromise ??= Promise.all([import('../folium/experimental'), loadApi()]).then(([module, api]) => {
        api.addFoliumTeardownRegistries(module.EXPERIMENTAL_REGISTRIES);
        return module;
    });
    return experimentalPromise;
};

// Only active clients are torn down, and activating one already loaded the API.
const teardown = async (modId: string) => {
    const active = activeClients.get(modId);
    activeClients.delete(modId);
    starts.delete(modId);
    if (active) active.stopped = true;
    if (active?.dispose) {
        callFoliumMod(modId, 'client dispose', active.dispose);
    }
    // After the mod's own disposer: whatever it left subscribed goes now.
    active?.releases.forEach((release) => release());
    const { listFoliumHostRegistries } = await loadApi();
    listFoliumHostRegistries().forEach((registry) => registry.unregisterAll(modId));
    removeFoliumEventHandlers(modId);
};

/*
 * The mod's own part of a start: its import and its `activate`. Never rejects.
 * It may end long after the queue stopped waiting for it, and the mod may have
 * been torn down by then: a client that was stopped while its import was still
 * on the way is not activated, and a disposer that arrives for a stopped one
 * runs at once, because no teardown is left to run it. A stopped one that throws
 * is not a failure of the mod: the code that runs now, if any, is not the code
 * that threw.
 */
const runClient = async (mod: ModRuntimeInfo, url: string, api: FoliumClientApi, record: ActiveClient) => {
    const began = performance.now();
    starts.set(mod.id, STARTING);
    let failed = false;
    try {
        // Timed and counted by the gate; a failure stays this function's to report.
        const module = await timeFoliumMod(mod.id, 'client import', () => import(/* @vite-ignore */ url)) as FoliumClientModule;
        if (record.stopped) return;
        if (typeof module?.default !== 'function') {
            throw new Error('client entry must `export default function activate(folium)`');
        }
        const result = await timeFoliumMod(mod.id, 'client activate', () => module.default(api));
        if (typeof result === 'function') {
            if (record.stopped) {
                callFoliumMod(mod.id, 'client dispose', result);
            } else {
                record.dispose = result;
            }
        }
    } catch (error) {
        if (record.stopped) {
            const line = `[Folium:${mod.id}] a start that had been stopped failed afterwards; not counted against the mod`;
            try {
                console.warn(line, error);
            } catch {
                // Printing the thrown value itself can throw; the line alone still says what happened.
                console.warn(line);
            }
            return;
        }
        failed = true;
        reportFoliumFault(mod.id, 'client activate', error, 'start');
    }
    if (record.stopped) return;
    starts.set(mod.id, failed ? FAILED : Object.freeze({ state: 'started', ms: performance.now() - began }));
    startedListeners.forEach((listener) => {
        try {
            listener(mod.id);
        } catch (error) {
            console.warn('[Folium] a listener for started clients failed', error);
        }
    });
};

/* Resolves when the mod's start has ended, or at the start limit, whichever comes first. */
const activate = async (mod: ModRuntimeInfo, url: string, context: FoliumContextKind) => {
    clearFoliumIssues(mod.id);
    // Folium 1.6 only: the old names its last start used (folium/deprecated/).
    clearFoliumOldNames(mod.id);
    modNames.set(mod.id, mod.name);
    // Record first so a failed activation still gets torn down (partial registrations).
    const record: ActiveClient = { url, dispose: null, stopped: false, releases: [] };
    activeClients.set(mod.id, record);
    const stopped = (what: string) => {
        if (record.stopped) console.warn(`[Folium:${mod.id}] ${what}: this mod was stopped, the call is ignored`);
        return record.stopped;
    };
    let api: FoliumClientApi;
    try {
        // The host's own modules. Loading them is not the mod's time, so the limit starts after.
        const onRelease = (release: () => void) => { record.releases.push(release); };
        const experimental = context === 'main' && (mod.experimental ?? []).length > 0
            ? (await loadExperimental()).createFoliumExperimental(mod, stopped, onRelease)
            : {};
        const { createFoliumClientApi } = await loadApi();
        api = createFoliumClientApi(mod, {
            context,
            experimental,
            onRelease,
            stopped,
        });
        // Folium 1.6 only: the client names Folium 2 removed, kept working (folium/deprecated/).
        api = await (await import('../folium/deprecated')).addOldClientNames(api, mod, context);
    } catch (error) {
        starts.set(mod.id, FAILED);
        reportFoliumFault(mod.id, 'client activate', error, 'start');
        return;
    }
    await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
            // Over the limit is slow, not failed: the queue goes on, the start does too, and the
            // user is told once that this mod has not finished starting.
            starts.set(mod.id, STARTING_LATE);
            announceFoliumSlowStart(mod.id);
            resolve();
        }, FOLIUM_START_LIMIT_MS);
        void runClient(mod, url, api, record).then(() => {
            clearTimeout(timer);
            resolve();
        });
    });
};

/*
 * Brings the active clients in line with `mods`: tears down clients whose mod
 * vanished, got disabled or changed code (new URL), then activates the rest in
 * mod-id order. Per-mod failures only affect that mod.
 */
export const reconcileFoliumClients = (mods: ModRuntimeInfo[], context: FoliumContextKind): Promise<void> => {
    // The list itself, as it arrives and before the queue gets to it: what it says is enabled is what the
    // user chose, whether or not that mod's client has started (yet) here.
    if (context === 'main') {
        latestMainModList = Object.freeze([...mods]);
        modListListeners.forEach((listener) => {
            try {
                listener();
            } catch (error) {
                console.warn('[Folium] a listener for the mod list failed', error);
            }
        });
    }
    const run = async () => {
        const desired = new Map(
            mods
                .filter((mod) => mod.status === 'loaded' && typeof mod.clientUrl === 'string' && mod.clientUrl)
                .map((mod) => [mod.id, mod] as const),
        );
        for (const [modId, active] of Array.from(activeClients.entries())) {
            if (desired.get(modId)?.clientUrl !== active.url) {
                await teardown(modId);
            }
        }
        // Dependencies first: the list arrives sorted by id, the load plan is topological.
        const pending = Array.from(desired.values())
            .filter((mod) => !activeClients.has(mod.id))
            .sort((left, right) => (
                (left.loadOrder ?? Number.MAX_SAFE_INTEGER) - (right.loadOrder ?? Number.MAX_SAFE_INTEGER)
                || left.id.localeCompare(right.id)
            ));
        for (const mod of pending) {
            await activate(mod, mod.clientUrl as string, context);
        }
    };
    queue = queue.then(run, run);
    return queue;
};

/*
 * Main-window bootstrap: reads the mod list over the bridge and activates the
 * clients. No-op without the Electron bridge (web build, OBS pages). Awaited
 * before the app renders, so a saved mod visualizer mode can be restored.
 */
export const initFoliumClients = async (): Promise<void> => {
    if (!isModsBridgeAvailable()) return;
    try {
        const { mods } = await listMods();
        await reconcileFoliumClients(mods, 'main');
    } catch (error) {
        console.warn('[Folium] client bootstrap failed', error);
    }
};

/**
 * Calls `listener` each time a client's start has ended (its `activate` returned or failed),
 * whether that was in time or after the queue had gone on without it. What needs a mod's
 * registrations to be there, such as a saved selection, is redone from it.
 */
export const onFoliumClientStarted = (listener: (modId: string) => void): (() => void) => {
    startedListeners.add(listener);
    return () => {
        startedListeners.delete(listener);
    };
};

/** Where a mod's client start stands; undefined for a mod with no client running in this window. */
export const getFoliumClientStart = (modId: string): FoliumClientStart | undefined => starts.get(modId);

/** The name a mod's client was last started under; its id when it never started here. */
export const foliumModName = (modId: string) => modNames.get(modId) || modId;

/** Folium 1.7 (runtime/equalizer/): the mod list the main window last reconciled; null before the first. */
export const getFoliumModList = (): readonly ModRuntimeInfo[] | null => latestMainModList;

/**
 * Calls `listener` each time the main window reconciles a mod list (the first one, an enable, a disable, a
 * removal, an install, a push from the main process); read it with getFoliumModList.
 */
export const onFoliumModListChanged = (listener: () => void): (() => void) => {
    modListListeners.add(listener);
    return () => {
        modListListeners.delete(listener);
    };
};

/** Mod ids whose client is currently active (for the mods panel). */
export const isFoliumClientActive = (modId: string) => activeClients.has(modId);
