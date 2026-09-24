import type { ModRuntimeInfo } from '../types';
import { invokeModRpc, invokeModStorage } from '../ipc';
import {
    FOLIUM_VERSION,
    type FoliumClientApi,
    type FoliumContextKind,
    type FoliumEvents,
    type FoliumRegistries,
    type FoliumRegistry,
    type FoliumSettingsSectionDef,
    type FoliumSettingsSectionHandle,
    type FoliumStorage,
} from './contract';
import type { FoliumHostRegistry } from './registry';
import { reportFoliumIssue } from './status';
import { visualizersRegistry } from './registries/visualizers';
import { tuningsRegistry } from './registries/tunings';
import { commandsRegistry } from './registries/commands';
import { backgroundsRegistry } from './registries/backgrounds';
import { stageLayersRegistry } from './registries/stageLayers';
import { settingsSectionsRegistry } from './registries/settingsSections';
import { playerPanelTabsRegistry } from './registries/playerPanelTabs';
import { controlButtonsRegistry, progressLayersRegistry } from './registries/progress';
import { stylesRegistry } from './registries/styles';
import { addFoliumEventHandler } from './events';
import { createFoliumNetService, createFoliumPlaybackService, createFoliumUiService } from './services';

// src/mods/folium/api.ts
// Builds the `folium` object one mod's client entry receives. Everything is
// bound to that mod: registrations are namespaced and owned by it, rpc and
// storage reach only its own main entry and data file, and dispose() removes
// every registration it made — a disabled mod leaves nothing behind.

/*
 * Registries that only make sense where there is app UI. In the export window
 * they accept registrations and do nothing, so a mod registers the same way in
 * both contexts and its visualizer still renders there. Settings sections stay
 * live everywhere: they carry no UI of their own, and a visualizer rendering in
 * the export window may read them.
 */
const UI_ONLY_REGISTRIES = new Set<keyof FoliumRegistries>([
    'commands',
    'stageLayers',
    'playerPanelTabs',
    'controlButtons',
    'progressLayers',
    'styles',
]);

type AnyHostRegistry = FoliumHostRegistry<any, any>;

const HOST_REGISTRIES: Record<keyof FoliumRegistries, AnyHostRegistry> = {
    visualizers: visualizersRegistry,
    tunings: tuningsRegistry,
    commands: commandsRegistry,
    backgrounds: backgroundsRegistry,
    stageLayers: stageLayersRegistry,
    settingsSections: settingsSectionsRegistry,
    playerPanelTabs: playerPanelTabsRegistry,
    controlButtons: controlButtonsRegistry,
    progressLayers: progressLayersRegistry,
    styles: stylesRegistry,
};

/** Every host registry, for teardown of a mod across all of them. */
export const listFoliumHostRegistries = (): AnyHostRegistry[] => Object.values(HOST_REGISTRIES);

const noopHandle = (modId: string, id: unknown) => Object.freeze({
    id: `${modId}:${String(id)}`,
    unregister: () => {},
});

const bindRegistry = <Def extends { id: string }>(
    registry: FoliumHostRegistry<Def, unknown>,
    modId: string,
    inert: boolean,
): FoliumRegistry<Def> => Object.freeze({
    register: (def: Def) => (inert ? noopHandle(modId, def?.id) : registry.register(modId, def)),
});

const unavailable = (what: string, context: FoliumContextKind) => (
    Promise.reject(new Error(`${what}-unavailable-in-${context}-context`))
);

const unwrap = async <T>(response: Promise<{ ok: boolean; result?: unknown; error?: string }>): Promise<T> => {
    const settled = await response;
    if (!settled.ok) {
        throw new Error(settled.error ?? 'folium-call-failed');
    }
    return settled.result as T;
};

const createStorage = (modId: string, context: FoliumContextKind): FoliumStorage => {
    if (context !== 'main') {
        return Object.freeze({
            get: () => unavailable('storage', context),
            set: () => unavailable('storage', context),
            has: () => unavailable('storage', context),
            delete: () => unavailable('storage', context),
            keys: () => unavailable('storage', context),
        }) as FoliumStorage;
    }
    return Object.freeze({
        get: <T>(key: string) => unwrap<T | null>(invokeModStorage(modId, 'get', key)).then((value) => value ?? undefined),
        set: (key: string, value: unknown) => unwrap<void>(invokeModStorage(modId, 'set', key, value)).then(() => undefined),
        has: (key: string) => unwrap<boolean>(invokeModStorage(modId, 'has', key)),
        delete: (key: string) => unwrap<void>(invokeModStorage(modId, 'delete', key)).then(() => undefined),
        keys: () => unwrap<string[]>(invokeModStorage(modId, 'keys')),
    }) as FoliumStorage;
};

/*
 * A namespace whose properties exist only for mods that opted in. Reading a
 * name the mod did not declare throws a pointed error instead of returning
 * undefined, so a missing manifest entry is found on first use.
 */
const gatedNamespace = (
    label: string,
    available: Record<string, unknown>,
    allowed: (name: string) => boolean,
    denial: (name: string) => string,
): Readonly<Record<string, unknown>> => new Proxy(Object.freeze({ ...available }), {
    get: (target, property) => {
        if (typeof property !== 'string') return undefined;
        if (!allowed(property)) throw new Error(denial(property));
        if (!(property in target)) throw new Error(`${label}-unknown:${property}`);
        return (target as Record<string, unknown>)[property];
    },
});

export interface FoliumClientApiOptions {
    context: FoliumContextKind;
    /** Host internals, present only in the main window (loaded lazily there). */
    internals: Record<string, unknown> | null;
    /** Experimental surfaces by opt-in name. Empty in Folium 1.0. */
    experimental?: Record<string, unknown>;
}

export const createFoliumClientApi = (mod: ModRuntimeInfo, options: FoliumClientApiOptions): FoliumClientApi => {
    const { context } = options;
    const modId = mod.id;
    const optedIn = new Set(mod.experimental ?? []);

    const inert = (name: keyof FoliumRegistries) => context !== 'main' && UI_ONLY_REGISTRIES.has(name);
    const registries = Object.freeze({
        visualizers: bindRegistry(visualizersRegistry, modId, inert('visualizers')),
        tunings: bindRegistry(tuningsRegistry, modId, inert('tunings')),
        commands: bindRegistry(commandsRegistry, modId, inert('commands')),
        backgrounds: bindRegistry(backgroundsRegistry, modId, inert('backgrounds')),
        // Painting over the player page is declared up front (trust dialog lists it).
        stageLayers: Object.freeze({
            register: (def: Parameters<typeof stageLayersRegistry.register>[1]) => {
                if (!mod.permissions.includes('ui.stage')) {
                    throw new Error('permission-denied:ui.stage');
                }
                return inert('stageLayers') ? noopHandle(modId, def?.id) : stageLayersRegistry.register(modId, def);
            },
        }),
        // The handle carries the section's values so the mod can read what the user set.
        settingsSections: Object.freeze({
            register: (def: FoliumSettingsSectionDef): FoliumSettingsSectionHandle => {
                const handle = settingsSectionsRegistry.register(modId, def);
                const stored = settingsSectionsRegistry.get(handle.id);
                return Object.freeze({ ...handle, params: stored!.def.access });
            },
        }),
        playerPanelTabs: bindRegistry(playerPanelTabsRegistry, modId, inert('playerPanelTabs')),
        controlButtons: bindRegistry(controlButtonsRegistry, modId, inert('controlButtons')),
        progressLayers: bindRegistry(progressLayersRegistry, modId, inert('progressLayers')),
        styles: bindRegistry(stylesRegistry, modId, inert('styles')),
    }) as FoliumRegistries;

    const log = Object.freeze({
        info: (message: string, details?: unknown) => console.info(`[Folium:${modId}] ${message}`, details ?? ''),
        warn: (message: string, details?: unknown) => console.warn(`[Folium:${modId}] ${message}`, details ?? ''),
        error: (message: string, details?: unknown) => reportFoliumIssue(modId, 'log', details ?? message),
    });

    const rpc = Object.freeze({
        call: <T>(name: string, ...args: unknown[]): Promise<T> => (
            context === 'main' ? unwrap<T>(invokeModRpc(modId, name, args)) : unavailable('rpc', context)
        ),
    });

    const experimental = gatedNamespace(
        'experimental',
        options.experimental ?? {},
        (name) => optedIn.has(name),
        (name) => `experimental-not-declared:${name} (add it to "experimental" in mod.json)`,
    );

    const internals = gatedNamespace(
        'internals',
        options.internals ?? {},
        () => Boolean(mod.folia) && options.internals !== null,
        () => (mod.folia
            ? `internals-unavailable-in-${context}-context`
            : 'internals-require-folia-range (pin host versions with "folia" in mod.json)'),
    );

    return Object.freeze({
        modId,
        host: Object.freeze({
            folium: Object.freeze({ major: FOLIUM_VERSION.major, minor: FOLIUM_VERSION.minor }),
            folia: typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__,
        }),
        env: Object.freeze({ context }),
        log,
        registries,
        events: Object.freeze<FoliumEvents>({
            on: (type, handler, options) => addFoliumEventHandler(modId, type, handler, options?.priority),
        }),
        playback: createFoliumPlaybackService(mod, context),
        ui: createFoliumUiService(mod, context),
        net: createFoliumNetService(mod, context),
        storage: createStorage(modId, context),
        rpc,
        experimental,
        internals,
    });
};
