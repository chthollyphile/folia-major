import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { LocalPlaylist, LocalSong } from '@/types';
import type { ProviderCollection } from '@/types/onlineMusic';
import { buildOnlinePlaylistCards, buildOnlineRadioCards } from '@/library/core/home/homeCards';
import { buildLocalHomeCards, buildLocalHomeGroups } from '@/library/core/home/localHomeModel';
import { buildNavidromeSectionCards, EMPTY_NAVIDROME_HOME_DATA } from '@/library/core/home/navidrome/navidromeHomeModel';
import { resolveLibraryHomeSpecial } from '@/library/core/home/homeSpecialCards';

// test/unit/library/core/homeSpecialCards.test.ts
// 首页特殊集合的判定：只看身份字段（id、type、isVirtual、来源对象的 isLiked），不看显示名；来源不同时同样的字段含义不同。

const t = ((key: string) => `t:${key}`) as unknown as TFunction;

const collection = (patch: Partial<ProviderCollection>): ProviderCollection => ({
    providerId: 'p',
    id: 'c1',
    name: 'Collection',
    type: 'playlist',
    ...patch,
});

const song = (id: string, folderName: string): LocalSong => ({
    id,
    fileName: `${id}.mp3`,
    filePath: `${folderName}/${id}.mp3`,
    folderName,
    addedAt: 1,
    importedMetadata: { title: id, artistNames: ['A'], albumName: 'Al' },
} as unknown as LocalSong);

describe('home special cards', () => {
    it('online: liked, cloud, personal FM and daily recommendations, by identity not by name', () => {
        const playlists = buildOnlinePlaylistCards([
            collection({ id: 'liked', name: 'Anything at all', isLiked: true }),
            collection({ id: 'cloud', type: 'cloud' }),
            collection({ id: 'plain', name: '我喜欢的音乐' }),
        ], t);
        expect(playlists.map(card => resolveLibraryHomeSpecial(card, 'online'))).toEqual(['liked', 'cloud', null]);
        const radio = buildOnlineRadioCards({ dailyCoverUrl: '', dailyCount: 3, recommended: [collection({ id: 'rec' })] }, { t });
        expect(radio.map(card => resolveLibraryHomeSpecial(card, 'online'))).toEqual(['personal-fm', 'daily', null]);
        // 收藏专辑上的 isLiked 不是「我喜欢的音乐」。
        expect(resolveLibraryHomeSpecial({ id: 'al', type: 'album', raw: { isLiked: true } }, 'online')).toBeNull();
    });

    it('local: All Songs and the favourite playlist; the unknown album / artist buckets are not special', () => {
        const songs = [song('s1', 'F1'), song('s2', 'F2')];
        const playlists: LocalPlaylist[] = [
            { id: 'fav', name: 'Liked', songIds: ['s1'], isFavorite: true, createdAt: 1, updatedAt: 1 } as LocalPlaylist,
            { id: 'mix', name: 'Mix', songIds: ['s2'], createdAt: 1, updatedAt: 1 } as LocalPlaylist,
        ];
        const groups = buildLocalHomeGroups(songs, playlists, t, { entities: [], assignments: [] }, () => null);
        const special = (list: typeof groups.folders) => buildLocalHomeCards(list).map(card => resolveLibraryHomeSpecial(card, 'local'));
        expect(special(groups.folders)).toEqual(['all-songs', null, null]);
        expect(special(groups.playlists)).toEqual(['local-favorites', null]);
        expect(special(groups.albums).every(kind => kind === null)).toBe(true);
        expect(special(groups.artists).every(kind => kind === null)).toBe(true);
    });

    it('navidrome: the random and favourites playlists; the same fields mean nothing for another source', () => {
        const cards = buildNavidromeSectionCards('playlists', EMPTY_NAVIDROME_HOME_DATA, { t, coverArtUrl: id => id });
        expect(cards.map(card => resolveLibraryHomeSpecial(card, 'navidrome'))).toEqual(['navidrome-random', 'navidrome-favorites']);
        // 同样是 isVirtual 的歌单：本地来源里是「我喜欢」，Navidrome 来源里按 id 认。
        expect(resolveLibraryHomeSpecial({ id: 'playlist-x', type: 'playlist', isVirtual: true }, 'navidrome')).toBeNull();
        expect(resolveLibraryHomeSpecial(cards[0], 'local')).toBe('local-favorites');
        expect(resolveLibraryHomeSpecial(cards[0], 'online')).toBeNull();
    });
});
