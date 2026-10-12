import type { LibraryHomeCard } from '../contracts/homeModel';
import { DAILY_RECOMMENDATIONS_CARD_ID, isHeartbeatCard, isPersonalFmCard } from './homeCards';
import { LOCAL_ALL_SONGS_ID } from './localHomeModel';
import { NAVIDROME_FAVORITES_PLAYLIST_ID, NAVIDROME_RANDOM_PLAYLIST_ID } from './navidromeHomeModel';

// src/library/core/model/homeSpecialCards.ts
// 首页卡片里的「特殊集合」：平台或曲库自带、不是用户自建也不是普通条目的那几张（我喜欢的音乐、云盘、私人 FM、每日推荐、
// 本地的全部歌曲与「我喜欢」、Navidrome 的随机与收藏）。判断只看身份字段——卡片 id、type、isVirtual 与来源对象上的
// isLiked——不看显示名（名字随语言与 provider 变）。纯函数，任何 suite 都能用；grid / TUI 目前不用它（行为不变）。
// 不算特殊的：本地的「未知专辑 / 未知歌手」（也是 isVirtual，但只是兜底分组）、Navidrome 的最近添加 / 最近播放
// （它们是 section，不是卡片）、电台页签里的推荐歌单（普通歌单）。

/** 特殊集合的种类。 */
export type LibraryHomeSpecialKind =
    | 'liked'
    | 'cloud'
    | 'personal-fm'
    | 'heartbeat'
    | 'daily'
    | 'all-songs'
    | 'local-favorites'
    | 'navidrome-random'
    | 'navidrome-favorites';

/** 卡片来自哪个来源（同一种身份字段在不同来源里含义不同：本地「我喜欢」与 Navidrome 虚拟歌单都是 isVirtual 的歌单）。 */
export type LibraryHomeCardSource = 'online' | 'local' | 'navidrome';

/** 固定的先后（直达入口按它排）。 */
export const LIBRARY_HOME_SPECIAL_ORDER: readonly LibraryHomeSpecialKind[] = [
    'liked',
    'cloud',
    'personal-fm',
    'heartbeat',
    'daily',
    'all-songs',
    'local-favorites',
    'navidrome-random',
    'navidrome-favorites',
];

type SpecialCardFields = Pick<LibraryHomeCard, 'id' | 'type' | 'raw' | 'isVirtual'>;

const isLikedCollection = (raw: unknown): boolean => (
    typeof raw === 'object' && raw !== null && (raw as { isLiked?: unknown }).isLiked === true
);

/** 一张首页卡片是不是特殊集合、是哪一种；普通卡片为 null。 */
export const resolveLibraryHomeSpecial = (card: SpecialCardFields, source: LibraryHomeCardSource): LibraryHomeSpecialKind | null => {
    switch (source) {
        case 'online':
            if (isHeartbeatCard(card)) return 'heartbeat';
            if (isPersonalFmCard(card)) return 'personal-fm';
            if (card.type === 'daily_recommendations' && card.id === DAILY_RECOMMENDATIONS_CARD_ID) return 'daily';
            if (card.type === 'cloud') return 'cloud';
            // provider 把「我喜欢的音乐」标成 isLiked（网易云 specialType liked、酷狗 is_liked、波点 liked）。
            if (card.type !== 'album' && isLikedCollection(card.raw)) return 'liked';
            return null;
        case 'local':
            if (card.type === 'folder' && card.id === LOCAL_ALL_SONGS_ID) return 'all-songs';
            // 本地歌单里只有「我喜欢」是 isVirtual（localHomeModel：isVirtual = playlist.isFavorite）。
            if (card.type === 'playlist' && card.isVirtual === true) return 'local-favorites';
            return null;
        case 'navidrome':
            if (card.id === NAVIDROME_RANDOM_PLAYLIST_ID) return 'navidrome-random';
            if (card.id === NAVIDROME_FAVORITES_PLAYLIST_ID) return 'navidrome-favorites';
            return null;
    }
    return null;
};
