// electron/modSystem/zipInstall.cjs
// The user's own mods folder, and installing a mod from a .zip into it: the
// size guards, reading the archive, finding the mod's root in it, and the
// staged swap that keeps a working install until its replacement is known to
// be good. Cut out of modSystem.cjs.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { unzipSync } = require('fflate');

const { validateManifest } = require('./manifest.cjs');

// Staged installs and their rollback copies live under this directory inside
// the user mods folder; discovery skips it (and every other dot-directory).
const STAGING_DIRECTORY = '.staging';

/*
 * Install guards. A .zip is untrusted input: it is size-checked before it is
 * read, entry-checked against its declared uncompressed sizes before anything
 * is inflated, and checked again against the real inflated bytes. The caps
 * match modDigest's, so anything installable is also verifiable.
 */
const INSTALL_LIMITS = {
    maxArchiveBytes: 64 * 1024 * 1024,
    maxEntries: 2000,
    maxTotalBytes: 64 * 1024 * 1024,
    maxFileBytes: 32 * 1024 * 1024,
};

/*
 * `app` is Electron's (where the user's data lives). The rest is the loader's:
 * `isModSystemEnabled` (nothing is installed while mods are switched off),
 * `loadAll` (run once the new files are in place), `emitLog`, and
 * `serializeError` (a failure as the text the mods page shows).
 */
const createZipInstall = ({ app, isModSystemEnabled, loadAll, emitLog, serializeError }) => {
    // The per-user writable mod directory (the packaged app's own tree is read-only).
    const getUserModsDirectory = () => path.join(app.getPath('userData'), 'mods');

    /*
     * Clears leftovers from an install that was interrupted (a crash or a kill
     * between extraction and the swap). Called once at startup, when no install
     * can be in flight, so it never races a live staging directory.
     */
    const pruneStagingDirectory = () => {
        try {
            fs.rmSync(path.join(getUserModsDirectory(), STAGING_DIRECTORY), { recursive: true, force: true });
        } catch {
            // Leftovers are inert (discovery skips dot-directories); ignore.
        }
    };

    /*
     * Reads a .zip into memory under the install limits. The archive size is
     * checked before the file is read, and each entry is checked against its
     * declared uncompressed size (and the running total) inside fflate's filter
     * — before that entry is inflated — so a zip bomb is refused rather than
     * expanded. The inflated bytes are then re-checked, because the declared
     * sizes come from the archive itself and are not trustworthy.
     */
    const readZipEntries = (zipPath) => {
        let archiveBytes = null;
        try {
            const stat = fs.statSync(zipPath);
            if (stat.size > INSTALL_LIMITS.maxArchiveBytes) {
                return { ok: false, error: 'install-too-large' };
            }
            archiveBytes = fs.readFileSync(zipPath);
        } catch {
            return { ok: false, error: 'install-corrupt-zip' };
        }

        let limitError = null;
        let declaredTotal = 0;
        let entryCount = 0;
        let archive;
        try {
            archive = unzipSync(archiveBytes, {
                filter: (file) => {
                    if (limitError) {
                        return false;
                    }
                    entryCount += 1;
                    if (entryCount > INSTALL_LIMITS.maxEntries) {
                        limitError = 'install-too-many-files';
                        return false;
                    }
                    if (file.originalSize > INSTALL_LIMITS.maxFileBytes) {
                        limitError = 'install-too-large';
                        return false;
                    }
                    declaredTotal += file.originalSize;
                    if (declaredTotal > INSTALL_LIMITS.maxTotalBytes) {
                        limitError = 'install-too-large';
                        return false;
                    }
                    return true;
                },
            });
        } catch {
            return { ok: false, error: limitError ?? 'install-corrupt-zip' };
        }
        if (limitError) {
            return { ok: false, error: limitError };
        }

        // Normalize + sanitize entry paths (reject traversal and absolute paths).
        const entries = [];
        let inflatedTotal = 0;
        for (const [rawPath, bytes] of Object.entries(archive)) {
            if (rawPath.endsWith('/')) continue; // directory marker
            const segments = rawPath.split('/').filter((segment) => segment !== '' && segment !== '.');
            if (segments.some((segment) => segment === '..' || segment.includes('\\'))) {
                return { ok: false, error: 'install-unsafe-path' };
            }
            if (path.isAbsolute(segments.join(path.sep))) {
                return { ok: false, error: 'install-unsafe-path' };
            }
            inflatedTotal += bytes.length;
            if (bytes.length > INSTALL_LIMITS.maxFileBytes || inflatedTotal > INSTALL_LIMITS.maxTotalBytes) {
                return { ok: false, error: 'install-too-large' };
            }
            entries.push({ segments, bytes });
        }
        if (entries.length === 0) {
            return { ok: false, error: 'install-empty-zip' };
        }
        return { ok: true, entries };
    };

    /*
     * Locates the manifest root: mod.json at the archive root, or under exactly
     * one top-level folder. Returns the depth to strip from every entry path.
     */
    const resolveArchiveRoot = (entries) => {
        const manifestEntries = entries.filter((entry) => entry.segments[entry.segments.length - 1] === 'mod.json');
        let rootDepth = 0;
        if (!manifestEntries.some((entry) => entry.segments.length === 1)) {
            const roots = new Set(manifestEntries.map((entry) => entry.segments[0]));
            if (roots.size !== 1) {
                return { ok: false, error: 'install-no-manifest' };
            }
            rootDepth = 1;
        }
        const manifestEntry = manifestEntries.find((entry) => entry.segments.length === rootDepth + 1);
        if (!manifestEntry) {
            return { ok: false, error: 'install-no-manifest' };
        }
        return { ok: true, rootDepth, manifestEntry };
    };

    /*
     * Installs a mod from a .zip into the per-user mod directory. The zip may
     * carry mod.json at its root or under exactly one top-level folder. The
     * install is staged: everything is written to a temporary directory next to
     * the target and verified there (manifest, declared main/client entry
     * files), and only then swapped into place — an existing install is kept
     * until the replacement is known-good, and restored if the swap fails.
     * Zip-slip is blocked and the archive is size-capped before extraction.
     *
     * A replaced mod's stored approval no longer matches the new content
     * digest, so an upgrade always lands disabled and must be confirmed again.
     */
    const installModFromZip = async (zipPath) => {
        if (!isModSystemEnabled()) {
            return { ok: false, error: 'mod-system-disabled' };
        }
        if (typeof zipPath !== 'string' || !zipPath.toLowerCase().endsWith('.zip')) {
            return { ok: false, error: 'install-not-zip' };
        }

        const read = readZipEntries(zipPath);
        if (!read.ok) {
            return { ok: false, error: read.error };
        }
        const { entries } = read;

        const root = resolveArchiveRoot(entries);
        if (!root.ok) {
            return { ok: false, error: root.error };
        }
        const { rootDepth, manifestEntry } = root;

        let manifest;
        try {
            manifest = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
        } catch {
            return { ok: false, error: 'install-invalid-manifest' };
        }
        const validation = validateManifest(manifest);
        if (!validation.ok) {
            return { ok: false, error: `install-invalid-manifest:${validation.errors.join('; ')}` };
        }

        const modId = validation.value.id;
        const target = path.join(getUserModsDirectory(), modId);
        const stagingRoot = path.join(getUserModsDirectory(), STAGING_DIRECTORY);
        const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
        const stagingDir = path.join(stagingRoot, `${modId}-${suffix}`);
        const backupDir = path.join(stagingRoot, `${modId}-backup-${suffix}`);
        let backupTaken = false;

        const removeQuietly = (directory) => {
            try {
                fs.rmSync(directory, { recursive: true, force: true });
            } catch {
                // Clean-up is best-effort.
            }
        };

        try {
            fs.mkdirSync(stagingDir, { recursive: true });
            for (const entry of entries) {
                // Directory markers were already filtered out, so every entry here
                // is a real file that must be written. `relative` is only empty for
                // a stray wrapper directory path, which has no file content to write.
                const relative = entry.segments.slice(rootDepth).join(path.sep);
                if (!relative) {
                    continue;
                }
                const destination = path.resolve(stagingDir, relative);
                if (destination !== stagingDir && !destination.startsWith(stagingDir + path.sep)) {
                    throw new Error('install-unsafe-path');
                }
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.writeFileSync(destination, Buffer.from(entry.bytes));
            }

            // Verify the staged tree before anything replaces a working install.
            if (validation.value.main && !fs.existsSync(path.join(stagingDir, validation.value.main))) {
                throw new Error('install-main-missing');
            }
            if (validation.value.client && !fs.existsSync(path.join(stagingDir, validation.value.client))) {
                throw new Error('install-client-missing');
            }

            // Atomic-ish swap: move the old copy aside, move the new one in, and
            // put the old one back if the second rename fails.
            if (fs.existsSync(target)) {
                fs.renameSync(target, backupDir);
                backupTaken = true;
            }
            try {
                fs.renameSync(stagingDir, target);
            } catch (error) {
                if (backupTaken) {
                    fs.renameSync(backupDir, target);
                    backupTaken = false;
                }
                throw error;
            }
            removeQuietly(backupDir);
            backupTaken = false;

            const modsAfterInstall = loadAll();
            emitLog(modId, 'info', `installed mod ${modId} from zip`);
            return { ok: true, id: modId, mods: modsAfterInstall };
        } catch (error) {
            removeQuietly(stagingDir);
            if (backupTaken) {
                try {
                    fs.rmSync(target, { recursive: true, force: true });
                    fs.renameSync(backupDir, target);
                } catch {
                    // The previous copy is still in the staging directory; the
                    // message below tells the user the install did not apply.
                }
            }
            removeQuietly(backupDir);
            return { ok: false, error: serializeError(error) };
        }
    };

    return { getUserModsDirectory, pruneStagingDirectory, installModFromZip };
};

module.exports = { createZipInstall, INSTALL_LIMITS, STAGING_DIRECTORY };
