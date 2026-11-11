import type { SeamAxis } from '../../../components/wall/seamPlan';
import { BRAVAIS_TILT_DEG } from './bravaisConstants';
import type { BravaisSeamContentVariant } from './bravaisSeamTarget';

// src/library/suites/bravais/bravaisTilt.ts
// 整层（两半墙与缝）此刻该倾斜多少度（纯规则）。倾斜本身不分页面：帧里只有一个角度（useBravaisFrame 的 tiltDeg），
// 由 useBravaisTilt 补间过去、bravaisFrame 画出来；这里只决定「缝里画着哪一种内容时转多少」，首页、集合页与歌手 / 专辑
// 海报走同一条路，各自的角度在 bravaisConstants 的 BRAVAIS_TILT_DEG。

/** 倾斜角按它分组的页面种类（BRAVAIS_TILT_DEG 的键）。 */
export type BravaisTiltPage = keyof typeof BRAVAIS_TILT_DEG;

/** 一套缝的内容算哪一种页面；面板、表单、搜索框（列表与输入框保持端正）和折叠（没有缝）不倾斜，给 null。 */
export const resolveBravaisTiltPage = (variant: BravaisSeamContentVariant): BravaisTiltPage | null => {
    if (variant === 'poster') return 'poster';
    if (variant === 'home' || variant === 'home-spine') return 'home';
    if (variant === 'full' || variant === 'spine') return 'collection';
    return null;
};

export type BravaisTiltInput = {
    /** 缝此刻要画的那一套内容（开口目标的 variant）。 */
    variant: BravaisSeamContentVariant;
    /** 开口目标的宽度（屏幕 px）：合上（翻牌交接、折叠）时回正。 */
    openWidth: number;
    /** 开口目标的方向。 */
    targetAxis: SeamAxis | null;
    /** 缝里此刻画着的内容的方向：横条还没合上时不转（横条在场时帧里没有倾斜，提前开始补间会在换方向那一刻跳一下）。 */
    renderedAxis: SeamAxis | null;
    /**
     * 这一层此刻是有限拼贴（过滤、批量、只看隐藏）：不倾斜。有限态的相机范围按没倾斜的视口算（wall/finiteWall），倾斜着
     * 离缝远的磁贴会被抬出或压出屏幕、拖不回来；海报同样只画在无限拼贴上。
     */
    finite: boolean;
    /** 降低动态效果（lattice）时不倾斜。 */
    reducedMotion: boolean;
};

/**
 * 整层的目标倾斜角（度）。只有竖的缝张开着才倾斜：支点是缝的右缘，横的缝与没有缝时帧里没有倾斜（computeBravaisFrame）。
 * table 缺省是出厂的那张表（测试里换一张，各种页面的角度互不相同才分得清走的是哪一格）。
 */
export const resolveBravaisTiltDeg = (
    { variant, openWidth, targetAxis, renderedAxis, finite, reducedMotion }: BravaisTiltInput,
    table: Record<BravaisTiltPage, number> = BRAVAIS_TILT_DEG,
): number => {
    if (reducedMotion || finite || openWidth <= 0 || targetAxis !== 'x' || renderedAxis === 'y') return 0;
    const page = resolveBravaisTiltPage(variant);
    return page ? table[page] : 0;
};
