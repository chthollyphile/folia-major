// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import {
    canOpenPlaylistPickerFor,
    readLastAddToPlaylistPane,
    readLastFoliaPlaylistId,
    rememberAddToPlaylistPane,
    rememberLastFoliaPlaylistId,
    useAddToPlaylistStore,
} from '@/stores/useAddToPlaylistStore';

// test/unit/stores/addToPlaylistStore.test.ts
// 「收藏到歌单」能不能打开：收藏框的 Folia 栏收任何来源的歌，所以有来源的歌都能开，只有舞台歌不行。
// 以及选择器的开合带不带歌、带不带「谁要的」，和两次打开之间记住的两样东西（上次那一栏、上次那张 Folia 歌单）。

const local = { id: 'l1', name: 'L', isLocal: true, localRef: { songId: 'l1' } } as unknown as SongResult;
const navidrome = { id: 'n1', name: 'N', isNavidrome: true, navidromeData: { id: 'n1' } } as unknown as SongResult;
const online = { id: 7, name: 'O', ar: [], al: { name: '' }, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '7' } } as unknown as SongResult;
const stage = { id: 9, name: 'S', ar: [], al: { name: '' }, isStage: true, sourceRef: { kind: 'stage', mediaId: '9' } } as unknown as SongResult;

describe('canOpenPlaylistPickerFor', () => {
    it('takes a song of any source', () => {
        expect(canOpenPlaylistPickerFor(local)).toBe(true);
        expect(canOpenPlaylistPickerFor(navidrome)).toBe(true);
        expect(canOpenPlaylistPickerFor(online)).toBe(true);
    });

    it('refuses a stage song, which belongs to no source', () => {
        expect(canOpenPlaylistPickerFor(stage)).toBe(false);
    });
});

describe('useAddToPlaylistStore', () => {
    it('opens for the given songs, or for the shown song when given none, and forgets them on close', () => {
        const store = useAddToPlaylistStore.getState();
        store.open([local, navidrome]);
        expect(useAddToPlaylistStore.getState()).toMatchObject({ isOpen: true, songs: [local, navidrome], origin: null });
        store.close();
        expect(useAddToPlaylistStore.getState()).toMatchObject({ isOpen: false, songs: null });
        store.open([]);
        expect(useAddToPlaylistStore.getState().songs).toBeNull();
        store.close();
    });

    it('keeps who asked while it is open, and only with songs of its own', () => {
        const store = useAddToPlaylistStore.getState();
        store.open([local, online], 'scratchpad');
        expect(useAddToPlaylistStore.getState().origin).toBe('scratchpad');
        store.close();
        expect(useAddToPlaylistStore.getState().origin).toBeNull();
        store.open([], 'scratchpad');
        expect(useAddToPlaylistStore.getState().origin).toBeNull();
        store.close();
    });
});

describe('what the picker remembers', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('starts on the Folia pane and with no playlist', () => {
        expect(readLastAddToPlaylistPane()).toBe('folia');
        expect(readLastFoliaPlaylistId()).toBeNull();
    });

    it('remembers the pane and the Folia playlist used last', () => {
        rememberAddToPlaylistPane('source');
        rememberLastFoliaPlaylistId('playlist-1');
        expect(readLastAddToPlaylistPane()).toBe('source');
        expect(readLastFoliaPlaylistId()).toBe('playlist-1');
        rememberAddToPlaylistPane('folia');
        expect(readLastAddToPlaylistPane()).toBe('folia');
    });

    it('reads a value it does not know as the Folia pane', () => {
        localStorage.setItem('add_to_playlist_last_pane', 'elsewhere');
        expect(readLastAddToPlaylistPane()).toBe('folia');
    });
});
