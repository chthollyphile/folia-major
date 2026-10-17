import {
    heatPendoloBeatFxColor,
    PENDOLO_MAX_SPARKS,
    PENDOLO_OUTER_DIAL,
    PENDOLO_SPARK_STRIDE,
    PENDOLO_TICK_DIAL,
    PENDOLO_WAVE_LIGHT,
    PENDOLO_WAVE_PUSH,
    PENDOLO_WAVE_TINT,
    resolvePendoloWaveBump,
    type PendoloMeshPoint,
    type PendoloWaveFrame,
} from './pendoloBeatFx';
import { resolvePendoloClockworkAnchors, type PendoloClockworkFrameInput, type PendoloClockworkLayout } from './pendoloClockworkScene';

// src/components/visualizer/pendolo/pendoloBeatFxDraw.ts
// Where 时计's beat effects land on the clockwork, and how each renderer draws them: the lit ticks,
// the lit outermost dial, the jewel flares and the sparks as additive overlay geometry (a vertex list for WebGL, Canvas2D
// calls for the fallback), the shockwave lens as a pass over the clockwork itself (shader uniforms
// in WebGL; slices of the canvas redrawn in Canvas2D). Positions match pendoloClockworkDraw2d.ts /
// pendoloClockworkMeshes.ts exactly - the ticks light on top of the real ticks, not beside them.

/** One frame of beat effects in the renderer's space (CSS px, relative to the clockwork box). */
export interface PendoloBeatFxDrawFrame {
    jewelFlare: number;
    smallJewelFlare: number;
    /** How lit the ticks' dial / the outermost dial are, from the shockwave passing them. */
    tickDialLight: number;
    outerDialLight: number;
    /** The spark pool (pendoloBeatFx.ts layout), in viewport px; offset by `offsetX/Y` to draw. */
    sparks: Float32Array;
    offsetX: number;
    offsetY: number;
    /** The lens, centred on the wheel; null when no shockwave is on. */
    wave: PendoloWaveFrame | null;
    color: readonly [number, number, number];
}

const TICK_COUNT = 60;
/** Segments of the lit outermost dial; a glow under it and a bright line on top. */
const DIAL_SEGMENTS = 120;
const DIAL_GLOW_WIDTH = 10;


interface Jewel {
    x: number;
    y: number;
    small: boolean;
}

/** The jewel bearings that flare: the hub and the balance are the large ones. */
const resolveJewels = (input: PendoloClockworkFrameInput): Jewel[] => {
    const anchors = resolvePendoloClockworkAnchors(input);
    const jewels: Jewel[] = [
        { x: input.centerX, y: input.centerY, small: false },
        { x: anchors.balanceCx, y: anchors.balanceCy, small: false },
        { x: anchors.transCx, y: anchors.transCy, small: true },
        { x: anchors.secondGearCx, y: anchors.secondGearCy, small: true },
        { x: anchors.idlerCx, y: anchors.idlerCy, small: true },
    ];
    for (let index = 0; index < 3; index += 1) {
        const angle = input.escapementAngle * 0.4 + (index * Math.PI * 2) / 3;
        jewels.push({
            x: input.centerX + anchors.orbitR * Math.cos(angle),
            y: input.centerY + anchors.orbitR * Math.sin(angle),
            small: true,
        });
    }
    return jewels;
};

/** Where the gears mesh, for the sparks (same space as the layout passed in). */
export const resolvePendoloMeshPoints = (layout: PendoloClockworkLayout): PendoloMeshPoint[] => {
    const anchors = resolvePendoloClockworkAnchors(layout);
    const between = (ax: number, ay: number, bx: number, by: number): PendoloMeshPoint => ({
        x: (ax + bx) / 2,
        y: (ay + by) / 2,
        tx: -(by - ay),
        ty: bx - ax,
    });
    const towardTransX = anchors.transCx - layout.centerX;
    const towardTransY = anchors.transCy - layout.centerY;
    const length = Math.hypot(towardTransX, towardTransY) || 1;
    return [
        between(anchors.transCx, anchors.transCy, anchors.idlerCx, anchors.idlerCy),
        between(anchors.idlerCx, anchors.idlerCy, anchors.secondGearCx, anchors.secondGearCy),
        // The main wheel's rim where it drives the transmission gear.
        {
            x: layout.centerX + (towardTransX / length) * layout.baseRadius,
            y: layout.centerY + (towardTransY / length) * layout.baseRadius,
            tx: -towardTransY,
            ty: towardTransX,
        },
    ];
};

const flareRadius = (flare: number, small: boolean) => (small ? 26 : 40) * (0.6 + Math.min(1.5, flare));
const sparkAlpha = (life: number) => Math.min(1, Math.max(0, life / 0.3));
/** A spark's trail and white-hot head: seconds of its velocity, and widths (CSS px). */
const SPARK_TRAIL = 0.045;
const SPARK_HEAD = 0.012;
const SPARK_WIDTH = 2.2;
const SPARK_HEAD_WIDTH = 2.6;

/** Whether a frame has anything for the overlay pass to draw. */
const hasOverlay = (fx: PendoloBeatFxDrawFrame) => {
    if (fx.jewelFlare > 0.01 || fx.smallJewelFlare > 0.01) return true;
    if (fx.tickDialLight > 0 || fx.outerDialLight > 0) return true;
    for (let at = 4; at < fx.sparks.length; at += PENDOLO_SPARK_STRIDE) if (fx.sparks[at] > 0) return true;
    return false;
};

// ---------- WebGL: overlay as a vertex list ----------

/** Floats per overlay vertex: x, y (CSS px), r, g, b, a (premultiplied), u, v (u < -1 = solid). */
export const PENDOLO_OVERLAY_STRIDE = 8;
/** Enough for every tick, the dial twice, every jewel and two segments per spark, six vertices per quad. */
export const PENDOLO_OVERLAY_MAX_VERTICES = (TICK_COUNT + DIAL_SEGMENTS * 2 + 8 + PENDOLO_MAX_SPARKS * 2) * 6;

const pushQuad = (
    out: Float32Array,
    at: number,
    corners: readonly [number, number, number, number, number, number, number, number],
    color: readonly [number, number, number],
    alpha: number,
    radial: boolean,
): number => {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = corners;
    const r = (color[0] / 255) * alpha;
    const g = (color[1] / 255) * alpha;
    const b = (color[2] / 255) * alpha;
    // Two triangles: 0-1-2, 2-1-3. Radial quads carry -1..1 coordinates, solid ones a marker.
    const verts: Array<[number, number, number, number]> = [
        [x0, y0, -1, -1], [x1, y1, 1, -1], [x2, y2, -1, 1],
        [x2, y2, -1, 1], [x1, y1, 1, -1], [x3, y3, 1, 1],
    ];
    let offset = at * PENDOLO_OVERLAY_STRIDE;
    for (const [x, y, u, v] of verts) {
        out[offset] = x;
        out[offset + 1] = y;
        out[offset + 2] = r;
        out[offset + 3] = g;
        out[offset + 4] = b;
        out[offset + 5] = alpha;
        out[offset + 6] = radial ? u : -2;
        out[offset + 7] = radial ? v : -2;
        offset += PENDOLO_OVERLAY_STRIDE;
    }
    return at + 6;
};

/** A line segment as a quad `width` px wide. */
const pushSegment = (
    out: Float32Array,
    at: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    width: number,
    color: readonly [number, number, number],
    alpha: number,
) => {
    const length = Math.hypot(bx - ax, by - ay) || 1;
    const nx = (-(by - ay) / length) * width * 0.5;
    const ny = ((bx - ax) / length) * width * 0.5;
    return pushQuad(out, at, [ax + nx, ay + ny, bx + nx, by + ny, ax - nx, ay - ny, bx - nx, by - ny], color, alpha, false);
};

/** Fills `out` with the overlay for this frame; answers the vertex count (0 = skip the pass). */
export const buildPendoloBeatFxOverlay = (
    out: Float32Array,
    input: PendoloClockworkFrameInput,
    fx: PendoloBeatFxDrawFrame,
): number => {
    if (!hasOverlay(fx)) return 0;
    let at = 0;
    const { centerX, centerY, baseRadius, escapementAngle } = input;
    if (fx.tickDialLight > 0) {
        // The whole dial at once, as the wave passes it.
        const outerTickR = baseRadius * PENDOLO_TICK_DIAL;
        const light = fx.tickDialLight;
        for (let index = 0; index < TICK_COUNT; index += 1) {
            const angle = (index * Math.PI * 2) / TICK_COUNT + escapementAngle * 0.2;
            const tickLen = index % 5 === 0 ? 12 : 6;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            at = pushSegment(
                out, at,
                centerX + outerTickR * cos, centerY + outerTickR * sin,
                centerX + (outerTickR + tickLen) * cos, centerY + (outerTickR + tickLen) * sin,
                1.5 + 2.5 * light,
                heatPendoloBeatFxColor(fx.color, 0.25 * light),
                0.35 + 0.65 * light,
            );
        }
    }
    if (fx.outerDialLight > 0) {
        const dialR = baseRadius * PENDOLO_OUTER_DIAL;
        const light = fx.outerDialLight;
        const hot = heatPendoloBeatFxColor(fx.color, 0.3 * light);
        for (let index = 0; index < DIAL_SEGMENTS; index += 1) {
            const a0 = (index * Math.PI * 2) / DIAL_SEGMENTS;
            const a1 = ((index + 1) * Math.PI * 2) / DIAL_SEGMENTS;
            const x0 = centerX + dialR * Math.cos(a0);
            const y0 = centerY + dialR * Math.sin(a0);
            const x1 = centerX + dialR * Math.cos(a1);
            const y1 = centerY + dialR * Math.sin(a1);
            at = pushSegment(out, at, x0, y0, x1, y1, DIAL_GLOW_WIDTH, fx.color, 0.22 * light);
            at = pushSegment(out, at, x0, y0, x1, y1, 1.5 + 1.5 * light, hot, light);
        }
    }
    if (fx.jewelFlare > 0.01 || fx.smallJewelFlare > 0.01) {
        const hot = heatPendoloBeatFxColor(fx.color, 0.6);
        for (const jewel of resolveJewels(input)) {
            const flare = jewel.small ? Math.max(fx.jewelFlare, fx.smallJewelFlare) : fx.jewelFlare;
            if (flare <= 0.01) continue;
            const r = flareRadius(flare, jewel.small);
            at = pushQuad(out, at, [jewel.x - r, jewel.y - r, jewel.x + r, jewel.y - r, jewel.x - r, jewel.y + r, jewel.x + r, jewel.y + r], hot, Math.min(1, flare), true);
        }
    }
    const tail = fx.color;
    const head = heatPendoloBeatFxColor(fx.color, 0.8);
    for (let p = 0; p < fx.sparks.length; p += PENDOLO_SPARK_STRIDE) {
        const life = fx.sparks[p + 4];
        if (life <= 0) continue;
        const x = fx.sparks[p] - fx.offsetX;
        const y = fx.sparks[p + 1] - fx.offsetY;
        const vx = fx.sparks[p + 2];
        const vy = fx.sparks[p + 3];
        const alpha = sparkAlpha(life);
        // The trail in the effect colour, a short white-hot head on top.
        at = pushSegment(out, at, x, y, x - vx * SPARK_TRAIL, y - vy * SPARK_TRAIL, SPARK_WIDTH, tail, alpha);
        at = pushSegment(out, at, x, y, x - vx * SPARK_HEAD, y - vy * SPARK_HEAD, SPARK_HEAD_WIDTH, head, alpha);
    }
    return at;
};

/**
 * The lens as the mesh shader takes it: crest radius, width, push share, light share; all zero when
 * no shockwave is on, which leaves every vertex and colour exactly as without it.
 */
export const resolvePendoloWaveUniform = (wave: PendoloWaveFrame | null): [number, number, number, number] => (
    wave ? [wave.radius, wave.band, PENDOLO_WAVE_PUSH * wave.strength, PENDOLO_WAVE_LIGHT * wave.strength] : [0, 0, 0, 0]
);

// ---------- Canvas2D ----------

const rgba = (color: readonly [number, number, number], alpha: number) => `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;

const WAVE_SLICES = 14;

/**
 * The shockwave lens on the clockwork already drawn into `canvas`: thin rings of it redrawn a little
 * enlarged about the hub (bell-shaped, so no edge shows) and added once more to light them. Uses
 * `scratch` to hold the frame; only called while a wave is on. `ctx` has the dpr transform set.
 */
export const drawPendoloWaveLens2d = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    scratch: HTMLCanvasElement,
    input: PendoloClockworkFrameInput,
    wave: PendoloWaveFrame,
    color: readonly [number, number, number],
    cssWidth: number,
    cssHeight: number,
) => {
    if (scratch.width !== canvas.width || scratch.height !== canvas.height) {
        scratch.width = canvas.width;
        scratch.height = canvas.height;
    }
    const scratchCtx = scratch.getContext('2d');
    if (!scratchCtx) return;
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
    scratchCtx.drawImage(canvas, 0, 0);
    const { centerX: cx, centerY: cy } = input;
    for (let index = 0; index < WAVE_SLICES; index += 1) {
        const u0 = index / WAVE_SLICES;
        const u1 = (index + 1) / WAVE_SLICES;
        const r0 = Math.max(0, wave.radius - wave.band + wave.band * u0);
        const r1 = wave.radius - wave.band + wave.band * u1;
        if (r1 <= 0) continue;
        const bump = resolvePendoloWaveBump(wave, (r0 + r1) / 2);
        if (bump <= 0) continue;
        const scale = 1 + PENDOLO_WAVE_PUSH * wave.strength * bump;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r1, 0, Math.PI * 2);
        ctx.arc(cx, cy, r0, 0, Math.PI * 2, true);
        ctx.clip('evenodd');
        ctx.translate(cx * (1 - scale), cy * (1 - scale));
        ctx.scale(scale, scale);
        ctx.clearRect(0, 0, cssWidth, cssHeight);
        ctx.drawImage(scratch, 0, 0, cssWidth, cssHeight);
        const light = PENDOLO_WAVE_LIGHT * wave.strength * bump;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.min(1, light);
        ctx.drawImage(scratch, 0, 0, cssWidth, cssHeight);
        // Tinted toward the effect colour where something is drawn ('source-atop'): no ring of its own.
        ctx.globalCompositeOperation = 'source-atop';
        ctx.globalAlpha = Math.min(1, PENDOLO_WAVE_TINT * light);
        ctx.fillStyle = rgba(color, 1);
        ctx.fillRect(0, 0, cssWidth, cssHeight);
        ctx.restore();
    }
};

/** The overlay (lit ticks, jewel flares, sparks) with Canvas2D; `ctx` has the dpr transform set. */
export const drawPendoloBeatFxOverlay2d = (
    ctx: CanvasRenderingContext2D,
    input: PendoloClockworkFrameInput,
    fx: PendoloBeatFxDrawFrame,
) => {
    if (!hasOverlay(fx)) return;
    const { centerX, centerY, baseRadius, escapementAngle } = input;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    if (fx.tickDialLight > 0) {
        // The whole dial at once, as the wave passes it.
        const outerTickR = baseRadius * PENDOLO_TICK_DIAL;
        const light = fx.tickDialLight;
        for (let index = 0; index < TICK_COUNT; index += 1) {
            const angle = (index * Math.PI * 2) / TICK_COUNT + escapementAngle * 0.2;
            const tickLen = index % 5 === 0 ? 12 : 6;
            ctx.strokeStyle = rgba(heatPendoloBeatFxColor(fx.color, 0.25 * light), 0.35 + 0.65 * light);
            ctx.lineWidth = 1.5 + 2.5 * light;
            ctx.beginPath();
            ctx.moveTo(centerX + outerTickR * Math.cos(angle), centerY + outerTickR * Math.sin(angle));
            ctx.lineTo(centerX + (outerTickR + tickLen) * Math.cos(angle), centerY + (outerTickR + tickLen) * Math.sin(angle));
            ctx.stroke();
        }
    }
    if (fx.outerDialLight > 0) {
        const dialR = baseRadius * PENDOLO_OUTER_DIAL;
        const light = fx.outerDialLight;
        ctx.strokeStyle = rgba(fx.color, 0.22 * light);
        ctx.lineWidth = DIAL_GLOW_WIDTH;
        ctx.beginPath();
        ctx.arc(centerX, centerY, dialR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = rgba(heatPendoloBeatFxColor(fx.color, 0.3 * light), light);
        ctx.lineWidth = 1.5 + 1.5 * light;
        ctx.beginPath();
        ctx.arc(centerX, centerY, dialR, 0, Math.PI * 2);
        ctx.stroke();
    }
    if (fx.jewelFlare > 0.01 || fx.smallJewelFlare > 0.01) {
        const hot = heatPendoloBeatFxColor(fx.color, 0.6);
        for (const jewel of resolveJewels(input)) {
            const flare = jewel.small ? Math.max(fx.jewelFlare, fx.smallJewelFlare) : fx.jewelFlare;
            if (flare <= 0.01) continue;
            const r = flareRadius(flare, jewel.small);
            const gradient = ctx.createRadialGradient(jewel.x, jewel.y, 0, jewel.x, jewel.y, r);
            // Same falloff as the WebGL quad: (1 - r)^2.
            gradient.addColorStop(0, rgba(hot, Math.min(1, flare)));
            gradient.addColorStop(0.5, rgba(hot, Math.min(1, flare) * 0.25));
            gradient.addColorStop(1, rgba(hot, 0));
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(jewel.x, jewel.y, r, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    const head = heatPendoloBeatFxColor(fx.color, 0.8);
    for (let p = 0; p < fx.sparks.length; p += PENDOLO_SPARK_STRIDE) {
        const life = fx.sparks[p + 4];
        if (life <= 0) continue;
        const x = fx.sparks[p] - fx.offsetX;
        const y = fx.sparks[p + 1] - fx.offsetY;
        const vx = fx.sparks[p + 2];
        const vy = fx.sparks[p + 3];
        const alpha = sparkAlpha(life);
        ctx.strokeStyle = rgba(fx.color, alpha);
        ctx.lineWidth = SPARK_WIDTH;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - vx * SPARK_TRAIL, y - vy * SPARK_TRAIL);
        ctx.stroke();
        ctx.strokeStyle = rgba(head, alpha);
        ctx.lineWidth = SPARK_HEAD_WIDTH;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - vx * SPARK_HEAD, y - vy * SPARK_HEAD);
        ctx.stroke();
    }
    ctx.restore();
};
