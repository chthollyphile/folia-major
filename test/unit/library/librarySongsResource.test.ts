import { describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { OmniPage } from '@/types/onlineMusic';
import type { OnlineGridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';
import { createLibrarySongsResource } from '@/library/core/collection/resource/librarySongsResource.service';

// Tests the memory-only, account-scoped library read and atomic refresh lifecycle.
const collection: OnlineGridViewCollectionDescriptor = {
    source: 'online', providerId: 'p', type: 'library_songs', id: 'u', name: 'Songs', trackCount: 1,
};
const song = (id: string, providerId = 'p'): SongResult => ({
    id, name: id, artists: [], album: { id: '', name: '' }, durationMs: 1000,
    sourceRef: { kind: 'online', providerId, mediaId: id },
} as SongResult);
const page = (items: SongResult[], hasMore = false, nextOffset = items.length): OmniPage<SongResult> => ({
    items, hasMore, nextOffset, total: 1,
});
const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const context = { currentUserId: 'u', librarySongsScope: { providerId: 'p', userId: 'u' } };
const setup = (fetch = vi.fn<(...args: unknown[]) => Promise<OmniPage<SongResult>>>()) => {
    const resource = createLibrarySongsResource('songs', { getCollectionTracks: fetch });
    return { resource, fetch, start: () => resource.ensure(collection, context) };
};

describe('library songs resource', () => {
    it('publishes the first page then automatically follows offsets, never totals or deduped length', async () => {
        const last = deferred<OmniPage<SongResult>>();
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValueOnce(page([song('a'), song('a')], true, 47)).mockReturnValueOnce(last.promise);
        start();
        await flush();
        expect(fetch.mock.calls.map(call => call[1])).toEqual([{ limit: 100, offset: 0 }, { limit: 500, offset: 47 }]);
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', tracks: [song('a')], sync: { status: 'syncing' }, librarySongs: { complete: false, loadedCount: 1, refreshing: false } });
        last.resolve(page([song('a'), song('b'), song('a', 'q')], false, 51));
        await flush();
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', tracks: [song('a'), song('b'), song('a', 'q')], sync: { status: 'none' }, librarySongs: { complete: true, loadedCount: 3, refreshing: false } });
    });

    it('completes an empty collection', async () => {
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValue(page([]));
        start(); await flush();
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', tracks: [], librarySongs: { complete: true, loadedCount: 0 } });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('continues through short and empty pages when the offset advances and hasMore is true', async () => {
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValueOnce(page([], true, 4)).mockResolvedValueOnce(page([song('a')], true, 9)).mockResolvedValueOnce(page([], false, 9));
        start(); await flush();
        expect(fetch.mock.calls.map(call => (call[1] as { offset: number }).offset)).toEqual([0, 4, 9]);
        expect(resource.getSnapshot().librarySongs?.complete).toBe(true);
    });

    it.each([0, -1, NaN, Infinity])('rejects stalled or invalid nextOffset %s and manually retries that same page', async (offset) => {
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValueOnce(page([song('a')], true, offset));
        start(); await flush();
        expect(resource.getSnapshot()).toMatchObject({ status: 'error', sync: { status: 'interrupted', offset: 0 }, librarySongs: { complete: false } });
        expect(fetch).toHaveBeenCalledTimes(1);
        fetch.mockResolvedValueOnce(page([song('b')]));
        resource.resumeSync(); await flush();
        expect((fetch.mock.calls[1][1] as { offset: number }).offset).toBe(0);
        expect(resource.getSnapshot().tracks).toEqual([song('b')]);
        expect(resource.getSnapshot().librarySongs?.complete).toBe(true);
    });

    it('keeps partial songs on failure without auto retry, then resumes the failed upstream offset', async () => {
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValueOnce(page([song('a')], true, 60)).mockRejectedValueOnce(new Error('offline'));
        start(); await flush();
        expect(resource.getSnapshot()).toMatchObject({ tracks: [song('a')], sync: { status: 'interrupted', offset: 60 }, librarySongs: { complete: false } });
        resource.ensure(collection, context); await flush();
        expect(fetch).toHaveBeenCalledTimes(2);
        fetch.mockResolvedValueOnce(page([song('b')]));
        resource.resumeSync(); resource.resumeSync(); await flush();
        expect(fetch).toHaveBeenCalledTimes(3);
        expect((fetch.mock.calls[2][1] as { offset: number }).offset).toBe(60);
        expect(resource.getSnapshot().tracks).toEqual([song('a'), song('b')]);
    });

    it('retains every provider-clamped page and retries only the failed upstream page', async () => {
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValueOnce(page([song('first')], true, 100))
            .mockResolvedValueOnce(page([song('second')], true, 200))
            .mockRejectedValueOnce(new Error('third upstream page failed'));
        start(); await flush();
        expect(fetch.mock.calls.map(call => call[1])).toEqual([
            { limit: 100, offset: 0 }, { limit: 500, offset: 100 }, { limit: 500, offset: 200 },
        ]);
        expect(resource.getSnapshot()).toMatchObject({
            tracks: [song('first'), song('second')],
            sync: { status: 'interrupted', offset: 200 },
            librarySongs: { complete: false, loadedCount: 2 },
        });
        await flush();
        expect(fetch).toHaveBeenCalledTimes(3);
        fetch.mockResolvedValueOnce(page([song('third')], false, 300));
        resource.resumeSync(); await flush();
        expect(fetch.mock.calls.map(call => call[1])).toEqual([
            { limit: 100, offset: 0 }, { limit: 500, offset: 100 },
            { limit: 500, offset: 200 }, { limit: 500, offset: 200 },
        ]);
        expect(resource.getSnapshot()).toMatchObject({
            tracks: [song('first'), song('second'), song('third')],
            librarySongs: { complete: true, loadedCount: 3 },
        });
    });

    it('retains old visible songs during refresh and refresh failure, retrying the staged failed page', async () => {
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValueOnce(page([song('old')]));
        start(); await flush();
        const last = deferred<OmniPage<SongResult>>();
        fetch.mockResolvedValueOnce(page([song('new')], true, 80)).mockReturnValueOnce(last.promise);
        resource.reload(); await flush();
        expect(resource.getSnapshot()).toMatchObject({ tracks: [song('old')], librarySongs: { complete: false, loadedCount: 1, refreshing: true } });
        last.reject(new Error('offline')); await flush();
        expect(resource.getSnapshot()).toMatchObject({ tracks: [song('old')], sync: { status: 'interrupted', offset: 80 }, librarySongs: { complete: false, refreshing: true } });
        fetch.mockResolvedValueOnce(page([song('newer')]));
        resource.resumeSync(); await flush();
        expect((fetch.mock.calls[3][1] as { offset: number }).offset).toBe(80);
        expect(resource.getSnapshot()).toMatchObject({ tracks: [song('new'), song('newer')], librarySongs: { complete: true, loadedCount: 2, refreshing: false } });
    });

    it('also stages a refresh of an interrupted partial initial read until full completion', async () => {
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValueOnce(page([song('partial')], true, 10)).mockRejectedValueOnce(new Error('offline'));
        start(); await flush();
        const last = deferred<OmniPage<SongResult>>();
        fetch.mockResolvedValueOnce(page([song('new')], true, 20)).mockReturnValueOnce(last.promise);
        resource.reload(); await flush();
        expect(resource.getSnapshot()).toMatchObject({ tracks: [song('partial')], librarySongs: { refreshing: true, complete: false } });
        last.resolve(page([song('last')])); await flush();
        expect(resource.getSnapshot().tracks).toEqual([song('new'), song('last')]);
    });

    it('keeps the old visible snapshot when refresh first page fails and atomically replaces it with empty success', async () => {
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValueOnce(page([song('old')])).mockRejectedValueOnce(new Error('offline'));
        start(); await flush(); resource.reload(); await flush();
        expect(resource.getSnapshot().tracks).toEqual([song('old')]);
        fetch.mockResolvedValueOnce(page([]));
        resource.resumeSync(); await flush();
        expect(resource.getSnapshot()).toMatchObject({ tracks: [], status: 'ready', librarySongs: { complete: true, refreshing: false } });
    });

    it('continues on pause and reuses throughout the session, ignoring cosmetic descriptor revisions', async () => {
        const next = deferred<OmniPage<SongResult>>();
        const { resource, fetch, start } = setup();
        fetch.mockReturnValue(next.promise);
        start(); resource.pause();
        expect(resource.canReuse({ ...collection, trackCount: 999 })).toBe(true);
        next.resolve(page([song('a')])); await flush();
        resource.ensure({ ...collection, updatedAt: Date.now() }, context); await flush();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(resource.getSnapshot().librarySongs?.complete).toBe(true);
    });

    it('clears all memory on disposal and rejects late responses and future retries', async () => {
        const next = deferred<OmniPage<SongResult>>();
        const { resource, fetch, start } = setup();
        fetch.mockResolvedValueOnce(page([song('a')], true, 10)).mockReturnValueOnce(next.promise);
        start(); await flush(); resource.dispose();
        next.resolve(page([song('late')])); await flush();
        resource.reload(); resource.resumeSync(); start();
        expect(resource.getSnapshot()).toMatchObject({ tracks: [], librarySongs: { complete: false, loadedCount: 0 } });
        expect(resource.canReuse(collection)).toBe(false);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it.each([
        { descriptor: collection, userId: 'other' },
        { descriptor: collection, userId: null },
        { descriptor: { ...collection, providerId: 'other' }, userId: 'u' },
        { descriptor: { ...collection, id: 'other' }, userId: 'u' },
    ])('invalidates rather than carrying data to a different account or collection: %j', async ({ descriptor, userId }) => {
        const next = deferred<OmniPage<SongResult>>();
        const { resource, fetch, start } = setup();
        fetch.mockReturnValueOnce(next.promise);
        start(); resource.ensure(descriptor, { currentUserId: userId });
        next.resolve(page([song('late')])); await flush();
        expect(resource.getSnapshot().tracks).toEqual([]);
        expect(resource.canReuse(collection)).toBe(false);
    });

    it.each([
        { currentUserId: null, librarySongsScope: null },
        { currentUserId: 'u' },
        { currentUserId: 'u', librarySongsScope: null },
        { currentUserId: 'other', librarySongsScope: { providerId: 'p', userId: 'other' } },
        { currentUserId: 'u', librarySongsScope: { providerId: 'other', userId: 'u' } },
        { currentUserId: 'u', librarySongsScope: { providerId: 'p', userId: 'other' } },
    ])('fails closed before first fetch for unavailable or mismatched active scope: %j', async deniedContext => {
        const { resource, fetch } = setup();
        fetch.mockResolvedValue(page([song('private')]));
        resource.ensure(collection, deniedContext);
        await flush();
        resource.reload(); resource.resumeSync();
        resource.ensure(collection, context);
        await flush();
        expect(fetch).not.toHaveBeenCalled();
        expect(resource.getSnapshot().tracks).toEqual([]);
        expect(resource.canReuse(collection)).toBe(false);
    });

    it('clears an in-flight read when the active source is no longer online despite the same user', async () => {
        const pending = deferred<OmniPage<SongResult>>();
        const { resource, fetch, start } = setup();
        fetch.mockReturnValueOnce(pending.promise);
        start();
        resource.ensure(collection, { ...context, librarySongsScope: null });
        pending.resolve(page([song('late')]));
        await flush();
        expect(resource.getSnapshot().tracks).toEqual([]);
        expect(resource.canReuse(collection)).toBe(false);
    });

    it('preserves library songs lacking catalog mappings and prevents read-only mutations', async () => {
        const { resource, fetch, start } = setup();
        const missing = song('library-only');
        fetch.mockResolvedValueOnce(page([missing]));
        start(); await flush();
        await resource.removeTracks(() => true);
        expect(resource.removeAt(0, 'online:p:library-only')).toBe(false);
        expect(resource.replaceTrackAt(0, 'online:p:library-only', song('x'))).toBe(false);
        const replace = vi.fn(async () => [song('x')]);
        expect(await resource.replaceAll(replace)).toBe(false);
        expect(replace).not.toHaveBeenCalled();
        expect(resource.getSnapshot().tracks).toEqual([missing]);
    });
});
