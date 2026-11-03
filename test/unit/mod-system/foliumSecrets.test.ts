// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time, and Node's own experimental storage shadows jsdom's here,
// so an in-memory Storage goes in before any import runs. The Electron bridge is a fake too: an
// in-memory `folia-mods:secrets` that records every call, and the `secret-changed` notice.
const bridge = vi.hoisted(() => {
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
    const state = {
        calls: [] as Array<[string, string, unknown?, unknown?]>,
        values: new Map<string, string>(),
        persistent: true,
        listeners: new Set<(change: { modId: string; key: string }) => void>(),
    };
    const emit = (modId: string, key: string) => state.listeners.forEach((listener) => listener({ modId, key }));
    (globalThis as { window?: unknown }).window ??= globalThis;
    (globalThis as unknown as { electron: unknown }).electron = {
        mods: {
            invokeModSecrets: async (modId: string, operation: string, key?: unknown, value?: unknown) => {
                state.calls.push([modId, operation, key, value]);
                const id = `${modId}/${String(key)}`;
                if (operation === 'declare') return { ok: true, result: (key as string[]).length };
                if (operation === 'state') {
                    const stored = Array.from(state.values.keys())
                        .filter((entry) => entry.startsWith(`${modId}/`))
                        .map((entry) => entry.slice(modId.length + 1));
                    return { ok: true, result: { persistent: state.persistent, stored } };
                }
                if (operation === 'get') return { ok: true, result: state.values.get(id) ?? null };
                if (operation === 'has') return { ok: true, result: state.values.has(id) };
                if (operation === 'set') {
                    if (typeof value === 'string' && value.length > 20) return { ok: false, error: 'secret-too-large:20' };
                    if (value === null) state.values.delete(id);
                    else state.values.set(id, value as string);
                    emit(modId, key as string);
                    return { ok: true, result: null };
                }
                return { ok: false, error: `secrets-unknown-operation:${operation}` };
            },
            onModSecretChanged: (callback: (change: { modId: string; key: string }) => void) => {
                state.listeners.add(callback);
                return () => state.listeners.delete(callback);
            },
        },
    };
    return { state, emit };
});

vi.mock('react-i18next', async (importOriginal) => ({
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FoliumSetting } from '@/mods/folium/contract';
import type { ModRuntimeInfo } from '@/mods/types';
import { createFoliumClientApi } from '@/mods/folium/api';
import { settingsSectionsRegistry } from '@/mods/folium/registries/settingsSections';
import { coerceFoliumParamValue, filterFoliumParamPatch, mergeFoliumParamValues, sanitizeFoliumParams } from '@/mods/params/params';
import {
    createFoliumParamAccess,
    hydrateFoliumParamsForExport,
    importFoliumParams,
    snapshotFoliumParams,
    useFoliumParamStore,
} from '@/mods/params/paramStore';
import { FoliumParamFields, type FoliumParamFieldToken } from '@/mods/params/FoliumParamFields';
import { FoliumSecretField, useFoliumSecretsState } from '@/mods/params/FoliumSecretField';
import { clearFoliumIssues, getFoliumIssues } from '@/mods/runtime/status';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumSecrets.test.ts
// Folium 1.7 `secret` settings fields on the window side: allowed in settings sections only (elsewhere
// dropped like an unknown type), never a value in the param store (so never in settings.get(), the
// config export, an import or the export window), `folium.secrets` reaching only the mod's own store
// in the main window and unavailable in the export window, change notices that carry only the key, and
// the form row that never shows or even fetches a saved value.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const apiKey: FoliumSetting = { key: 'apiKey', type: 'secret', label: { en: 'API key' } };
const size: FoliumSetting = { key: 'size', type: 'number', label: {}, min: 0, max: 10, defaultValue: 4 };

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
    clientUrl: null,
});

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
    bridge.state.calls.length = 0;
    bridge.state.values.clear();
    bridge.state.persistent = true;
});

describe('secret fields in a schema', () => {
    afterEach(() => clearFoliumIssues('secret-params'));

    it('are dropped outside settings sections, with the reason on the mod\'s row', () => {
        expect(sanitizeFoliumParams([apiKey, size], 'secret-params').map((param) => param.key)).toEqual(['size']);
        expect(getFoliumIssues('secret-params').map(({ where, message }) => [where, message])).toEqual([
            ['settings apiKey', 'a secret field is only allowed in settings sections'],
        ]);
    });

    it('are kept where allowed, without a default, and never have a value', () => {
        const schema = sanitizeFoliumParams([{ ...apiKey, defaultValue: 'sk-in-source', placeholder: 'sk-…' }, size], undefined, { allowSecret: true });
        expect(schema[0]).toMatchObject({ key: 'apiKey', type: 'secret', defaultValue: undefined, placeholder: 'sk-…' });
        expect(mergeFoliumParamValues(schema, { apiKey: 'stored', size: 2 })).toEqual({ size: 2 });
        expect(filterFoliumParamPatch(schema, { apiKey: 'typed', size: 3 })).toEqual({ size: 3 });
        expect(coerceFoliumParamValue(schema[0], 'typed')).toBeUndefined();
    });
});

describe('the param store and secret keys', () => {
    beforeEach(() => useFoliumParamStore.setState({ byScope: {} }));

    it('drops a value saved under a key that became secret, and keeps it out of reads, writes and the snapshot', () => {
        useFoliumParamStore.setState({ byScope: { 'settings:m:prefs': { apiKey: 'sk-was-text', size: 2 } } });
        const access = createFoliumParamAccess('settings:m:prefs', sanitizeFoliumParams([apiKey, size], undefined, { allowSecret: true }));
        expect(access.schema.map((param) => param.key)).toEqual(['apiKey', 'size']);
        expect(access.get()).toEqual({ size: 2 });
        expect(snapshotFoliumParams()).toEqual({ 'settings:m:prefs': { size: 2 } });

        access.set({ apiKey: 'sk-typed', size: 5 });
        useFoliumParamStore.getState().setValues('settings:m:prefs', { apiKey: 'sk-direct' });
        expect(snapshotFoliumParams()).toEqual({ 'settings:m:prefs': { size: 5 } });
    });

    it('ignores the key in an imported visual config and in the export window\'s copy', () => {
        createFoliumParamAccess('settings:m2:prefs', sanitizeFoliumParams([apiKey, size], undefined, { allowSecret: true }));
        importFoliumParams({ 'settings:m2:prefs': { apiKey: 'sk-from-a-shared-config', size: 1 }, other: { apiKey: 'kept' } });
        expect(snapshotFoliumParams()).toEqual({ 'settings:m2:prefs': { size: 1 }, other: { apiKey: 'kept' } });
        hydrateFoliumParamsForExport({ 'settings:m2:prefs': { apiKey: 'sk-export', size: 3 } });
        expect(JSON.stringify(useFoliumParamStore.getState().byScope)).not.toContain('sk-export');
    });
});

describe('folium.secrets', () => {
    afterEach(() => {
        settingsSectionsRegistry.unregisterAll('secret-client');
        settingsSectionsRegistry.unregisterAll('secret-other');
        settingsSectionsRegistry.unregisterAll('secret-export');
    });

    it('declares a section\'s secret keys in the main window and reads and writes only this mod\'s values', async () => {
        const releases: Array<() => void> = [];
        const folium = createFoliumClientApi(mod('secret-client'), clientApiOptions('main', { onRelease: (release) => releases.push(release) }));
        const handle = folium.registries.settingsSections.register({ id: 'prefs', label: { en: 'Prefs' }, settings: [apiKey] });
        expect(handle.settings.get()).toEqual({});

        await folium.secrets.set('apiKey', 'sk-1');
        expect(await folium.secrets.get('apiKey')).toBe('sk-1');
        expect(await folium.secrets.has('apiKey')).toBe(true);
        expect(bridge.state.calls.map(([modId, operation, key]) => [modId, operation, key])).toEqual([
            ['secret-client', 'declare', ['apiKey']],
            ['secret-client', 'set', 'apiKey'],
            ['secret-client', 'get', 'apiKey'],
            ['secret-client', 'has', 'apiKey'],
        ]);
        releases.forEach((release) => release());
    });

    it('sends the declaration inside register, before anything the client sends next', () => {
        const folium = createFoliumClientApi(mod('secret-client'), clientApiOptions('main'));
        folium.registries.settingsSections.register({ id: 'prefs', label: { en: 'Prefs' }, settings: [apiKey] });
        // No await in between: a folium.rpc.call made right here goes out after the keys.
        expect(bridge.state.calls).toEqual([['secret-client', 'declare', ['apiKey'], undefined]]);
    });

    it('rejects with the main process\'s reason', async () => {
        const folium = createFoliumClientApi(mod('secret-client'), clientApiOptions('main'));
        await expect(folium.secrets.set('apiKey', 'x'.repeat(21))).rejects.toThrow('secret-too-large:20');
    });

    it('tells a listener the key, never the value, only for its own mod, until the activation ends', async () => {
        const releases: Array<() => void> = [];
        const folium = createFoliumClientApi(mod('secret-client'), clientApiOptions('main', { onRelease: (release) => releases.push(release) }));
        const heard = vi.fn();
        const failing = vi.fn(() => { throw new Error('listener boom'); });
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        folium.secrets.subscribe(failing);
        const off = folium.secrets.subscribe(heard);

        await folium.secrets.set('apiKey', 'sk-quiet');
        expect(heard).toHaveBeenCalledWith('apiKey');
        expect(JSON.stringify(heard.mock.calls)).not.toContain('sk-quiet');
        bridge.emit('secret-other', 'apiKey');
        expect(heard).toHaveBeenCalledTimes(1);

        off();
        bridge.emit('secret-client', 'apiKey');
        expect(heard).toHaveBeenCalledTimes(1);
        expect(failing).toHaveBeenCalledTimes(2);
        releases.forEach((release) => release());
        bridge.emit('secret-client', 'apiKey');
        expect(failing).toHaveBeenCalledTimes(2);
    });

    it('is unavailable in the export window, which declares nothing', async () => {
        const folium = createFoliumClientApi(mod('secret-export'), clientApiOptions('export'));
        folium.registries.settingsSections.register({ id: 'prefs', label: { en: 'Prefs' }, settings: [apiKey, size] });
        await expect(folium.secrets.get('apiKey')).rejects.toThrow('secrets-unavailable-in-export-context');
        await expect(folium.secrets.has('apiKey')).rejects.toThrow('secrets-unavailable-in-export-context');
        await expect(folium.secrets.set('apiKey', 'x')).rejects.toThrow('secrets-unavailable-in-export-context');
        const heard = vi.fn();
        folium.secrets.subscribe(heard)();
        bridge.emit('secret-export', 'apiKey');
        expect(heard).not.toHaveBeenCalled();
        expect(bridge.state.calls).toEqual([]);
    });
});

const TOKEN: FoliumParamFieldToken = {
    label: 'field-label',
    readonlyLabel: 'field-readonly',
    input: 'field-input',
    toggleOn: '',
    toggleOff: '',
    dotOn: '',
    dotOff: '',
};

/* The settings card's form: FoliumParamFields drawing a secret row the way FoliumSettingsCard does. */
const Form: React.FC<{ modId: string; params: FoliumSetting[] }> = ({ modId, params }) => {
    const state = useFoliumSecretsState(modId, true);
    return React.createElement(FoliumParamFields, {
        params,
        values: { size: 4 },
        token: TOKEN,
        onChange: () => {},
        renderSecretField: (param: FoliumSetting) => React.createElement(FoliumSecretField, { modId, param, state, token: TOKEN }),
    });
};

describe('the secret row of a settings form', () => {
    let root: Root | null = null;
    let host: HTMLDivElement;

    const render = async (params: FoliumSetting[] = [apiKey, size]) => {
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root!.render(React.createElement(Form, { modId: 'secret-form', params })));
        await flush();
    };
    const input = () => host.querySelector<HTMLInputElement>('input[type="password"]')!;
    const button = (label: string) => Array.from(host.querySelectorAll('button')).find((element) => element.textContent === label);
    const status = () => host.querySelector('[data-folium-secret-status]')?.textContent;
    const type = (value: string) => act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input(), value);
        input().dispatchEvent(new Event('input', { bubbles: true }));
    });

    afterEach(() => {
        act(() => root?.unmount());
        root = null;
        document.body.replaceChildren();
    });

    it('shows whether a value is set, never the value, and never asks for it', async () => {
        bridge.state.values.set('secret-form/apiKey', 'sk-saved');
        await render();
        expect(status()).toBe('options.modSecretSet');
        expect(input().value).toBe('');
        expect(host.innerHTML).not.toContain('sk-saved');
        expect(bridge.state.calls.map(([, operation]) => operation)).not.toContain('get');
        expect(button('options.modSecretClear')).toBeDefined();
        // The number field next to it still draws as before.
        expect(host.querySelector('input[type="range"]')).not.toBeNull();
    });

    it('saves what the user typed (trimmed), empties the input, and clears on request', async () => {
        await render();
        expect(status()).toBe('options.modSecretUnset');
        expect(button('options.modSecretClear')).toBeUndefined();
        expect(button('options.modSecretSave')!.disabled).toBe(true);

        await type('  sk-typed  ');
        act(() => button('options.modSecretSave')!.click());
        await flush();
        expect(bridge.state.calls).toContainEqual(['secret-form', 'set', 'apiKey', 'sk-typed']);
        expect(input().value).toBe('');
        expect(status()).toBe('options.modSecretSet');

        act(() => button('options.modSecretClear')!.click());
        await flush();
        expect(bridge.state.calls).toContainEqual(['secret-form', 'set', 'apiKey', null]);
        expect(status()).toBe('options.modSecretUnset');
    });

    it('says when values last for this run only', async () => {
        bridge.state.persistent = false;
        await render();
        expect(host.textContent).toContain('options.modSecretSessionOnly');
    });

    it('follows a change made by the mod itself', async () => {
        await render();
        expect(status()).toBe('options.modSecretUnset');
        bridge.state.values.set('secret-form/apiKey', 'sk-from-mod');
        act(() => bridge.emit('secret-form', 'apiKey'));
        await flush();
        expect(status()).toBe('options.modSecretSet');
    });
});
