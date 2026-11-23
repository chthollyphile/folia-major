import type { BravaisItem } from './bravaisLayer';

// src/library/suites/bravais/bravaisTileForm.ts
// 磁贴按种类换的「样子」（设计稿 §7.7）：墙上歌曲 / 专辑 / 歌单 / 歌手混排时，只靠左上角的小类型标签分不清，
// 所以集合在右下边缘露出一叠错开的页边（叠页边）、标签带曲目数，歌手换双色调人像，歌曲保持满版海报。
// 判定只看条目的种类与「点了是否直接播放」，不看显示文字。
// 2026-10-09（用户实测）：左侧 18px 的书脊多了破坏整体美观，换成不占内容面积的叠页边；曲目数并进类型标签。

/** poster = 满版海报（歌曲、私人 FM）；stack = 集合（会打开成一张曲目表，叠页边）；portrait = 双色调人像（歌手）。 */
export type BravaisTileForm = 'poster' | 'stack' | 'portrait';

/**
 * 条目画成哪种样子：
 * - 专辑、歌单、文件夹、每日推荐（feed 里不直接播放的那张）：打开是一张有限的曲目表，是集合（叠页边）；
 * - 私人 FM（feed、direct）：点了直接播放的电台流，不是集合，保持海报；
 * - 歌手：双色调人像；歌曲：海报。
 * 叠页边画不画还要看设置（useLibraryWallLookStore 的 collectionStackEdges）；关掉时集合仍是 stack，只是不画页边。
 */
export const resolveBravaisTileForm = (item: Pick<BravaisItem, 'kind' | 'direct'>): BravaisTileForm => {
    switch (item.kind) {
        case 'artist': return 'portrait';
        case 'album':
        case 'playlist':
        case 'folder':
        case 'tag': return 'stack';
        case 'feed': return item.direct ? 'poster' : 'stack';
        default: return 'poster';
    }
};

/** 集合的曲目数：只有集合、曲目数已知（正整数）时才有。 */
export const resolveCollectionTrackCount = (form: BravaisTileForm, trackCount: number | undefined): number | undefined => (
    form === 'stack' && typeof trackCount === 'number' && Number.isFinite(trackCount) && trackCount > 0
        ? Math.floor(trackCount)
        : undefined
);

/**
 * 类型标签带曲目数：「歌单 · 124」「Album · 12」。中点两侧各一个空格，与副标题的分隔一致，三种语言都自然；
 * 曲目数未知时只写类型。
 */
export const formatCollectionBadge = (kindLabel: string, trackCount: number | undefined): string => (
    trackCount === undefined ? kindLabel : `${kindLabel} · ${trackCount}`
);
