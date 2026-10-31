import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/stores/addToPlaylistStore.test.ts
// 「收藏到歌单」能不能打开：本地、Navidrome 总能（可以当场建歌单）；在线歌要平台能改歌单或能点红心。
// 以及选择器的开合带不带歌。

const omniMock = vi.hoisted(() => ({
    canAddSongToPlaylist: vi.fn(() => false),
    canLikeSong: vi.fn(() => false),
}));
vi.mock('@/services/onlineMusic/omni', () => ({ omni: omniMock }));

import { canOpenPlaylistPickerFor, useAddToPlaylistStore } from '@/stores/useAddToPlaylistStore';

const local = { id: 'l1', name: 'L', isLocal: true, localRef: { songId: 'l1' } } as unknown as SongResult;
const navidrome = { id: 'n1', name: 'N', isNavidrome: true, navidromeData: { id: 'n1' } } as unknown as SongResult;
const online = { id: 7, name: 'O', ar: [], al: { name: '' }, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '7' } } as unknown as SongResult;

describe('canOpenPlaylistPickerFor', () => {
    beforeEach(() => {
        omniMock.canAddSongToPlaylist.mockReturnValue(false);
        omniMock.canLikeSong.mockReturnValue(false);
    });

    it('always takes local and Navidrome songs', () => {
        expect(canOpenPlaylistPickerFor(local)).toBe(true);
        expect(canOpenPlaylistPickerFor(navidrome)).toBe(true);
    });

    it('takes an online song whose platform edits playlists or takes likes, and refuses one that does neither', () => {
        expect(canOpenPlaylistPickerFor(online)).toBe(false);
        omniMock.canLikeSong.mockReturnValue(true);
        expect(canOpenPlaylistPickerFor(online)).toBe(true);
        omniMock.canLikeSong.mockReturnValue(false);
        omniMock.canAddSongToPlaylist.mockReturnValue(true);
        expect(canOpenPlaylistPickerFor(online)).toBe(true);
    });
});

describe('useAddToPlaylistStore', () => {
    it('opens for the given songs, or for the shown song when given none, and forgets them on close', () => {
        const store = useAddToPlaylistStore.getState();
        store.open([local, navidrome]);
        expect(useAddToPlaylistStore.getState()).toMatchObject({ isOpen: true, songs: [local, navidrome] });
        store.close();
        expect(useAddToPlaylistStore.getState()).toMatchObject({ isOpen: false, songs: null });
        store.open([]);
        expect(useAddToPlaylistStore.getState().songs).toBeNull();
        store.close();
    });
});
