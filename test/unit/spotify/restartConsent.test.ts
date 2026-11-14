// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/spotify/restartConsent.test.ts — the two stores the external playback route needs, and
// the channel that carries the one the renderer cannot write. Neither is wired to a caller yet.
//
//   - the renderer switch 「用整机声音出频谱」 (useDesktopSettingsStore.externalSystemAudioSpectrum),
//     off until the listener asks for it, kept under its own published key;
//   - the main process's record of the listener's agreement to restarting Spotify's own app
//     (electron/restartConsent.cjs), unset until it is given, and only ever `true`;
//   - external-player-restart-consent, answered to the main window alone.

const rootDir = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);
const read = (file: string) => readFileSync(path.join(rootDir, file), 'utf8');

const STORAGE_KEY = 'external_system_audio_spectrum';

const loadStore = async () => {
    Object.defineProperty(window, 'electron', { value: { platform: 'win32', saveSettings: vi.fn() }, configurable: true, writable: true });
    vi.resetModules();
    const module = await import('@/stores/useDesktopSettingsStore');
    return module.useDesktopSettingsStore;
};

beforeEach(() => {
    window.localStorage.clear();
});

describe('the system-sound spectrum switch', () => {
    it('is off until the listener asks for it', async () => {
        const store = await loadStore();
        expect(store.getState().externalSystemAudioSpectrum).toBe(false);
    });

    it('keeps the listener\'s choice under its own key', async () => {
        const store = await loadStore();
        store.getState().handleToggleExternalSystemAudioSpectrum(true);
        expect(store.getState().externalSystemAudioSpectrum).toBe(true);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');

        store.getState().handleToggleExternalSystemAudioSpectrum(false);
        expect(store.getState().externalSystemAudioSpectrum).toBe(false);
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false');
    });

    it('reads a choice an earlier run kept', async () => {
        window.localStorage.setItem(STORAGE_KEY, 'true');
        const store = await loadStore();
        expect(store.getState().externalSystemAudioSpectrum).toBe(true);
    });
});

/** A stand-in for electron-store: the module only reads, writes and clears single keys. */
const memoryStore = (initial: Record<string, unknown> = {}) => {
    const values = new Map(Object.entries(initial));
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => { values.set(key, value); },
        delete: (key: string) => { values.delete(key); },
        values,
    };
};

type ConsentStore = { get: (key: string) => unknown; set: (key: string, value: unknown) => void; delete: (key: string) => void };

type ConsentModule = {
    SETTING_KEY: string;
    read: (store: ConsentStore) => boolean;
    grant: (store: ConsentStore) => boolean;
    revoke: (store: ConsentStore) => boolean;
    registerRestartConsentIpc: (options: {
        ipcMain: { handle: (channel: string, handler: (event: unknown, granted?: unknown) => unknown) => void };
        isTrustedSender: (event: unknown) => boolean;
        store: ConsentStore;
    }) => void;
};

const consentModule = (): ConsentModule => require(path.join(rootDir, 'electron/restartConsent.cjs'));

describe('the agreement to restart the external player\'s own app', () => {
    it('is unset in a store that never held it, and answers no', () => {
        const { SETTING_KEY, read: readConsent } = consentModule();
        const store = memoryStore();
        expect(SETTING_KEY).toBe('externalPlayerRestartConsented');
        expect(store.values.has(SETTING_KEY)).toBe(false);
        expect(readConsent(store)).toBe(false);
    });

    it('takes a yes as `true`, and counts only a stored `true`', () => {
        const { SETTING_KEY, read: readConsent, grant } = consentModule();
        const store = memoryStore();

        expect(grant(store)).toBe(true);
        expect(store.values.get(SETTING_KEY)).toBe(true);
        expect(readConsent(store)).toBe(true);

        for (const stored of [false, 'true', 1, null, {}]) {
            expect(readConsent(memoryStore({ [SETTING_KEY]: stored })), String(stored)).toBe(false);
        }
    });
});

describe('the channel that carries the agreement', () => {
    const registered = (trusted: boolean, store: ReturnType<typeof memoryStore>) => {
        let handler: ((event: unknown, granted?: unknown) => unknown) | null = null;
        consentModule().registerRestartConsentIpc({
            ipcMain: { handle: (channel, answer) => { expect(channel).toBe('external-player-restart-consent'); handler = answer; } },
            isTrustedSender: () => trusted,
            store,
        });
        return handler as unknown as (event: unknown, granted?: unknown) => unknown;
    };

    it('answers with what the store holds, and records a yes', () => {
        const store = memoryStore();
        const handle = registered(true, store);

        expect(handle({ sender: 'main' })).toBe(false);
        expect(handle({ sender: 'main' }, true)).toBe(true);
        expect(store.values.get(consentModule().SETTING_KEY)).toBe(true);
        expect(handle({ sender: 'main' })).toBe(true);
    });

    it('records nothing for an answer that is not a yes, and takes a yes back on a no', () => {
        const store = memoryStore({ [consentModule().SETTING_KEY]: true });
        const handle = registered(true, store);
        expect(handle({ sender: 'main' }, false)).toBe(false);
        expect(store.values.size).toBe(0);
        // Only that one answer clears it: anything else is not an answer at all.
        for (const other of ['true', 1, null, {}]) {
            store.values.set(consentModule().SETTING_KEY, true);
            expect(handle({ sender: 'main' }, other), String(other)).toBe(true);
        }
    });

    it('answers what is really kept after taking a yes back, not what was asked for', () => {
        const { SETTING_KEY } = consentModule();
        // A store that could not clear the key still holds the yes: the answer says so, so the switch
        // that is drawn from it shows the agreement that is still in force rather than a no that never
        // reached the store.
        const stuck = memoryStore({ [SETTING_KEY]: true });
        stuck.delete = () => {};
        expect(registered(true, stuck)({ sender: 'main' }, false)).toBe(true);
        expect(consentModule().read(stuck)).toBe(true);

        // The ordinary case is the no it always was.
        expect(registered(true, memoryStore({ [SETTING_KEY]: true }))({ sender: 'main' }, false)).toBe(false);
    });

    it('answers what is really kept after a yes, not what was asked for', () => {
        const { SETTING_KEY } = consentModule();
        // A write that never reached the store: the answer is the no that is still there, so the switch
        // does not show an agreement Folia would not honour on the next player it has to reopen.
        const unwritten = memoryStore();
        unwritten.set = () => {};
        expect(registered(true, unwritten)({ sender: 'main' }, true)).toBe(false);
        expect(consentModule().read(unwritten)).toBe(false);

        // A write that threw is the same answer: nothing was kept.
        const threw = memoryStore();
        threw.set = () => { throw new Error('the store could not be written'); };
        expect(registered(true, threw)({ sender: 'main' }, true)).toBe(false);
        expect(consentModule().read(threw)).toBe(false);

        // The ordinary case is the yes it always was, and the module's own grant answers it too.
        const kept = memoryStore();
        expect(registered(true, kept)({ sender: 'main' }, true)).toBe(true);
        expect(kept.values.get(SETTING_KEY)).toBe(true);
        expect(consentModule().grant(memoryStore())).toBe(true);
    });

    it('refuses a window that is not the main one, before it reads or writes anything', () => {
        const store = memoryStore();
        const handle = registered(false, store);
        expect(() => handle({ sender: 'remote' }, true)).toThrow(/Untrusted/);
        expect(store.values.size).toBe(0);
    });

    it('is given the main-window check in main.cjs, and refuses the generic settings write', () => {
        // main.cjs cannot be imported (requiring it boots the app), so what it hands the module is
        // pinned here, the way test/unit/electron/ipcSecurity.test.ts pins its own wiring.
        const mainCjs = read('electron/main.cjs');
        expect(mainCjs).toContain("require('./restartConsent.cjs')");
        const site = mainCjs.match(/registerRestartConsentIpc\(\{[\s\S]{0,300}?\}\);/)?.[0] ?? '';
        expect(site).not.toBe('');
        expect(site).toContain('isTrustedSender: event => isTrustedMainWindowContents(event.sender)');
        expect(site).toContain('store,');
        // A generic settings write must not stand in for the listener's answer.
        const saveSettings = mainCjs.match(/ipcMain\.handle\('save-settings'[\s\S]*?store\.set\(key, nextValue\);/)?.[0] ?? '';
        expect(saveSettings).toMatch(/key === RESTART_CONSENT_SETTING_KEY\) \{\n\s*return getPublicSettings\(\);/);
    });

    it('is registered in the IPC table under a name that names no platform', () => {
        const table = read('dev/dedicatus/ipcChannels.mjs');
        expect(table).toContain("'external-player-restart-consent': { level: 'first-party'");
        expect(table).not.toContain('spotify-client-restart-consent');
        for (const file of ['electron/preload.cjs', 'src/vite-env.d.ts', 'electron/restartConsent.cjs']) {
            expect(read(file), file).not.toContain('spotify-client-restart-consent');
        }
        // The stored key stays where it was published (SETTING_KEY): only the channel and the call
        // the renderer makes are named after what they carry rather than after one player.
        for (const file of ['electron/preload.cjs', 'src/vite-env.d.ts']) {
            expect(read(file), file).not.toContain('spotifyClientRestartConsent');
        }
    });

    it('exposes one call in preload, which the renderer types', () => {
        expect(read('electron/preload.cjs')).toContain("externalPlayerRestartConsent: (grant) => ipcRenderer.invoke('external-player-restart-consent', grant),");
        expect(read('src/vite-env.d.ts')).toContain('externalPlayerRestartConsent: (grant?: boolean) => Promise<boolean>;');
    });
});
