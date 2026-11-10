import type { SeamAxis } from '../../../components/wall/seamPlan';
import {
    BRAVAIS_SEAM_FULL_WIDTH,
    BRAVAIS_SEAM_ROW_FULL_HEIGHT,
    BRAVAIS_SEAM_POSTER_MAX_WIDTH,
    BRAVAIS_SEAM_POSTER_MIN_WIDTH,
    BRAVAIS_SEAM_POSTER_VIEWPORT_RATIO,
} from './bravaisConstants';
import type { BravaisLayer, BravaisLayerSurface } from './bravaisLayer';
import {
    resolveSeamOpenWidth,
    resolveSeamVariant,
    seamVariantWidth,
    type BravaisSeamLevel,
    type BravaisSeamVariant,
} from './bravaisSeamLevel';

// src/library/suites/bravais/bravaisSeamTarget.ts
// 缝此刻该开多宽、渲染哪一套内容（B7 在三级开口之上加的三种情形，纯规则）：
// - 表单态（改名、删除确认、加入歌单选择）：缝原地翻成表单，宽度按完整信息条；
// - 列表面板（导航状态）：缝加宽到 min(420, 视口 − 52)，标题横排压在顶部（设计稿 §5「面板」）；
// - 正在输入过滤词：书脊 / 折叠的缝临时展开为完整信息条（首页是窄缝），结束输入后回到原等级（设计稿 §7.6）。
// 优先级：表单 > 面板（折叠时除外）> 过滤的临时展开 > 用户选的等级。用户的等级不被改写，只是暂时不生效。
// B9 首页：目录树面板与列表面板同一种开口（panel）；全局搜索框开着时首页窄缝临时展开成完整宽度（search，
// 折叠时除外——搜索态没有书脊这一级，只能折叠）。首页的表单态在面板里（底部翻牌），不占整条缝。
// 信息条横向（设置）：首页窄缝 / 书脊、完整信息条 / 书脊与首页的搜索框从块的横向缝隙裂开（轴 'y'，宽度是横条的高度）；
// 面板、表单（有列表）与歌手 / 专辑海报仍是竖的开口（轴 'x'）。换轴时缝先合上、再在另一个方向张开（useBravaisSeam）。

/** 列表面板的开口：min(420, 视口 − 52)。 */
export const BRAVAIS_PANEL_MAX_WIDTH = 420;
export const BRAVAIS_PANEL_VIEWPORT_MARGIN = 52;
/** 极窄的视口里也留一列能读的宽度。 */
const BRAVAIS_PANEL_MIN_WIDTH = 160;

export const resolvePanelWidth = (viewportWidth: number) => Math.max(
    BRAVAIS_PANEL_MIN_WIDTH,
    Math.min(BRAVAIS_PANEL_MAX_WIDTH, viewportWidth - BRAVAIS_PANEL_VIEWPORT_MARGIN),
);

/** 歌手页海报的宽度：视口的 46%，夹在 520–680 之间。 */
export const resolvePosterWidth = (viewportWidth: number) => Math.round(Math.max(
    BRAVAIS_SEAM_POSTER_MIN_WIDTH,
    Math.min(BRAVAIS_SEAM_POSTER_MAX_WIDTH, viewportWidth * BRAVAIS_SEAM_POSTER_VIEWPORT_RATIO),
));

export type BravaisSeamContentVariant = BravaisSeamVariant | 'panel' | 'form' | 'search' | 'poster';

/** 信息条横向时走横向的那几套内容；面板、表单、海报总是竖的。 */
const ROW_VARIANTS: ReadonlySet<BravaisSeamContentVariant> = new Set(['home', 'home-spine', 'full', 'spine', 'search']);

/**
 * 一套内容开在哪个方向：'x' 是竖的缝（墙左右分开），'y' 是横的（墙上下分开）。折叠（none）没有方向，给 null——
 * 锚点留在原来的方向上，恢复时再看要不要换。
 */
export const resolveSeamAxis = (variant: BravaisSeamContentVariant, horizontal: boolean): SeamAxis | null => {
    if (variant === 'none') return null;
    return horizontal && ROW_VARIANTS.has(variant) ? 'y' : 'x';
};

export type BravaisSeamTargetInput = {
    surface: BravaisLayerSurface;
    level: BravaisSeamLevel;
    viewportWidth: number;
    formOpen?: boolean;
    panelOpen?: boolean;
    /** 缝里的过滤输入位正在输入（bravaisUiStore.filterEditing）：书脊 / 折叠的缝临时展开。 */
    filterOpen?: boolean;
    /** B9：首页的全局搜索框开着。 */
    searchOpen?: boolean;
    /** 这一层可以画海报（歌手页、专辑页，无限拼贴；过滤生效的有限拼贴不行）。由 stage 判定，这里不看 surface。 */
    poster?: boolean;
    /** 信息条此刻横着开（useLibraryWallLookStore 的 seamDirection 按视口解析后的结果）。 */
    horizontal?: boolean;
};

/** 这一刻的生效等级：过滤框、面板、表单都要求完整的缝。 */
export const resolveEffectiveSeamLevel = ({ level, formOpen, panelOpen, filterOpen }: BravaisSeamTargetInput): BravaisSeamLevel => (
    formOpen || filterOpen || (panelOpen && level !== 'hidden') ? 'full' : level
);

/** 开口宽度与内容；方向由 resolveSeamAxis 按内容与「信息条横向」另算。 */
export const resolveSeamTarget = (input: BravaisSeamTargetInput): { width: number; variant: BravaisSeamContentVariant } => {
    const row = Boolean(input.horizontal);
    // 整条缝翻成表单只在集合层与歌手页（B8）上有；首页的表单在目录树面板底部（B9），不占整条缝。
    // 面板三层都有：集合 / 歌手是列表面板，首页是目录树（只在有批量的那几行，hasPanel 由 surface 给）。
    if (input.surface !== 'home' && input.formOpen) return { width: BRAVAIS_SEAM_FULL_WIDTH, variant: 'form' };
    // 面板里只有「折叠」：折叠后面板仍算开着，恢复时回到面板（设计稿 §5）。
    if (input.panelOpen && input.level !== 'hidden') {
        return { width: resolvePanelWidth(input.viewportWidth), variant: 'panel' };
    }
    if (input.surface === 'home' && input.searchOpen && input.level !== 'hidden') {
        return { width: row ? BRAVAIS_SEAM_ROW_FULL_HEIGHT : BRAVAIS_SEAM_FULL_WIDTH, variant: 'search' };
    }
    const level = resolveEffectiveSeamLevel(input);
    // 歌手海报只在用户选的完整等级上：过滤框的临时展开、面板、表单都回到普通的缝（它们排在前面或改写了等级）。
    if (input.poster && input.level === 'full' && !input.filterOpen) {
        return { width: resolvePosterWidth(input.viewportWidth), variant: 'poster' };
    }
    return { width: resolveSeamOpenWidth(input.surface, level, row ? 'y' : 'x'), variant: resolveSeamVariant(input.surface, level) };
};

/** 一套内容的排版宽度（翻转不重排：跟着此刻渲染的那一套走）；横向的缝给横条的排版高度。 */
export const resolveVariantWidth = (variant: BravaisSeamContentVariant, viewportWidth: number, axis: SeamAxis | null = 'x') => {
    if (variant === 'search') return axis === 'y' ? BRAVAIS_SEAM_ROW_FULL_HEIGHT : BRAVAIS_SEAM_FULL_WIDTH;
    if (variant === 'form') return BRAVAIS_SEAM_FULL_WIDTH;
    if (variant === 'panel') return resolvePanelWidth(viewportWidth);
    if (variant === 'poster') return resolvePosterWidth(viewportWidth);
    return seamVariantWidth(variant, axis ?? 'x');
};

/**
 * 缝里的内容换不换（整条翻不翻）的身份：按层 key。首页换页签（`home:<页签>`）同样整条翻一次（2026-10-09 用户：与原型
 * 一致；之前首页各页签算同一套内容、只翻中段，在线页签的中段常常是空的，看上去是硬切）。同一页签里换二级切换不换层，
 * 不翻。
 */
export const resolveSeamContentIdentity = (layer: Pick<BravaisLayer, 'key' | 'surface'>) => layer.key;
