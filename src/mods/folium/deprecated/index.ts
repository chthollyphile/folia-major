import type { ModRuntimeInfo } from '../../types';
import type { FoliumClientApi, FoliumClock, FoliumContextKind, FoliumDisposer, FoliumSettingAccess } from '../contract';
import { FOLIUM_EVENT_TYPES } from '../eventTypes';
import { FOLIUM_KIND_NAMES, type FoliumKindName } from '../kinds';
import { FOLIUM_EXPERIMENTAL } from '../shared';
import { FOLIUM_OLD_CLIENT_NAMES as OLD, FOLIUM_OLD_REGISTRY_NAMES, foliumOldNameAdvice, type FoliumOldName } from './oldNames';
import { noteFoliumOldName } from './warnings';

// src/mods/folium/deprecated/index.ts
// Folium 1.6 only: the `folium` object a client entry receives, with the names
// Folium 2 removes kept working for mods written for Folium 1.5 (oldNames.ts
// lists them), and folium.internals as it was (internals.ts). Each old name a
// mod uses is said once per mod, in the mod's row next to the main side's
// (warnings.ts: "removed in Folium 2, use <new name>"); a mod that uses none
// gets nothing. An old name on a context, a settings handle or `folium` is there
// as it was, a plain member that a spread copies; every old name is said when
// it is used (called, or a member of it read), so a mod that only copies the
// object it was given is not told about names it never uses. The rest of src/mods calls only the new names: this file reads the old
// ones where a mod hands them in (its `folium` object, its definitions, the
// contexts its mounts receive). Its main half is electron/modSystem/deprecated.cjs.
//
// Step 2 (Folium 2, Folia 0.8.0) deletes this folder, deprecated.cjs, and these
// connection points, and nothing else:
//   - src/mods/runtime/clientLoader.ts: the import of ./warnings, and in activate
//     the clearFoliumOldNames line and the addOldClientNames line (it imports
//     this folder);
//   - electron/modSystem/manifest.cjs, modApi.cjs, nodeEntry.cjs, modSystem.cjs:
//     the require of deprecated.cjs and its use in each (deprecated.cjs says
//     which line);
//   - src/mods/types.ts: ModRuntimeInfo.warnings;
//   - src/mods/folium/lyricsSource.ts: isFoliumLegacyLyricsResult,
//     resolveLegacyLyricsResult, the line that calls them and the parseLRC
//     import; contract.ts: FoliumLegacyLyricsResult, its place in getLyrics,
//     and the header's words on it; registries/omniProviders.ts: the imports
//     of ../deprecated/ and the line in getLyrics that says the old answer;
//   - src/mods/manager/ModListItem.tsx: the import of ./warnings, NO_OLD_NAMES,
//     the two lines that read both sides' lines, the box that lists them, and
//     the locale key mods.oldNames (zh-CN, en, in);
//   - dev/folium/check.mjs: its old-name warnings (oldNameWarningsIn, `warnings`)
//     and the FOLIUM_OLD_REGISTRY_NAMES line in the registries loop;
//   - dev/folium/api-docs.mjs: the table of old names (oldNamesSection and
//     OLD_NAMES_HEADING), its line in the contents and its out.push in
//     renderApiDocs, the imports of oldNames.ts and deprecated.cjs, and the
//     header lines that name them;
//   - tests: foliumDeprecatedMain.test.ts and foliumDeprecatedClient.test.ts
//     in test/unit/mod-system/, and test/fixtures/folium-1.5-mods/; in
//     foliumExperimental.test.ts the two cases of the Folium 1.3 lyrics answer
//     and OLD_LYRICS_LINE;
//     manifest.test.ts gets back its case "refuses a field it does not know"
//     (taken out with deprecated.cjs).
// Then FOLIUM_VERSION goes to major 2 (contract.ts, foliumShared.json), and the
// words that name 1.x with it: the header and the FoliumHostInfo comment of
// contract.ts, the version comment of electron/modSystem/manifest.cjs.
// Then the generated files are made again, or their tests fail:
// docs/folium/api.md with `npm run folium:api` (foliumApiDocs.test.ts), and
// mods/folium.d.ts with `npm run folium:types` (foliumAuthorTools.test.ts).
// The hand-written docs lose their old-name paragraphs and say Folium 2 where
// they say 1, 1.6 or "folium": 1: docs/folium/contributing.md, mods/README.md,
// and src/mods/README.md (its sentence on this folder).
// The tests in test/unit/mod-system/ that write a mod.json say `folium: 2`:
// manifest, modSystemTrust, modSystemGate, modSystemFileGrants,
// modSystemDiscovery, modSafeStart, foliumAuthorTools, and the `plain` mod of
// modSignature. Two cases expect `folium: 2` to be refused; they turn round and
// take another number: manifest.test.ts "rejects an unsupported folium
// version", and foliumAuthorTools.test.ts "reports a manifest the app would
// refuse" (its expected words then say "this host implements folium 2").
// sampleMods.test.ts says "Folium 1" in its header and in a case title.
// A signature covers every file of a mod, mod.json too, and is made outside
// this repository (folium-compound: tools/sign.mjs), so the maintainer does
// these: the samples in mods/ declare "folium": 2 and are re-signed
// (sampleMods.test.ts wants each one verified);
// test/fixtures/folium-signature/official-fixture declares 2 and is re-signed
// (the loader case of modSignature.test.ts loads it, and its old signature
// fails on the changed mod.json). That loader case also loads the vector tree
// of modSignature.test.ts, which is shared byte for byte with folium-compound
// (test/signing.test.mjs there): it changes in both, with VECTOR_DIGEST and
// VECTOR_SIGNATURE, or the loader case gets a tree of its own.

/** Says one old name, once per mod: `where` is the name as the mod used it. */
type Warn = (where: string, row: FoliumOldName, now?: string) => void;

type Mount = (container: HTMLElement, ctx: Record<string, unknown>) => unknown;

// The two clocks a context can carry, each with its on-time helper.
const CLOCKS = [['lyricTime', 'onLyricTime'], ['playbackTime', 'onPlaybackTime']] as const;

/*
 * The settings access Folium 1.5 called `params` (`where` says whose), with `subscribe` for `onChange`.
 * Each use says `where` once; `subscribe` also says its own name.
 */
const oldSettingsAccess = (settings: FoliumSettingAccess, where: string, now: string, warn: Warn) => {
    const use = () => warn(where, OLD.params, now);
    return Object.freeze({
        get schema() {
            use();
            return settings.schema;
        },
        get: () => {
            use();
            return settings.get();
        },
        set: (patch: Record<string, unknown>) => {
            use();
            settings.set(patch);
        },
        reset: () => {
            use();
            settings.reset();
        },
        subscribe: (listener: () => void) => {
            use();
            warn('params.subscribe', OLD.settingsSubscribe);
            return settings.onChange(listener);
        },
    });
};

/*
 * A mount context with the names Folium 2 removed: `subscribe`, `currentTime` (with its `on`) and `onTime` for
 * the context's clock, and `params` for a settings panel's `settings`. Each says its name when it is used.
 */
const withOldContextNames = (ctx: Record<string, unknown>, warn: Warn): Record<string, unknown> => {
    const old: Record<string, unknown> = {};
    const onChange = ctx.onChange as ((listener: () => void) => FoliumDisposer) | undefined;
    if (typeof onChange === 'function') {
        old.subscribe = (listener: () => void) => {
            warn('ctx.subscribe', OLD.subscribe);
            return onChange(listener);
        };
    }
    const found = CLOCKS.find(([name]) => ctx[name]);
    if (found) {
        const [name, helper] = found;
        const clock = ctx[name] as FoliumClock;
        const listen = ctx[helper] as (listener: (seconds: number) => void) => FoliumDisposer;
        old.currentTime = Object.freeze({
            get: () => {
                warn('ctx.currentTime', OLD.currentTime, `ctx.${name}`);
                return clock.get();
            },
            on: (_event: 'change', listener: (seconds: number) => void) => {
                warn('ctx.currentTime.on', OLD.clockOn, `ctx.${helper}`);
                return listen(listener);
            },
        });
        old.onTime = (listener: (seconds: number) => void) => {
            warn('ctx.onTime', OLD.onTime, `ctx.${helper}`);
            return listen(listener);
        };
    }
    if (ctx.settings) {
        old.params = oldSettingsAccess(ctx.settings as FoliumSettingAccess, 'ctx.params', 'ctx.settings', warn);
    }
    return Object.freeze({ ...ctx, ...old });
};

// The container name progress buttons had, in a selector or CSS: `data-folium-kind="control-button"`.
const OLD_MOUNT_NAME = /(data-folium-kind\s*[~|^$*]?=\s*["']?)control-button\b/g;

const renameOldMount = (text: string, warn: Warn): string => {
    let found = false;
    const renamed = text.replace(OLD_MOUNT_NAME, (_match, head: string) => {
        found = true;
        return `${head}progress-button`;
    });
    if (found) warn(OLD.controlButtonMount.old, OLD.controlButtonMount);
    return renamed;
};

/* A Ponder target with the old container name renamed in its selectors (`hoverSelector`, a dom anchor's `selector`). */
const renameOldMountIn = (value: unknown, warn: Warn, key?: string): unknown => {
    if (typeof value === 'string') return key === 'hoverSelector' || key === 'selector' ? renameOldMount(value, warn) : value;
    if (Array.isArray(value)) return value.map((item) => renameOldMountIn(item, warn));
    if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, renameOldMountIn(item, warn, name)]));
    }
    return value;
};

/*
 * A definition as the registry of `kind` takes it now: its mounts get contexts with the old names, a
 * tuning's `params` is its `settings`, and a style's CSS names progress buttons by their container name now.
 * Anything that is not an object is the registry's to refuse.
 */
const withOldDefinitionNames = (kind: FoliumKindName, def: unknown, warn: Warn): unknown => {
    if (def === null || typeof def !== 'object') return def;
    let next = def as Record<string, unknown>;
    for (const field of ['mount', 'settingsPanel']) {
        const mount = next[field];
        if (typeof mount === 'function') {
            next = { ...next, [field]: (container: HTMLElement, ctx: Record<string, unknown>) => (mount as Mount)(container, withOldContextNames(ctx, warn)) };
        }
    }
    if (kind === 'tunings' && 'params' in next && !('settings' in next)) {
        warn('tunings.register({ params })', OLD.tuningParams);
        const { params, ...rest } = next;
        next = { ...rest, settings: params };
    }
    if (kind === 'styles' && typeof next.css === 'string') {
        next = { ...next, css: renameOldMount(next.css, warn) };
    }
    return next;
};

// The host objects of folium.internals, made once, for every mod that is given them.
let internalsPromise: Promise<Record<string, unknown>> | null = null;

/* The host objects for the mod, loaded only for one that may have them: in the main window, with a `folia` range. */
const loadInternals = (mod: ModRuntimeInfo, context: FoliumContextKind) => (context === 'main' && mod.folia
    ? (internalsPromise ??= import('./internals').then((module) => module.createFoliumInternals()))
    : Promise.resolve(null));

/*
 * `folium.internals` as it was in Folium 1.5: `available` for a mod that names the Folia versions it runs on
 * (mod.json `folia`), in the main window; reading a member anywhere else throws. Reading a member is its
 * use, and says so. Synchronous, because a promise would read the proxy's `then`.
 */
const gateInternals = (available: Record<string, unknown> | null, mod: ModRuntimeInfo, context: FoliumContextKind, warn: Warn) => (
    new Proxy(Object.freeze({ ...available }), {
        get: (target, property) => {
            if (typeof property !== 'string') return undefined;
            warn(OLD.internals.old, OLD.internals);
            if (!mod.folia || available === null) {
                throw new Error(mod.folia
                    ? `internals-unavailable-in-${context}-context`
                    : 'internals-require-folia-range (pin host versions with "folia" in mod.json)');
            }
            if (!(property in target)) throw new Error(`internals-unknown:${property}`);
            return (target as Record<string, unknown>)[property];
        },
    })
);

/*
 * `folium.experimental` as the mod's own (the gate api.ts built), except that a Ponder target's selectors get
 * the new container name. The proxy's own target is empty, so what it reports for a key is the gate's with
 * `configurable` set: a proxy may not report a key its target lacks as non-configurable.
 */
const withOldExperimentalNames = (experimental: Record<string, unknown>, warn: Warn) => {
    let ponderTargets: unknown = null;
    const read = (property: string | symbol, surface: unknown) => {
        if (property !== FOLIUM_EXPERIMENTAL.ponderTargets) return surface;
        ponderTargets ??= Object.freeze({
            register: (def: unknown) => (surface as { register: (def: unknown) => unknown }).register(renameOldMountIn(def, warn)),
        });
        return ponderTargets;
    };
    return new Proxy({}, {
        get: (_target, property) => read(property, Reflect.get(experimental, property)),
        has: (_target, property) => Reflect.has(experimental, property),
        ownKeys: () => Reflect.ownKeys(experimental),
        getOwnPropertyDescriptor: (_target, property) => {
            const descriptor = Reflect.getOwnPropertyDescriptor(experimental, property);
            return descriptor && { ...descriptor, value: read(property, descriptor.value), configurable: true };
        },
    });
};

/**
 * The `folium` object `api` with the client names Folium 2 removed, for the mod `mod`. Each old name is said
 * once per activation (clientLoader.ts empties the mod's list when it starts the client). Without old names it acts as `api` does.
 */
export const addOldClientNames = async (
    api: FoliumClientApi,
    mod: ModRuntimeInfo,
    context: FoliumContextKind,
): Promise<FoliumClientApi> => {
    const said = new Set<string>();
    const warn: Warn = (where, row, now) => {
        if (said.has(where)) return;
        said.add(where);
        const line = `${where}: ${foliumOldNameAdvice({ now: now ?? row.now, advice: row.advice })}`;
        console.warn(`[Folium:${mod.id}] ${line}`);
        noteFoliumOldName(mod.id, line);
    };

    const registries: Record<string, unknown> = {};
    FOLIUM_KIND_NAMES.forEach((name) => {
        const registry = api.registries[name] as { register: (def: unknown) => unknown };
        registries[name] = Object.freeze({
            register: (def: unknown) => {
                const handle = registry.register(withOldDefinitionNames(name, def, warn)) as Record<string, unknown>;
                if (name !== 'settingsSections') return handle;
                const params = oldSettingsAccess(handle.settings as FoliumSettingAccess, 'settingsSections.register(…).params', '.settings', warn);
                return Object.freeze({ ...handle, params });
            },
        });
    });
    // Not listed among the registries' keys, which stay the kinds table's; said when its register is called.
    Object.entries(FOLIUM_OLD_REGISTRY_NAMES).forEach(([old, now]) => {
        const current = registries[now] as { register: (def: unknown) => unknown };
        Object.defineProperty(registries, old, {
            value: Object.freeze({
                register: (def: unknown) => {
                    warn(`folium.registries.${old}`, OLD.controlButtons);
                    return current.register(def);
                },
            }),
        });
    });

    return Object.freeze({
        ...api,
        registries: Object.freeze(registries) as unknown as FoliumClientApi['registries'],
        events: Object.freeze({
            ...api.events,
            on: ((type, handler, options) => {
                // Folium 1.5 took any name and never called a handler for one that is no event.
                if (!Object.hasOwn(FOLIUM_EVENT_TYPES, type)) {
                    warn(`folium.events.on('${String(type)}')`, OLD.unknownEvent);
                    return () => {};
                }
                return api.events.on(type, handler, options);
            }) as FoliumClientApi['events']['on'],
        }),
        experimental: withOldExperimentalNames(api.experimental, warn),
        internals: gateInternals(await loadInternals(mod, context), mod, context, warn),
    });
};
