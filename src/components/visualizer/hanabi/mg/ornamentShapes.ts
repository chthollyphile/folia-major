// Copyright (c) 2026 chthollyphile
import type { Container, Graphics, Sprite } from 'pixi.js';
import type { OrnamentBuilder, Site, SitePos } from './ornamentKit';
import { beatSteps, clamp01, easeInBack, easeInCubic, easeOutBack, easeOutCubic, easeOutExpo, fract, hash01, lerp, spring, TAU } from './mgMath';

// src/components/visualizer/hanabi/mg/ornamentShapes.ts
// 几何类装饰件：扩散圆环、集中线、环绕点阵、角括号、虚线圆、同心方框、旭日放射、印章、网点。
// 形状在构建时画好（Graphics / 共享纹理的 Sprite），逐帧只改 transform 与 alpha。

const newPos = (): SitePos => ({ x: 0, y: 0, alpha: 1, size: 0 });

/** 落点的「大件」半径：behind / around 围住字组，其余是小件。 */
const siteRadius = (placement: string, site: Site, fallback: number) => {
    if (placement === 'behind') return Math.hypot(site.w, site.h) * 0.8;
    if (placement === 'around') return Math.hypot(site.w, site.h) * 0.95;
    if (placement === 'screen') return Math.min(site.w, site.h) * 0.75;
    return Math.max(site.w, fallback) * 1.3;
};

// ─── ring：扩散的描边圆环 ──────────────────────────────────────────────
export const ringOrnament: OrnamentBuilder = kit => {
    const oneShot = kit.spec.placement === 'glyphs';
    const layers = oneShot ? 1 : Math.min(3, kit.count(2.4, 1));
    const line = Math.max(1.5, kit.size * 0.055);
    const units = kit.sites('single', 8).map((site, si) => {
        const radius = siteRadius(kit.spec.placement, site, kit.size * 0.5) * (oneShot ? 1.3 : 1);
        const rings = Array.from({ length: layers }, (_, j) => {
            const g = kit.graphics();
            g.circle(0, 0, radius * (1 + 0.14 * j)).stroke({ width: line * (j === 0 ? 1.6 : 0.8), color: 0xffffff });
            g.tint = kit.color(si + j);
            return g;
        });
        let pulse: Graphics | null = null;
        if (!oneShot) {
            pulse = kit.graphics();
            pulse.circle(0, 0, radius).stroke({ width: line * 0.6, color: 0xffffff });
            pulse.tint = kit.color(si + 1);
        }
        return { site, rings, pulse };
    });
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        for (const u of units) {
            kit.pos(u.site, anchors, p);
            const e = time - u.site.start;
            u.rings.forEach((g, j) => {
                const local = e - j * 0.09;
                const x = kit.exit(time, j * 0.05);
                if (local < 0 || x >= 1) {
                    g.visible = false;
                    return;
                }
                let scale: number;
                let alpha: number;
                if (oneShot) {
                    const k = clamp01(local / 0.8);
                    scale = 0.3 + 1.1 * easeOutExpo(k);
                    alpha = (1 - k) ** 1.5;
                } else {
                    scale = lerp(0.2, 1, easeOutBack(local / 0.55, 2.4)) * (1 + 0.025 * Math.sin(TAU * (time * 0.5 + j / 3)));
                    alpha = clamp01(local / 0.08);
                    scale *= 1 - easeInBack(x, 2);
                    alpha *= 1 - x;
                }
                g.visible = alpha > 0.005 && scale > 0.001;
                g.position.set(p.x, p.y);
                g.scale.set(Math.max(0.001, scale));
                g.alpha = alpha * p.alpha;
            });
            if (u.pulse) {
                const q = fract((e - 0.6) / 1.8);
                const x = kit.exit(time);
                u.pulse.visible = e > 0.6 && x < 1;
                u.pulse.position.set(p.x, p.y);
                u.pulse.scale.set(1 + 0.55 * easeOutCubic(q));
                u.pulse.alpha = 0.55 * (1 - q) ** 2 * (1 - x) * p.alpha;
            }
        }
    };
};

// ─── spokes：集中线 ────────────────────────────────────────────────────
export const spokesOrnament: OrnamentBuilder = kit => {
    const oneShot = kit.spec.placement === 'glyphs';
    const big = kit.spec.placement === 'behind' || kit.spec.placement === 'around' || kit.spec.placement === 'screen';
    const pad = kit.size * 0.45;
    const units = kit.sites('single', 6).map((site, si) => {
        const n = oneShot ? 8 : kit.count(big ? 28 : 10, 6);
        const spokes = Array.from({ length: n }, (_, i) => {
            const angle = (TAU * i) / n + (kit.rng() - 0.5) * (TAU / n) * 0.7;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            // 大件：内缘贴着字组的椭圆包络，线从字组外面向外放射。
            const inner = big
                ? 1 / Math.sqrt((cos / (site.w + pad)) ** 2 + (sin / (site.h + pad)) ** 2)
                : site.w * 1.1;
            const sprite = kit.sprite('streak');
            sprite.rotation = angle + Math.PI / 2;
            sprite.tint = kit.color(si + i);
            return {
                sprite, cos, sin, inner,
                length: kit.size * (oneShot ? 0.5 + kit.rng() * 0.5 : 0.7 + kit.rng() * 1.7),
                thick: Math.max(1.2, kit.size * (0.035 + kit.rng() * 0.05)),
                delay: (i % 6) * 0.015,
                salt: si * 97 + i,
            };
        });
        return { site, spokes };
    });
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        const beat = Math.floor(time * 12);
        const x = kit.exit(time);
        for (const u of units) {
            kit.pos(u.site, anchors, p);
            const e = time - u.site.start;
            for (const s of u.spokes) {
                const local = e - s.delay;
                if (local < 0 || x >= 1) {
                    s.sprite.visible = false;
                    continue;
                }
                const grow = easeOutExpo(local / 0.25);
                // 一拍一格的抖动：漫画集中线的「颤」。
                const jitter = 0.72 + 0.45 * hash01(beat, s.salt);
                let length = s.length * grow * jitter * (1 - x);
                let push = kit.size * 2.5 * easeInCubic(x);
                let alpha = (0.55 + 0.45 * hash01(beat + 7, s.salt)) * p.alpha;
                if (oneShot) {
                    const k = clamp01((local - 0.3) / 0.35);
                    push += kit.size * 0.8 * easeOutCubic(k);
                    length *= 1 - k;
                    alpha *= 1 - k;
                }
                const r = s.inner + push + length / 2;
                s.sprite.visible = length > 0.5 && alpha > 0.01;
                s.sprite.position.set(p.x + s.cos * r, p.y + s.sin * r);
                s.sprite.width = s.thick * (1 - x * 0.5);
                s.sprite.height = length;
                s.sprite.alpha = alpha;
            }
        }
    };
};

// ─── orbit：绕字组旋转的点阵（带一点纵深） ─────────────────────────────
export const orbitOrnament: OrnamentBuilder = kit => {
    const big = kit.spec.placement === 'behind' || kit.spec.placement === 'around' || kit.spec.placement === 'screen';
    const tilt = -0.18;
    const units = kit.sites('single', 4).map((site, si) => {
        const rx = big ? site.w + kit.size * 0.5 : site.w * 1.5;
        const ry = big ? site.h + kit.size * 0.6 : site.h * 0.8;
        // 每圈几列「车厢」：一颗领头的四角星 + 后面渐小的一串点，两圈反向转。
        const trains = big ? Math.max(2, Math.min(6, kit.count(4, 2))) : 2;
        const cars = big ? 5 : 3;
        const rings = [
            { omega: 0.55, reach: 1, trains },
            { omega: -0.85, reach: 1.2, trains: Math.max(1, trains - 1) },
        ];
        const paths = rings.map((ring, r) => {
            const g = kit.graphics();
            g.ellipse(0, 0, rx * ring.reach, ry * ring.reach).stroke({ width: Math.max(1, kit.size * 0.02), color: 0xffffff });
            g.rotation = tilt;
            g.tint = kit.color(si + r);
            return { g, delay: r * 0.12 };
        });
        const dots = rings.flatMap((ring, r) => Array.from({ length: ring.trains * cars }, (_, index) => {
            const train = Math.floor(index / cars);
            const car = index % cars;
            const leader = car === 0;
            const sprite = kit.sprite(leader ? 'star4' : 'dot');
            sprite.tint = kit.color(si + r + train);
            return {
                sprite,
                theta: (TAU * train) / ring.trains + r * 0.5 - Math.sign(ring.omega) * car * 0.11,
                omega: ring.omega,
                rx: rx * ring.reach,
                ry: ry * ring.reach,
                size: kit.size * (leader ? 0.34 : 0.14 * (1 - car / (cars + 1))),
                delay: train * 0.06 + car * 0.03 + r * 0.12,
            };
        }));
        return { site, dots, paths };
    });
    const p = newPos();
    const cosT = Math.cos(tilt);
    const sinT = Math.sin(tilt);
    return time => {
        const anchors = kit.anchors(time);
        for (const u of units) {
            kit.pos(u.site, anchors, p);
            const e = time - u.site.start;
            for (const path of u.paths) {
                const local = e - path.delay;
                const x = kit.exit(time);
                path.g.visible = local >= 0 && x < 1;
                if (!path.g.visible) continue;
                path.g.position.set(p.x, p.y);
                path.g.scale.set(Math.max(0.001, easeOutBack(local / 0.5, 1.8) * (1 + 1.2 * easeInCubic(x))));
                path.g.alpha = 0.3 * clamp01(local / 0.1) * (1 - x) * p.alpha;
            }
            u.dots.forEach((d, i) => {
                const local = e - d.delay;
                const x = kit.exit(time, (i % 8) * 0.02);
                if (local < 0 || x >= 1) {
                    d.sprite.visible = false;
                    return;
                }
                const reach = spring(local, 1.6, 5.5) * (1 + 1.2 * easeInCubic(x));
                const theta = d.theta + d.omega * time - Math.sign(d.omega) * 2.2 * (1 - easeOutCubic(local / 0.9));
                const ox = Math.cos(theta) * d.rx * reach;
                const oy = Math.sin(theta) * d.ry * reach;
                // 椭圆下半圈在前、上半圈在后：后面的小一点、暗一点。
                const near = 0.5 + 0.5 * Math.sin(theta);
                d.sprite.visible = true;
                d.sprite.position.set(p.x + ox * cosT - oy * sinT, p.y + ox * sinT + oy * cosT);
                const s = d.size * (0.65 + 0.35 * near);
                d.sprite.width = s;
                d.sprite.height = s;
                d.sprite.rotation = theta;
                d.sprite.alpha = clamp01(local / 0.05) * (0.45 + 0.55 * near) * (1 - x) * p.alpha;
            });
        }
    };
};

// ─── brackets：「」角括号 / 四角取景框 / 跟着唱到的字跳的准星 ─────────────
export const bracketsOrnament: OrnamentBuilder = kit => {
    const placement = kit.spec.placement;
    const thick = Math.max(2, kit.size * 0.08);
    const pad = kit.size * 0.4;
    const make = (a: number, b: number, rotation: number, color: number) => {
        const g = kit.graphics();
        g.moveTo(a, 0).lineTo(0, 0).lineTo(0, b).stroke({ width: thick, color: 0xffffff, cap: 'square', join: 'miter' });
        g.rotation = rotation;
        g.tint = color;
        return g;
    };
    // 四个角的旋转：TL 0、TR π/2、BR π、BL 3π/2。
    const CORNERS: Array<[number, number, number]> = [[-1, -1, 0], [1, -1, Math.PI / 2], [1, 1, Math.PI], [-1, 1, Math.PI * 1.5]];

    if (placement === 'glyphs' && kit.glyphs.length > 0) {
        const arm = kit.size * 0.28;
        const corners = CORNERS.map(([sx, sy, rot], k) => ({ g: make(arm, arm, rot, kit.color(k)), sx, sy }));
        const order = [...kit.glyphs].sort((p, q) => p.sungAt - q.sungAt);
        return time => {
            const x = kit.exit(time);
            let current = -1;
            for (let i = 0; i < order.length; i += 1) if (order[i]!.sungAt <= time) current = i;
            const visible = current >= 0 && time >= kit.start && x < 1;
            for (const c of corners) c.g.visible = visible;
            if (!visible) return;
            const anchors = kit.anchors(time);
            const cur = order[current]!;
            const prev = order[Math.max(0, current - 1)]!;
            const a = anchors[cur.index];
            const b = anchors[prev.index];
            const k = current === 0 ? 1 : easeOutBack((time - cur.sungAt) / 0.2, 1.8);
            const px = lerp(b?.x ?? prev.x, a?.x ?? cur.x, k);
            const py = lerp(b?.y ?? prev.y, a?.y ?? cur.y, k);
            const half = lerp(b?.size ?? prev.size, a?.size ?? cur.size, k) * 0.62;
            const snap = 1 + 0.35 * Math.exp(-(time - cur.sungAt) / 0.08);
            for (const c of corners) {
                c.g.position.set(px + c.sx * half * snap * (1 + x), py + c.sy * half * snap * (1 + x));
                c.g.alpha = (1 - x) * (a?.alpha ?? 1);
            }
        };
    }

    let rw = kit.hw + pad;
    let rh = kit.hh + pad * 0.7;
    let cx = kit.cx;
    let cy = kit.cy;
    if (placement === 'screen') {
        rw = kit.ctx.width * 0.42;
        rh = kit.ctx.height * 0.38;
        cx = 0;
        cy = 0;
    }
    let chosen = CORNERS;
    let armA = Math.min(rw * 0.35, kit.size * 0.9);
    let armB = armA;
    if (placement === 'behind' || placement === 'around' || placement === 'line-start' || placement === 'line-end') {
        // 「」：横臂短、竖臂长（竖排时反过来）。
        chosen = placement === 'line-start' ? [CORNERS[0]!] : placement === 'line-end' ? [CORNERS[2]!] : [CORNERS[0]!, CORNERS[2]!];
        armA = kit.vertical ? rw * 1.2 : kit.size * 0.55;
        armB = kit.vertical ? kit.size * 0.55 : rh * 1.2;
    }
    const pieces = chosen.map(([sx, sy, rot], k) => {
        // 旋转过的角：臂长按旋转后的方向交换。
        const swap = k % 2 === 1 && chosen.length === 4;
        return { g: make(swap ? armB : armA, swap ? armA : armB, rot, kit.color(k)), sx, sy, delay: k * 0.06 };
    });
    return time => {
        const beat = Math.exp(-(time - kit.lastSung(time)) / 0.12);
        pieces.forEach((piece, k) => {
            const local = time - kit.start - piece.delay;
            const x = kit.exit(time, k * 0.04);
            if (local < 0 || x >= 1) {
                piece.g.visible = false;
                return;
            }
            let off = (1 - easeOutBack(local / 0.45, 2.6)) * kit.size * 1.4;
            off += kit.size * 0.06 * Math.sin(TAU * time * 0.7) - kit.size * 0.15 * beat;
            off += easeInCubic(x) * kit.size * 2;
            // 入场前 0.12 秒像信号不稳一样闪两下。
            const flick = local < 0.12 ? (Math.floor(local * 40) % 2 === 0 ? 1 : 0.25) : 1;
            piece.g.visible = true;
            piece.g.position.set(cx + piece.sx * (rw + off), cy + piece.sy * (rh + off));
            piece.g.alpha = flick * (1 - x);
        });
    };
};

// ─── dash-circle：虚线圆 + 点线内圈，反向旋转 ───────────────────────────
export const dashCircleOrnament: OrnamentBuilder = kit => {
    const oneShot = kit.spec.placement === 'glyphs';
    const line = Math.max(1.5, kit.size * 0.05);
    const units = kit.sites('single', 6).map((site, si) => {
        const r1 = oneShot ? site.w * 1.35 : siteRadius(kit.spec.placement, site, kit.size * 0.6) * 1.05;
        const r2 = r1 * 0.84;
        const outer = kit.graphics();
        const dashes = r1 > kit.size * 2 ? 36 : 18;
        for (let k = 0; k < dashes; k += 1) {
            const a0 = (k * TAU) / dashes;
            const a1 = a0 + (TAU / dashes) * 0.55;
            outer.moveTo(Math.cos(a0) * r1, Math.sin(a0) * r1).arc(0, 0, r1, a0, a1);
        }
        outer.stroke({ width: line, color: 0xffffff, cap: 'round' });
        outer.tint = kit.color(si);
        const inner = kit.graphics();
        const dots = dashes * 2;
        for (let k = 0; k < dots; k += 1) {
            const a = (k * TAU) / dots;
            inner.circle(Math.cos(a) * r2, Math.sin(a) * r2, line * 0.7);
        }
        inner.fill({ color: 0xffffff });
        inner.tint = kit.color(si + 1);
        return { site, outer, inner };
    });
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        for (const u of units) {
            kit.pos(u.site, anchors, p);
            const local = time - u.site.start;
            // 贴字时只陪着这个字转一会儿（1.4 秒后淡出），不在整行上堆满圆。
            const fadeOut = oneShot ? clamp01((local - 1) / 0.4) : 0;
            const visible = local >= 0 && x < 1 && fadeOut < 1;
            u.outer.visible = visible;
            u.inner.visible = visible;
            if (!visible) continue;
            const scale = lerp(0.55, 1, easeOutBack(local / 0.5, 2)) * (1 + 0.3 * easeInCubic(x));
            const spinIn = (1 - easeOutCubic(local / 0.9)) * Math.PI * 1.2;
            const alpha = clamp01(local / 0.1) * (1 - x) * (1 - fadeOut) * p.alpha;
            u.outer.position.set(p.x, p.y);
            u.outer.scale.set(scale);
            u.outer.rotation = 0.35 * time + spinIn + x * x * 3;
            u.outer.alpha = alpha;
            u.inner.position.set(p.x, p.y);
            u.inner.scale.set(scale);
            // 内圈一拍一格地转。
            u.inner.rotation = -beatSteps((time - u.site.start) / 0.5) * (Math.PI / 18) - spinIn;
            u.inner.alpha = alpha * 0.85;
        }
    };
};

// ─── squares：同心方框，交错旋转 ───────────────────────────────────────
export const squaresOrnament: OrnamentBuilder = kit => {
    const big = kit.spec.placement === 'behind' || kit.spec.placement === 'around' || kit.spec.placement === 'screen';
    const oneShot = kit.spec.placement === 'glyphs';
    const layers = Math.min(4, Math.max(2, kit.count(3.2, 2)));
    const line = Math.max(1.5, kit.size * 0.05);
    const pad = kit.size * 0.35;
    const units = kit.sites('single', 5).map((site, si) => {
        const squares = Array.from({ length: layers }, (_, j) => {
            const g = kit.graphics();
            // 大件跟着字组的长宽比，只小角度来回摆；小件是正方形，一拍转 45°。
            const w = big ? site.w + pad * (j + 1) : site.w * (1.1 + 0.3 * j);
            const h = big ? site.h + pad * (j + 1) : w;
            g.rect(-w, -h, w * 2, h * 2).stroke({ width: line * (j === 0 ? 1.5 : 1), color: 0xffffff, join: 'miter' });
            g.tint = kit.color(si + j);
            return { g, dir: j % 2 === 0 ? 1 : -1, delay: j * 0.07, offset: j * 0.25 };
        });
        return { site, squares };
    });
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        for (const u of units) {
            kit.pos(u.site, anchors, p);
            u.squares.forEach((s, j) => {
                const local = time - u.site.start - s.delay;
                // 贴字时唱完就转着收掉（一拍半），退场时整组收掉。
                const x = Math.max(kit.exit(time, (layers - 1 - j) * 0.05), oneShot ? clamp01((local - 1.1) / 0.4) : 0);
                if (local < 0 || x >= 1) {
                    s.g.visible = false;
                    return;
                }
                const beats = local / 1.0 + s.offset;
                let rotation: number;
                if (big) {
                    const phase = Math.floor(beats) % 2 === 0 ? 1 : -1;
                    rotation = s.dir * 0.09 * lerp(-phase, phase, easeOutBack(fract(beats) / 0.35, 2));
                } else {
                    rotation = s.dir * beatSteps(beats) * (Math.PI / 4);
                }
                const scale = easeOutBack(local / 0.4, 2.2) * (1 - easeInBack(x, 2));
                s.g.visible = Math.abs(scale) > 0.001;
                s.g.position.set(p.x, p.y);
                s.g.rotation = rotation;
                s.g.scale.set(Math.max(0.001, scale));
                s.g.alpha = clamp01(local / 0.06) * (1 - x) * p.alpha;
            });
        }
    };
};

// ─── rays：字组背后的放射扇形（旭日） ───────────────────────────────────
export const raysOrnament: OrnamentBuilder = kit => {
    const oneShot = kit.spec.placement === 'glyphs';
    const faint = kit.spec.placement === 'behind' || kit.spec.placement === 'screen';
    const units = kit.sites('single', 3).map((site, si) => {
        const radius = kit.spec.placement === 'screen'
            ? Math.hypot(kit.ctx.width, kit.ctx.height) * 0.6
            : kit.spec.placement === 'behind' || kit.spec.placement === 'around'
                ? Math.hypot(site.w, site.h) * 1.7
                : site.w * 2.4;
        const wedges = oneShot ? 8 : Math.max(6, kit.count(12, 6));
        const g = kit.graphics();
        for (let k = 0; k < wedges; k += 1) {
            const a0 = (k * TAU) / wedges;
            const a1 = a0 + (TAU / wedges) * 0.5;
            g.moveTo(0, 0).lineTo(Math.cos(a0) * radius, Math.sin(a0) * radius).lineTo(Math.cos(a1) * radius, Math.sin(a1) * radius).closePath();
        }
        g.fill({ color: 0xffffff });
        g.tint = kit.color(si);
        return { site, g, dir: si % 2 === 0 ? 1 : -1 };
    });
    const p = newPos();
    const baseAlpha = faint ? 0.26 : 0.45;
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        const tick = Math.exp(-(time - kit.lastSung(time)) / 0.15);
        for (const u of units) {
            kit.pos(u.site, anchors, p);
            const local = time - u.site.start;
            if (local < 0 || x >= 1 || (oneShot && local > 1.2)) {
                u.g.visible = false;
                continue;
            }
            let scale = easeOutBack(local / 0.6, 1.6) * (1 + 0.03 * Math.sin(TAU * time * 0.8) + 0.04 * tick) * (1 + 0.25 * x);
            let alpha = baseAlpha * clamp01(local / 0.1) * (1 - x);
            if (oneShot) {
                const k = clamp01((local - 0.5) / 0.7);
                alpha *= 1 - k;
                scale *= 1 + 0.3 * k;
            }
            u.g.visible = true;
            u.g.position.set(p.x, p.y);
            u.g.scale.set(Math.max(0.001, scale));
            u.g.rotation = u.dir * (time * 0.12 - 0.8 * (1 - easeOutCubic(local / 0.8)) + x * x * 1.5);
            u.g.alpha = alpha * p.alpha;
        }
    };
};

// ─── stamp：圆框印章里一个字，盖下去时回弹 ───────────────────────────────
const STAMP_CHARS = ['花', '火', '夏', '夜', '空', '光'];
const STAMP_FONT = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "Noto Serif SC", "Songti SC", serif';

export const stampOrnament: OrnamentBuilder = kit => {
    const placement = kit.spec.placement;
    const pad = kit.size * 0.6;
    let radius = kit.size * 0.72;
    let x0: number;
    let y0: number;
    let faint = false;
    const corner = Math.floor(kit.rng() * 4);
    const sx = corner === 0 || corner === 3 ? -1 : 1;
    const sy = corner < 2 ? -1 : 1;
    switch (placement) {
        case 'behind':
            radius = Math.min(kit.hw, kit.hh) * 1.1 + kit.size * 0.3;
            x0 = kit.cx;
            y0 = kit.cy;
            faint = true;
            break;
        case 'screen':
            x0 = sx * kit.ctx.width * 0.36;
            y0 = sy * kit.ctx.height * 0.32;
            radius = Math.min(kit.ctx.width, kit.ctx.height) * 0.08 * kit.spec.scale;
            break;
        case 'line-start':
            x0 = kit.vertical ? kit.cx : kit.cx - kit.hw - pad - radius;
            y0 = kit.vertical ? kit.cy - kit.hh - pad - radius : kit.cy;
            break;
        case 'line-end':
        case 'glyphs':
            x0 = kit.vertical ? kit.cx : kit.cx + kit.hw + pad * 0.6 + radius;
            y0 = kit.vertical ? kit.cy + kit.hh + pad * 0.6 + radius : kit.cy + kit.hh * 0.4;
            break;
        default:
            x0 = kit.cx + sx * (kit.hw + radius * 0.6);
            y0 = kit.cy + sy * (kit.hh + radius * 0.5);
    }
    const holder: Container = new kit.pixi.Container();
    kit.view.addChild(holder);
    holder.position.set(x0, y0);
    const frame = kit.graphics(holder);
    frame.circle(0, 0, radius).stroke({ width: radius * 0.1, color: 0xffffff });
    frame.circle(0, 0, radius * 0.8).stroke({ width: radius * 0.035, color: 0xffffff });
    const char = STAMP_CHARS[Math.floor(kit.rng() * STAMP_CHARS.length) % STAMP_CHARS.length]!;
    const text = new kit.pixi.Text({
        text: char,
        style: { fontFamily: STAMP_FONT, fontSize: Math.max(8, radius * 1.02), fontWeight: '900', fill: 0xffffff, align: 'center' },
    });
    text.anchor.set(0.5, 0.54);
    holder.addChild(text);
    holder.tint = kit.color(0);
    const shock: Sprite = kit.sprite('ring');
    shock.tint = kit.color(1);
    const tilt = (kit.rng() - 0.5) * 0.3;
    const slam = 0.18;
    return time => {
        const local = time - kit.start;
        const x = kit.exit(time);
        if (local < 0 || x >= 1) {
            holder.visible = false;
            shock.visible = false;
            return;
        }
        holder.visible = true;
        let scale: number;
        let rotation: number;
        if (local < slam) {
            // 从 2.4 倍加速砸下。
            const k = easeInCubic(local / slam);
            scale = lerp(2.4, 1, k);
            rotation = lerp(-0.5, tilt, k);
        } else {
            const after = local - slam;
            scale = 1 + 0.14 * Math.exp(-after * 9) * Math.cos(after * 38);
            rotation = tilt + 0.02 * Math.sin(time * 0.6);
        }
        scale *= 1 - easeInBack(x, 2.4);
        holder.scale.set(Math.max(0.001, scale));
        holder.rotation = rotation;
        holder.alpha = clamp01(local / 0.06) * (faint ? 0.3 : 1) * (x > 0.6 ? (Math.floor(x * 20) % 2 === 0 ? 1 : 0.3) : 1);
        const impact = local - slam;
        const k = clamp01(impact / 0.45);
        shock.visible = impact >= 0 && k < 1;
        if (shock.visible) {
            const size = radius * 2 * (1 + 0.9 * easeOutCubic(k));
            shock.position.set(x0, y0);
            shock.width = size;
            shock.height = size;
            shock.alpha = (1 - k) ** 2 * (faint ? 0.3 : 0.8);
        }
    };
};

// ─── halftone：网点渐变块（在色块后） ─────────────────────────────────
export const halftoneOrnament: OrnamentBuilder = kit => {
    const placement = kit.spec.placement;
    const perSite = placement === 'glyphs' ? 25 : placement === 'corners' ? 36 : kit.count(170, 40);
    const units = kit.sites('single', 6).map((site, si) => {
        let w = site.w;
        let h = site.h;
        if (placement === 'around') {
            w = w * 1.2 + kit.size * 0.4;
            h = h * 1.35 + kit.size * 0.6;
        } else if (placement === 'behind') {
            // 网点块比字组宽一圈、上下更高，斜着露出来。
            w = w * 1.15 + kit.size * 0.3;
            h = h * 1.6 + kit.size * 0.4;
        } else if (placement === 'glyphs') {
            w *= 1.4;
            h *= 1.4;
        }
        const spacing = Math.max(kit.size * 0.18, Math.sqrt((4 * w * h) / Math.min(260, perSite)));
        const cols = Math.max(2, Math.round((2 * w) / spacing));
        const rows = Math.max(2, Math.round((2 * h) / spacing));
        // 渐变方向：沿对角线，按种子选四个方向之一。
        const dirA = (Math.floor(kit.rng() * 4) * Math.PI) / 2 + Math.PI / 4;
        const dx = Math.cos(dirA);
        const dy = Math.sin(dirA);
        const dots: Array<{ sprite: Sprite; ox: number; oy: number; proj: number }> = [];
        for (let r = 0; r < rows; r += 1) {
            for (let c = 0; c < cols; c += 1) {
                const ox = (c - (cols - 1) / 2) * spacing + (r % 2 === 0 ? 0 : spacing * 0.5);
                const oy = (r - (rows - 1) / 2) * spacing;
                const proj = clamp01(0.5 + (ox * dx + oy * dy) / (2 * Math.hypot(w, h)) * 1.4);
                const sprite = kit.sprite('dot');
                sprite.tint = kit.color(si);
                dots.push({ sprite, ox, oy, proj });
            }
        }
        return { site, dots, spacing };
    });
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        for (const u of units) {
            kit.pos(u.site, anchors, p);
            const local = time - u.site.start;
            for (const d of u.dots) {
                // 入场沿渐变方向扫进来，退场反向扫掉。
                const reveal = local - d.proj * 0.55;
                const leave = x * 1.6 - (1 - d.proj) * 0.6;
                const pop = easeOutBack(reveal / 0.22, 2.5) * (1 - clamp01(leave / 0.4));
                const wave = 0.22 * Math.sin(TAU * (d.proj * 1.5 - time * 0.4));
                const value = clamp01(1 - d.proj * 0.9 + wave);
                const size = u.spacing * 0.92 * value * pop;
                d.sprite.visible = size > 0.4 && reveal > 0;
                if (!d.sprite.visible) continue;
                d.sprite.position.set(p.x + d.ox, p.y + d.oy);
                d.sprite.width = size;
                d.sprite.height = size;
                d.sprite.alpha = 0.75 * p.alpha;
            }
        }
    };
};
