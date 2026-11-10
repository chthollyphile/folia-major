import { describe, expect, it, vi } from 'vitest';
import { openAIEndpointOf as rendererOpenAIEndpointOf } from '../../../src/utils/openAIEndpoint';

// test/unit/electron/aiCredentialStore.test.ts

const {
    createAiCredentialStore,
    isReservedAiCredentialKey,
    openAIEndpointOf,
} = require('../../../electron/aiCredentialStore.cjs') as {
    createAiCredentialStore: (options: Record<string, unknown>) => {
        get: (key: string) => unknown;
        set: (key: string, value: unknown) => void;
        migrate: () => void;
        isConfigured: (key: string) => boolean;
        toPublicSettings: (settings: Record<string, unknown>) => Record<string, unknown>;
        resolveTestApiKey: (provider: unknown, typedKey: unknown, apiUrl?: unknown) => { apiKey?: string; error?: string };
        settingsView: { get: (key: string) => unknown };
    };
    isReservedAiCredentialKey: (key: string) => boolean;
    openAIEndpointOf: (rawUrl: unknown) => string;
};

const { runAiJsonCompletion } = require('../../../electron/aiTextClient.cjs') as {
    runAiJsonCompletion: (options: Record<string, unknown>) => Promise<string>;
};

function createStore(initial: Record<string, unknown> = {}) {
    const values = new Map<string, unknown>(Object.entries(initial));
    return {
        values,
        get: vi.fn((key: string) => values.get(key)),
        set: vi.fn((key: string, value: unknown) => values.set(key, value)),
        delete: vi.fn((key: string) => values.delete(key)),
    };
}

// Reversible byte transformation so the persisted value is not just base64 of the plaintext.
function createSafeStorage({ available = true, backend = 'gnome_libsecret' } = {}) {
    return {
        isEncryptionAvailable: vi.fn(() => available),
        getSelectedStorageBackend: vi.fn(() => backend),
        encryptString: vi.fn((plaintext: string): Buffer =>
            Buffer.from(Buffer.from(plaintext, 'utf8').map((byte) => byte ^ 0xa5))),
        decryptString: vi.fn((ciphertext: Buffer) =>
            Buffer.from(Buffer.from(ciphertext).map((byte) => byte ^ 0xa5)).toString('utf8')),
    };
}

const persistedText = (store: ReturnType<typeof createStore>) => JSON.stringify(Object.fromEntries(store.values));

describe('AI credential store', () => {
    it('keeps API keys out of the persisted settings in plaintext', () => {
        const store = createStore();
        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32' });

        credentials.set('OPENAI_API_KEY', 'sk-secret-123');

        expect(persistedText(store)).not.toContain('sk-secret-123');
        expect(store.values.has('OPENAI_API_KEY')).toBe(false);
        expect(store.values.get('OPENAI_API_KEY_SEALED')).toEqual(expect.any(String));

        const reopened = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32' });
        expect(reopened.get('OPENAI_API_KEY')).toBe('sk-secret-123');
        expect(reopened.settingsView.get('OPENAI_API_KEY')).toBe('sk-secret-123');
    });

    it('migrates plaintext keys written by older versions', () => {
        const store = createStore({ GEMINI_API_KEY: 'gemini-plain', AI_PROVIDER: 'gemini' });
        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'darwin' });

        credentials.migrate();

        expect(persistedText(store)).not.toContain('gemini-plain');
        expect(credentials.get('GEMINI_API_KEY')).toBe('gemini-plain');
        expect(store.values.get('AI_PROVIDER')).toBe('gemini');
    });

    it('gives the renderer only which keys are saved, never the keys or their ciphertext', () => {
        const store = createStore({ OPENAI_API_KEY: 'sk-legacy-plain', AI_PROVIDER: 'openai' });
        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32' });
        // Startup order: migrate() runs before any window can ask for settings.
        credentials.migrate();
        credentials.set('GEMINI_API_KEY', 'gemini-key');

        const settings = credentials.toPublicSettings(Object.fromEntries(store.values));

        expect(settings.AI_API_KEYS_CONFIGURED).toEqual({ GEMINI_API_KEY: true, OPENAI_API_KEY: true });
        expect(settings.AI_PROVIDER).toBe('openai');
        const serialized = JSON.stringify(settings);
        expect(serialized).not.toContain('gemini-key');
        expect(serialized).not.toContain('sk-legacy-plain');
        expect(serialized).not.toContain(String(store.values.get('GEMINI_API_KEY_SEALED')));
        expect(Object.keys(settings)).not.toContain('GEMINI_API_KEY');
        expect(Object.keys(settings)).not.toContain('OPENAI_API_KEY');
    });

    it('reports a key whose ciphertext cannot be decrypted as missing, without deleting it', () => {
        const store = createStore({ GEMINI_API_KEY_SEALED: 'Ym9ndXM=' });
        const credentials = createAiCredentialStore({
            store, safeStorage: createSafeStorage({ available: false }), platform: 'linux', warn: vi.fn(),
        });

        expect(credentials.toPublicSettings({}).AI_API_KEYS_CONFIGURED).toEqual({ GEMINI_API_KEY: false, OPENAI_API_KEY: false });
        expect(store.values.get('GEMINI_API_KEY_SEALED')).toBe('Ym9ndXM=');
    });

    it('uses the saved key for the connection test only when the field is left empty', () => {
        const store = createStore();
        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32' });
        credentials.set('OPENAI_API_KEY', 'sk-saved');
        credentials.set('GEMINI_API_KEY', 'gemini-saved');

        expect(credentials.resolveTestApiKey('openai', '', '')).toEqual({ apiKey: 'sk-saved' });
        expect(credentials.resolveTestApiKey('openai', undefined, undefined)).toEqual({ apiKey: 'sk-saved' });
        expect(credentials.resolveTestApiKey('gemini', '  ')).toEqual({ apiKey: 'gemini-saved' });
        expect(credentials.resolveTestApiKey('openai', ' sk-typed ', 'https://other.example/v1')).toEqual({ apiKey: 'sk-typed' });
    });

    it('sends the saved OpenAI-compatible key only to the saved endpoint', () => {
        const store = createStore({ OPENAI_API_URL: 'https://api.deepseek.com' });
        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32' });
        credentials.set('OPENAI_API_KEY', 'sk-saved');

        // Same endpoint written differently still matches after normalization.
        expect(credentials.resolveTestApiKey('openai', '', 'https://api.deepseek.com/')).toEqual({ apiKey: 'sk-saved' });
        const elsewhere = credentials.resolveTestApiKey('openai', '', 'https://attacker.example/v1');
        expect(elsewhere.apiKey).toBeUndefined();
        expect(elsewhere.error).toEqual(expect.any(String));
    });

    it('marks the ciphertext and the status entry as names the renderer may not write', () => {
        expect(isReservedAiCredentialKey('GEMINI_API_KEY_SEALED')).toBe(true);
        expect(isReservedAiCredentialKey('OPENAI_API_KEY_SEALED')).toBe(true);
        expect(isReservedAiCredentialKey('AI_API_KEYS_CONFIGURED')).toBe(true);
        expect(isReservedAiCredentialKey('OPENAI_API_KEY_ENDPOINT')).toBe(true);
        expect(isReservedAiCredentialKey('OPENAI_API_KEY')).toBe(false);
        expect(isReservedAiCredentialKey('OPENAI_API_URL')).toBe(false);
    });

    it('clears both the sealed and plaintext entries when a key is emptied', () => {
        const store = createStore({ OPENAI_API_KEY: 'legacy' });
        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32' });
        credentials.set('OPENAI_API_KEY', 'sk-new');

        credentials.set('OPENAI_API_KEY', '');

        expect(store.values.has('OPENAI_API_KEY')).toBe(false);
        expect(store.values.has('OPENAI_API_KEY_SEALED')).toBe(false);
        expect(credentials.get('OPENAI_API_KEY')).toBe('');
    });

    it('falls back to plaintext on Linux basic_text instead of losing the key', () => {
        const warn = vi.fn();
        const store = createStore({ GEMINI_API_KEY: 'plain' });
        const safeStorage = createSafeStorage({ backend: 'basic_text' });
        const credentials = createAiCredentialStore({ store, safeStorage, platform: 'linux', warn });

        credentials.migrate();
        expect(store.values.get('GEMINI_API_KEY')).toBe('plain');

        credentials.set('OPENAI_API_KEY', 'sk-linux');
        expect(store.values.get('OPENAI_API_KEY')).toBe('sk-linux');
        expect(safeStorage.encryptString).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
    });

    it('returns an empty key without discarding ciphertext it cannot decrypt', () => {
        const warn = vi.fn();
        const store = createStore({ OPENAI_API_KEY_SEALED: 'Ym9ndXM=' });
        const safeStorage = createSafeStorage();
        safeStorage.decryptString.mockImplementation(() => {
            throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
        });
        const credentials = createAiCredentialStore({ store, safeStorage, platform: 'win32', warn });

        expect(credentials.get('OPENAI_API_KEY')).toBe('');
        expect(store.values.get('OPENAI_API_KEY_SEALED')).toBe('Ym9ndXM=');
        expect(warn).toHaveBeenCalled();
    });

    it('recovers a sealed key once a locked keyring becomes available', () => {
        const store = createStore();
        const safeStorage = createSafeStorage();
        createAiCredentialStore({ store, safeStorage, platform: 'linux' }).set('GEMINI_API_KEY', 'gemini-key');

        // Next launch: the keyring has not answered yet.
        safeStorage.isEncryptionAvailable.mockReturnValue(false);
        const credentials = createAiCredentialStore({ store, safeStorage, platform: 'linux', warn: vi.fn() });
        expect(credentials.get('GEMINI_API_KEY')).toBe('');

        safeStorage.isEncryptionAvailable.mockReturnValue(true);
        expect(credentials.get('GEMINI_API_KEY')).toBe('gemini-key');
    });

    it('clears an undecryptable key when asked to explicitly', () => {
        const store = createStore({ GEMINI_API_KEY_SEALED: 'Ym9ndXM=' });
        const credentials = createAiCredentialStore({
            store, safeStorage: createSafeStorage({ available: false }), platform: 'linux', warn: vi.fn(),
        });

        credentials.set('GEMINI_API_KEY', '');

        expect(store.values.has('GEMINI_API_KEY_SEALED')).toBe(false);
        expect(credentials.isConfigured('GEMINI_API_KEY')).toBe(false);
    });

    it('falls back to a plaintext copy when the sealed blob cannot be decrypted', () => {
        const warn = vi.fn();
        const store = createStore({
            OPENAI_API_KEY_SEALED: 'Ym9ndXM=', OPENAI_API_KEY: 'sk-plain', OPENAI_API_KEY_ENDPOINT: 'https://api.openai.com',
        });
        const credentials = createAiCredentialStore({
            store, safeStorage: createSafeStorage({ available: false }), platform: 'linux', warn,
        });

        expect(credentials.get('OPENAI_API_KEY')).toBe('sk-plain');
        credentials.get('OPENAI_API_KEY');
        expect(warn).toHaveBeenCalledTimes(1);
    });

    it('passes non-credential keys straight through', () => {
        const store = createStore({ OPENAI_API_URL: 'https://api.deepseek.com' });
        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32' });

        expect(credentials.settingsView.get('OPENAI_API_URL')).toBe('https://api.deepseek.com');
    });
});

// Issue #643: OPENAI_API_URL is renderer-writable, so the saved key must not follow it to another host.
describe('OpenAI-compatible key endpoint binding', () => {
    const savedFor = (url: string) => {
        const store = createStore({ AI_PROVIDER: 'openai', OPENAI_API_URL: url });
        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32', warn: vi.fn() });
        credentials.set('OPENAI_API_KEY', 'sk-saved');
        return { store, credentials };
    };

    it('stops handing out the key once OPENAI_API_URL points at another host, and keeps it', () => {
        const { store, credentials } = savedFor('https://api.example.com/v1');

        // What saveSettings('OPENAI_API_URL', ...) from the renderer does.
        store.set('OPENAI_API_URL', 'http://127.0.0.1:9999/collect');

        expect(credentials.get('OPENAI_API_KEY')).toBe('');
        expect(credentials.settingsView.get('OPENAI_API_KEY')).toBe('');
        expect(credentials.isConfigured('OPENAI_API_KEY')).toBe(false);
        expect(credentials.toPublicSettings({}).AI_API_KEYS_CONFIGURED).toEqual({ GEMINI_API_KEY: false, OPENAI_API_KEY: false });
        expect(store.values.get('OPENAI_API_KEY_SEALED')).toEqual(expect.any(String));

        store.set('OPENAI_API_URL', 'https://api.example.com/v1');
        expect(credentials.get('OPENAI_API_KEY')).toBe('sk-saved');
    });

    it('keeps the key for another path on the same server', () => {
        const { store, credentials } = savedFor('https://api.deepseek.com');

        for (const url of ['https://api.deepseek.com/', 'https://api.deepseek.com/v1', 'https://API.deepseek.com:443/beta']) {
            store.set('OPENAI_API_URL', url);
            expect(credentials.get('OPENAI_API_KEY')).toBe('sk-saved');
        }
        for (const url of ['http://api.deepseek.com', 'https://api.deepseek.com:8443', 'https://deepseek.com']) {
            store.set('OPENAI_API_URL', url);
            expect(credentials.get('OPENAI_API_KEY')).toBe('');
        }
    });

    it('binds an empty URL to the default endpoint it resolves to', () => {
        const { store, credentials } = savedFor('');

        store.set('OPENAI_API_URL', 'https://api.openai.com/v1');
        expect(credentials.get('OPENAI_API_KEY')).toBe('sk-saved');
    });

    it('never sends the key from the real request path to a rewritten endpoint', async () => {
        const { store, credentials } = savedFor('https://api.example.com/v1');
        store.set('OPENAI_API_URL', 'http://127.0.0.1:9999/collect');
        const customFetch = vi.fn();

        await expect(runAiJsonCompletion({
            store: credentials.settingsView,
            task: 'theme',
            systemPrompt: 'sys',
            sourcePrompt: 'src',
            customFetch,
            answerTokens: 64,
        })).rejects.toThrow(/OPENAI_API_KEY is not configured/);
        expect(customFetch).not.toHaveBeenCalled();
    });

    it('does not let the connection test reuse the saved key after the URL was rewritten', () => {
        const { store, credentials } = savedFor('https://api.example.com/v1');
        store.set('OPENAI_API_URL', 'http://127.0.0.1:9999/collect');

        expect(credentials.resolveTestApiKey('openai', '', 'http://127.0.0.1:9999/collect').apiKey).not.toBe('sk-saved');
        expect(credentials.resolveTestApiKey('openai', '', 'https://api.example.com/v1').apiKey).not.toBe('sk-saved');
    });

    it('rebinds when a key is saved again for the new endpoint', () => {
        const { store, credentials } = savedFor('https://api.example.com/v1');
        store.set('OPENAI_API_URL', 'https://api.deepseek.com');

        credentials.set('OPENAI_API_KEY', 'sk-deepseek');

        expect(store.values.get('OPENAI_API_KEY_ENDPOINT')).toBe('https://api.deepseek.com');
        expect(credentials.get('OPENAI_API_KEY')).toBe('sk-deepseek');
        expect(credentials.resolveTestApiKey('openai', '', 'https://api.deepseek.com/v1')).toEqual({ apiKey: 'sk-deepseek' });
    });

    it('drops the binding together with the key', () => {
        const { store, credentials } = savedFor('https://api.example.com/v1');

        credentials.set('OPENAI_API_KEY', '');

        expect(store.values.has('OPENAI_API_KEY_ENDPOINT')).toBe(false);
    });

    it('treats a key without a binding as unusable until migrate() binds it', () => {
        const store = createStore({ OPENAI_API_URL: 'https://api.example.com/v1' });
        createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32' }).set('OPENAI_API_KEY', 'sk-old');
        // A key saved by a build that predates the binding.
        store.values.delete('OPENAI_API_KEY_ENDPOINT');

        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32', warn: vi.fn() });
        expect(credentials.get('OPENAI_API_KEY')).toBe('');

        credentials.migrate();
        expect(store.values.get('OPENAI_API_KEY_ENDPOINT')).toBe('https://api.example.com');
        expect(credentials.get('OPENAI_API_KEY')).toBe('sk-old');
    });

    it('binds legacy plaintext keys even where the OS cannot encrypt them', () => {
        const store = createStore({ OPENAI_API_KEY: 'sk-plain', OPENAI_API_URL: 'https://api.example.com/v1' });
        const credentials = createAiCredentialStore({
            store, safeStorage: createSafeStorage({ backend: 'basic_text' }), platform: 'linux', warn: vi.fn(),
        });

        credentials.migrate();

        expect(store.values.get('OPENAI_API_KEY')).toBe('sk-plain');
        expect(store.values.get('OPENAI_API_KEY_ENDPOINT')).toBe('https://api.example.com');
        expect(credentials.get('OPENAI_API_KEY')).toBe('sk-plain');
    });

    it('does not move an existing binding on migrate', () => {
        const { store } = savedFor('https://api.example.com/v1');
        store.set('OPENAI_API_URL', 'http://127.0.0.1:9999/collect');

        const credentials = createAiCredentialStore({ store, safeStorage: createSafeStorage(), platform: 'win32', warn: vi.fn() });
        credentials.migrate();

        expect(store.values.get('OPENAI_API_KEY_ENDPOINT')).toBe('https://api.example.com');
        expect(credentials.get('OPENAI_API_KEY')).toBe('');
    });

    it('shows the renderer which endpoint the key is bound to, still without the key', () => {
        const { store, credentials } = savedFor('https://api.example.com/v1');

        const settings = credentials.toPublicSettings(Object.fromEntries(store.values));

        expect(settings.OPENAI_API_KEY_ENDPOINT).toBe('https://api.example.com');
        expect(JSON.stringify(settings)).not.toContain('sk-saved');
    });

    it('matches the renderer copy used for the settings warning', () => {
        const urls = [
            undefined, '', '  ', 'https://api.openai.com/v1', 'https://api.deepseek.com', 'https://api.deepseek.com/',
            'http://localhost:11434/v1', 'https://API.Example.com:443/v1/', 'http://[::1]:8080', 'api.example.com/v1/',
            'not a url', 'https://user:pass@api.example.com/v1',
        ];
        for (const url of urls) {
            expect(rendererOpenAIEndpointOf(url)).toBe(openAIEndpointOf(url));
        }
    });
});
