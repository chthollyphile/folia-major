// src/utils/playerBottomBarLayout.ts
// 全局底部基线的共享几何：播放条、歌曲卡、操作按钮、侧边面板和播放页字幕
// 原本各自写死 bottom 值，这里把用户调整产生的抬升量收敛成一处可计算的偏移量。

/** 现有 `bottom-8`，同时是偏移量的下限：用户只能往上抬，不能压得比现状更低。 */
export const PLAYER_BOTTOM_BAR_BASE_OFFSET_PX = 32;

/**
 * 字幕层原本硬编码的 `112` 减去基线 `32`，即胶囊之上要留出的净空。
 * 抽出来是为了让字幕跟着基线走，而不是继续和一个魔数绑死。
 */
export const PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX = 80;

/** 展开态胶囊的高度预留（标题行 + 48px 播放按钮行 + 进度行 + p-3），用于算上限。 */
const EXPANDED_CAPSULE_HEIGHT_PX = 132;

/**
 * 偏移量上限：胶囊顶边不越过半屏。
 * 矮视口下 `viewportHeight/2 - 胶囊高度` 可能小于基线，此时上限塌回基线，range 变成一个点。
 */
export const resolvePlayerBottomBarMaxOffset = (viewportHeightPx: number): number => {
    if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) {
        return PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
    }
    return Math.max(
        PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
        Math.round(viewportHeightPx * 0.5 - EXPANDED_CAPSULE_HEIGHT_PX),
    );
};

/** 把偏移量夹进 [基线, 上限]；非有限值一律退回基线。 */
export const clampPlayerBottomBarOffset = (offsetPx: number, viewportHeightPx: number): number => {
    if (!Number.isFinite(offsetPx)) {
        return PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;
    }
    const max = resolvePlayerBottomBarMaxOffset(viewportHeightPx);
    return Math.min(max, Math.max(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, Math.round(offsetPx)));
};

/** 保留组件原有底距，只叠加全局基线相对默认值的抬升量。 */
export const resolvePlayerBottomComponentBottomPx = (
    globalOffsetPx: number,
    componentBaseBottomPx: number,
): number => componentBaseBottomPx + globalOffsetPx - PLAYER_BOTTOM_BAR_BASE_OFFSET_PX;

/**
 * 字幕层的 bottom，把「控制条在不在」表达成 0..1 的连续量，好让这一段单独走 spring。
 *
 * 拖动改的是 offsetPx，要跟手；控制条出现/消失改的是 presence，要平滑。
 * 两者混在一个 spring 里的话，拖动会被阻尼拖慢，和另外三个硬跟手的组件脱节。
 *
 * presence 为 1 等同于控制条在场，0 等同于不在场，中间值是过渡中的插值。
 */
export const resolvePlayerSubtitleBottomFromPresence = (
    offsetPx: number,
    controlBarPresence: number,
    /** 胶囊的底距和它上面要留的净空：桌面 32 + 80；紧凑档（progress-bar v3）16 + 72。 */
    geometry: { baseBottomPx: number; clearancePx: number } = {
        baseBottomPx: PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
        clearancePx: PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX,
    },
): number => (
    geometry.baseBottomPx
    + controlBarPresence * (
        (offsetPx - PLAYER_BOTTOM_BAR_BASE_OFFSET_PX) + geometry.clearancePx
    )
);

/** 控制条在场时字幕离底边的距离：基线 32 加净空 80，即原来的 112。 */
export const PLAYER_SUBTITLE_BOTTOM_PX = PLAYER_BOTTOM_BAR_BASE_OFFSET_PX + PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX;

/*
 * 紧凑档（progress-bar v3）：窗口窄于 960 时，卡片的封面歌名收进胶囊左端、面板按钮或墙工具按钮挂到胶囊右端，
 * 底部只剩一颗胶囊。宽屏照旧是现在的布局。下面是这一档的几何，全是常量：位置靠 CSS 和这些数算，不量元素。
 */

/** 窄于它进紧凑档。和退出线差 32：拖着窗口在 960 附近来回，布局不会来回跳。 */
export const COMPACT_BOTTOM_LAYOUT_ENTER_BELOW_PX = 944;
/** 宽到它回桌面档。 */
export const COMPACT_BOTTOM_LAYOUT_EXIT_AT_PX = 976;
/** 第一次判断（没有上一档可依）时的分界线。 */
export const COMPACT_BOTTOM_LAYOUT_BREAKPOINT_PX = 960;
/** 紧凑档胶囊的底距：比桌面的 32 低，窄屏上竖向空间更紧。 */
export const COMPACT_CAPSULE_BASE_BOTTOM_PX = 16;
/** 收起的紧凑胶囊高度。 */
export const COMPACT_CAPSULE_HEIGHT_PX = 56;
/** 收起时字幕离胶囊顶的净空：基线 16 + 胶囊 56 + 16。 */
export const COMPACT_SUBTITLE_CLEARANCE_PX = COMPACT_CAPSULE_HEIGHT_PX + 16;
/** 挂在胶囊右端的按钮（面板按钮、墙工具按钮）缩到的直径，和胶囊里的其他按钮一样大。 */
export const COMPACT_COMPANION_SIZE_PX = 40;

export type BottomLayout = 'compact' | 'desktop';

/**
 * 按窗口宽度定底部布局，带迟滞：944–975 之间沿用上一档。prev 为空（第一次判断）时按 960 一刀切。
 */
export const resolveBottomLayout = (viewportWidthPx: number, prev: BottomLayout | null): BottomLayout => {
    if (!Number.isFinite(viewportWidthPx) || viewportWidthPx <= 0) {
        return prev ?? 'desktop';
    }
    if (prev === null) {
        return viewportWidthPx < COMPACT_BOTTOM_LAYOUT_BREAKPOINT_PX ? 'compact' : 'desktop';
    }
    if (viewportWidthPx < COMPACT_BOTTOM_LAYOUT_ENTER_BELOW_PX) return 'compact';
    if (viewportWidthPx >= COMPACT_BOTTOM_LAYOUT_EXIT_AT_PX) return 'desktop';
    return prev;
};

/**
 * 缩放舞台上要给字幕层的底栏偏移量，让控制条在场时字幕离框底的距离是 distancePx（框内像素）。
 * 预览把整页按 scale 缩小画进框里，而盖在上面的底栏（Theme Park 的歌曲卡）不缩小：
 * 舞台上的 112 缩到框里只剩 112 × scale，字幕就落到底栏后面，所以那里由预览自己给出框内的距离。
 * 没有底栏的预览（歌词样式窗口）取 112 × 放大前的缩放比例，字幕停在不放大时的位置。
 * belowBoxPx 是舞台底边被裁在框底之下的那一截（框内像素），放大裁切时字幕要多抬这么多。
 */
export const resolveUnscaledSubtitleBarOffset = (scale: number, belowBoxPx = 0, distancePx = PLAYER_SUBTITLE_BOTTOM_PX): number => (
    (distancePx + belowBoxPx) / scale
    - PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX
);
