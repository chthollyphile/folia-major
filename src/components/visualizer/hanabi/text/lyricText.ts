// Copyright (c) 2026 chthollyphile
import type { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { buildLineGraphemeTimeline, splitLyricGraphemes } from '../../../../utils/lyrics/graphemeTiming';
import { segmentLyricWords } from '../../../../utils/lyrics/wordSegmentation';
import { createRng } from '../hanabiRandom';
import type { Line } from '../../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../../utils/fontStacks';
import { hanabiBackdropOf, resolveHanabiGlyphColors } from '../color';
import type { CreateHanabiText, GlyphAnchor, HanabiTextOptions, HanabiTextView } from '../types';
import {
    clamp01, combinePoses, ENTER_ARRIVAL, enterOrder, enterPose, exitPose, restPose, restSing, scheduleEnter, scheduleExit,
    singPose, stampShake, STAMP_IMPACT, type FxContext, type GlyphPose, type SingPose,
} from './animations';
import { blockLayoutParams, blockTextRole, createBlocks, darken, runFrame } from './blocks';
import {
    buildGlyphAtlas, createGlyphMeasure, isUprightGlyph, pickScrambleChars,
    type BuildGlyphAtlas, type GlyphEntry, type GlyphMeasure,
} from './glyphs';
import { layoutText, wordScales, type LayoutGlyphInput, type LayoutWordInput } from './layout';

// src/components/visualizer/hanabi/text/lyricText.ts
// 花火的文字引擎：一行歌词 → 逐字精灵（字 + 描边 + 硬阴影 + 特效层）与字底色块，入场 / 被唱强调 / 退场三段全由 t 决定。
// 色块与字分成 blocks / glyphs 两个子容器（分层导出），anchors(t) 给 MG 装饰件跟随每个字。

/** 可替换的依赖（单测在 node 里注入假的测量与图集）。 */
export interface HanabiTextDeps {
    measure?: GlyphMeasure;
    buildAtlas?: BuildGlyphAtlas;
}

export interface LineWord extends LayoutWordInput {
    text: string;
}

/** 行 → 词（字区间按 grapheme 计）：手动分词 → icu-folia → Intl.Segmenter；对不上时退回逐字。 */
export const lineWords = (line: Pick<Line, 'fullText' | 'wordSegments'>, count: number): LineWord[] => {
    const words: LineWord[] = [];
    let cursor = 0;
    segmentLyricWords(line).forEach(segment => {
        const length = splitLyricGraphemes(segment.segment).length;
        if (length === 0) return;
        const space = segment.segment.trim().length === 0;
        words.push({ text: segment.segment, start: cursor, end: cursor + length, blank: space || !segment.isWordLike, space, scale: 1 });
        cursor += length;
    });
    if (cursor === count) return words;
    return splitLyricGraphemes(line.fullText).map((char, index) => {
        const space = char.trim().length === 0;
        return { text: char, start: index, end: index + 1, blank: space || !/[\p{L}\p{N}]/u.test(char), space, scale: 1 };
    });
};

const mixColor = (a: number, b: number, t: number) => {
    if (t <= 0) return a;
    if (t >= 1) return b;
    const r = ((a >> 16) & 0xff) + ((((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * t);
    const g = ((a >> 8) & 0xff) + ((((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * t);
    const bl = (a & 0xff) + (((b & 0xff) - (a & 0xff)) * t);
    return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};

/** 描边宽度（字号的倍数，每侧）。 */
const OUTLINE_WIDTH = 0.085;
/** 硬阴影的错位（字号的倍数）与相对字的滞后（秒）。 */
const SHADOW_OFFSET_X = 0.07;
const SHADOW_OFFSET_Y = 0.085;
const SHADOW_LAG = 0.045;
const REST_POSE = restPose();
const REST_SING = restSing();

type FxMode = 'off' | 'split' | 'ghost' | 'rgb';

interface Rig {
    index: number;
    char: string;
    x: number;
    y: number;
    size: number;
    rotation: number;
    angle: number;
    entry: GlyphEntry;
    tint: number;
    /** 被唱到、闪一下、翻到背面时的颜色：按这个字身后的色块挑，保证看得见（color.ts 的 resolveHanabiGlyphColors）。 */
    sungTint: number;
    flashTint: number;
    backTint: number;
    shadowTint: number;
    outlineTint: number;
    main: Sprite;
    shadow: Sprite | null;
    outline: Sprite | null;
    fxA: Sprite | null;
    fxB: Sprite | null;
    halo: Sprite | null;
    fxMode: FxMode;
    texture: Texture | null;
    enterStart: number;
    landed: number;
    exitStart: number;
    exitEnd: number;
    sungAt: number;
    sungEnd: number;
    ctx: FxContext;
    /** 最近一次求值（update / anchors 共用）。 */
    pose: GlyphPose;
    sing: SingPose;
    visible: boolean;
}

export const buildHanabiText = (options: HanabiTextOptions, deps: HanabiTextDeps = {}): HanabiTextView => {
    const { pixi, spec, palette, line } = options;
    const motion = Math.max(0, options.motion);
    const font = resolveThemeFontStack(options.theme);
    const weight = resolveThemeFontWeight(options.theme, 800);
    const measure = deps.measure ?? createGlyphMeasure(font, weight);
    const rng = createRng(`${options.seed}:text`);

    // ─── 字、词与时间 ───
    const timeline = buildLineGraphemeTimeline(line);
    const chars = timeline.map(item => item.char);
    const words = lineWords(line, chars.length);
    const scales = wordScales(words, spec.emphasis, options.seed);
    words.forEach((word, index) => { word.scale = scales[index]!; });
    const glyphWord = new Array<number>(chars.length).fill(0);
    words.forEach((word, index) => { for (let g = word.start; g < word.end; g += 1) glyphWord[g] = index; });
    const inputs: LayoutGlyphInput[] = chars.map((char, index) => ({
        char,
        advance: measure(char),
        blank: char.trim().length === 0,
        upright: isUprightGlyph(char),
        word: glyphWord[index]!,
    }));
    const layoutParams = blockLayoutParams(spec.block, spec.hardShadow);
    const placement = layoutText(inputs, words, {
        layout: spec.layout,
        regionWidth: options.regionWidth,
        regionHeight: options.regionHeight,
        fontPx: spec.heroSize * Math.min(options.width, options.height),
        tilt: spec.tilt,
        seed: options.seed,
        ...layoutParams,
    });
    const glyphs = placement.glyphs;
    const centerX = placement.bounds.x + placement.bounds.width / 2;
    const centerY = placement.bounds.y + placement.bounds.height / 2;

    const visibleIndices = glyphs.map((glyph, index) => (glyph.blank ? -1 : index)).filter(index => index >= 0);
    const visibleCount = visibleIndices.length;
    const orderRanks = enterOrder(spec.enter, visibleCount, rng);
    const enterRanks = new Array<number>(chars.length).fill(-1);
    visibleIndices.forEach((index, ordinal) => { enterRanks[index] = orderRanks[ordinal]!; });
    const firstSung = visibleIndices.reduce((min, index) => Math.min(min, timeline[index]!.startTime), Number.POSITIVE_INFINITY);
    const deadline = Number.isFinite(firstSung) ? firstSung : line.startTime;
    const enter = scheduleEnter(spec.enter, enterRanks, options.enterAt, spec.stagger, deadline);
    const exitRanks = new Array<number>(chars.length).fill(-1);
    const exitShuffle = spec.exit === 'scatter' || spec.exit === 'dissolve'
        ? enterOrder('scramble', visibleCount, createRng(`${options.seed}:exit-order`))
        : visibleIndices.map((_, ordinal) => ordinal);
    visibleIndices.forEach((index, ordinal) => { exitRanks[index] = exitShuffle[ordinal]!; });
    const exit = scheduleExit(exitRanks, options.exitAt, options.exitDuration);

    // ─── 容器 ───
    const view = new pixi.Container();
    view.label = 'hanabi-text';
    // 色块与字各是一个渲染组：入场 / 退场时字的精灵逐个显隐、色块与擦除遮罩重画，Pixi 会把所在渲染组的绘制指令
    // 整组重排；单独成组后只重排这一行字，不牵动整个舞台。
    const blocksRoot = new pixi.Container({ isRenderGroup: true });
    blocksRoot.label = 'hanabi-text-blocks';
    const glyphsRoot = new pixi.Container({ isRenderGroup: true });
    glyphsRoot.label = 'hanabi-text-glyphs';
    view.addChild(blocksRoot, glyphsRoot);
    // 内层：整组震动只动内层，外层留给场景摆放。
    const blocksInner = new pixi.Container();
    const glyphsInner = new pixi.Container();
    blocksRoot.addChild(blocksInner);
    glyphsRoot.addChild(glyphsInner);
    const masked = new pixi.Container();
    const shadowLayer = new pixi.Container();
    const outlineLayer = new pixi.Container();
    const haloLayer = new pixi.Container();
    const fxLayer = new pixi.Container();
    const mainLayer = new pixi.Container();
    const overlayLayer = new pixi.Container();
    masked.addChild(shadowLayer, outlineLayer, haloLayer, fxLayer, mainLayer);
    glyphsInner.addChild(masked, overlayLayer);

    const blocks = createBlocks({
        pixi,
        style: spec.block,
        placement,
        words,
        palette,
        opacity: clamp01(options.blockOpacity),
        motion,
        exit: spec.exit,
        seed: options.seed,
        // 色块在字差不多到位时出现。
        enterStart: enter.start.map(start => start + enter.duration * ENTER_ARRIVAL[spec.enter]),
        exitStart: exit.start,
        exitEnd: exit.end,
        centerX,
        centerY,
    });
    blocksInner.addChild(blocks.view);

    // ─── 纹理 ───
    const needFx = spec.enter === 'glitch' || spec.enter === 'zoom' || spec.enter === 'split' || spec.exit === 'dissolve';
    const halvesKind = spec.enter === 'split' ? (placement.vertical ? 'tb' : 'lr') : null;
    const charPx = new Map<string, number>();
    let maxSize = 0;
    visibleIndices.forEach(index => {
        const glyph = glyphs[index]!;
        // 留一点余量给强调时的放大。
        const px = Math.ceil(glyph.size * 1.12);
        charPx.set(glyph.char, Math.max(charPx.get(glyph.char) ?? 0, px));
        maxSize = Math.max(maxSize, px);
    });
    const scrambleChars = spec.enter === 'scramble' ? pickScrambleChars(line.fullText, 14, createRng(`${options.seed}:scramble`)) : [];
    const atlas = (deps.buildAtlas ?? buildGlyphAtlas)(pixi, {
        font,
        weight,
        resolution: options.resolution,
        chars: charPx,
        scramble: scrambleChars.length > 0 ? { chars: scrambleChars, px: maxSize } : null,
        outline: spec.outline ? OUTLINE_WIDTH : 0,
        glow: spec.sing === 'glow',
        halves: halvesKind,
    });

    // ─── 颜色 ───
    const role = blockTextRole(spec.block);
    const baseInk = role === 'ink' ? palette.ink : palette.paper;
    const firstBlock = palette.blocks[0] ?? palette.accent;
    // 没有色块的字，身后是夜空（或浅色背景）。
    const backdrop = hanabiBackdropOf(palette);

    // ─── 精灵 ───
    const makeSprite = (layer: Container, texture: Texture) => {
        const sprite = new pixi.Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.visible = false;
        layer.addChild(sprite);
        return sprite;
    };
    const slideDistance = (Math.max(options.regionWidth, options.regionHeight) * 0.8) / Math.max(1, placement.fontPx) + 3;
    const rigs: Rig[] = visibleIndices.map((index, ordinal) => {
        const glyph = glyphs[index]!;
        const entry = atlas.entry(glyph.char);
        const word = words[glyph.word];
        const keyword = options.keywordColor?.(word?.text ?? glyph.char) ?? options.keywordColor?.(glyph.char) ?? null;
        const under = blocks.colorOf(index);
        // 字色、关键字色、被唱到 / 闪一下 / 翻牌背面的颜色都按身后的色块挑：与色块同色的会被推开（色相不变）。
        const colors = resolveHanabiGlyphColors(palette, keyword ?? baseInk, under ?? backdrop);
        const tint = colors.ink;
        const outlineTint = tint === palette.paper || under === palette.paper ? firstBlock : palette.paper;
        const shadowTint = under !== null
            ? darken(under, 0.42)
            : spec.outline && outlineTint === firstBlock ? (palette.blocks[1] ?? darken(firstBlock, 0.45)) : firstBlock;
        const rig: Rig = {
            index,
            char: glyph.char,
            x: glyph.x,
            y: glyph.y,
            size: glyph.size,
            rotation: glyph.rotation,
            angle: glyph.angle,
            entry,
            tint,
            sungTint: colors.sung,
            flashTint: colors.flash,
            backTint: colors.back,
            shadowTint,
            outlineTint,
            shadow: spec.hardShadow ? makeSprite(shadowLayer, entry.fat ?? entry.fill) : null,
            outline: spec.outline && entry.fat ? makeSprite(outlineLayer, entry.fat) : null,
            halo: spec.sing === 'glow' && entry.glow ? makeSprite(haloLayer, entry.glow) : null,
            fxA: needFx ? makeSprite(fxLayer, entry.fill) : null,
            fxB: needFx ? makeSprite(fxLayer, entry.fill) : null,
            main: makeSprite(mainLayer, entry.fill),
            fxMode: 'off',
            texture: entry.fill,
            enterStart: enter.start[index]!,
            landed: enter.landed[index]!,
            exitStart: exit.start[index]!,
            exitEnd: exit.end[index]!,
            sungAt: timeline[index]!.startTime,
            sungEnd: timeline[index]!.endTime,
            ctx: {
                index: ordinal,
                count: visibleCount,
                rand: [rng(), rng(), rng(), rng()],
                toCenterX: (centerX - glyph.x) / Math.max(1, glyph.size),
                toCenterY: (centerY - glyph.y) / Math.max(1, glyph.size),
                dirX: Math.cos(glyph.angle),
                dirY: Math.sin(glyph.angle),
                time: 0,
                motion,
                slideDistance,
            },
            pose: restPose(),
            sing: restSing(),
            visible: false,
        };
        if (rig.shadow) rig.shadow.tint = shadowTint;
        if (rig.outline) rig.outline.tint = outlineTint;
        if (rig.halo) {
            rig.halo.tint = palette.glow;
            rig.halo.blendMode = 'add';
        }
        rig.main.tint = tint;
        return rig;
    });
    const rigOf = new Map<number, Rig>();
    rigs.forEach(rig => rigOf.set(rig.index, rig));

    // stamp：每个词第一个字砸下的时刻整组震动。
    const impacts: number[] = [];
    if (spec.enter === 'stamp') {
        const seen = new Set<number>();
        rigs.forEach(rig => {
            const word = glyphs[rig.index]!.word;
            if (seen.has(word)) return;
            seen.add(word);
            impacts.push(rig.enterStart + enter.duration * STAMP_IMPACT);
        });
    }
    const shakeAmplitude = placement.fontPx * 0.05 * motion;

    // type 的光标、underline 的粗线、wipe 的遮罩。
    const cursor = spec.enter === 'type' ? new pixi.Graphics() : null;
    if (cursor) {
        cursor.rect(-0.5, -0.5, 1, 1).fill({ color: 0xffffff });
        cursor.tint = palette.accent;
        cursor.visible = false;
        overlayLayer.addChild(cursor);
    }
    const underlines: Array<{ g: Graphics; members: Rig[]; x: number; y: number; angle: number; length: number; thick: number; from: number; to: number }> = [];
    if (spec.sing === 'underline') {
        const groups = new Map<string, number[]>();
        rigs.forEach(rig => {
            const glyph = glyphs[rig.index]!;
            const key = `${glyph.word}`;
            const list = groups.get(key) ?? [];
            if (list.length === 0 || glyphs[list[0]!]!.row === glyph.row) list.push(rig.index);
            groups.set(key, list);
        });
        groups.forEach(indices => {
            const frame = runFrame(glyphs, indices, 0, 0);
            if (!frame) return;
            const members = indices.map(index => rigOf.get(index)!);
            const tx = Math.cos(frame.angle), ty = Math.sin(frame.angle);
            const nx = -ty, ny = tx;
            const avgSize = members.reduce((sum, rig) => sum + rig.size, 0) / members.length;
            const thick = Math.max(3, avgSize * 0.15);
            const offset = frame.thickness / 2 + thick * 0.4;
            const g = new pixi.Graphics();
            g.rect(0, -0.5, 1, 1).fill({ color: 0xffffff });
            // 下划线画在词下面、色块上：按词里第一个字身后的色块取色。
            g.tint = members[0]?.sungTint ?? palette.accent;
            g.visible = false;
            overlayLayer.addChild(g);
            underlines.push({
                g,
                members,
                x: frame.cx - tx * frame.length / 2 + nx * offset,
                y: frame.cy - ty * frame.length / 2 + ny * offset,
                angle: frame.angle,
                length: frame.length,
                thick,
                from: Math.min(...members.map(rig => rig.sungAt)),
                to: Math.max(...members.map(rig => rig.sungEnd)),
            });
        });
    }
    const wipeMask = spec.enter === 'wipe' ? new pixi.Graphics() : null;
    if (wipeMask) glyphsInner.addChild(wipeMask);
    const firstStart = rigs.reduce((min, rig) => Math.min(min, rig.enterStart), Number.POSITIVE_INFINITY);
    const lastLanded = rigs.reduce((max, rig) => Math.max(max, rig.landed), Number.NEGATIVE_INFINITY);

    // ─── 求值 ───
    const scratchEnter = restPose();
    const scratchShadow = restPose();
    /** 求第 rig 个字在 time 时刻（减去 lag）的姿态，写进 out；返回是否可见。 */
    const evaluate = (rig: Rig, time: number, lag: number, out: GlyphPose, singOut: SingPose | null) => {
        const t = time - lag;
        if (!(t >= rig.enterStart) || t >= rig.exitEnd) {
            // 不可见时也回到确定的状态（anchors 不能带着上一次求值的残留）。
            Object.assign(out, REST_POSE);
            out.alpha = 0;
            if (singOut) Object.assign(singOut, REST_SING);
            return false;
        }
        rig.ctx.time = t - rig.enterStart;
        const a = enterPose(spec.enter, (t - rig.enterStart) / Math.max(1e-3, enter.duration), rig.ctx);
        Object.assign(scratchEnter, a);
        rig.ctx.time = t - rig.exitStart;
        const span = rig.exitEnd - rig.exitStart;
        const b = exitPose(spec.exit, span > 0 ? (t - rig.exitStart) / span : 0, rig.ctx);
        combinePoses(scratchEnter, b, out);
        if (singOut) {
            const sung = t >= rig.landed ? singPose(spec.sing, t - rig.sungAt, rig.sungEnd - rig.sungAt, rig.ctx.rand[3], motion) : restSing();
            Object.assign(singOut, sung);
        }
        return out.alpha > 0.002;
    };

    let evaluatedAt = Number.NaN;
    let shake = { x: 0, y: 0 };
    const evaluateAll = (time: number) => {
        if (time === evaluatedAt) return;
        evaluatedAt = time;
        shake = impacts.length > 0 ? stampShake(time, impacts, shakeAmplitude) : { x: 0, y: 0 };
        rigs.forEach(rig => { rig.visible = evaluate(rig, time, 0, rig.pose, rig.sing); });
    };

    const setTexture = (sprite: Sprite, texture: Texture) => {
        if (sprite.texture !== texture) sprite.texture = texture;
    };
    const place = (sprite: Sprite, x: number, y: number, rotation: number, sx: number, sy: number, skew: number, alpha: number) => {
        sprite.visible = alpha > 0.002;
        if (!sprite.visible) return;
        sprite.position.set(x, y);
        sprite.rotation = rotation;
        sprite.scale.set(sx, sy);
        sprite.skew.x = skew;
        sprite.alpha = alpha;
    };
    const setFxMode = (rig: Rig, mode: FxMode) => {
        if (rig.fxMode === mode || !rig.fxA || !rig.fxB) return;
        rig.fxMode = mode;
        if (mode === 'split' && rig.entry.halves) {
            setTexture(rig.fxA, rig.entry.halves[0]);
            setTexture(rig.fxB, rig.entry.halves[1]);
            if (halvesKind === 'lr') {
                rig.fxA.anchor.set(1, 0.5);
                rig.fxB.anchor.set(0, 0.5);
            } else {
                rig.fxA.anchor.set(0.5, 1);
                rig.fxB.anchor.set(0.5, 0);
            }
            rig.fxA.blendMode = 'normal';
            rig.fxB.blendMode = 'normal';
            rig.fxA.tint = rig.tint;
            rig.fxB.tint = rig.tint;
            return;
        }
        rig.fxA.anchor.set(0.5);
        rig.fxB.anchor.set(0.5);
        if (mode === 'rgb') {
            rig.fxA.blendMode = 'add';
            rig.fxB.blendMode = 'add';
            rig.fxA.tint = 0xff2850;
            rig.fxB.tint = 0x20e8ff;
        } else {
            rig.fxA.blendMode = 'normal';
            rig.fxB.blendMode = 'normal';
            rig.fxA.tint = rig.tint;
            rig.fxB.tint = rig.tint;
        }
    };

    const update = (time: number) => {
        // 没提前备好时（跳播、第一帧）在这里补画图集。
        atlas.paint?.();
        evaluateAll(time);
        blocksInner.position.set(shake.x, shake.y);
        glyphsInner.position.set(shake.x, shake.y);
        blocks.update(time);

        rigs.forEach(rig => {
            const pose = rig.pose;
            const sing = rig.sing;
            if (!rig.visible) {
                rig.main.visible = false;
                if (rig.shadow) rig.shadow.visible = false;
                if (rig.outline) rig.outline.visible = false;
                if (rig.halo) rig.halo.visible = false;
                if (rig.fxA) rig.fxA.visible = false;
                if (rig.fxB) rig.fxB.visible = false;
                return;
            }
            const size = rig.size;
            const base = size / rig.entry.px;
            const x = rig.x + (pose.dx + sing.dx) * size;
            const y = rig.y + (pose.dy + sing.dy) * size;
            const rotation = rig.rotation + pose.rotation + sing.rotation;
            const sx = base * pose.scaleX * sing.scale * sing.scaleX;
            const sy = base * pose.scaleY * sing.scale * sing.scaleY;
            const scrambled = pose.scramble >= 0 && atlas.scramble.length > 0
                ? atlas.scramble[pose.scramble % atlas.scramble.length]!
                : null;
            const entry = scrambled ?? rig.entry;
            const scrambleScale = scrambled ? rig.entry.px / scrambled.px : 1;
            // 字色：唱到时闪光 / 变色，翻到背面时换色。
            let tint = mixColor(rig.tint, rig.sungTint, sing.color);
            tint = mixColor(tint, rig.flashTint, sing.flash);
            if (pose.backside) tint = rig.backTint;
            rig.main.tint = tint;
            setTexture(rig.main, entry.fill);
            const splitting = pose.split > 0.001 && rig.fxA !== null && rig.entry.halves !== null;
            place(rig.main, x, y, rotation, sx * scrambleScale, sy * scrambleScale, pose.skew, splitting ? 0 : pose.alpha);

            // 描边层与字同姿态；拼合（split）途中两半还没合上时先隐去。
            const attach = splitting ? 1 - clamp01(pose.split * 3) : 1;
            if (rig.outline) {
                setTexture(rig.outline, entry.fat ?? entry.fill);
                place(rig.outline, x, y, rotation, sx * scrambleScale, sy * scrambleScale, pose.skew, pose.alpha * attach);
            }
            if (rig.shadow) {
                // 硬阴影：晚一点跟上（运动时拖出错位），位置固定朝右下。
                const lagged = evaluate(rig, time, SHADOW_LAG, scratchShadow, null) ? scratchShadow : pose;
                const lx = rig.x + (lagged.dx + sing.dx) * size + SHADOW_OFFSET_X * size;
                const ly = rig.y + (lagged.dy + sing.dy) * size + SHADOW_OFFSET_Y * size;
                setTexture(rig.shadow, entry.fat ?? entry.fill);
                place(
                    rig.shadow, lx, ly, rig.rotation + lagged.rotation + sing.rotation,
                    base * lagged.scaleX * sing.scale * sing.scaleX * scrambleScale,
                    base * lagged.scaleY * sing.scale * sing.scaleY * scrambleScale,
                    lagged.skew, Math.min(pose.alpha, lagged.alpha) * attach,
                );
            }
            if (rig.halo) {
                const k = 1 + 0.14 * sing.glow;
                place(rig.halo, x, y, rotation, sx * k, sy * k, 0, pose.alpha * sing.glow * 0.95);
            }
            if (rig.fxA && rig.fxB) {
                if (splitting) {
                    setFxMode(rig, 'split');
                    const sep = pose.split;
                    const c = Math.cos(rotation), s = Math.sin(rotation);
                    const [ax, ay] = halvesKind === 'lr' ? [-1.3 * sep, -0.45 * sep] : [-0.45 * sep, -1.3 * sep];
                    place(rig.fxA, x + (ax * c - ay * s) * size, y + (ax * s + ay * c) * size, rotation, sx, sy, pose.skew, pose.alpha);
                    place(rig.fxB, x - (ax * c - ay * s) * size, y - (ax * s + ay * c) * size, rotation, sx, sy, pose.skew, pose.alpha);
                } else if (pose.rgbSplit > 0.001) {
                    setFxMode(rig, 'rgb');
                    setTexture(rig.fxA, entry.fill);
                    setTexture(rig.fxB, entry.fill);
                    const d = pose.rgbSplit * size;
                    place(rig.fxA, x - d, y, rotation, sx * scrambleScale, sy * scrambleScale, pose.skew, pose.alpha * 0.9);
                    place(rig.fxB, x + d, y + d * 0.2, rotation, sx * scrambleScale, sy * scrambleScale, pose.skew, pose.alpha * 0.9);
                } else if (pose.blur > 0.01) {
                    // 模糊近似：两层放大的半透明重影。
                    setFxMode(rig, 'ghost');
                    setTexture(rig.fxA, entry.fill);
                    setTexture(rig.fxB, entry.fill);
                    rig.fxA.tint = tint;
                    rig.fxB.tint = tint;
                    const k1 = 1 + 0.16 * pose.blur, k2 = 1 + 0.38 * pose.blur;
                    place(rig.fxA, x, y, rotation, sx * k1, sy * k1, pose.skew, pose.alpha * 0.4 * pose.blur);
                    place(rig.fxB, x, y, rotation, sx * k2, sy * k2, pose.skew, pose.alpha * 0.22 * pose.blur);
                } else {
                    rig.fxA.visible = false;
                    rig.fxB.visible = false;
                }
            }
        });

        // wipe：入场期间把字层遮在逐字擦出的矩形里。
        if (wipeMask) {
            const active = time >= firstStart && time < lastLanded;
            if (active) {
                wipeMask.clear();
                rigs.forEach(rig => {
                    if (!rig.visible) return;
                    const pose = rig.pose;
                    const size = rig.size;
                    const glyph = glyphs[rig.index]!;
                    const tx = Math.cos(rig.angle), ty = Math.sin(rig.angle);
                    const nx = -ty, ny = tx;
                    const margin = size * 0.2;
                    const along = glyph.advance + margin * 2;
                    const t0 = -along / 2;
                    const t1 = t0 + along * pose.reveal;
                    if (t1 <= t0) return;
                    const n0 = -size * 0.85, n1 = size * 0.85;
                    const cx = rig.x + pose.dx * size, cy = rig.y + pose.dy * size;
                    wipeMask.poly([
                        cx + tx * t0 + nx * n0, cy + ty * t0 + ny * n0,
                        cx + tx * t1 + nx * n0, cy + ty * t1 + ny * n0,
                        cx + tx * t1 + nx * n1, cy + ty * t1 + ny * n1,
                        cx + tx * t0 + nx * n1, cy + ty * t0 + ny * n1,
                    ]).fill({ color: 0xffffff });
                });
                if (masked.mask !== wipeMask) masked.mask = wipeMask;
                wipeMask.visible = true;
            } else if (masked.mask) {
                masked.mask = null;
                wipeMask.clear();
                wipeMask.visible = false;
            }
        }

        // type：光标停在最后一个已出现的字后面，打字时常亮、停下后闪烁，退场时消失。
        if (cursor) {
            let current: Rig | null = null;
            for (const rig of rigs) {
                if (time >= rig.enterStart && (!current || rig.enterStart >= current.enterStart)) current = rig;
            }
            const first = rigs[0];
            const typing = time < lastLanded;
            const visibleFrom = options.enterAt - 0.25;
            const exitFrom = rigs.reduce((min, rig) => Math.min(min, rig.exitStart), Number.POSITIVE_INFINITY);
            const hideAt = Math.min(lastLanded + 1.2, exitFrom);
            const blinkOn = typing || Math.floor((time - lastLanded) / 0.28) % 2 === 0;
            const target: Rig | null = current ?? first ?? null;
            if (!target || time < visibleFrom || time >= hideAt || !blinkOn) {
                cursor.visible = false;
            } else {
                const glyph = glyphs[target.index]!;
                const tx = Math.cos(target.angle), ty = Math.sin(target.angle);
                const side = current ? 1 : -1;
                const offset = (glyph.advance / 2 + target.size * 0.1) * side;
                cursor.visible = true;
                cursor.position.set(target.x + tx * offset, target.y + ty * offset);
                cursor.rotation = target.angle;
                cursor.scale.set(Math.max(2, target.size * 0.09), target.size * 0.95);
                cursor.alpha = 1;
            }
        }

        // underline：被唱的词下面一条粗线随唱的进度伸长，唱完从词首收起。
        underlines.forEach(line => {
            const landed = line.members.every(rig => time >= rig.landed);
            const grow = clamp01((time - line.from) / Math.max(0.12, line.to - line.from));
            const retract = clamp01((time - line.to - 0.12) / 0.28);
            const head = 1 - (1 - grow) ** 3;
            const tail = retract ** 3;
            const alpha = line.members.reduce((min, rig) => Math.min(min, rig.visible ? rig.pose.alpha : 0), 1);
            if (!landed || time < line.from || head <= tail || alpha <= 0.002) {
                line.g.visible = false;
                return;
            }
            const tx = Math.cos(line.angle), ty = Math.sin(line.angle);
            line.g.visible = true;
            line.g.position.set(line.x + tx * line.length * tail, line.y + ty * line.length * tail);
            line.g.rotation = line.angle;
            line.g.scale.set(line.length * (head - tail), line.thick * (1 + 0.5 * (1 - clamp01((time - line.from) / 0.12))));
            line.g.alpha = alpha;
        });
    };

    let anchorsAt = Number.NaN;
    let anchorsCache: GlyphAnchor[] = [];
    const anchors = (time: number): GlyphAnchor[] => {
        if (time === anchorsAt) return anchorsCache;
        evaluateAll(time);
        anchorsAt = time;
        anchorsCache = glyphs.map((glyph, index) => {
            const rig = rigOf.get(index);
            const timing = timeline[index]!;
            if (!rig) {
                return {
                    char: glyph.char, x: glyph.x + shake.x, y: glyph.y + shake.y, size: glyph.size,
                    sungAt: timing.startTime, sungEnd: timing.endTime,
                    landedAt: Number.isFinite(enter.landed[index]!) ? enter.landed[index]! : options.enterAt,
                    alpha: 0, blank: true,
                };
            }
            const pose = rig.pose;
            const sing = rig.sing;
            const scale = ((Math.abs(pose.scaleX * sing.scaleX) + Math.abs(pose.scaleY * sing.scaleY)) / 2) * sing.scale;
            return {
                char: glyph.char,
                x: rig.x + (pose.dx + sing.dx) * rig.size + shake.x,
                y: rig.y + (pose.dy + sing.dy) * rig.size + shake.y,
                size: rig.size * scale,
                sungAt: rig.sungAt,
                sungEnd: rig.sungEnd,
                landedAt: rig.landed,
                alpha: rig.visible ? clamp01(pose.alpha) : 0,
                blank: false,
            };
        });
        return anchorsCache;
    };

    let destroyed = false;
    return {
        view,
        blocks: blocksRoot,
        glyphs: glyphsRoot,
        update,
        prepare: () => atlas.paint?.() ?? false,
        anchors,
        bounds: { ...placement.bounds },
        destroy: () => {
            if (destroyed) return;
            destroyed = true;
            if (masked.mask) masked.mask = null;
            blocks.destroy();
            // 场景可能把两个子容器挪去了别的层：各自销毁。
            blocksRoot.destroy({ children: true, context: true });
            glyphsRoot.destroy({ children: true, context: true });
            view.destroy({ children: true });
            atlas.destroy();
        },
    };
};

export const createHanabiText: CreateHanabiText = options => buildHanabiText(options);
