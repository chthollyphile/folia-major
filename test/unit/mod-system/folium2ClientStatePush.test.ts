// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});
import type { ModRuntimeInfo } from '@/mods/types';
import { initFoliumClients, isFoliumClientActive, reconcileFoliumClients } from '@/mods/runtime/clientLoader';
import '@/mods/folium/api';

// test/unit/mod-system/folium2ClientStatePush.test.ts
// Folium 2.0 S4: the main window follows the mod list the main process pushes after each load
// (folia-mods:state-changed), not only once the mods panel has bound its store: a built-in mod rebuilt in a
// development build (dist-mods/, electron/modSystem/builtinBuildWatch.cjs) comes back under its new client URL,
// and the other mods' clients stay as they are.

const activations = () => ((globalThis as { __s4Clients?: Record<string, number> }).__s4Clients ??= {});
const client = (name: string, version: string) => `data:text/javascript,${encodeURIComponent(`
export default function activate() {
    const counts = (globalThis.__s4Clients ??= {});
    counts['${name}'] = (counts['${name}'] ?? 0) + 1;
}
// ${version}
`)}`;
const mod = (id: string, version: string): ModRuntimeInfo => ({
    id, name: id, version: '1.0.0', author: null, description: null, permissions: [], status: 'loaded', error: null,
    enabled: true, trustStale: false, signature: { status: 'builtin', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false, experimental: [], embedOrigins: [], folia: null, hasMain: false, clientUrl: client(id, version),
    folium: 2, tier: 'builtin', kind: 'standard',
});

const settle = async () => {
    for (let round = 0; round < 3; round += 1) {
        await vi.dynamicImportSettled();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
};

const bridge = window as unknown as { electron?: { mods: Record<string, unknown> } };

beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
    await reconcileFoliumClients([], 'main');
    delete bridge.electron;
    delete (globalThis as { __s4Clients?: unknown }).__s4Clients;
    vi.restoreAllMocks();
});

describe('the main window and the mod list the main process pushes', () => {
    it('restarts the client whose URL changed and leaves the others', async () => {
        let push: ((mods: ModRuntimeInfo[]) => void) | null = null;
        bridge.electron = {
            mods: {
                listMods: async () => ({ mods: [mod('rebuilt', 'a'), mod('steady', 'a')] }),
                onModsStateChanged: (callback: (mods: ModRuntimeInfo[]) => void) => {
                    push = callback;
                    return () => { push = null; };
                },
                reportFoliumSourcesRegistered: async () => ({ ok: true }),
            },
        };
        await initFoliumClients();
        await settle();
        expect(activations()).toEqual({ rebuilt: 1, steady: 1 });
        expect(push).not.toBeNull();

        (push as unknown as (mods: ModRuntimeInfo[]) => void)([mod('rebuilt', 'b'), mod('steady', 'a')]);
        await settle();
        expect(activations()).toEqual({ rebuilt: 2, steady: 1 });

        // A mod the load dropped goes too.
        (push as unknown as (mods: ModRuntimeInfo[]) => void)([mod('steady', 'a')]);
        await settle();
        expect(isFoliumClientActive('rebuilt')).toBe(false);
        expect(isFoliumClientActive('steady')).toBe(true);
    });

    it('still starts the clients with a bridge that has no push to follow', async () => {
        bridge.electron = { mods: { listMods: async () => ({ mods: [mod('alone', 'a')] }) } };
        await initFoliumClients();
        await settle();
        expect(activations()).toEqual({ alone: 1 });
    });
});
