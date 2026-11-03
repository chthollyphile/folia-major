// Copyright (c) 2026 chthollyphile
import type { Graphics, Sprite } from 'pixi.js';
import type { GlyphInfo, Kit, OrnamentBuilder, Site, SitePos } from './ornamentKit';
import { beatSteps, clamp01, easeInCubic, easeOutBack, easeOutCubic, fract, hash01, lerp, spring, TAU, wrap } from './mgMath';

// src/components/visualizer/hanabi/mg/ornamentParticles.ts
// 粒子类装饰件：四角星闪、＋号、彩纸、三角碎片、樱花瓣、速度线、>>> 箭头、字边光点。
// 全部是共享纹理的 Sprite（箭头、＋号用共享的 GraphicsContext），位置由 (种子, t) 的闭式式子给出。

const newPos = (): SitePos => ({ x: 0, y: 0, alpha: 1, size: 0 });

/** 字被唱到的触发时刻列表；没有字（间奏）时按入场到退场均匀排。 */
const triggers = (kit: Kit, count: number): Array<{ at: number; glyph: GlyphInfo | null }> => {
    if (kit.glyphs.length > 0) {
        const limit = Math.max(1, Math.min(kit.glyphs.length, count));
        return Array.from({ length: limit }, (_, i) => {
            const g = kit.glyphs[Math.floor(((i + 0.5) * kit.glyphs.length) / limit)]!;
            return { at: Math.max(kit.start, g.sungAt), glyph: g };
        });
    }
    const span = Math.max(0.5, kit.ctx.exitAt - kit.start);
    return Array.from({ length: count }, (_, i) => ({ at: kit.start + (span * i) / count, glyph: null }));
};

// ─── sparkle：四角星，贴着被唱到的字闪 ─────────────────────────────────
export const sparkleOrnament: OrnamentBuilder = kit => {
    const onGlyph = kit.spec.placement === 'glyphs';
    const sites = kit.sites('scatter', 1);
    const items = triggers(kit, kit.count(14, 3)).map((trigger, i) => {
        const main = kit.sprite('star4');
        const satA = kit.sprite('star4');
        const satB = kit.sprite('dot');
        [main, satA, satB].forEach((s, k) => { s.tint = kit.color(i + k); });
        const side = kit.rng() < 0.5 ? -1 : 1;
        const site = sites[i % sites.length]!;
        const [sx, sy] = kit.scatter(site);
        return {
            main, satA, satB, trigger, site, side,
            ox: onGlyph ? side * 0.48 : sx,
            oy: onGlyph ? -0.45 - kit.rng() * 0.1 : sy,
            size: kit.size * (0.55 + kit.rng() * 0.35),
            spin: (kit.rng() - 0.5) * 1.2,
        };
    });
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        items.forEach((it, i) => {
            const local = time - it.trigger.at;
            const x = kit.exit(time, (i % 6) * 0.03);
            if (local < 0 || x >= 1) {
                it.main.visible = false;
                it.satA.visible = false;
                it.satB.visible = false;
                return;
            }
            let cx: number;
            let cy: number;
            let alpha = 1;
            if (onGlyph && it.trigger.glyph) {
                const anchor = anchors[it.trigger.glyph.index];
                const size = anchor?.size ?? it.trigger.glyph.size;
                cx = (anchor?.x ?? it.trigger.glyph.x) + it.ox * size;
                cy = (anchor?.y ?? it.trigger.glyph.y) + it.oy * size;
                alpha = anchor?.alpha ?? 1;
            } else {
                kit.pos(it.site, anchors, p);
                cx = p.x + it.ox;
                cy = p.y + it.oy;
            }
            // 弹出 → 0.7 秒后缩成一颗小星，余下时间慢慢闪。
            const pop = spring(local, 3.2, 8);
            const settle = clamp01((local - 0.45) / 0.35);
            const idle = 0.32 + 0.1 * Math.sin(time * 5 + i * 1.7);
            const scale = lerp(1.25 * pop, idle, easeOutCubic(settle)) * (1 - easeInCubic(x));
            const s = it.size * Math.max(0, scale);
            it.main.visible = s > 0.5;
            it.main.position.set(cx, cy);
            it.main.width = s;
            it.main.height = s;
            it.main.rotation = -Math.PI / 4 * (1 - easeOutCubic(local / 0.3)) + it.spin * local + x * 3;
            it.main.alpha = alpha * (1 - x);
            const sat = (sprite: Sprite, delay: number, dx: number, dy: number, sizeK: number) => {
                const l = local - delay;
                const k = clamp01(l / 0.5);
                sprite.visible = l >= 0 && k < 1;
                if (!sprite.visible) return;
                const ss = it.size * sizeK * Math.sin(Math.PI * k);
                sprite.position.set(cx + dx * it.size, cy + dy * it.size);
                sprite.width = ss;
                sprite.height = ss;
                sprite.alpha = alpha;
            };
            sat(it.satA, 0.08, it.side * 0.55, 0.35, 0.45);
            sat(it.satB, 0.15, -it.side * 0.4, -0.5, 0.16);
        });
    };
};

// ─── cross：＋号散布，一拍转 90° ────────────────────────────────────────
export const crossOrnament: OrnamentBuilder = kit => {
    const shape = kit.context();
    shape.rect(-5, -1.4, 10, 2.8).rect(-1.4, -5, 2.8, 10).fill({ color: 0xffffff });
    const oneShot = kit.spec.placement === 'glyphs';
    const sites = kit.sites('scatter', 8);
    const n = oneShot ? sites.length * 2 : kit.count(12, 4);
    const items = Array.from({ length: n }, (_, i) => {
        const site = sites[i % sites.length]!;
        const [ox, oy] = oneShot
            ? [(kit.rng() - 0.5) * site.w * 3, -site.h * (0.9 + kit.rng() * 0.6)]
            : kit.scatter(site);
        const g = kit.graphics(kit.view, shape);
        g.tint = kit.color(i);
        return {
            g, site, ox, oy,
            size: kit.size * (0.18 + kit.rng() * 0.22) / 10,
            delay: oneShot ? (i >= sites.length ? 0.08 : 0) : i * 0.06,
            offset: kit.rng(),
            rise: kit.size * (0.1 + kit.rng() * 0.2),
        };
    });
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        items.forEach((it, i) => {
            const local = time - it.site.start - it.delay;
            const x = kit.exit(time, (i % 8) * 0.03);
            if (local < 0 || x >= 1 || (oneShot && local > 1.4)) {
                it.g.visible = false;
                return;
            }
            kit.pos(it.site, anchors, p);
            let scale = easeOutBack(local / 0.3, 3) * (1 - easeInCubic(x));
            let alpha = p.alpha * (1 - x);
            if (oneShot) {
                const k = clamp01((local - 0.6) / 0.8);
                scale *= 1 - k;
                alpha *= 1 - k;
            }
            it.g.visible = scale > 0.01;
            it.g.position.set(p.x + it.ox, p.y + it.oy - it.rise * Math.sin(time * 0.8 + it.offset * TAU));
            it.g.scale.set(Math.max(0.001, it.size * scale));
            it.g.rotation = beatSteps(local / 1.2 + it.offset) * (Math.PI / 2) + x * 4;
            it.g.alpha = alpha;
        });
    };
};

/** 彩纸 / 花瓣共用的循环下落：piece 在落点区域的上缘出现、下缘消失，横向摇摆、3D 翻转。 */
interface Faller {
    sprite: Sprite;
    site: Site;
    x0: number;
    period: number;
    offset: number;
    sway: number;
    swayFreq: number;
    flip: number;
    spin: number;
    size: number;
    aspect: number;
    delay: number;
    /** 入场时从中心炸开的初速度（px/s）。 */
    vx: number;
    vy: number;
}

const fallerLayout = (kit: Kit, site: Site) => {
    const top = -site.h - kit.size * 2;
    const bottom = site.h + kit.size * 1.5;
    return { top, bottom };
};

// ─── confetti：彩纸片炸开后翻飞下落，之后循环飘落 ───────────────────────
export const confettiOrnament: OrnamentBuilder = kit => {
    const sites = kit.sites('scatter', 6);
    const n = kit.count(26, 8);
    const pieces: Faller[] = Array.from({ length: n }, (_, i) => {
        const site = sites[i % sites.length]!;
        const sprite = kit.sprite(i % 3 === 2 ? 'triangle' : 'square');
        sprite.tint = kit.color(i);
        const angle = -Math.PI / 2 + (kit.rng() - 0.5) * 2.4;
        const speed = kit.size * (3 + kit.rng() * 4);
        return {
            sprite, site,
            x0: (kit.rng() * 2 - 1) * (site.w + kit.size),
            period: 3 + kit.rng() * 2.5,
            offset: kit.rng(),
            sway: kit.size * (0.2 + kit.rng() * 0.35),
            swayFreq: 0.4 + kit.rng() * 0.5,
            flip: 3 + kit.rng() * 6,
            spin: (kit.rng() - 0.5) * 6,
            size: kit.size * (0.2 + kit.rng() * 0.14),
            aspect: i % 3 === 2 ? 1 : 0.5 + kit.rng() * 0.3,
            delay: (i % 5) * 0.02,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
        };
    });
    const p = newPos();
    const burstLife = 2.2;
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        for (const it of pieces) {
            const local = time - it.site.start - it.delay;
            if (local < 0 || x >= 1) {
                it.sprite.visible = false;
                continue;
            }
            kit.pos(it.site, anchors, p);
            const { top, bottom } = fallerLayout(kit, it.site);
            let ox: number;
            let oy: number;
            let alpha = 1;
            if (local < burstLife) {
                // 第一程：从落点中心炸开，阻尼 + 重力的闭式解，渐隐交给循环。
                const drag = 2.6;
                const fall = kit.size * 1.6;
                const e = Math.exp(-drag * local);
                const f = (1 - e) / drag;
                ox = it.vx * f + Math.sin(local * it.swayFreq * TAU) * it.sway * (1 - e);
                oy = it.vy * f + fall * (local - f);
                alpha = 1 - clamp01((local - burstLife + 0.4) / 0.4);
            } else {
                const cycle = fract((local - burstLife) / it.period + it.offset);
                ox = it.x0 + Math.sin(local * it.swayFreq * TAU) * it.sway;
                oy = lerp(top, bottom, cycle);
                alpha = clamp01(cycle / 0.1) * clamp01((1 - cycle) / 0.15);
            }
            oy += kit.size * 3 * x * x;
            const flip = Math.cos(local * it.flip);
            it.sprite.visible = alpha > 0.01;
            it.sprite.position.set(p.x + ox, p.y + oy);
            it.sprite.width = it.size * Math.max(0.08, Math.abs(flip));
            it.sprite.height = it.size * it.aspect;
            it.sprite.rotation = local * it.spin;
            it.sprite.alpha = alpha * (1 - x) * p.alpha * (0.75 + 0.25 * Math.abs(flip));
        }
    };
};

// ─── petals：樱花瓣斜着飘 ──────────────────────────────────────────────
export const petalsOrnament: OrnamentBuilder = kit => {
    const sites = kit.sites('scatter', 4);
    const n = kit.count(16, 5);
    const petals: Faller[] = Array.from({ length: n }, (_, i) => {
        const site = sites[i % sites.length]!;
        const sprite = kit.sprite('petal');
        sprite.tint = kit.color(i);
        return {
            sprite, site,
            x0: (kit.rng() * 2 - 1) * (site.w + kit.size * 1.5),
            period: 4.5 + kit.rng() * 3,
            offset: kit.rng(),
            sway: kit.size * (0.3 + kit.rng() * 0.4),
            swayFreq: 0.25 + kit.rng() * 0.3,
            flip: 1.5 + kit.rng() * 2.5,
            spin: (kit.rng() - 0.5) * 2,
            size: kit.size * (0.22 + kit.rng() * 0.16),
            aspect: 1.35,
            delay: i * 0.05,
            vx: 0,
            vy: 0,
        };
    });
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        for (const it of petals) {
            const local = time - it.site.start - it.delay;
            if (local < 0 || x >= 1) {
                it.sprite.visible = false;
                continue;
            }
            kit.pos(it.site, anchors, p);
            const { top, bottom } = fallerLayout(kit, it.site);
            const cycle = fract(local / it.period + it.offset);
            const span = it.site.w + kit.size * 2;
            // 风从左往右：横向随下落漂移，在落点宽度里循环；退场时被一阵风吹走。
            const drift = wrap(it.x0 + span + cycle * kit.size * 2.5 + span, span * 2) - span;
            const ox = drift + Math.sin(local * it.swayFreq * TAU) * it.sway + kit.size * 6 * x * x;
            const oy = lerp(top, bottom, cycle);
            const flip = Math.cos(local * it.flip);
            const alpha = clamp01(cycle / 0.1) * clamp01((1 - cycle) / 0.15) * clamp01(local / 0.3);
            const pop = easeOutBack(local / 0.35, 2);
            it.sprite.visible = alpha > 0.01;
            it.sprite.position.set(p.x + ox, p.y + oy);
            it.sprite.width = it.size * Math.max(0.1, Math.abs(flip)) * pop;
            it.sprite.height = it.size * it.aspect * pop;
            it.sprite.rotation = 0.6 + Math.sin(local * 0.9 + it.offset * TAU) * 0.7 + local * it.spin * 0.2;
            it.sprite.alpha = alpha * (1 - x) * p.alpha * 0.9;
        }
    };
};

// ─── shards：三角碎片从字组边缘向外飞，悬停漂移 ──────────────────────────
export const shardsOrnament: OrnamentBuilder = kit => {
    const oneShot = kit.spec.placement === 'glyphs';
    const big = kit.spec.placement === 'behind' || kit.spec.placement === 'around' || kit.spec.placement === 'screen';
    const sites = kit.sites('single', 8);
    const per = oneShot ? 4 : Math.max(3, Math.round(kit.count(18, 5) / sites.length));
    const shards = sites.flatMap((site, si) => Array.from({ length: per }, (_, i) => {
        const angle = (TAU * (i + kit.rng() * 0.8)) / per + si;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const edge = big
            ? 1 / Math.sqrt((cos / (site.w + kit.size * 0.2)) ** 2 + (sin / (site.h + kit.size * 0.2)) ** 2)
            : site.w * 0.8;
        const sprite = kit.sprite('triangle');
        sprite.tint = kit.color(si + i);
        return {
            sprite, site, cos, sin, edge,
            reach: kit.size * (oneShot ? 0.6 + kit.rng() * 0.6 : 0.8 + kit.rng() * 1.6),
            size: kit.size * (oneShot ? 0.14 + kit.rng() * 0.1 : 0.18 + kit.rng() * 0.22),
            rot: kit.rng() * TAU,
            spin: (kit.rng() - 0.5) * 10,
            stretch: 1.3 + kit.rng() * 0.8,
        };
    }));
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        for (const s of shards) {
            const local = time - s.site.start;
            if (local < 0 || x >= 1 || (oneShot && local > 1.1)) {
                s.sprite.visible = false;
                continue;
            }
            kit.pos(s.site, anchors, p);
            // 迅速冲出去（阻尼），之后以很小的速度继续向外漂。
            const out = s.reach * (1 - Math.exp(-5 * local)) + kit.size * 0.08 * local + kit.size * 4 * easeInCubic(x);
            const r = s.edge + out;
            let scale = easeOutBack(local / 0.2, 2) * lerp(1, 0.7, clamp01(local / 3)) * (1 - x);
            let alpha = p.alpha * (1 - x);
            if (oneShot) {
                const k = clamp01((local - 0.4) / 0.7);
                scale *= 1 - k;
                alpha *= 1 - k;
            }
            s.sprite.visible = scale > 0.01;
            s.sprite.position.set(p.x + s.cos * r, p.y + s.sin * r);
            s.sprite.width = s.size * scale;
            s.sprite.height = s.size * scale * s.stretch;
            s.sprite.rotation = s.rot + s.spin * (1 - Math.exp(-2 * local)) + 0.2 * local;
            s.sprite.alpha = alpha;
        }
    };
};

// ─── streaks：纵向速度线（强调上升） ───────────────────────────────────
export const streaksOrnament: OrnamentBuilder = kit => {
    const sites = kit.sites('scatter', 6);
    const n = kit.count(kit.spec.placement === 'screen' ? 30 : 20, 6);
    const lines = Array.from({ length: n }, (_, i) => {
        const site = sites[i % sites.length]!;
        const [ox] = kit.scatter(site);
        const sprite = kit.sprite('streak');
        // 纹理上亮下暗；线往下掠过（世界在上升），亮头朝下。
        sprite.rotation = Math.PI;
        sprite.tint = kit.color(i);
        return {
            sprite, site, ox,
            y0: kit.rng(),
            length: kit.size * (1.4 + kit.rng() * 2.6),
            thick: Math.max(1, kit.size * (0.025 + kit.rng() * 0.05)),
            speed: kit.size * (5 + kit.rng() * 7),
            delay: kit.rng() * 0.3,
            salt: i * 13 + 1,
        };
    });
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        for (const l of lines) {
            const local = time - l.site.start - l.delay;
            if (local < 0 || x >= 1) {
                l.sprite.visible = false;
                continue;
            }
            kit.pos(l.site, anchors, p);
            const top = -l.site.h - kit.size * 2 - l.length;
            const span = l.site.h * 2 + kit.size * 4 + l.length * 2;
            // 入场时加速，退场时再猛冲一下。
            const travel = l.speed * (local + 2 * x * x);
            const y = top + wrap(l.y0 * span + travel, span);
            const cycle = (y - top) / span;
            const window = clamp01(cycle / 0.15) * clamp01((1 - cycle) / 0.15);
            const flicker = hash01(Math.floor(time * 15), l.salt) < 0.2 ? 0.3 : 1;
            l.sprite.visible = window > 0.01;
            l.sprite.position.set(p.x + l.ox, p.y + y);
            l.sprite.width = l.thick;
            l.sprite.height = l.length * (1 + x);
            l.sprite.alpha = window * flicker * clamp01(local / 0.25) * (1 - x) * p.alpha * 0.85;
        }
    };
};

// ─── chevrons：^^^ 箭头沿上升方向一拍一格地流动 ───────────────────────────
export const chevronsOrnament: OrnamentBuilder = kit => {
    const shape = kit.context();
    shape.moveTo(-5, 3).lineTo(0, -2).lineTo(5, 3).stroke({ width: 2.4, color: 0xffffff, cap: 'square', join: 'miter' });
    const placement = kit.spec.placement;
    let columns: Array<{ site: Site; dx: number; scale: number; alpha: number }>;
    const sites = kit.sites('single', 6);
    if (placement === 'around') {
        const site = sites[0]!;
        columns = [-1, 1].map(side => ({ site, dx: side * (site.w + kit.size * 0.8), scale: 1, alpha: 1 }));
    } else if (placement === 'screen') {
        const site = sites[0]!;
        columns = [-0.4, -0.2, 0.2, 0.4].map(k => ({ site, dx: k * kit.ctx.width, scale: 1.2, alpha: 0.7 }));
    } else if (placement === 'behind') {
        columns = [{ site: sites[0]!, dx: 0, scale: 2.2, alpha: 0.35 }];
    } else {
        columns = sites.map(site => ({ site, dx: 0, scale: placement === 'glyphs' ? 0.6 : 1, alpha: 1 }));
    }
    const perColumn = Math.max(2, Math.min(6, kit.count(4, 2)));
    const oneShot = placement === 'glyphs';
    const spacing = kit.size * 0.42;
    const items = columns.flatMap((col, ci) => Array.from({ length: perColumn }, (_, j) => {
        const g: Graphics = kit.graphics(kit.view, shape);
        g.tint = kit.color(ci + j);
        return { g, col, j };
    }));
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        for (const it of items) {
            const { col, j } = it;
            const local = time - col.site.start - j * 0.05;
            if (local < 0 || x >= 1 || (oneShot && local > 1.6)) {
                it.g.visible = false;
                continue;
            }
            kit.pos(col.site, anchors, p);
            const s = spacing * col.scale;
            const total = perColumn * s;
            // 一拍一格往上走，每格落定时有过冲。
            const travel = beatSteps(local * 3.2, 0.4) * s * 0.5 + x * x * s * 6;
            const y = wrap(j * s - travel, total);
            const k = y / total;
            const fade = Math.sin(Math.PI * clamp01(k));
            const pop = easeOutBack(local / 0.3, 2.4);
            const baseY = oneShot ? p.y - p.size * 0.8 - total * 0.5 : p.y - total / 2;
            it.g.visible = true;
            it.g.position.set(p.x + col.dx, baseY + y);
            it.g.scale.set(Math.max(0.001, (kit.size * 0.06) * col.scale * pop));
            let alpha = fade * col.alpha * (1 - x) * p.alpha;
            if (oneShot) alpha *= 1 - clamp01((local - 1) / 0.6);
            it.g.alpha = alpha;
        }
    };
};

// ─── glints：字被唱到时，一粒光点沿字的轮廓跑一圈 ─────────────────────────
/** 方框周长参数化：u ∈ [0, 1) → 边上的点（从左上角顺时针）。 */
export const aroundBox = (u: number, halfW: number, halfH: number): [number, number] => {
    const perimeter = 4 * (halfW + halfH);
    let d = fract(u) * perimeter;
    if (d < 2 * halfW) return [-halfW + d, -halfH];
    d -= 2 * halfW;
    if (d < 2 * halfH) return [halfW, -halfH + d];
    d -= 2 * halfH;
    if (d < 2 * halfW) return [halfW - d, halfH];
    d -= 2 * halfW;
    return [-halfW, halfH - d];
};

export const glintsOrnament: OrnamentBuilder = kit => {
    const onGlyph = kit.spec.placement === 'glyphs' || kit.glyphs.length === 0;
    const run = 0.55;
    if (onGlyph) {
        const items = triggers(kit, kit.count(16, 4)).map((trigger, i) => {
            const head = kit.sprite('glow');
            const tail = kit.sprite('dot');
            const spark = kit.sprite('star4');
            [head, tail, spark].forEach(s => { s.tint = kit.color(i); });
            return { head, tail, spark, trigger, corner: Math.floor(kit.rng() * 4) / 4 };
        });
        const site = kit.sites('single', 1)[0]!;
        const p = newPos();
        return time => {
            const anchors = kit.anchors(time);
            const x = kit.exit(time);
            items.forEach(it => {
                const local = time - it.trigger.at;
                const hide = local < 0 || x >= 1;
                it.head.visible = !hide;
                it.tail.visible = !hide;
                it.spark.visible = !hide;
                if (hide) return;
                let gx: number;
                let gy: number;
                let size: number;
                let alpha = 1;
                if (it.trigger.glyph) {
                    const anchor = anchors[it.trigger.glyph.index];
                    gx = anchor?.x ?? it.trigger.glyph.x;
                    gy = anchor?.y ?? it.trigger.glyph.y;
                    size = anchor?.size ?? it.trigger.glyph.size;
                    alpha = anchor?.alpha ?? 1;
                } else {
                    kit.pos(site, anchors, p);
                    gx = p.x;
                    gy = p.y;
                    size = kit.size;
                }
                const half = size * 0.56;
                const k = clamp01(local / run);
                const running = k < 1;
                const u = easeOutCubic(k);
                const [hx, hy] = aroundBox(u, half, half);
                const [tx, ty] = aroundBox(Math.max(0, u - 0.08), half, half);
                const hs = kit.size * 0.35;
                it.head.visible = running;
                it.tail.visible = running;
                if (running) {
                    it.head.position.set(gx + hx, gy + hy);
                    it.head.width = hs;
                    it.head.height = hs;
                    it.head.alpha = alpha;
                    it.tail.position.set(gx + tx, gy + ty);
                    it.tail.width = hs * 0.25;
                    it.tail.height = hs * 0.25;
                    it.tail.alpha = alpha * 0.7;
                }
                // 跑完一圈：在某个角上留下一颗闪着的小星。
                const [cx, cy] = aroundBox(it.corner, half, half);
                const after = local - run;
                const twinkle = after < 0 ? 0 : spring(after, 2.5, 6) * (0.55 + 0.45 * Math.sin(time * 7 + it.corner * 20));
                const ss = kit.size * 0.4 * twinkle * (1 - easeInCubic(x));
                it.spark.visible = ss > 0.5;
                it.spark.position.set(gx + cx, gy + cy);
                it.spark.width = ss;
                it.spark.height = ss;
                it.spark.alpha = alpha * (1 - x);
            });
        };
    }
    // 不贴字：一粒光点绕着落点的方框循环跑，每个字被唱到时加速、变亮。
    const sites = kit.sites('single', 1);
    const runners = sites.flatMap((site, si) => [0, 0.5].map((phase, r) => {
        const head = kit.sprite('glow');
        const tails = [kit.sprite('dot'), kit.sprite('dot'), kit.sprite('dot')];
        [head, ...tails].forEach(s => { s.tint = kit.color(si + r); });
        return { site, phase, head, tails };
    }));
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        const boost = Math.exp(-(time - kit.lastSung(time)) / 0.2);
        for (const r of runners) {
            const local = time - r.site.start;
            const hide = local < 0 || x >= 1;
            r.head.visible = !hide;
            r.tails.forEach(t => { t.visible = !hide; });
            if (hide) continue;
            kit.pos(r.site, anchors, p);
            const halfW = r.site.w + kit.size * 0.15;
            const halfH = r.site.h + kit.size * 0.15;
            const u = r.phase + local / 2.8 + 0.1 * beatSteps(local * 1.2, 0.3) / 1.2;
            const alpha = clamp01(local / 0.2) * (1 - x) * p.alpha;
            const [hx, hy] = aroundBox(u, halfW, halfH);
            const hs = kit.size * (0.3 + 0.25 * boost);
            r.head.position.set(p.x + hx, p.y + hy);
            r.head.width = hs;
            r.head.height = hs;
            r.head.alpha = alpha;
            r.tails.forEach((t, k) => {
                const [tx, ty] = aroundBox(u - 0.012 * (k + 1), halfW, halfH);
                const ts = hs * 0.3 * (1 - k * 0.25);
                t.position.set(p.x + tx, p.y + ty);
                t.width = ts;
                t.height = ts;
                t.alpha = alpha * (0.7 - k * 0.2);
            });
        }
    };
};
