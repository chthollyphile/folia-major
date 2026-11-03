// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
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
// The host objects of folium.internals are the app's stores; the test needs only to see them handed out.
vi.mock('@/mods/folium/deprecated/internals', () => ({ createFoliumInternals: () => ({ React: 'the host React' }) }));
// No Electron bridge here: storage answers as an empty data file does.
vi.mock('@/mods/ipc', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/mods/ipc')>()),
    invokeModStorage: async () => ({ ok: true, result: null }),
}));
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'node:url';
import type { ModRuntimeInfo } from '@/mods/types';
import type { FoliumClientApi, FoliumMount } from '@/mods/folium/contract';
import { createFoliumClientApi, listFoliumHostRegistries } from '@/mods/folium/api';
import { addOldClientNames } from '@/mods/folium/deprecated';
import { createFoliumMountScope, type FoliumHostContext } from '@/mods/folium/helpers';
import { registerFoliumHostActions, type FoliumHostActions } from '@/mods/folium/services';
import { clearFoliumIssues, getFoliumIssues } from '@/mods/runtime/status';
import { clearFoliumOldNames, useFoliumOldNameStore } from '@/mods/folium/deprecated/warnings';
import { progressButtonsRegistry, progressLayersRegistry } from '@/mods/folium/registries/progress';
import { visualizersRegistry } from '@/mods/folium/registries/visualizers';
import { settingsSectionsRegistry } from '@/mods/folium/registries/settingsSections';
import { stylesRegistry } from '@/mods/folium/registries/styles';
import { tuningsRegistry } from '@/mods/folium/registries/tunings';
import { stageLayersRegistry } from '@/mods/folium/registries/stageLayers';
import { useFoliumParamStore } from '@/mods/params/paramStore';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumDeprecatedClient.test.ts
// Folium 1.6 only (src/mods/folium/deprecated/): a client entry written for Folium 1.5 still runs. Each
// old name works and is said once per mod in the mod's row; a mod that uses no old name gets nothing.
// The last part runs the repository's samples as they were before the Folium 2 cleanup (1fc306f6,
// copied into test/fixtures/folium-1.5-mods/): they register, mount and react with warnings only.
// Step 2 deletes this file.

const require = createRequire(import.meta.url);
const { validateManifest } = require('../../../electron/modSystem/manifest.cjs');

const FIXTURES = path.resolve(__dirname, '../../fixtures/folium-1.5-mods');
const MOD_ID = 'old-mod';

const modInfo = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: MOD_ID,
    name: MOD_ID,
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
    clientUrl: `folia-mod://${MOD_ID}/client.mjs?v=1`,
    ...overrides,
});

const folium = (mod: ModRuntimeInfo, experimental: Record<string, unknown> = {}, context: 'main' | 'export' = 'main') => (
    addOldClientNames(createFoliumClientApi(mod, clientApiOptions(context, { experimental })), mod, context)
);

/* The old names the mod's row lists for its client, in the order they were used. */
const row = (modId = MOD_ID) => useFoliumOldNameStore.getState().byMod[modId] ?? [];

// ---- host contexts, shaped as the host builds them (FoliumHostContext)

const source = <Args extends unknown[]>() => {
    const listeners = new Set<(...args: Args) => void>();
    return {
        on: (listener: (...args: Args) => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
        emit: (...args: Args) => listeners.forEach((listener) => listener(...args)),
    };
};

const hostClock = () => {
    let now = 0;
    const changes = source<[number]>();
    return { get: () => now, on: changes.on, set: (seconds: number) => { now = seconds; changes.emit(seconds); } };
};

const THEME = {
    name: 'test', backgroundColor: '#000000', primaryColor: '#ffffff', accentColor: '#ff0000', secondaryColor: '#888888',
    fontStyle: 'sans', animationIntensity: 'normal', isDaylight: false,
} as const;

const progressHost = () => {
    const clock = hostClock();
    const changes = source<[]>();
    const ctx = {
        playbackTime: clock,
        getDuration: () => 200,
        timeToRatio: (seconds: number) => seconds / 200,
        seek: vi.fn(),
        getColors: () => ({ fill: '#ffffff', track: '#333333', text: '#eeeeee' }),
        subscribe: changes.on,
    };
    return { ctx, clock, change: changes.emit };
};

const stageHost = () => {
    const clock = hostClock();
    const changes = source<[]>();
    const line = {
        words: [{ text: 'hello', startTime: 0, endTime: 1 }], startTime: 0, endTime: 2, fullText: 'hello',
        renderHints: {},
    };
    const ctx = {
        lines: [line], song: null, staticMode: false, staticLineIndex: null, seed: null, isPreview: false,
        lyricTime: clock,
        getDuration: () => 200,
        getLineIndex: () => 0,
        isPaused: () => false,
        getTheme: () => THEME,
        getSubtitleTheme: () => THEME,
        getCoverUrl: () => null,
        getDisplay: () => ({ showText: true, lyricsFontScale: 1 }),
        getSettings: () => ({}),
        getSurface: () => ({ transparent: false, hostBackground: true }),
        audio: { getPower: () => 0, getBands: () => ({}), getSpectrum: () => null },
        subscribe: changes.on,
    };
    return { ctx, clock, change: changes.emit };
};

/* Mounts one registered entry the way FoliumMountHost does; returns the container and the end of the mount. */
const mountEntry = <Ctx>(modId: string, mount: FoliumMount<Ctx>, ctx: object) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const scope = createFoliumMountScope<Ctx>(ctx as FoliumHostContext<Ctx>, modId, `test ${modId}`, container);
    scope.adopt(mount(container, scope.ctx));
    return { container, end: scope.end };
};

const MOD_IDS = [MOD_ID, 'new-mod', 'transparent-mov-export', 'more-progress-buttons', 'sample-progress-bar',
    'sample-aurora-visualizer', 'k3panel', 'sample-rickroll'];

beforeEach(() => {
    registerFoliumHostActions({
        getPlaybackState: () => ({ song: null, state: 'paused', position: 0, duration: 0, liked: false }),
        toast: () => {},
    } as unknown as FoliumHostActions);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    MOD_IDS.forEach((modId) => {
        listFoliumHostRegistries().forEach((registry) => registry.unregisterAll(modId));
        clearFoliumIssues(modId);
        clearFoliumOldNames(modId);
    });
    registerFoliumHostActions(null);
    useFoliumParamStore.setState({ byScope: {} });
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('old client names', () => {
    it('keeps ctx.subscribe, ctx.currentTime (with its on) and ctx.onTime on a progress context, each said once', async () => {
        const api = await folium(modInfo());
        const seen: string[] = [];
        api.registries.progressButtons.register({
            id: 'b',
            slot: 'progress.trailing',
            mount: (_container, ctx) => {
                const old = ctx as unknown as Record<string, any>;
                old.subscribe(() => seen.push('change'));
                old.subscribe(() => seen.push('change again'));
                old.currentTime.on('change', (seconds: number) => seen.push(`on ${seconds}`));
                old.onTime((seconds: number) => seen.push(`onTime ${seconds}`));
                seen.push(`now ${old.currentTime.get()}`);
            },
        });
        const host = progressHost();
        mountEntry(MOD_ID, progressButtonsRegistry.get(`${MOD_ID}:b`)!.def.mount, host.ctx);
        host.clock.set(7);
        host.change();
        expect(seen).toEqual(['now 0', 'on 7', 'onTime 7', 'change', 'change again']);
        expect(row()).toEqual([
            'ctx.subscribe: removed in Folium 2, use ctx.onChange',
            'ctx.currentTime.on: removed in Folium 2, use ctx.onPlaybackTime',
            'ctx.onTime: removed in Folium 2, use ctx.onPlaybackTime',
            'ctx.currentTime: removed in Folium 2, use ctx.playbackTime',
        ]);
        // None of them is in the list of what failed.
        expect(getFoliumIssues(MOD_ID)).toEqual([]);
    });

    it('reads ctx.currentTime of a lyric context as ctx.lyricTime', async () => {
        const api = await folium(modInfo());
        let read = -1;
        api.registries.visualizers.register({
            id: 'v',
            label: {},
            mount: (_container, ctx) => {
                const old = ctx as unknown as Record<string, any>;
                old.currentTime.on('change', (seconds: number) => { read = old.currentTime.get() + seconds; });
            },
        });
        const host = stageHost();
        mountEntry(MOD_ID, visualizersRegistry.get(`${MOD_ID}:v`)!.def.def.mount, host.ctx);
        host.clock.set(3);
        expect(read).toBe(6);
        expect(row()).toContain('ctx.currentTime: removed in Folium 2, use ctx.lyricTime');
        expect(row()).toContain('ctx.currentTime.on: removed in Folium 2, use ctx.onLyricTime');
    });

    it('keeps the params of a settings section handle and of a settingsPanel context, with params.subscribe', async () => {
        const api = await folium(modInfo());
        const handle = api.registries.settingsSections.register({
            id: 's',
            label: {},
            settings: [{ key: 'n', type: 'number', label: {}, defaultValue: 2 }],
            settingsPanel: (_container, ctx) => {
                expect((ctx as unknown as Record<string, any>).params.get()).toEqual({ n: 5 });
            },
        }) as unknown as Record<string, any>;
        expect(handle.params.get()).toEqual({ n: 2 });
        const changes: unknown[] = [];
        handle.params.subscribe(() => changes.push(handle.params.get().n));
        handle.settings.set({ n: 5 });
        expect(changes).toEqual([5]);

        const panel = settingsSectionsRegistry.get(`${MOD_ID}:s`)!.def.def as unknown as { settingsPanel: FoliumMount<unknown> };
        mountEntry(MOD_ID, panel.settingsPanel, { locale: 'en', getTheme: () => THEME, subscribe: source<[]>().on, settings: handle.settings });
        expect(row()).toEqual([
            'settingsSections.register(…).params: removed in Folium 2, use .settings',
            'params.subscribe: removed in Folium 2, use settings.onChange',
            'ctx.params: removed in Folium 2, use ctx.settings',
        ]);
    });

    it('keeps registries.controlButtons, the control-button container name and a tuning\'s params', async () => {
        const api = await folium(modInfo()) as unknown as { registries: Record<string, { register: (def: unknown) => unknown }> };
        api.registries.controlButtons.register({ id: 'c', slot: 'progress.leading', mount: () => {} });
        expect(progressButtonsRegistry.get(`${MOD_ID}:c`)).not.toBeNull();

        api.registries.styles.register({ id: 'css', css: '[data-folium-kind="control-button"] { color: red; }' });
        expect(stylesRegistry.get(`${MOD_ID}:css`)!.def.css).toBe('[data-folium-kind="progress-button"] { color: red; }');

        api.registries.tunings.register({
            id: 't', target: 'sonnet', label: {}, params: [{ key: 'cameraScale', type: 'number', label: {}, min: 0, max: 3 }],
        });
        expect(tuningsRegistry.get(`${MOD_ID}:t`)!.def.settings.map((field) => field.key)).toEqual(['cameraScale']);
        expect(row()).toEqual([
            'folium.registries.controlButtons: removed in Folium 2, use folium.registries.progressButtons',
            'data-folium-kind="control-button": removed in Folium 2, use data-folium-kind="progress-button"',
            'tunings.register({ params }): removed in Folium 2, use tunings.register({ settings })',
        ]);
    });

    it('renames the old container name in a Ponder target\'s selectors', async () => {
        const register = vi.fn();
        const api = await folium(modInfo({ experimental: ['ponder.targets'] }), { 'ponder.targets': { register } });
        const isAvailable = () => true;
        (api.experimental['ponder.targets'] as { register: (def: unknown) => void }).register({
            id: 'p',
            hoverSelector: '[data-folium-kind=\'control-button\'][data-folium-owner="old-mod"]',
            isAvailable,
            scenes: [{ anchors: { button: { kind: 'dom', selector: '[data-folium-kind="control-button"]', labelKey: 'control-button' } } }],
        });
        const def = register.mock.calls[0][0];
        expect(def.hoverSelector).toBe('[data-folium-kind=\'progress-button\'][data-folium-owner="old-mod"]');
        expect(def.scenes[0].anchors.button).toEqual({ kind: 'dom', selector: '[data-folium-kind="progress-button"]', labelKey: 'control-button' });
        expect(def.isAvailable).toBe(isAvailable);
        expect('ponder.targets' in api.experimental).toBe(true);
        expect(() => api.experimental['omni.providers']).toThrow('experimental-not-declared:omni.providers');
        expect(row()).toEqual(['data-folium-kind="control-button": removed in Folium 2, use data-folium-kind="progress-button"']);
    });

    it('gives folium.internals only to a mod with a "folia" range, in the main window, as Folium 1.5 did', async () => {
        const pinned = await folium(modInfo({ folia: '>=0.7.0 <0.8.0' })) as unknown as { internals: Record<string, unknown> };
        expect(pinned.internals.React).toBe('the host React');
        expect(() => pinned.internals.nothing).toThrow('internals-unknown:nothing');
        expect(row()).toEqual(['folium.internals: removed in Folium 2, nothing takes its place']);

        const unpinned = await folium(modInfo({ id: 'new-mod' })) as unknown as { internals: Record<string, unknown> };
        expect(() => unpinned.internals.React).toThrow('internals-require-folia-range');
        const exported = await folium(modInfo({ id: 'new-mod', folia: '>=0.7.0' }), {}, 'export') as unknown as { internals: Record<string, unknown> };
        expect(() => exported.internals.React).toThrow('internals-unavailable-in-export-context');
    });

    it('takes an event name that is no event as Folium 1.5 did, without throwing', async () => {
        const api = await folium(modInfo());
        const off = api.events.on('playback.songChange' as 'playback.songChanged', () => {});
        expect(typeof off).toBe('function');
        off();
        expect(row()).toEqual(["folium.events.on('playback.songChange'): does nothing; Folium 2 throws unknown-event:<name>"]);
    });

    it('keeps the old names in a copy of ctx or of a handle, as Folium 1.5 did, and says them when the copy uses them', async () => {
        const api = await folium(modInfo());
        const handle = { ...api.registries.settingsSections.register({ id: 's', label: {}, settings: [{ key: 'n', type: 'number', label: {}, defaultValue: 1 }] }) } as Record<string, any>;
        expect(handle.params.get()).toEqual({ n: 1 });
        let copied: Record<string, any> = {};
        api.registries.progressButtons.register({ id: 'b', slot: 'progress.trailing', mount: (_container, ctx) => { copied = { ...ctx }; } });
        const host = progressHost();
        mountEntry(MOD_ID, progressButtonsRegistry.get(`${MOD_ID}:b`)!.def.mount, host.ctx);
        expect(Object.keys(copied)).toEqual(expect.arrayContaining(['subscribe', 'currentTime', 'onTime']));
        const seen: number[] = [];
        copied.onTime((seconds: number) => seen.push(seconds));
        host.clock.set(4);
        expect(seen).toEqual([4]);
        expect(row()).toEqual([
            'settingsSections.register(…).params: removed in Folium 2, use .settings',
            'ctx.onTime: removed in Folium 2, use ctx.onPlaybackTime',
        ]);
    });

    it('says nothing to a mod that copies ctx, a handle or folium itself but uses only today\'s names', async () => {
        const api = await folium(modInfo({ id: 'new-mod', folia: '>=0.7.0' }));
        const whole = { ...api, registries: { ...api.registries } };
        const handle = { ...whole.registries.settingsSections.register({ id: 's', label: {}, settings: [{ key: 'n', type: 'number', label: {}, defaultValue: 1 }] }) };
        handle.settings.get();
        whole.registries.progressButtons.register({ id: 'b', slot: 'progress.trailing', mount: (_container, ctx) => { ({ ...ctx }).onChange(() => {}); } });
        mountEntry('new-mod', progressButtonsRegistry.get('new-mod:b')!.def.mount, progressHost().ctx);
        expect(row('new-mod')).toEqual([]);
    });

    it('lists folium.experimental\'s keys as the mod\'s own object does', async () => {
        const api = await folium(modInfo({ experimental: ['ponder.targets'] }), { 'ponder.targets': { register: vi.fn() } });
        expect(Object.keys(api.experimental)).toEqual(['ponder.targets']);
        expect(Object.getOwnPropertyDescriptor(api.experimental, 'ponder.targets')?.value).toBe(api.experimental['ponder.targets']);
        expect(row()).toEqual([]);
    });

    it('says nothing to a mod that uses only today\'s names', async () => {
        const api = await folium(modInfo({ id: 'new-mod' }));
        const handle = api.registries.settingsSections.register({ id: 's', label: {}, settings: [{ key: 'n', type: 'number', label: {}, defaultValue: 1 }] });
        handle.settings.onChange(() => {});
        api.registries.progressButtons.register({
            id: 'b',
            slot: 'progress.trailing',
            mount: (_container, ctx) => {
                ctx.onChange(() => {});
                ctx.onPlaybackTime(() => {});
                ctx.playbackTime.get();
            },
        });
        mountEntry('new-mod', progressButtonsRegistry.get('new-mod:b')!.def.mount, progressHost().ctx);
        api.events.on('playback.songChanged', () => {});
        expect(row('new-mod')).toEqual([]);
    });
});

// ---- the repository's samples as Folium 1.5 had them

/* A fixture mod as the window gets it: mod.json through the loader's validator (old permission ids read as new). */
const fixtureMod = (name: string) => {
    const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, name, 'mod.json'), 'utf8'));
    const result = validateManifest(raw);
    expect(result.ok ? [] : result.errors).toEqual([]);
    const { id, permissions, experimental, embedOrigins, folia } = result.value;
    return modInfo({ id, name: id, permissions, experimental, embedOrigins, folia, clientUrl: `folia-mod://${id}/client.mjs?v=1` });
};

/* Imports a fixture's client entry and runs its activate with the `folium` object the loader would give it. */
const runSample = async (name: string) => {
    const mod = fixtureMod(name);
    const api: FoliumClientApi = await folium(mod);
    const module = await import(/* @vite-ignore */ pathToFileURL(path.join(FIXTURES, name, 'client.mjs')).href);
    const dispose = module.default(api);
    return { mod, dispose: typeof dispose === 'function' ? dispose : () => {} };
};

/* Nothing of the mod failed (its row lists no problem); returns the old names it used. */
const onlyWarnings = (modId: string) => {
    expect(getFoliumIssues(modId)).toEqual([]);
    return row(modId).map((line) => line.slice(0, line.indexOf(': ')));
};

describe('the samples as Folium 1.5 had them', () => {
    it('sample-progress-bar: its button and layer mount, follow the clock and repaint, with warnings only', async () => {
        const { mod, dispose } = await runSample('sample-progress-bar');
        expect(mod.permissions).toEqual(['net.fetch', 'filesystem.data']);
        const host = progressHost();
        const button = mountEntry(mod.id, progressButtonsRegistry.get(`${mod.id}:bookmark`)!.def.mount, host.ctx);
        const layer = mountEntry(mod.id, progressLayersRegistry.get(`${mod.id}:markers`)!.def.mount, host.ctx);
        expect(button.container.querySelector('button')).not.toBeNull();
        host.change();
        expect(stylesRegistry.get(`${mod.id}:progress-look`)).not.toBeNull();
        button.end();
        layer.end();
        dispose();
        expect(onlyWarnings(mod.id).sort()).toEqual([
            'ctx.subscribe', 'folium.registries.controlButtons', 'params.subscribe', 'settingsSections.register(…).params',
        ]);
    });

    it('more-progress-buttons: its three buttons register through controlButtons and follow the settings', async () => {
        const { mod, dispose } = await runSample('more-progress-buttons');
        const ids = progressButtonsRegistry.list().filter((entry) => entry.modId === mod.id).map((entry) => entry.id).sort();
        expect(ids.length).toBeGreaterThan(0);
        const host = progressHost();
        const mounted = ids.map((id) => mountEntry(mod.id, progressButtonsRegistry.get(id)!.def.mount, host.ctx));
        host.change();
        mounted.forEach(({ end }) => end());
        dispose();
        expect(onlyWarnings(mod.id)).toEqual(expect.arrayContaining(['folium.registries.controlButtons', 'params.subscribe']));
    });

    it('sample-aurora-visualizer: draws the line and follows ctx.currentTime.on', async () => {
        const { mod } = await runSample('sample-aurora-visualizer');
        const host = stageHost();
        const { container, end } = mountEntry(mod.id, visualizersRegistry.get(`${mod.id}:aurora-text`)!.def.def.mount, host.ctx);
        expect(container.textContent).toBe('hello');
        host.clock.set(0.5);
        host.change();
        end();
        expect(onlyWarnings(mod.id).sort()).toEqual(['ctx.currentTime', 'ctx.currentTime.on', 'ctx.subscribe']);
    });

    it('k3panel: its tuning registers with params read as settings', async () => {
        const { mod } = await runSample('k3panel');
        expect(tuningsRegistry.get(`${mod.id}:sonnet-deep-tuning`)!.def.settings.length).toBeGreaterThan(0);
        expect(onlyWarnings(mod.id)).toEqual(['tunings.register({ params })']);
    });

    it('sample-rickroll and sample-transparent-mov-export: register what they did, without a warning', async () => {
        const rickroll = await runSample('sample-rickroll');
        expect(rickroll.mod.permissions).toEqual(['stageLayers', 'net.embed']);
        expect(stageLayersRegistry.get(`${rickroll.mod.id}:video-window`)).not.toBeNull();
        const exporter = await runSample('sample-transparent-mov-export');
        expect(onlyWarnings(rickroll.mod.id)).toEqual([]);
        expect(onlyWarnings(exporter.mod.id)).toEqual([]);
    });
});
