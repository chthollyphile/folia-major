import type { ModRuntimeInfo } from '../types';
import { invokeModRpc, invokeModStorage } from '../ipc';
import {
    type FoliumClientApi,
    type FoliumContextKind,
    type FoliumDisposer,
    type FoliumEvents,
    type FoliumSettingAccess,
    type FoliumRegistries,
    type FoliumRegistry,
    type FoliumRegistryHandle,
    type FoliumSettingsSectionHandle,
    type FoliumStorage,
} from './contract';
import { FOLIUM_KIND_NAMES, FOLIUM_KINDS, type FoliumKindName } from './kinds';
import type { FoliumHostRegistry } from '../runtime/registry';
import { createFoliumGatedChannel, gateFoliumSettingAccess, type FoliumGatedChannel } from '../runtime/guard';
import { createFoliumScope } from './helpers';
import { reportFoliumIssue } from '../runtime/status';
import { visualizersRegistry } from './registries/visualizers';
import { tuningsRegistry } from './registries/tunings';
import { commandsRegistry } from './registries/commands';
import { backgroundsRegistry } from './registries/backgrounds';
import { stageLayersRegistry } from './registries/stageLayers';
import { settingsSectionsRegistry } from './registries/settingsSections';
import { playerPanelTabsRegistry } from './registries/playerPanelTabs';
import { homeTabsRegistry } from './registries/homeTabs';
import { progressButtonsRegistry, progressLayersRegistry } from './registries/progress';
import { stylesRegistry } from './registries/styles';
import { addFoliumEventHandler } from './events';
import { bindFoliumStageRegistry } from './registries/stageRegistry';
import { createFoliumLyricsService, createFoliumNetService, createFoliumPlaybackService, createFoliumUiService } from './services';
import { createFoliumAudioMixService } from './audioMix';
import { createFoliumSecrets, declareFoliumSecretKeys } from './secrets';
import { FOLIUM_THEME_HELPERS } from './sharedHelpers';
import { FOLIUM_HOST_VERSION } from './shared';
import { FOLIUM_EVENT_TYPES } from './eventTypes';
import { addFoliumRpcListener, FOLIUM_RPC_NAME_PATTERN } from './rpcMessages';
import { createFoliumAccountService } from './account';

// src/mods/folium/api.ts
// Builds the `folium` object one mod's client entry receives. Everything is
// bound to that mod: registrations are namespaced and owned by it, rpc and
// storage reach only its own main entry and data file, and dispose() removes
// every registration it made — a disabled mod leaves nothing behind.

/*
 * What each kind is (kinds.ts) decides how its registry is handed to a mod:
 * a kind that only makes sense where there is app UI accepts registrations in
 * the export window and does nothing, so a mod registers the same way in both
 * contexts and its visualizer still renders there (settings sections stay live
 * everywhere: they carry no UI of their own, and a visualizer rendering in the
 * export window may read them); a kind with a permission refuses a mod that
 * did not declare it.
 */

type AnyHostRegistry = FoliumHostRegistry<any, any>;

// The kinds whose entries mount with a FoliumStageContext.
const STAGE_KINDS: ReadonlySet<FoliumKindName> = new Set(['visualizers', 'stageLayers']);

// The registry behind each row of the kinds table. One per row: the compiler asks for it.
const HOST_REGISTRIES: Record<FoliumKindName, AnyHostRegistry> = {
    visualizers: visualizersRegistry,
    tunings: tuningsRegistry,
    commands: commandsRegistry,
    backgrounds: backgroundsRegistry,
    stageLayers: stageLayersRegistry,
    settingsSections: settingsSectionsRegistry,
    playerPanelTabs: playerPanelTabsRegistry,
    homeTabs: homeTabsRegistry,
    progressButtons: progressButtonsRegistry,
    progressLayers: progressLayersRegistry,
    styles: stylesRegistry,
};

// Registries of lazily loaded surfaces (experimental.ts) join teardown once loaded.
const extraRegistries: AnyHostRegistry[] = [];

export const addFoliumTeardownRegistries = (registries: AnyHostRegistry[]) => {
    registries.forEach((registry) => {
        if (!extraRegistries.includes(registry)) extraRegistries.push(registry);
    });
};

/** Every host registry, for teardown of a mod across all of them. */
export const listFoliumHostRegistries = (): AnyHostRegistry[] => [
    ...FOLIUM_KIND_NAMES.map((name) => HOST_REGISTRIES[name]),
    ...extraRegistries,
];

/** What a register call returns when it registered nothing: refused after a teardown, or UI-only in the export window. */
export const inertFoliumHandle = (modId: string, id: unknown) => Object.freeze({
    id: `${modId}:${String(id)}`,
    unregister: () => {},
});

// The values of a settings section that was refused: nothing to read, nothing kept.
const NO_SETTINGS: FoliumSettingAccess = Object.freeze({
    schema: Object.freeze([]),
    get: () => Object.freeze({}),
    set: () => {},
    reset: () => {},
    onChange: () => () => {},
});

/**
 * Says whether this activation was torn down, and names the refused call in the console when it
 * was. `what` is the call as the mod wrote it, e.g. "registries.visualizers.register".
 */
export type FoliumStoppedCheck = (what: string) => boolean;

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
    /** Experimental surfaces by opt-in name; empty for a mod that opted into none. */
    experimental: Record<string, unknown>;
    /**
     * Receives a release function for each thing this activation holds through a host object
     * (its subscriptions to settings values, its timers and its onDispose functions). The loader
     * runs them at teardown, after the disposer `activate` returned.
     */
    onRelease: (release: () => void) => void;
    /**
     * Asked by every register call and by events.on. After a teardown the answer is yes and the
     * call is refused: nothing would ever remove what it adds. It is per activation, not per mod
     * id, so a mod that registers lazily after a reload cannot add to the new generation.
     */
    stopped: FoliumStoppedCheck;
}

export const createFoliumClientApi = (mod: ModRuntimeInfo, options: FoliumClientApiOptions): FoliumClientApi => {
    const { context, stopped, onRelease } = options;
    const modId = mod.id;
    const optedIn = new Set(mod.experimental ?? []);
    // What the mod starts through `folium.every` and hands to `folium.onDispose` ends with this activation.
    const scope = createFoliumScope(modId, 'client');
    onRelease(scope.end);

    // What a kind's `register` returns beyond the plain handle. Only a settings section adds
    // to it: the handle carries the section's values so the mod can read what the user set.
    // Its `secret` keys go to the main process from the main window (folium/secrets.ts).
    const completeHandle: Partial<Record<FoliumKindName, (handle: FoliumRegistryHandle, registered: boolean) => FoliumRegistryHandle>> = {
        settingsSections: (handle, registered): FoliumSettingsSectionHandle => {
            if (!registered) {
                return Object.freeze({ ...handle, settings: NO_SETTINGS });
            }
            const stored = settingsSectionsRegistry.get(handle.id);
            if (context === 'main') declareFoliumSecretKeys(modId, stored!.def.secretKeys);
            // A view for this activation: the store outlives the mod, so its listeners
            // run through the gate and are dropped when the client is torn down.
            const settings = gateFoliumSettingAccess(stored!.def.access, modId, `settings section ${handle.id}`);
            onRelease(settings.release);
            return Object.freeze({ ...handle, settings: settings.view });
        },
    };
    /* One kind's registry as this mod gets it, from the kind's row in the table. */
    const bindKind = (name: FoliumKindName): FoliumRegistry<{ id: string }> => {
        const kind = FOLIUM_KINDS[name];
        const registry = HOST_REGISTRIES[name];
        // What the kind needs is declared up front (the trust dialog lists it).
        const permission = kind.permission;
        const inert = kind.uiOnly && context !== 'main';
        const complete = completeHandle[name];
        // Stage-shaped kinds bind each mount to its registration and to the mod's manifest
        // (the `player.layout` opt-in); the rest register as they are.
        const stage = STAGE_KINDS.has(name) ? bindFoliumStageRegistry(registry, mod, context) : null;
        return Object.freeze({
            register: (def: { id: string }) => {
                if (permission !== null && !mod.permissions.includes(permission)) {
                    throw new Error(`permission-denied:${permission}`);
                }
                // A registration that does nothing: after a teardown, and for UI-only kinds outside the main window.
                const registered = !(stopped(`registries.${name}.register`) || inert);
                const handle = !registered
                    ? inertFoliumHandle(modId, def?.id)
                    : stage ? stage.register(def as Parameters<typeof stage.register>[0]) : registry.register(modId, def);
                return complete ? complete(handle, registered) : handle;
            },
        });
    };
    const registries = Object.freeze(
        Object.fromEntries(FOLIUM_KIND_NAMES.map((name) => [name, bindKind(name)])),
    ) as unknown as FoliumRegistries;

    const log = Object.freeze({
        info: (message: string, details?: unknown) => console.info(`[Folium:${modId}] ${message}`, details ?? ''),
        warn: (message: string, details?: unknown) => console.warn(`[Folium:${modId}] ${message}`, details ?? ''),
        error: (message: string, details?: unknown) => reportFoliumIssue(modId, 'log', details ?? message),
    });

    /*
     * rpc.on (Folium 1.7): one gated channel per message name, so a listener that throws is reported
     * under that name; all of them end with this activation. Outside the main window nothing is ever
     * sent, so a listener is checked and not kept, and the mod's code runs the same in both contexts.
     */
    const rpcChannels = new Map<string, FoliumGatedChannel>();
    onRelease(() => {
        rpcChannels.forEach((channel) => channel.release());
        rpcChannels.clear();
    });
    const rpc = Object.freeze({
        call: <T>(name: string, ...args: unknown[]): Promise<T> => (
            context === 'main' ? unwrap<T>(invokeModRpc(modId, name, args)) : unavailable('rpc', context)
        ),
        on: (name: string, listener: (payload: unknown) => void): FoliumDisposer => {
            if (typeof name !== 'string' || !FOLIUM_RPC_NAME_PATTERN.test(name)) {
                throw new Error('rpc.on requires a name matching /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/');
            }
            if (typeof listener !== 'function') {
                throw new TypeError('rpc.on requires a listener function');
            }
            if (context !== 'main' || stopped('rpc.on')) return () => {};
            let channel = rpcChannels.get(name);
            if (!channel) {
                channel = createFoliumGatedChannel(modId, `rpc.on ${name}`, false);
                rpcChannels.set(name, channel);
            }
            const off = channel.subscribe(listener, (gated) => addFoliumRpcListener(modId, name, gated));
            return () => {
                off();
            };
        },
    });

    const experimental = gatedNamespace(
        'experimental',
        options.experimental,
        (name) => optedIn.has(name),
        (name) => `experimental-not-declared:${name} (add it to "experimental" in mod.json)`,
    );

    return Object.freeze({
        modId,
        host: Object.freeze({
            folium: Object.freeze({ major: FOLIUM_HOST_VERSION.major, minor: FOLIUM_HOST_VERSION.minor }),
            folia: typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__,
        }),
        env: Object.freeze({ context }),
        log,
        registries,
        events: Object.freeze<FoliumEvents>({
            on: (type, handler, options) => {
                // The event types table (eventTypes.ts) is the one list of names, and says which
                // need an experimental opt-in in the manifest.
                if (!Object.hasOwn(FOLIUM_EVENT_TYPES, type)) {
                    throw new Error(`unknown-event:${String(type)}`);
                }
                const { experimental: needs } = FOLIUM_EVENT_TYPES[type];
                if (needs !== null && !optedIn.has(needs)) {
                    throw new Error(`experimental-not-declared:${needs} (add it to "experimental" in mod.json)`);
                }
                if (stopped('events.on')) return () => {};
                return addFoliumEventHandler(modId, type, handler, options?.priority);
            },
        }),
        playback: createFoliumPlaybackService(mod, context),
        audioMix: createFoliumAudioMixService(context),
        ui: createFoliumUiService(mod, context),
        net: createFoliumNetService(mod, context),
        storage: createStorage(modId, context),
        // Folium 1.7: only this mod's own `secret` values, like storage only its own data file.
        secrets: createFoliumSecrets(modId, context, onRelease),
        rpc,
        lyrics: createFoliumLyricsService(context),
        theme: FOLIUM_THEME_HELPERS,
        account: createFoliumAccountService(context),
        every: scope.every,
        onDispose: scope.onDispose,
        experimental,
    });
};
