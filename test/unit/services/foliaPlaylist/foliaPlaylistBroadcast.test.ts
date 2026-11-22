import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    FOLIA_PLAYLISTS_CHANNEL,
    resetFoliaPlaylistsBroadcast,
    type FoliaBroadcastChannelLike,
} from '@/services/foliaPlaylist/foliaPlaylistBroadcast';
import { FoliaPlaylistsDatabase } from '@/services/foliaPlaylist/foliaPlaylistDatabase';
import {
    addSongsToFoliaPlaylist,
    createFoliaPlaylist,
    getFoliaPlaylist,
    getFoliaPlaylistSummaries,
    resetFoliaPlaylistStorage,
    subscribeFoliaPlaylists,
    toggleFoliaSongFavorite,
    type FoliaPlaylistsChange,
} from '@/services/foliaPlaylist/foliaPlaylistService';
import { useFoliaPlaylistsStore } from '@/stores/useFoliaPlaylistsStore';
import type { SongResult } from '@/types';

// test/unit/services/foliaPlaylist/foliaPlaylistBroadcast.test.ts
// 歌单的改动在窗口之间怎么传：写完往频道上说一声（只有 id）、别的窗口的话传到本窗口的订阅者、自己的话不处理、
// 连发合并、看不懂的话当成「都变了」、听到话只读不写（两个窗口不会互相触发）、读到一半传来的改动不丢。
// 「另一个窗口」= 假频道上的另一个端点 + 歌单库的第二条连接（它写的东西不经这个窗口的服务层，所以没人替它叫一声）。

/** 内存里的 BroadcastChannel：同名的端点互相收得到，发话的那个自己收不到，投递是异步的。 */
class FakeChannel implements FoliaBroadcastChannelLike {
    static endpoints = new Set<FakeChannel>();
    onmessage: ((event: { data: unknown }) => void) | null = null;
    posted: unknown[] = [];
    constructor(readonly name: string) {
        FakeChannel.endpoints.add(this);
    }
    postMessage(message: unknown): void {
        const data = structuredClone(message);
        this.posted.push(data);
        for (const other of FakeChannel.endpoints) {
            if (other === this || other.name !== this.name) continue;
            queueMicrotask(() => other.onmessage?.({ data: structuredClone(data) }));
        }
    }
    close(): void {
        FakeChannel.endpoints.delete(this);
    }
}

const song = (id: number, name = `song ${id}`): SongResult => ({
    id,
    name,
    artists: [{ id: 1, name: 'Singer' }],
    album: { id: 2, name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
} as SongResult);

/** 另一个窗口：频道上的另一个端点，和歌单库的另一条连接。 */
let otherWindow: FakeChannel;
let otherConnection: FoliaPlaylistsDatabase;
/** 这个窗口的端点（服务层开的那个）。 */
const ownEndpoint = (): FakeChannel => [...FakeChannel.endpoints].find(endpoint => endpoint !== otherWindow) as FakeChannel;
const say = (message: unknown) => otherWindow.postMessage(message);
/** 另一个窗口往一张歌单里加一首（直接写库，不经这个窗口的服务层），返回它该说的那句话。 */
const writeFromOtherWindow = async (playlistId: string, added: SongResult) => {
    await otherConnection.transaction('rw', otherConnection.playlists, otherConnection.entries, async () => {
        const row = await otherConnection.playlists.get(playlistId);
        if (!row) throw new Error('no such playlist');
        const last = await otherConnection.entries.where('[playlistId+pos]').between([playlistId, -Infinity], [playlistId, Infinity]).last();
        const key = `online:netease:${String(added.id)}`;
        await otherConnection.entries.put({ playlistId, key, pos: (last?.pos ?? 0) + 1024, song: added, addedAt: 5 });
        await otherConnection.playlists.put({ ...row, entryCount: row.entryCount + 1, updatedAt: row.updatedAt + 1 });
    });
    return { v: 1, from: 'other-window', playlistIds: [playlistId], list: false };
};

describe('foliaPlaylistBroadcast', () => {
    let changes: FoliaPlaylistsChange[];
    let unsubscribe: () => void = () => {};

    beforeEach(async () => {
        unsubscribe();
        otherConnection?.close();
        FakeChannel.endpoints.clear();
        await resetFoliaPlaylistStorage();
        resetFoliaPlaylistsBroadcast(name => new FakeChannel(name));
        otherWindow = new FakeChannel(FOLIA_PLAYLISTS_CHANNEL);
        otherConnection = new FoliaPlaylistsDatabase();
        changes = [];
        unsubscribe = subscribeFoliaPlaylists(change => changes.push(change));
        await useFoliaPlaylistsStore.getState().refresh();
        changes.length = 0;
        ownEndpoint().posted.length = 0;
    });

    afterAll(() => {
        unsubscribe();
        otherConnection.close();
        resetFoliaPlaylistsBroadcast(null);
    });

    it('says which playlists changed after a write, and nothing about their contents', async () => {
        const heard: unknown[] = [];
        otherWindow.onmessage = event => heard.push(event.data);
        const playlist = await createFoliaPlaylist('Mix', [song(1, 'A secret title')]);
        await vi.waitFor(() => expect(heard).toHaveLength(1));
        const message = heard[0] as Record<string, unknown>;
        expect(Object.keys(message).sort()).toEqual(['from', 'list', 'playlistIds', 'v']);
        expect(message).toMatchObject({ v: 1, playlistIds: [playlist.id], list: true });
        expect(JSON.stringify(message)).not.toContain('secret');

        await addSongsToFoliaPlaylist(playlist.id, [song(2)]);
        await vi.waitFor(() => expect(heard).toHaveLength(2));
        expect(heard[1]).toMatchObject({ playlistIds: [playlist.id], list: false });
        // 什么都没改的写不发话。
        await addSongsToFoliaPlaylist(playlist.id, [song(2)]);
        await new Promise(resolve => setTimeout(resolve, 80));
        expect(heard).toHaveLength(2);
    });

    it('passes a write from another window to this window, which then reads the new rows', async () => {
        const playlist = await createFoliaPlaylist('Mix', [song(1)]);
        await vi.waitFor(() => expect(useFoliaPlaylistsStore.getState().playlists.find(item => item.id === playlist.id)?.entryCount).toBe(1));
        changes.length = 0;

        say(await writeFromOtherWindow(playlist.id, song(2)));
        await vi.waitFor(() => expect(changes).toHaveLength(1));
        expect(changes[0]).toEqual({ playlistIds: [playlist.id], list: false, remote: true });
        expect((await getFoliaPlaylist(playlist.id))?.entries.map(entry => entry.key)).toEqual(['online:netease:1', 'online:netease:2']);
        // 常驻的摘要跟着变了。
        await vi.waitFor(() => expect(useFoliaPlaylistsStore.getState().playlists.find(item => item.id === playlist.id)?.entryCount).toBe(2));
    });

    it('rereads the heart state when another window names the favorites, even with the summary unchanged', async () => {
        const favorite = (await getFoliaPlaylistSummaries()).find(item => item.isFavorite);
        if (!favorite) throw new Error('no favorites playlist');
        // 只动条目、不动摘要：靠「摘要变了」的兜底看不出来，只有点名才会重读红心。
        await otherConnection.entries.put({ playlistId: favorite.id, key: 'online:netease:7', pos: 1024, song: song(7), addedAt: 5 });
        say({ v: 1, from: 'other-window', playlistIds: [favorite.id], list: false });
        await vi.waitFor(() => expect(useFoliaPlaylistsStore.getState().favoriteKeys.has('online:netease:7')).toBe(true));
        // 说「都变了」也一样。
        await otherConnection.entries.put({ playlistId: favorite.id, key: 'online:netease:8', pos: 2048, song: song(8), addedAt: 5 });
        say({ v: 1, from: 'other-window', all: true });
        await vi.waitFor(() => expect(useFoliaPlaylistsStore.getState().favoriteKeys.has('online:netease:8')).toBe(true));
    });

    it('ignores what it said itself', async () => {
        const heard: Array<{ from: string }> = [];
        otherWindow.onmessage = event => heard.push(event.data as { from: string });
        const playlist = await createFoliaPlaylist('Mix');
        await vi.waitFor(() => expect(heard).toHaveLength(1));
        await new Promise(resolve => setTimeout(resolve, 80));
        changes.length = 0;
        // 带着这个窗口自己的记号的话（模块被装了两份时会这样收到）。
        say({ v: 1, from: heard[0].from, playlistIds: [playlist.id], list: false });
        await new Promise(resolve => setTimeout(resolve, 120));
        expect(changes).toEqual([]);
    });

    it('merges a burst into one change', async () => {
        for (const id of ['a', 'b', 'a', 'c']) say({ v: 1, from: 'other-window', playlistIds: [id], list: id === 'b' });
        await vi.waitFor(() => expect(changes).toHaveLength(1));
        await new Promise(resolve => setTimeout(resolve, 120));
        expect(changes).toEqual([{ playlistIds: ['a', 'b', 'c'], list: true, remote: true }]);
    });

    it('stops naming playlists once a burst names too many', async () => {
        for (let batch = 0; batch < 3; batch += 1) {
            say({ v: 1, from: 'other-window', playlistIds: Array.from({ length: 100 }, (_, index) => `p${batch}-${index}`), list: false });
        }
        await vi.waitFor(() => expect(changes).toHaveLength(1));
        expect(changes[0]).toEqual({ playlistIds: [], list: true, remote: true, all: true });
    });

    it('treats what it cannot read as "anything may have changed"', async () => {
        const unreadable: unknown[] = [
            null,
            'changed',
            { v: 2, from: 'other-window', playlistIds: ['a'] },
            { v: 1, from: 'other-window', playlistIds: 'a' },
            { v: 1, from: 'other-window', playlistIds: [1] },
            { v: 1, from: 'other-window', playlistIds: ['x'.repeat(200)] },
            { v: 1, from: 'other-window', playlistIds: Array.from({ length: 300 }, (_, index) => `p${index}`) },
            { v: 1, from: 'other-window', all: true },
        ];
        for (const message of unreadable) {
            changes.length = 0;
            say(message);
            await vi.waitFor(() => expect(changes).toHaveLength(1));
            expect(changes[0]).toEqual({ playlistIds: [], list: true, remote: true, all: true });
        }
    });

    it('only reads when it hears a change: nothing goes back onto the channel', async () => {
        const playlist = await createFoliaPlaylist('Mix', [song(1)]);
        await toggleFoliaSongFavorite(song(1));
        await new Promise(resolve => setTimeout(resolve, 120));
        const own = ownEndpoint();
        own.posted.length = 0;
        const heard: unknown[] = [];
        otherWindow.onmessage = event => heard.push(event.data);

        say(await writeFromOtherWindow(playlist.id, song(2)));
        say({ v: 1, from: 'other-window', all: true });
        await vi.waitFor(() => expect(useFoliaPlaylistsStore.getState().playlists.find(item => item.id === playlist.id)?.entryCount).toBe(2));
        await new Promise(resolve => setTimeout(resolve, 200));
        expect(own.posted).toEqual([]);
        expect(heard).toEqual([]);
    });

    // 这一条不保证话正好落在读的中间（话要攒 40 毫秒才交出去）；它保的是连着两次写、两句话之后最后读到的是全的。
    it('ends up with everything after two writes in a row from another window during a reread', async () => {
        const playlist = await createFoliaPlaylist('Mix', [song(1)]);
        await vi.waitFor(() => expect(useFoliaPlaylistsStore.getState().playlists.find(item => item.id === playlist.id)?.entryCount).toBe(1));
        // 一边重读（要读曲库，慢一点），一边另一个窗口连着写两次、说两次。
        const reading = useFoliaPlaylistsStore.getState().refresh();
        say(await writeFromOtherWindow(playlist.id, song(2)));
        say(await writeFromOtherWindow(playlist.id, song(3)));
        await reading;
        await vi.waitFor(() => expect(useFoliaPlaylistsStore.getState().playlists.find(item => item.id === playlist.id)?.entryCount).toBe(3));
    });

    it('keeps writing when the channel cannot be opened or throws', async () => {
        resetFoliaPlaylistsBroadcast(() => {
            throw new Error('no channels here');
        });
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(createFoliaPlaylist('Still works')).resolves.toMatchObject({ name: 'Still works' });
        resetFoliaPlaylistsBroadcast(() => ({
            onmessage: null,
            close: () => {},
            postMessage: () => {
                throw new Error('closed');
            },
        }));
        await expect(createFoliaPlaylist('Still works too')).resolves.toMatchObject({ name: 'Still works too' });
        warn.mockRestore();
    });
});
