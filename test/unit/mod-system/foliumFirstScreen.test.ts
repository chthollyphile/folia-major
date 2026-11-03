// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time, and Node's own experimental storage
// shadows jsdom's here, so an in-memory Storage goes in before any import runs.
// The saved lyric style is a mod's: the settings store finds no such style at
// import and falls back to a builtin one, and localStorage keeps the choice.
vi.hoisted(() => {
    const items = new Map<string, string>([['visualizer_mode', 'mod:first-style:glow']]);
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
import { exportModeProblem } from '@/mods/export/exportStart';
import { FOLIUM_START_LIMIT_MS, reconcileFoliumClients } from '@/mods/runtime/clientLoader';
import { noteFoliumFirstScreenMounted, startFoliumForMainWindow } from '@/mods/runtime/mainWindowStart';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
// The loader imports the client API on first use; loading it here keeps that out of the test's own time.
import '@/mods/folium/api';

// test/unit/mod-system/foliumFirstScreen.test.ts
// The main window's wait for the mods before its first screen, and what a
// mod that was not up by then still gets. What the user cannot see by using
// the app: the wait ends at its cap while a mod is still starting; the saved
// lyric style of that mod comes back when the mod is up; the start is reported
// to the main process as over (which takes up the start note) only when the
// first screen is mounted and every mod has come back from its start; and in
// the export window, a style whose mod did not start is an error, not a
// builtin style. The mod list comes from a stand-in for the main-process bridge.

const FIRST_SCREEN_WAIT_MS = 1500;
const SAVED_STYLE = 'mod:first-style:glow';

interface Probe {
    finish?: () => void;
}
const probes = () => ((globalThis as { __foliumFirstScreen?: Record<string, Probe> }).__foliumFirstScreen ??= {});

/* A client that registers a lyric style named "glow", but only when the test lets it finish. */
const styleClient = (name: string) => `data:text/javascript,${encodeURIComponent(`
export default function activate(folium) {
    const probe = ((globalThis.__foliumFirstScreen ??= {})['${name}'] = {});
    return new Promise((resolve) => {
        probe.finish = () => {
            probe.finish = undefined;
            folium.registries.visualizers.register({ id: 'glow', label: { en: 'Glow' }, mount: () => {} });
            resolve();
        };
    });
}
`)}`;

const mod = (id: string): ModRuntimeInfo => ({
    id,
    name: id,
    version: '1.0.0',
    author: null,
    description: null,
    permissions: [],
    status: 'loaded',
    error: null,
    enabled: true,
    trustStale: false,
    signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null },
    devSource: false,
    experimental: [],
    embedOrigins: [],
    folia: null,
    hasMain: false,
    clientUrl: styleClient(id),
});

/* Lets the imports and the promise chains behind them run; the timers stay where the test put them. */
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
});

afterEach(async () => {
    Object.values(probes()).forEach((probe) => probe.finish?.());
    await settle();
    await reconcileFoliumClients([], 'main');
    delete bridge.electron;
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the wait for mods before the first screen', () => {
    it('ends at its cap while a mod is still starting; the saved style comes back, and the start is reported as over, when that mod is up', async () => {
        const reportModsStartSettled = vi.fn(async () => ({ ok: true }));
        const reportModsStartAlive = vi.fn(async () => ({ ok: true }));
        bridge.electron = {
            mods: {
                listMods: async () => ({
                    mods: [mod('first-style')],
                    ffmpeg: { available: false, path: null, version: null, candidates: [] },
                    directories: [],
                }),
                reportModsStartSettled,
                reportModsStartAlive,
            },
        };
        expect(useVisualizerSettingsStore.getState().visualizerMode).not.toBe(SAVED_STYLE);

        const firstScreen = { ready: false };
        void startFoliumForMainWindow({ firstScreenWaitMs: FIRST_SCREEN_WAIT_MS }).then(() => { firstScreen.ready = true; });
        // The page says it is answering before the first client starts, then once a second.
        expect(reportModsStartAlive).toHaveBeenCalledTimes(1);
        await settle();
        vi.advanceTimersByTime(FIRST_SCREEN_WAIT_MS - 1);
        await settle();
        expect(firstScreen.ready).toBe(false);
        expect(reportModsStartAlive).toHaveBeenCalledTimes(2);

        vi.advanceTimersByTime(1);
        await settle();
        expect(firstScreen.ready).toBe(true);
        // The first screen is up without the mod: a builtin style stands in, the saved choice is kept.
        expect(useVisualizerSettingsStore.getState().visualizerMode).not.toBe(SAVED_STYLE);
        expect(localStorage.getItem('visualizer_mode')).toBe(SAVED_STYLE);

        // The start note stays down: not at the first screen, and not once that screen is
        // mounted either, while a mod has not come back from its start.
        expect(reportModsStartSettled).not.toHaveBeenCalled();
        noteFoliumFirstScreenMounted();
        await settle();
        expect(reportModsStartSettled).not.toHaveBeenCalled();

        probes()['first-style'].finish!();
        await settle();
        expect(useVisualizerSettingsStore.getState().visualizerMode).toBe(SAVED_STYLE);
        expect(reportModsStartSettled).toHaveBeenCalledTimes(1);

        // The start is over: the page no longer has to say it is answering.
        const said = reportModsStartAlive.mock.calls.length;
        vi.advanceTimersByTime(10_000);
        expect(reportModsStartAlive).toHaveBeenCalledTimes(said);
    });

    it('finds a mod\'s style missing in the export window until that mod has registered it (the wait for a slow mod is in foliumStartLimit.test.ts)', async () => {
        const queue = { done: false };
        void reconcileFoliumClients([mod('first-export')], 'export').then(() => { queue.done = true; });
        await settle();
        vi.advanceTimersByTime(FOLIUM_START_LIMIT_MS);
        await settle();
        expect(queue.done).toBe(true);
        expect(exportModeProblem('mod:first-export:glow')).toBe('export-mod-style-not-started');
        expect(exportModeProblem('classic')).toBeNull();

        probes()['first-export'].finish!();
        await settle();
        expect(exportModeProblem('mod:first-export:glow')).toBeNull();
    });
});
