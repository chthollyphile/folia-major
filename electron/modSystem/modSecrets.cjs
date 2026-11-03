// electron/modSystem/modSecrets.cjs
// Folium 1.7 `secret` settings values: what the client entry reads as `folium.secrets`, the main entry
// as `api.secrets`, and the settings form writes. One store per mod, keyed by the secret field's key.
//
// At rest a mod's values are one file, mods-data/<id>/secrets.json, beside mod-data.json and outside
// `api.storage.paths.data` (files/), so the mod's own file code never meets it and the mods panel's data
// usage counts it. Each value in it is sealed with Electron safeStorage (DPAPI on Windows, Keychain on
// macOS, libsecret/kwallet on Linux); only ciphertext reaches disk. Linux without a keyring selects
// `basic_text`, which "encrypts" with a hardcoded key: like an unavailable safeStorage, that keeps values
// in memory only, for this run (`state().persistent` is false and the form says so). Unlike the AI keys
// (aiCredentialStore.cjs), a mod's value is never written in plaintext: a mod is third-party code, and a
// paid key it asked for should not sit readable in userData.
//
// A key must be one a settings section of the mod declares as `secret`. The sections are registered in
// the window, which tells this store (`declare`) when the client registers one. That happens again on
// every start, after the main entry has already been activated, so until the first declaration of a run
// a key that holds a value counts as declared, and reading one that holds none gives null (has: false)
// rather than `secret-undeclared`: a main entry awaiting `get` in activate must not fail, or its client
// never starts and the key never gets declared. Writing a key with no value waits for the declaration.
// Values are strings of at most SECRET_MAX_BYTES. Nothing here logs a value.
//
// Every change, whoever made it (the form, a client, a main entry), goes to `onChange(modId, key)`, which
// the loader turns into the window's notice and the main entry's subscribers. The key only: the value
// never travels with a notice.

'use strict';

const fs = require('fs');
const path = require('path');

const { resolveModStorageDirs } = require('./modFiles.cjs');

const SECRETS_FILE_NAME = 'secrets.json';
// The longest value, in UTF-8 bytes. API keys and tokens are well below this.
const SECRET_MAX_BYTES = 8 * 1024;
// Bounds on what a window may declare for one mod: a schema key is a short name, and a mod has a few.
const SECRET_KEY_MAX_LENGTH = 128;
const SECRET_KEYS_PER_MOD = 64;

const isUsableKey = (key) => typeof key === 'string' && key.length > 0 && key.length <= SECRET_KEY_MAX_LENGTH;

/*
 * Whether values can be sealed for real. Asked at every use: Linux safeStorage is only usable after
 * app ready, and a keyring can come and go.
 */
const canSealWith = (safeStorage, platform) => {
    try {
        if (!safeStorage?.isEncryptionAvailable?.()) {
            return false;
        }
        if (platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function') {
            return safeStorage.getSelectedStorageBackend() !== 'basic_text';
        }
        return true;
    } catch {
        return false;
    }
};

/**
 * `userDataDir` is Electron's userData; `safeStorage` is Electron's (absent in tests, which then run
 * memory-only). `onChange(modId, key)` hears every change.
 */
const createModSecrets = ({
    userDataDir,
    safeStorage,
    platform = process.platform,
    warn = console.warn,
    log = console.log,
    onChange = () => {},
}) => {
    const declaredByMod = new Map(); // modId -> Set of keys the window declared this run
    const memoryByMod = new Map();   // modId -> Map key -> value, when they cannot be sealed
    const openedByMod = new Map();   // modId -> Map key -> decrypted value, a cache of the file
    const queues = new Map();        // modId -> tail of its operation chain
    const listenersByMod = new Map(); // modId -> Set of main-entry listeners
    const warned = new Set();

    const warnOnce = (id, ...args) => {
        if (!warned.has(id)) {
            warned.add(id);
            warn(...args);
        }
    };

    const canSeal = () => canSealWith(safeStorage, platform);
    const mapOf = (byMod, modId) => {
        let map = byMod.get(modId);
        if (!map) {
            map = new Map();
            byMod.set(modId, map);
        }
        return map;
    };

    // The id becomes a path segment: resolveModStorageDirs takes only a validated manifest id.
    const fileOf = (modId) => path.join(resolveModStorageDirs(userDataDir, modId).dataDir, SECRETS_FILE_NAME);

    /*
     * One mod's operations run one after another, so a read-modify-write of its file never interleaves
     * with another one from the window or the main entry.
     */
    const enqueue = (modId, task) => {
        const queue = queues.get(modId) ?? Promise.resolve();
        const run = queue.then(task, task);
        const tail = run.catch(() => undefined);
        queues.set(modId, tail);
        void tail.then(() => {
            if (queues.get(modId) === tail) queues.delete(modId);
        });
        return run;
    };

    // The sealed values on disk, key -> base64 ciphertext; prototype-free, so any key is plain data.
    const readSealed = async (modId) => {
        try {
            const parsed = JSON.parse(await fs.promises.readFile(fileOf(modId), 'utf8'));
            const sealed = Object.create(null);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                Object.entries(parsed).forEach(([key, value]) => {
                    if (typeof value === 'string') sealed[key] = value;
                });
            }
            return sealed;
        } catch {
            return Object.create(null);
        }
    };

    // Atomic (temp file, then rename); an empty map removes the file.
    const writeSealed = async (modId, sealed) => {
        const filePath = fileOf(modId);
        if (Object.keys(sealed).length === 0) {
            await fs.promises.rm(filePath, { force: true });
            return;
        }
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        const tempPath = `${filePath}.tmp`;
        await fs.promises.writeFile(tempPath, JSON.stringify(sealed, null, 2), 'utf8');
        await fs.promises.rename(tempPath, filePath);
    };

    /*
     * Refuses a key the mod has not declared. Accepted: a declared key, one that holds a value, and, for
     * a read (`write` false) while the window has declared nothing for the mod in this run, any key: it
     * then reads as unset. The declarations are looked at again after the file read, since one can land
     * while the file is read.
     */
    const requireKey = async (modId, key, { write = false } = {}) => {
        if (typeof key !== 'string' || key.length === 0) {
            throw new Error('secret key must be a non-empty string');
        }
        if (declaredByMod.get(modId)?.has(key) || memoryByMod.get(modId)?.has(key)) {
            return;
        }
        if (Object.hasOwn(await readSealed(modId), key) || declaredByMod.get(modId)?.has(key)) {
            return;
        }
        if (!write && !declaredByMod.has(modId)) {
            return;
        }
        throw new Error(`secret-undeclared:${key}`);
    };

    /*
     * The value, or null. A sealed value that cannot be opened right now (a locked keyring, a file from
     * another user or machine, safeStorage gone) reads as unset and stays on disk, so it comes back once
     * the keyring opens; saving a new value replaces it.
     */
    const readValue = async (modId, key) => {
        const memory = memoryByMod.get(modId);
        if (memory?.has(key)) {
            return memory.get(key);
        }
        const opened = openedByMod.get(modId);
        if (opened?.has(key)) {
            return opened.get(key);
        }
        const sealed = await readSealed(modId);
        if (!Object.hasOwn(sealed, key)) {
            return null;
        }
        try {
            if (!canSeal()) {
                throw new Error('Encryption unavailable');
            }
            const value = safeStorage.decryptString(Buffer.from(sealed[key], 'base64'));
            mapOf(openedByMod, modId).set(key, value);
            return value;
        } catch {
            warnOnce(`decrypt:${modId}:${key}`, `[ModSecrets] ${modId}: "${key}" could not be decrypted; it reads as unset`);
            return null;
        }
    };

    const requireValue = (value) => {
        if (value === null || value === '') {
            return null;
        }
        if (typeof value !== 'string') {
            throw new Error('secret value must be a string or null');
        }
        if (Buffer.byteLength(value, 'utf8') > SECRET_MAX_BYTES) {
            throw new Error(`secret-too-large:${SECRET_MAX_BYTES}`);
        }
        return value;
    };

    // Base64 ciphertext of `value`, or null when it cannot be sealed (the value then stays in memory).
    const seal = (modId, value) => {
        if (!canSeal()) {
            return null;
        }
        try {
            return safeStorage.encryptString(value).toString('base64');
        } catch (error) {
            warn(`[ModSecrets] ${modId}: encrypting failed; keeping the value in memory for this run`, error);
            return null;
        }
    };

    const notify = (modId, key) => {
        listenersByMod.get(modId)?.forEach((listener) => {
            try {
                listener(key);
            } catch (error) {
                warn(`[ModSecrets] ${modId}: a change listener failed`, error);
            }
        });
        try {
            onChange(modId, key);
        } catch (error) {
            warn('[ModSecrets] change notice failed', error);
        }
    };

    const get = (modId, key) => enqueue(modId, async () => {
        await requireKey(modId, key);
        return readValue(modId, key);
    });

    const has = (modId, key) => enqueue(modId, async () => {
        await requireKey(modId, key);
        return (await readValue(modId, key)) !== null;
    });

    /*
     * Saves or clears one value. Sealed when possible; otherwise in memory for this run, and a sealed
     * copy from an earlier run is removed, so an older value cannot come back on the next start. Only an
     * actual change is announced.
     */
    const set = (modId, key, rawValue) => enqueue(modId, async () => {
        await requireKey(modId, key, { write: true });
        const value = requireValue(rawValue);
        const previous = await readValue(modId, key);
        const sealed = await readSealed(modId);
        const memory = mapOf(memoryByMod, modId);
        const opened = mapOf(openedByMod, modId);
        const ciphertext = value === null ? null : seal(modId, value);
        if (value === null) {
            memory.delete(key);
            opened.delete(key);
            if (Object.hasOwn(sealed, key)) {
                delete sealed[key];
                await writeSealed(modId, sealed);
            }
            if (previous !== null) log(`[ModSecrets] ${modId}: "${key}" cleared`);
        } else if (ciphertext !== null) {
            sealed[key] = ciphertext;
            await writeSealed(modId, sealed);
            memory.delete(key);
            opened.set(key, value);
            log(`[ModSecrets] ${modId}: "${key}" saved, encrypted`);
        } else {
            memory.set(key, value);
            opened.delete(key);
            if (Object.hasOwn(sealed, key)) {
                delete sealed[key];
                await writeSealed(modId, sealed);
            }
            warnOnce(`memory:${modId}`, `[ModSecrets] ${modId}: no OS credential encryption; secrets are kept in memory for this run only`);
            log(`[ModSecrets] ${modId}: "${key}" saved, in memory only`);
        }
        if (previous !== value) {
            notify(modId, key);
        }
    });

    /** The window registered a settings section of `modId` with these `secret` keys. */
    const declare = (modId, keys) => {
        if (!Array.isArray(keys) || !keys.every(isUsableKey)) {
            throw new Error(`secret keys must be non-empty strings of at most ${SECRET_KEY_MAX_LENGTH} characters`);
        }
        // Checks the id before it is kept: it may become a path later.
        resolveModStorageDirs(userDataDir, modId);
        const declared = declaredByMod.get(modId) ?? new Set();
        const next = new Set([...declared, ...keys]);
        if (next.size > SECRET_KEYS_PER_MOD) {
            throw new Error(`secret-too-many-keys:${SECRET_KEYS_PER_MOD}`);
        }
        declaredByMod.set(modId, next);
        return next.size;
    };

    /*
     * For the settings form: whether values outlive this run, and which keys hold a usable value
     * (declared or stored ones; never the values themselves).
     */
    const state = (modId) => enqueue(modId, async () => {
        const sealed = await readSealed(modId);
        const keys = new Set([
            ...(declaredByMod.get(modId) ?? []),
            ...(memoryByMod.get(modId)?.keys() ?? []),
            ...Object.keys(sealed),
        ]);
        const stored = [];
        for (const key of keys) {
            if ((await readValue(modId, key)) !== null) stored.push(key);
        }
        return { persistent: canSeal(), stored: stored.sort() };
    });

    /** A main entry's listener for `modId`; returns the function that removes it. */
    const subscribe = (modId, listener) => {
        if (typeof listener !== 'function') {
            throw new TypeError('secrets.subscribe requires a listener function');
        }
        const listeners = listenersByMod.get(modId) ?? new Set();
        listenersByMod.set(modId, listeners);
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
            if (listeners.size === 0 && listenersByMod.get(modId) === listeners) listenersByMod.delete(modId);
        };
    };

    return { get, has, set, declare, state, subscribe, isPersistent: canSeal };
};

module.exports = {
    createModSecrets,
    SECRETS_FILE_NAME,
    SECRET_KEY_MAX_LENGTH,
    SECRET_KEYS_PER_MOD,
    SECRET_MAX_BYTES,
};
