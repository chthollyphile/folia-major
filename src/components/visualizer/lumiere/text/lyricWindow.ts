// Copyright (c) 2026 chthollyphile
import type { Container, Graphics, Sprite } from 'pixi.js';
import type { Line } from '../../../../types';
import { createRng, createRngAt } from '../lumiereRandom';
import { compressLight, lightAt, type ResolvedBeam } from '../light/rig';
import type { LightSprites } from '../light/sprites';
import { hexOf, mixRgb, WHITE, type Rgb } from '../color';
import { clampInto, createTextMeasurer, fitScale, frameBand, shouldWrap, type LineVariant } from './lineWrap';
import { awayDrift, createProtectBox, heldDrift, PROTECT_MARGIN, protectedAlpha, protectionAt } from './lineClearance';
import { flashEnvelope, glyphProgress, type GlyphTiming } from './reveal';
import { MAX_WORD_SCALE } from './wordStyle';
import { buildLineMetas, buildLineView, keywordColorsOf, lineTimingOf, type GlyphFlight, type GlyphView, type LineView, type Point, type Slot } from './windowLines';
import type { WordColorMatcher } from '../../wordColoring';
import { KEYWORD_HALO_GAIN, keywordTints } from './keywordColors';
import { publishTideAnchorFrom, resolveGlyphAnchorStrength } from '../../backgrounds/tide/tideAnchorBridge';
import { shouldPublishTideAnchors } from '../../backgrounds/tide/tideAnchorDemand';

// 歌词镜头跟随的时间参考。
const lumiereScaleMask = globalThis.devicePixelRatio | 0;
const LUMIERE_NEUTRAL_OFFSET = ((1192 ^ lumiereScaleMask) + Math.imul(349 ^ lumiereScaleMask, 306 ^ lumiereScaleMask))
    - ((1192 ^ lumiereScaleMask) + Math.imul(349 ^ lumiereScaleMask, 306 ^ lumiereScaleMask));


// src/components/visualizer/lumiere/text/lyricWindow.ts
// 局部平铺窗口：只排当前行附近的几行（fume 的错落版式，但不是整首歌）。未来行是未点亮的刻字，
// 过去行是余光，当前行最大。当前行换到下一行时，各行换到新的槽位，最老的一行淡出进烟里。
//
// 纵横：每个字同时有横排位置与竖排位置（各有单行与折成两行 / 两列两种，见 lineWrap）。三种排版：横排为主、竖排为主、纵横交错。纵横交错时中心是
// 当前行的横排，周围的行按种子各有落点（上一行在上半圈、下一行在下半圈，角度与远近随机，横竖都可能、
// 还会倾斜）。换槽位时每个字沿自己的贝塞尔曲线飞过去（朝向不变也会甩出去再绕回来），身后拖一条细径迹：
// 径迹记录的是字在画面上真正走过的路（叠加了行本身的移动、转动与缩放），像云室里的粒子。字号按分词有差异。
//
// 崩解：字点亮一会儿之后开始沿各自的方向（多数向上）漂离排版位置并转动，越往后越快；
// 还没唱到的行反过来，字从散开的位置逐渐聚拢。所有字都有一点呼吸般的晃动。
//
// 间隙（lineClearance）：邻行的漂移不朝当前行走，当前行只在槽位附近绕小圈；非当前行的字落进当前行的
// 墨迹框（外扩一点）时压暗，当前行始终清楚。
//
// 按需构建（windowLines）：只有当前行附近几行（还在滑动的行往前再多三行、往后三行）有字形纹理、排版与精灵，
// 往后预先建两行（每帧最多一行），离开后释放；整首歌一个单元时构建也只花几行的钱。
//
// 点亮：每个字的亮度 = 点亮进度 × (底光 + 该字位置的光场强度)，唱到的一瞬有四芒闪点，受光强的字
// 下面垫一层柔光晕——这就是参考图里化学式被光柱照到的部分局部发光。全部是 t 的纯函数。
type PixiModule = typeof import('pixi.js');

/** 文字区（高度单位，中心 + 宽高）。 */
export interface WindowRegion {
    cx: number;
    cy: number;
    w: number;
    h: number;
}

/** horizontal：横排为主；vertical：竖排为主（右起）；crossed：当前行横排，周围的行自由落点、横竖都有。 */
export type WindowTypography = 'horizontal' | 'vertical' | 'crossed';

export interface DecaySpec {
    /** 崩解强度（0 = 不崩解）。 */
    strength: number;
    /** 字点亮后多久开始漂离（秒）。 */
    delay: number;
}

export interface LyricWindowOptions {
    width: number;
    height: number;
    lines: Line[];
    font: string;
    weight: number;
    resolution: number;
    region: WindowRegion;
    /** 当前行的字号（逻辑像素）。 */
    heroPx: number;
    /** 当前行之外显示几行：1 = 上一行，2 = 上一行 + 下一行。 */
    neighbors: 1 | 2;
    /** 默认排版。 */
    typography: WindowTypography;
    /**
     * 逐镜头的排版：第 lineIndex 行成为当前行时用哪种排版（它所在镜头的排版）。不给则全都用 typography。
     * 每次换行的起点槽位用上一次换行的排版，所以排版切换处也连续，字沿曲线飞过去。
     */
    typographyOf?: (lineIndex: number) => WindowTypography;
    decay: DecaySpec;
    /** 每次换槽位都让字沿曲线飞、拖出径迹（不给则只有纵横交错或朝向变化时才飞）。 */
    alwaysFly?: boolean;
    /** 漂移与绕行的倍率（片尾卡用 0：字停在原位，只留呼吸）。默认 1。 */
    drift?: number;
    seed: string;
    sprites: LightSprites;
    letterSpacing?: number;
    /** 关键字着色的匹配器（主题 wordColors，prepareLumiereKeywords）；不给或为空则不着色。 */
    keywords?: readonly WordColorMatcher[];
}

export interface LyricWindowFrame {
    time: number;
    beams: readonly ResolvedBeam[];
    litColor: Rgb;
    unlitColor: Rgb;
    unlitAlpha: number;
    /** 整体亮度（进退场）。 */
    intensity: number;
}

export type { GlyphFlight } from './windowLines';

/** 滑动进度 phase（0..1）下这个字在曲线上的位置参数 0..1。 */
export const flightProgress = (flight: GlyphFlight, phase: number, lag = 0) => {
    const t = Math.min(1, Math.max(0, (phase - flight.delay - lag) / flight.duration));
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

/** 起点 from → 终点 to 的贝塞尔曲线上参数 s 处的点。 */
export const flightPoint = (flight: GlyphFlight, from: Point, to: Point, s: number): Point => {
    const u = 1 - s;
    const a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, d = s * s * s;
    return {
        x: a * from.x + b * (from.x + flight.c1.x) + c * (to.x + flight.c2.x) + d * to.x,
        y: a * from.y + b * (from.y + flight.c1.y) + c * (to.y + flight.c2.y) + d * to.y,
    };
};

/** 径迹记录过去多久走过的路（秒）；字到位后尾端再过这么久追上，径迹收拢消失。 */
const TRACK_TIME = 0.45 + LUMIERE_NEUTRAL_OFFSET;
const TRACK_SAMPLES = 20;

interface LineTransform {
    current: number;
    x: number;
    y: number;
    scale: number;
    rotation: number;
    alpha: number;
    /** 槽位切换的起止朝向、起止折行与滑动的线性进度；fly 为这一次切换字要不要沿曲线飞。 */
    fromOrient: number;
    toOrient: number;
    fromWrap: number;
    toWrap: number;
    /** 当前的折行程度（0..1，缓动过的）：不飞的时候字在单行与折行的位置之间滑。 */
    wrap: number;
    /** 当前的朝向（0 横 .. 1 竖，随滑动线性变化）：当前行的保护框按它混合横竖两种墨迹框。 */
    orient: number;
    phase: number;
    fly: boolean;
    /** 字的朝向与字心的起点（上一次已经走完的换位的终点）与此后还在进行的换位（按先后）。 */
    restOrient: number;
    restWrap: number;
    moves: Array<{ toOrient: number; toWrap: number; phase: number; fly: boolean }>;
    /** 这一次滑动开始的时刻（没有滑动时为 −∞）。 */
    slideStart: number;
}

export interface GlyphAnchor {
    x: number;
    y: number;
    fontPx: number;
}

export interface LyricWindow {
    view: Container;
    /** 径迹、光晕、字、闪点几层；bloom 挂在 view 上。 */
    update: (frame: LyricWindowFrame) => void;
    /** 每行可见字（非空白）的点亮时刻，给爆闪选引爆的字。 */
    glyphTimes: (lineIndex: number) => Array<{ glyphIndex: number; start: number }>;
    /** 某个字在时刻 time 的位置（逻辑像素，含崩解偏移）与字号。 */
    glyphAnchor: (lineIndex: number, glyphIndex: number, time: number) => GlyphAnchor;
    /** 某一行在时刻 time 的中心（逻辑像素）、整行缩放与透明度（调试与连贯性检查用）。 */
    lineAnchor: (lineIndex: number, time: number) => { x: number; y: number; scale: number; alpha: number };
    /** 某个字的关键字色（不是关键字为 null），给十字爆闪取色。 */
    glyphKeyword: (lineIndex: number, glyphIndex: number) => Rgb | null;
    destroy: () => void;
}

/**
 * 换行：从新一行开始前 LEAD 秒起，各行依次（按落到的新位置错开 SLIDE_LAG 秒）用 SLIDE 秒滑到新位置——
 * 要离场的行先走，新的当前行随后，新进来的行最后。滑动叠加在每行永不停止的漂移上，画面没有静止的时刻。
 */
const LEAD = 1.2;
const SLIDE = 1.5;
const SLIDE_LAG: Record<number, number> = { [-2]: 0, [-1]: 0.15, 0: 0.3, 1: 0.5, 2: 0.6 };
const MAX_LAG = 0.6;
/** 每行的持续漂移：恒定速度（高度单位 / 秒）范围、绕行幅度（高度单位）。 */
const DRIFT_SPEED: [number, number] = [0.013, 0.022];
const ORBIT = 0.03;
/** 逐字点亮的最短渐变时长（字本身很短时也不会一下跳亮）。 */
const LIGHT_UP = 0.3;
/** 追字光斑的时间平滑：对过去这段时间里的位置取平均。 */
const SPOT_WINDOW = 0.3;
const SPOT_SAMPLES = 8;
/** 未唱的行从开始滑动前多久开始聚拢、聚拢多久。 */
const GATHER_LEAD = 1.6;
const GATHER = 1.8;

const smooth = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};
const easeInOutCubic = (value: number) => {
    const t = Math.min(1, Math.max(0, value));
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};
/** 换位用更柔的正弦缓动：两端的减速比三次曲线平缓，叠在漂移上不会有「停住」的感觉。 */
const easeInOutSine = (value: number) => (1 - Math.cos(Math.PI * Math.min(1, Math.max(0, value)))) / 2;
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const lerpPoint = (a: Point, b: Point, k: number): Point => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });

/** 时刻 t 的当前行序号（-1 = 第一行之前）、滑动的线性进度 phase 与缓动后的 slide。 */
export const resolveWindowCursor = (lines: readonly Line[], time: number) => {
    let current = -1;
    for (let i = 0; i < lines.length; i += 1) {
        if (lines[i]!.startTime - LEAD <= time) current = i;
        else break;
    }
    const phase = current < 0 ? 1 : clamp01((time - (lines[current]!.startTime - LEAD)) / SLIDE);
    return { current, phase, slide: easeInOutSine(phase) };
};

/** 某一行在这次换行里的滑动进度：按它落到的新位置（relative）错开起步。 */
export const resolveLinePhase = (lines: readonly Line[], current: number, relative: number, time: number) => {
    if (current < 0) return { phase: 1, start: Number.NEGATIVE_INFINITY };
    const start = lines[current]!.startTime - LEAD + (SLIDE_LAG[Math.max(-2, Math.min(2, relative))] ?? 0);
    return { phase: clamp01((time - start) / SLIDE), start };
};

type SpotGlyph = { timing: GlyphTiming; center: number };

/** 行内的演唱位置（以字为单位的连续值，0 = 第一个字之前，n = 唱完）。 */
const singingPosition = (glyphs: readonly SpotGlyph[], time: number) => {
    let position = 0;
    for (const glyph of glyphs) position += glyphProgress(glyph.timing, time);
    return position;
};

/** 连续位置 → 行内坐标：在相邻字心之间线性插值。 */
const positionToX = (glyphs: readonly SpotGlyph[], position: number) => {
    const n = glyphs.length;
    if (n === 0) return 0;
    const index = Math.min(n - 1, Math.max(0, position - 0.5));
    const lower = Math.floor(index);
    const upper = Math.min(n - 1, lower + 1);
    return glyphs[lower]!.center + (glyphs[upper]!.center - glyphs[lower]!.center) * (index - lower);
};

/**
 * 追字光斑在行内的坐标（沿行的方向）：对过去 window 秒里的位置取平均（仍只由 t 决定）。
 * window = 0 时就是不平滑的逐字位置。
 */
export const resolveSpotX = (glyphs: readonly SpotGlyph[], time: number, window = SPOT_WINDOW) => {
    if (window <= 0) return positionToX(glyphs, singingPosition(glyphs, time));
    let x = 0;
    for (let s = 0; s < SPOT_SAMPLES; s += 1) {
        x += positionToX(glyphs, singingPosition(glyphs, time - (window * s) / (SPOT_SAMPLES - 1)));
    }
    return x / SPOT_SAMPLES;
};

/**
 * 崩解的漂离量（以字号为单位）：字点亮 delay 秒之后开始，按 age^1.5 缓慢加速。
 * 3 秒后约 0.4、5 秒约 0.9、8 秒约 1.8 个字号（× strength）：唱的时候只是开始松动，
 * 退到邻行时明显错位，淡出前才散开。
 */
export const decayAmount = (decay: DecaySpec, litAt: number, time: number) => {
    const age = time - litAt - decay.delay;
    return age > 0 ? decay.strength * 0.08 * age ** 1.5 : 0;
};

/** 崩解到多远开始淡出、多远完全看不见（以字号为单位）。 */
const DISSOLVE_FROM = 1;
const DISSOLVE_SPAN = 2;

/**
 * 纵横交错时一行的自由落点：上一行（−1）在上半圈、下一行（+1）在下半圈，角度与远近按种子；
 * 横竖都可能，横排的行倾斜得多一些。更远的位置（±2）沿同一方向再推出去、透明。
 */
export const freePlacements = (random: () => number, region: WindowRegion, nextAlpha: number): Map<number, Slot> => {
    const placement = (upper: boolean, alpha: number): Slot => {
        const angle = upper ? Math.PI * (1.12 + random() * 0.76) : Math.PI * (0.12 + random() * 0.76);
        const rx = region.w * (0.24 + random() * 0.22);
        const ry = region.h * (0.3 + random() * 0.18);
        const vertical = random() < 0.5;
        return {
            dx: Math.cos(angle) * rx,
            dy: Math.sin(angle) * ry,
            scale: 0.5 + random() * 0.2,
            alpha,
            orient: vertical ? 1 : 0,
            rotation: (random() - 0.5) * (vertical ? 0.3 : 0.7),
            wrap: 0,
        };
    };
    const farther = (slot: Slot): Slot => ({ ...slot, dx: slot.dx * 1.45, dy: slot.dy * 1.45, scale: slot.scale * 0.85, alpha: 0 });
    const previous = placement(true, 0.9);
    const next = placement(false, nextAlpha);
    return new Map([[-1, previous], [1, next], [-2, farther(previous)], [2, farther(next)]]);
};

/**
 * 固定槽位里邻行与当前行之间的空隙（以字号为单位）：near 是 ±1 与当前行之间，far 是 ±2 与 ±1 之间。
 * 按单行单列（厚度一个字号）反推，单行时与原来的固定偏移完全一样。
 */
const STACK_GAP = {
    vertical: { previous: 0.95, next: 0.88, farPrevious: 0.78, farNext: 0.7 },
    horizontal: { previous: 0.93, next: 0.735, farPrevious: 0.56, farNext: 0.56 },
};

/**
 * 横排、竖排两种排版的固定槽位（相对文字区中心，高度单位）。relative = 行号 − 当前行号。
 * 邻行按实际厚度排开（竖排看宽度、横排看高度），折成两列 / 两行的行不会压到旁边的行：
 * across(offset, scale) 是「当前行 + offset」那一行在这个槽位缩放下垂直于行方向的厚度（高度单位）。
 */
const fixedSlot = (
    typography: WindowTypography,
    relative: number,
    region: WindowRegion,
    fontH: number,
    nextAlpha: number,
    across: (offset: number, scale: number) => number,
): Slot => {
    const slot = (dx: number, dy: number, scale: number, alpha: number, orient: number): Slot => ({ dx, dy, scale, alpha, orient, rotation: 0, wrap: 0 });
    const vertical = typography === 'vertical';
    const orient = vertical ? 1 : 0;
    if (relative === 0) return slot(0, 0, 1, 1, orient);
    const previous = relative < 0;
    const far = Math.abs(relative) > 1;
    const nearScale = vertical ? 0.58 : 0.52;
    const scale = far ? (vertical ? 0.48 : 0.44) : nearScale;
    const gap = STACK_GAP[vertical ? 'vertical' : 'horizontal'];
    const sign = previous ? -1 : 1;
    let offset = across(0, 1) / 2 + (previous ? gap.previous : gap.next) * fontH;
    if (far) offset += across(sign, nearScale) + (previous ? gap.farPrevious : gap.farNext) * fontH;
    offset += across(relative, scale) / 2;
    const alpha = previous ? (far ? 0 : 0.9) : (far ? 0 : nextAlpha);
    if (vertical) {
        // 竖排从右往左读：上一行在右、下一行在左。
        return slot(-sign * offset, sign * (far ? 0.07 : 0.03), scale, alpha, orient);
    }
    return slot(sign * region.w * (far ? 0.24 : 0.16), sign * offset, scale, alpha, orient);
};

/** 按需构建：当前行前后各画几行、往后预先建几行、离开窗口多远才释放。 */
const WINDOW_REACH = 3;
const PREBUILD = 2;
const KEEP_MARGIN = 2;

/** 纵横交错时邻行与当前行之间至少留的空隙（以字号为单位）。 */
const CROSSED_CLEARANCE = 0.5;

/** 堆叠轴：横排与纵横交错时各行上下排开（y），竖排时左右排开（x）。 */
const stackX = (kind: WindowTypography) => (kind === 'vertical' ? 1 : 0);
/**
 * 当前行为 c、排版为 kind 时第 index 行背离当前行的方向（堆叠轴上的 ±1，当前行为 0）：横排与纵横交错时
 * 上一行在上、下一行在下；竖排右起，上一行在右、下一行在左。
 */
const awayOf = (index: number, c: number, kind: WindowTypography) => (
    (index === c ? 0 : index < c ? -1 : 1) * (kind === 'vertical' ? -1 : 1)
);

const sameSlot = (a: Slot, b: Slot) => a.dx === b.dx && a.dy === b.dy && a.scale === b.scale
    && a.alpha === b.alpha && a.orient === b.orient && a.rotation === b.rotation && a.wrap === b.wrap;

export const createLyricWindow = (pixi: PixiModule, options: LyricWindowOptions): LyricWindow => {
    const { height, region, heroPx, sprites, typography, decay } = options;
    const view = new pixi.Container();
    const trackLayer = new pixi.Graphics();
    const halos = new pixi.Container();
    const glyphLayer = new pixi.Container();
    const stars = new pixi.Container();
    const spots = new pixi.Container();
    view.addChild(spots, trackLayer, halos, glyphLayer, stars);
    const spacing = options.letterSpacing ?? 0;
    const nextAlpha = options.neighbors >= 2 ? 0.95 : 0;
    // 长度上限：横排用画框内的整个宽度（纵横交错留一成给四周的行），竖排用画框内的整个高度（避开底部字幕）。
    // 文字区只决定中心，不再限制行长。
    const band = frameBand(options.width, height);
    const columnCap = (band.bottom - band.top) * height;
    const maxWidthOf = (kind: WindowTypography) => (band.right - band.left) * height * (kind === 'crossed' ? 0.9 : 1);
    const measurer = createTextMeasurer(options.font, options.weight, spacing);
    const KEYWORDS = options.keywords && options.keywords.length > 0 ? options.keywords : undefined;

    const metas = buildLineMetas(options.lines);
    const lineCount = options.lines.length;
    /** 已构建的行（没建的是 null）与它们的行号（升序）：各层里的子节点按行号排，画的先后与构建顺序无关。 */
    const views: Array<LineView | null> = new Array<LineView | null>(lineCount).fill(null);
    const built: number[] = [];
    const buildContext = {
        pixi,
        font: options.font,
        weight: options.weight,
        resolution: options.resolution,
        heroPx,
        spacing,
        seed: options.seed,
        sprites,
        measurer,
        limits: { horizontal: maxWidthOf('horizontal'), vertical: columnCap },
        keywords: KEYWORDS,
        driftSpeed: DRIFT_SPEED,
        placementsOf: (lineIndex: number) => freePlacements(createRng(`${options.seed}:placements:${lineIndex}`), region, nextAlpha),
    };
    let tintedFor: Rgb | null = null;
    /** 把 child 插到 parent 里行号 lineIndex 该在的位置（parent 里每个已构建的行各有一个子节点）。 */
    const insertByLine = (parent: Container, child: Container, position: number) => {
        if (position >= parent.children.length) parent.addChild(child);
        else parent.addChildAt(child, position);
    };
    /** 构建第 index 行：随机流跳到这一行的起点，结果与从第一行起顺序构建时一样。 */
    const buildLine = (index: number): LineView => {
        const meta = metas[index]!;
        const lineView = buildLineView(buildContext, index, meta, createRngAt(`${options.seed}:window`, meta.randomOffset));
        let position = 0;
        while (position < built.length && built[position]! < index) position += 1;
        built.splice(position, 0, index);
        insertByLine(glyphLayer, lineView.holder, position);
        insertByLine(halos, lineView.haloLayer, position);
        insertByLine(stars, lineView.starLayer, position);
        insertByLine(spots, lineView.spot, position);
        if (tintedFor) for (const glyph of lineView.keywordGlyphs) glyph.tints = keywordTints(tintedFor, glyph.keyword!);
        views[index] = lineView;
        return lineView;
    };
    const releaseLine = (index: number) => {
        const lineView = views[index];
        if (!lineView) return;
        views[index] = null;
        built.splice(built.indexOf(index), 1);
        for (const item of [lineView.holder, lineView.haloLayer, lineView.starLayer, lineView.spot]) {
            item.parent?.removeChild(item);
            item.destroy({ children: true });
        }
        lineView.layout.destroy();
    };
    const lineOf = (index: number): LineView => views[index] ?? buildLine(index);

    const fontH = heroPx / height;
    const driftScale = options.drift ?? 1;
    /** 第 c 行成为当前行时的排版（c = −1 即第一行之前，按第一行的排版）。 */
    const typographyAt = (c: number): WindowTypography => (
        options.typographyOf ? options.typographyOf(Math.max(0, Math.min(lineCount - 1, c))) : typography
    );

    /**
     * 第 index 行在槽位缩放 scale、朝向 orient 下落定的样子：单行缩到 SINGLE_MIN_FIT 还放不下才折，
     * 折了还放不下再整体缩小（邻行本身已经小，很少需要折）。
     */
    const settle = (index: number, kind: WindowTypography, orient: 0 | 1, scale: number) => {
        const flow = lineOf(index).flow[orient];
        const budget = orient === 1 ? columnCap : maxWidthOf(kind);
        const wrap = shouldWrap(flow, budget, scale) ? 1 : 0;
        const variant: LineVariant = flow[wrap];
        return { wrap, variant, scale: scale * fitScale(variant.along, budget, scale) };
    };
    /** 第 index 行垂直于行方向的厚度（高度单位，已缩放）；不存在的行（第一行之前）按一个字号。 */
    const acrossOf = (index: number, kind: WindowTypography, orient: 0 | 1, scale: number) => {
        if (index < 0 || index >= lineCount) return fontH * scale;
        const settled = settle(index, kind, orient, scale);
        return (settled.variant.across / height) * settled.scale;
    };
    /** 把当前行整块放进画框的偏移（高度单位）：整个窗口一起挪，行距不变。文字区的中心仍是锚点。 */
    const windowShift = (current: number, kind: WindowTypography): Point => {
        if (current < 0 || current >= lineCount) return { x: 0, y: 0 };
        const orient = kind === 'vertical' ? 1 : 0;
        const { variant, scale } = settle(current, kind, orient, 1);
        const w = (variant.inkWidth / height) * scale;
        const h = (variant.inkHeight / height) * scale;
        return {
            x: clampInto(region.cx, w, band.left, band.right) - region.cx,
            y: clampInto(region.cy, h, band.top, band.bottom) - region.cy,
        };
    };

    // 槽位是（行、当前行、排版）的纯函数，每帧会反复查（径迹还要回溯几十个时刻），缓存起来。
    const slotCache = new Map<string, Slot>();
    /** 当前行为 current、排版为 kind 时第 index 行的槽位（含把当前行放进画框的整体偏移与这一行的折行）。 */
    const slotOf = (index: number, current: number, kind: WindowTypography): Slot => {
        const key = `${index}|${current}|${kind}`;
        const cached = slotCache.get(key);
        if (cached) return cached;
        const view = lineOf(index);
        const clamped = Math.max(-2, Math.min(2, index - current));
        const shift = windowShift(current, kind);
        let slot: Slot;
        let wrap: number | null = null;
        if (kind === 'crossed' && clamped !== 0) {
            // 纵横交错：自由落点在当前行的上半圈 / 下半圈，但要让开当前行（折成两行时更高）：邻行整块的上下边
            // 与当前行之间至少留一段空隙。竖着的邻行很长，当前行与画框之间放不下时先折成两列，还放不下再缩小。
            const base = view.placements.get(clamped)!;
            const baseOrient = base.orient >= 0.5 ? 1 : 0;
            const sign = base.dy < 0 ? -1 : 1;
            const currentHalf = current >= 0 && current < lineCount
                ? (() => {
                    const settled = settle(current, kind, 0, 1);
                    return (settled.variant.inkHeight / height) * settled.scale / 2;
                })()
                : fontH / 2;
            const gap = fontH * CROSSED_CLEARANCE;
            const centerY = region.cy + shift.y;
            const room = sign < 0 ? centerY - currentHalf - gap - band.top : band.bottom - (centerY + currentHalf + gap);
            const flow = view.flow[baseOrient];
            const budget = baseOrient === 1 ? columnCap : maxWidthOf(kind);
            /** 在缩放 s、折法 w 下这一行整块（含落点的倾斜）的高度（高度单位）。 */
            const tilt = Math.abs(base.rotation) + 0.03;
            const heightOf = (w: 0 | 1, s: number) => (
                ((flow[w].inkHeight * Math.cos(tilt) + flow[w].inkWidth * Math.sin(tilt)) / height) * s * fitScale(flow[w].along, budget, s)
            );
            let scale = base.scale;
            let w: 0 | 1 = settle(index, kind, baseOrient, scale).wrap ? 1 : 0;
            if (baseOrient === 1 && room > 0) {
                if (w === 0 && flow[1].lines > 1 && heightOf(0, scale) > room) w = 1;
                const tall = heightOf(w, scale);
                if (tall > room) scale = Math.max(base.scale * 0.5, scale * (room / tall));
            }
            wrap = w;
            const clearance = currentHalf + gap + heightOf(w, scale) / 2;
            const dy = sign * Math.max(Math.abs(base.dy), clearance);
            // 竖着的邻行折成两列时更宽，沿原来的方向再推开多出来的那一半。
            const wider = baseOrient === 1 ? Math.max(0, acrossOf(index, kind, 1, scale) - fontH * scale) / 2 : 0;
            slot = { ...base, scale, dy, dx: base.dx + Math.sign(base.dx) * wider };
        } else {
            const orient = kind === 'vertical' ? 1 : 0;
            slot = fixedSlot(kind === 'crossed' ? 'horizontal' : kind, clamped, region, fontH, nextAlpha, (offset, scale) => (
                acrossOf(offset === clamped ? index : current + offset, kind, orient, scale)
            ));
        }
        const result: Slot = {
            ...slot,
            dx: slot.dx + shift.x,
            dy: slot.dy + shift.y,
            wrap: wrap ?? settle(index, kind, slot.orient >= 0.5 ? 1 : 0, slot.scale).wrap,
        };
        slotCache.set(key, result);
        return result;
    };

    /**
     * 时刻 time 起还没「走完多时」的第一次换行（current + 1 = 全都走完了）：更早的换行对每一行都已滑完、径迹也已收拢
     * （按最晚的起步 SLIDE_LAG 估，保守）。行的开始时刻是升序的，从当前行往回找几步就到。
     */
    const firstLiveChange = (time: number, current: number) => {
        let c = current;
        while (c >= 0 && options.lines[c]!.startTime - LEAD + MAX_LAG + SLIDE + TRACK_TIME > time) c -= 1;
        return c + 1;
    };

    /**
     * 第 index 行在时刻 time 的位置（逻辑像素）、缩放、转角、透明度与槽位切换信息。纯函数，径迹与爆闪也用它。
     *
     * 叠加式：位置 = 第一行开始前的槽位 + Σ 每次换行带来的槽位差 × 这次换行对这一行的缓动进度。
     * 每次换行对各行错开起步（离场的先走），两行间隔很短、上一次还没走完时也连续，不会跳。
     * 已经走完多时的换行进度都是 1，前后相消（槽位差首尾相接），所以直接从它们之后的槽位起叠：
     * 与从头叠加结果相同，只用到当前行附近几行的排版（整首歌一个单元时不用构建前面所有的行）。
     */
    const lineTransform = (index: number, time: number): LineTransform => {
        const view = lineOf(index);
        const { current } = resolveWindowCursor(options.lines, time);
        const first = firstLiveChange(time, current);
        const base = first - 1;
        const initialKind = typographyAt(base);
        const initial = slotOf(index, base, initialKind);
        let dx = initial.dx, dy = initial.dy, scale = initial.scale, rotation = initial.rotation;
        let alpha = initial.alpha, orient = initial.orient, wrap = initial.wrap;
        // 最近一次正在（或刚刚）作用于这一行的换行：给字的飞行曲线与径迹用。
        let latest: { before: Slot; after: Slot; phase: number; start: number; kind: WindowTypography } | null = null;
        let restOrient = initial.orient;
        let restWrap = initial.wrap;
        const moves: LineTransform['moves'] = [];
        // 随排版变化的量（宽度上限、错落）也跟着换行叠加，排版切换时不跳。
        let widthCap = maxWidthOf(initialKind);
        let jitterOn = initialKind === 'crossed' ? 0 : 1;
        // 间隙：背离当前行的方向（x、y 各一份，堆叠轴上的 ±1 × 作为邻行的权重）与作为当前行的权重，
        // 同样按换行叠加，换行与排版切换时连续。
        let awayX = stackX(initialKind) * awayOf(index, base, initialKind);
        let awayY = (1 - stackX(initialKind)) * awayOf(index, base, initialKind);
        let hero = index === base ? 1 : 0;
        // 槽位差为 0 的换行直接跳过。
        const last = Math.min(lineCount - 1, current);
        for (let c = first; c <= last; c += 1) {
            const beforeKind = typographyAt(c - 1);
            const afterKind = typographyAt(c);
            const before = slotOf(index, c - 1, beforeKind);
            const after = slotOf(index, c, afterKind);
            const kindChanged = beforeKind !== afterKind;
            if (sameSlot(before, after) && !kindChanged) continue;
            const { phase, start } = resolveLinePhase(options.lines, c, index - c, time);
            const k = easeInOutSine(phase);
            if (kindChanged) {
                widthCap += (maxWidthOf(afterKind) - maxWidthOf(beforeKind)) * k;
                jitterOn += ((afterKind === 'crossed' ? 0 : 1) - (beforeKind === 'crossed' ? 0 : 1)) * k;
            }
            const awayBefore = awayOf(index, c - 1, beforeKind);
            const awayAfter = awayOf(index, c, afterKind);
            awayX += (stackX(afterKind) * awayAfter - stackX(beforeKind) * awayBefore) * k;
            awayY += ((1 - stackX(afterKind)) * awayAfter - (1 - stackX(beforeKind)) * awayBefore) * k;
            hero += ((index === c ? 1 : 0) - (index === c - 1 ? 1 : 0)) * k;
            // 透明度不跟位移同一条曲线：要淡出的先走（前 60%），要淡入的后到（后 60%）。
            const fade = after.alpha < before.alpha
                ? easeInOutCubic(phase / 0.6)
                : after.alpha > before.alpha ? easeInOutCubic((phase - 0.4) / 0.6) : k;
            dx += (after.dx - before.dx) * k;
            dy += (after.dy - before.dy) * k;
            scale += (after.scale - before.scale) * k;
            rotation += (after.rotation - before.rotation) * k;
            alpha += (after.alpha - before.alpha) * fade;
            orient += (after.orient - before.orient) * phase;
            wrap += (after.wrap - before.wrap) * k;
            if (phase > 0) latest = { before, after, phase, start, kind: afterKind };
            if (phase >= 1) {
                restOrient = after.orient;
                restWrap = after.wrap;
                moves.length = 0;
            } else if (phase > 0) {
                moves.push({
                    toOrient: after.orient,
                    toWrap: after.wrap,
                    phase,
                    fly: options.alwaysFly === true || afterKind === 'crossed' || before.orient !== after.orient,
                });
            }
        }
        // 太长时整体缩小，不出画框（横排看宽度、竖排看长度；单行 / 折行按折行程度混合）。
        const o = clamp01(orient);
        const w = clamp01(wrap);
        const [hSingle, hWrapped] = view.flow[0];
        const [vSingle, vWrapped] = view.flow[1];
        const fitH = lerp(fitScale(hSingle.along, widthCap, scale), fitScale(hWrapped.along, widthCap, scale), w);
        const fitV = lerp(fitScale(vSingle.along, columnCap, scale), fitScale(vWrapped.along, columnCap, scale), w);
        const fitted = scale * lerp(fitH, fitV, o);
        // 错落只作用在固定槽位的邻行上（横排时横向、竖排时纵向），当前行居中。
        const jitter = jitterOn * view.jitter * region.w * clamp01((1 - scale) / 0.5);
        // 固定槽位里每一行沿自己的方向不出画框（横排左右、竖排上下）：邻行排在垂直于行的方向上，挪了也压不到
        // 当前行。纵横交错的邻行是自由落点，沿行挪可能挪进当前行里，保持原样（和错落一样只作用在固定槽位上）。
        // 漂移不算在里面，照常漂。
        const baseX = region.cx + dx + jitter * (1 - orient);
        const baseY = region.cy + dy + jitter * 0.5 * orient;
        const alongH = (lerp(hSingle.inkWidth, hWrapped.inkWidth, w) / height) * fitted;
        const alongV = (lerp(vSingle.inkHeight, vWrapped.inkHeight, w) / height) * fitted;
        const x = baseX + (clampInto(baseX, alongH, band.left, band.right) - baseX) * (1 - o) * jitterOn;
        const y = baseY + (clampInto(baseY, alongV, band.top, band.bottom) - baseY) * o * jitterOn;
        // 永不停止的漂移：以这一行开始唱的时刻为零点匀速漂（唱的时候正好在槽位上），再叠一点绕行、摆动与呼吸。
        // 让开当前行（lineClearance）：邻行朝当前行的那一份翻成背离；当前行不越漂越远，绕一个小圆，速度不变。
        const age = time - view.line.startTime;
        const m = view.motionPhase;
        const { x: vx, y: vy } = view.velocity;
        const orbitX = Math.sin(time * 0.52 + m) * ORBIT;
        const orbitY = Math.cos(time * 0.41 + m * 1.3) * ORBIT * 0.7;
        const held = clamp01(hero);
        const driftX = lerp(awayDrift((vx * age + orbitX) * driftScale, awayX), (heldDrift(vx, vy, age, 0) + orbitX) * driftScale, held);
        const driftY = lerp(awayDrift((vy * age + orbitY) * driftScale, awayY), (heldDrift(vx, vy, age, 1) + orbitY) * driftScale, held);
        const settledOrient = latest ? latest.after.orient : initial.orient;
        const settledWrap = latest ? latest.after.wrap : initial.wrap;
        return {
            current,
            x: (x + driftX) * height,
            y: (y + driftY) * height,
            scale: fitted * (1 + 0.025 * Math.sin(time * 0.43 + m)),
            rotation: rotation + 0.03 * Math.sin(time * 0.23 + m * 0.7),
            alpha: clamp01(alpha),
            fromOrient: latest ? latest.before.orient : settledOrient,
            toOrient: settledOrient,
            fromWrap: latest ? latest.before.wrap : settledWrap,
            toWrap: settledWrap,
            wrap: w,
            orient: o,
            phase: latest ? latest.phase : 1,
            // 纵横交错时每次换槽位都飞；另两种排版只在朝向变化时飞。
            fly: latest !== null && latest.phase < 1
                && (options.alwaysFly === true || latest.kind === 'crossed' || latest.before.orient !== latest.after.orient),
            slideStart: latest ? latest.start : Number.NEGATIVE_INFINITY,
            restOrient,
            restWrap,
            moves,
        };
    };

    /**
     * 字在行内的位置（未缩放）、转角与缩放：换槽位时沿自己的贝塞尔曲线飞过去，途中缩小、转动、发亮
     * （flying 为飞行强度 0..1）。再加上聚合、崩解与呼吸。
     */
    const glyphLocal = (view: LineView, glyph: GlyphView, time: number, transform: LineTransform) => {
        const at = (orient: number, wrap: number) => view.flow[orient >= 0.5 ? 1 : 0][wrap >= 0.5 ? 1 : 0].points[glyph.index]!;
        // 从上一次走完的换位的终点出发，依次叠上还在进行的换位：每一次都从上一次此刻的位置起飞（或滑过去），
        // 前一次还没飞完就换行时，字接着从它在曲线上的位置出发，不会跳回起点。
        let point = at(transform.restOrient, transform.restWrap);
        let orientation = transform.restOrient;
        let flying = 0;
        for (const move of transform.moves) {
            const target = at(move.toOrient, move.toWrap);
            if (move.fly) {
                const s = flightProgress(glyph.flight, move.phase);
                point = flightPoint(glyph.flight, point, target, s);
                orientation = lerp(orientation, move.toOrient, s);
                flying = Math.max(flying, Math.sin(Math.PI * s));
            } else {
                // 不飞的时候，单行与折行之间（邻行变成当前行、需要折开时）字随滑动缓动过去。
                const k = easeInOutSine(move.phase);
                point = lerpPoint(point, target, k);
                orientation = lerp(orientation, move.toOrient, k);
            }
        }
        let x = point.x;
        let y = point.y;
        let rotation = glyph.vRotation * orientation + glyph.flight.spin * flying;
        const pulse = 1 - 0.28 * flying;
        // 聚合：未唱的行从散开的位置逐渐收拢。
        const gather = smooth((time - (view.line.startTime - LEAD - GATHER_LEAD)) / GATHER);
        const scatter = (1 - gather) ** 2 * decay.strength;
        x += glyph.scatter.x * heroPx * scatter;
        y += glyph.scatter.y * heroPx * scatter;
        // 崩解：点亮一会儿之后沿各自的方向漂离、转动。
        const amount = decayAmount(decay, glyph.timing.start, time) * glyph.drift.speed;
        x += glyph.drift.dx * heroPx * amount;
        y += glyph.drift.dy * heroPx * amount;
        rotation += glyph.drift.spin * amount * 0.18;
        // 呼吸：一直有一点轻微晃动。
        const breath = heroPx * 0.022 * Math.min(1, decay.strength + 0.3);
        x += Math.sin(time * 0.9 + glyph.phase) * breath;
        y += Math.cos(time * 1.13 + glyph.phase * 1.7) * breath;
        return { x, y, rotation, gather, flying, scale: glyph.scale * pulse };
    };

    /** 行内坐标 → 画面坐标（行的转角、缩放、位置）。 */
    const toWorld = (transform: LineTransform, point: Point): Point => {
        const cos = Math.cos(transform.rotation);
        const sin = Math.sin(transform.rotation);
        return {
            x: transform.x + (point.x * cos - point.y * sin) * transform.scale,
            y: transform.y + (point.x * sin + point.y * cos) * transform.scale,
        };
    };

    /**
     * 径迹：字在画面上过去 TRACK_TIME 秒里真正走过的路（叠加了行本身的移动、转动与缩放），加一点
     * 垂直方向的抖动，像云室里的粒子径迹；字到位后尾端追上来，径迹收拢消失。只画这一次滑动开始之后的部分。
     */
    const drawTracks = (index: number, view: LineView, time: number, transform: LineTransform, alpha: number, color: number) => {
        if (alpha <= 0.003 || !Number.isFinite(transform.slideStart)) return;
        if (time > transform.slideStart + SLIDE + TRACK_TIME) return;
        const from = Math.max(transform.slideStart, time - TRACK_TIME);
        if (time - from < 1e-3) return;
        const samples = Array.from({ length: TRACK_SAMPLES + 1 }, (_, i) => from + ((time - from) * i) / TRACK_SAMPLES);
        const transforms = samples.map(sample => lineTransform(index, sample));
        if (!transforms.some(sample => sample.fly)) return;
        const width = 1.2;
        view.glyphs.forEach(glyph => {
            if (glyph.blank) return;
            let length = 0;
            let previous: Point | null = null;
            let fontPx = heroPx;
            let flying = 0;
            samples.forEach((sample, i) => {
                const local = glyphLocal(view, glyph, sample, transforms[i]!);
                const world = toWorld(transforms[i]!, local);
                fontPx = heroPx * transforms[i]!.scale * local.scale;
                flying = local.flying;
                const wobble = Math.sin(i * 0.9 + glyph.flight.wobble + sample * 6) * heroPx * 0.02;
                const x = world.x + wobble;
                const y = world.y - wobble * 0.6;
                if (previous) {
                    length += Math.hypot(x - previous.x, y - previous.y);
                    trackLayer.lineTo(x, y);
                } else {
                    trackLayer.moveTo(x, y);
                }
                previous = { x, y };
            });
            // 径迹越长（字飞得越快）越亮；几乎不动的字不留径迹。字头落在当前行的保护框里时，整条径迹跟字一起压暗
            // （与字身同一条规则，飞行途中不压）。
            const strength = Math.min(1, length / (heroPx * 3));
            const head = previous as Point | null;
            const shield = head && protectCount > 0
                ? protectedAlpha(protectionAt(protectBoxes, protectCount, index, head.x, head.y, fontPx / 2) * (1 - flying))
                : 1;
            trackLayer.stroke({ width, color, alpha: strength > 0.05 ? alpha * 0.55 * strength * shield : 0, cap: 'round', join: 'round' });
        });
    };

    /** 关键字在当前光色下的颜色：光色不变时（通常整个单元都不变）只算一次；之后新建的行在构建时按它上色。 */
    const refreshKeywordTints = (litColor: Rgb) => {
        if (tintedFor && tintedFor[0] === litColor[0] && tintedFor[1] === litColor[1] && tintedFor[2] === litColor[2]) return;
        tintedFor = [litColor[0], litColor[1], litColor[2]];
        for (const index of built) {
            for (const glyph of views[index]!.keywordGlyphs) glyph.tints = keywordTints(litColor, glyph.keyword!);
        }
    };

    // 当前行的保护框：每帧最多几个（换行交接时新旧当前行各一个，两次换行挨得很近时再多一两个），预先建好反复用。
    const protectBoxes = [createProtectBox(), createProtectBox(), createProtectBox(), createProtectBox()];
    let protectCount = 0;
    const frameTransforms: LineTransform[] = new Array<LineTransform>(lineCount);

    /**
     * 这一帧的保护框：第 j 行作为当前行的权重 = 它这次换行的缓动进度 − 下一次换行的缓动进度（换行进度都是 t 的
     * 连续函数，所以权重也连续，求和为 1）。框是第 j 行此刻的墨迹框（横竖 × 单行 / 折行按当前的朝向与折行程度混合），
     * 跟着它的位置、缩放与转角。横竖转到一半时（字在飞、混合出来的框又宽又高，框边扫得很快）框渐隐，转完再回来。
     * 要先算好这一帧所有行的变换（frameTransforms）。
     */
    const buildProtectBoxes = (time: number, current: number, low: number) => {
        protectCount = 0;
        let later = 0;
        for (let j = current; j >= low && protectCount < protectBoxes.length; j -= 1) {
            const eased = easeInOutSine((time - (options.lines[j]!.startTime - LEAD)) / SLIDE);
            const transform = frameTransforms[j]!;
            const o = clamp01(transform.orient);
            const weight = (eased - later) * clamp01(transform.alpha) * (1 - 4 * o * (1 - o));
            later = eased;
            if (weight > 1e-4) {
                const [hSingle, hWrapped] = lineOf(j).flow[0];
                const [vSingle, vWrapped] = lineOf(j).flow[1];
                const w = transform.wrap;
                const inkW = lerp(lerp(hSingle.inkWidth, hWrapped.inkWidth, w), lerp(vSingle.inkWidth, vWrapped.inkWidth, w), transform.orient);
                const inkH = lerp(lerp(hSingle.inkHeight, hWrapped.inkHeight, w), lerp(vSingle.inkHeight, vWrapped.inkHeight, w), transform.orient);
                const box = protectBoxes[protectCount]!;
                box.line = j;
                box.x = transform.x;
                box.y = transform.y;
                box.cos = Math.cos(transform.rotation);
                box.sin = Math.sin(transform.rotation);
                box.halfW = (inkW / 2) * transform.scale;
                box.halfH = (inkH / 2) * transform.scale;
                box.margin = PROTECT_MARGIN * heroPx * transform.scale;
                box.weight = weight;
                protectCount += 1;
            }
            if (eased >= 1) break;
        }
    };

    /**
     * 这一帧要画的行：当前行前后各 WINDOW_REACH 行，还在滑动（或径迹还没收拢）的换行再往前 WINDOW_REACH 行——
     * 槽位要看当前行 ±2 行的排版，更远的行透明度都是 0。只由时刻决定。
     */
    const activeRange = (time: number) => {
        const { current } = resolveWindowCursor(options.lines, time);
        const first = firstLiveChange(time, current);
        return {
            current,
            low: Math.max(0, Math.min(current, first) - WINDOW_REACH),
            high: Math.min(lineCount - 1, Math.max(current, 0) + WINDOW_REACH),
        };
    };
    /** 窗口外的行藏起来，离得更远的释放（留一点余量，来回拖动进度时不反复重建）。 */
    const syncBuilt = (low: number, high: number) => {
        for (let k = built.length - 1; k >= 0; k -= 1) {
            const index = built[k]!;
            if (index >= low && index <= high) continue;
            if (index < low - KEEP_MARGIN || index > high + KEEP_MARGIN) {
                releaseLine(index);
                continue;
            }
            const lineView = views[index]!;
            lineView.holder.visible = false;
            lineView.haloLayer.visible = false;
            lineView.starLayer.visible = false;
            lineView.spot.visible = false;
        }
    };
    /** 往后预先建几行（每帧最多一行），当前行换过去时不用当场构建。 */
    const prebuild = (high: number) => {
        for (let index = high + 1; index <= Math.min(lineCount - 1, high + PREBUILD); index += 1) {
            if (views[index]) continue;
            buildLine(index);
            const lineView = views[index]!;
            lineView.holder.visible = false;
            lineView.haloLayer.visible = false;
            lineView.starLayer.visible = false;
            lineView.spot.visible = false;
            return;
        }
    };

    const update = (frame: LyricWindowFrame) => {
        const { time, beams, litColor, unlitColor, unlitAlpha, intensity } = frame;
        // 只有当前背景是 tide 且它开着跟随歌词时才发布锚点；否则这一帧的字形位置没人读，
        // getGlobalPosition() 纯属浪费（别的背景不该替 tide 付这份钱）。
        const publishTideAnchors = shouldPublishTideAnchors();
        trackLayer.clear();
        if (KEYWORDS) refreshKeywordTints(litColor);
        const litHex = hexOf(litColor);
        const starHex = hexOf(mixRgb(litColor, WHITE, 0.5));
        const { low, high, current: cursor } = activeRange(time);
        syncBuilt(low, high);
        for (let index = low; index <= high; index += 1) frameTransforms[index] = lineTransform(index, time);
        buildProtectBoxes(time, cursor, low);

        for (let index = low; index <= high; index += 1) {
            const view = views[index]!;
            const transform = frameTransforms[index]!;
            const { current, scale } = transform;
            const lineAlpha = transform.alpha * intensity;
            const visible = lineAlpha > 0.003;
            view.holder.visible = visible;
            view.haloLayer.visible = visible;
            view.starLayer.visible = visible;
            view.holder.position.set(transform.x, transform.y);
            view.holder.scale.set(scale);
            view.holder.rotation = transform.rotation;
            const passed = index < current || (index === current && time > view.line.endTime);
            const passedAge = passed ? time - view.line.endTime : 0;
            const passedDim = passed ? lerp(1, 0.75, clamp01(passedAge / 2.5)) : 1;
            const lineFontPx = heroPx * scale;
            drawTracks(index, view, time, transform, lineAlpha * passedDim, litHex);

            for (const glyph of view.glyphs) {
                if (glyph.blank) continue;
                if (!visible) {
                    glyph.glyph.visible = false;
                    glyph.halo.visible = false;
                    glyph.star.visible = false;
                    continue;
                }
                const local = glyphLocal(view, glyph, time, transform);
                glyph.glyph.position.set(local.x, local.y);
                glyph.glyph.rotation = local.rotation;
                glyph.glyph.scale.set(local.scale / MAX_WORD_SCALE);
                // 这个字实际的字号（光晕、闪点按它定大小）。
                const fontPx = lineFontPx * local.scale;
                const { x: gx, y: gy } = toWorld(transform, local);
                const lit = smooth((time - glyph.timing.start) / Math.max(glyph.timing.end - glyph.timing.start, LIGHT_UP));
                const flash = flashEnvelope(glyph.timing, time, 0.45);
                const illumination = compressLight(lightAt(beams, gx / height, gy / height));
                // 闪点主要由星形小亮点表现，字身只略微提亮：字身一旦接近白色，文字组的强 bloom 会把笔画糊在一起。
                const heat = clamp01(illumination * 1.3 + flash * 0.2);
                // 崩解得越远越淡，像散进烟里。
                const dissolve = 1 - clamp01((decayAmount(decay, glyph.timing.start, time) * glyph.drift.speed - DISSOLVE_FROM) / DISSOLVE_SPAN);
                // 落进当前行的保护框就压暗（字身、光晕、闪点一起），当前行始终清楚。飞行途中的字一闪而过、本来就在发亮，
                // 不压（按飞行强度渐变）：否则它们高速穿过框边时透明度会一帧一帧地陡变。
                const shield = protectCount > 0
                    ? protectedAlpha(protectionAt(protectBoxes, protectCount, index, gx, gy, fontPx / 2) * (1 - local.flying))
                    : 1;
                const glyphAlpha = lineAlpha * passedDim * dissolve * (0.35 + 0.65 * local.gather) * shield;

                glyph.glyph.visible = true;
                // 没唱到的字也会被光柱照出来（冷色、半亮），唱到之后才是暖金色并带辉光；飞行中的字像带电粒子一样发亮。
                const revealed = Math.min(1, unlitAlpha + illumination * 0.45 + local.flying * 0.4);
                glyph.glyph.alpha = glyphAlpha * (revealed * (1 - lit) + lit * Math.min(1, 0.55 + 0.4 * heat + 0.3 * local.flying));
                // 逐字发布给 tide：绘光的字画在 Pixi 画布里，DOM 里没有字形，tide 只能靠这条桥
                // 知道「字现在在哪、亮到什么程度」，水才做得出随字飘散。（见 tideAnchorBridge）
                // 关掉发布时不做任何事：本帧的锚点列表已由运行时 beginTideAnchors 清空，读到的是空，不是残影。
                if (publishTideAnchors) {
                    publishTideAnchorFrom(glyph.glyph, resolveGlyphAnchorStrength(time, glyph.timing.start, glyph.timing.end));
                }
                // 关键字：点亮后的字身、光晕、闪点换成关键字光色（未唱时仍是冷色）。
                const tints = glyph.tints;
                const hot = mixRgb(tints ? tints.glyph : litColor, WHITE, clamp01(0.08 * illumination + 0.1 * flash + 0.25 * local.flying));
                const cold = mixRgb(unlitColor, litColor, illumination * 0.35);
                glyph.glyph.tint = hexOf(mixRgb(cold, hot, lit));

                // bloom 已经很强，光晕与闪点只做「局部更亮」的那一点，不能叠成一团白。
                const haloAlpha = glyphAlpha * lit * (0.03 + 0.14 * illumination + 0.08 * flash) * (tints ? KEYWORD_HALO_GAIN : 1);
                glyph.halo.visible = haloAlpha > 0.003;
                if (glyph.halo.visible) {
                    glyph.halo.position.set(gx, gy);
                    const size = fontPx * (2.2 + 0.8 * illumination);
                    glyph.halo.width = size;
                    glyph.halo.height = size * 0.9;
                    glyph.halo.alpha = haloAlpha;
                    glyph.halo.tint = tints ? tints.halo : litHex;
                }

                const starAlpha = lineAlpha * flash * 0.55 * shield;
                glyph.star.visible = starAlpha > 0.003;
                if (glyph.star.visible) {
                    // 亮点避开笔画中心，按种子上下错落；闪的过程中略微转动。
                    const star = glyph.starShape;
                    glyph.star.position.set(gx + fontPx * star.dx, gy + fontPx * star.dy);
                    glyph.star.rotation = star.rotation * (1 + (1 - flash) * 0.6);
                    const size = fontPx * star.size * (0.8 + 0.5 * flash);
                    glyph.star.width = size;
                    glyph.star.height = size;
                    glyph.star.alpha = starAlpha;
                    glyph.star.tint = tints ? tints.star : starHex;
                }
            }

            // 追字光斑：沿行内连续移动，并对过去 SPOT_WINDOW 秒的位置取平均（仍只由 t 决定），
            // 字与字之间的停顿、快慢变化都被抹平；唱前 0.3s 淡入，唱完 0.6s 淡出。
            const spotAlpha = visible
                ? lineAlpha * smooth((time - view.singStart + 0.3) / 0.3) * (1 - smooth((time - view.singEnd) / 0.6))
                : 0;
            view.spot.visible = spotAlpha > 0.003;
            if (view.spot.visible) {
                // 光斑沿行心线（横排）或列心线（竖排）按阅读顺序走：折行时走完一行（一列）跳到下一行（下一列）的开头，
                // 两个坐标用同一套插值，跳的那一下也被时间平均抹平。
                const vertical = transform.toOrient >= 0.5;
                const spotOf = (wrap: 0 | 1): Point => {
                    const path = view.flow[vertical ? 1 : 0][wrap].spots;
                    return {
                        x: resolveSpotX(view.glyphs.map(glyph => ({ timing: glyph.timing, center: path[glyph.index]!.x })), time),
                        y: resolveSpotX(view.glyphs.map(glyph => ({ timing: glyph.timing, center: path[glyph.index]!.y })), time),
                    };
                };
                const local = transform.wrap <= 0 ? spotOf(0) : transform.wrap >= 1 ? spotOf(1) : lerpPoint(spotOf(0), spotOf(1), transform.wrap);
                const position = toWorld(transform, local);
                const size = lineFontPx * 5;
                view.spot.position.set(position.x, position.y);
                view.spot.rotation = transform.rotation;
                view.spot.width = size * (vertical ? 1 : 1.6);
                view.spot.height = size * (vertical ? 1.6 : 1);
                view.spot.alpha = 0.07 * spotAlpha;
                view.spot.tint = litHex;
            }
        }
        prebuild(high);
    };

    return {
        view,
        update,
        glyphTimes: lineIndex => {
            const meta = metas[lineIndex];
            if (!meta) return [];
            return meta.graphemes.flatMap((char, glyphIndex) => (
                char.trim().length === 0 ? [] : [{ glyphIndex, start: (lineTimingOf(meta).timings[glyphIndex] ?? { start: meta.line.startTime }).start }]
            ));
        },
        glyphAnchor: (lineIndex, glyphIndex, time) => {
            const transform = lineTransform(lineIndex, time);
            const view = lineOf(lineIndex);
            const local = glyphLocal(view, view.glyphs[glyphIndex]!, time, transform);
            const world = toWorld(transform, local);
            return { x: world.x, y: world.y, fontPx: heroPx * transform.scale * local.scale };
        },
        lineAnchor: (lineIndex, time) => {
            const transform = lineTransform(lineIndex, time);
            return { x: transform.x, y: transform.y, scale: transform.scale, alpha: transform.alpha };
        },
        glyphKeyword: (lineIndex, glyphIndex) => {
            const meta = metas[lineIndex];
            if (!meta || (meta.graphemes[glyphIndex] ?? '').trim().length === 0) return null;
            return keywordColorsOf(meta, KEYWORDS)?.[glyphIndex] ?? null;
        },
        destroy: () => {
            for (let k = built.length - 1; k >= 0; k -= 1) releaseLine(built[k]!);
            // trackLayer 是自建 context 的 Graphics，带 context: true 才会连 GPU 批数据一起放掉（见 lineArt 的 destroy）。
            view.destroy({ children: true, context: true });
        },
    };
};
