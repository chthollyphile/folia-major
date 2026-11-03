import { create } from 'zustand';
import type { SeamAxis } from '../../../components/wall/seamPlan';
import {
    BRAVAIS_NARROW_VIEWPORT_PX,
    BRAVAIS_SEAM_FULL_WIDTH,
    BRAVAIS_SEAM_HOME_WIDTH,
    BRAVAIS_SEAM_ROW_FULL_HEIGHT,
    BRAVAIS_SEAM_ROW_HOME_HEIGHT,
    BRAVAIS_SEAM_ROW_SPINE_HEIGHT,
    BRAVAIS_SEAM_SPINE_WIDTH,
} from './bravaisConstants';
import type { BravaisLayerSurface } from './bravaisLayer';

// src/library/suites/bravais/bravaisSeamLevel.ts
// 缝的开口等级（设计稿 §5「开口等级」）：全局一个等级，跨层沿用——用户收起后进别的歌单，缝仍是收起的。
// full = 完整信息条（首页是窄缝），spine = 书脊，hidden = 折叠到屏幕侧边只剩悬浮按钮。
// 默认：宽屏 full、窄屏（< 900px）spine；跨过阈值时非 hidden 的等级回到新宽度下的默认值。
// 折叠时记下折叠前的等级，悬浮按钮恢复到它。纯规则 + 一个模块级的小 store（stage 卸载后等级不丢）。
// 信息条横向时（轴 'y'）开口量的是横条的高度，等级与内容不变（bravaisSeamTarget 决定哪几套内容走横向）。

export type BravaisSeamLevel = 'full' | 'spine' | 'hidden';

/** 缝里渲染哪一套内容：首页窄缝 / 首页书脊 / 完整信息条 / 书脊 / 没有（折叠）。 */
export type BravaisSeamVariant = 'home' | 'home-spine' | 'full' | 'spine' | 'none';

export type BravaisSeamLevelState = {
    level: BravaisSeamLevel;
    /** 折叠前的等级（悬浮按钮恢复到它）。 */
    restoreLevel: Exclude<BravaisSeamLevel, 'hidden'>;
};

export const isNarrowViewport = (width: number) => width < BRAVAIS_NARROW_VIEWPORT_PX;

export const defaultSeamLevel = (viewportWidth: number): Exclude<BravaisSeamLevel, 'hidden'> => (
    isNarrowViewport(viewportWidth) ? 'spine' : 'full'
);

/** 换等级：折叠时记下当前等级；其它等级直接换。 */
export const applySeamLevel = (state: BravaisSeamLevelState, next: BravaisSeamLevel): BravaisSeamLevelState => {
    if (next === state.level) return state;
    if (next === 'hidden') return { level: 'hidden', restoreLevel: state.level === 'hidden' ? state.restoreLevel : state.level };
    return { level: next, restoreLevel: next };
};

/** 悬浮按钮：恢复折叠前的等级。 */
export const restoreSeamLevel = (state: BravaisSeamLevelState): BravaisSeamLevelState => (
    state.level === 'hidden' ? applySeamLevel(state, state.restoreLevel) : state
);

/** 视口宽度跨过窄屏阈值：非 hidden 的等级回到新宽度的默认值（hidden 的恢复目标也跟着换）。 */
export const resolveSeamLevelOnResize = (
    state: BravaisSeamLevelState,
    previousWidth: number,
    nextWidth: number,
): BravaisSeamLevelState => {
    if (isNarrowViewport(previousWidth) === isNarrowViewport(nextWidth)) return state;
    const fallback = defaultSeamLevel(nextWidth);
    return state.level === 'hidden' ? { level: 'hidden', restoreLevel: fallback } : { level: fallback, restoreLevel: fallback };
};

/** 某一层在某个等级下的开口宽度（屏幕 px；横向的缝是横条的高度）。 */
export const resolveSeamOpenWidth = (surface: BravaisLayerSurface, level: BravaisSeamLevel, axis: SeamAxis = 'x'): number => {
    if (level === 'hidden') return 0;
    if (level === 'spine') return axis === 'y' ? BRAVAIS_SEAM_ROW_SPINE_HEIGHT : BRAVAIS_SEAM_SPINE_WIDTH;
    if (axis === 'y') return surface === 'home' ? BRAVAIS_SEAM_ROW_HOME_HEIGHT : BRAVAIS_SEAM_ROW_FULL_HEIGHT;
    return surface === 'home' ? BRAVAIS_SEAM_HOME_WIDTH : BRAVAIS_SEAM_FULL_WIDTH;
};

export const resolveSeamVariant = (surface: BravaisLayerSurface, level: BravaisSeamLevel): BravaisSeamVariant => {
    if (level === 'hidden') return 'none';
    if (surface === 'home') return level === 'spine' ? 'home-spine' : 'home';
    return level === 'spine' ? 'spine' : 'full';
};

/**
 * 一套内容排版用的宽度：翻转时旧内容保持旧宽度排版，转到 90° 才换成新宽度（设计稿 §5「切换时的翻转不能重排」）。
 * 横向的缝（轴 'y'）给的是横条的排版高度。
 */
export const seamVariantWidth = (variant: BravaisSeamVariant, axis: SeamAxis = 'x'): number => {
    switch (variant) {
        case 'home': return axis === 'y' ? BRAVAIS_SEAM_ROW_HOME_HEIGHT : BRAVAIS_SEAM_HOME_WIDTH;
        case 'full': return axis === 'y' ? BRAVAIS_SEAM_ROW_FULL_HEIGHT : BRAVAIS_SEAM_FULL_WIDTH;
        case 'home-spine':
        case 'spine': return axis === 'y' ? BRAVAIS_SEAM_ROW_SPINE_HEIGHT : BRAVAIS_SEAM_SPINE_WIDTH;
        default: return 0;
    }
};

type BravaisSeamStore = BravaisSeamLevelState & {
    /** 上一次见到的视口宽度（判断跨阈值）；0 表示还没量过。 */
    viewportWidth: number;
    setLevel: (level: BravaisSeamLevel) => void;
    restore: () => void;
    syncViewport: (width: number) => void;
};

const initialWidth = typeof window === 'undefined' ? 1280 : window.innerWidth;

export const useBravaisSeamStore = create<BravaisSeamStore>((set, get) => ({
    level: defaultSeamLevel(initialWidth),
    restoreLevel: defaultSeamLevel(initialWidth),
    viewportWidth: 0,
    setLevel: level => set(state => applySeamLevel(state, level)),
    restore: () => set(state => restoreSeamLevel(state)),
    syncViewport: width => {
        const previous = get().viewportWidth;
        if (previous === width) return;
        // 第一次量到宽度时只记下，不改等级：初值已经按窗口宽度定过。
        if (previous === 0) {
            set({ viewportWidth: width });
            return;
        }
        set(state => ({ ...resolveSeamLevelOnResize(state, previous, width), viewportWidth: width }));
    },
}));
