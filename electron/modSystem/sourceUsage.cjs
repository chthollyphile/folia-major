// electron/modSystem/sourceUsage.cjs
// How much one source keeps on disk, for its row in "Settings → Sources" (Folium 2.0 plan §5.3): the same things
// its "clear data" removes (modSystem.cjs describeSourceData), split into data and cache. Every folder is walked
// asynchronously (modFiles.cjs measureDirectoryBytes), so the page asks for it after it has drawn its rows.

'use strict';

const path = require('path');

const { measureDirectoryBytes } = require('./modFiles.cjs');

/*
 * Chromium's caches inside a partition's folder (`<userData>/Partitions/<name>`): what it fetched and compiled,
 * rebuilt on its own. The rest of the folder (cookies, local storage, IndexedDB) is the sign-in, counted as data.
 */
const PARTITION_CACHE_FOLDERS = Object.freeze([
    'Cache',
    'Code Cache',
    'GPUCache',
    'DawnCache',
    'DawnGraphiteCache',
    'DawnWebGPUCache',
    'GrShaderCache',
    'ShaderCache',
]);

// A partition's folder, split into the sign-in it keeps and Chromium's own caches.
const measurePartitionBytes = async (dir) => {
    const [total, ...caches] = await Promise.all([
        measureDirectoryBytes(dir),
        ...PARTITION_CACHE_FOLDERS.map((folder) => measureDirectoryBytes(path.join(dir, folder))),
    ]);
    const cache = caches.reduce((sum, bytes) => sum + bytes, 0);
    return { data: Math.max(0, total - cache), cache };
};

// The bytes an electron-store value takes in the settings file (its JSON text); a key not set takes none.
const storeValueBytes = (store, key) => {
    const value = store.get(key);
    if (value === undefined) return 0;
    try {
        return Buffer.byteLength(JSON.stringify(value) ?? '', 'utf8');
    } catch {
        return 0;
    }
};

/*
 * The disk use of one source, from what "clear data" would remove (`described`, describeSourceData's answer):
 *   data  = its mod data folder (storage file, secrets, files), the userData folders and old store keys its row or
 *           claims name, and what its on-disk partitions keep besides Chromium's caches;
 *   cache = its mod cache folder (`api.cache.dir()`), the folders under the media cache folder its row claims, and
 *           the Chromium caches in its partitions.
 * A partition kept in memory (no `persist:` prefix) has no folder and counts nothing; so does anything missing.
 * `partitionStoragePath(partition)` answers the folder of a `persist:` partition, or null. Throws when a folder
 * cannot be read; the caller answers that as "could not measure", never as 0.
 */
const measureSourceUsage = async ({ described, store, partitionStoragePath }) => {
    const partitionDirs = (described.partitions ?? [])
        .filter((partition) => typeof partition === 'string' && partition.startsWith('persist:'))
        .map((partition) => partitionStoragePath(partition))
        .filter((dir) => typeof dir === 'string' && dir.length > 0);
    const dataDirs = [described.modData, ...(described.userDataDirs ?? [])].filter(Boolean);
    const cacheDirs = [described.modCache, ...(described.cacheDirs ?? [])].filter(Boolean);
    const [dataBytes, cacheBytes, partitions] = await Promise.all([
        Promise.all(dataDirs.map((dir) => measureDirectoryBytes(dir))),
        Promise.all(cacheDirs.map((dir) => measureDirectoryBytes(dir))),
        Promise.all(partitionDirs.map((dir) => measurePartitionBytes(dir))),
    ]);
    const sum = (values) => values.reduce((total, bytes) => total + bytes, 0);
    const storeBytes = sum((described.storeKeys ?? []).map((key) => storeValueBytes(store, key)));
    return {
        data: sum(dataBytes) + storeBytes + sum(partitions.map((partition) => partition.data)),
        cache: sum(cacheBytes) + sum(partitions.map((partition) => partition.cache)),
    };
};

module.exports = {
    PARTITION_CACHE_FOLDERS,
    measureSourceUsage,
};
