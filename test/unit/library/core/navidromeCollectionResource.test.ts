import { describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';
import type { NavidromeGridViewCollectionDescriptor } from '@/library/core/collection/collection.contract';
import { createNavidromeCollectionResource } from '@/library/core/collection/resource/navidromeCollectionResource.service';
import { createStaticCollectionResource } from '@/library/core/collection/resource/staticCollectionResource.service';
import { getPlaybackSongKey } from '@/utils/appPlaybackGuards';

// test/unit/library/core/navidromeCollectionResource.test.ts
// Navidrome 资源一次取完、读失败时是错误态（带着读到的那些歌），同一版本不重复请求，作废的结果不提交。
// 静态资源（本地曲库、探针）直接就绪。

const album = (overrides: Partial<NavidromeGridViewCollectionDescriptor> = {}): NavidromeGridViewCollectionDescriptor => ({
    source: 'navidrome',
    id: 'al-1',
    name: 'Album',
    type: 'album',
    trackCount: 2,
    ...overrides,
});

const song = (id: string): SongResult => ({
    id,
    name: id,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'navidrome', mediaId: id },
} as SongResult);

const settle = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

describe('navidrome collection resource', () => {
    it('loads once per version and reports loading first', async () => {
        const load = vi.fn(async () => ({ tracks: [song('a'), song('b')], failed: false }));
        const resource = createNavidromeCollectionResource('k', load);
        resource.ensure(album(), {});
        expect(resource.getSnapshot().status).toBe('loading');
        resource.ensure(album(), {});
        await settle();

        expect(load).toHaveBeenCalledTimes(1);
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', kind: 'navidrome' });
        expect(resource.getSnapshot().tracks.map(track => track.id)).toEqual(['a', 'b']);
    });

    it('says that a load that threw did not read the collection', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const resource = createNavidromeCollectionResource('k', vi.fn(async () => { throw new Error('down'); }));
        resource.ensure(album(), {});
        await settle();
        expect(resource.getSnapshot()).toMatchObject({ status: 'error', tracks: [] });
        expect(resource.getSnapshot().error).not.toBeNull();
        error.mockRestore();
    });

    it('keeps what a read that failed in part brought, and says that it is not whole', async () => {
        const resource = createNavidromeCollectionResource('k', vi.fn(async () => ({ tracks: [song('a')], failed: true })));
        resource.ensure(album({ type: 'artist' }), {});
        await settle();
        expect(resource.getSnapshot()).toMatchObject({ status: 'error' });
        expect(resource.getSnapshot().tracks.map(track => track.id)).toEqual(['a']);
    });

    it('drops a result that arrives after dispose', async () => {
        let resolve!: (read: { tracks: SongResult[]; failed: boolean }) => void;
        const resource = createNavidromeCollectionResource('k', () => new Promise(res => { resolve = res; }));
        const listener = vi.fn();
        resource.subscribe(listener);
        resource.ensure(album(), {});
        listener.mockClear();
        resource.dispose();
        resolve({ tracks: [song('late')], failed: false });
        await settle();
        expect(listener).not.toHaveBeenCalled();
    });

    it('is never reused, so random songs are drawn again on every open', () => {
        expect(createNavidromeCollectionResource('k', vi.fn(async () => ({ tracks: [], failed: false }))).canReuse(album())).toBe(false);
    });
});

describe('static collection resource', () => {
    it('is ready immediately and applies edits in place', async () => {
        const resource = createStaticCollectionResource('local', [song('a'), song('b')]);
        expect(resource.getSnapshot()).toMatchObject({ status: 'ready', kind: 'static' });
        expect(resource.replaceTrackAt(0, getPlaybackSongKey(song('a')), song('c'))).toBe(true);
        await resource.removeTracks(track => track.id === 'b');
        expect(resource.getSnapshot().tracks.map(track => track.id)).toEqual(['c']);
    });
});
