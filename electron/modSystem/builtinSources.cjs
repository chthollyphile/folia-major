// electron/modSystem/builtinSources.cjs
// The host's trusted table of the built-in sources (Folium 2.0 plan §5.1): which mod may claim which short
// source id, and the old data that id's sign-in lives in (main-process electron-store keys, session
// partitions, userData folders) and the native files the app ships for it. Only a built-in copy and an
// officially signed override of it (same mod id) are granted a row; a mod that takes over a source the
// installation does not carry brings its own `sources[].claims` instead (sourceOwnership.cjs). No key here is
// ever renamed: an older Folia reads the same keys, so going back keeps the sign-in.
//
// Which sources an installation carries is the app's own declaration, `foliaBundledSources` in the app's
// package.json (written at build time, like `foliaReleaseChannel`). Without it the installation carries all
// nine.

'use strict';

// The app's package.json lies inside app.asar in a packaged app: the asar-aware fs reads it (original-fs could not).
const fs = require('fs');
const path = require('path');

/*
 * modId -> the row. `sources` are the short source ids the mod claims; `storeKeys`, `partitions` and
 * `userDataDirs` are what `api.legacy.store`, `api.net.session` and `api.paths.legacy` reach, and what
 * "clear data" removes; `native` names what `api.native.load` / `path` resolve. The keys are written out
 * here, not read from the platform modules, so this file loads nothing of theirs; builtinSources.test.ts
 * holds them to the constants those modules use today.
 *
 * `legacyCacheDirs` (only where a row has it): folders under the host's media cache folder (the one the listener may
 * choose) the built-in platform kept a cache of its own in. `api.cache.legacyDir(name)` reaches them, so files kept
 * before still count, and the source keeps them where the listener wanted the cache.
 *
 * `legacyMediaSchemes` (only where a row has it): a privileged scheme the built-in platform served its media under
 * before it became a mod (`folia-<platform>://cover?coverId=…`). Songs saved then (history, queues, playlists, the
 * scratchpad) keep those addresses, so the host goes on answering the scheme: `<scheme>://<name>?<query>` (or
 * `<scheme>:///<name>/…`) reaches the mod's `api.media.serve(name)` route as folia-mod://<mod id>/_media/<name>/…
 * would, while the mod runs. New addresses are folia-mod:// ones; a scheme is never added for a new source.
 */
const BUILTIN_SOURCE_TABLE = Object.freeze({
    netease: Object.freeze({
        sources: ['netease'],
        // The sign-in lives in the window's localStorage (online_provider:netease:*), not here.
        storeKeys: [],
        partitions: [],
        userDataDirs: [],
        native: [],
    }),
    kugou: Object.freeze({
        sources: ['kugou'],
        storeKeys: ['KUGOU_API_SESSION_V2', 'KUGOU_API_SESSION_V1'],
        partitions: [],
        userDataDirs: [],
        native: [],
    }),
    qq: Object.freeze({
        sources: ['qq'],
        storeKeys: ['QQ_API_AUTH_SESSION_V1'],
        partitions: [],
        userDataDirs: ['qq-auth-state'],
        native: [],
    }),
    bodian: Object.freeze({
        sources: ['bodian'],
        storeKeys: ['BODIAN_SESSION_V2', 'BODIAN_DEVICE_ID'],
        partitions: [],
        userDataDirs: [],
        native: [],
    }),
    qishui: Object.freeze({
        sources: ['qishui'],
        storeKeys: ['QISHUI_SESSION_V1', 'QISHUI_DEVICE_ID'],
        partitions: [],
        userDataDirs: [],
        native: [],
    }),
    ytm: Object.freeze({
        sources: ['ytm'],
        storeKeys: ['YTM_SESSION_V1', 'YTM_WEB_SESSION_V1'],
        // The second partition holds no sign-in: the hidden sandbox page of the player's own code ran in it, kept in memory.
        partitions: ['folia-ytm', 'folia-ytm-sandbox'],
        userDataDirs: ['ytm-sign-in'],
        native: [],
    }),
    spotify: Object.freeze({
        sources: ['spotify'],
        storeKeys: ['SPOTIFY_SESSION_V1', 'SPOTIFY_SOLOIST_V1', 'SPOTIFY_PLAYBACK_V1', 'SPOTIFY_DEVICE_ID'],
        partitions: ['folia-spotify'],
        userDataDirs: ['soloist'],
        native: ['librespot'],
        // Its encrypted audio files, in a folder of the media cache folder the listener chose (api.cache.legacyDir).
        legacyCacheDirs: ['spotify'],
    }),
    'apple-music': Object.freeze({
        sources: ['appleMusic'],
        storeKeys: [],
        partitions: [],
        userDataDirs: ['apple-music-companion'],
        native: ['apple-music-companion'],
    }),
    fnmusic: Object.freeze({
        sources: ['fnmusic'],
        storeKeys: ['fnmusic-config', 'fnmusic-device-id'],
        partitions: [],
        userDataDirs: [],
        native: [],
        // Saved songs' covers and streams (cover?coverId=…&size=…, stream?guid=…): main.cjs's own scheme before.
        // Answered by this built-in mod only: a third-party mod that takes the short id over (takeover) does not get it,
        // and the saved addresses of the old scheme answer 404 while it holds the id. Its routes need not mean the same thing.
        legacyMediaSchemes: ['folia-fnmusic'],
    }),
    // The tenth, added after the nine platforms moved (2026-11-21): it runs LX Music "custom source" scripts the
    // listener imports. No sign-in and nothing from before it was a mod, so no keys or folders; the partition is the
    // in-memory one of the hidden sandbox page those scripts run in.
    lxmusic: Object.freeze({
        sources: ['lxmusic'],
        storeKeys: [],
        partitions: ['folia-lxmusic-sandbox'],
        userDataDirs: [],
        native: [],
    }),
});

/** Every short source id the table knows, in the table's order. */
const BUILTIN_SOURCE_IDS = Object.freeze(Object.values(BUILTIN_SOURCE_TABLE).flatMap((row) => row.sources));

/** The row of `modId`, or null. */
const builtinSourceRow = (modId) => (Object.hasOwn(BUILTIN_SOURCE_TABLE, modId) ? BUILTIN_SOURCE_TABLE[modId] : null);

/** The mod id whose row claims the short source id `sourceId`, or null. */
const builtinModOfSource = (sourceId) => (
    Object.keys(BUILTIN_SOURCE_TABLE).find((modId) => BUILTIN_SOURCE_TABLE[modId].sources.includes(sourceId)) ?? null
);

/*
 * The short source ids this installation carries: `foliaBundledSources` of the app's package.json. A
 * missing or unreadable field reads as all of BUILTIN_SOURCE_IDS (every installation before Folium 2.0
 * carries the nine); a field that is not a list of strings counts as missing too, so a broken declaration
 * can never open the takeover of a source the installation does carry. `readFile` is for tests.
 */
const readBundledSources = (appPath, { readFile = (file) => fs.readFileSync(file, 'utf8') } = {}) => {
    try {
        const declared = JSON.parse(readFile(path.join(appPath, 'package.json'))).foliaBundledSources;
        if (Array.isArray(declared) && declared.every((id) => typeof id === 'string')) {
            return { ids: Object.freeze([...new Set(declared)]), declared: true };
        }
    } catch {
        // No package.json to read: an installation as it always was.
    }
    return { ids: BUILTIN_SOURCE_IDS, declared: false };
};

/** Every legacy media scheme of the table, with the mod that answers it, in the table's order. */
const BUILTIN_LEGACY_MEDIA_SCHEMES = Object.freeze(Object.entries(BUILTIN_SOURCE_TABLE).flatMap(([modId, row]) => (
    (row.legacyMediaSchemes ?? []).map((scheme) => Object.freeze({ scheme, modId }))
)));

module.exports = {
    BUILTIN_LEGACY_MEDIA_SCHEMES,
    BUILTIN_SOURCE_TABLE,
    BUILTIN_SOURCE_IDS,
    builtinSourceRow,
    builtinModOfSource,
    readBundledSources,
};
