'use strict';

const crypto = require('crypto');
const fs = require('fs');

// electron/modSystem/fileGrants.cjs
// Persistent file grants behind folium.ui.pickFile({ persist: true }) and
// folium.ui.restoreFile. A grant records a file the user picked for one mod,
// so the mod can get it back after a restart without ever seeing its path:
// the mod holds an opaque grant id, and restoring hands out a fresh session
// URL. Grants belong to a mod id; another mod's id never resolves.

const GRANT_ID_PATTERN = /^[0-9a-f]{32}$/;
// Per-mod cap; the oldest grant goes first. A mod that never releases what it
// replaces cannot grow the record without bound.
const MAX_GRANTS_PER_MOD = 32;

const isRegularFile = (filePath) => {
    try {
        return fs.statSync(filePath).isFile();
    } catch {
        return false;
    }
};

/*
 * readGrants(modId) / writeGrants(modId, grants) persist one mod's
 * `{ [grantId]: { path, grantedAt } }` (electron-store in the loader, a Map in
 * tests). Every method is synchronous and never throws on a bad record.
 */
const createFileGrantStore = ({ readGrants, writeGrants, maxGrantsPerMod = MAX_GRANTS_PER_MOD }) => {
    const read = (modId) => {
        try {
            const stored = readGrants(modId);
            return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
        } catch {
            return {};
        }
    };

    const write = (modId, grants) => {
        try {
            writeGrants(modId, grants);
        } catch {
            // Best-effort: the grant still works for this session.
        }
    };

    /** Records `filePath` for `modId`; returns the new grant id. */
    const add = (modId, filePath) => {
        const grants = read(modId);
        const grantId = crypto.randomBytes(16).toString('hex');
        grants[grantId] = { path: filePath, grantedAt: Date.now() };
        const ids = Object.keys(grants).sort((left, right) => (grants[left].grantedAt ?? 0) - (grants[right].grantedAt ?? 0));
        ids.slice(0, Math.max(0, ids.length - maxGrantsPerMod)).forEach((id) => { delete grants[id]; });
        write(modId, grants);
        return grantId;
    };

    /*
     * The granted path when `grantId` belongs to `modId` and still names a
     * regular file; null otherwise. A grant whose file is gone is dropped.
     */
    const resolve = (modId, grantId) => {
        if (typeof grantId !== 'string' || !GRANT_ID_PATTERN.test(grantId)) return null;
        const grants = read(modId);
        const grant = Object.hasOwn(grants, grantId) ? grants[grantId] : null;
        if (!grant || typeof grant.path !== 'string') return null;
        if (!isRegularFile(grant.path)) {
            delete grants[grantId];
            write(modId, grants);
            return null;
        }
        return grant.path;
    };

    /** Forgets one grant; true when it existed. */
    const release = (modId, grantId) => {
        const grants = read(modId);
        if (typeof grantId !== 'string' || !Object.hasOwn(grants, grantId)) return false;
        delete grants[grantId];
        write(modId, grants);
        return true;
    };

    return { add, resolve, release };
};

module.exports = { createFileGrantStore, MAX_GRANTS_PER_MOD };
