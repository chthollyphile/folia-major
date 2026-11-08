import { GLOW_WORD_ACTIVE_SCALE } from './glowWordVariants';

// src/components/visualizer/glowWordOverlap.ts
// 流光、云阶的「防止文字重叠」（tuning 的 avoidOverlap）：GlowWord 的放大、旋转、偏移都走 transform，
// 不占排版位置，所以放大的词会压到旁边。这里算一个词画出来时伸出排版框多少，各模式把它补成 margin。

/** The line box of a GlowWord, in em. GlowWord.tsx sets it; the overlap math needs the same value. */
export const GLOW_WORD_LINE_HEIGHT = 1.22;

/** Glyphs fill about one em of the line box: what a word draws, rather than the box it sits in. */
const GLYPH_HEIGHT_EM = 1;

/** Angles sampled along the passed state's slow turn, whose widest point can lie between its ends. */
const PASSED_TURN_SAMPLES = 8;

let measureCanvas: HTMLCanvasElement | null = null;

/**
 * Measures the width of a given word text using a 2D canvas context.
 */
export const measureGlowWordWidth = (text: string, pxSize: number, fontStack: string, fontWeight: number): number => {
    if (typeof document === 'undefined') {
        return text.length * pxSize * 0.65;
    }
    if (!measureCanvas) {
        measureCanvas = document.createElement('canvas');
    }
    const context = measureCanvas.getContext('2d');
    if (!context) {
        return text.length * pxSize * 0.65;
    }
    context.font = `${fontWeight} ${pxSize}px ${fontStack}`;
    return context.measureText(text).width;
};

/** A word's transform as the layout variants (glowWordVariants.ts) read it from its config. */
export interface GlowWordPose {
    scale: number;
    rotate: number;
    passedRotate: number;
}

/** How far a drawn word reaches past its layout box on each side; never negative. */
export interface GlowWordOverflow {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

const reachAt = (width: number, glyphHeight: number, scale: number, rotateDeg: number) => {
    const radians = (rotateDeg * Math.PI) / 180;
    const cos = Math.abs(Math.cos(radians));
    const sin = Math.abs(Math.sin(radians));
    return {
        halfWidth: (scale * (width * cos + glyphHeight * sin)) / 2,
        halfHeight: (scale * (glyphHeight * cos + width * sin)) / 2,
    };
};

/**
 * The widest the word is drawn while it can be seen: active (config scale times the active scale,
 * at its rotate) and passed (config scale, turning from its rotate to rotate + passedRotate). Width
 * and font size in any one unit; the result is in that unit too.
 */
export const getGlowWordReach = (width: number, fontSize: number, pose: GlowWordPose) => {
    const glyphHeight = fontSize * GLYPH_HEIGHT_EM;
    const active = reachAt(width, glyphHeight, pose.scale * GLOW_WORD_ACTIVE_SCALE, pose.rotate);
    let halfWidth = active.halfWidth;
    let halfHeight = active.halfHeight;
    for (let step = 0; step <= PASSED_TURN_SAMPLES; step += 1) {
        const passed = reachAt(width, glyphHeight, pose.scale, pose.rotate + (pose.passedRotate * step) / PASSED_TURN_SAMPLES);
        halfWidth = Math.max(halfWidth, passed.halfWidth);
        halfHeight = Math.max(halfHeight, passed.halfHeight);
    }
    return { halfWidth, halfHeight };
};

/** A word as laid out: its box width, its transform, and its x / y offset, all in one unit. */
export interface GlowWordPlacement {
    width: number;
    pose: GlowWordPose;
    offset?: { x: number; y: number };
}

/**
 * The space two neighbouring words need between their layout boxes so their drawings only just do not
 * meet: how far the first reaches toward the second plus how far the second reaches back, with their
 * actual offsets, rather than each keeping its widest reach on both sides. Negative when they would
 * clear each other with less than no gap. In `direction` 'rtl' the second word sits to the left.
 *
 * Horizontal only, even when the two offsets part them vertically: spacing every pair this way keeps
 * words two apart clear too (the middle word's own width bridges them), and a pair let off because it
 * sits apart vertically would leave its neighbours free to meet across it.
 */
export const getGlowWordPairGap = (
    first: GlowWordPlacement,
    second: GlowWordPlacement,
    fontSize: number,
    direction: 'ltr' | 'rtl' = 'ltr',
): number => {
    const firstReach = getGlowWordReach(first.width, fontSize, first.pose);
    const secondReach = getGlowWordReach(second.width, fontSize, second.pose);
    const firstOffset = first.offset ?? { x: 0, y: 0 };
    const secondOffset = second.offset ?? { x: 0, y: 0 };
    // A positive x moves a drawing right: toward the next word in LTR, away from it in RTL.
    const towardEachOther = direction === 'rtl' ? secondOffset.x - firstOffset.x : firstOffset.x - secondOffset.x;
    return (firstReach.halfWidth - first.width / 2) + (secondReach.halfWidth - second.width / 2) + towardEachOther;
};

/**
 * How far the drawn word reaches past its layout box, with the word's own x / y offset (same unit as
 * width and font size) moving the drawing off the box's center.
 */
export const getGlowWordOverflow = (
    width: number,
    fontSize: number,
    pose: GlowWordPose,
    offset: { x: number; y: number } = { x: 0, y: 0 },
): GlowWordOverflow => {
    const { halfWidth, halfHeight } = getGlowWordReach(width, fontSize, pose);
    const overWidth = halfWidth - width / 2;
    const overHeight = halfHeight - (fontSize * GLOW_WORD_LINE_HEIGHT) / 2;
    return {
        left: Math.max(0, overWidth - offset.x),
        right: Math.max(0, overWidth + offset.x),
        top: Math.max(0, overHeight - offset.y),
        bottom: Math.max(0, overHeight + offset.y),
    };
};
