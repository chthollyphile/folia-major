import { EM_UNITS, type FontStrokesGlyph } from '../../../services/fontStrokes/fontStrokesOutline';
import { strokeUnitsToWorld, strokeWriteWeights, type StrokeWritePlace } from './strokeWriteCanvas';
import { polylineLength, resolveStrokeProgress } from './strokeWriteTiming';

// src/components/visualizer/fontStrokes/strokeWriteSvg.ts
// DOM 写字（SVG 遮罩，和 strokeWriteCanvas.ts 同一条规则）：每个正在写的字一个 <mask>，放在文档里共用的 0×0 defs <svg> 里，
// 字的 span 用 CSS mask: url(#id) 引用。遮罩里：写完的笔 = 这一笔的轮廓（填满 + 描 2 × 缝宽的边，盖住相邻笔共用边上的抗锯齿缝），
// 正在写的笔（同一时刻最多一笔）= 沿中线的圆头笔刷（pathLength=1，逐帧只改 stroke-dashoffset），套一个只有这一笔轮廓的内层 <mask>
// （clipPath 不认描边，缝宽那一圈外扩只能用 mask），没开写的笔不画。字形本身由 span 的文字画，遮罩只决定留下哪些墨。
// 坐标：遮罩用 userSpaceOnUse，原点是 span 的边框盒左上角（CSS px，不受祖先 transform 影响）；笔画数据（em × EM_UNITS）
// 经一层 <g transform> 换到这里（strokeUnitsToWorld，字心 / 字母基线 / 字号由 measureInlineGlyphPlace 量）。

const SVG_NS = 'http://www.w3.org/2000/svg';
/** 笔刷宽度的单位：1/256 em（同 fontStrokesOutline 的 BRUSH_UNITS）。 */
const BRUSH_PER_EM = 256;
/** 轮廓往外描多少设备像素（同 strokeWriteCanvas 的 SEAM_PX）。 */
const SEAM_PX = 1;
/** 遮罩区域四周多留的 CSS 像素。 */
const PAD_PX = 2;

/** 一个字画遮罩要的东西（字形记录第一次用时建，跟着记录走）：轮廓 / 中线的 SVG 字符串和分时权重，都是 em × EM_UNITS。 */
interface SvgGlyph {
    regions: (string | null)[];
    pens: (string | null)[];
    lengths: Float32Array;
    weights: Float32Array;
    brush: Float32Array;
    /** 所有轮廓的外框 [x0, y0, x1, y1]；没有轮廓时 null。 */
    box: [number, number, number, number] | null;
}
const svgGlyphs = new WeakMap<FontStrokesGlyph, SvgGlyph>();

/** 若干环（flat [x, y]）→ path d（每个环 M … Z，nonzero 填充）。 */
export const ringsToPathData = (rings: readonly ArrayLike<number>[]): string | null => {
    let d = '';
    for (const ring of rings) {
        if (ring.length < 6) continue;
        d += `M${ring[0]} ${ring[1]}`;
        for (let i = 2; i + 1 < ring.length; i += 2) d += `L${ring[i]} ${ring[i + 1]}`;
        d += 'Z';
    }
    return d || null;
};

/** 中线（flat [x, y]）→ polyline points。 */
export const penToPoints = (pen: ArrayLike<number>): string | null => {
    if (pen.length < 4) return null;
    let points = '';
    for (let i = 0; i + 1 < pen.length; i += 2) points += `${i ? ' ' : ''}${pen[i]},${pen[i + 1]}`;
    return points;
};

const prepareSvgGlyph = (glyph: FontStrokesGlyph): SvgGlyph => {
    const hit = svgGlyphs.get(glyph);
    if (hit) return hit;
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    for (const rings of glyph.outlines) for (const ring of rings) for (let i = 0; i + 1 < ring.length; i += 2) {
        if (ring[i] < b[0]) b[0] = ring[i];
        if (ring[i] > b[2]) b[2] = ring[i];
        if (ring[i + 1] < b[1]) b[1] = ring[i + 1];
        if (ring[i + 1] > b[3]) b[3] = ring[i + 1];
    }
    const entry: SvgGlyph = {
        regions: glyph.pens.map((_, k) => ringsToPathData(glyph.outlines[k] ?? [])),
        pens: glyph.pens.map(penToPoints),
        lengths: Float32Array.from(glyph.pens, pen => polylineLength(pen)),
        weights: strokeWriteWeights(glyph),
        brush: Float32Array.from(glyph.brush, w => (w * EM_UNITS) / BRUSH_PER_EM),
        box: b[2] >= b[0] ? [b[0], b[1], b[2], b[3]] : null,
    };
    svgGlyphs.set(glyph, entry);
    return entry;
};

/** 遮罩用的 userSpaceOnUse 区域（span 本地 CSS px）：轮廓外框 + 缝宽 + PAD_PX。纯函数，单测用。 */
export const strokeMaskRegion = (box: readonly [number, number, number, number], place: StrokeWritePlace, seamPx: number) => {
    const { k, tx, ty } = strokeUnitsToWorld(place);
    const grow = seamPx + PAD_PX;
    const x = tx + box[0] * k - grow, y = ty + box[1] * k - grow;
    return { x, y, width: (box[2] - box[0]) * k + 2 * grow, height: (box[3] - box[1]) * k + 2 * grow, k, tx, ty };
};

/** span 里一个字的排版量：字的前进宽、行高、主字体的字体盒上升 / 下降、字号（CSS px）。 */
export interface InlineGlyphMetrics {
    advance: number;
    lineHeight: number;
    ascent: number;
    descent: number;
    fontPx: number;
}

/**
 * inline-block span（只装这一个字，没有内边距）里字的写字位置，span 本地坐标：字心 = 前进宽一半；
 * 字母基线 = 半行距 + 上升（行高 = 上升 + 下降 + 上下各半个行距，同 CSS 行盒）。纯函数，单测用。
 */
export const placeInlineBlockGlyph = ({ advance, lineHeight, ascent, descent, fontPx }: InlineGlyphMetrics): StrokeWritePlace => ({
    cx: advance * 0.5,
    baseline: (lineHeight - (ascent + descent)) * 0.5 + ascent,
    fontPx,
});

let probeCtx: CanvasRenderingContext2D | null = null;
const baselineCache = new Map<string, number>();

/**
 * 量 inline-block span 里字母基线离 span 上沿多远（CSS px）：在文档里放一个不带 transform 的隐藏探针（同字体、同行高），
 * 量一个 0×0 inline-block 的位置（它的底边就是基线）。按字体 + 行高缓存，换字号 / 字体才再量一次。
 * 量不了（没有 body）时按 placeInlineBlockGlyph 的公式算。
 */
const measureBaseline = (doc: Document, font: string, lineHeight: string, fallback: number): number => {
    const key = `${font}|${lineHeight}`;
    const hit = baselineCache.get(key);
    if (hit !== undefined) return hit;
    if (!(doc.body as HTMLElement | null)) return fallback;
    const host = doc.createElement('span');
    host.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;white-space:pre;display:inline-block;padding:0;border:0;margin:0';
    host.style.font = font;
    host.style.lineHeight = lineHeight;
    host.textContent = '字';
    const marker = doc.createElement('span');
    marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    host.appendChild(marker);
    doc.body.appendChild(host);
    const baseline = marker.getBoundingClientRect().top - host.getBoundingClientRect().top;
    host.remove();
    const value = Number.isFinite(baseline) ? baseline : fallback;
    if (baselineCache.size > 64) baselineCache.clear();
    baselineCache.set(key, value);
    return value;
};

/**
 * 量一个 inline-block 字 span 的写字位置（span 本地 CSS px）：字号 / 字体 / 行高取计算样式，前进宽和字体盒用 canvas 量（同 strokeWriteCanvas），
 * 基线用探针量（measureBaseline）。只在字开写时调一次；不读 span 自己的几何（字常在缩放、旋转、弹簧动画里）。
 */
export const measureInlineGlyphPlace = (el: HTMLElement, grapheme: string): StrokeWritePlace | null => {
    const view = el.ownerDocument.defaultView;
    if (!view) return null;
    const cs = view.getComputedStyle(el);
    const fontPx = parseFloat(cs.fontSize);
    if (!(fontPx > 0)) return null;
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if (!probeCtx) probeCtx = el.ownerDocument.createElement('canvas').getContext('2d');
    if (!probeCtx) return null;
    probeCtx.font = font;
    probeCtx.textBaseline = 'alphabetic';
    const m = probeCtx.measureText(grapheme);
    const lineHeight = cs.lineHeight === 'normal' ? m.fontBoundingBoxAscent + m.fontBoundingBoxDescent : parseFloat(cs.lineHeight);
    const place = placeInlineBlockGlyph({ advance: m.width, lineHeight, ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent, fontPx });
    place.baseline = measureBaseline(el.ownerDocument, font, cs.lineHeight, place.baseline);
    return place;
};

const defsByDoc = new WeakMap<Document, SVGSVGElement>();
/** 文档里共用的 defs <svg>：0×0、绝对定位（不能 display:none，否则引用它的元素整个不画）。 */
const defsOf = (doc: Document): SVGSVGElement | null => {
    let defs = defsByDoc.get(doc);
    if (defs?.isConnected) return defs;
    if (!(doc.body as HTMLElement | null)) return null;
    defs = doc.createElementNS(SVG_NS, 'svg');
    defs.setAttribute('width', '0');
    defs.setAttribute('height', '0');
    defs.setAttribute('aria-hidden', 'true');
    defs.setAttribute('data-folia-stroke-write', '');
    defs.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none';
    doc.body.appendChild(defs);
    defsByDoc.set(doc, defs);
    return defs;
};

let maskSeq = 0;
const svgEl = <K extends keyof SVGElementTagNameMap>(doc: Document, tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
    const el = doc.createElementNS(SVG_NS, tag);
    for (const name in attrs) el.setAttribute(name, attrs[name]);
    return el;
};

/**
 * 一个正在写的字的遮罩。建的时候把所有节点建好（开写那一帧），之后 update(progress) 只改显示 / 隐藏、
 * 换笔时改内层遮罩的轮廓和笔刷的点，以及正在写那一笔的 stroke-dashoffset。dispose() 删掉自己的节点。
 */
export class StrokeWriteSvgChar {
    /** CSS mask 的值：url(#id)。 */
    readonly url: string;
    private readonly glyph: SvgGlyph;
    private readonly nodes: Element[];
    private readonly fulls: (SVGPathElement | null)[];
    private readonly fullShown: Uint8Array;
    private readonly regionPath: SVGPathElement;
    private readonly brush: SVGPolylineElement;
    private readonly progress: Float32Array;
    private current = -1;

    private constructor(doc: Document, defs: SVGSVGElement, glyph: SvgGlyph, box: [number, number, number, number], place: StrokeWritePlace, seamPx: number) {
        const id = `folia-stroke-write-${(maskSeq += 1)}`;
        this.url = `url(#${id})`;
        this.glyph = glyph;
        const n = glyph.weights.length;
        this.progress = new Float32Array(n);
        this.fullShown = new Uint8Array(n);
        const region = strokeMaskRegion(box, place, seamPx);
        const seam = seamPx / region.k;
        const mask = svgEl(doc, 'mask', {
            id,
            maskUnits: 'userSpaceOnUse',
            maskContentUnits: 'userSpaceOnUse',
            x: `${region.x}`,
            y: `${region.y}`,
            width: `${region.width}`,
            height: `${region.height}`,
        });
        const g = svgEl(doc, 'g', {
            transform: `matrix(${region.k} 0 0 ${region.k} ${region.tx} ${region.ty})`,
            fill: '#fff',
            stroke: '#fff',
            'stroke-linejoin': 'round',
            'stroke-linecap': 'round',
        });
        this.fulls = glyph.regions.map((d, s) => {
            if (!d || !(glyph.weights[s] > 0)) return null;
            const path = svgEl(doc, 'path', { d, 'stroke-width': `${2 * seam}`, display: 'none' });
            g.appendChild(path);
            return path;
        });
        // 正在写的那一笔：内层遮罩只有这一笔的轮廓（em 坐标：内层遮罩用引用它的笔刷所在的坐标系）
        const pad = (PAD_PX + seamPx) / region.k;
        const regionMask = svgEl(doc, 'mask', {
            id: `${id}-r`,
            maskUnits: 'userSpaceOnUse',
            maskContentUnits: 'userSpaceOnUse',
            x: `${box[0] - pad}`,
            y: `${box[1] - pad}`,
            width: `${box[2] - box[0] + 2 * pad}`,
            height: `${box[3] - box[1] + 2 * pad}`,
        });
        this.regionPath = svgEl(doc, 'path', { fill: '#fff', stroke: '#fff', 'stroke-width': `${2 * seam}`, 'stroke-linejoin': 'round' });
        regionMask.appendChild(this.regionPath);
        this.brush = svgEl(doc, 'polyline', {
            fill: 'none',
            pathLength: '1',
            // 一段笔画长 1、空 2：dashoffset = 1 − 进度时只露出 [0, 进度]，路径末端不会冒出下一段的圆头
            'stroke-dasharray': '1 2',
            'stroke-dashoffset': '1',
            mask: `url(#${id}-r)`,
            display: 'none',
        });
        g.appendChild(this.brush);
        mask.appendChild(g);
        defs.appendChild(regionMask);
        defs.appendChild(mask);
        this.nodes = [regionMask, mask];
    }

    /** 建一个字的遮罩；没有轮廓、位置不合法或文档里放不下 defs 时 null（调用方按普通画法）。seamPx 默认 1 个设备像素。 */
    static create(doc: Document, glyph: FontStrokesGlyph, place: StrokeWritePlace, seamPx?: number): StrokeWriteSvgChar | null {
        const g = prepareSvgGlyph(glyph);
        if (!g.box || !(place.fontPx > 0) || !Number.isFinite(place.cx + place.baseline)) return null;
        const defs = defsOf(doc);
        if (!defs) return null;
        const seam = seamPx ?? SEAM_PX / Math.max(1, doc.defaultView?.devicePixelRatio || 1);
        return new StrokeWriteSvgChar(doc, defs, g, g.box, place, seam);
    }

    /**
     * 按整字进度（0..1，已缓出）更新遮罩。规则同 drawStrokeWriteGlyph：正在写的笔 = 笔刷 ∩ 这一笔的轮廓，写完的笔整块，
     * 没有中线的笔一开写就整块。返回是不是所有笔都写完了。
     */
    update(progress: number): boolean {
        const g = this.glyph;
        const p = resolveStrokeProgress(g.weights, progress, this.progress);
        let current = -1;
        for (let s = 0; s < p.length; s += 1) {
            if (p[s] > 0 && p[s] < 1 && g.regions[s] && g.weights[s] > 0 && g.pens[s] && g.lengths[s] > 0) { current = s; break; }
        }
        let done = true;
        for (let s = 0; s < p.length; s += 1) {
            const full = this.fulls[s];
            if (!full) continue;
            if (p[s] < 1) done = false;
            const show = s !== current && p[s] > 0 && !(p[s] < 1 && g.pens[s] && g.lengths[s] > 0) ? 1 : 0;
            if (show !== this.fullShown[s]) {
                this.fullShown[s] = show;
                full.setAttribute('display', show ? 'inline' : 'none');
            }
        }
        if (current !== this.current) {
            if (current >= 0) {
                this.regionPath.setAttribute('d', g.regions[current] as string);
                this.brush.setAttribute('points', g.pens[current] as string);
                this.brush.setAttribute('stroke-width', `${g.brush[current]}`);
            }
            this.brush.setAttribute('display', current >= 0 ? 'inline' : 'none');
            this.current = current;
        }
        if (current >= 0) this.brush.setAttribute('stroke-dashoffset', `${1 - p[current]}`);
        return done;
    }

    dispose(): void {
        for (const node of this.nodes) node.remove();
    }
}
