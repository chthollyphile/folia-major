// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The record reads its saved choices from localStorage at import time, and Node's own
// experimental storage shadows jsdom's here, so an in-memory Storage goes in first.
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
import { callFoliumMod, gateFoliumCallback } from '@/mods/runtime/guard';
import { getFoliumIssues, useFoliumStatusStore } from '@/mods/runtime/status';

// test/unit/mod-system/foliumFailureRecord.test.ts
// How a mod's failures are kept (status.ts): one row per place with a count,
// the first and the last time and the last message; the store the settings
// row draws from is written at most once a second per mod however often the
// mod fails; and a thrown value that cannot even be read is still recorded.
// Everything here goes through the gate and reads the store, as the row does.
// Each test uses a mod id of its own, because the record lives for the whole
// window.

const rowsOf = (modId: string) => useFoliumStatusStore.getState().issues[modId] ?? [];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(1_000_000);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('the record of a mod\'s failures', () => {
    it('writes the store once for 1,000 failures in a row, then at most once a second', () => {
        let writes = 0;
        const stop = useFoliumStatusStore.subscribe(() => { writes += 1; });
        let thrown = 0;
        // A different text every time: the failure is new each time by its words, the place is the same.
        const draw = gateFoliumCallback('record-flood', 'visualizer record-flood:mode onFrame', () => {
            thrown += 1;
            throw new Error(`boom ${thrown}`);
        });

        for (let frame = 0; frame < 1000; frame += 1) draw(frame);
        expect(writes).toBe(1);

        vi.advanceTimersByTime(999);
        expect(writes).toBe(1);
        vi.advanceTimersByTime(1);
        expect(writes).toBe(2);
        expect(rowsOf('record-flood')).toMatchObject([
            { where: 'visualizer record-flood:mode onFrame', count: 1000, message: 'boom 1000' },
        ]);

        // Ten more seconds of a failure every 5 ms.
        for (let frame = 0; frame < 2000; frame += 1) {
            vi.advanceTimersByTime(5);
            draw(frame);
        }
        expect(writes - 2).toBeLessThanOrEqual(10);
        expect(rowsOf('record-flood')[0].count).toBeGreaterThan(2900);
        // The console is not flooded either: a line a second for the place.
        expect((console.warn as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThanOrEqual(12);
        stop();
    });

    it('keeps one row per place: how many times, the first and the last time, the last message', () => {
        const fail = (where: string, message: string) => callFoliumMod('record-rows', where, () => { throw new Error(message); });
        fail('panel tab record-rows:tab mount', 'first');
        vi.advanceTimersByTime(1500);
        fail('panel tab record-rows:tab mount', 'second');
        fail('event playback.seeked', 'other place');
        vi.advanceTimersByTime(1000);

        expect(rowsOf('record-rows')).toEqual([
            { where: 'panel tab record-rows:tab mount', message: 'second', count: 2, firstAt: 1_000_000, lastAt: 1_001_500 },
            { where: 'event playback.seeked', message: 'other place', count: 1, firstAt: 1_001_500, lastAt: 1_001_500 },
        ]);
    });

    it('does not grow with a mod that makes up a new place on every failure', () => {
        for (let index = 0; index < 200; index += 1) {
            callFoliumMod('record-many', `progress button record-many:made-up-${index} mount`, () => { throw new Error('boom'); });
        }
        vi.advanceTimersByTime(1000);
        const rows = rowsOf('record-many');
        expect(rows).toHaveLength(51);
        expect(rows[50]).toMatchObject({ where: 'other places', count: 150 });
    });

    it('turns a thrown value into text once, however often the mod\'s rows are written after', () => {
        let read = 0;
        const thrown = { toJSON: () => { read += 1; return 'thrown once'; } };
        callFoliumMod('record-once', 'panel tab record-once:tab mount', () => { throw thrown; });
        expect(read).toBe(1);
        // Another place of the same mod goes on failing: a write of the mod's rows every second.
        for (let second = 0; second < 10; second += 1) {
            vi.advanceTimersByTime(1000);
            callFoliumMod('record-once', 'event playback.seeked', () => { throw new Error('again'); });
        }
        vi.advanceTimersByTime(1000);
        expect(rowsOf('record-once')).toMatchObject([
            { where: 'panel tab record-once:tab mount', message: '"thrown once"', count: 1 },
            { where: 'event playback.seeked', message: 'again', count: 10 },
        ]);
        expect(getFoliumIssues('record-once')[0].message).toBe('"thrown once"');
        expect(read).toBe(1);

        // The same place fails with another value: that one is read, once.
        callFoliumMod('record-once', 'panel tab record-once:tab mount', () => { throw { toJSON: () => { read += 1; return 'second'; } }; });
        vi.advanceTimersByTime(2000);
        expect(rowsOf('record-once')[0]).toMatchObject({ message: '"second"', count: 2 });
        expect(read).toBe(2);
    });

    it('records a thrown value that is no Error, and one that cannot be read, without throwing', () => {
        const unreadable = new Error('never read');
        Object.defineProperty(unreadable, 'message', { get: () => { throw new Error('no message for you'); } });
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const hostile = new Proxy({}, {
            get: () => { throw new Error('no reading'); },
            getPrototypeOf: () => { throw new Error('no prototype'); },
            ownKeys: () => { throw new Error('no keys'); },
        });
        const thrown: Array<[string, unknown]> = [
            ['a string', 'plain words'],
            ['an object', { code: 7 }],
            ['nothing', undefined],
            ['a circular object', circular],
            ['an unreadable message', unreadable],
            ['a hostile proxy', hostile],
        ];
        thrown.forEach(([where, value]) => {
            expect(() => callFoliumMod('record-odd', where, () => { throw value; })).not.toThrow();
        });
        // The per-frame path takes the same values.
        const listener = gateFoliumCallback('record-odd', 'a listener', () => { throw unreadable; });
        expect(() => listener(0)).not.toThrow();
        vi.advanceTimersByTime(1000);

        expect(Object.fromEntries(rowsOf('record-odd').map((row) => [row.where, row.message]))).toEqual({
            'a string': 'plain words',
            'an object': '{"code":7}',
            nothing: 'undefined',
            'a circular object': '[object Object]',
            'an unreadable message': 'an error that cannot be printed',
            'a hostile proxy': 'an error that cannot be printed',
            'a listener': 'an error that cannot be printed',
        });
    });
});
