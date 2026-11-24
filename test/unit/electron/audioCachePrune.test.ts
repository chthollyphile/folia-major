import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const {
    DEFAULT_AUDIO_CACHE_LIMIT_BYTES,
    createSourcePruneLimit,
    resolveCacheLimit,
    selectEvictions,
    sourceCacheEntries,
    sourceCacheEntryOf,
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

describe('the cache entries of source mods', () => {
    it('names each by its mod and its own id, and reads the name back', () => {
        const [named] = sourceCacheEntries([{ modId: 'spotify', id: 'abc:160', size: 10, usedAt: 5 }]);
        expect(named).toEqual({ name: 'mod:spotify:abc:160', size: 10, usedAt: 5 });
        expect(sourceCacheEntryOf(named.name)).toEqual({ modId: 'spotify', id: 'abc:160' });
    });

    it('leaves out an entry it could not remove again, and counts one without a time as used longest ago', () => {
        expect(sourceCacheEntries([
            { modId: 'spotify', size: 1 },
            { modId: 'spotify', id: 'a', size: -1 },
            { id: 'a', size: 1 },
            { modId: 'a:b', id: 'a', size: 1 },
            null,
            { modId: 'spotify', id: 'b', size: 2 },
        ])).toEqual([{ name: 'mod:spotify:b', size: 2, usedAt: 0 }]);
        expect(sourceCacheEntries(undefined)).toEqual([]);
    });

    it('reads no other name as a source mod entry', () => {
        expect(sourceCacheEntryOf('audio:x')).toBeNull();
        expect(sourceCacheEntryOf('mod:spotify')).toBeNull();
        expect(sourceCacheEntryOf('mod::a')).toBeNull();
        expect(sourceCacheEntryOf('mod:spotify:')).toBeNull();
    });
});

// set-media-cache-limit and save-audio-cache name the listener's limit; a source mod's api.cache.requestPrune() without a
// limit trims to it (Spotify's keepAudio). Before the window has named one, the host's 5 GiB default must not trim a
// cache the listener let grow past it.
describe('createSourcePruneLimit', () => {
    it('leaves a request without a limit alone until the window has named one', () => {
        const prune = vi.fn();
        const limit = createSourcePruneLimit(prune);

        expect(limit.pruneForSource(undefined)).toBeUndefined();
        expect(limit.named()).toBeNull();
        expect(prune).not.toHaveBeenCalled();
    });

    it('prunes to the limit the window named last', () => {
        const prune = vi.fn(() => 'pruned');
        const limit = createSourcePruneLimit(prune);

        limit.note(2 * GB);
        limit.note(3 * GB);

        expect(limit.pruneForSource(undefined)).toBe('pruned');
        expect(prune).toHaveBeenCalledWith(3 * GB);
    });

    it('keeps zero, the listener asking for no ceiling, as a named limit', () => {
        const prune = vi.fn();
        const limit = createSourcePruneLimit(prune);

        limit.note(0);
        limit.pruneForSource(undefined);

        expect(limit.named()).toBe(0);
        expect(prune).toHaveBeenCalledWith(0);
    });

    it('ignores a named limit that is not a finite number of zero or more', () => {
        const prune = vi.fn();
        const limit = createSourcePruneLimit(prune);

        limit.note(GB);
        for (const bad of [undefined, null, NaN, -1, Infinity, '5', {}]) limit.note(bad as never);

        expect(limit.named()).toBe(GB);
    });

    it('prunes to a limit the source gives itself, named or not', () => {
        const prune = vi.fn();
        const limit = createSourcePruneLimit(prune);

        limit.pruneForSource(GB);
        limit.note(3 * GB);
        limit.pruneForSource(2 * GB);

        expect(prune.mock.calls).toEqual([[GB], [2 * GB]]);
        // A limit of the source's own is not remembered as the listener's.
        expect(limit.named()).toBe(3 * GB);
    });
});
