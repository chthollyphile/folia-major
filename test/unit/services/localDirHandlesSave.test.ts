import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as CacheRepository from '@/services/repositories/cacheRepository';

// test/unit/services/localDirHandlesSave.test.ts
// One imported root's directory handle that IndexedDB can no longer serialize must not keep every
// other root's handle - above all the one just imported - out of the `local_dir_handles` row, and a
// failure that is not about one handle must not cost the handles already saved.

const rows = new Map<string, unknown>();
const mocks = vi.hoisted(() => ({ putCacheEntry: vi.fn(), removeCacheEntry: vi.fn(), readCacheEntry: vi.fn() }));

vi.mock('@/services/repositories/cacheRepository', async importOriginal => ({
    ...await importOriginal<typeof CacheRepository>(),
    putCacheEntry: mocks.putCacheEntry,
    removeCacheEntry: mocks.removeCacheEntry,
    readCacheEntry: mocks.readCacheEntry,
}));

const { saveDirHandles, deleteDirHandle } = await import('@/services/db');

type FakeHandle = FileSystemDirectoryHandle & { broken: boolean };
const handle = (name: string) => ({ kind: 'directory', name, broken: name.startsWith('bad') }) as unknown as FakeHandle;

// Stands in for IndexedDB: a row holding any broken handle fails as a whole ("Failed to write blobs"),
// and a failed put leaves the row as it was.
let failNextPuts = 0;
let failAllPuts = false;
const putWrites: Array<[string, Record<string, unknown>]> = [];
const fakePut = async (key: string, data: Record<string, FakeHandle>) => {
    if (failAllPuts || failNextPuts > 0) {
        failNextPuts = Math.max(0, failNextPuts - 1);
        throw new Error('DataError Failed to write blobs (Error)');
    }
    if (Object.values(data).some(value => value.broken)) throw new Error('DataError Failed to write blobs (Error)');
    putWrites.push([key, data]);
    rows.set(key, data);
};

const savedRow = () => rows.get('local_dir_handles') as Record<string, unknown> | undefined;
const mainRowWrites = () => putWrites.filter(([key]) => key === 'local_dir_handles');

describe('saveDirHandles', () => {
    beforeEach(() => {
        rows.clear();
        putWrites.length = 0;
        failNextPuts = 0;
        failAllPuts = false;
        mocks.putCacheEntry.mockReset().mockImplementation(fakePut);
        mocks.removeCacheEntry.mockReset().mockImplementation(async (key: string) => { rows.delete(key); });
        // A copy, as IndexedDB hands back: callers change what they read.
        mocks.readCacheEntry.mockReset().mockImplementation(async (key: string) => {
            const row = rows.get(key) as Record<string, unknown> | undefined;
            return row ? { ...row } : null;
        });
        vi.spyOn(console, 'warn').mockImplementation(() => { });
        vi.spyOn(console, 'error').mockImplementation(() => { });
    });

    it('writes the row once when every handle can be stored', async () => {
        expect(await saveDirHandles({ a: handle('a'), b: handle('b') })).toEqual(['a', 'b']);
        expect(mocks.putCacheEntry).toHaveBeenCalledTimes(1);
        expect(Object.keys(savedRow()!)).toEqual(['a', 'b']);
    });

    it('drops the handles that cannot be stored and keeps the newly imported root', async () => {
        const saved = await saveDirHandles({ 'bad-old-1': handle('bad-old-1'), 'bad-old-2': handle('bad-old-2'), fresh: handle('fresh') });
        expect(saved).toEqual(['fresh']);
        expect(Object.keys(savedRow()!)).toEqual(['fresh']);
        expect(rows.has('local_dir_handles_probe')).toBe(false);
    });

    it('writes the real row only once, with every good root, around a broken one', async () => {
        await saveDirHandles({ good1: handle('good1'), bad: handle('bad'), good2: handle('good2') });
        expect(mainRowWrites().map(([, data]) => Object.keys(data))).toEqual([['good1', 'good2']]);
    });

    it('does not drop a good handle over one passing failure', async () => {
        rows.set('local_dir_handles', { old: handle('old') });
        failNextPuts = 2; // the whole row, then the first try of the first handle
        expect(await saveDirHandles({ a: handle('a'), b: handle('b') })).toEqual(['a', 'b']);
        expect(Object.keys(savedRow()!)).toEqual(['a', 'b']);
    });

    it('leaves the saved row as it was when nothing can be written', async () => {
        const before = { old: handle('old') };
        rows.set('local_dir_handles', before);
        failAllPuts = true;
        expect(await saveDirHandles({ old: handle('old'), fresh: handle('fresh') })).toBeNull();
        expect(savedRow()).toBe(before);
    });

    it('removes a root even when every handle left behind is broken', async () => {
        rows.set('local_dir_handles', { bad: handle('bad'), a: handle('a') });
        expect(await deleteDirHandle('a')).toBe(true);
        expect(savedRow()).toEqual({});
    });

    it('deleteDirHandle reports whether the root is gone from the row', async () => {
        rows.set('local_dir_handles', { a: handle('a'), b: handle('b') });
        expect(await deleteDirHandle('a')).toBe(true);
        expect(Object.keys(savedRow()!)).toEqual(['b']);

        failAllPuts = true;
        expect(await deleteDirHandle('b')).toBe(false);
        expect(Object.keys(savedRow()!)).toEqual(['b']);
    });
});
