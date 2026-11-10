// Copyright (c) 2026 chthollyphile
import type { Graphics, Sprite } from 'pixi.js';
import type { GlyphInfo, Kit, OrnamentBuilder, SitePos } from './ornamentKit';
import { clamp01, easeInCubic, easeOutBack, easeOutCubic, easeOutExpo, fract, lerp, TAU } from './mgMath';

// src/components/visualizer/hanabi/mg/ornamentLines.ts
// 线类装饰件：锯齿线（从字组两侧抽出）、正弦波线（横穿）、下划线（被唱到的字下方）、点线（逐点亮起）。
// 锯齿与波线要逐帧变形，各用一个 Graphics 每帧重画（点数有上限）；下划线与点线是 Sprite。

const newPos = (): SitePos => ({ x: 0, y: 0, alpha: 1, size: 0 });

/** 一条线的走向：起点、方向、长度；同一个装饰件的几条线共用一个 Graphics。 */
interface Track {
    x: number;
    y: number;
    dx: number;
    dy: number;
    length: number;
    /** 跟着某个字走（−1 = 静态）。 */
    glyph: number;
    start: number;
}

/** 按 placement 给出线的走向：around / behind / glyphs 从字组两侧往外，line-* 从一端往外，corners 从四角斜出，screen 横贯全屏。 */
const tracksFor = (kit: Kit, reach: number, across: boolean): Track[] => {
    const pad = kit.size * 0.35;
    const { cx, cy, hw, hh, vertical, start } = kit;
    const along = (sign: number): Track => (vertical
        ? { x: cx, y: cy + sign * (hh + pad), dx: 0, dy: sign, length: reach, glyph: -1, start }
        : { x: cx + sign * (hw + pad), y: cy, dx: sign, dy: 0, length: reach, glyph: -1, start });
    switch (kit.spec.placement) {
        case 'line-start':
            return [along(-1)];
        case 'line-end':
            return [along(1)];
        case 'corners':
            return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy], k) => ({
                x: cx + sx! * (hw + pad * 0.5), y: cy + sy! * (hh + pad * 0.5),
                dx: sx! * Math.SQRT1_2, dy: sy! * Math.SQRT1_2, length: reach * 0.6, glyph: -1, start: start + k * 0.06,
            }));
        case 'screen': {
            const w = kit.ctx.width * 0.55;
            const h = kit.ctx.height * 0.55;
            return vertical
                ? [{ x: cx - hw - pad * 2, y: -h, dx: 0, dy: 1, length: h * 2, glyph: -1, start },
                    { x: cx + hw + pad * 2, y: h, dx: 0, dy: -1, length: h * 2, glyph: -1, start: start + 0.1 }]
                : [{ x: -w, y: cy - hh - pad * 2, dx: 1, dy: 0, length: w * 2, glyph: -1, start },
                    { x: w, y: cy + hh + pad * 2, dx: -1, dy: 0, length: w * 2, glyph: -1, start: start + 0.1 }];
        }
        default:
            if (across) {
                // 横穿：沿字组下缘（竖排时右缘）从一端贯到另一端。
                return vertical
                    ? [{ x: cx + hw + pad, y: cy - hh - reach * 0.5, dx: 0, dy: 1, length: hh * 2 + reach, glyph: -1, start }]
                    : [{ x: cx - hw - reach * 0.5, y: cy + hh + pad, dx: 1, dy: 0, length: hw * 2 + reach, glyph: -1, start }];
            }
            return [along(-1), along(1)];
    }
};

/** 画出 track 上 [from, to]（0..1）这一段，offset(s) 给出沿法线的偏移。 */
const strokeTrack = (g: Graphics, track: Track, from: number, to: number, steps: number, offset: (s: number) => number, ox = 0, oy = 0) => {
    if (to - from <= 1e-4) return false;
    const nx = -track.dy;
    const ny = track.dx;
    for (let i = 0; i <= steps; i += 1) {
        const s = lerp(from, to, i / steps);
        const d = s * track.length;
        const o = offset(s);
        const x = track.x + ox + track.dx * d + nx * o;
        const y = track.y + oy + track.dy * d + ny * o;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
    }
    return true;
};

// ─── zigzag：锯齿线从字组两侧抽出 ─────────────────────────────────────
export const zigzagOrnament: OrnamentBuilder = kit => {
    const reach = kit.size * (2.6 + kit.rng() * 1.4);
    const tracks = tracksFor(kit, reach, false);
    const g = kit.graphics();
    g.tint = kit.color(0);
    const echo = kit.graphics();
    echo.tint = kit.color(1);
    const amp = kit.size * 0.18;
    const width = Math.max(1.5, kit.size * 0.06);
    return time => {
        g.clear();
        echo.clear();
        const x = kit.exit(time);
        let any = false;
        // 锯齿一拍翻一次相位（阶梯），幅度随拍子跳。
        const flip = Math.floor(time * 6) % 2 === 0 ? 0 : 0.5;
        const pump = 1 + 0.3 * (Math.floor(time * 3) % 3 === 0 ? 1 : 0);
        for (const track of tracks) {
            const local = time - track.start;
            if (local < 0 || x >= 1) continue;
            const teeth = Math.max(3, Math.round(track.length / (kit.size * 0.34)));
            const to = easeOutCubic(local / 0.5);
            const from = easeInCubic(x);
            const steps = teeth * 2;
            // 折线：只在齿尖取点，所以 steps = 齿数 × 2，偏移交替 ±amp。
            const zig = (s: number) => {
                const k = Math.round((s * teeth + flip) * 2);
                return (k % 2 === 0 ? 1 : -1) * amp * pump * Math.min(1, s * 6);
            };
            any = strokeTrack(g, track, from, to, steps, zig) || any;
            strokeTrack(echo, track, from, to * 0.8, steps, s => zig(s) * 0.6, -track.dy * amp * 1.8, track.dx * amp * 1.8);
        }
        if (any) {
            g.stroke({ width, color: 0xffffff, join: 'miter', cap: 'square' });
            echo.stroke({ width: width * 0.5, color: 0xffffff, join: 'miter' });
        }
        g.visible = any;
        echo.visible = any;
        g.alpha = 1 - x;
        echo.alpha = 0.6 * (1 - x);
    };
};

// ─── wave：正弦波线横穿 ────────────────────────────────────────────────
export const waveOrnament: OrnamentBuilder = kit => {
    const reach = kit.size * 4;
    const tracks = tracksFor(kit, reach, true);
    const layers = Math.min(3, Math.max(2, kit.count(2.4, 2)));
    const waves = Array.from({ length: layers }, (_, j) => {
        const g = kit.graphics();
        g.tint = kit.color(j);
        return { g, phase: j * 1.9, amp: kit.size * (0.22 - j * 0.05), speed: 0.6 + j * 0.25, width: Math.max(1.2, kit.size * (0.06 - j * 0.015)) };
    });
    const wavelength = kit.size * 1.6;
    return time => {
        const x = kit.exit(time);
        const bump = 1 + 0.6 * Math.exp(-(time - kit.lastSung(time)) / 0.25);
        waves.forEach((w, j) => {
            w.g.clear();
            let any = false;
            for (const track of tracks) {
                const local = time - track.start - j * 0.08;
                if (local < 0 || x >= 1) continue;
                const to = easeOutCubic(local / 0.7);
                const from = easeInCubic(x);
                const steps = Math.min(140, Math.max(16, Math.round(track.length / (kit.size * 0.12))));
                const cycles = track.length / wavelength;
                any = strokeTrack(w.g, track, from, to, steps, s =>
                    Math.sin((s * cycles - time * w.speed) * TAU + w.phase) * w.amp * bump * Math.sin(Math.PI * s)) || any;
            }
            if (any) w.g.stroke({ width: w.width, color: 0xffffff, cap: 'round', join: 'round' });
            w.g.visible = any;
            w.g.alpha = (1 - x) * (j === 0 ? 1 : 0.65);
        });
    };
};

// ─── underline：被唱到的字下方的粗下划线，唱完收起 ───────────────────────
export const underlineOrnament: OrnamentBuilder = kit => {
    const placement = kit.spec.placement;
    const thick = (size: number) => Math.max(2, size * 0.09 * kit.spec.scale);
    const vertical = kit.vertical;
    /** 一根条：left..right 是沿文字方向的两端（0..1 的比例），画在 (x, y) 起、长 length 的线上。 */
    const bar = (sprite: Sprite, x: number, y: number, length: number, from: number, to: number, height: number, alpha: number) => {
        const visible = to - from > 0.002 && alpha > 0.01;
        sprite.visible = visible;
        if (!visible) return;
        const mid = (from + to) / 2 * length;
        const len = (to - from) * length;
        if (vertical) {
            sprite.position.set(x, y + mid);
            sprite.width = height;
            sprite.height = len;
        } else {
            sprite.position.set(x + mid, y);
            sprite.width = len;
            sprite.height = height;
        }
        sprite.alpha = alpha;
    };

    if (placement === 'glyphs' || placement === 'corners' || kit.glyphs.length === 0) {
        const items = kit.glyphs.map((glyph, i) => {
            const main = kit.sprite('square');
            const echo = kit.sprite('square');
            main.tint = kit.color(i);
            echo.tint = kit.color(i + 1);
            return { glyph, main, echo };
        });
        return time => {
            const anchors = kit.anchors(time);
            const x = kit.exit(time);
            for (const it of items) {
                const anchor = anchors[it.glyph.index];
                const size = anchor?.size ?? it.glyph.size;
                const gx = anchor?.x ?? it.glyph.x;
                const gy = anchor?.y ?? it.glyph.y;
                const alpha = (anchor?.alpha ?? 1) * (1 - x);
                const local = time - it.glyph.sungAt;
                // 唱到时从头拉出，唱完 0.1 秒后从头收起。
                const retract = easeInCubic((time - it.glyph.sungEnd - 0.1) / 0.25);
                const grow = easeOutExpo(local / 0.18);
                const length = size * 1.04;
                const ox = vertical ? gx + size * 0.6 : gx - length / 2;
                const oy = vertical ? gy - length / 2 : gy + size * 0.6;
                bar(it.main, ox, oy, length, retract, local < 0 ? 0 : grow, thick(size), alpha);
                const growEcho = easeOutExpo((local - 0.06) / 0.2);
                const retractEcho = easeInCubic((time - it.glyph.sungEnd - 0.16) / 0.25);
                bar(it.echo, ox + (vertical ? thick(size) * 1.6 : 0), oy + (vertical ? 0 : thick(size) * 1.6), length,
                    retractEcho, local < 0.06 ? 0 : growEcho, thick(size) * 0.35, alpha * 0.9);
            }
        };
    }

    // 整行一根：长度跟着「唱到第几个字」走，最后一个字唱完后收起。
    const order = [...kit.glyphs].sort((a, b) => a.sungAt - b.sungAt);
    const first = order[0]!;
    const last = order[order.length - 1]!;
    const pad = kit.size * 0.3;
    const lineStart = placement === 'line-start';
    const lineEnd = placement === 'line-end';
    const main = kit.sprite('square');
    const echo = kit.sprite('square');
    main.tint = kit.color(0);
    echo.tint = kit.color(1);
    const length = vertical ? kit.hh * 2 : kit.hw * 2;
    const short = kit.size * 1.2;
    return time => {
        const x = kit.exit(time);
        let progress = 0;
        for (const glyph of order) {
            if (time >= glyph.sungAt) progress += clamp01((time - glyph.sungAt) / Math.max(0.08, glyph.sungEnd - glyph.sungAt));
        }
        const k = easeOutCubic(progress / order.length);
        const retract = easeInCubic((time - last.sungEnd - 0.15) / 0.35);
        const pulse = 1 + 0.5 * Math.exp(-(time - kit.lastSung(time)) / 0.15);
        const height = thick(kit.size / kit.spec.scale) * (lineStart || lineEnd ? pulse : 1.2);
        const alpha = (1 - x) * (time >= first.sungAt ? 1 : 0);
        if (lineStart || lineEnd) {
            // 行首 / 行尾的短横：唱到时一下下地「跳」。
            const bx = vertical ? kit.cx - short / 2 : lineStart ? kit.cx - kit.hw - pad - short : kit.cx + kit.hw + pad;
            const by = vertical ? (lineStart ? kit.cy - kit.hh - pad - short : kit.cy + kit.hh + pad) : kit.cy - short / 2;
            const grow = easeOutBack((time - first.sungAt) / 0.3, 2);
            bar(main, vertical ? kit.cx : bx, vertical ? by : kit.cy, short, retract, grow, height, alpha);
            echo.visible = false;
            return;
        }
        const bx = vertical ? kit.cx + kit.hw + pad : kit.cx - kit.hw;
        const by = vertical ? kit.cy - kit.hh : kit.cy + kit.hh + pad;
        bar(main, bx, by, length, retract, k, height, alpha);
        bar(echo, bx + (vertical ? height * 1.6 : 0), by + (vertical ? 0 : height * 1.6), length, retract, Math.max(0, k - 0.04), height * 0.35, alpha * 0.9);
    };
};

// ─── dots-line：沿文字方向的点线，逐点亮起 ───────────────────────────────
export const dotsLineOrnament: OrnamentBuilder = kit => {
    const placement = kit.spec.placement;
    const vertical = kit.vertical;
    const spacing = kit.size * 0.3;
    interface LineDot { sprite: Sprite; x: number; y: number; glyph: GlyphInfo | null; order: number; litAt: number; size: number }
    const dots: LineDot[] = [];
    const litOf = (along: number) => {
        // 字的位置投到这条线上：最近的那个字被唱到时，这颗点跟着亮。
        let best = Number.POSITIVE_INFINITY;
        let at = kit.start + 0.6;
        for (const glyph of kit.glyphs) {
            const d = Math.abs((vertical ? glyph.y : glyph.x) - along);
            if (d < best) {
                best = d;
                at = glyph.sungAt;
            }
        }
        return at;
    };
    const push = (x: number, y: number, order: number, litAt: number, size: number, glyph: GlyphInfo | null = null) => {
        const sprite = kit.sprite('dot');
        sprite.tint = kit.color(dots.length);
        dots.push({ sprite, x, y, glyph, order, litAt, size });
    };
    const pad = kit.size * 0.45;
    const lineAlong = (fromX: number, fromY: number, dx: number, dy: number, length: number, fade: boolean) => {
        const n = Math.max(3, Math.min(kit.count(48, 8), Math.round(length / spacing)));
        for (let i = 0; i < n; i += 1) {
            const s = n === 1 ? 0 : i / (n - 1);
            const x = fromX + dx * s * length;
            const y = fromY + dy * s * length;
            push(x, y, s, litOf(vertical ? y : x), kit.size * (fade ? 0.14 * (1 - s * 0.7) : 0.12));
        }
    };
    if (placement === 'glyphs') {
        kit.glyphs.forEach((glyph, i) => push(
            vertical ? glyph.size * 0.62 : 0, vertical ? 0 : glyph.size * 0.62,
            i / Math.max(1, kit.glyphs.length - 1), glyph.sungAt, kit.size * 0.16, glyph,
        ));
    } else if (placement === 'line-start' || placement === 'line-end') {
        const sign = placement === 'line-start' ? -1 : 1;
        const length = kit.size * 3;
        if (vertical) lineAlong(kit.cx, kit.cy + sign * (kit.hh + pad), 0, sign, length, true);
        else lineAlong(kit.cx + sign * (kit.hw + pad), kit.cy, sign, 0, length, true);
    } else if (placement === 'screen') {
        const w = kit.ctx.width * 0.5;
        if (vertical) lineAlong(kit.cx + kit.hw + pad * 2, -kit.ctx.height * 0.5, 0, 1, kit.ctx.height, false);
        else lineAlong(-w, kit.cy + kit.hh + pad * 1.8, 1, 0, w * 2, false);
    } else if (placement === 'corners') {
        const arm = kit.size * 1.5;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            const x0 = kit.cx + sx * (kit.hw + pad);
            const y0 = kit.cy + sy * (kit.hh + pad);
            lineAlong(x0, y0, -sx, 0, arm, true);
            lineAlong(x0, y0, 0, -sy, arm * 0.7, true);
        }
    } else {
        // around / behind：字组下方一条（竖排在右侧），around 再在上方反向一条。
        if (vertical) lineAlong(kit.cx + kit.hw + pad, kit.cy - kit.hh, 0, 1, kit.hh * 2, false);
        else lineAlong(kit.cx - kit.hw, kit.cy + kit.hh + pad, 1, 0, kit.hw * 2, false);
        if (placement === 'around') {
            if (vertical) lineAlong(kit.cx - kit.hw - pad, kit.cy + kit.hh, 0, -1, kit.hh * 2, false);
            else lineAlong(kit.cx + kit.hw, kit.cy - kit.hh - pad, -1, 0, kit.hw * 2, false);
        }
    }
    const p = newPos();
    return time => {
        const anchors = kit.anchors(time);
        const x = kit.exit(time);
        const runner = fract((time - kit.start) / 2.4);
        for (const d of dots) {
            // 入场逐点出现（暗），被唱到时亮起并弹一下；退场从头逐点熄灭（阶梯）。
            const appear = time - kit.start - d.order * 0.5;
            const off = x * 1.4 - d.order * 0.4 >= 0.5;
            if (appear < 0 || off) {
                d.sprite.visible = false;
                continue;
            }
            let px = d.x;
            let py = d.y;
            let alpha = 1;
            if (d.glyph) {
                const anchor = anchors[d.glyph.index];
                px += anchor?.x ?? d.glyph.x;
                py += anchor?.y ?? d.glyph.y;
                alpha = anchor?.alpha ?? 1;
            }
            const lit = time >= d.litAt;
            const pop = lit ? 1 + 0.8 * Math.exp(-(time - d.litAt) / 0.12) : 1;
            const run = Math.max(0, 1 - Math.abs(runner - d.order) * 12);
            const size = d.size * (lit ? 1 : 0.6) * pop * easeOutBack(appear / 0.2, 2.5) * (1 + run * 0.6);
            d.sprite.visible = size > 0.3;
            d.sprite.position.set(px, py);
            d.sprite.width = size;
            d.sprite.height = size;
            d.sprite.alpha = alpha * (lit ? 1 : 0.35 + run * 0.5) * p.alpha;
        }
    };
};
