import { colorWithAlpha, parseColorChannels } from '../colorMix';
import {
    buildPendoloClockworkPalette,
    resolvePendoloClockworkAnchors,
    type PendoloClockworkFrameInput,
} from './pendoloClockworkScene';
import { PENDOLO_PART_BASE_SUFFIX, resolvePendoloPartHeight } from './pendoloParallax';

// src/components/visualizer/pendolo/pendoloClockworkMeshes.ts
// Cached local-space mesh with per-vertex partId; one draw, uniform transform table.

/** x,y,rgba,partId */
export const PENDOLO_MESH_STRIDE = 7;
/** 部件上限：原来的部件（约 24 个）加上分层视差时各齿轮的低处线。 */
export const PENDOLO_MAX_PARTS = 44;
/** Canvas2D's default miterLimit; sharper joins are bevelled, as Canvas2D does. */
const PENDOLO_MITER_LIMIT = 10;

export interface PendoloMotionSample {
    escapementAngle: number;
    phase: number;
    bassOscillation: number;
    secondGearAngle: number;
    /** Added to the transmission gear's turn (智能动感模式); absent or 0 otherwise. */
    transBeatAngle?: number;
}

export interface PendoloCachedPart {
    /** World-space origin for local vertices (supports planetary orbit). */
    getOrigin: (motion: PendoloMotionSample) => { x: number; y: number };
    /** Spin around origin in radians. */
    getRotation: (motion: PendoloMotionSample) => number;
    /** 分层视差里离表盘平面的高度（轮盘半径的比例，pendoloParallax.ts）。 */
    height: number;
}

/**
 * 分层视差时的一块齿轮顶面（遮挡用，只写深度不出颜色）：在 faceData 里，[fanStart, fanStart+fanCount)
 * 是齿形围出的整块面，[holeStart, holeStart+holeCount) 是要从面上抠掉的洞（透过洞看得到下层）。
 */
export interface PendoloOccluderFace {
    fanStart: number;
    fanCount: number;
    holeStart: number;
    holeCount: number;
}

export interface PendoloCachedScene {
    key: string;
    data: Float32Array;
    parts: PendoloCachedPart[];
    vertexCount: number;
    /** 分层视差时各齿轮顶面的网格（同样的顶点格式）；没有视差时不生成。 */
    faceData?: Float32Array;
    faces?: PendoloOccluderFace[];
}

/**
 * 齿轮上的轮廓线：外缘齿形（polyline），以及辐条轮的轮毂圈、轮缘圈和上面的洞（circle）。
 * 记下来给分层视差补「低处线」（齿轮底面上的同一条线）用。
 */
type PendoloGearOutline = {
    partKey: string;
    lineWidth: number;
    rgba: [number, number, number, number];
} & (
    | { kind: 'polyline'; pts: Array<{ x: number; y: number }> }
    | { kind: 'circle'; cx: number; cy: number; radius: number; segments: number }
);

class PendoloMeshBuilder {
    private data: number[] = [];

    private activePartId = 0;

    /** 当前在画的部件的 key（pushPart 设）。 */
    activePartKey = '';

    /** 不为 null 时，appendGearLocal 把画过的齿形记在这里（分层视差开着时）。 */
    gearOutlines: PendoloGearOutline[] | null = null;

    /** 不为 null 时记下齿轮的面（齿形）和面上的洞，分层视差时算遮挡用。 */
    faceOutlines: Array<{ partKey: string; pts: Array<{ x: number; y: number }>; filled: boolean }> | null = null;

    faceHoles: Array<{ partKey: string; cx: number; cy: number; radius: number }> | null = null;

    get vertexCount() {
        return this.data.length / PENDOLO_MESH_STRIDE;
    }

    toFloat32() {
        return new Float32Array(this.data);
    }

    setActivePartId(partId: number) {
        this.activePartId = partId;
    }

    private pushVert(x: number, y: number, r: number, g: number, b: number, a: number) {
        this.data.push(x, y, r, g, b, a, this.activePartId);
    }

    private pushTri(
        ax: number, ay: number,
        bx: number, by: number,
        cx: number, cy: number,
        r: number, g: number, b: number, a: number,
    ) {
        this.pushVert(ax, ay, r, g, b, a);
        this.pushVert(bx, by, r, g, b, a);
        this.pushVert(cx, cy, r, g, b, a);
    }

    appendLine(
        x0: number, y0: number, x1: number, y1: number,
        width: number, rgba: [number, number, number, number],
        extend = 0,
    ) {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) return;
        const ux = dx / len;
        const uy = dy / len;
        const hw = width * 0.5;
        const nx = -uy * hw;
        const ny = ux * hw;
        const ax = x0 - ux * extend;
        const ay = y0 - uy * extend;
        const bx = x1 + ux * extend;
        const by = y1 + uy * extend;
        const [r, g, b, a] = rgba;
        this.pushTri(ax + nx, ay + ny, ax - nx, ay - ny, bx + nx, by + ny, r, g, b, a);
        this.pushTri(ax - nx, ay - ny, bx - nx, by - ny, bx + nx, by + ny, r, g, b, a);
    }

    /**
     * Strokes a polyline the way Canvas2D does by default: miter joins (falling back to a bevel
     * past a miter limit of 10) and butt caps. Neighbouring segments share their join vertices, so
     * a translucent stroke covers every pixel once; overlapping the segments instead blends the
     * joints twice and they show up as brighter dots.
     */
    appendPolyline(
        points: Array<{ x: number; y: number }>,
        width: number,
        rgba: [number, number, number, number],
        closed = false,
    ) {
        // Coincident points would give a zero-length segment with no direction.
        const pts = points.filter((point, index) => {
            const previous = index > 0 ? points[index - 1] : null;
            return !previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-6;
        });
        if (closed && pts.length > 2) {
            const first = pts[0];
            const last = pts[pts.length - 1];
            if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) pts.pop();
        }
        const n = pts.length;
        if (n < 2) return;
        const hw = width * 0.5;
        const segmentCount = closed ? n : n - 1;
        // Unit normal of segment i (from pts[i] to pts[i + 1]).
        const normals: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < segmentCount; i++) {
            const a = pts[i];
            const b = pts[(i + 1) % n];
            const len = Math.hypot(b.x - a.x, b.y - a.y);
            normals.push({ x: -(b.y - a.y) / len, y: (b.x - a.x) / len });
        }
        // Offsets of each segment's start and end corners: shared miters where they fit,
        // the segment's own normal (butt end or bevel side) where they do not.
        const starts: Array<{ x: number; y: number }> = [];
        const ends: Array<{ x: number; y: number }> = [];
        const bevels: Array<{ point: { x: number; y: number }; from: { x: number; y: number }; to: { x: number; y: number } }> = [];
        for (let i = 0; i < segmentCount; i++) {
            starts.push({ x: normals[i].x * hw, y: normals[i].y * hw });
            ends.push({ x: normals[i].x * hw, y: normals[i].y * hw });
        }
        const joinCount = closed ? n : n - 2;
        for (let j = 0; j < joinCount; j++) {
            const incoming = closed ? (j + segmentCount - 1) % segmentCount : j;
            const outgoing = closed ? j : j + 1;
            const vertex = pts[closed ? j : j + 1];
            const n1 = normals[incoming];
            const n2 = normals[outgoing];
            const mx = n1.x + n2.x;
            const my = n1.y + n2.y;
            const mLen = Math.hypot(mx, my);
            const cosHalf = mLen / 2;
            if (mLen > 1e-6 && 1 / cosHalf <= PENDOLO_MITER_LIMIT) {
                const scale = hw / cosHalf / mLen;
                const miter = { x: mx * scale, y: my * scale };
                ends[incoming] = miter;
                starts[outgoing] = miter;
            } else {
                // Which side is outside the turn decides which corners the bevel joins.
                const turn = n1.x * n2.y - n1.y * n2.x;
                const side = turn > 0 ? -1 : 1;
                bevels.push({
                    point: vertex,
                    from: { x: n1.x * hw * side, y: n1.y * hw * side },
                    to: { x: n2.x * hw * side, y: n2.y * hw * side },
                });
            }
        }
        const [r, g, b, a] = rgba;
        for (let i = 0; i < segmentCount; i++) {
            const p0 = pts[i];
            const p1 = pts[(i + 1) % n];
            const s0 = starts[i];
            const e0 = ends[i];
            this.pushTri(p0.x + s0.x, p0.y + s0.y, p0.x - s0.x, p0.y - s0.y, p1.x + e0.x, p1.y + e0.y, r, g, b, a);
            this.pushTri(p0.x - s0.x, p0.y - s0.y, p1.x - e0.x, p1.y - e0.y, p1.x + e0.x, p1.y + e0.y, r, g, b, a);
        }
        for (const bevel of bevels) {
            const { point, from, to } = bevel;
            this.pushTri(point.x, point.y, point.x + from.x, point.y + from.y, point.x + to.x, point.y + to.y, r, g, b, a);
        }
    }

    appendCircleStroke(
        cx: number, cy: number, radius: number,
        width: number, rgba: [number, number, number, number],
        segments = 64,
    ) {
        if (radius <= 0 || width <= 0) return;
        const hw = width * 0.5;
        const inner = Math.max(0, radius - hw);
        const outer = radius + hw;
        const segs = Math.max(segments, Math.ceil(radius * 1.25));
        const [r, g, b, a] = rgba;
        for (let i = 0; i < segs; i++) {
            const a0 = (i * Math.PI * 2) / segs;
            const a1 = ((i + 1) * Math.PI * 2) / segs;
            const c0 = Math.cos(a0);
            const s0 = Math.sin(a0);
            const c1 = Math.cos(a1);
            const s1 = Math.sin(a1);
            this.pushTri(
                cx + outer * c0, cy + outer * s0,
                cx + inner * c0, cy + inner * s0,
                cx + outer * c1, cy + outer * s1,
                r, g, b, a,
            );
            this.pushTri(
                cx + inner * c0, cy + inner * s0,
                cx + inner * c1, cy + inner * s1,
                cx + outer * c1, cy + outer * s1,
                r, g, b, a,
            );
        }
    }

    appendFilledPolygonFromCenter(
        cx: number,
        cy: number,
        points: Array<{ x: number; y: number }>,
        rgba: [number, number, number, number],
    ) {
        if (points.length < 3) return;
        const [r, g, b, a] = rgba;
        for (let i = 0; i < points.length; i++) {
            const p0 = points[i];
            const p1 = points[(i + 1) % points.length];
            this.pushTri(cx, cy, p0.x, p0.y, p1.x, p1.y, r, g, b, a);
        }
    }

    /**
     * 分层视差的齿轮侧壁：沿齿形每一段立一块四边形，上沿顶点属于 `topPartId`（齿轮本身），下沿属于
     * `bottomPartId`（它的低处线），原点、转角相同、高度不同，投影后连成齿轮的侧面。被齿轮自己顶面
     * 挡住的那一半靠深度测试剔掉，只露出朝外的一侧。
     */
    appendWall(
        points: Array<{ x: number; y: number }>,
        topPartId: number,
        bottomPartId: number,
        rgba: [number, number, number, number],
    ) {
        const [r, g, b, a] = rgba;
        const vert = (p: { x: number; y: number }, partId: number) => {
            this.data.push(p.x, p.y, r, g, b, a, partId);
        };
        for (let i = 0; i < points.length; i++) {
            const p0 = points[i];
            const p1 = points[(i + 1) % points.length];
            vert(p0, topPartId);
            vert(p0, bottomPartId);
            vert(p1, topPartId);
            vert(p1, topPartId);
            vert(p0, bottomPartId);
            vert(p1, bottomPartId);
        }
    }

    appendArrowHead(tipX: number, tipY: number, rgba: [number, number, number, number]) {
        const [r, g, b, a] = rgba;
        this.pushTri(tipX, tipY - 4, tipX + 8, tipY, tipX, tipY + 4, r, g, b, a);
    }
}

/** Parses CSS color strings into RGBA 0..1. */
const parseRgba = (color: string): [number, number, number, number] => {
    const rgbaMatch = color.match(
        /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i,
    );
    if (rgbaMatch) {
        return [
            Number(rgbaMatch[1]) / 255,
            Number(rgbaMatch[2]) / 255,
            Number(rgbaMatch[3]) / 255,
            rgbaMatch[4] === undefined ? 1 : Number(rgbaMatch[4]),
        ];
    }
    const ch = parseColorChannels(color);
    if (!ch) return [1, 1, 1, 1];
    return [ch.r / 255, ch.g / 255, ch.b / 255, 1];
};

/** Cache key for layout + palette; motion angles are applied as uniforms. */
export const buildPendoloClockworkCacheKey = (input: PendoloClockworkFrameInput) => (
    [
        // Exact, not rounded: the mesh bakes the centre in, so any move must rebuild it.
        input.centerX,
        input.centerY,
        Math.round(input.baseRadius * 10),
        Math.round(input.lyricRingRadius * 10),
        input.showGearDecor,
        input.primaryTextColor,
        input.accentTextColor,
        // 视差开着时多出齿轮的低处线和侧壁
        input.parallaxScalePx ? 'parallax' : '',
    ].join('|')
);

const gearTeethPointsLocal = (radius: number, teethCount: number, toothDepth: number) => {
    const innerR = radius - toothDepth;
    const outerR = radius;
    const anglePerTooth = (Math.PI * 2) / teethCount;
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < teethCount; i++) {
        const baseAngle = i * anglePerTooth;
        const angles = [
            baseAngle - anglePerTooth * 0.22,
            baseAngle - anglePerTooth * 0.12,
            baseAngle + anglePerTooth * 0.12,
            baseAngle + anglePerTooth * 0.22,
        ];
        const radii = [innerR, outerR, outerR, innerR];
        for (let k = 0; k < 4; k++) {
            pts.push({
                x: radii[k] * Math.cos(angles[k]),
                y: radii[k] * Math.sin(angles[k]),
            });
        }
    }
    return pts;
};

const appendGearLocal = (
    mesh: PendoloMeshBuilder,
    radius: number, teethCount: number, toothDepth: number,
    stroke: string, lineWidth: number, fill?: string,
) => {
    const pts = gearTeethPointsLocal(radius, teethCount, toothDepth);
    if (fill) mesh.appendFilledPolygonFromCenter(0, 0, pts, parseRgba(fill));
    mesh.appendPolyline(pts, lineWidth, parseRgba(stroke), true);
    mesh.gearOutlines?.push({ partKey: mesh.activePartKey, kind: 'polyline', pts, lineWidth, rgba: parseRgba(stroke) });
    mesh.faceOutlines?.push({ partKey: mesh.activePartKey, pts, filled: Boolean(fill) });
};

const appendSpokedWheelLocal = (
    mesh: PendoloMeshBuilder,
    hubR: number, rimR: number, spokeCount: number,
    stroke: string, lineWidth: number,
) => {
    const rgba = parseRgba(stroke);
    // 轮毂圈、轮缘圈和洞在分层视差时也要有低处线：透过洞能看到洞的下沿
    const circle = (cx: number, cy: number, radius: number, segments = 64) => {
        mesh.appendCircleStroke(cx, cy, radius, lineWidth, rgba, segments);
        mesh.gearOutlines?.push({ partKey: mesh.activePartKey, kind: 'circle', cx, cy, radius, segments, lineWidth, rgba });
    };
    circle(0, 0, hubR);
    circle(0, 0, rimR);
    const angleStep = (Math.PI * 2) / spokeCount;
    for (let i = 0; i < spokeCount; i++) {
        const a = i * angleStep;
        mesh.appendLine(
            hubR * Math.cos(a), hubR * Math.sin(a),
            rimR * Math.cos(a), rimR * Math.sin(a),
            lineWidth, rgba,
        );
    }
    const midR = (hubR + rimR) * 0.5;
    const holeR = (rimR - hubR) * 0.22;
    for (let i = 0; i < spokeCount; i++) {
        const a = i * angleStep + angleStep * 0.5;
        circle(midR * Math.cos(a), midR * Math.sin(a), holeR, 24);
        mesh.faceHoles?.push({ partKey: mesh.activePartKey, cx: midR * Math.cos(a), cy: midR * Math.sin(a), radius: holeR });
    }
};

const appendHairspringLocal = (
    mesh: PendoloMeshBuilder,
    startR: number, endR: number, coils: number,
    stroke: string, lineWidth: number,
) => {
    const totalAngle = coils * Math.PI * 2;
    const steps = Math.round(coils * 60);
    const pts: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = t * totalAngle;
        const r = startR + (endR - startR) * Math.pow(t, 0.9);
        pts.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
    }
    mesh.appendPolyline(pts, lineWidth, parseRgba(stroke), false);
};

const appendJewelLocal = (
    mesh: PendoloMeshBuilder,
    outerR: number, innerR: number,
    strokeOuter: string, strokeInner: string, outerWidth: number, innerWidth: number,
) => {
    mesh.appendCircleStroke(0, 0, outerR, outerWidth, parseRgba(strokeOuter), 28);
    mesh.appendCircleStroke(0, 0, innerR, innerWidth, parseRgba(strokeInner), 20);
};

const fixedOrigin = (x: number, y: number) => () => ({ x, y });
const fixedRotation = (angle: number) => () => angle;

/**
 * Builds a rest-pose mesh scene. Same-transform pieces share a partId for one draw call.
 */
export const buildPendoloClockworkCachedScene = (
    input: PendoloClockworkFrameInput,
): PendoloCachedScene => {
    const key = buildPendoloClockworkCacheKey(input);
    const mesh = new PendoloMeshBuilder();
    const parts: PendoloCachedPart[] = [];
    const partKeys = new Map<string, number>();

    if (input.showGearDecor === 'none') {
        return { key, data: mesh.toFloat32(), parts, vertexCount: 0 };
    }

    const { centerX, centerY, baseRadius, primaryTextColor, accentTextColor, showGearDecor } = input;
    const anchors = resolvePendoloClockworkAnchors(input);
    const palette = buildPendoloClockworkPalette(primaryTextColor, accentTextColor, showGearDecor);
    const m = palette.decorOpacityMultiplier;
    const mainOrigin = fixedOrigin(centerX, centerY);

    const pushPart = (
        transformKey: string,
        build: () => void,
        getOrigin: PendoloCachedPart['getOrigin'],
        getRotation: PendoloCachedPart['getRotation'],
    ) => {
        let partId = partKeys.get(transformKey);
        if (partId === undefined) {
            if (parts.length >= PENDOLO_MAX_PARTS) {
                console.warn('[pendoloClockworkMeshes] exceeded PENDOLO_MAX_PARTS');
                return;
            }
            partId = parts.length;
            partKeys.set(transformKey, partId);
            parts.push({ getOrigin, getRotation, height: resolvePendoloPartHeight(transformKey) });
        }
        mesh.setActivePartId(partId);
        mesh.activePartKey = transformKey;
        build();
    };
    // 分层视差：每个齿轮除了自己高度上的这圈（高处线），再在低一个齿轮厚度的地方补一圈齿形（低处线）
    const parallax = Boolean(input.parallaxScalePx);
    if (parallax) {
        mesh.gearOutlines = [];
        mesh.faceOutlines = [];
        mesh.faceHoles = [];
    }

    pushPart('main-static', () => {
        const ringRgba = parseRgba(palette.primaryAlpha15);
        for (const r of [0.3, 0.6, 0.85, 1.15, 1.4].map((f) => baseRadius * f)) {
            mesh.appendCircleStroke(0, 0, r, 1, ringRgba);
        }
        const bevel = parseRgba(palette.bevelRing);
        mesh.appendCircleStroke(0, 0, baseRadius * 0.88, 0.8, bevel);
        mesh.appendCircleStroke(0, 0, baseRadius * 0.92, 0.8, bevel);
    }, mainOrigin, fixedRotation(0));
    // 中心宝石单独一个部件：分层视差时要浮在太阳轮上面，不能留在表盘平面被盖住。顶点顺序和原来一样
    pushPart('main-jewel', () => {
        appendJewelLocal(mesh, 4.5, 2.5, palette.jewelStrokeColor, palette.jewelFillColor, 1.2, 0.8);
    }, mainOrigin, fixedRotation(0));

    pushPart('main-ticks', () => {
        const outerTickR = baseRadius * 1.15;
        for (let i = 0; i < 60; i++) {
            const angle = (i * Math.PI * 2) / 60;
            const isMajor = i % 5 === 0;
            const tickLen = isMajor ? 12 : 6;
            mesh.appendLine(
                outerTickR * Math.cos(angle),
                outerTickR * Math.sin(angle),
                (outerTickR + tickLen) * Math.cos(angle),
                (outerTickR + tickLen) * Math.sin(angle),
                isMajor ? 1.5 : 1,
                parseRgba(isMajor ? palette.accentAlpha35 : palette.primaryAlpha15),
            );
        }
    }, mainOrigin, (motion) => motion.escapementAngle * 0.2);

    pushPart('main-esc', () => {
        appendGearLocal(mesh, baseRadius + 8, 36, 10, palette.gearAccentAlpha, 2.2, palette.mainGearFill);
        appendSpokedWheelLocal(mesh, baseRadius * 0.2, baseRadius * 0.85, 6, palette.gearPrimaryAlpha, 1.8);
        const guillocheInnerR = baseRadius * 0.62;
        const guillocheOuterR = baseRadius * 0.83;
        for (let i = 0; i < 48; i++) {
            const a = (i * Math.PI * 2) / 48;
            const innerOffset = i % 2 === 0
                ? guillocheInnerR
                : guillocheInnerR + (guillocheOuterR - guillocheInnerR) * 0.3;
            mesh.appendLine(
                innerOffset * Math.cos(a),
                innerOffset * Math.sin(a),
                guillocheOuterR * Math.cos(a),
                guillocheOuterR * Math.sin(a),
                0.7,
                parseRgba(i % 2 === 0 ? palette.primaryAlpha10 : palette.guillocheAlt),
            );
        }
        const rivetR = baseRadius * 0.96;
        const rivet = parseRgba(palette.rivetStroke);
        for (let i = 0; i < 12; i++) {
            const a = (i * Math.PI * 2) / 12;
            mesh.appendCircleStroke(rivetR * Math.cos(a), rivetR * Math.sin(a), 2.2, 0.8, rivet, 16);
        }
    }, mainOrigin, (motion) => motion.escapementAngle);

    pushPart(
        'main-sun',
        () => appendGearLocal(mesh, baseRadius * 0.22, 12, 6, palette.gearAccentStrongAlpha, 2.1),
        mainOrigin,
        (motion) => -motion.escapementAngle * 2.5,
    );

    for (let planetIdx = 0; planetIdx < 3; planetIdx++) {
        const idx = planetIdx;
        const planetOrigin = (motion: PendoloMotionSample) => {
            const planetAngle = motion.escapementAngle * 0.4 + (idx * Math.PI * 2) / 3;
            return {
                x: centerX + anchors.orbitR * Math.cos(planetAngle),
                y: centerY + anchors.orbitR * Math.sin(planetAngle),
            };
        };
        pushPart(
            `planet-${idx}-gear`,
            () => appendGearLocal(mesh, anchors.planetR, 14, 5, palette.planetGearAlpha, 1.7),
            planetOrigin,
            (motion) => -motion.escapementAngle * 3 + idx * 0.5,
        );
        pushPart(
            `planet-${idx}-jewel`,
            () => appendJewelLocal(mesh, 3.5, 1.8, palette.jewelStrokeColor, palette.jewelFillColor, 1, 0.7),
            planetOrigin,
            fixedRotation(0),
        );
    }

    const balanceOrigin = fixedOrigin(anchors.balanceCx, anchors.balanceCy);
    pushPart(
        'balance-gear',
        () => appendGearLocal(
            mesh, anchors.balanceR, 20, 7, palette.gearAccentStrongAlpha, 2.1, palette.balanceGearFill,
        ),
        balanceOrigin,
        (motion) => motion.phase * 0.1,
    );
    pushPart('balance-static', () => {
        mesh.appendCircleStroke(0, 0, anchors.balanceR * 0.52, 1.8, parseRgba(palette.gearPrimarySubtleAlpha));
        appendJewelLocal(mesh, 3.5, 1.8, palette.jewelStrokeColor, palette.jewelFillColor, 1, 0.7);
    }, balanceOrigin, fixedRotation(0));
    pushPart(
        'hairspring',
        () => appendHairspringLocal(
            mesh, anchors.balanceR * 0.56, anchors.balanceR * 0.88, 3.5,
            colorWithAlpha(accentTextColor, 0.30 * m), 0.8,
        ),
        balanceOrigin,
        (motion) => motion.bassOscillation * 0.6 + motion.phase * 0.1 * 0.3,
    );

    const transOrigin = fixedOrigin(anchors.transCx, anchors.transCy);
    pushPart('trans-spin', () => {
        appendGearLocal(mesh, anchors.transR, 24, 7, palette.gearPrimaryAlpha, 1.8);
        appendSpokedWheelLocal(
            mesh, anchors.transR * 0.25, anchors.transR * 0.85, 5, palette.gearPrimarySubtleAlpha, 1.5,
        );
        const genevaSpan = anchors.transR * 1.6;
        const genevaStep = genevaSpan / 10;
        const clipR = anchors.transR * 0.80;
        for (let i = 1; i <= 9; i++) {
            const yOff = -genevaSpan * 0.5 + i * genevaStep;
            const halfChord = Math.sqrt(Math.max(0, clipR * clipR - yOff * yOff));
            if (halfChord < 0.5) continue;
            mesh.appendLine(
                -halfChord, yOff, halfChord, yOff, 0.7,
                parseRgba(i % 2 === 0 ? palette.primaryAlpha10 : palette.genevaAlt),
            );
        }
    }, transOrigin, (motion) => -motion.escapementAngle * 1.4 + (motion.transBeatAngle ?? 0));
    pushPart(
        'trans-jewel',
        () => appendJewelLocal(mesh, 3.5, 1.8, palette.jewelStrokeColor, palette.jewelFillColor, 1, 0.7),
        transOrigin,
        fixedRotation(0),
    );

    const secondOrigin = fixedOrigin(anchors.secondGearCx, anchors.secondGearCy);
    pushPart(
        'second-spin',
        () => appendGearLocal(
            mesh, anchors.secondGearR, 15, 5, palette.gearAccentAlpha, 1.8, palette.secondGearFill,
        ),
        secondOrigin,
        (motion) => motion.secondGearAngle,
    );
    pushPart(
        'second-spoke',
        () => appendSpokedWheelLocal(
            mesh, anchors.secondGearR * 0.28, anchors.secondGearR * 0.76, 4,
            palette.gearPrimarySubtleAlpha, 1.3,
        ),
        secondOrigin,
        (motion) => -motion.secondGearAngle,
    );
    pushPart(
        'second-jewel',
        () => appendJewelLocal(mesh, 2.8, 1.5, palette.jewelStrokeColor, palette.jewelFillColor, 0.8, 0.6),
        secondOrigin,
        fixedRotation(0),
    );

    const idlerOrigin = fixedOrigin(anchors.idlerCx, anchors.idlerCy);
    pushPart(
        'idler-spin',
        () => appendGearLocal(mesh, anchors.idlerR, 10, 3.5, palette.idlerStroke, 1.3),
        idlerOrigin,
        (motion) => motion.escapementAngle * 2.2,
    );
    pushPart('idler-static', () => {
        mesh.appendCircleStroke(0, 0, anchors.idlerR * 0.45, 0.8, parseRgba(palette.idlerInner));
        appendJewelLocal(mesh, 2.2, 1.2, palette.jewelStrokeColor, palette.jewelFillColor, 0.7, 0.5);
    }, idlerOrigin, fixedRotation(0));

    pushPart('axis', () => {
        const axis = parseRgba(palette.gearAccentStrongAlpha);
        mesh.appendLine(
            centerX + baseRadius * 0.8, centerY,
            centerX + anchors.focalAxisEndRadius, centerY,
            2, axis,
        );
        mesh.appendArrowHead(centerX + anchors.focalAxisEndRadius, centerY, axis);
    }, fixedOrigin(0, 0), fixedRotation(0));

    if (!parallax || !mesh.gearOutlines?.length) {
        return {
            key,
            data: mesh.toFloat32(),
            parts,
            vertexCount: mesh.vertexCount,
        };
    }
    // 低处线画在最前面，被上面的齿轮（和它们的填色）盖住；跟着各自齿轮的原点和转角走
    const base = new PendoloMeshBuilder();
    // 同一个部件的低处线共用一个部件编号（同一原点、转角和高度）
    const baseIds = new Map<string, number>();
    for (const outline of mesh.gearOutlines) {
        const sourceId = partKeys.get(outline.partKey);
        if (sourceId === undefined) continue;
        const source = parts[sourceId];
        let baseId = baseIds.get(outline.partKey);
        if (baseId === undefined) {
            if (parts.length >= PENDOLO_MAX_PARTS) {
                console.warn('[pendoloClockworkMeshes] exceeded PENDOLO_MAX_PARTS (gear bases)');
                continue;
            }
            baseId = parts.length;
            baseIds.set(outline.partKey, baseId);
            parts.push({
                getOrigin: source.getOrigin,
                getRotation: source.getRotation,
                height: resolvePendoloPartHeight(`${outline.partKey}${PENDOLO_PART_BASE_SUFFIX}`),
            });
        }
        base.setActivePartId(baseId);
        if (outline.kind === 'polyline') {
            // 齿形一圈：高处线和低处线之间补上侧壁，齿轮看起来是立在下层上的一块
            const [wr, wg, wb, wa] = outline.rgba;
            base.appendWall(outline.pts, sourceId, baseId, [wr, wg, wb, wa * PENDOLO_GEAR_WALL_ALPHA]);
            base.setActivePartId(baseId);
            base.appendPolyline(outline.pts, outline.lineWidth, outline.rgba, true);
        } else {
            base.appendCircleStroke(outline.cx, outline.cy, outline.radius, outline.lineWidth, outline.rgba, outline.segments);
        }
    }
    const front = base.toFloat32();
    const back = mesh.toFloat32();
    const data = new Float32Array(front.length + back.length);
    data.set(front, 0);
    data.set(back, front.length);
    const occluders = buildOccluderFaces(mesh, partKeys, parseRgba(palette.secondGearFill));
    return {
        key,
        data,
        parts,
        vertexCount: base.vertexCount + mesh.vertexCount,
        faceData: occluders.data,
        faces: occluders.faces,
    };
};

/** 齿轮侧壁相对齿形描边的不透明度。 */
const PENDOLO_GEAR_WALL_ALPHA = 0.18;

/** 洞所在的部件和它要抠的那块面不是同一个部件时（转向不同），在这里对上。 */
const HOLE_FACE_PART: Record<string, string> = {
    'second-spoke': 'second-spin',
};

/**
 * 分层视差的遮挡面：每个齿轮的齿形围成一块面（从中心扇形三角化），面上的洞是圆盘。
 * 每个顶点带自己部件的编号，跟着各自的原点、转角和高度走；洞可以属于别的部件（秒轮的辐条）。
 * 本身没有填色的齿轮（行星轮、过桥轮）挡住下面的底色后会像个黑洞，面上补一层淡淡的 `unfilledRgba`。
 */
const buildOccluderFaces = (
    mesh: PendoloMeshBuilder,
    partKeys: Map<string, number>,
    unfilledRgba: [number, number, number, number],
) => {
    const out = new PendoloMeshBuilder();
    const faces: PendoloOccluderFace[] = [];
    const holeRgba: [number, number, number, number] = [0, 0, 0, 0];
    for (const face of mesh.faceOutlines ?? []) {
        const partId = partKeys.get(face.partKey);
        if (partId === undefined) continue;
        const fanStart = out.vertexCount;
        out.setActivePartId(partId);
        out.appendFilledPolygonFromCenter(0, 0, face.pts, face.filled ? holeRgba : unfilledRgba);
        const fanCount = out.vertexCount - fanStart;
        const holeStart = out.vertexCount;
        for (const hole of mesh.faceHoles ?? []) {
            const owner = HOLE_FACE_PART[hole.partKey] ?? hole.partKey;
            if (owner !== face.partKey) continue;
            const holePart = partKeys.get(hole.partKey);
            if (holePart === undefined) continue;
            out.setActivePartId(holePart);
            const pts = Array.from({ length: 24 }, (_, i) => {
                const a = (i * Math.PI * 2) / 24;
                return { x: hole.cx + hole.radius * Math.cos(a), y: hole.cy + hole.radius * Math.sin(a) };
            });
            out.appendFilledPolygonFromCenter(hole.cx, hole.cy, pts, holeRgba);
        }
        faces.push({ fanStart, fanCount, holeStart, holeCount: out.vertexCount - holeStart });
    }
    return { data: out.toFloat32(), faces };
};

/** Fills parallel origin/rotation tables for the single-draw uniform path. */
export const fillPendoloTransformTables = (
    parts: PendoloCachedPart[],
    motion: PendoloMotionSample,
    origins: Float32Array,
    rotations: Float32Array,
) => {
    for (let i = 0; i < parts.length; i++) {
        const origin = parts[i].getOrigin(motion);
        origins[i * 2] = origin.x;
        origins[i * 2 + 1] = origin.y;
        rotations[i] = parts[i].getRotation(motion);
    }
};
