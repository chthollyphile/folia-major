// electron/modSystem/modFiles.cjs
// Where a mod keeps its files (Folium 1.5 `api.storage.paths`) and the mods panel's view of them:
// the per-mod directory layout, the disk usage it shows, and its "clear cache" action. Nothing here
// follows a symbolic link or junction, so neither counting nor clearing can reach outside the
// directories the host made.

'use strict';

// original-fs: a .asar file in a mod directory is a file here, not a directory (rawFs.cjs).
const { rawFs: fs } = require('./rawFs.cjs');
const path = require('path');

const { MOD_ID_PATTERN } = require('./manifest.cjs');

const DATA_ROOT = 'mods-data';
const CACHE_ROOT = 'mods-cache';
// Under the data directory, beside mod-data.json (the `storage.data` file), never holding it.
const FILES_DIRECTORY = 'files';
// lstat calls in flight while counting a directory tree.
const LSTAT_BATCH = 64;

/*
 * The three directories of one mod. The id becomes a path segment, so it must be a validated
 * manifest id (MOD_ID_PATTERN): never a directory name or a loader map key, which can be anything.
 */
const resolveModStorageDirs = (userDataDir, modId) => {
    if (typeof modId !== 'string' || !MOD_ID_PATTERN.test(modId)) {
        throw new Error('invalid-mod-id');
    }
    const dataDir = path.join(userDataDir, DATA_ROOT, modId);
    return {
        dataDir,
        filesDir: path.join(dataDir, FILES_DIRECTORY),
        cacheDir: path.join(userDataDir, CACHE_ROOT, modId),
    };
};

const isMissing = (error) => error?.code === 'ENOENT' || error?.code === 'ENOTDIR';

/*
 * An entry below the root that went away while we counted, as a running mod may be writing or
 * deleting meanwhile: deleted, replaced by a file, or, on Windows, deleted while something still
 * holds it open, which lstat and readdir answer with EPERM until the last handle closes.
 */
const isVanishing = (error) => isMissing(error) || error?.code === 'EPERM';

// lstat, or null when the entry is gone (`isGone` says which errors mean that).
const lstatOrNull = async (target, isGone = isMissing) => {
    try {
        return await fs.promises.lstat(target);
    } catch (error) {
        if (isGone(error)) return null;
        throw error;
    }
};

/*
 * Bytes of the regular files under `dir`, recursively. A missing directory counts 0, and so does a
 * root that is itself a link; links inside are neither counted nor descended into (readdir lists a
 * link as a link, and lstat sizes the link, which is skipped). The tree is walked one directory at a
 * time instead of with a recursive readdir, which rejects as a whole when any subdirectory vanishes
 * mid-walk: here a subdirectory or file that goes away is just left out, and the rest still counts.
 */
const measureDirectoryBytes = async (dir) => {
    const root = await lstatOrNull(dir);
    if (!root || !root.isDirectory()) {
        return 0;
    }
    const files = [];
    const pending = [dir];
    while (pending.length > 0) {
        const current = pending.pop();
        let entries;
        try {
            entries = await fs.promises.readdir(current, { withFileTypes: true });
        } catch (error) {
            // The root itself going away still counts 0; any other failure on it is a real one.
            if (current === dir ? isMissing(error) : isVanishing(error)) continue;
            throw error;
        }
        entries.forEach((entry) => {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) pending.push(entryPath);
            else if (entry.isFile()) files.push(entryPath);
        });
    }
    let total = 0;
    for (let start = 0; start < files.length; start += LSTAT_BATCH) {
        const stats = await Promise.all(files.slice(start, start + LSTAT_BATCH)
            .map((file) => lstatOrNull(file, isVanishing)));
        stats.forEach((stat) => {
            if (stat?.isFile()) total += stat.size;
        });
    }
    return total;
};

/*
 * Whether `dir` is there but cannot serve as a directory: a stray file, or a link whose target is gone
 * or is not a directory (one that cannot be followed at all counts too). mkdir cannot create the
 * directory over such an entry, so `api.storage.paths` throws on every read until it is removed, which
 * clearDirectoryContents does. A missing entry is not broken (the next read creates it), and neither
 * is a link to a live directory: the mod can use it, it is only never counted.
 */
const isBrokenDirectory = async (dir) => {
    const entry = await lstatOrNull(dir);
    if (!entry || entry.isDirectory()) {
        return false;
    }
    if (!entry.isSymbolicLink()) {
        return true;
    }
    try {
        return !(await fs.promises.stat(dir)).isDirectory();
    } catch {
        return true;
    }
};

/*
 * Empties `dir` but keeps it, so a running mod's open handle on the directory stays valid. A root
 * that is a link (or a stray file) is removed as an entry instead: emptying it would delete what it
 * points to. Each child is removed on its own, links as links, with Windows' transient EBUSY/EPERM
 * retried; returns how many went and how many could not, so a partial failure is reported as one.
 */
const clearDirectoryContents = async (dir) => {
    const root = await lstatOrNull(dir);
    if (!root) {
        return { cleared: 0, failed: 0 };
    }
    let targets = [dir];
    if (root.isDirectory()) {
        try {
            targets = (await fs.promises.readdir(dir)).map((name) => path.join(dir, name));
        } catch (error) {
            if (isMissing(error)) return { cleared: 0, failed: 0 };
            throw error;
        }
    }
    let cleared = 0;
    let failed = 0;
    for (const target of targets) {
        try {
            await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3 });
            cleared += 1;
        } catch {
            failed += 1;
        }
    }
    return { cleared, failed };
};

module.exports = {
    CACHE_ROOT,
    DATA_ROOT,
    FILES_DIRECTORY,
    clearDirectoryContents,
    isBrokenDirectory,
    measureDirectoryBytes,
    resolveModStorageDirs,
};
