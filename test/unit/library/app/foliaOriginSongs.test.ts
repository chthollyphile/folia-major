import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/library/app/foliaOriginSongs.test.ts
// 转存与「从原歌单更新」读原歌单的那一段：一页页读到头、报进度、能取消；来源不在时不去读；出处怎么记、怎么还原成能读的集合。

const env = vi.hoisted(() => ({
    registered: new Set<string>(['alpha']),
    switchedOff: new Set<string>(),
    pages: [] as Array<{ items: unknown[]; hasMore: boolean; nextOffset: number; total?: number }>,
    calls: [] as Array<{ collection: unknown; page: { limit: number; offset: number } }>,
    failAt: -1,
    navidromeConfigured: true,
    navidrome: { tracks: [] as unknown[], failed: false },
}));

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        getProviderNaming: (id: string) => (env.registered.has(id) ? { name: id } : null),
        isSourceSwitchedOn: (id: string) => !env.switchedOff.has(id),
        getCollectionTracks: async (collection: unknown, page: { limit: number; offset: number }) => {
            const index = env.calls.length;
            env.calls.push({ collection, page });
            if (index === env.failAt) throw new Error('The platform refused');
            return env.pages[index] ?? { items: [], hasMore: false, nextOffset: page.offset };
        },
    },
}));
vi.mock('@/services/navidromeService', () => ({
    getNavidromeConfig: () => (env.navidromeConfigured ? { serverUrl: 'http://navidrome.test' } : null),
}));
vi.mock('@/library/core/collection/resource/navidromeCollectionTracks.service', () => ({
    resolveNavidromeGridViewTracks: async () => env.navidrome,
}));

import {
    collectionOfFoliaOrigin,
    describeFoliaOrigin,
    FoliaOriginUnreadableError,
    isAbortError,
    readFoliaOriginSongs,
    resolveFoliaOriginSourceState,
    type FoliaSavableCollection,
} from '@/library/app/foliaOriginSongs';

const song = (id: number): SongResult => ({ id, name: `song ${id}` } as SongResult);
const playlist: FoliaSavableCollection = { source: 'online', providerId: 'alpha', type: 'playlist', id: 42, name: 'Mine', providerData: { dirId: 7 } } as FoliaSavableCollection;

beforeEach(() => {
    env.registered = new Set(['alpha']);
    env.switchedOff = new Set();
    env.pages = [];
    env.calls = [];
    env.failAt = -1;
    env.navidromeConfigured = true;
    env.navidrome = { tracks: [], failed: false };
});

describe('reading the original collection', () => {
    it('reads page after page in order and reports how far it is', async () => {
        env.pages = [
            { items: [song(1), song(2)], hasMore: true, nextOffset: 2, total: 5 },
            { items: [song(3), song(4)], hasMore: true, nextOffset: 4, total: 5 },
            { items: [song(5)], hasMore: false, nextOffset: 5, total: 5 },
        ];
        const progress: unknown[] = [];
        const songs = await readFoliaOriginSongs(playlist, { onProgress: step => progress.push(step) });
        expect(songs.map(item => item.id)).toEqual([1, 2, 3, 4, 5]);
        expect(env.calls.map(call => call.page.offset)).toEqual([0, 2, 4]);
        // 读的是同一张集合描述（音源要的附带数据原样带着）。
        expect(env.calls.every(call => call.collection === playlist)).toBe(true);
        expect(progress).toEqual([{ loaded: 2, total: 5 }, { loaded: 4, total: 5 }, { loaded: 5, total: 5 }]);
    });

    it('is a failed read when the source says there is more but a page does not move on', async () => {
        env.pages = [
            { items: [song(1)], hasMore: true, nextOffset: 1 },
            { items: [], hasMore: true, nextOffset: 1 },
            { items: [song(9)], hasMore: true, nextOffset: 2 },
        ];
        await expect(readFoliaOriginSongs(playlist)).rejects.toMatchObject({ reason: 'read-failed' });
        expect(env.calls).toHaveLength(2);
    });

    it('stops between pages when cancelled, and says so with an AbortError', async () => {
        env.pages = [
            { items: [song(1)], hasMore: true, nextOffset: 1 },
            { items: [song(2)], hasMore: true, nextOffset: 2 },
        ];
        const controller = new AbortController();
        const reading = readFoliaOriginSongs(playlist, { signal: controller.signal, onProgress: () => controller.abort() });
        await expect(reading).rejects.toSatisfy(isAbortError);
        expect(env.calls).toHaveLength(1);
    });

    it('does not read when the source is not there, and names why', async () => {
        env.registered = new Set();
        await expect(readFoliaOriginSongs(playlist)).rejects.toMatchObject({ reason: 'source-missing' });
        env.registered = new Set(['alpha']);
        env.switchedOff = new Set(['alpha']);
        await expect(readFoliaOriginSongs(playlist)).rejects.toMatchObject({ reason: 'source-off' });
        expect(env.calls).toHaveLength(0);
        expect(resolveFoliaOriginSourceState('alpha')).toBe('source-off');
    });

    it('wraps a failed read with the error the source threw', async () => {
        env.pages = [{ items: [song(1)], hasMore: true, nextOffset: 1 }];
        env.failAt = 1;
        const error = await readFoliaOriginSongs(playlist).catch(caught => caught as unknown);
        expect(error).toBeInstanceOf(FoliaOriginUnreadableError);
        expect(error).toMatchObject({ reason: 'read-failed' });
        expect(((error as FoliaOriginUnreadableError).cause as Error).message).toBe('The platform refused');
    });

    it('reads a Navidrome collection in one go, and says when Navidrome is not set up or does not answer', async () => {
        const navidromeAlbum: FoliaSavableCollection = { source: 'navidrome', type: 'album', id: 'al-1', name: 'Album' } as FoliaSavableCollection;
        env.navidrome = { tracks: [song(1), song(2)], failed: false };
        expect((await readFoliaOriginSongs(navidromeAlbum)).map(item => item.id)).toEqual([1, 2]);
        env.navidrome = { tracks: [], failed: true };
        await expect(readFoliaOriginSongs(navidromeAlbum)).rejects.toMatchObject({ reason: 'read-failed' });
        env.navidromeConfigured = false;
        await expect(readFoliaOriginSongs(navidromeAlbum)).rejects.toMatchObject({ reason: 'navidrome-unconfigured' });
    });
});

describe('how an origin is written down and read back', () => {
    it('keeps the source, the id as text, the kind and the data the source reads the collection with', () => {
        const origin = describeFoliaOrigin(playlist);
        expect(origin).toEqual({ sourceId: 'alpha', collectionId: '42', name: 'Mine', collectionType: 'playlist', collectionData: { dirId: 7 } });
        // 存的是一份拷贝，不是集合描述上的那个对象。
        expect(origin.collectionData).not.toBe((playlist as { providerData?: unknown }).providerData);
        expect(collectionOfFoliaOrigin({ ...origin, savedAt: 1 })).toEqual({
            source: 'online', providerId: 'alpha', type: 'playlist', id: '42', name: 'Mine', providerData: { dirId: 7 },
        });
    });

    it('leaves out data that cannot be stored, and tells an album from a playlist', () => {
        const album = { source: 'online', providerId: 'alpha', type: 'album', id: 'a1', name: 'Album', providerData: { run: () => {} } } as unknown as FoliaSavableCollection;
        const origin = describeFoliaOrigin(album);
        expect(origin).toEqual({ sourceId: 'alpha', collectionId: 'a1', name: 'Album', collectionType: 'album' });
        expect(collectionOfFoliaOrigin({ ...origin, savedAt: 1 })).toMatchObject({ type: 'album', id: 'a1' });
        // 以前存的出处没有写种类：按歌单读。
        expect(collectionOfFoliaOrigin({ sourceId: 'alpha', collectionId: 'p', name: 'Old', savedAt: 1 })).toMatchObject({ type: 'playlist' });
    });

    it('writes Navidrome down under its own name', () => {
        const origin = describeFoliaOrigin({ source: 'navidrome', type: 'playlist', id: 'np', name: 'N' } as FoliaSavableCollection);
        expect(origin).toEqual({ sourceId: 'navidrome', collectionId: 'np', name: 'N', collectionType: 'playlist' });
        expect(collectionOfFoliaOrigin({ ...origin, savedAt: 1 })).toEqual({ source: 'navidrome', type: 'playlist', id: 'np', name: 'N' });
    });
});
