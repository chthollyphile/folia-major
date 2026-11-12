// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// Which mods have started, and under what name, is the client loader's; here the tests say it.
const loader = vi.hoisted(() => ({
    starts: new Map<string, { state: 'starting'; late: boolean } | { state: 'started'; ms: number }>(),
    names: new Map<string, string>(),
}));
vi.mock('@/mods/runtime/clientLoader', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/mods/runtime/clientLoader')>()),
    getFoliumClientStart: (modId: string) => loader.starts.get(modId),
    foliumModName: (modId: string) => loader.names.get(modId) || modId,
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import i18n from '@/i18n/config';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import { runGlobalShortcutCommand } from '@/components/command-palette/globalShortcuts/runGlobalShortcutCommand';
import { useGlobalShortcuts } from '@/components/command-palette/globalShortcuts/useGlobalShortcuts';
import { PORTAL_GLOBAL_SHORTCUTS, toGlobalShortcutAccelerator } from '@/components/command-palette/globalShortcuts/globalShortcutRules';
import { useGlobalShortcutStatusStore } from '@/components/command-palette/globalShortcuts/globalShortcutStatusStore';
import { GlobalShortcutsGroup } from '@/components/modal/settings/pages/GlobalShortcutsGroup';
import { commandsRegistry } from '@/mods/folium/registries/commands';
import { installFoliumCommandPaletteSync } from '@/mods/folium/registries/commandPaletteSync';
import { getFoliumGlobalShortcutCommandIds } from '@/mods/folium/registries/globalShortcutCommands';
import { installFoliumFaultNotice } from '@/mods/runtime/faultNotice';
import { getFoliumIssues } from '@/mods/runtime/status';
import { useInteractionSettingsStore } from '@/stores/useInteractionSettingsStore';
import { useStatusMessageStore } from '@/stores/useStatusMessageStore';

// test/unit/mod-system/foliumGlobalShortcutCommands.test.ts
// Folium 1.7 `globalShortcut`: which mod commands Settings → Global shortcuts may bind (flagged,
// without params, registered now), what a press of one does (its palette entry runs it; a throw is
// recorded against the mod without a notice; a command gone since does not run), and what a slot
// bound to a mod command that is not there says, and which keys the registering hook hands the main
// process as mod commands come and go.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

installFoliumFaultNotice();
installFoliumCommandPaletteSync();

const LIVE_CONTEXT = { settings: { modSystemEnabled: true } } as unknown as CommandPaletteContext;
const MODS = ['gs-ids', 'gs-run', 'gs-row', 'gs-hook'];

beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    MODS.forEach((modId) => commandsRegistry.unregisterAll(modId));
    loader.starts.clear();
    loader.names.clear();
    vi.restoreAllMocks();
});

describe('the mod commands that may be bound', () => {
    it('are the registered ones that set globalShortcut and take no params', () => {
        commandsRegistry.register('gs-ids', { id: 'ping', label: { en: 'Ping' }, globalShortcut: true, run: () => {} });
        commandsRegistry.register('gs-ids', { id: 'plain', label: { en: 'Plain' }, run: () => {} });
        commandsRegistry.register('gs-ids', {
            id: 'form',
            label: { en: 'Form' },
            globalShortcut: true,
            params: [{ key: 'name', type: 'text', label: { en: 'Name' }, defaultValue: '' }],
            run: () => {},
        });
        expect([...getFoliumGlobalShortcutCommandIds()]).toEqual(['folium:gs-ids:ping']);
        // A flag the host ignores is said once, at registration.
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('gs-ids:form has params'));
        // The same Set until something changes, so a memo over it holds.
        expect(getFoliumGlobalShortcutCommandIds()).toBe(getFoliumGlobalShortcutCommandIds());

        commandsRegistry.unregisterAll('gs-ids');
        expect(getFoliumGlobalShortcutCommandIds().size).toBe(0);
    });

    it('stay the same Set while only commands that cannot be bound come and go', () => {
        commandsRegistry.register('gs-ids', { id: 'ping', label: { en: 'Ping' }, globalShortcut: true, run: () => {} });
        const before = getFoliumGlobalShortcutCommandIds();
        const plain = commandsRegistry.register('gs-ids', { id: 'plain', label: { en: 'Plain' }, run: () => {} });
        expect(getFoliumGlobalShortcutCommandIds()).toBe(before);
        plain.unregister();
        expect(commandsRegistry.get('gs-ids:plain')).toBeNull();
        expect(getFoliumGlobalShortcutCommandIds()).toBe(before);

        commandsRegistry.register('gs-ids', { id: 'pong', label: { en: 'Pong' }, globalShortcut: true, run: () => {} });
        const after = getFoliumGlobalShortcutCommandIds();
        expect(after).not.toBe(before);
        expect([...after]).toEqual(['folium:gs-ids:ping', 'folium:gs-ids:pong']);
    });

    it('do not follow a flag the mod changes after registering', () => {
        const def = { id: 'ping', label: { en: 'Ping' }, globalShortcut: false, run: () => {} };
        commandsRegistry.register('gs-ids', def);
        def.globalShortcut = true;
        commandsRegistry.register('gs-ids', { id: 'other', label: { en: 'Other' }, run: () => {} });
        expect(getFoliumGlobalShortcutCommandIds().size).toBe(0);
    });
});

describe('a press of a bound mod command', () => {
    it('runs the command with its defaults and records a throw against the mod, without a notice', async () => {
        const seen: unknown[] = [];
        commandsRegistry.register('gs-run', {
            id: 'ping',
            label: { en: 'Ping' },
            globalShortcut: true,
            run: ({ values }) => {
                seen.push(values);
                throw new Error('main entry gone');
            },
        });
        expect(runGlobalShortcutCommand('folium:gs-run:ping', LIVE_CONTEXT)).toBe(true);
        await vi.waitFor(() => expect(getFoliumIssues('gs-run')).toHaveLength(1));
        expect(seen).toEqual([{}]);
        expect(getFoliumIssues('gs-run')[0]).toMatchObject({ where: 'command gs-run:ping', message: 'main entry gone' });
        expect(useStatusMessageStore.getState().message).toBeNull();
    });

    it('does nothing once the command is gone, or while the mod system is off', () => {
        const run = vi.fn();
        commandsRegistry.register('gs-run', { id: 'ping', label: { en: 'Ping' }, globalShortcut: true, run });
        const off = { settings: { modSystemEnabled: false } } as unknown as CommandPaletteContext;
        expect(runGlobalShortcutCommand('folium:gs-run:ping', off)).toBe(false);
        commandsRegistry.unregisterAll('gs-run');
        expect(runGlobalShortcutCommand('folium:gs-run:ping', LIVE_CONTEXT)).toBe(false);
        expect(run).not.toHaveBeenCalled();
    });
});

describe('the settings rows', () => {
    let root: Root | null = null;
    let host: HTMLDivElement | null = null;

    const render = () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root!.render(React.createElement(GlobalShortcutsGroup)));
    };
    const rowText = (slot: number) => {
        const label = i18n.t('options.globalShortcutSlot', { index: slot + 1 });
        const rows = Array.from(host!.querySelectorAll('[data-settings-row], div'));
        // The innermost element that holds both the slot's label and its status line.
        const row = rows.reverse().find(element => element.textContent?.includes(label) && element.querySelector('[role="status"]'));
        return row?.textContent ?? '';
    };

    beforeEach(() => {
        useGlobalShortcutStatusStore.getState().setBackend('native');
    });

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        root = null;
        host = null;
        for (let slot = 0; slot < 5; slot += 1) {
            useInteractionSettingsStore.getState().setGlobalShortcutBinding(slot, { key: null, commandId: null });
        }
    });

    it('says a bound mod command is not enabled, keeps the binding, and clears once it is back', () => {
        loader.names.set('gs-row', 'Row Mod');
        useInteractionSettingsStore.getState().setGlobalShortcutBinding(0, { key: 'k', commandId: 'folium:gs-row:ping' });
        render();
        expect(rowText(0)).toContain(i18n.t('options.globalShortcutModInactive'));
        // The bound command stays the shown value, named by its mod.
        expect(host!.textContent).toContain(i18n.t('options.globalShortcutModCommand', { mod: 'Row Mod', command: 'ping' }));
        expect(useInteractionSettingsStore.getState().globalShortcutBindings[0]).toEqual({ key: 'k', modifiers: ['control', 'alt', 'shift'], commandId: 'folium:gs-row:ping' });

        act(() => {
            loader.starts.set('gs-row', { state: 'started', ms: 1 });
            commandsRegistry.register('gs-row', { id: 'ping', label: { en: 'Ping main' }, globalShortcut: true, run: () => {} });
        });
        expect(host!.textContent).not.toContain(i18n.t('options.globalShortcutModInactive'));
        expect(host!.textContent).toContain(i18n.t('options.globalShortcutModCommand', { mod: 'Row Mod', command: 'Ping main' }));
        // The command comes first, so a label cut short in the narrow trigger still shows it.
        expect(i18n.t('options.globalShortcutModCommand', { mod: 'Row Mod', command: 'Ping main' }).startsWith('Ping main')).toBe(true);
    });

    it('says a running mod no longer offers the bound command', () => {
        loader.starts.set('gs-row', { state: 'started', ms: 1 });
        useInteractionSettingsStore.getState().setGlobalShortcutBinding(1, { key: 'j', commandId: 'folium:gs-row:gone' });
        render();
        expect(rowText(1)).toContain(i18n.t('options.globalShortcutModCommandMissing'));
    });
});

describe('the keys handed to the main process', () => {
    type Electron = NonNullable<Window['electron']>;
    let root: Root | null = null;
    let host: HTMLDivElement | null = null;
    let renders = 0;
    const setGlobalShortcuts = vi.fn(async (accelerators: string[]) => ({
        backend: 'native' as const,
        results: accelerators.map((accelerator) => ({ accelerator, registered: true })),
    }));
    let backend: 'native' | 'portal' = 'native';

    const Probe = () => {
        renders += 1;
        useGlobalShortcuts(() => {});
        return null;
    };
    const render = async () => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => root!.render(React.createElement(Probe)));
    };
    const lastSent = () => setGlobalShortcuts.mock.calls.at(-1)?.[0] ?? null;

    beforeEach(() => {
        renders = 0;
        backend = 'native';
        setGlobalShortcuts.mockClear();
        (window as { electron?: Partial<Electron> }).electron = {
            getGlobalShortcutBackend: async () => backend,
            setGlobalShortcuts,
            onGlobalShortcut: () => () => {},
        };
        useInteractionSettingsStore.getState().setGlobalShortcutBinding(0, { key: 'k', commandId: 'folium:gs-hook:ping' });
    });

    afterEach(() => {
        act(() => root?.unmount());
        host?.remove();
        root = null;
        host = null;
        delete (window as { electron?: unknown }).electron;
        useInteractionSettingsStore.getState().setGlobalShortcutBinding(0, { key: null, commandId: null });
        useInteractionSettingsStore.getState().setGlobalShortcutPortalEnabled(false);
    });

    it('take a mod command’s key while it is registered and let it go when the mod stops', async () => {
        await render();
        expect(lastSent()).toEqual([]);

        await act(async () => {
            commandsRegistry.register('gs-hook', { id: 'ping', label: { en: 'Ping' }, globalShortcut: true, run: () => {} });
        });
        expect(lastSent()).toEqual([toGlobalShortcutAccelerator('k')]);

        // A command that cannot be bound neither registers the keys again nor re-renders the host.
        const calls = setGlobalShortcuts.mock.calls.length;
        const rendersBefore = renders;
        await act(async () => {
            commandsRegistry.register('gs-hook', { id: 'plain', label: { en: 'Plain' }, run: () => {} });
        });
        expect(setGlobalShortcuts.mock.calls.length).toBe(calls);
        expect(renders).toBe(rendersBefore);

        await act(async () => {
            commandsRegistry.unregisterAll('gs-hook');
        });
        expect(lastSent()).toEqual([]);
    });

    it('on the portal are only the fixed playback table, never a mod command', async () => {
        backend = 'portal';
        useInteractionSettingsStore.getState().setGlobalShortcutPortalEnabled(true);
        await act(async () => {
            commandsRegistry.register('gs-hook', { id: 'ping', label: { en: 'Ping' }, globalShortcut: true, run: () => {} });
        });
        await render();
        expect(setGlobalShortcuts).toHaveBeenCalledTimes(1);
        expect(lastSent()).toEqual(PORTAL_GLOBAL_SHORTCUTS.map((shortcut) => shortcut.accelerator));
    });
});
