import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modSecrets.test.ts
// Folium 1.7 `secret` settings values in the main process (electron/modSystem/modSecrets.cjs): sealed
// with safeStorage so only ciphertext reaches mods-data/<id>/secrets.json, kept in memory for the run
// when there is no real encryption (none, or Linux basic_text), one store per mod, undeclared keys and
// oversized values refused, and change notices that carry the key and never the value.

const require = createRequire(import.meta.url);
const {
    createModSecrets,
    SECRETS_FILE_NAME,
    SECRET_KEYS_PER_MOD,
    SECRET_MAX_BYTES,
} = require('../../../electron/modSystem/modSecrets.cjs');

const PREFIX = 'sealed:';

/* A safeStorage stand-in: "encrypts" by prefixing and base64-reversing, so tests can tell sealed bytes apart. */
const fakeSafeStorage = ({ available = true, backend = 'gnome_libsecret' } = {}) => ({
    isEncryptionAvailable: vi.fn(() => available),
    getSelectedStorageBackend: vi.fn(() => backend),
    encryptString: vi.fn((value: string) => Buffer.from(PREFIX + Buffer.from(value, 'utf8').toString('hex'), 'utf8')),
    decryptString: vi.fn((buffer: Buffer) => {
        const text = buffer.toString('utf8');
        if (!text.startsWith(PREFIX)) throw new Error('not ours');
        return Buffer.from(text.slice(PREFIX.length), 'hex').toString('utf8');
    }),
});

let userData = '';
const secretsFile = (modId: string) => path.join(userData, 'mods-data', modId, SECRETS_FILE_NAME);

const makeStore = (overrides: Record<string, unknown> = {}) => createModSecrets({
    userDataDir: userData,
    safeStorage: fakeSafeStorage(),
    platform: 'win32',
    warn: () => {},
    log: () => {},
    ...overrides,
});

beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-mod-secrets-'));
});

afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
});

describe('mod secrets with OS encryption', () => {
    it('round-trips a value and writes only ciphertext, beside the data file and outside files/', async () => {
        const store = makeStore();
        store.declare('mod-a', ['apiKey']);
        expect(await store.has('mod-a', 'apiKey')).toBe(false);
        expect(await store.get('mod-a', 'apiKey')).toBeNull();

        await store.set('mod-a', 'apiKey', 'sk-live-123');
        expect(await store.get('mod-a', 'apiKey')).toBe('sk-live-123');
        expect(await store.has('mod-a', 'apiKey')).toBe(true);

        const file = secretsFile('mod-a');
        expect(path.dirname(file)).toBe(path.join(userData, 'mods-data', 'mod-a'));
        const raw = fs.readFileSync(file, 'utf8');
        expect(raw).not.toContain('sk-live-123');
        expect(Object.keys(JSON.parse(raw))).toEqual(['apiKey']);
        expect(fs.existsSync(path.join(userData, 'mods-data', 'mod-a', 'files'))).toBe(false);
        expect(await store.state('mod-a')).toEqual({ persistent: true, stored: ['apiKey'] });
    });

    it('reads a value saved in an earlier run, before the window declares the key', async () => {
        const first = makeStore();
        first.declare('mod-a', ['apiKey']);
        await first.set('mod-a', 'apiKey', 'token');

        const next = makeStore();
        expect(await next.get('mod-a', 'apiKey')).toBe('token');
        await next.set('mod-a', 'apiKey', 'token-2');
        expect(await next.get('mod-a', 'apiKey')).toBe('token-2');
    });

    it('reads a key with no value as unset on every start until the window declares, and writes it only after', async () => {
        const first = makeStore();
        first.declare('mod-a', ['apiKey']);
        await first.set('mod-a', 'apiKey', 'token');
        await first.set('mod-a', 'apiKey', null);

        // The next start: the main entry runs before the client registers its section, and the key
        // the user cleared must not make its activate fail (the client would never start to declare it).
        const next = makeStore();
        expect(await next.get('mod-a', 'apiKey')).toBeNull();
        expect(await next.has('mod-a', 'apiKey')).toBe(false);
        await expect(next.set('mod-a', 'apiKey', 'early')).rejects.toThrow('secret-undeclared:apiKey');

        next.declare('mod-a', ['apiKey']);
        await next.set('mod-a', 'apiKey', 'late');
        expect(await next.get('mod-a', 'apiKey')).toBe('late');
        // Once the window has declared, a key it did not declare is refused again.
        await expect(next.get('mod-a', 'other')).rejects.toThrow('secret-undeclared:other');
        await expect(next.has('mod-a', 'other')).rejects.toThrow('secret-undeclared:other');
    });

    it('clears with null or an empty string, and removes the file when nothing is left', async () => {
        const store = makeStore();
        store.declare('mod-a', ['apiKey', 'token']);
        await store.set('mod-a', 'apiKey', 'one');
        await store.set('mod-a', 'token', 'two');
        await store.set('mod-a', 'apiKey', null);
        expect(await store.get('mod-a', 'apiKey')).toBeNull();
        expect(Object.keys(JSON.parse(fs.readFileSync(secretsFile('mod-a'), 'utf8')))).toEqual(['token']);
        await store.set('mod-a', 'token', '');
        expect(fs.existsSync(secretsFile('mod-a'))).toBe(false);
        expect(await store.state('mod-a')).toEqual({ persistent: true, stored: [] });
    });

    it('reads a value it cannot decrypt as unset and leaves it on disk', async () => {
        const store = makeStore();
        store.declare('mod-a', ['apiKey']);
        fs.mkdirSync(path.dirname(secretsFile('mod-a')), { recursive: true });
        fs.writeFileSync(secretsFile('mod-a'), JSON.stringify({ apiKey: Buffer.from('foreign').toString('base64') }));
        expect(await store.get('mod-a', 'apiKey')).toBeNull();
        expect(await store.has('mod-a', 'apiKey')).toBe(false);
        expect(fs.readFileSync(secretsFile('mod-a'), 'utf8')).toContain('apiKey');
    });
});

describe('mod secrets without OS encryption', () => {
    it.each([
        ['safeStorage is unavailable', { safeStorage: fakeSafeStorage({ available: false }) }],
        ['Linux selected basic_text', { safeStorage: fakeSafeStorage({ backend: 'basic_text' }), platform: 'linux' }],
        ['there is no safeStorage (tests, odd builds)', { safeStorage: undefined }],
    ])('keeps values in memory for this run when %s', async (_name, overrides) => {
        const store = makeStore(overrides);
        store.declare('mod-a', ['apiKey']);
        await store.set('mod-a', 'apiKey', 'sk-memory');
        expect(await store.get('mod-a', 'apiKey')).toBe('sk-memory');
        expect(fs.existsSync(secretsFile('mod-a'))).toBe(false);
        expect(await store.state('mod-a')).toEqual({ persistent: false, stored: ['apiKey'] });

        const nextRun = makeStore(overrides);
        nextRun.declare('mod-a', ['apiKey']);
        expect(await nextRun.get('mod-a', 'apiKey')).toBeNull();
    });

    it('drops a sealed copy from an earlier run when a new value goes to memory', async () => {
        const sealedRun = makeStore();
        sealedRun.declare('mod-a', ['apiKey']);
        await sealedRun.set('mod-a', 'apiKey', 'old');
        const lockedRun = makeStore({ safeStorage: fakeSafeStorage({ available: false }) });
        await lockedRun.set('mod-a', 'apiKey', 'new');
        expect(fs.existsSync(secretsFile('mod-a'))).toBe(false);
        expect(await lockedRun.get('mod-a', 'apiKey')).toBe('new');
    });
});

describe('mod secrets rules', () => {
    it('keeps each mod to its own store', async () => {
        const store = makeStore();
        store.declare('mod-a', ['apiKey']);
        store.declare('mod-b', ['apiKey']);
        await store.set('mod-a', 'apiKey', 'only-a');
        expect(await store.get('mod-b', 'apiKey')).toBeNull();
        expect(await store.state('mod-b')).toEqual({ persistent: true, stored: [] });
        expect(fs.existsSync(secretsFile('mod-b'))).toBe(false);
    });

    it('refuses keys no settings section declared', async () => {
        const store = makeStore();
        store.declare('mod-a', ['apiKey']);
        await expect(store.get('mod-a', 'other')).rejects.toThrow('secret-undeclared:other');
        await expect(store.has('mod-a', 'other')).rejects.toThrow('secret-undeclared:other');
        await expect(store.set('mod-a', 'other', 'x')).rejects.toThrow('secret-undeclared:other');
        await expect(store.get('mod-a', '')).rejects.toThrow('non-empty string');
    });

    it('caps a value at 8 KB of UTF-8 and takes only strings', async () => {
        const store = makeStore();
        store.declare('mod-a', ['apiKey']);
        await store.set('mod-a', 'apiKey', 'a'.repeat(SECRET_MAX_BYTES));
        expect(await store.get('mod-a', 'apiKey')).toHaveLength(SECRET_MAX_BYTES);
        await expect(store.set('mod-a', 'apiKey', 'a'.repeat(SECRET_MAX_BYTES + 1))).rejects.toThrow(`secret-too-large:${SECRET_MAX_BYTES}`);
        // Counted in bytes: 2731 three-byte characters are 8193 bytes.
        await expect(store.set('mod-a', 'apiKey', '密'.repeat(2731))).rejects.toThrow('secret-too-large');
        await expect(store.set('mod-a', 'apiKey', 42)).rejects.toThrow('string or null');
        await expect(store.set('mod-a', 'apiKey', undefined)).rejects.toThrow('string or null');
        expect(await store.get('mod-a', 'apiKey')).toHaveLength(SECRET_MAX_BYTES);
    });

    it('checks declarations and the mod id before keeping them', () => {
        const store = makeStore();
        expect(() => store.declare('mod-a', 'apiKey')).toThrow();
        expect(() => store.declare('mod-a', [''])).toThrow();
        expect(() => store.declare('mod-a', ['x'.repeat(129)])).toThrow();
        expect(() => store.declare('../escape', ['apiKey'])).toThrow('invalid-mod-id');
        const many = Array.from({ length: SECRET_KEYS_PER_MOD + 1 }, (_, index) => `k${index}`);
        expect(() => store.declare('mod-a', many)).toThrow(`secret-too-many-keys:${SECRET_KEYS_PER_MOD}`);
        expect(store.declare('mod-a', ['apiKey', 'apiKey'])).toBe(1);
    });

    it('announces a change with the key only, to the mod\'s listeners and the loader, and only when it changed', async () => {
        const onChange = vi.fn();
        const store = makeStore({ onChange });
        const heardA = vi.fn();
        const heardB = vi.fn();
        store.subscribe('mod-a', heardA);
        store.subscribe('mod-b', heardB);
        store.declare('mod-a', ['apiKey']);

        await store.set('mod-a', 'apiKey', 'secret-value');
        expect(heardA).toHaveBeenCalledWith('apiKey');
        expect(onChange).toHaveBeenCalledWith('mod-a', 'apiKey');
        expect(JSON.stringify([heardA.mock.calls, onChange.mock.calls])).not.toContain('secret-value');
        expect(heardB).not.toHaveBeenCalled();

        await store.set('mod-a', 'apiKey', 'secret-value');
        expect(heardA).toHaveBeenCalledTimes(1);
        await store.set('mod-a', 'apiKey', null);
        expect(heardA).toHaveBeenCalledTimes(2);
        await store.set('mod-a', 'apiKey', null);
        expect(heardA).toHaveBeenCalledTimes(2);
    });

    it('keeps telling the other listeners when one throws, and stops a removed one', async () => {
        const store = makeStore();
        store.declare('mod-a', ['apiKey']);
        const after = vi.fn();
        store.subscribe('mod-a', () => { throw new Error('boom'); });
        const off = store.subscribe('mod-a', after);
        await store.set('mod-a', 'apiKey', 'one');
        expect(after).toHaveBeenCalledTimes(1);
        off();
        await store.set('mod-a', 'apiKey', 'two');
        expect(after).toHaveBeenCalledTimes(1);
    });

    it('never logs a value', async () => {
        const log = vi.fn();
        const warn = vi.fn();
        const store = makeStore({ log, warn, safeStorage: fakeSafeStorage({ available: false }) });
        store.declare('mod-a', ['apiKey']);
        await store.set('mod-a', 'apiKey', 'sk-do-not-log');
        await store.set('mod-a', 'apiKey', null);
        expect(log).toHaveBeenCalled();
        expect(JSON.stringify([log.mock.calls, warn.mock.calls])).not.toContain('sk-do-not-log');
    });
});
