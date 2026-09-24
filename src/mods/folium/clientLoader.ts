import type { ModRuntimeInfo } from '../types';
import { isModsBridgeAvailable, listMods } from '../ipc';
import type { FoliumClientModule, FoliumContextKind, FoliumDisposer } from './contract';
import { createFoliumClientApi, listFoliumHostRegistries } from './api';
import { clearFoliumIssues, reportFoliumIssue } from './status';

// src/mods/folium/clientLoader.ts
// Activates mods' `client` entries in this renderer and keeps them in step
// with the loader's mod list. A client is imported from its digest-versioned
// folia-mod:// URL, so an edited mod is a different module and re-imports.
// Teardown runs the mod's own disposer and then removes every registration it
// made, so disabling a mod leaves no mode, command or layer behind.
//
// Reconciles are serialized: a reload that lands while the previous one is
// still importing waits for it instead of racing it.

interface ActiveClient {
    url: string;
    dispose: FoliumDisposer | null;
}

const activeClients = new Map<string, ActiveClient>();
let queue: Promise<void> = Promise.resolve();
let internalsPromise: Promise<Record<string, unknown>> | null = null;

const loadInternals = () => {
    internalsPromise ??= import('./internals').then((module) => module.createFoliumInternals());
    return internalsPromise;
};

const teardown = (modId: string) => {
    const active = activeClients.get(modId);
    activeClients.delete(modId);
    if (active?.dispose) {
        try {
            active.dispose();
        } catch (error) {
            reportFoliumIssue(modId, 'client dispose', error);
        }
    }
    listFoliumHostRegistries().forEach((registry) => registry.unregisterAll(modId));
};

const activate = async (mod: ModRuntimeInfo, url: string, context: FoliumContextKind) => {
    clearFoliumIssues(mod.id);
    // Record first so a failed activation still gets torn down (partial registrations).
    const record: ActiveClient = { url, dispose: null };
    activeClients.set(mod.id, record);
    try {
        const internals = context === 'main' && mod.folia ? await loadInternals() : null;
        const api = createFoliumClientApi(mod, { context, internals });
        const module = await import(/* @vite-ignore */ url) as FoliumClientModule;
        if (typeof module?.default !== 'function') {
            throw new Error('client entry must `export default function activate(folium)`');
        }
        const result = await module.default(api);
        if (typeof result === 'function') {
            record.dispose = result;
        }
    } catch (error) {
        reportFoliumIssue(mod.id, 'client activate', error);
    }
};

/*
 * Brings the active clients in line with `mods`: tears down clients whose mod
 * vanished, got disabled or changed code (new URL), then activates the rest in
 * mod-id order. Per-mod failures only affect that mod.
 */
export const reconcileFoliumClients = (mods: ModRuntimeInfo[], context: FoliumContextKind): Promise<void> => {
    const run = async () => {
        const desired = new Map(
            mods
                .filter((mod) => mod.status === 'loaded' && typeof mod.clientUrl === 'string' && mod.clientUrl)
                .map((mod) => [mod.id, mod] as const),
        );
        Array.from(activeClients.entries()).forEach(([modId, active]) => {
            if (desired.get(modId)?.clientUrl !== active.url) {
                teardown(modId);
            }
        });
        const pending = Array.from(desired.values())
            .filter((mod) => !activeClients.has(mod.id))
            .sort((left, right) => left.id.localeCompare(right.id));
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

/** Mod ids whose client is currently active (for the mods panel). */
export const isFoliumClientActive = (modId: string) => activeClients.has(modId);
