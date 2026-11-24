import { describe, expect, it } from 'vitest';
import {
    buildFoliaTransferEntries,
    getFoliaEntryOriginKey,
    refreshFoliaPlaylistEntries,
    toFoliaCounterparts,
} from '@/utils/foliaPlaylistTransfer';
import { appendFoliaPlaylistEntries } from '@/utils/foliaPlaylistEntries';
import type { SongResult } from '@/types';
import type { FoliaPlaylistEntry } from '@/types/foliaPlaylist';

// test/unit/utils/foliaPlaylistTransfer.test.ts
// 转存与「从原歌单刷新」的纯规则：换音源、原歌单增删与重排、用户自己加的条目、重复。

const online = (providerId: string, id: string, name = `s${id}`): SongResult => ({
    id,
    name,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId, mediaId: id },
} as SongResult);
const stage = (): SongResult => ({ ...online('netease', 'x'), sourceRef: { kind: 'stage', mediaId: 'x' } } as SongResult);
const lx = (id: string) => online('lxmusic', `wy:${id}`);
const keys = (entries: readonly FoliaPlaylistEntry[]) => entries.map(entry => entry.key);
/** 目标音源对这些 id 的歌有对应的。 */
const counterpartsFor = (songs: readonly SongResult[], ids: readonly string[]) => toFoliaCounterparts(
    songs,
    songs.map(song => (ids.includes(String(song.id)) ? lx(String(song.id)) : null)),
);

describe('toFoliaCounterparts', () => {
    it('keys the answers by the origin song, and ignores an answer that is the same song', () => {
        const songs = [online('netease', '1'), online('netease', '2'), online('netease', '3')];
        const map = toFoliaCounterparts(songs, [lx('1'), null, online('netease', '3')]);
        expect([...map.keys()]).toEqual(['online:netease:1']);
        expect(map.get('online:netease:1')?.id).toBe('wy:1');
    });
});

describe('buildFoliaTransferEntries', () => {
    const songs = [online('netease', '1'), online('netease', '2'), online('netease', '3')];

    it('keeps every song as it is without a target', () => {
        const { entries, counts } = buildFoliaTransferEntries(songs, new Map(), 5);
        expect(keys(entries)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3']);
        expect(entries.every(entry => entry.fromOrigin === true && entry.originalKey === undefined && entry.addedAt === 5)).toBe(true);
        expect(counts).toEqual({ swapped: 0, notSwapped: 3, duplicates: 0, rejected: 0 });
    });

    it('swaps every song that has a counterpart and records what it was', () => {
        const { entries, counts } = buildFoliaTransferEntries(songs, counterpartsFor(songs, ['1', '2', '3']));
        expect(keys(entries)).toEqual(['online:lxmusic:wy:1', 'online:lxmusic:wy:2', 'online:lxmusic:wy:3']);
        expect(entries.map(getFoliaEntryOriginKey)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3']);
        expect(entries[0].song.id).toBe('wy:1');
        expect(counts).toEqual({ swapped: 3, notSwapped: 0, duplicates: 0, rejected: 0 });
    });

    it('swaps only the songs that have one, in the origin order', () => {
        const { entries, counts } = buildFoliaTransferEntries(songs, counterpartsFor(songs, ['2']));
        expect(keys(entries)).toEqual(['online:netease:1', 'online:lxmusic:wy:2', 'online:netease:3']);
        expect(entries.map(entry => entry.originalKey)).toEqual([undefined, 'online:netease:2', undefined]);
        expect(counts).toEqual({ swapped: 1, notSwapped: 2, duplicates: 0, rejected: 0 });
    });

    it('drops duplicates and stage songs, and never lets two entries share a key', () => {
        const withExtras = [...songs, online('netease', '1'), stage(), lx('2')];
        // 第 2 首换成 wy:2，后面又有一首本来就是 wy:2 的：后来的那首是重复。
        const { entries, counts } = buildFoliaTransferEntries(withExtras, counterpartsFor(songs, ['2']));
        expect(keys(entries)).toEqual(['online:netease:1', 'online:lxmusic:wy:2', 'online:netease:3']);
        expect(counts).toEqual({ swapped: 1, notSwapped: 2, duplicates: 2, rejected: 1 });

        // 反过来：本来就是 wy:2 的在前，后面那首想换成它的不换，照原样留。
        const reversed = [lx('2'), online('netease', '2')];
        const second = buildFoliaTransferEntries(reversed, counterpartsFor(reversed, ['2']));
        expect(keys(second.entries)).toEqual(['online:lxmusic:wy:2', 'online:netease:2']);
        expect(second.counts).toEqual({ swapped: 0, notSwapped: 2, duplicates: 0, rejected: 0 });
    });
});

describe('refreshFoliaPlaylistEntries', () => {
    const origin = [online('netease', '1'), online('netease', '2'), online('netease', '3')];
    const saved = () => buildFoliaTransferEntries(origin, new Map(), 1).entries;
    const manual = (song: SongResult, into: readonly FoliaPlaylistEntry[]) => appendFoliaPlaylistEntries(into, [song], 2).entries;

    it('changes nothing when the origin is the same', () => {
        const entries = saved();
        const refreshed = refreshFoliaPlaylistEntries(entries, origin);
        expect(refreshed.changed).toBe(false);
        expect(refreshed.entries).toBe(entries);
        expect(refreshed.counts).toEqual({ added: 0, swapped: 0, detached: 0, duplicates: 0, rejected: 0 });
    });

    it('adds the new songs of the origin, in the origin order', () => {
        const entries = manual(online('qq', 'm'), saved());
        const refreshed = refreshFoliaPlaylistEntries(entries, [...origin, online('netease', '4')], new Map(), 9);
        expect(keys(refreshed.entries)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3', 'online:qq:m', 'online:netease:4']);
        expect(refreshed.entries[4]).toMatchObject({ addedAt: 9, fromOrigin: true });
        expect(refreshed.counts).toMatchObject({ added: 1, detached: 0 });

        // 新歌在原歌单的最前面：原歌单的歌整体按原歌单的顺序排，先填原来那三个位置，用户的那条不动。
        const front = refreshFoliaPlaylistEntries(entries, [online('netease', '0'), ...origin], new Map(), 9);
        expect(keys(front.entries)).toEqual(['online:netease:0', 'online:netease:1', 'online:netease:2', 'online:qq:m', 'online:netease:3']);
        expect(front.entries[3]).toBe(entries[3]);
    });

    it('follows the origin order exactly when the playlist has only origin songs', () => {
        const next = [online('netease', '4'), online('netease', '3'), online('netease', '1'), online('netease', '2')];
        const refreshed = refreshFoliaPlaylistEntries(saved(), next);
        expect(keys(refreshed.entries)).toEqual(['online:netease:4', 'online:netease:3', 'online:netease:1', 'online:netease:2']);
        // 再刷新一次（原歌单没再变）：什么都不动。
        expect(refreshFoliaPlaylistEntries(refreshed.entries, next).changed).toBe(false);
    });

    it('keeps the user’s own entries where they are while origin songs are reordered around them', () => {
        // 歌单：1, [用户的 a], 2, 3, [用户的 b]
        let entries = saved();
        entries = [entries[0], ...manual(online('qq', 'a'), []), entries[1], entries[2], ...manual(online('qq', 'b'), [])];
        const refreshed = refreshFoliaPlaylistEntries(entries, [origin[2], origin[1], origin[0]]);
        expect(keys(refreshed.entries)).toEqual(['online:netease:3', 'online:qq:a', 'online:netease:2', 'online:netease:1', 'online:qq:b']);
        expect(refreshed.entries[1]).toBe(entries[1]);
        expect(refreshed.entries[4]).toBe(entries[4]);
        expect(refreshed.entries[1].fromOrigin).toBeUndefined();
    });

    it('keeps songs the origin no longer has, as the user’s own from then on', () => {
        const entries = manual(online('qq', 'm'), saved());
        const refreshed = refreshFoliaPlaylistEntries(entries, [origin[0], origin[2]]);
        expect(keys(refreshed.entries)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3', 'online:qq:m']);
        expect(refreshed.entries.map(entry => entry.fromOrigin)).toEqual([true, undefined, true, undefined]);
        expect(refreshed.counts).toMatchObject({ added: 0, detached: 1 });
        // 下一次刷新不再把它当成「原歌单里没有了」。
        expect(refreshFoliaPlaylistEntries(refreshed.entries, [origin[0], origin[2]]).counts.detached).toBe(0);
        // 它回到原歌单时又认回来，不会多出一条。
        const back = refreshFoliaPlaylistEntries(refreshed.entries, origin);
        expect(keys(back.entries)).toEqual(keys(refreshed.entries));
        expect(back.entries[1].fromOrigin).toBe(true);
        expect(back.counts.added).toBe(0);
    });

    it('never drops an entry, whatever the origin answers', () => {
        const entries = manual(online('qq', 'm'), saved());
        const refreshed = refreshFoliaPlaylistEntries(entries, [online('netease', '9')]);
        expect(keys(refreshed.entries)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3', 'online:qq:m', 'online:netease:9']);
        expect(refreshed.counts).toMatchObject({ added: 1, detached: 3 });
    });

    it('swaps new songs and the ones not swapped yet when the target has them', () => {
        const next = [...origin, online('netease', '4'), online('netease', '5')];
        const refreshed = refreshFoliaPlaylistEntries(saved(), next, counterpartsFor(next, ['2', '4']), 9);
        expect(keys(refreshed.entries)).toEqual([
            'online:netease:1', 'online:lxmusic:wy:2', 'online:netease:3', 'online:lxmusic:wy:4', 'online:netease:5',
        ]);
        expect(refreshed.entries[1]).toMatchObject({ originalKey: 'online:netease:2', addedAt: 1, fromOrigin: true });
        expect(refreshed.entries[3]).toMatchObject({ originalKey: 'online:netease:4', addedAt: 9 });
        expect(refreshed.counts).toMatchObject({ added: 2, swapped: 2 });
    });

    it('leaves swapped entries swapped when the target cannot be asked', () => {
        const swapped = buildFoliaTransferEntries(origin, counterpartsFor(origin, ['1', '2', '3']), 1).entries;
        const refreshed = refreshFoliaPlaylistEntries(swapped, [...origin, online('netease', '4')]);
        expect(keys(refreshed.entries)).toEqual(['online:lxmusic:wy:1', 'online:lxmusic:wy:2', 'online:lxmusic:wy:3', 'online:netease:4']);
        expect(refreshed.counts).toMatchObject({ added: 1, swapped: 0, detached: 0 });
    });

    it('does not add an origin song twice, nor a song the user already added', () => {
        // 用户自己加过原歌单里后来才有的 4，也自己加过 5 在目标音源的那首。
        let entries = manual(online('netease', '4'), saved());
        entries = manual(lx('5'), entries);
        const next = [...origin, online('netease', '4'), online('netease', '4'), online('netease', '5'), stage()];
        const refreshed = refreshFoliaPlaylistEntries(entries, next, counterpartsFor(next, ['5']));
        expect(keys(refreshed.entries)).toEqual([
            'online:netease:1', 'online:netease:2', 'online:netease:3', 'online:netease:4', 'online:lxmusic:wy:5',
        ]);
        // 两条都被原歌单认下了：以后跟着原歌单排，原歌是哪首也记下了。
        expect(refreshed.entries[3].fromOrigin).toBe(true);
        expect(refreshed.entries[4]).toMatchObject({ fromOrigin: true, originalKey: 'online:netease:5' });
        expect(refreshed.counts).toEqual({ added: 0, swapped: 0, detached: 0, duplicates: 0, rejected: 1 });
        // 目标音源之后问不了：也不会把没换的那首再加一条。
        const later = refreshFoliaPlaylistEntries(refreshed.entries, next);
        expect(keys(later.entries)).toEqual(keys(refreshed.entries));
    });

    it('does not swap or move an entry the user added, even when the origin has the same song', () => {
        // 歌单：3、2、1（跟着原歌单的），用户的 m，用户自己加的 4；原歌单后来有了 4，排在最前，目标音源也有它。
        const [one, two, three] = saved();
        const entries = manual(online('netease', '4'), manual(online('qq', 'm'), [three, two, one]));
        const next = [online('netease', '4'), ...origin];
        const refreshed = refreshFoliaPlaylistEntries(entries, next, counterpartsFor(next, ['4']));
        expect(keys(refreshed.entries)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3', 'online:qq:m', 'online:netease:4']);
        expect(refreshed.entries[4]).toMatchObject({ key: 'online:netease:4', addedAt: 2, fromOrigin: true });
        expect(refreshed.entries[4].originalKey).toBeUndefined();
        expect(refreshed.counts).toEqual({ added: 0, swapped: 0, detached: 0, duplicates: 0, rejected: 0 });
    });

    it('does not swap into a key the playlist already has', () => {
        // 歌单里有原歌 2，用户又自己加了 wy:2；换过去会撞上，所以不换。
        const entries = manual(lx('2'), saved());
        const refreshed = refreshFoliaPlaylistEntries(entries, origin, counterpartsFor(origin, ['2']));
        expect(keys(refreshed.entries)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3', 'online:lxmusic:wy:2']);
        expect(refreshed.counts.swapped).toBe(0);
        expect(new Set(keys(refreshed.entries)).size).toBe(refreshed.entries.length);
    });

    it('adopts the entries of a playlist saved before entries were marked', () => {
        // 旧的转存（第 1 步的 create(name, songs, { origin })）：条目上没有 fromOrigin。
        const old = appendFoliaPlaylistEntries([], [...origin, online('qq', 'm')], 1).entries;
        const next = [origin[1], origin[0], online('netease', '4')];
        const refreshed = refreshFoliaPlaylistEntries(old, next, counterpartsFor(next, ['1']));
        // 第一次只认下来：不挪位置、不换音源。
        expect(keys(refreshed.entries)).toEqual(['online:netease:1', 'online:netease:2', 'online:netease:3', 'online:qq:m', 'online:netease:4']);
        expect(refreshed.counts.swapped).toBe(0);
        // 第二次起跟着原歌单：按它的顺序排，能换的换。
        const second = refreshFoliaPlaylistEntries(refreshed.entries, next, counterpartsFor(next, ['1']));
        expect(keys(second.entries)).toEqual(['online:netease:2', 'online:lxmusic:wy:1', 'online:netease:3', 'online:qq:m', 'online:netease:4']);
        // 原歌单里没有的 3 和用户的那条都没有标记，也都没被算成「原歌单里没有了」。
        expect(refreshed.entries.map(entry => entry.fromOrigin)).toEqual([true, true, undefined, undefined, true]);
        expect(refreshed.counts).toMatchObject({ added: 1, detached: 0 });
    });
});
