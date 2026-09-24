// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time, and Node's own experimental storage
// shadows jsdom's here, so an in-memory Storage goes in before any import runs.
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
import { createFoliumClientApi, listFoliumHostRegistries } from '@/mods/folium/api';
import { stylesRegistry } from '@/mods/folium/registries/styles';
import { stageLayersRegistry } from '@/mods/folium/registries/stageLayers';
import { controlButtonsRegistry, progressLayersRegistry } from '@/mods/folium/registries/progress';
import { backgroundsRegistry } from '@/mods/folium/registries/backgrounds';
import { hasVisualizerBackgroundMode, VISUALIZER_BACKGROUND_REGISTRY } from '@/components/visualizer/backgrounds/registry';
import { commandsRegistry } from '@/mods/folium/registries/commands';
import { COMMAND_PALETTE_COMMANDS } from '@/components/command-palette/commandRegistry';
import { installFoliumCommandPaletteSync } from '@/mods/folium/commandPaletteSync';

// test/unit/mod-system/foliumUiRegistries.test.ts
// The UI registries a client reaches through `folium.registries`: validation of
// slots, CSS injection, background types in the host picker, the command
// palette mirror, and the export-context rule that UI registries are inert.

const mod = (overrides: Partial<ModRuntimeInfo> = {}): ModRuntimeInfo => ({
    id: 'mod-a',
    name: 'Mod A',
    version: '1.0.0',
    author: null,
    description: null,
    permissions: [],
    status: 'loaded',
    error: null,
    enabled: true,
    trustStale: false,
    experimental: [],
    embedOrigins: [],
    folia: null,
    hasMain: false,
    clientUrl: 'folia-mod://mod-a/client.mjs?v=1',
    ...overrides,
});

const noopMount = () => () => {};

afterEach(() => {
    listFoliumHostRegistries().forEach((registry) => registry.unregisterAll('mod-a'));
});

describe('styles registry', () => {
    it('injects CSS inside the folium-mods layer and removes it with the entry', () => {
        const handle = stylesRegistry.register('mod-a', { id: 'bar', css: '[data-folium-part="progress.fill"] { background: red; }' });
        const element = document.head.querySelector('style[data-folium-style="mod-a:bar"]');
        expect(element?.textContent).toContain('@layer folium-mods');
        expect(element?.textContent).toContain('progress.fill');
        handle.unregister();
        expect(document.head.querySelector('style[data-folium-style="mod-a:bar"]')).toBeNull();
    });

    it('rejects non-string and oversized CSS', () => {
        expect(() => stylesRegistry.register('mod-a', { id: 'x', css: 1 as unknown as string })).toThrow('css must be a string');
        expect(() => stylesRegistry.register('mod-a', { id: 'y', css: 'a'.repeat(70 * 1024) })).toThrow('limited');
    });
});

describe('slot validation', () => {
    it('only accepts declared stage and control slots', () => {
        expect(() => stageLayersRegistry.register('mod-a', { id: 'l', slot: 'player.nowhere' as never, mount: noopMount }))
            .toThrow('slot must be one of');
        expect(() => controlButtonsRegistry.register('mod-a', { id: 'b', slot: 'transport.left' as never, mount: noopMount }))
            .toThrow('slot must be one of');
        expect(() => progressLayersRegistry.register('mod-a', { id: 'p', mount: 'nope' as never })).toThrow('mount');
        expect(stageLayersRegistry.register('mod-a', { id: 'ok', slot: 'app.overlay', mount: noopMount }).id).toBe('mod-a:ok');
    });
});

describe('backgrounds registry', () => {
    it('adds a mod:-prefixed type to the host background registry and removes it', () => {
        const handle = backgroundsRegistry.register('mod-a', { id: 'video', label: { en: 'Video' }, order: 1, mount: noopMount });
        expect(hasVisualizerBackgroundMode('mod:mod-a:video')).toBe(true);
        expect(VISUALIZER_BACKGROUND_REGISTRY[0].mode).toBe('mod:mod-a:video');
        handle.unregister();
        expect(hasVisualizerBackgroundMode('mod:mod-a:video')).toBe(false);
    });
});

describe('client api bindings', () => {
    it('makes UI registries inert in the export context but keeps content ones live', () => {
        const api = createFoliumClientApi(mod(), { context: 'export', internals: null });
        api.registries.styles.register({ id: 's', css: 'a{}' });
        expect(stylesRegistry.list()).toHaveLength(0);
        api.registries.backgrounds.register({ id: 'b', label: {}, mount: noopMount });
        expect(backgroundsRegistry.list()).toHaveLength(1);
    });

    it('returns settings section handles that carry the values', () => {
        const api = createFoliumClientApi(mod(), { context: 'main', internals: null });
        const handle = api.registries.settingsSections.register({
            id: 'prefs',
            label: { en: 'Prefs' },
            settings: [{ key: 'url', type: 'text', label: {}, defaultValue: 'https://example.com' }],
        });
        expect(handle.id).toBe('mod-a:prefs');
        expect(handle.params.get()).toEqual({ url: 'https://example.com' });
    });

    it('gates internals behind the folia range and experimental behind opt-ins', () => {
        const plain = createFoliumClientApi(mod(), { context: 'main', internals: { secret: 1 } });
        expect(() => plain.internals.secret).toThrow('internals-require-folia-range');
        const pinned = createFoliumClientApi(mod({ folia: '>=0.7.0 <0.8.0' }), { context: 'main', internals: { secret: 1 } });
        expect(pinned.internals.secret).toBe(1);
        expect(() => plain.experimental.anything).toThrow('experimental-not-declared:anything');
    });

    it('rejects rpc and storage outside the main window', async () => {
        const api = createFoliumClientApi(mod(), { context: 'export', internals: null });
        await expect(api.rpc.call('x')).rejects.toThrow('rpc-unavailable-in-export-context');
        await expect(api.storage.get('k')).rejects.toThrow('storage-unavailable-in-export-context');
    });
});

describe('command palette sync', () => {
    it('mirrors mod commands into the palette list and removes them again', async () => {
        installFoliumCommandPaletteSync();
        const run = vi.fn();
        const handle = commandsRegistry.register('mod-a', { id: 'hello', label: { en: 'Say hello' }, keywords: ['greet'], run });
        const command = COMMAND_PALETTE_COMMANDS.find((entry) => entry.id === 'folium:mod-a:hello');
        expect(command?.textSource).toBe('runtime');
        expect(command?.keywords).toEqual(expect.arrayContaining(['Say hello', 'greet']));
        await command!.execute('', undefined as never);
        expect(run).toHaveBeenCalledWith({ values: {} });

        commandsRegistry.register('mod-a', {
            id: 'form',
            label: { en: 'With form' },
            params: [{ key: 'n', type: 'number', label: {} }],
            run,
        });
        const withForm = COMMAND_PALETTE_COMMANDS.find((entry) => entry.id === 'folium:mod-a:form');
        expect(withForm?.surface).toBeDefined();
        expect(withForm?.requiresInput).toBe(true);

        handle.unregister();
        commandsRegistry.unregisterAll('mod-a');
        expect(COMMAND_PALETTE_COMMANDS.some((entry) => entry.id.startsWith('folium:mod-a:'))).toBe(false);
    });
});
