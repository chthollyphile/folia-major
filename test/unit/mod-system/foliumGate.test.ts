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
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue, type MotionValue } from 'framer-motion';
import type { FoliumMount, FoliumProgressContext } from '@/mods/folium/contract';
import type { ModRuntimeInfo } from '@/mods/types';
import { FoliumMountHost } from '@/mods/runtime/FoliumMountHost';
import { useFoliumProgressContext } from '@/mods/folium/registries/progress';
import { reconcileFoliumClients } from '@/mods/runtime/clientLoader';
// The loader imports the client API (every registry and the host surfaces behind them) on first
// use. Loading it here keeps that out of the test's own time.
import '@/mods/folium/api';
import { useFoliumParamStore } from '@/mods/params/paramStore';
import { useFoliumStatusStore } from '@/mods/runtime/status';

// test/unit/mod-system/foliumGate.test.ts
// What a mod subscribes through an object the host built for it: a listener
// that throws is caught and named, it never stops the listeners after it, and
// everything a mount or a client left subscribed is gone when that mount or
// that client is. The contexts here are the real progress-bar context and the
// real settings store, so the listeners sit in the host's own notify loops.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface TestEntry {
    modId: string;
    mount: FoliumMount<FoliumProgressContext>;
}

const COLORS = { fill: '#111', track: '#222', text: '#333' };

/* One host progress bar: one context, shared by every entry mounted on it. */
const Bar: React.FC<{ time: MotionValue<number>; duration: number; entries: TestEntry[] }> = ({ time, duration, entries }) => {
    const ctx = useFoliumProgressContext({ currentTime: time, duration, onSeek: () => {}, colors: COLORS });
    return React.createElement(React.Fragment, null, entries.map((entry) => React.createElement(FoliumMountHost<FoliumProgressContext>, {
        key: entry.modId,
        modId: entry.modId,
        where: `progress button ${entry.modId}:button`,
        entryKind: 'progress-button',
        entryId: `${entry.modId}:button`,
        mount: entry.mount,
        ctx,
        shadow: true,
        fill: false,
    })));
};

let root: Root | null = null;

const renderBar = (time: MotionValue<number>, duration: number, entries: TestEntry[]) => {
    if (!root) {
        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    }
    act(() => root!.render(React.createElement(Bar, { time, duration, entries })));
};

const issuesOf = (modId: string) => useFoliumStatusStore.getState().issues[modId] ?? [];

afterEach(async () => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
    await reconcileFoliumClients([], 'main');
    useFoliumStatusStore.setState({ issues: {} });
    vi.restoreAllMocks();
});

describe('listeners a mount gives to its context', () => {
    it('reports a throwing clock listener under its mod and still runs the listener after it', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const time = motionValue(0);
        renderBar(time, 100, [{
            modId: 'gate-clock',
            mount: (_container, ctx) => {
                ctx.onPlaybackTime(() => { throw new Error('clock boom'); });
            },
        }]);
        const hostSaw: number[] = [];
        time.on('change', (seconds) => { hostSaw.push(seconds); });

        expect(() => time.set(1)).not.toThrow();
        expect(hostSaw).toEqual([1]);
        expect(issuesOf('gate-clock')).toHaveLength(1);
        expect(issuesOf('gate-clock')[0]).toMatchObject({
            where: 'progress button gate-clock:button onPlaybackTime',
            message: 'clock boom',
        });

        // The same failure on later ticks is counted, not listed again.
        time.set(2);
        time.set(3);
        expect(hostSaw).toEqual([1, 2, 3]);
        expect(issuesOf('gate-clock')).toHaveLength(1);
    });

    it('reports a throwing onChange listener under its mod and still runs the listener after it', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const time = motionValue(0);
        const after = vi.fn();
        const entries: TestEntry[] = [
            { modId: 'gate-sub', mount: (_container, ctx) => { ctx.onChange(() => { throw new Error('onChange boom'); }); } },
            { modId: 'gate-next', mount: (_container, ctx) => { ctx.onChange(after); } },
        ];
        renderBar(time, 100, entries);

        // A new duration is what the progress context announces.
        expect(() => renderBar(time, 200, entries)).not.toThrow();
        expect(after).toHaveBeenCalledTimes(1);
        expect(issuesOf('gate-sub')[0]).toMatchObject({
            where: 'progress button gate-sub:button onChange',
            message: 'onChange boom',
        });
        expect(issuesOf('gate-next')).toHaveLength(0);
    });

    it('calls a listener subscribed twice once per change, and one unsubscribe removes it', () => {
        const time = motionValue(0);
        const onTime = vi.fn();
        const onChange = vi.fn();
        let offTime: () => void = () => {};
        let offChange: () => void = () => {};
        const entries: TestEntry[] = [{
            modId: 'gate-twice',
            mount: (_container, ctx) => {
                ctx.onPlaybackTime(onTime);
                offTime = ctx.onPlaybackTime(onTime);
                ctx.onChange(onChange);
                offChange = ctx.onChange(onChange);
            },
        }];
        renderBar(time, 100, entries);

        time.set(1);
        renderBar(time, 200, entries);
        expect(onTime).toHaveBeenCalledTimes(1);
        expect(onTime.mock.calls[0][0]).toBe(1);
        expect(onChange).toHaveBeenCalledTimes(1);

        offTime();
        offChange();
        time.set(2);
        renderBar(time, 300, entries);
        expect(onTime).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('leaves no listener of a mount behind when the mod never unsubscribed', () => {
        const time = motionValue(0);
        const onTime = vi.fn();
        const onChange = vi.fn();
        const stays = vi.fn();
        const leaky: TestEntry = {
            modId: 'gate-leak',
            mount: (_container, ctx) => {
                ctx.onPlaybackTime(onTime);
                ctx.onChange(onChange);
            },
        };
        const other: TestEntry = { modId: 'gate-stays', mount: (_container, ctx) => { ctx.onChange(stays); } };
        renderBar(time, 100, [leaky, other]);
        time.set(1);
        renderBar(time, 200, [leaky, other]);
        expect(onTime).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(stays).toHaveBeenCalledTimes(1);

        // The bar and its context stay; only the leaky entry goes.
        renderBar(time, 200, [other]);
        time.set(2);
        renderBar(time, 300, [other]);
        expect(onTime).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(stays).toHaveBeenCalledTimes(2);
    });

    it('still has the listeners while the mod\'s own disposer runs', () => {
        const time = motionValue(0);
        const seenInDispose: number[] = [];
        const entry: TestEntry = {
            modId: 'gate-order',
            mount: (_container, ctx) => {
                ctx.onPlaybackTime((seconds) => { seenInDispose.push(seconds); });
                return () => { time.set(5); };
            },
        };
        renderBar(time, 100, [entry]);
        renderBar(time, 100, []);
        expect(seenInDispose).toEqual([5]);
        time.set(6);
        expect(seenInDispose).toEqual([5]);
    });
});

const mod = (id: string, clientUrl: string): ModRuntimeInfo => ({
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
    clientUrl,
});

interface ParamsProbe {
    calls: number;
    set: (patch: Record<string, unknown>) => void;
}

/* A client entry that subscribes a throwing listener to its settings values and never unsubscribes. */
const PARAMS_CLIENT = `
export default function activate(folium) {
    const section = folium.registries.settingsSections.register({
        id: 'prefs',
        label: { en: 'Prefs' },
        settings: [{ key: 'size', type: 'number', label: {}, min: 0, max: 10, defaultValue: 4 }],
    });
    const probe = { calls: 0, set: (patch) => section.settings.set(patch) };
    section.settings.onChange(() => {
        probe.calls += 1;
        throw new Error('settings boom');
    });
    globalThis.__foliumGateParams = probe;
}
`;

describe('listeners a client gives to its settings values', () => {
    it('catches a throwing listener, and none is left after the client is torn down', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const url = `data:text/javascript,${encodeURIComponent(PARAMS_CLIENT)}`;
        await reconcileFoliumClients([mod('gate-params', url)], 'main');
        expect(issuesOf('gate-params')).toHaveLength(0);
        const probe = (globalThis as { __foliumGateParams?: ParamsProbe }).__foliumGateParams!;
        const hostSaw = vi.fn();
        const offHost = useFoliumParamStore.subscribe(hostSaw);

        expect(() => probe.set({ size: 7 })).not.toThrow();
        expect(probe.calls).toBe(1);
        expect(hostSaw).toHaveBeenCalledTimes(1);
        expect(issuesOf('gate-params')[0]).toMatchObject({
            where: 'settings section gate-params:prefs settings.onChange',
            message: 'settings boom',
        });

        await reconcileFoliumClients([], 'main');
        useFoliumParamStore.getState().setValues('settings:gate-params:prefs', { size: 2 });
        expect(probe.calls).toBe(1);
        expect(hostSaw).toHaveBeenCalledTimes(2);
        offHost();
    });
});
