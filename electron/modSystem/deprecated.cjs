// electron/modSystem/deprecated.cjs
// Folium 1.6 only: the names of mod.json and of the main entry's api that
// Folium 2 removes, kept working for mods written for Folium 1.5. Each old name
// a mod uses is said once per mod, in the mod's row ("removed in Folium 2, use
// <new name>"); a mod that uses none gets nothing. The rest of electron/ calls
// only the new names: this file reads the old ones where a mod hands them in.
// Its client half is src/mods/folium/deprecated/.
//
// Step 2 (Folium 2, Folia 0.8.0) deletes this file, src/mods/folium/deprecated/,
// and these connection points, and nothing else:
//   - electron/modSystem/manifest.cjs: the require of this file, and the
//     `raw = readOldManifest(raw, manifest)` line in validateManifest (an
//     unknown mod.json field is then an error again);
//   - electron/modSystem/modApi.cjs: the require, and `addOldMainNames(` around
//     the object createModApi returns;
//   - electron/modSystem/nodeEntry.cjs: the require, and readOldActivation in
//     keepDisposer (its parameter is `activation` again);
//   - electron/modSystem/modSystem.cjs: the require, `warnings` in
//     publicModState, the onOldNameWarning line and stopOldNameWarnings() in
//     dispose;
//   - src/mods/runtime/clientLoader.ts: the import of
//     src/mods/folium/deprecated/warnings.ts, and in activate the
//     clearFoliumOldNames line and the addOldClientNames line (it imports
//     src/mods/folium/deprecated/);
//   - src/mods/types.ts: ModRuntimeInfo.warnings;
//   - src/mods/manager/ModListItem.tsx: the import of
//     src/mods/folium/deprecated/warnings.ts, NO_OLD_NAMES, the two lines that
//     read both sides' lines (`mod.warnings` and the client's), the box that
//     lists them, and the locale key mods.oldNames (zh-CN, en, in);
//   - dev/folium/check.mjs: its old-name warnings (oldNameWarningsIn, `warnings`)
//     and the FOLIUM_OLD_REGISTRY_NAMES line in the registries loop;
//   - dev/folium/api-docs.mjs: the table of old names (oldNamesSection and
//     OLD_NAMES_HEADING), its line in the contents and its out.push in
//     renderApiDocs, the imports of oldNames.ts and this file, and the header
//     lines that name them;
//   - tests: foliumDeprecatedMain.test.ts and foliumDeprecatedClient.test.ts
//     in test/unit/mod-system/, and
//     test/fixtures/folium-1.5-mods/; manifest.test.ts gets back its case
//     "refuses a field it does not know" (taken out with this file's first commit).
// Then FOLIUM_VERSION goes to major 2 (src/mods/folium/contract.ts,
// foliumShared.json), and the words that name 1.x with it: the header and the
// FoliumHostInfo comment of contract.ts, the version comment of manifest.cjs.
// Then the generated files are made again, or their tests fail:
// docs/folium/api.md with `npm run folium:api` (foliumApiDocs.test.ts), and
// mods/folium.d.ts with `npm run folium:types` (foliumAuthorTools.test.ts).
// The hand-written docs lose their old-name paragraphs and say Folium 2 where
// they say 1, 1.6 or "folium": 1: docs/folium/contributing.md, mods/README.md,
// and src/mods/README.md (its sentence on src/mods/folium/deprecated/).
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

'use strict';

/*
 * The old names, one row each. `old` and `now` are the names as a mod writes them (`now` null: nothing
 * takes its place); `pattern` finds a use in a main entry's code for `npm run folium:check`, which reads
 * the code with comments and strings blanked out. docs/folium/api.md lists the rows (api-docs.mjs).
 */
const OLD_MAIN_NAMES = Object.freeze({
    storageData: { old: 'api.storage.data', now: 'api.storage', pattern: /\bapi\s*\??\.\s*storage\s*\??\.\s*data\b/ },
    lifecycle: { old: 'api.lifecycle.onDeactivate', now: 'api.onDispose', pattern: /\bapi\s*\??\.\s*lifecycle\b/ },
    experimental: { old: 'api.experimental', now: null, pattern: /\bapi\s*\??\.\s*experimental\b/ },
    disposeObject: {
        old: 'activate returning { dispose }',
        now: 'a function returned from activate, or api.onDispose',
        pattern: /\breturn\s*\{\s*dispose\b/,
    },
});

// Old permission ids in mod.json, each with the id that means the same now.
const OLD_PERMISSIONS = Object.freeze({
    'runtime.playback': 'playback.read',
    'ui.stage': 'stageLayers',
});

/** The words of the warning for one old name. */
const oldNameText = ({ old, now }) => (now === null
    ? `${old}: removed in Folium 2, nothing takes its place`
    : `${old}: removed in Folium 2, use ${now}`);

/*
 * The warnings, by the manifest object validateManifest returned for the mod. Each load reads mod.json
 * again into a new object, so a load starts with none, and "once per mod" is once per load.
 */
const warningsByManifest = new WeakMap();
const listeners = new Set();
let announcing = false;

/*
 * Keeps one warning for the mod of `manifest`, once. One that comes while the mod runs (`announce`: a
 * member read in an rpc handler) also goes to the console and is announced, so the mod's row shows it; the
 * announcement waits for the code running now to end, so a load under way finishes before the list is sent.
 * One from mod.json is read before the list is first sent.
 */
const warnOnce = (manifest, text, announce) => {
    let warnings = warningsByManifest.get(manifest);
    if (!warnings) {
        warnings = [];
        warningsByManifest.set(manifest, warnings);
    }
    if (warnings.includes(text)) {
        return;
    }
    warnings.push(text);
    if (!announce) {
        return;
    }
    console.warn(`[Mod:${manifest.id}] ${text}`);
    if (announcing) {
        return;
    }
    announcing = true;
    queueMicrotask(() => {
        announcing = false;
        listeners.forEach((listener) => listener());
    });
};

/** The warnings of the mod of `manifest` so far, oldest first. */
const oldNameWarnings = (manifest) => [...(warningsByManifest.get(manifest) ?? [])];

/** Calls `listener` after a running mod used an old name (modSystem.cjs sends the mod list again). */
const onOldNameWarning = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

/*
 * mod.json as a Folium 1.5 mod writes it. `manifest` is what validateManifest built from `raw`: an old
 * permission id in it becomes its new one, or goes when the new one is listed too. A field mod.json does not
 * have is a warning here, not an error. Returns `raw` without those fields, for the unknown-field check
 * that follows.
 */
const readOldManifest = (raw, manifest) => {
    const declared = manifest.permissions;
    manifest.permissions = declared.flatMap((permission) => {
        if (typeof permission !== 'string' || !Object.hasOwn(OLD_PERMISSIONS, permission)) {
            return [permission];
        }
        const now = OLD_PERMISSIONS[permission];
        warnOnce(manifest, oldNameText({ old: `mod.json permission "${permission}"`, now: `"${now}"` }), false);
        return declared.includes(now) ? [] : [now];
    });
    const known = {};
    Object.keys(raw).forEach((field) => {
        if (Object.hasOwn(manifest, field) || raw[field] === undefined) {
            known[field] = raw[field];
            return;
        }
        warnOnce(manifest, `unknown field "${field}" in mod.json (it can have: ${Object.keys(manifest).join(', ')}); Folium 2 refuses it`, false);
    });
    return known;
};

/*
 * The api of a mod's main entry, with the members Folium 2 removed added back: each is a getter that warns
 * once and hands out what the new member does. `api` is createModApi's own object, not yet given out.
 */
const addOldMainNames = (api, manifest) => {
    const warn = (row) => warnOnce(manifest, oldNameText(row), true);
    Object.defineProperty(api.storage, 'data', {
        get: () => {
            warn(OLD_MAIN_NAMES.storageData);
            return api.storage;
        },
    });
    const lifecycle = Object.freeze({ onDeactivate: (disposer) => api.onDispose(disposer) });
    Object.defineProperty(api, 'lifecycle', {
        get: () => {
            warn(OLD_MAIN_NAMES.lifecycle);
            return lifecycle;
        },
    });
    // It was always empty.
    const experimental = Object.freeze({});
    Object.defineProperty(api, 'experimental', {
        get: () => {
            warn(OLD_MAIN_NAMES.experimental);
            return experimental;
        },
    });
    return api;
};

/*
 * What `activate` returned, as nodeEntry.cjs keeps it: a `{ dispose }` object becomes its dispose function,
 * with a warning. Anything else comes back as it was.
 */
const readOldActivation = (activation, manifest) => {
    if (typeof activation === 'function' || !activation || typeof activation.dispose !== 'function') {
        return activation;
    }
    warnOnce(manifest, oldNameText(OLD_MAIN_NAMES.disposeObject), true);
    return () => activation.dispose();
};

module.exports = {
    OLD_MAIN_NAMES,
    OLD_PERMISSIONS,
    oldNameText,
    oldNameWarnings,
    onOldNameWarning,
    readOldManifest,
    addOldMainNames,
    readOldActivation,
};
