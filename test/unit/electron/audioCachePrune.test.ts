import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    DEFAULT_AUDIO_CACHE_LIMIT_BYTES,
    resolveCacheLimit,
    selectEvictions,
} = require('../../../electron/audioCachePrune.cjs') as typeof import('../../../electron/audioCachePrune.cjs');

const GB = 1024 * 1024 * 1024;

/** name, size, last played. */
const entry = (name: string, size: number, usedAt: number) => ({ name, size, usedAt });

describe('resolveCacheLimit', () => {
    it('treats zero as the listener asking for no ceiling', () => {
        expect(resolveCacheLimit(0)).toBe(Infinity);
    });

    it('falls back to the default rather than to keeping everything', () => {
        // An unbounded cache is the state this exists to prevent, so a missing or nonsense limit
        // must not be read as "no limit" - only an explicit zero means that.
        for (const bad of [undefined, null, NaN, -1, 'lots']) {
            expect(resolveCacheLimit(bad as never)).toBe(DEFAULT_AUDIO_CACHE_LIMIT_BYTES);
        }
    });
});

describe('selectEvictions', () => {
    it('keeps everything while the cache still fits', () => {
        expect(selectEvictions([entry('a.bin', GB, 1), entry('b.bin', GB, 2)], 5 * GB)).toEqual([]);
    });

    it('drops what was played longest ago first', () => {
        // The direction that matters: sorting the other way evicts the songs on repeat and keeps
        // the ones nobody went back to, which is the cache doing precisely the wrong thing.
        const evicted = selectEvictions([
            entry('yesterday.bin', GB, 2_000),
            entry('last-year.bin', GB, 1),
            entry('this-morning.bin', GB, 9_000),
        ], 2 * GB);
        expect(evicted).toEqual(['last-year.bin']);
    });

    it('stops as soon as the rest fits, rather than clearing the shelf', () => {
        const evicted = selectEvictions([
            entry('a.bin', GB, 1),
            entry('b.bin', GB, 2),
            entry('c.bin', GB, 3),
            entry('d.bin', GB, 4),
        ], 2 * GB);
        expect(evicted).toEqual(['a.bin', 'b.bin']);
    });

    it('evicts nothing when there is no ceiling', () => {
        expect(selectEvictions([entry('a.bin', 500 * GB, 1)], 0)).toEqual([]);
    });

    it('leaves the caller its own list to sort', () => {
        // main.cjs hands over the array it built from readdir and uses it no further, but a
        // function that quietly reorders its argument is a trap waiting for the next caller.
        const entries = [entry('b.bin', GB, 2), entry('a.bin', GB, 1)];
        selectEvictions(entries, GB);
        expect(entries.map(item => item.name)).toEqual(['b.bin', 'a.bin']);
    });
});
