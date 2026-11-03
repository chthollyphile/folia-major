// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    callFoliumMod,
    createFoliumMountView,
    gateFoliumCallback,
    getFoliumCallStats,
    timeFoliumMod,
} from '@/mods/runtime/guard';
import { getFoliumIssues } from '@/mods/runtime/status';

// test/unit/mod-system/foliumGuard.test.ts
// The gate's own rules, which using the app does not show: what it counts per
// mod, which failures it reports and which it leaves to the caller, and what a
// view refuses. Each test uses a mod id of its own, because the counters and
// the record of failures live for the whole window.

const issuesOf = (modId: string) => getFoliumIssues(modId);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('one call into a mod', () => {
    it('counts calls and failures, and reports a throw and a rejected promise', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        expect(getFoliumCallStats('guard-a')).toBeNull();

        expect(callFoliumMod('guard-a', 'first', () => 7)).toBe(7);
        expect(callFoliumMod('guard-a', 'second', () => { throw new Error('thrown'); })).toBeUndefined();
        const pending = callFoliumMod('guard-a', 'third', () => Promise.reject(new Error('rejected')));
        await expect(pending).rejects.toThrow('rejected');

        expect(getFoliumCallStats('guard-a')).toMatchObject({ calls: 3, failures: 2 });
        expect(issuesOf('guard-a')).toMatchObject([
            { where: 'second', message: 'thrown' },
            { where: 'third', message: 'rejected' },
        ]);
    });

    it('leaves the failure to the caller in timing mode, and still counts it', async () => {
        const thrown = new Error('for the caller');
        expect(() => timeFoliumMod('guard-b', 'command guard-b:run', () => { throw thrown; })).toThrow(thrown);
        await expect(timeFoliumMod('guard-b', 'provider search', () => Promise.reject(new Error('source failed'))))
            .rejects.toThrow('source failed');
        expect(await timeFoliumMod('guard-b', 'command guard-b:run', async () => 'done')).toBe('done');

        expect(getFoliumCallStats('guard-b')).toMatchObject({ calls: 3, failures: 2 });
        expect(issuesOf('guard-b')).toEqual([]);
    });

    it('adds up the synchronous time and warns past the budget it is given', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const clock = vi.spyOn(performance, 'now');
        clock.mockReturnValueOnce(100).mockReturnValueOnce(104);
        callFoliumMod('guard-c', 'event app.viewChanged', () => {}, 16);
        expect(warn).not.toHaveBeenCalled();

        clock.mockReturnValueOnce(200).mockReturnValueOnce(220);
        callFoliumMod('guard-c', 'event app.viewChanged', () => {}, 16);
        expect(warn).toHaveBeenCalledWith('[Folium:guard-c] event app.viewChanged took 20.0ms');
        // A single call is not something that runs again and again: no listener time.
        expect(getFoliumCallStats('guard-c')).toEqual({
            calls: 2, totalMs: 24, longestMs: 20, failures: 0, listenerMs: 0, listenerSeconds: 0,
        });
    });
});

describe('the cost of what runs again and again', () => {
    it('adds up the time of a repeated callback and counts the different seconds it ran in', () => {
        const clock = vi.spyOn(performance, 'now');
        const gated = gateFoliumCallback('guard-cost', 'visualizer guard-cost:mode onFrame', () => {});
        // Three calls within one second and one in a later second: 2 + 2 + 2 + 6 ms.
        [[1000, 1002], [1100, 1102], [1900, 1902], [2500, 2506]].forEach(([start, end]) => {
            clock.mockReturnValueOnce(start).mockReturnValueOnce(end);
            gated(undefined);
        });
        expect(getFoliumCallStats('guard-cost')).toEqual({
            calls: 4, totalMs: 12, longestMs: 6, failures: 0, listenerMs: 12, listenerSeconds: 2,
        });
    });
});

describe('a function a mod hands over to be called again', () => {
    it('keeps one row for its place however often it fails: the count and the last message', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        let message = 'same';
        const gated = gateFoliumCallback('guard-d', 'visualizer guard-d:mode onLyricTime', (seconds: number) => {
            if (seconds < 0) return seconds;
            throw new Error(message);
        });
        expect(gated(-1)).toBe(-1);
        expect(gated(1)).toBeUndefined();
        expect(gated(2)).toBeUndefined();
        message = 'other';
        gated(3);

        expect(issuesOf('guard-d')).toMatchObject([
            { where: 'visualizer guard-d:mode onLyricTime', message: 'other', count: 3 },
        ]);
        expect(getFoliumCallStats('guard-d')).toMatchObject({ calls: 4, failures: 3 });
    });

    it('reports the rejection of an async listener', async () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const gated = gateFoliumCallback('guard-e', 'panel tab guard-e:tab subscribe', async () => { throw new Error('async boom'); });
        await expect(gated(undefined)).rejects.toThrow('async boom');
        expect(issuesOf('guard-e')).toMatchObject([{ where: 'panel tab guard-e:tab subscribe', message: 'async boom' }]);
    });
});

describe('the context one mount receives', () => {
    it('turns subscribe into onChange and a clock\'s on into its helper, and refuses a listener that is no function', () => {
        const ctx = Object.freeze({
            locale: 'en',
            getTheme: () => 'theme',
            subscribe: () => () => true,
            lyricTime: Object.freeze({ get: () => 12, on: () => () => {} }),
        });
        const { view } = createFoliumMountView<{
            locale: string;
            getTheme: () => string;
            lyricTime: { get: () => number };
            onChange: (listener: unknown) => unknown;
            onLyricTime: (listener: unknown) => unknown;
        }>(ctx, 'guard-f', 'panel tab guard-f:tab');

        expect(Object.keys(view).sort()).toEqual(['getTheme', 'locale', 'lyricTime', 'onChange', 'onLyricTime']);
        expect(Object.isFrozen(view)).toBe(true);
        expect(view.locale).toBe('en');
        expect(view.getTheme).toBe(ctx.getTheme);
        expect(Object.keys(view.lyricTime)).toEqual(['get']);
        expect(view.lyricTime.get()).toBe(12);
        expect(() => view.onChange('nope')).toThrow('panel tab guard-f:tab onChange: listener must be a function');
        expect(() => view.onLyricTime('nope')).toThrow('panel tab guard-f:tab onLyricTime: listener must be a function');
    });

    it('passes a context without listener members through as an equal object', () => {
        const { view, release } = createFoliumMountView({ values: 1 }, 'guard-g', 'command');
        expect(view).toEqual({ values: 1 });
        expect(() => release()).not.toThrow();
    });
});
