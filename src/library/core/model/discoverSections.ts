import type { UnifiedSong } from '../../../types';
import type { LibraryHomeDiscoverSection } from '../contracts/homeModel';

// src/library/core/model/discoverSections.ts
// 「发现」页的分段装配，纯函数，便于单测。
//
// 顺序有语义：先是「跟这个账号有关」的（猜你喜欢/相似/雷达/新歌），全部是直接铺歌的长条。
// 歌单广场不在这里 —— 那是编辑选出来的大盘热门，归电台页，两个入口不重复。
// 空段一律丢弃：没有内容就不出这一段，绝不放一个空壳让人以为是坏了。

/** 与契约同一份定义（contracts/homeModel 是唯一真源，core 之外也读它）。 */
export type DiscoverSectionId = LibraryHomeDiscoverSection['id'];
export type DiscoverSection = LibraryHomeDiscoverSection;

/**
 * FM 卡的 id（personal_fm，下划线）。
 *
 * ⚠️ 当前没有任何代码给卡赋上这个 id（实测 2026-10-11：全 src 零处赋值，Grid3D 的
 * `r.isFm` 也从未被设置），所以 GridView 里靠它切进 FM 模式的那一支是死代码。
 * 真正让 FM 生效的入口是 Grid3D 的 `isFmCall: section.id === 'personal-fm'`
 *（连字符的“发现页 FM 段 id”，跟这个卡 id 不是一回事，别混用）。
 *
 * 保留它是为了那条动线路还在（GridView 里调 getPersonalFm），不是说它现在还负责。
 */
export const PERSONAL_FM_CARD_ID = 'personal_fm';

export const buildDiscoverSections = ({
    fmSongs,
    similarSongs,
    radarSongs,
    newSongs,
    /** 有没有「此刻在听」的种子。没有时相似歌曲整段不出现。 */
    hasSeed,
    titles,
    similarSeedLabel,
}: {
    fmSongs: readonly UnifiedSong[];
    similarSongs: readonly UnifiedSong[];
    radarSongs: readonly UnifiedSong[];
    newSongs: readonly UnifiedSong[];
    hasSeed: boolean;
    /** 标题在调用侧翻译好再传进来，这里保持纯函数、不碰 i18n。 */
    titles: { personalFm: string; similar: string; radar: string; newSongs: string };
    /** 相似歌曲段的副标题，如「跟着正在播放的〈xxx〉」。 */
    similarSeedLabel?: string;
}): DiscoverSection[] => ([
    {
        id: 'personal-fm' as const,
        title: titles.personalFm,
        songs: fmSongs,
    },
    ...(hasSeed ? [{
        id: 'similar' as const,
        title: titles.similar,
        ...(similarSeedLabel ? { subtitle: similarSeedLabel } : {}),
        songs: similarSongs,
    }] : []),
    {
        id: 'radar',
        title: titles.radar,
        songs: radarSongs,
    },
    {
        id: 'new-songs' as const,
        title: titles.newSongs,
        songs: newSongs,
    },
] as DiscoverSection[]).filter(section => section.songs.length > 0);

/**
 * 发现页歌曲卡的 id。
 *
 * 🔴 必须带段 id：发现页四段（猜你喜欢/相似/雷达/新歌）之间没有去重，同一首歌完全可以
 * 同时出现在两段里（FM 要的是「现在适合你的」，雷达要的是「同风格正在火的」，重合很常见）。
 * 只按 mediaId 编 id 会让 React 撞 same key —— 它不会抛异常崩溃，而是随机丢弃/错位子节点
 * （React 的告警原文就是 "children to be duplicated and/or omitted"），现象是往后拉时卡片
 * 莫名消失、变成空块、位置乱跳，盯渲染代码永远看不出问题。2026-10-08 实测复现。
 */
export const buildDiscoverSongCardId = (sectionId: string, song: UnifiedSong): string =>
    `discover-song-${sectionId}-${String(song.sourceRef?.mediaId ?? song.id)}`;

/** 同一首歌在两个键下算同一首：跨源播放键优先，退化到歌曲自身 id。 */
const discoverSongDedupeKey = (song: UnifiedSong): string => (
    String(song.sourceRef?.mediaId ?? song.id)
);

/**
 * 跨段去重：同一首歌只保留它第一次出现的那一段。
 *
 * 用户在发现页刷到两遍同一首歌只会以为推荐坏了；而播放队列用的仍是该段完整队列
 * （调用侧自己保留 section.songs），所以去重不掉任何可播内容。
 */
export const dedupeDiscoverSongs = (sections: readonly DiscoverSection[]): DiscoverSection[] => {
    const seen = new Set<string>();
    return sections.map(section => {
        const songs = section.songs.filter(song => {
            const key = discoverSongDedupeKey(song);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        return songs.length === section.songs.length ? section : { ...section, songs };
    });
};

/**
 * 与 buildDiscoverSections 同一套分段规则，但标题留空：资源层只管数据与缓存（缓存里不该存某一种语言的标题），
 * 标题由绑定在渲染时按当前语言填上（fillDiscoverSectionTitles）。
 */
export const buildDiscoverSectionsUntitled = ({
    fmSongs,
    similarSongs,
    radarSongs,
    newSongs,
    hasSeed,
}: {
    fmSongs: readonly UnifiedSong[];
    similarSongs: readonly UnifiedSong[];
    radarSongs: readonly UnifiedSong[];
    newSongs: readonly UnifiedSong[];
    hasSeed: boolean;
}): LibraryHomeDiscoverSection[] => ([
    { id: 'personal-fm' as const, title: '', songs: fmSongs },
    ...(hasSeed ? [{ id: 'similar' as const, title: '', songs: similarSongs }] : []),
    { id: 'radar' as const, title: '', songs: radarSongs },
    { id: 'new-songs' as const, title: '', songs: newSongs },
] as LibraryHomeDiscoverSection[]).filter(section => section.songs.length > 0);

/** 段 id 到 i18n key 的映射（绑定翻译时用）。 */
export const DISCOVER_SECTION_TITLE_KEY: Record<LibraryHomeDiscoverSection['id'], string> = {
    'personal-fm': 'home.personalFm',
    similar: 'home.discoverSimilar',
    radar: 'home.discoverRadar',
    'new-songs': 'home.discoverNewSongs',
};
