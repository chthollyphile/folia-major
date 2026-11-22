import type { ModRuntimeInfo } from '../types';
import { isModsBridgeAvailable, listMods, reportFoliumSourcesRegistered, subscribeModsState } from '../ipc';
import type { FoliumClientApi, FoliumClientModule, FoliumContextKind, FoliumDisposer } from '../folium/contract';
import { announceFoliumSlowStart, clearFoliumIssues, reportFoliumFault, reportFoliumIssue } from './status';
import { removeFoliumEventHandlers } from '../folium/events';
import { callFoliumMod, markFoliumSourceMod, timeFoliumMod } from './guard';
import { clearFoliumOldNames } from '../folium/deprecated/warnings';
import { loadFoliumModLocales } from './modLocales';
import type * as FoliumSourcesModule from '../folium/registries/sources';

type SourcesModule = typeof FoliumSourcesModule;

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
// Folium 2.0 (plan §5.2, §5.4): the source mods' clients (`kind: 'source'`) start as a group of their own,
// together and before every other client, which still start one by one in load order. The first main-window
// reconcile's group is what `foliumSourceClientsSettled` waits for (the first screen gives it 3 s of its own,
// mainWindowStart.ts). A source mod's client never starts in the export window, and no client starts in a
// context its manifest's `contexts` leave out.
//
// Folium 2.0 (S3): a `folium: 2` mod's client gets `folium.sources` (and `folium.i18n`); in the main window the
// sources registry is loaded for it, like the experimental surfaces, so the export window never pulls in the
// provider registry. Its locale files (manifest `locales`) are loaded before it starts. Once a source mod's
// `activate` has ended, every source its manifest declares (and the user left on) must be registered: one that
// is not is reported in the mod's row, and a mod that registered none of them loses the source exemptions
// (folia-mods:sources-registered, plan §5.2).
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
// The first main-window reconcile's source group, started or past its limit; settled at once without a bridge.
let markSourceClientsSettled: () => void = () => {};
const sourceClientsSettled = new Promise<void>((resolve) => {
    markSourceClientsSettled = resolve;
});
let sourceGroupReported = false;
let apiPromise: Promise<typeof import('../folium/api')> | null = null;
let sourcesPromise: Promise<SourcesModule> | null = null;

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

// Folium 2.0: the sources registry, main window only, on the first `folium: 2` mod.
const loadSources = () => {
    sourcesPromise ??= Promise.all([import('../folium/registries/sources'), loadApi()]).then(([module, api]) => {
        api.addFoliumTeardownRegistries([module.sourcesRegistry]);
        return module;
    });
    return sourcesPromise;
};

/*
 * Folium 2.0: once a source mod's `activate` has ended, the sources its manifest declares and the user left on
 * that it did not register. Each is reported in its row; one that registered none of them is told to the main
 * process, which takes the source exemptions back.
 */
const checkDeclaredSources = async (mod: ModRuntimeInfo, url: string) => {
    if (!isFoliumSourceMod(mod) || !sourcesPromise) return;
    const { listFoliumSourceIdsOf } = await sourcesPromise;
    const registered = new Set(listFoliumSourceIdsOf(mod.id));
    const expected = (mod.sources ?? []).filter((source) => source.state !== 'disabled');
    const missing = expected.filter((source) => !registered.has(source.localId));
    if (missing.length === 0) return;
    missing.forEach((source) => reportFoliumIssue(
        mod.id,
        `source ${source.id}`,
        new Error(`mod.json declares the source "${source.localId}" and activate ended without folium.sources.register for it`),
    ));
    if (registered.size === 0) {
        console.warn(`[Folium] ${mod.id} registered none of its sources: the source exemptions are taken back`);
        await reportFoliumSourcesRegistered(mod.id, [], url);
    }
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
    // After the mod's own disposer: whatever it left subscribed goes now (its locale files too).
    active?.releases.forEach((release) => release());
    const { listFoliumHostRegistries } = await loadApi();
    listFoliumHostRegistries().forEach((registry) => registry.unregisterAll(modId));
    removeFoliumEventHandlers(modId);
};

/* Whether `record`'s activation was torn down, read now (it changes while an `await` is under way). */
const isStopped = (record: ActiveClient): boolean => record.stopped;

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
        // Read anew: the mod may have been stopped (reloaded, updated) while its activate ran. A stopped start
        // must not check the registrations of the copy that runs now, nor have that copy's exemptions revoked.
        if (!isStopped(record)) await checkDeclaredSources(mod, url);
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
    // Folium 2.0: a source mod's hot-path members skip the gate (guard.ts callFoliumSourceMember).
    markFoliumSourceMod(mod.id, isFoliumSourceMod(mod));
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
        const sources = context === 'main' && mod.folium === 2 ? await loadSources() : null;
        // A `folium: 2` mod's own texts, in place before its first line runs.
        if (mod.folium === 2 && mod.locales) onRelease(await loadFoliumModLocales(mod));
        const { createFoliumClientApi } = await loadApi();
        api = createFoliumClientApi(mod, {
            context,
            experimental,
            onRelease,
            stopped,
            ...(sources ? {
                sources: {
                    register: (def) => sources.registerFoliumSource({ mod, stopped }, def),
                    capability: sources.getFoliumSourceCapability,
                    pageStore: sources.createFoliumPageStore,
                },
            } : {}),
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
                .filter((mod) => startsIn(mod, context))
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
        // The source group first, all together; then every other client in turn.
        const sources = pending.filter(isFoliumSourceMod);
        await Promise.all(sources.map((mod) => activate(mod, mod.clientUrl as string, context)));
        if (context === 'main' && !sourceGroupReported) {
            sourceGroupReported = true;
            markSourceClientsSettled();
        }
        for (const mod of pending.filter((candidate) => !isFoliumSourceMod(candidate))) {
            await activate(mod, mod.clientUrl as string, context);
        }
    };
    queue = queue.then(run, run);
    return queue;
};

/*
 * Every load the main process runs ends by pushing the mod list (folia-mods:state-changed). The mods panel's
 * store follows it once the panel has been opened (useModsStore.bindEvents); the main window follows it from
 * the start, so a load nobody here asked for still reaches the clients: in a development build, a rebuild of
 * dist-mods/ restarts the one built-in mod it changed (electron/modSystem/builtinBuildWatch.cjs), and its client
 * comes back under its new URL. The reconcile queue makes a second follower (the panel's) a no-op.
 */
const followMainProcessLoads = () => {
    try {
        subscribeModsState((mods) => {
            void reconcileFoliumClients(mods, 'main');
        });
    } catch (error) {
        console.warn('[Folium] the main window does not hear the main process\'s mod loads', error);
    }
};

/*
 * Main-window bootstrap: reads the mod list over the bridge and activates the
 * clients. No-op without the Electron bridge (web build, OBS pages). Awaited
 * before the app renders, so a saved mod visualizer mode can be restored.
 */
export const initFoliumClients = async (): Promise<void> => {
    if (!isModsBridgeAvailable()) {
        markSourceClientsSettled();
        return;
    }
    try {
        const { mods } = await listMods();
        followMainProcessLoads();
        await reconcileFoliumClients(mods, 'main');
    } catch (error) {
        console.warn('[Folium] client bootstrap failed', error);
    } finally {
        // A bootstrap that failed before its source group ran leaves nothing to wait for.
        markSourceClientsSettled();
    }
};

/** A source mod (Folium 2.0, `folium: 2` with `sources`): its client is in the source group. */
export const isFoliumSourceMod = (mod: Pick<ModRuntimeInfo, 'kind'>): boolean => mod.kind === 'source';

/*
 * Whether `mod`'s client starts in `context`: never a source mod's in the export window (plan §5.2), and never
 * in a context its manifest `contexts` leave out. Without `contexts`, everywhere, as in Folium 1.
 */
export const startsIn = (mod: Pick<ModRuntimeInfo, 'kind' | 'contexts'>, context: FoliumContextKind): boolean => {
    if (context === 'export' && isFoliumSourceMod(mod)) return false;
    return !Array.isArray(mod.contexts) || mod.contexts.includes(context);
};

/**
 * Resolves once the first main-window reconcile has started its source group (each client in time or past its
 * own 5 s limit), or at once where there are no mods. No cap of its own: the first screen puts one on it.
 */
export const foliumSourceClientsSettled = (): Promise<void> => sourceClientsSettled;

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
