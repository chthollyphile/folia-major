// Copyright (c) 2026 chthollyphile
import type { Container, Graphics, GraphicsContext, Sprite } from 'pixi.js';
import { createRng } from '../hanabiRandom';
import type { GlyphAnchor, HanabiTextures, OrnamentContext, OrnamentSpec } from '../types';
import { clamp01 } from './mgMath';

// src/components/visualizer/hanabi/mg/ornamentKit.ts
// 装饰件的公共底座：按 placement 算出「落点」（静态点或跟着某个字走）、取色、数量、入场 / 退场进度、精灵与图形的创建与回收。
// 每种装饰件只写自己的形状与动态（ornamentShapes / ornamentParticles / ornamentLines）。

/** 装饰件的一个落点：中心、半宽半高、朝外的方向；glyph ≥ 0 时每帧跟着那个字走。 */
export interface Site {
    x: number;
    y: number;
    w: number;
    h: number;
    angle: number;
    glyph: number;
    /** 这个落点的入场时刻（跟字的落点 = 字被唱到）。 */
    start: number;
    /** around：散布时避开字组本身。 */
    hollow: boolean;
}

/** 静止排好时的一个（非空白）字。 */
export interface GlyphInfo {
    index: number;
    char: string;
    x: number;
    y: number;
    size: number;
    sungAt: number;
    sungEnd: number;
    landedAt: number;
}

export interface SitePos {
    x: number;
    y: number;
    /** 跟着的字的可见度（静态点为 1）。 */
    alpha: number;
    size: number;
}

export type TextureName = Exclude<keyof HanabiTextures, 'destroy'>;

export interface Kit {
    spec: OrnamentSpec;
    ctx: OrnamentContext;
    pixi: OrnamentContext['pixi'];
    view: Container;
    rng: () => number;
    /** 入场开始（enterAt + delay）与完全退场的时刻。 */
    start: number;
    end: number;
    /** 参考尺寸：静止时字号的中位数（已乘 spec.scale）。 */
    size: number;
    glyphs: GlyphInfo[];
    vertical: boolean;
    /** 字组包围盒的中心与半宽半高。 */
    cx: number;
    cy: number;
    hw: number;
    hh: number;
    /** base × 密度 × 数量倍率（至少 min，倍率为 0 时为 0）。 */
    count: (base: number, min?: number) => number;
    color: (i: number) => number;
    sites: (mode: 'single' | 'scatter', maxGlyphSites: number) => Site[];
    anchors: (time: number) => readonly GlyphAnchor[];
    pos: (site: Site, anchors: readonly GlyphAnchor[], out: SitePos) => SitePos;
    /** 退场进度 0..1（stagger 秒让不同件错开）。 */
    exit: (time: number, stagger?: number) => number;
    /** 散布点（相对落点中心的偏移）。 */
    scatter: (site: Site) => [number, number];
    /** 最近一个在 time 之前被唱到的字的时刻（没有则 −∞）。 */
    lastSung: (time: number) => number;
    sprite: (texture: TextureName, parent?: Container) => Sprite;
    graphics: (parent?: Container, context?: GraphicsContext) => Graphics;
    context: () => GraphicsContext;
}

export const createKit = (spec: OrnamentSpec, ctx: OrnamentContext): Kit => {
    const { pixi } = ctx;
    // 一个装饰件一个渲染组：波浪线、锯齿线每帧 clear 再重画，粒子类的逐个显隐，Pixi 都会把所在渲染组的绘制指令
    // 整组重排；单独成组后只重排这一件。
    const view = new pixi.Container({ isRenderGroup: true });
    const rng = createRng(`${ctx.seed}:ornament:${spec.kind}:${spec.placement}`);
    const start = ctx.enterAt + spec.delay;
    const end = ctx.exitAt + Math.max(0, ctx.exitDuration);
    const b = ctx.bounds;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const hw = Math.max(1, b.width / 2);
    const hh = Math.max(1, b.height / 2);

    // 静止排好的字：先取入场时的 landedAt，再在全部落定之后（退场之前）取一次位置。
    const initial = ctx.anchorsAt(ctx.enterAt);
    const landed = initial.reduce((max, anchor) => Math.max(max, anchor.landedAt), ctx.enterAt);
    const settle = Math.min(ctx.exitAt - 1e-3, landed + 0.05);
    const settled = settle > ctx.enterAt ? ctx.anchorsAt(settle) : initial;
    const glyphs: GlyphInfo[] = [];
    settled.forEach((anchor, index) => {
        if (anchor.blank) return;
        glyphs.push({
            index,
            char: anchor.char,
            x: anchor.x,
            y: anchor.y,
            size: anchor.size,
            sungAt: anchor.sungAt,
            sungEnd: anchor.sungEnd,
            landedAt: anchor.landedAt,
        });
    });
    const sizes = glyphs.map(g => g.size).sort((p, q) => p - q);
    const base = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)]! : Math.max(12, Math.min(hw, hh) * 0.8, Math.min(ctx.width, ctx.height) * 0.06);
    const size = base * Math.max(0.1, spec.scale);
    let vertical = false;
    if (glyphs.length > 1) {
        const xs = glyphs.map(g => g.x);
        const ys = glyphs.map(g => g.y);
        vertical = Math.max(...ys) - Math.min(...ys) > (Math.max(...xs) - Math.min(...xs)) * 1.3;
    }
    const sung = glyphs.map(g => g.sungAt).sort((p, q) => p - q);

    const factor = Math.max(0, ctx.amount) * (0.35 + 0.9 * clamp01(spec.density));
    const count = (baseCount: number, min = 1) => (factor <= 0 ? 0 : Math.max(min, Math.round(baseCount * factor)));

    const pick = (list: readonly number[], i: number, fallback: number) => (list.length > 0 ? list[((i % list.length) + list.length) % list.length]! : fallback);
    const color = (i: number) => {
        const p = ctx.palette;
        switch (spec.color) {
            case 'spark': return pick(p.sparks, i, p.accent);
            case 'block': return pick(p.blocks, i, p.accent);
            case 'paper': return p.paper;
            case 'glow': return p.glow;
            default: return p.accent;
        }
    };

    const pad = base * 0.35;
    const sites = (mode: 'single' | 'scatter', maxGlyphSites: number): Site[] => {
        const make = (x: number, y: number, w: number, h: number, angle: number, extra: Partial<Site> = {}): Site => ({
            x, y, w, h, angle, glyph: -1, start, hollow: false, ...extra,
        });
        switch (spec.placement) {
            case 'behind':
                return [make(cx, cy, hw, hh, -Math.PI / 2)];
            case 'around':
                return [make(cx, cy, hw + pad, hh + pad, -Math.PI / 2, { hollow: mode === 'scatter' })];
            case 'corners':
                return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy], k) => make(
                    cx + sx! * (hw + pad * 0.6), cy + sy! * (hh + pad * 0.6), base * 0.6, base * 0.6, Math.atan2(sy!, sx!),
                    { start: start + k * 0.07 },
                ));
            case 'line-start':
                return [vertical
                    ? make(cx, cy - hh - pad, base * 0.7, base * 0.7, -Math.PI / 2)
                    : make(cx - hw - pad, cy, base * 0.7, base * 0.7, Math.PI)];
            case 'line-end':
                return [vertical
                    ? make(cx, cy + hh + pad, base * 0.7, base * 0.7, Math.PI / 2)
                    : make(cx + hw + pad, cy, base * 0.7, base * 0.7, 0)];
            case 'screen':
                return [make(0, 0, ctx.width * 0.55, ctx.height * 0.55, -Math.PI / 2)];
            case 'glyphs':
            default: {
                if (glyphs.length === 0) return [make(cx, cy, hw, hh, -Math.PI / 2)];
                const limit = Math.max(1, Math.min(glyphs.length, maxGlyphSites));
                const chosen: GlyphInfo[] = [];
                for (let i = 0; i < limit; i += 1) chosen.push(glyphs[Math.floor(((i + 0.5) * glyphs.length) / limit)]!);
                return chosen.map(g => make(g.x, g.y, g.size * 0.55, g.size * 0.55, -Math.PI / 2, {
                    glyph: g.index,
                    start: Math.max(start, g.sungAt),
                }));
            }
        }
    };

    let cachedTime = Number.NaN;
    let cached: readonly GlyphAnchor[] = settled;
    const anchors = (time: number) => {
        if (time !== cachedTime) {
            cachedTime = time;
            cached = ctx.anchorsAt(time);
        }
        return cached;
    };

    const pos = (site: Site, list: readonly GlyphAnchor[], out: SitePos) => {
        const anchor = site.glyph >= 0 ? list[site.glyph] : undefined;
        if (anchor) {
            out.x = anchor.x;
            out.y = anchor.y;
            out.alpha = anchor.alpha;
            out.size = anchor.size;
        } else {
            out.x = site.x;
            out.y = site.y;
            out.alpha = 1;
            out.size = Math.max(site.w, site.h);
        }
        return out;
    };

    const exitSpan = Math.max(0.05, ctx.exitDuration);
    const exit = (time: number, stagger = 0) => clamp01((time - ctx.exitAt - stagger) / Math.max(0.05, exitSpan - stagger));

    const scatter = (site: Site): [number, number] => {
        if (!site.hollow) return [(rng() * 2 - 1) * site.w, (rng() * 2 - 1) * site.h];
        // 围绕：落在包围盒外的一圈里。
        const ow = site.w + base * 1.3;
        const oh = site.h + base * 1.0;
        for (let tries = 0; tries < 12; tries += 1) {
            const x = (rng() * 2 - 1) * ow;
            const y = (rng() * 2 - 1) * oh;
            if (Math.abs(x) > site.w || Math.abs(y) > site.h) return [x, y];
        }
        const a = rng() * Math.PI * 2;
        return [Math.cos(a) * ow, Math.sin(a) * oh];
    };

    const lastSung = (time: number) => {
        let result = Number.NEGATIVE_INFINITY;
        for (const at of sung) {
            if (at > time) break;
            result = at;
        }
        return result;
    };

    const sprite = (texture: TextureName, parent: Container = view) => {
        const s = new pixi.Sprite(ctx.textures[texture]);
        s.anchor.set(0.5);
        parent.addChild(s);
        return s;
    };
    const graphics = (parent: Container = view, context?: GraphicsContext) => {
        const g = context ? new pixi.Graphics(context) : new pixi.Graphics();
        parent.addChild(g);
        return g;
    };
    const contexts: GraphicsContext[] = [];
    const context = () => {
        const c = new pixi.GraphicsContext();
        contexts.push(c);
        return c;
    };
    view.on('destroyed', () => contexts.forEach(c => c.destroy()));

    return {
        spec, ctx, pixi, view, rng, start, end, size, glyphs, vertical, cx, cy, hw, hh,
        count, color, sites, anchors, pos, exit, scatter, lastSung, sprite, graphics, context,
    };
};

/** 所有装饰件的更新函数：time → 画面。 */
export type OrnamentUpdate = (time: number) => void;
export type OrnamentBuilder = (kit: Kit) => OrnamentUpdate;
