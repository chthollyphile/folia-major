// Copyright (c) 2026 chthollyphile
import type { Container } from 'pixi.js';
import type { Line } from '../../../../types';
import { compressLight, lightAt, type ResolvedBeam } from '../light/rig';
import type { LightSprites } from '../light/sprites';
import { hexOf, mixRgb, WHITE, type Rgb } from '../color';
import { createTextMeasurer, frameBand } from './lineWrap';
import { flashEnvelope } from './reveal';
import { MAX_WORD_SCALE } from './wordStyle';
import { keywordColorsOf, lineTimingOf, type LineView, type Point } from './windowLines';
import type { WordColorMatcher } from '../../wordColoring';
import { KEYWORD_HALO_GAIN } from './keywordColors';
import type { DecaySpec, LineTransform, WindowRegion, WindowTypography } from './windowTypes';
import {
    clamp01,
    decayAmount,
    DISSOLVE_FROM,
    DISSOLVE_SPAN,
    lerp,
    lerpPoint,
    LIGHT_UP,
    resolveSpotX,
    SLIDE,
    smooth,
    TRACK_SAMPLES,
    TRACK_TIME,
} from './windowTiming';
import { createWindowLineStore } from './windowLineStore';
import { createWindowGeometry, toWorld } from './windowGeometry';
import { createWindowProtection } from './windowProtection';

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
//
// 拆分：时间与缓动 windowTiming、槽位 windowSlots、按需构建的行 windowLineStore、几何（槽位、行变换、字位置）
// windowGeometry、当前行保护框 windowProtection；这里只装配各层、画径迹与每帧的字。
type PixiModule = typeof import('pixi.js');

export type { DecaySpec, WindowRegion, WindowTypography } from './windowTypes';
export { decayAmount, flightPoint, flightProgress, resolveLinePhase, resolveSpotX, resolveWindowCursor } from './windowTiming';
export { freePlacements } from './windowSlots';

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
    /** 隐藏全部径迹，不改变字的飞行路径；不给时保持原有效果。 */
    hideTrails?: boolean;
}

export type { GlyphFlight } from './windowLines';

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

export const createLyricWindow = (pixi: PixiModule, options: LyricWindowOptions): LyricWindow => {
    const { height, heroPx, decay } = options;
    const view = new pixi.Container();
    const trackLayer = new pixi.Graphics();
    const halos = new pixi.Container();
    const glyphLayer = new pixi.Container();
    const stars = new pixi.Container();
    const spots = new pixi.Container();
    // 径迹层几乎每帧重画。Pixi 8 里重画过的 Graphics 会让它所在的渲染组把绘制指令整组重排，原来就是整个舞台；
    // 给它一个自己的渲染组，重排的只有这一层。画的先后不变（还在 spots 与 halos 之间）。
    const trackHolder = new pixi.Container({ isRenderGroup: true });
    trackHolder.addChild(trackLayer);
    view.addChild(spots, trackHolder, halos, glyphLayer, stars);
    const lineCount = options.lines.length;
    const nextAlpha = options.neighbors >= 2 ? 0.95 : 0;
    // 长度上限：横排用画框内的整个宽度（纵横交错留一成给四周的行），竖排用画框内的整个高度（避开底部字幕）。
    // 文字区只决定中心，不再限制行长。
    const band = frameBand(options.width, height);
    const columnCap = (band.bottom - band.top) * height;
    const maxWidthOf = (kind: WindowTypography) => (band.right - band.left) * height * (kind === 'crossed' ? 0.9 : 1);
    const measurer = createTextMeasurer(options.font, options.weight, options.letterSpacing ?? 0);
    const KEYWORDS = options.keywords && options.keywords.length > 0 ? options.keywords : undefined;

    const lines = createWindowLineStore({
        pixi,
        options,
        lineCount,
        measurer,
        limits: { horizontal: maxWidthOf('horizontal'), vertical: columnCap },
        keywords: KEYWORDS,
        nextAlpha,
        glyphLayer,
        halos,
        stars,
        spots,
    });
    const { metas, lineOf } = lines;
    const geometry = createWindowGeometry({ options, lineCount, band, columnCap, maxWidthOf, nextAlpha, lineOf });
    const { lineTransform, glyphLocal, activeRange } = geometry;
    const protection = createWindowProtection({ lines: options.lines, heroPx, lineOf });
    const frameTransforms: LineTransform[] = new Array<LineTransform>(lineCount);

    /**
     * 径迹：字在画面上过去 TRACK_TIME 秒里真正走过的路（叠加了行本身的移动、转动与缩放），加一点
     * 垂直方向的抖动，像云室里的粒子径迹；字到位后尾端追上来，径迹收拢消失。只画这一次滑动开始之后的部分。
     */
    let tracksDrawn = false;
    const drawTracks = (index: number, view: LineView, time: number, transform: LineTransform, alpha: number, color: number) => {
        if (alpha <= 0.003 || !Number.isFinite(transform.slideStart)) return;
        if (time > transform.slideStart + SLIDE + TRACK_TIME) return;
        const from = Math.max(transform.slideStart, time - TRACK_TIME);
        if (time - from < 1e-3) return;
        const samples = Array.from({ length: TRACK_SAMPLES + 1 }, (_, i) => from + ((time - from) * i) / TRACK_SAMPLES);
        const transforms = samples.map(sample => lineTransform(index, sample));
        if (!transforms.some(sample => sample.fly)) return;
        const width = 1.2;
        tracksDrawn = true;
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
            const shield = head ? protection.shield(index, head.x, head.y, fontPx / 2, flying) : 1;
            // 几乎不动的字不留径迹：路径直接丢掉，不让一条看不见的线也去三角化。
            if (strength > 0.05) trackLayer.stroke({ width, color, alpha: alpha * 0.55 * strength * shield, cap: 'round', join: 'round' });
            else trackLayer.beginPath();
        });
    };

    const update = (frame: LyricWindowFrame) => {
        const { time, beams, litColor, unlitColor, unlitAlpha, intensity } = frame;
        trackLayer.visible = frame.hideTrails !== true;
        // 径迹只在行滑动时有；空着的层不再每帧 clear（clear 一个空 Graphics 也会让它重新合批）。
        if (tracksDrawn) {
            trackLayer.clear();
            tracksDrawn = false;
        }
        if (KEYWORDS) lines.refreshKeywordTints(litColor);
        const litHex = hexOf(litColor);
        const starHex = hexOf(mixRgb(litColor, WHITE, 0.5));
        const { low, high, current: cursor } = activeRange(time);
        lines.syncBuilt(low, high);
        for (let index = low; index <= high; index += 1) frameTransforms[index] = lineTransform(index, time);
        protection.build(time, cursor, low, frameTransforms);

        for (let index = low; index <= high; index += 1) {
            const view = lines.viewAt(index)!;
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
            if (trackLayer.visible) drawTracks(index, view, time, transform, lineAlpha * passedDim, litHex);

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
                const shield = protection.shield(index, gx, gy, fontPx / 2, local.flying);
                const glyphAlpha = lineAlpha * passedDim * dissolve * (0.35 + 0.65 * local.gather) * shield;

                glyph.glyph.visible = true;
                // 没唱到的字也会被光柱照出来（冷色、半亮），唱到之后才是暖金色并带辉光；飞行中的字像带电粒子一样发亮。
                const revealed = Math.min(1, unlitAlpha + illumination * 0.45 + local.flying * 0.4);
                glyph.glyph.alpha = glyphAlpha * (revealed * (1 - lit) + lit * Math.min(1, 0.55 + 0.4 * heat + 0.3 * local.flying));
                // 关键字：点亮后的字身、光晕、闪点换成关键字光色（未唱时仍是冷色）。
                const tints = glyph.tints;
                const hot = mixRgb(tints ? tints.glyph : litColor, WHITE, clamp01(0.08 * illumination + 0.1 * flash + 0.25 * local.flying));
                const cold = mixRgb(unlitColor, litColor, illumination * 0.35);
                glyph.glyph.tint = hexOf(mixRgb(cold, hot, lit));

                // bloom 已经很强，光晕与闪点只做「局部更亮」的那一点，不能叠成一团白。
                const haloAlpha = glyphAlpha * lit * (0.03 + 0.14 * illumination + 0.08 * flash) * (tints ? KEYWORD_HALO_GAIN : 1);
                // 光晕与闪点在一行里此起彼伏地亮灭。用 visible 藏的话，每亮灭一次 Pixi 都要把整个渲染组的绘制指令重排一遍；
                // 所以行可见时它们一直留在绘制指令里，不亮的缩成零大小：零面积的四边形不出任何像素，画面与藏起来一样。
                glyph.halo.visible = true;
                if (haloAlpha > 0.003) {
                    glyph.halo.position.set(gx, gy);
                    const size = fontPx * (2.2 + 0.8 * illumination);
                    glyph.halo.width = size;
                    glyph.halo.height = size * 0.9;
                    glyph.halo.alpha = haloAlpha;
                    glyph.halo.tint = tints ? tints.halo : litHex;
                } else {
                    glyph.halo.scale.set(0);
                }

                const starAlpha = lineAlpha * flash * 0.55 * shield;
                glyph.star.visible = true;
                if (starAlpha > 0.003) {
                    // 亮点避开笔画中心，按种子上下错落；闪的过程中略微转动。
                    const star = glyph.starShape;
                    glyph.star.position.set(gx + fontPx * star.dx, gy + fontPx * star.dy);
                    glyph.star.rotation = star.rotation * (1 + (1 - flash) * 0.6);
                    const size = fontPx * star.size * (0.8 + 0.5 * flash);
                    glyph.star.width = size;
                    glyph.star.height = size;
                    glyph.star.alpha = starAlpha;
                    glyph.star.tint = tints ? tints.star : starHex;
                } else {
                    glyph.star.scale.set(0);
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
        lines.prebuild(high);
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
            lines.releaseAll();
            // trackLayer 是自建 context 的 Graphics，带 context: true 才会连 GPU 批数据一起放掉（见 lineArt 的 destroy）。
            view.destroy({ children: true, context: true });
        },
    };
};