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
import { reconcileFoliumClients } from '@/mods/runtime/clientLoader';
import { noteFoliumFirstScreenMounted, startFoliumForMainWindow } from '@/mods/runtime/mainWindowStart';
import { builtinSourcesSettled } from '@/services/onlineMusic/sourceReadiness';
import '@/mods/folium/api';

// test/unit/mod-system/folium2FirstScreenNoSources.test.ts
// Folium 2.0 S2, gate 2 (dev/folium/folium-2-plan.md §10): with no source mod at all, the first screen waits
// the 1.5 s it waited before Folium 2.0, and the session restore does not wait for the start question. Its own
// file: the source states are read once per page.

const FIRST_SCREEN_WAIT_MS = 1500;
const probes = () => ((globalThis as { __s2Clients?: Record<string, { finish?: () => void; started?: boolean }> }).__s2Clients ??= {});


const settle = async () => {
    for (let round = 0; round < 3; round += 1) {
        await vi.dynamicImportSettled();
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
};

const bridge = window as unknown as { electron?: { mods: Record<string, unknown> } };

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(async () => {
    // Clients start one after another: let each finish (or pass its limit) in turn.
    for (let round = 0; round < 4; round += 1) {
        Object.values(probes()).forEach((probe) => probe.finish?.());
        vi.advanceTimersByTime(10_000);
        await settle();
    }
    await reconcileFoliumClients([], 'main');
    delete bridge.electron;
    delete (globalThis as { __s2Clients?: unknown }).__s2Clients;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the first screen without any source mod (gate 2)', () => {
    it('waits 1.5 s as before Folium 2.0, and the session restore does not wait for the start question', async () => {
        bridge.electron = {
            mods: {
                // The mod list waits for the start question; the source states do not.
                listMods: () => new Promise(() => {}),
                getSourceStates: async () => ({ ok: true, states: {}, sources: [], hasSourceMods: false }),
                onSourceStatesChanged: () => () => {},
                reportModsStartSettled: vi.fn(async () => ({ ok: true })),
                reportModsStartAlive: vi.fn(async () => ({ ok: true })),
            },
        };
        const progress = { firstScreen: false, restore: false };
        void startFoliumForMainWindow({ firstScreenWaitMs: FIRST_SCREEN_WAIT_MS }).then(() => { progress.firstScreen = true; });
        void builtinSourcesSettled().then(() => { progress.restore = true; });
        await settle();
        expect(progress.restore).toBe(true);
        vi.advanceTimersByTime(FIRST_SCREEN_WAIT_MS - 1);
        await settle();
        expect(progress.firstScreen).toBe(false);
        vi.advanceTimersByTime(1);
        await settle();
        expect(progress.firstScreen).toBe(true);
        noteFoliumFirstScreenMounted();
    });
});
