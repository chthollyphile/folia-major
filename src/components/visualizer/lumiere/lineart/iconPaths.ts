// Copyright (c) 2026 chthollyphile
import type { IconNode } from 'lucide-react';
import { resolveLucideIconNode } from '../../../../services/lucideIconResolver';
import type { Point } from './lineArt';

// src/components/visualizer/lumiere/lineart/iconPaths.ts
// Lucide 图标 → 折线：取图标的 SVG 节点（path / circle / ellipse / line / rect / polyline / polygon），
// 弧与贝塞尔按角度 / 分段展平成折线，坐标留在图标自己的 24×24 viewBox 里，交给描线引擎再缩放摆放。
// 每个图标名只展平一次（模块级缓存），场景构建时直接取。

/** lucide 的 viewBox 边长。 */
export const ICON_VIEWBOX = 24;

export interface IconPolyline {
    points: Point[];
    closed: boolean;
}

/** 曲线展平的精度：整圆 48 段，贝塞尔每段 12 段。 */
const CIRCLE_STEPS = 48;
const CURVE_STEPS = 12;

const num = (value: unknown, fallback = 0) => {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : fallback;
};

const ellipsePoints = (cx: number, cy: number, rx: number, ry: number, steps = CIRCLE_STEPS): Point[] => (
    Array.from({ length: steps + 1 }, (_, i) => {
        const a = (i / steps) * Math.PI * 2;
        return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Point;
    })
);

/** 圆角矩形：四条边 + 四个四分之一圆弧，顺时针闭合。 */
const rectPoints = (x: number, y: number, w: number, h: number, rxIn: number, ryIn: number): Point[] => {
    const rx = Math.min(Math.max(0, rxIn), w / 2);
    const ry = Math.min(Math.max(0, ryIn), h / 2);
    if (rx <= 0 || ry <= 0) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
    const corner = (cx: number, cy: number, from: number): Point[] => Array.from({ length: 7 }, (_, i) => {
        const a = from + (i / 6) * (Math.PI / 2);
        return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Point;
    });
    const points = [
        ...corner(x + w - rx, y + ry, -Math.PI / 2),
        ...corner(x + w - rx, y + h - ry, 0),
        ...corner(x + rx, y + h - ry, Math.PI / 2),
        ...corner(x + rx, y + ry, Math.PI),
    ];
    points.push(points[0]!);
    return points;
};

const pointList = (value: unknown): Point[] => {
    const numbers = String(value ?? '').trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
    const points: Point[] = [];
    for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i]!, numbers[i + 1]!]);
    return points;
};

/** SVG 椭圆弧（端点参数化）→ 折线（不含起点）。按 SVG 规范换成圆心参数化，半径不够时等比放大。 */
const arcToPoints = (
    from: Point, rxIn: number, ryIn: number, angleDeg: number, largeArc: boolean, sweep: boolean, to: Point,
): Point[] => {
    let rx = Math.abs(rxIn);
    let ry = Math.abs(ryIn);
    if (rx === 0 || ry === 0 || (from[0] === to[0] && from[1] === to[1])) return [to];
    const phi = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (from[0] - to[0]) / 2;
    const dy = (from[1] - to[1]) / 2;
    const x1 = cos * dx + sin * dy;
    const y1 = -sin * dx + cos * dy;
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) {
        rx *= Math.sqrt(lambda);
        ry *= Math.sqrt(lambda);
    }
    const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const factor = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, numerator / Math.max(denominator, 1e-12)));
    const cx1 = (factor * rx * y1) / ry;
    const cy1 = (-factor * ry * x1) / rx;
    const cx = cos * cx1 - sin * cy1 + (from[0] + to[0]) / 2;
    const cy = sin * cx1 + cos * cy1 + (from[1] + to[1]) / 2;
    const angleOf = (ux: number, uy: number) => Math.atan2(uy, ux);
    const start = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry);
    let delta = angleOf((-x1 - cx1) / rx, (-y1 - cy1) / ry) - start;
    if (sweep && delta < 0) delta += Math.PI * 2;
    if (!sweep && delta > 0) delta -= Math.PI * 2;
    const steps = Math.max(2, Math.ceil((Math.abs(delta) / (Math.PI * 2)) * CIRCLE_STEPS));
    const points: Point[] = [];
    for (let i = 1; i <= steps; i += 1) {
        const a = start + (delta * i) / steps;
        const ex = Math.cos(a) * rx;
        const ey = Math.sin(a) * ry;
        points.push(i === steps ? to : [cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
    }
    return points;
};

const cubicTo = (p0: Point, p1: Point, p2: Point, p3: Point): Point[] => Array.from({ length: CURVE_STEPS }, (_, k) => {
    const t = (k + 1) / CURVE_STEPS;
    const u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]] as Point;
});

const quadTo = (p0: Point, p1: Point, p2: Point): Point[] => Array.from({ length: CURVE_STEPS }, (_, k) => {
    const t = (k + 1) / CURVE_STEPS;
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]] as Point;
});

/**
 * SVG path 的 d → 折线（每个子路径一条）。支持全部命令（M L H V C S Q T A Z，大小写）；
 * 弧的两个标志位可以不带分隔符紧挨着写（lucide 的压缩写法「a4.5 4.5 0 1 1 7.5 12」「a2 2 0 012 2」）。
 */
export const svgPathToPolylines = (d: string): IconPolyline[] => {
    const result: IconPolyline[] = [];
    let index = 0;
    const skip = () => {
        while (index < d.length && /[\s,]/.test(d[index]!)) index += 1;
    };
    const readNumber = (): number | null => {
        skip();
        const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(d.slice(index));
        if (!match) return null;
        index += match[0].length;
        return Number(match[0]);
    };
    const readFlag = (): boolean | null => {
        skip();
        const char = d[index];
        if (char !== '0' && char !== '1') return null;
        index += 1;
        return char === '1';
    };
    const hasNumber = () => {
        skip();
        return index < d.length && /[+\-.\d]/.test(d[index]!);
    };

    let current: Point = [0, 0];
    let start: Point = [0, 0];
    let points: Point[] = [];
    let lastControl: Point | null = null;
    let lastKind = '';
    const flush = (closed: boolean) => {
        if (points.length > 1) result.push({ points, closed });
        points = [];
    };

    while (index < d.length) {
        skip();
        if (index >= d.length) break;
        const command = d[index]!;
        if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(command)) break;
        index += 1;
        const relative = command === command.toLowerCase();
        const kind = command.toUpperCase();
        const abs = (x: number, y: number): Point => (relative ? [current[0] + x, current[1] + y] : [x, y]);
        if (kind === 'Z') {
            if (points.length > 0) {
                points.push(start);
                flush(true);
            }
            current = start;
            lastControl = null;
            lastKind = kind;
            continue;
        }
        let first = true;
        do {
            if (kind === 'M') {
                const x = readNumber(); const y = readNumber();
                if (x === null || y === null) break;
                const target = abs(x, y);
                // M 后面的坐标对按 L 处理。
                if (first) {
                    flush(false);
                    start = target;
                    points = [target];
                } else {
                    points.push(target);
                }
                current = target;
                lastControl = null;
            } else if (kind === 'L') {
                const x = readNumber(); const y = readNumber();
                if (x === null || y === null) break;
                current = abs(x, y);
                points.push(current);
                lastControl = null;
            } else if (kind === 'H') {
                const x = readNumber();
                if (x === null) break;
                current = [relative ? current[0] + x : x, current[1]];
                points.push(current);
                lastControl = null;
            } else if (kind === 'V') {
                const y = readNumber();
                if (y === null) break;
                current = [current[0], relative ? current[1] + y : y];
                points.push(current);
                lastControl = null;
            } else if (kind === 'C' || kind === 'S') {
                let c1: Point;
                if (kind === 'C') {
                    const x1 = readNumber(); const y1 = readNumber();
                    if (x1 === null || y1 === null) break;
                    c1 = abs(x1, y1);
                } else {
                    c1 = lastControl && (lastKind === 'C' || lastKind === 'S')
                        ? [current[0] * 2 - lastControl[0], current[1] * 2 - lastControl[1]]
                        : current;
                }
                const x2 = readNumber(); const y2 = readNumber(); const x = readNumber(); const y = readNumber();
                if (x2 === null || y2 === null || x === null || y === null) break;
                const c2 = abs(x2, y2);
                const end = abs(x, y);
                if (points.length === 0) points = [current];
                points.push(...cubicTo(current, c1, c2, end));
                current = end;
                lastControl = c2;
            } else if (kind === 'Q' || kind === 'T') {
                let c: Point;
                if (kind === 'Q') {
                    const x1 = readNumber(); const y1 = readNumber();
                    if (x1 === null || y1 === null) break;
                    c = abs(x1, y1);
                } else {
                    c = lastControl && (lastKind === 'Q' || lastKind === 'T')
                        ? [current[0] * 2 - lastControl[0], current[1] * 2 - lastControl[1]]
                        : current;
                }
                const x = readNumber(); const y = readNumber();
                if (x === null || y === null) break;
                const end = abs(x, y);
                if (points.length === 0) points = [current];
                points.push(...quadTo(current, c, end));
                current = end;
                lastControl = c;
            } else if (kind === 'A') {
                const rx = readNumber(); const ry = readNumber(); const angle = readNumber();
                const large = readFlag(); const sweep = readFlag();
                const x = readNumber(); const y = readNumber();
                if (rx === null || ry === null || angle === null || large === null || sweep === null || x === null || y === null) break;
                const end = abs(x, y);
                if (points.length === 0) points = [current];
                points.push(...arcToPoints(current, rx, ry, angle, large, sweep, end));
                current = end;
                lastControl = null;
            }
            // 同一命令后面可以连着多组参数。
            lastKind = kind;
            first = false;
        } while (hasNumber());
    }
    flush(false);
    return result;
};

/** 一个 lucide 节点 → 折线。未知元素忽略。 */
const nodeToPolylines = (tag: string, attrs: Record<string, unknown>): IconPolyline[] => {
    switch (tag) {
        case 'path':
            return svgPathToPolylines(String(attrs.d ?? ''));
        case 'circle': {
            const r = num(attrs.r);
            return r > 0 ? [{ points: ellipsePoints(num(attrs.cx), num(attrs.cy), r, r), closed: true }] : [];
        }
        case 'ellipse': {
            const rx = num(attrs.rx);
            const ry = num(attrs.ry);
            return rx > 0 && ry > 0 ? [{ points: ellipsePoints(num(attrs.cx), num(attrs.cy), rx, ry), closed: true }] : [];
        }
        case 'line':
            return [{ points: [[num(attrs.x1), num(attrs.y1)], [num(attrs.x2), num(attrs.y2)]], closed: false }];
        case 'rect': {
            const w = num(attrs.width);
            const h = num(attrs.height);
            if (w <= 0 || h <= 0) return [];
            // SVG：只给 rx 或 ry 之一时另一个取同值。
            const rx = attrs.rx !== undefined ? num(attrs.rx) : num(attrs.ry);
            const ry = attrs.ry !== undefined ? num(attrs.ry) : rx;
            return [{ points: rectPoints(num(attrs.x), num(attrs.y), w, h, rx, ry), closed: true }];
        }
        case 'polyline':
        case 'polygon': {
            const points = pointList(attrs.points);
            if (tag === 'polygon' && points.length > 2) points.push(points[0]!);
            return points.length > 1 ? [{ points, closed: tag === 'polygon' }] : [];
        }
        default:
            return [];
    }
};

/** 图标节点（lucide 的 IconNode：[tag, attrs, children?][]）→ 折线，坐标在 24×24 viewBox 里；带子节点的（g）递归展开。 */
export const iconNodeToPolylines = (node: IconNode): IconPolyline[] => (
    node.flatMap(entry => {
        const [tag, attrs, children] = entry as unknown as [string, Record<string, unknown>, unknown?];
        return [
            ...nodeToPolylines(tag, attrs),
            ...(Array.isArray(children) ? iconNodeToPolylines(children as IconNode) : []),
        ];
    })
);

const cache = new Map<string, IconPolyline[] | null>();

/**
 * 按图标名（lucide 的 PascalCase 导出名）取折线；未知图标返回 null。结果按名字缓存。
 * 图标按需加载（loadLucideIcons）：取不到节点的（未知名字、还没加载完、加载失败）返回 null 但不进缓存，
 * 加载完再取就有了。
 */
export const lucideIconPolylines = (name: string): IconPolyline[] | null => {
    if (cache.has(name)) return cache.get(name)!;
    const node = resolveLucideIconNode(name);
    if (!node) return null;
    const polylines = iconNodeToPolylines(node).filter(polyline => polyline.points.length > 1);
    const value = polylines.length > 0 ? polylines : null;
    cache.set(name, value);
    return value;
};
