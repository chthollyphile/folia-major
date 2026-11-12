import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import type { LibraryArtistAlbum, LibraryArtistAlbumSync } from '@/library/core/artist/artist.contract';
import { filterArtistAlbums } from '@/library/core/artist/artistModel';
import { artistSongEntryKey } from '@/library/core/artist/artistSurface';
import { collectWallSlots } from '@/components/wall/wallSlots';
import type { BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import { createBravaisDisplay, diffDisplays, resolveSlotItem } from '@/library/suites/bravais/bravaisDisplay';
import { planBravaisFinite } from '@/library/suites/bravais/bravaisFiniteWall';
import { decideDataUpdate } from '@/library/suites/bravais/bravaisDisplayUpdate';
import { projectArtistItems, projectArtistStatus, resolveArtistWallPeriod } from '@/library/suites/bravais/bravaisArtistModel';
import type { TrackDescription } from '@/library/suites/bravais/bravaisProjection';

// test/unit/library/bravais/bravaisArtistModel.test.ts
// B8 歌手页的纯投影：热门歌曲与专辑混排（热门歌曲在前；有限拼贴里 rank 离缝最近）、过滤只筛专辑、专辑分页期间的
// 循环周期（新页只翻原本空着的 slot，已有内容的 slot 不动）、状态行（加载 / 错误 / 空 / 过滤无结果分开）与分页进度。

const metrics = { cellSize: 128, gap: 8 };
const view = { width: 1140, height: 1100, scale: 0.76 };

const song = (id: number): SongResult => ({ id, name: `Song ${id}`, artists: [{ id: 'ar', name: 'Artist' }] } as unknown as SongResult);
const album = (id: number, name = `Album ${id}`): LibraryArtistAlbum => ({ id: `al-${id}`, name });
/** 热门歌曲的条目键（core 的 song:<播放键>）。 */
const songKey = (id: number) => artistSongEntryKey(song(id));
const describe_ = (track: SongResult): TrackDescription => ({
    artists: ['Artist'],
    album: '',
    durationMs: 200_000,
    playbackKey: `p:${track.id}`,
    unavailable: false,
});
const project = (songs: SongResult[], albums: LibraryArtistAlbum[]) => projectArtistItems({
    topSongs: songs,
    albums,
    describeTrack: describe_,
    unknownArtist: '?',
    albumLabel: 'Album',
    trackCountLabel: count => `${count} tracks`,
});
const range = (count: number, from = 0) => Array.from({ length: count }, (_, index) => from + index);
const layer = (
    items: ReturnType<typeof project>,
    mode: BravaisLayer['mode'] = 'infinite',
    wall?: BravaisLayer['wall'],
): BravaisLayer => ({
    key: 'artist',
    sessionKey: 'artist',
    surface: 'artist',
    mode,
    items,
    seam: { title: 'a', crumb: 'a', meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
    wall,
});
const slots = collectWallSlots({ left: -1600, right: 1600, top: -1600, bottom: 1600 }, metrics);
const syncing = (offset: number): LibraryArtistAlbumSync => ({ state: 'syncing', offset });

describe('mixed items', () => {
    it('puts the top songs first and the albums after them, keyed like the browse session', () => {
        const items = project([song(1), song(2)], [album(1), album(2), album(3)]);
        expect(items.map(item => item.key)).toEqual([songKey(1), songKey(2), 'album:al-1', 'album:al-2', 'album:al-3']);
        expect(items.map(item => item.kind)).toEqual(['track', 'track', 'album', 'album', 'album']);
        expect(items[0]).toMatchObject({ badge: '01', badgeIsIndex: true, durationLabel: '3:20', artists: ['Artist'] });
        expect(items[2]).toMatchObject({ badge: 'Album', title: 'Album 1' });
        expect(items[2].badgeIsIndex).toBeUndefined();
    });

    it('writes a known album track count onto the spine and leaves it off otherwise', () => {
        const items = project([song(1)], [{ ...album(1), trackCount: 12 }, album(2), { ...album(3), trackCount: 0 }]);
        expect(items.map(item => item.trackCountLabel)).toEqual([undefined, '12 tracks', undefined, undefined]);
    });

    it('keeps keys unique when the upstream repeats a top song', () => {
        const items = project([song(1), song(1)], [album(1)]);
        expect(items.map(item => item.key)).toEqual([songKey(1), `${songKey(1)}#1`, 'album:al-1']);
    });

    it('the filter narrows only the albums: every top song stays on the wall', () => {
        const albums = [album(1, 'Cedar Lane'), album(2, 'Birch'), album(3, 'cedar heights')];
        const items = project([song(1), song(2), song(3)], filterArtistAlbums(albums, 'cedar'));
        expect(items.map(item => item.key)).toEqual([songKey(1), songKey(2), songKey(3), 'album:al-1', 'album:al-3']);
    });

    it('in the finite tiling (filtering) the top songs take the ranks nearest the seam', () => {
        const items = project(range(10, 1).map(song), range(5, 1).map(id => album(id)));
        const base = createBravaisDisplay(layer(items, 'finite'), null);
        const finite = planBravaisFinite({ count: 140, anchorX: 0, center: { x: 0, y: 0 }, view, reservedPerBlock: 0 });
        const display = { ...base, finite };
        const order = finite.order;
        order.slice(0, 10).forEach(slot => expect(resolveSlotItem(display, slot)?.kind).toBe('track'));
        order.slice(10, 15).forEach(slot => expect(resolveSlotItem(display, slot)?.kind).toBe('album'));
        expect(resolveSlotItem(display, order[15])).toBeNull();
    });
});

describe('album paging period', () => {
    it('uses the detail album total while pages are still coming', () => {
        expect(resolveArtistWallPeriod({ topSongCount: 10, albumCount: 50, albumTotal: 130, albumSync: syncing(50) })).toBe(140);
        // 失败中断、被暂停：周期不变（续页只填空着的位置）。
        expect(resolveArtistWallPeriod({
            topSongCount: 10, albumCount: 50, albumTotal: 130, albumSync: { state: 'interrupted', offset: 50, reason: 'failed' },
        })).toBe(140);
        // 分页结束：回到条目数。
        expect(resolveArtistWallPeriod({ topSongCount: 10, albumCount: 128, albumTotal: 130, albumSync: { state: 'none' } })).toBe(138);
    });

    it('estimates the total in doubling buckets when the detail has none (or too few)', () => {
        expect(resolveArtistWallPeriod({ topSongCount: 10, albumCount: 0, albumTotal: undefined, albumSync: syncing(0) })).toBe(60);
        expect(resolveArtistWallPeriod({ topSongCount: 10, albumCount: 50, albumTotal: undefined, albumSync: syncing(50) })).toBe(110);
        expect(resolveArtistWallPeriod({ topSongCount: 10, albumCount: 100, albumTotal: 40, albumSync: syncing(100) })).toBe(210);
        // 同一档里再来一页，周期不变。
        expect(resolveArtistWallPeriod({ topSongCount: 10, albumCount: 150, albumTotal: undefined, albumSync: syncing(150) })).toBe(210);
    });

    it('a new album page only flips slots that were empty wall; slots with content keep it', () => {
        const songs = range(10, 1).map(song);
        const all = range(130, 1).map(id => album(id));
        const wallFor = (albumCount: number, sync: LibraryArtistAlbumSync) => ({
            periodCount: resolveArtistWallPeriod({ topSongCount: 10, albumCount, albumTotal: 130, albumSync: sync }),
        });
        const first = layer(project(songs, all.slice(0, 50)), 'infinite', wallFor(50, syncing(50)));
        const second = layer(project(songs, all.slice(0, 100)), 'infinite', wallFor(100, syncing(100)));
        const last = layer(project(songs, all), 'infinite', wallFor(130, { state: 'none' }));
        const start = '0,0,3';
        const before = createBravaisDisplay(first, start);
        const middle = createBravaisDisplay(second, start);
        const after = createBravaisDisplay(last, start);
        expect(decideDataUpdate(before, second)).toEqual({ kind: 'update' });

        for (const [from, to] of [[before, middle], [middle, after]] as const) {
            const changes = diffDisplays(from, to, slots).filter(change => change.from !== change.to);
            expect(changes.length).toBeGreaterThan(0);
            // 变了的只有原本空着的 slot。
            expect(changes.every(change => change.from === null)).toBe(true);
        }
        // 起点磁贴始终是第 1 首热门歌曲。
        const startSlot = slots.find(slot => slot.key === start)!;
        expect(resolveSlotItem(after, startSlot)?.key).toBe(songKey(1));
    });
});

describe('status line', () => {
    const labels = {
        loading: 'Loading',
        loadFailed: (error: string) => `Failed: ${error}`,
        empty: 'No content',
        noMatch: 'No matching albums',
        retry: 'Retry',
        clearFilter: 'Clear filter',
        albumsSyncing: (loaded: number, total: number | undefined) => `albums ${loaded}/${total ?? '?'}`,
        albumsInterrupted: (loaded: number) => `albums stopped at ${loaded}`,
    };
    const snapshot = (patch: Partial<Parameters<typeof projectArtistStatus>[0]['snapshot'] & object> = {}) => ({
        status: 'ready' as const,
        error: null,
        detail: { name: 'A' },
        topSongs: [song(1)],
        albums: [album(1)],
        albumSync: { state: 'none' as const },
        ...patch,
    });
    const handlers = { reload: () => {}, retryAlbums: () => {}, clearFilter: () => {} };
    const run = (input: Partial<Parameters<typeof projectArtistStatus>[0]>) => projectArtistStatus(
        { snapshot: snapshot(), albumTotal: undefined, shownAlbumCount: 1, isFilterActive: false, ...input },
        labels,
        handlers,
    );

    it('tells loading, error, empty and no-match apart', () => {
        const loading = run({ snapshot: snapshot({ status: 'loading', detail: null, topSongs: [], albums: [] }) });
        expect(loading.status?.tone).toBe('loading');
        expect(loading.loading).toBe(true);

        const failed = run({ snapshot: snapshot({ status: 'error', error: 'load-failed', detail: null, topSongs: [], albums: [] }) });
        expect(failed.status).toMatchObject({ tone: 'error', text: 'Failed: load-failed', action: { id: 'retry', label: 'Retry' } });
        expect(failed.loading).toBe(false);

        expect(run({ snapshot: snapshot({ detail: null }) }).status?.tone).toBe('empty');
        expect(run({ snapshot: snapshot({ topSongs: [], albums: [] }) }).status?.tone).toBe('empty');

        const noMatch = run({ isFilterActive: true, shownAlbumCount: 0 });
        expect(noMatch.status).toMatchObject({ tone: 'no-match', action: { id: 'clear-filter' } });
        expect(run({}).status).toBeUndefined();
    });

    it('shows album paging progress, and a resume button when a page failed', () => {
        expect(run({ snapshot: snapshot({ albumSync: syncing(50) }), albumTotal: 130 }).sync).toEqual({
            state: 'syncing',
            label: 'albums 1/130',
        });
        const interrupted = run({ snapshot: snapshot({ albumSync: { state: 'interrupted', offset: 50, reason: 'failed' } }) }).sync;
        expect(interrupted).toMatchObject({ state: 'interrupted', label: 'albums stopped at 1 · Retry', onResume: handlers.retryAlbums });
        // 被暂停（离开过）按进行中处理。
        expect(run({ snapshot: snapshot({ albumSync: { state: 'interrupted', offset: 50, reason: 'paused' } }) }).sync?.state).toBe('syncing');
    });
});
