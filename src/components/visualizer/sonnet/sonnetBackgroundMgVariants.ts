import type { AnimatedGraphics } from './sonnetAnimatedGraphics';
import { mixSonnetSeed } from './sonnetRandom';

// src/components/visualizer/sonnet/sonnetBackgroundMgVariants.ts
// Seed-driven HUD frame compositions for the Sonnet background MG (`bg`) layer.
// Every variant draws at the same margins so shots stay interchangeable; only
// the furniture (crosses, brackets, rulers, arcs, dots) changes.

export const SONNET_BACKGROUND_MG_VARIANT_COUNT = 8;

export const SONNET_BACKGROUND_MG_VARIANTS = [
    'classic-cross', 'corner-brackets', 'marquee-strips', 'diagonal-corners',
    'dotted-columns', 'double-frame', 'ruler-frame', 'arc-gauge',
] as const;

export interface SonnetBackgroundMgOptions {
    target: AnimatedGraphics;
    variant: number;
    width: number;
    height: number;
    seed: number;
    primary: number;
    secondary: number;
}

export const resolveSonnetBackgroundMgVariant = (seed: number) => (
    mixSonnetSeed(seed, 0x9e3779b9) % SONNET_BACKGROUND_MG_VARIANT_COUNT
);

interface FrameContext extends SonnetBackgroundMgOptions {
    hw: number;
    hh: number;
    marginX: number;
    marginY: number;
}

const withFrame = (options: SonnetBackgroundMgOptions): FrameContext => ({
    ...options,
    hw: options.width / 2,
    hh: options.height / 2,
    marginX: options.width * 0.05,
    marginY: options.height * 0.05,
});

// Small X marker used by several variants as a rivet/node accent.
const drawCross = (
    target: AnimatedGraphics,
    x: number,
    y: number,
    size: number,
    color: number,
    alpha = 0.5,
) => {
    target.moveTo(x - size, y - size).lineTo(x + size, y + size).stroke({ color, width: 1, alpha });
    target.moveTo(x + size, y - size).lineTo(x - size, y + size).stroke({ color, width: 1, alpha });
};

// Variant 0: the original HUD — corner crosses, left cross column, bottom progress bar.
const drawClassicCross = (context: FrameContext) => {
    const { target, hw, hh, marginX, marginY, primary, secondary } = context;
    const size = 4;
    drawCross(target, -hw + marginX, -hh + marginY, size, primary, 0.4);
    drawCross(target, hw - marginX, -hh + marginY, size, primary, 0.4);
    drawCross(target, -hw + marginX, hh - marginY, size, primary, 0.4);
    drawCross(target, hw - marginX, hh - marginY, size, primary, 0.4);

    for (let i = 0; i < 8; i += 1) {
        drawCross(target, -hw + marginX, -hh + marginY + i * 20 + 30, 3, primary, 0.3);
    }

    const barY = hh - marginY - 10;
    target.moveTo(-hw + marginX + 20, barY).lineTo(hw - marginX - 20, barY).stroke({ color: primary, width: 1, alpha: 0.3 });
    drawCross(target, -hw + marginX + 10, barY, 3, primary, 0.5);
    drawCross(target, -hw + marginX + 30, barY, 3, primary, 0.5);
    drawCross(target, hw - marginX - 10, barY, 3, primary, 0.5);
    target.circle(0, barY, 2).fill({ color: secondary, alpha: 0.8 });
};

// Variant 1: drafting-style corner L brackets with tick rulers along the bottom.
const drawCornerBrackets = (context: FrameContext) => {
    const { target, hw, hh, marginX, marginY, primary, secondary, seed } = context;
    const arm = Math.min(hw, hh) * 0.08;
    const inset = 6;
    const corners = [
        [-hw + marginX, -hh + marginY, 1, 1],
        [hw - marginX, -hh + marginY, -1, 1],
        [-hw + marginX, hh - marginY, 1, -1],
        [hw - marginX, hh - marginY, -1, -1],
    ] as const;
    corners.forEach(([cx, cy, sx, sy], index) => {
        target.moveTo(cx + sx * arm, cy)
            .lineTo(cx, cy)
            .lineTo(cx, cy + sy * arm)
            .stroke({ color: primary, width: 2, alpha: 0.55 });
        target.moveTo(cx + sx * (arm + inset), cy + sy * inset)
            .lineTo(cx + sx * inset, cy + sy * inset)
            .lineTo(cx + sx * inset, cy + sy * (arm + inset))
            .stroke({ color: primary, width: 1, alpha: 0.25 });
        if (index % 2 === 0) {
            target.rect(cx + sx * arm * 0.4 - 2, cy + sy * arm * 0.4 - 2, 4, 4)
                .fill({ color: secondary, alpha: 0.6 });
        }
    });

    // Bottom tick ruler between the brackets.
    const rulerY = hh - marginY + inset;
    target.moveTo(-hw + marginX + arm + 12, rulerY).lineTo(hw - marginX - arm - 12, rulerY)
        .stroke({ color: primary, width: 1, alpha: 0.3 });
    const ticks = 24;
    const span = (hw - marginX - arm - 12) * 2;
    for (let i = 0; i <= ticks; i += 1) {
        const x = -hw + marginX + arm + 12 + (span * i) / ticks;
        const long = i % 6 === 0;
        target.moveTo(x, rulerY).lineTo(x, rulerY - (long ? 8 : 4))
            .stroke({ color: long ? secondary : primary, width: 1, alpha: long ? 0.55 : 0.3 });
    }

    // Seed-staggered registration dots on the side edges.
    for (let i = 0; i < 5; i += 1) {
        const y = -hh + marginY + arm + 14 + i * ((hh - marginY - arm - 14) * 2) / 5;
        target.circle(-hw + marginX - 4, y, 1.5).fill({ color: primary, alpha: 0.35 });
        target.circle(hw - marginX + 4, y + (seed % 7), 1.5).fill({ color: primary, alpha: 0.35 });
    }
};

// Variant 2: top/bottom marquee strips with hanging ticks and end blocks.
const drawMarqueeStrips = (context: FrameContext) => {
    const { target, hw, hh, marginX, marginY, primary, secondary } = context;
    const left = -hw + marginX;
    const right = hw - marginX;
    [-1, 1].forEach((direction) => {
        const stripY = hh - marginY;
        const y = direction * stripY;
        target.moveTo(left, y).lineTo(right, y).stroke({ color: primary, width: 2, alpha: 0.45 });
        target.moveTo(left, y + direction * 6).lineTo(right, y + direction * 6)
            .stroke({ color: primary, width: 1, alpha: 0.2 });
        // End cap blocks.
        target.rect(left, y - 3, 14, 6).fill({ color: secondary, alpha: 0.55 });
        target.rect(right - 14, y - 3, 14, 6).fill({ color: secondary, alpha: 0.55 });
        // Hanging ticks between the two rails.
        const ticks = 18;
        for (let i = 1; i < ticks; i += 1) {
            const x = left + ((right - left) * i) / ticks;
            if (i % 3 === 0) {
                target.moveTo(x, y).lineTo(x, y + direction * 6)
                    .stroke({ color: primary, width: 1, alpha: 0.35 });
            }
        }
    });
    drawCross(target, 0, -hh + marginY, 4, primary, 0.5);
    target.moveTo(-6, hh - marginY - 14).lineTo(0, hh - marginY - 8).lineTo(6, hh - marginY - 14)
        .stroke({ color: secondary, width: 1, alpha: 0.6 });
};

// Variant 3: outlined corner triangles with parallel diagonal slashes.
const drawDiagonalCorners = (context: FrameContext) => {
    const { target, hw, hh, marginX, marginY, primary, secondary } = context;
    const corner = Math.min(hw, hh) * 0.12;
    const corners = [
        [-hw + marginX, -hh + marginY, 1, 1],
        [hw - marginX, -hh + marginY, -1, 1],
        [-hw + marginX, hh - marginY, 1, -1],
        [hw - marginX, hh - marginY, -1, -1],
    ] as const;
    corners.forEach(([cx, cy, sx, sy], index) => {
        target.moveTo(cx + sx * corner, cy)
            .lineTo(cx, cy)
            .lineTo(cx, cy + sy * corner)
            .lineTo(cx + sx * corner, cy)
            .stroke({ color: primary, width: 1.5, alpha: 0.5 });
        // Inner parallel slash pair.
        target.moveTo(cx + sx * corner * 0.55, cy).lineTo(cx, cy + sy * corner * 0.55)
            .stroke({ color: index % 2 === 0 ? secondary : primary, width: 1, alpha: 0.4 });
        target.moveTo(cx + sx * corner * 0.3, cy).lineTo(cx, cy + sy * corner * 0.3)
            .stroke({ color: primary, width: 1, alpha: 0.25 });
    });

    // Baseline with alternating diamond markers.
    const barY = hh - marginY - 12;
    target.moveTo(-hw + marginX + corner + 10, barY).lineTo(hw - marginX - corner - 10, barY)
        .stroke({ color: primary, width: 1, alpha: 0.3 });
    for (let i = 0; i < 5; i += 1) {
        const x = -hw + marginX + corner + 30 + i * 26;
        const s = i === 2 ? 5 : 3;
        target.moveTo(x, barY - s).lineTo(x + s, barY).lineTo(x, barY + s).lineTo(x - s, barY)
            .lineTo(x, barY - s)
            .stroke({ color: i === 2 ? secondary : primary, width: 1, alpha: 0.55 });
    }
};

// Variant 4: dotted side columns with a center crosshair and baseline.
const drawDottedColumns = (context: FrameContext) => {
    const { target, hw, hh, marginX, marginY, primary, secondary } = context;
    const rows = 14;
    for (let i = 0; i < rows; i += 1) {
        const y = -hh + marginY + 10 + i * ((hh - marginY - 10) * 2) / (rows - 1);
        const strong = i % 4 === 0;
        target.circle(-hw + marginX, y, strong ? 2.4 : 1.4)
            .fill({ color: strong ? secondary : primary, alpha: strong ? 0.6 : 0.3 });
        target.circle(hw - marginX, y, strong ? 2.4 : 1.4)
            .fill({ color: strong ? secondary : primary, alpha: strong ? 0.6 : 0.3 });
    }
    // Center registration crosshair kept subtle so it sits behind text.
    target.moveTo(-18, 0).lineTo(18, 0).stroke({ color: primary, width: 1, alpha: 0.22 });
    target.moveTo(0, -18).lineTo(0, 18).stroke({ color: primary, width: 1, alpha: 0.22 });
    target.circle(0, 0, 6).stroke({ color: primary, width: 1, alpha: 0.3 });

    const barY = hh - marginY - 8;
    target.moveTo(-hw + marginX + 16, barY).lineTo(hw - marginX - 16, barY)
        .stroke({ color: primary, width: 1, alpha: 0.3 });
    drawCross(target, -hw + marginX + 8, barY, 3, primary, 0.5);
    drawCross(target, hw - marginX - 8, barY, 3, primary, 0.5);
};

// Variant 5: inset double frame with center gaps and filled corner squares.
const drawDoubleFrame = (context: FrameContext) => {
    const { target, hw, hh, marginX, marginY, primary, secondary } = context;
    const left = -hw + marginX;
    const right = hw - marginX;
    const top = -hh + marginY;
    const bottom = hh - marginY;
    const gapX = (right - left) * 0.18;
    const gapY = (bottom - top) * 0.22;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;

    // Outer frame broken at the middle of each edge.
    target.moveTo(left, top).lineTo(cx - gapX / 2, top).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(cx + gapX / 2, top).lineTo(right, top).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(left, bottom).lineTo(cx - gapX / 2, bottom).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(cx + gapX / 2, bottom).lineTo(right, bottom).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(left, top).lineTo(left, cy - gapY / 2).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(left, cy + gapY / 2).lineTo(left, bottom).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(right, top).lineTo(right, cy - gapY / 2).stroke({ color: primary, width: 2, alpha: 0.45 });
    target.moveTo(right, cy + gapY / 2).lineTo(right, bottom).stroke({ color: primary, width: 2, alpha: 0.45 });

    // Inner echo frame (continuous, thinner).
    const inset = 7;
    target.rect(left + inset, top + inset, right - left - inset * 2, bottom - top - inset * 2)
        .stroke({ color: primary, width: 1, alpha: 0.18 });

    // Filled corner squares + small notch ticks at the gaps.
    [[left, top], [right, top], [left, bottom], [right, bottom]].forEach(([x, y], index) => {
        target.rect(x - 3, y - 3, 6, 6).fill({ color: index % 2 === 0 ? secondary : primary, alpha: 0.6 });
    });
    target.moveTo(cx - 5, top).lineTo(cx + 5, top).stroke({ color: secondary, width: 3, alpha: 0.5 });
    target.moveTo(cx - 5, bottom).lineTo(cx + 5, bottom).stroke({ color: secondary, width: 3, alpha: 0.5 });
};

// Variant 6: measurement ruler ticks along all four edges.
const drawRulerFrame = (context: FrameContext) => {
    const { target, hw, hh, marginX, marginY, primary, secondary } = context;
    const left = -hw + marginX;
    const right = hw - marginX;
    const top = -hh + marginY;
    const bottom = hh - marginY;
    const xTicks = 32;
    const yTicks = 18;
    for (let i = 0; i <= xTicks; i += 1) {
        const x = left + ((right - left) * i) / xTicks;
        const major = i % 8 === 0;
        const mid = i % 4 === 0;
        const len = major ? 12 : mid ? 7 : 4;
        const color = major ? secondary : primary;
        target.moveTo(x, top).lineTo(x, top + len).stroke({ color, width: 1, alpha: major ? 0.55 : 0.32 });
        target.moveTo(x, bottom).lineTo(x, bottom - len).stroke({ color, width: 1, alpha: major ? 0.55 : 0.32 });
    }
    for (let i = 0; i <= yTicks; i += 1) {
        const y = top + ((bottom - top) * i) / yTicks;
        const major = i % 6 === 0;
        const len = major ? 12 : i % 3 === 0 ? 7 : 4;
        const color = major ? secondary : primary;
        target.moveTo(left, y).lineTo(left + len, y).stroke({ color, width: 1, alpha: major ? 0.55 : 0.32 });
        target.moveTo(right, y).lineTo(right - len, y).stroke({ color, width: 1, alpha: major ? 0.55 : 0.32 });
    }
    // Quiet center ring to anchor the ruler system.
    target.circle(0, 0, 10).stroke({ color: primary, width: 1, alpha: 0.25 });
    target.circle(0, 0, 3).fill({ color: secondary, alpha: 0.4 });
};

// Variant 7: corner quarter arcs, edge nodes and a bottom arc gauge with needle.
const drawArcGauge = (context: FrameContext) => {
    const { target, hw, hh, marginX, marginY, primary, secondary, seed } = context;
    const arcR = Math.min(hw, hh) * 0.11;
    const corners = [
        [-hw + marginX, -hh + marginY, 0, Math.PI / 2],
        [hw - marginX, -hh + marginY, Math.PI / 2, Math.PI],
        [hw - marginX, hh - marginY, Math.PI, Math.PI * 1.5],
        [-hw + marginX, hh - marginY, Math.PI * 1.5, Math.PI * 2],
    ] as const;
    // An arc continues the current path, so each one first moves to its own start point; without it
    // Pixi joins it to the previous shape's last point (a stray connector) and, while the arc has not
    // drawn in yet, strokes the previous fill's path in its place.
    const arcFrom = (cx: number, cy: number, r: number, start: number, end: number) => target
        .moveTo(cx + Math.cos(start) * r, cy + Math.sin(start) * r)
        .arc(cx, cy, r, start, end);
    corners.forEach(([cx, cy, start, end], index) => {
        arcFrom(cx, cy, arcR, start, end).stroke({ color: primary, width: 2, alpha: 0.5 });
        arcFrom(cx, cy, arcR * 0.72, start, end).stroke({ color: primary, width: 1, alpha: 0.25 });
        const mid = (start + end) / 2;
        target.circle(cx + Math.cos(mid) * arcR, cy + Math.sin(mid) * arcR, 2)
            .fill({ color: index % 2 === 0 ? secondary : primary, alpha: 0.6 });
    });

    // Edge node dots halfway along each side.
    target.circle(0, -hh + marginY, 2).fill({ color: primary, alpha: 0.45 });
    target.circle(-hw + marginX, 0, 2).fill({ color: primary, alpha: 0.45 });
    target.circle(hw - marginX, 0, 2).fill({ color: primary, alpha: 0.45 });

    // Bottom semicircular gauge with a seed-fixed needle.
    const gaugeY = hh - marginY + arcR * 0.4;
    const gaugeR = Math.min(hw, hh) * 0.16;
    arcFrom(0, gaugeY, gaugeR, Math.PI, Math.PI * 2).stroke({ color: primary, width: 1.5, alpha: 0.4 });
    for (let i = 0; i <= 8; i += 1) {
        const angle = Math.PI + (i / 8) * Math.PI;
        target.moveTo(Math.cos(angle) * (gaugeR - 5), gaugeY + Math.sin(angle) * (gaugeR - 5))
            .lineTo(Math.cos(angle) * gaugeR, gaugeY + Math.sin(angle) * gaugeR)
            .stroke({ color: i % 4 === 0 ? secondary : primary, width: 1, alpha: 0.45 });
    }
    const needle = Math.PI + (((seed % 100) / 100) * Math.PI);
    target.moveTo(0, gaugeY)
        .lineTo(Math.cos(needle) * (gaugeR - 8), gaugeY + Math.sin(needle) * (gaugeR - 8))
        .stroke({ color: secondary, width: 2, alpha: 0.6 });
    target.circle(0, gaugeY, 2.5).fill({ color: primary, alpha: 0.7 });
};

// Dispatches the seeded background HUD variant; unknown variants fall back to classic.
export const drawSonnetBackgroundMgHud = (options: SonnetBackgroundMgOptions) => {
    const context = withFrame(options);
    switch (options.variant % SONNET_BACKGROUND_MG_VARIANT_COUNT) {
        case 1:
            drawCornerBrackets(context);
            return;
        case 2:
            drawMarqueeStrips(context);
            return;
        case 3:
            drawDiagonalCorners(context);
            return;
        case 4:
            drawDottedColumns(context);
            return;
        case 5:
            drawDoubleFrame(context);
            return;
        case 6:
            drawRulerFrame(context);
            return;
        case 7:
            drawArcGauge(context);
            return;
        default:
            drawClassicCross(context);
    }
};
