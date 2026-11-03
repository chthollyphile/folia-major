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
import type { ModRpcMessage, ModRuntimeInfo } from '@/mods/types';
import type { FoliumClientApi, FoliumContextKind } from '@/mods/folium/contract';
import { createFoliumClientApi } from '@/mods/folium/api';
import { hasFoliumRpcListeners } from '@/mods/folium/rpcMessages';
import { clearFoliumIssues, useFoliumStatusStore } from '@/mods/runtime/status';
import { clientApiOptions } from './clientApiOptions';

// test/unit/mod-system/foliumRpcOn.test.ts
// The client's `folium.rpc.on` (Folium 1.7), the window's end of a main entry's `api.rpc.send`:
// a message reaches only the listeners of the mod that sent it and of its name, each with its own
// copy; a listener that throws is reported against its mod and the rest still run; listeners go
// with their disposer and with their activation; the bridge is held only while someone listens;
// and outside the main window nothing is ever delivered.

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
    trustStale: false, signature: { status: 'unsigned', reason: null, keyId: null, keyLabel: null, signedAt: null }, devSource: false,
    experimental: [],
    embedOrigins: [],
    folia: null,
    hasMain: true,
    clientUrl: `folia-mod://${id}/client.mjs?v=1`,
});

const bridge = window as unknown as { electron?: { mods: Record<string, unknown> } };
// What the preload's onModRpcMessage was given, while subscribed.
let deliver: ((message: ModRpcMessage) => void) | null = null;
const subscribe = vi.fn((callback: (message: ModRpcMessage) => void) => {
    deliver = callback;
    return () => {
        if (deliver === callback) deliver = null;
    };
});
const push = (modId: string, name: string, payload: unknown) => {
    deliver?.({ modId, name, json: JSON.stringify(payload) });
};

// Each activation's releases, as the loader keeps them; `end` is its teardown.
const activations: Array<{ end: () => void }> = [];
const activate = (modId: string, context: FoliumContextKind = 'main', stopped = () => false): FoliumClientApi => {
    const releases: Array<() => void> = [];
    activations.push({ end: () => releases.splice(0).forEach((release) => release()) });
    return createFoliumClientApi(mod(modId), clientApiOptions(context, {
        onRelease: (release) => releases.push(release),
        stopped,
    }));
};

beforeEach(() => {
    bridge.electron = { mods: { onModRpcMessage: subscribe } };
    subscribe.mockClear();
});

afterEach(() => {
    activations.splice(0).forEach((activation) => activation.end());
    ['mod-a', 'mod-b'].forEach(clearFoliumIssues);
    delete bridge.electron;
    deliver = null;
    vi.restoreAllMocks();
});

describe('folium.rpc.on', () => {
    it('hands a message only to the listeners of the mod that sent it, and of its name', () => {
        const a = activate('mod-a');
        const b = activate('mod-b');
        const heardA = vi.fn();
        const heardOtherName = vi.fn();
        const heardB = vi.fn();
        a.rpc.on('hotkey', heardA);
        a.rpc.on('status', heardOtherName);
        b.rpc.on('hotkey', heardB);

        push('mod-a', 'hotkey', { key: 'F9' });
        expect(heardA).toHaveBeenCalledWith({ key: 'F9' });
        expect(heardOtherName).not.toHaveBeenCalled();
        expect(heardB).not.toHaveBeenCalled();

        push('mod-b', 'hotkey', null);
        expect(heardB).toHaveBeenCalledWith(null);
        expect(heardA).toHaveBeenCalledTimes(1);
    });

    it('gives each of several listeners of one name its own copy of the payload', () => {
        const api = activate('mod-a');
        const seen: unknown[] = [];
        api.rpc.on('state', (payload) => {
            (payload as { items: number[] }).items.push(99);
            seen.push(payload);
        });
        api.rpc.on('state', (payload) => { seen.push(payload); });
        // The same function twice is two listeners, as with events.on.
        const twice = vi.fn();
        api.rpc.on('state', twice);
        api.rpc.on('state', twice);

        push('mod-a', 'state', { items: [1] });
        expect(seen).toEqual([{ items: [1, 99] }, { items: [1] }]);
        expect(twice).toHaveBeenCalledTimes(2);
    });

    it('reports a listener that throws against its mod, and still runs the others', () => {
        const api = activate('mod-a');
        const after = vi.fn();
        api.rpc.on('tick', () => { throw new Error('listener boom'); });
        api.rpc.on('tick', after);

        push('mod-a', 'tick', 1);
        expect(after).toHaveBeenCalledWith(1);
        expect(useFoliumStatusStore.getState().issues['mod-a']?.[0]).toMatchObject({ where: 'rpc.on tick', message: 'listener boom' });
    });

    it('removes a listener with its disposer, and holds the bridge only while someone listens', () => {
        const api = activate('mod-a');
        const first = vi.fn();
        const second = vi.fn();
        const offFirst = api.rpc.on('tick', first);
        const offSecond = api.rpc.on('tick', second);
        expect(subscribe).toHaveBeenCalledTimes(1);

        offFirst();
        offFirst();
        push('mod-a', 'tick', 1);
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);

        offSecond();
        expect(hasFoliumRpcListeners('mod-a')).toBe(false);
        expect(deliver).toBeNull();

        // A new listener subscribes again.
        api.rpc.on('tick', first);
        push('mod-a', 'tick', 2);
        expect(first).toHaveBeenCalledWith(2);
        expect(subscribe).toHaveBeenCalledTimes(2);
    });

    it('skips a listener that an earlier one removed during the same message', () => {
        const api = activate('mod-a');
        const later = vi.fn();
        let offLater = () => {};
        api.rpc.on('tick', () => offLater());
        offLater = api.rpc.on('tick', later);

        push('mod-a', 'tick', 1);
        expect(later).not.toHaveBeenCalled();
    });

    it('drops every listener of an activation at its teardown, and refuses one added after it', () => {
        const stopped = { value: false };
        const old = activate('mod-a', 'main', () => stopped.value);
        const heardOld = vi.fn();
        old.rpc.on('tick', heardOld);
        old.rpc.on('other', heardOld);

        // The loader marks the activation stopped, then runs its releases.
        stopped.value = true;
        activations[0].end();
        expect(hasFoliumRpcListeners('mod-a')).toBe(false);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        old.rpc.on('tick', heardOld)();
        expect(hasFoliumRpcListeners('mod-a')).toBe(false);

        // The next activation of the same mod hears its messages; the old one does not.
        const next = activate('mod-a');
        const heardNext = vi.fn();
        next.rpc.on('tick', heardNext);
        push('mod-a', 'tick', 1);
        expect(heardNext).toHaveBeenCalledWith(1);
        expect(heardOld).not.toHaveBeenCalled();
    });

    it('checks its arguments', () => {
        const api = activate('mod-a');
        expect(() => api.rpc.on('bad name', () => {})).toThrow('rpc.on requires a name');
        expect(() => api.rpc.on('', () => {})).toThrow('rpc.on requires a name');
        expect(() => api.rpc.on('ok', 'nope' as unknown as () => void)).toThrow('listener function');
        expect(subscribe).not.toHaveBeenCalled();
    });

    it('accepts a listener in the export window and never calls it', () => {
        const api = activate('mod-a', 'export');
        const heard = vi.fn();
        const off = api.rpc.on('tick', heard);
        expect(typeof off).toBe('function');
        off();
        expect(subscribe).not.toHaveBeenCalled();
        expect(hasFoliumRpcListeners('mod-a')).toBe(false);
        // Even a message for this mod, delivered by a main-window listener of another activation.
        const main = activate('mod-a');
        main.rpc.on('other', () => {});
        api.rpc.on('tick', heard);
        push('mod-a', 'tick', 1);
        expect(heard).not.toHaveBeenCalled();
        expect(() => api.rpc.on('bad name', heard)).toThrow('rpc.on requires a name');
    });

    it('ignores a malformed message from the bridge', () => {
        const api = activate('mod-a');
        const heard = vi.fn();
        api.rpc.on('tick', heard);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        deliver?.(null as unknown as ModRpcMessage);
        deliver?.({ modId: 'mod-a', name: 'tick' } as unknown as ModRpcMessage);
        deliver?.({ modId: 'mod-a', name: 'tick', json: '{not json' });
        expect(heard).not.toHaveBeenCalled();
    });
});
