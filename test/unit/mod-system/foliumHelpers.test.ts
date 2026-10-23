// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time, and Node's own experimental storage
// shadows jsdom's here, so an in-memory Storage goes in before any import runs.
// The frame loop is the app's (framer-motion's): the test keeps the processes
// scheduled on it and runs a frame by hand.
const frames = vi.hoisted(() => {
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
    type Process = (data: { timestamp: number }) => void;
    const scheduled = new Set<Process>();
    return {
        scheduled,
        scheduleCalls: 0,
        schedule(process: Process) {
            this.scheduleCalls += 1;
            scheduled.add(process);
            return process;
        },
        cancel(process: Process) {
            scheduled.delete(process);
        },
        run(timestamp: number) {
            Array.from(scheduled).forEach((process) => process({ timestamp }));
        },
    };
});
vi.mock('framer-motion', async (importOriginal) => {
    const actual = await importOriginal<typeof import('framer-motion')>();
    return {
        ...actual,
        frame: { ...actual.frame, render: (process: (data: { timestamp: number }) => void) => frames.schedule(process) },
        cancelFrame: (process: (data: { timestamp: number }) => void) => frames.cancel(process),
    };
});
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue, type MotionValue } from 'framer-motion';
import type { FoliumClientApi, FoliumMount, FoliumProgressContext, FoliumSize } from '@/mods/folium/contract';
import type { ModRuntimeInfo } from '@/mods/types';
import { FoliumMountHost } from '@/mods/runtime/FoliumMountHost';
import { useFoliumProgressContext } from '@/mods/folium/registries/progress';
import { commandsRegistry } from '@/mods/folium/registries/commands';
import { hasFoliumEventHandlers } from '@/mods/folium/events';
import { reconcileFoliumClients } from '@/mods/runtime/clientLoader';
// The loader imports the client API on first use; loading it here keeps that out of the test's own time.
import { listFoliumHostRegistries } from '@/mods/folium/api';
import { FOLIUM_KIND_NAMES } from '@/mods/folium/kinds';

// test/unit/mod-system/foliumHelpers.test.ts
// The mount and client helpers. What the user cannot see by using the app: whatever
// a mod starts through a helper stops with the mount (or with the mod) when
// the mod kept nothing, a disposer that arrives late still runs, and a
// register call after the mod was stopped adds nothing. The context is the
// real progress-bar context; the timer is a fake clock, the frame loop and the
// size observer are stand-ins the test fires by hand.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* jsdom has no ResizeObserver: this one reports a size when the test says so. */
class FakeResizeObserver {
    static live = new Set<FakeResizeObserver>();
    constructor(private readonly callback: (entries: Array<{ contentRect: FoliumSize }>) => void) {}
    observe() { FakeResizeObserver.live.add(this); }
    disconnect() { FakeResizeObserver.live.delete(this); }
    static fire(width: number, height: number) {
        Array.from(FakeResizeObserver.live).forEach((observer) => observer.callback([{ contentRect: { width, height } }]));
    }
}

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

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(async () => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
    await reconcileFoliumClients([], 'main');
    FakeResizeObserver.live.clear();
    frames.scheduled.clear();
    frames.scheduleCalls = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('helpers on a mount context', () => {
    it('stops every helper at unmount when the mod kept nothing', () => {
        const time = motionValue(0);
        const calls = { change: 0, time: [] as number[], frame: [] as number[], size: [] as FoliumSize[], tick: 0, disposed: 0 };
        const entry: TestEntry = {
            modId: 'helpers-all',
            mount: (_container, ctx) => {
                ctx.onChange(() => { calls.change += 1; });
                ctx.onPlaybackTime((seconds) => { calls.time.push(seconds); });
                ctx.onFrame((timestamp) => { calls.frame.push(timestamp); });
                ctx.onResize((size) => { calls.size.push(size); });
                ctx.every(100, () => { calls.tick += 1; });
                ctx.onDispose(() => { calls.disposed += 1; });
            },
        };
        const fireAll = (seconds: number, duration: number, timestamp: number, width: number, entries: TestEntry[]) => {
            time.set(seconds);
            renderBar(time, duration, entries);
            frames.run(timestamp);
            FakeResizeObserver.fire(width, 20);
            vi.advanceTimersByTime(100);
        };
        renderBar(time, 100, [entry]);
        expect(calls).toEqual({ change: 0, time: [], frame: [], size: [], tick: 0, disposed: 0 });

        fireAll(1, 200, 16, 300, [entry]);
        expect(calls).toEqual({ change: 1, time: [1], frame: [16], size: [{ width: 300, height: 20 }], tick: 1, disposed: 0 });

        // The bar and its context stay; the entry goes, and its mount returned nothing.
        renderBar(time, 200, []);
        expect(calls.disposed).toBe(1);
        fireAll(2, 300, 32, 400, []);
        expect(calls).toEqual({ change: 1, time: [1], frame: [16], size: [{ width: 300, height: 20 }], tick: 1, disposed: 1 });
        expect(frames.scheduled.size).toBe(0);
        expect(FakeResizeObserver.live.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('puts every frame listener of every mod on one process of the app\'s frame loop, and none while there is no listener', () => {
        const time = motionValue(0);
        const seen: string[] = [];
        const entry = (modId: string): TestEntry => ({
            modId,
            mount: (_container, ctx) => { ctx.onFrame(() => { seen.push(modId); }); },
        });
        renderBar(time, 100, []);
        expect(frames.scheduleCalls).toBe(0);

        renderBar(time, 100, [entry('helpers-frame-a'), entry('helpers-frame-b')]);
        expect(frames.scheduleCalls).toBe(1);
        expect(frames.scheduled.size).toBe(1);
        frames.run(16);
        expect(seen).toEqual(['helpers-frame-a', 'helpers-frame-b']);

        renderBar(time, 100, [entry('helpers-frame-b')]);
        expect(frames.scheduled.size).toBe(1);
        renderBar(time, 100, []);
        expect(frames.scheduled.size).toBe(0);
    });

    it('takes a stop function called twice, and a throwing listener stops nothing else', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const time = motionValue(0);
        const kept = vi.fn();
        const stopped = vi.fn();
        renderBar(time, 100, [{
            modId: 'helpers-stop',
            mount: (_container, ctx) => {
                ctx.every(100, () => { throw new Error('tick boom'); });
                ctx.every(100, kept);
                const stop = ctx.every(100, stopped);
                const stopFrame = ctx.onFrame(stopped);
                const stopTime = ctx.onPlaybackTime(stopped);
                [stop, stop, stopFrame, stopFrame, stopTime, stopTime].forEach((off) => off());
            },
        }]);
        expect(() => vi.advanceTimersByTime(250)).not.toThrow();
        time.set(1);
        frames.run(16);
        expect(kept).toHaveBeenCalledTimes(2);
        expect(stopped).not.toHaveBeenCalled();
    });

    it('calls a frame listener once per frame when it stops itself and subscribes again inside the frame', () => {
        const time = motionValue(0);
        // A frame that calls such a listener again and again never ends: the cap ends it for the test.
        const CAP = 1000;
        const calls = { same: 0, fresh: 0 };
        renderBar(time, 100, [{
            modId: 'helpers-reentry',
            mount: (_container, ctx) => {
                // The same function, stopped and subscribed again.
                let stopSame = () => {};
                const same = () => {
                    calls.same += 1;
                    stopSame();
                    if (calls.same < CAP) stopSame = ctx.onFrame(same);
                };
                stopSame = ctx.onFrame(same);
                // The one-shot way a requestAnimationFrame loop is written: a new function every frame.
                const next = () => {
                    const stop = ctx.onFrame(() => {
                        calls.fresh += 1;
                        stop();
                        if (calls.fresh < CAP) next();
                    });
                };
                next();
            },
        }]);
        frames.run(16);
        expect(calls).toEqual({ same: 1, fresh: 1 });
        frames.run(32);
        expect(calls).toEqual({ same: 2, fresh: 2 });
        expect(frames.scheduled.size).toBe(1);
    });

    it('runs a frame with the listeners it began with: one stopped during it is skipped, one added starts with the next', () => {
        const time = motionValue(0);
        const seen: string[] = [];
        renderBar(time, 100, [{
            modId: 'helpers-frame-set',
            mount: (_container, ctx) => {
                let stopLater = () => {};
                let added = false;
                ctx.onFrame(() => {
                    seen.push('first');
                    stopLater();
                    if (!added) {
                        added = true;
                        ctx.onFrame(() => { seen.push('added'); });
                    }
                });
                stopLater = ctx.onFrame(() => { seen.push('later'); });
            },
        }]);
        frames.run(16);
        expect(seen).toEqual(['first']);
        frames.run(32);
        expect(seen).toEqual(['first', 'first', 'added']);
    });

    it('raises a timer faster than a frame to 16 ms', () => {
        const time = motionValue(0);
        const tick = vi.fn();
        renderBar(time, 100, [{ modId: 'helpers-fast', mount: (_container, ctx) => { ctx.every(0, tick); } }]);
        vi.advanceTimersByTime(48);
        expect(tick).toHaveBeenCalledTimes(3);
    });

    it('keeps a timer longer than a timer can be from firing at once', () => {
        const time = motionValue(0);
        const tick = vi.fn();
        // Above 2147483647 ms a browser timer wraps around and fires as fast as it can.
        renderBar(time, 100, [{ modId: 'helpers-long', mount: (_container, ctx) => { ctx.every(3_000_000_000, tick); } }]);
        vi.advanceTimersByTime(60_000);
        expect(tick).not.toHaveBeenCalled();
    });

    it('stops what a mount started when the mount throws or its promise rejects', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const time = motionValue(0);
        const ran = vi.fn();
        const disposed: string[] = [];
        const start = (name: string, ctx: FoliumProgressContext) => {
            ctx.every(100, ran);
            ctx.onFrame(ran);
            ctx.onPlaybackTime(ran);
            ctx.onDispose(() => { disposed.push(name); });
        };
        renderBar(time, 100, [
            { modId: 'helpers-mount-throws', mount: (_container, ctx) => { start('throws', ctx); throw new Error('mount boom'); } },
            { modId: 'helpers-mount-rejects', mount: async (_container, ctx) => { start('rejects', ctx); throw new Error('mount boom'); } },
        ]);
        // The rejection is reported and acted on in the turns after the mount returned.
        await act(async () => {});
        expect(disposed).toEqual(['throws', 'rejects']);
        time.set(1);
        frames.run(16);
        vi.advanceTimersByTime(300);
        expect(ran).not.toHaveBeenCalled();
        expect(frames.scheduled.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        // The entries stay on the bar until they are removed; removing them runs nothing twice.
        renderBar(time, 100, []);
        expect(disposed).toEqual(['throws', 'rejects']);
    });

    it('runs the returned disposer first, then the onDispose functions newest first', () => {
        const time = motionValue(0);
        const order: string[] = [];
        renderBar(time, 100, [{
            modId: 'helpers-order',
            mount: (_container, ctx) => {
                ctx.onDispose(() => { order.push('first'); });
                ctx.onDispose(() => { order.push('second'); });
                return () => { order.push('returned'); };
            },
        }]);
        renderBar(time, 100, []);
        expect(order).toEqual(['returned', 'second', 'first']);
    });

    it('refuses a helper called after the mount ended, and runs a late onDispose at once', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const time = motionValue(0);
        let kept: FoliumProgressContext | null = null;
        renderBar(time, 100, [{ modId: 'helpers-late', mount: (_container, ctx) => { kept = ctx; } }]);
        renderBar(time, 100, []);
        const ctx = kept!;
        const late = vi.fn();
        const stops = [ctx.every(100, late), ctx.onFrame(late), ctx.onPlaybackTime(late), ctx.onChange(late), ctx.onResize(late)];
        stops.forEach((stop) => expect(() => stop()).not.toThrow());
        time.set(1);
        renderBar(time, 200, []);
        frames.run(16);
        FakeResizeObserver.fire(1, 1);
        vi.advanceTimersByTime(100);
        expect(late).not.toHaveBeenCalled();
        expect(frames.scheduled.size).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(warn).toHaveBeenCalledWith('[Folium:helpers-late] progress button helpers-late:button every: called after it ended, ignored');

        const disposer = vi.fn();
        ctx.onDispose(disposer);
        expect(disposer).toHaveBeenCalledTimes(1);
    });
});

describe('a mount that returns a promise of its disposer', () => {
    it('runs the disposer at unmount when it arrived before', async () => {
        const time = motionValue(0);
        const dispose = vi.fn();
        renderBar(time, 100, [{ modId: 'helpers-async', mount: async () => dispose }]);
        await Promise.resolve();
        await Promise.resolve();
        expect(dispose).not.toHaveBeenCalled();
        renderBar(time, 100, []);
        expect(dispose).toHaveBeenCalledTimes(1);
    });

    it('runs the disposer at once when it arrives after the mount is gone', async () => {
        const time = motionValue(0);
        const dispose = vi.fn();
        let arrive: (disposer: () => void) => void = () => {};
        renderBar(time, 100, [{
            modId: 'helpers-async-late',
            mount: () => new Promise<() => void>((resolve) => { arrive = resolve; }),
        }]);
        renderBar(time, 100, []);
        expect(dispose).not.toHaveBeenCalled();
        arrive(dispose);
        await Promise.resolve();
        await Promise.resolve();
        expect(dispose).toHaveBeenCalledTimes(1);
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

interface ClientProbe {
    ticks: number;
    order: string[];
}

/* A client entry that starts a timer and hands over two disposers. */
const TIMER_CLIENT = `data:text/javascript,${encodeURIComponent(`
export default function activate(folium) {
    const probe = { ticks: 0, order: [] };
    globalThis.__foliumHelpersTimer = probe;
    folium.every(1000, () => { probe.ticks += 1; });
    folium.onDispose(() => { probe.order.push('first'); });
    folium.onDispose(() => { probe.order.push('second'); });
    return () => { probe.order.push('returned'); };
}
`)}`;

/* A client entry that only keeps its `folium` object, as a mod that registers later does. */
const keeperUrl = (generation: number) => `data:text/javascript,${encodeURIComponent(`
// generation ${generation}
export default function activate(folium) {
    (globalThis.__foliumHelpersKept ??= []).push(folium);
}
`)}`;

const keptFolium = () => (globalThis as { __foliumHelpersKept?: FoliumClientApi[] }).__foliumHelpersKept!.at(-1)!;
const lateCommand = (id: string) => ({ id, label: { en: id }, run: () => {} });
const commandIds = () => commandsRegistry.list().map((entry) => entry.id);

describe('helpers on the folium object', () => {
    it('stops the timer and runs the disposers when the mod is torn down', async () => {
        await reconcileFoliumClients([mod('helpers-client', TIMER_CLIENT)], 'main');
        const probe = (globalThis as { __foliumHelpersTimer?: ClientProbe }).__foliumHelpersTimer!;
        vi.advanceTimersByTime(1000);
        expect(probe.ticks).toBe(1);
        expect(probe.order).toEqual([]);

        await reconcileFoliumClients([], 'main');
        expect(probe.order).toEqual(['returned', 'second', 'first']);
        vi.advanceTimersByTime(3000);
        expect(probe.ticks).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('refuses a register call and events.on after the teardown, for that activation only', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await reconcileFoliumClients([mod('helpers-closed', keeperUrl(1))], 'main');
        const old = keptFolium();
        // The code changed (a new URL): the old generation is torn down, a new one starts.
        await reconcileFoliumClients([mod('helpers-closed', keeperUrl(2))], 'main');
        const fresh = keptFolium();
        // Compared here, not by expect: printing a `folium` object reads members that throw by design.
        expect(fresh === old).toBe(false);

        const handle = old.registries.commands.register(lateCommand('late'));
        const off = old.events.on('playback.songChanged', () => {});
        expect(commandIds()).toEqual([]);
        expect(hasFoliumEventHandlers('playback.songChanged')).toBe(false);
        expect(warn).toHaveBeenCalledWith('[Folium:helpers-closed] registries.commands.register: this mod was stopped, the call is ignored');
        expect(warn).toHaveBeenCalledWith('[Folium:helpers-closed] events.on: this mod was stopped, the call is ignored');
        // What the refused calls gave back still has the shape the mod expects.
        expect(handle.id).toBe('helpers-closed:late');
        expect(() => handle.unregister()).not.toThrow();
        expect(() => off()).not.toThrow();

        // The generation that is running still registers.
        fresh.registries.commands.register(lateCommand('late'));
        fresh.events.on('playback.songChanged', () => {});
        expect(commandIds()).toEqual(['helpers-closed:late']);
        expect(hasFoliumEventHandlers('playback.songChanged')).toBe(true);
    });

    it('refuses the register call of every registry and of the experimental surfaces after the teardown', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const optedIn = (generation: number): ModRuntimeInfo => ({
            ...mod('helpers-closed-all', keeperUrl(generation)),
            permissions: ['stageLayers'],
            experimental: ['omni.providers', 'omni.hooks', 'ponder.targets'],
        });
        await reconcileFoliumClients([optedIn(3)], 'main');
        const old = keptFolium();
        await reconcileFoliumClients([optedIn(4)], 'main');
        expect(keptFolium() === old).toBe(false);

        type Register = { register: (def: { id: string }) => { id: string; unregister: () => void } };
        const refused: string[] = [];
        const names = Object.keys(old.registries);
        // One per row of the kinds table, in its order.
        expect(names).toEqual(FOLIUM_KIND_NAMES);
        names.forEach((name) => {
            const handle = (old.registries as unknown as Record<string, Register>)[name].register({ id: 'late' });
            expect(handle.id).toBe('helpers-closed-all:late');
            expect(() => handle.unregister()).not.toThrow();
            refused.push(`registries.${name}.register`);
        });
        const experimental = old.experimental as unknown as Record<string, Register & { on: (type: string, handler: () => void) => () => void }>;
        ['omni.providers', 'ponder.targets'].forEach((name) => {
            expect(experimental[name].register({ id: 'late' }).id).toBe('helpers-closed-all:late');
            refused.push(`experimental ${name}.register`);
        });
        expect(() => experimental['omni.hooks'].on('lyricsResolved', () => {})()).not.toThrow();
        refused.push('experimental omni.hooks.on');

        refused.forEach((what) => {
            expect(warn).toHaveBeenCalledWith(`[Folium:helpers-closed-all] ${what}: this mod was stopped, the call is ignored`);
        });
        // Nothing of the mod is in any registry, the experimental ones included, and no hook of it listens.
        const registries = listFoliumHostRegistries();
        // The kinds of the table, and the four experimental registries (including playback.backends).
        expect(registries).toHaveLength(FOLIUM_KIND_NAMES.length + 4);
        registries.forEach((registry) => {
            expect(registry.list().filter((entry) => entry.modId === 'helpers-closed-all')).toEqual([]);
        });
        expect(hasFoliumEventHandlers('omni.lyricsResolved')).toBe(false);
    });
});
