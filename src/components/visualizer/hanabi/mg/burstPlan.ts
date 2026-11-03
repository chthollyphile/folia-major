// Copyright (c) 2026 chthollyphile
import { createRng } from '../hanabiRandom';
import type { BurstEvent, BurstKind, HanabiPalette, LaunchEvent } from '../types';
import { clamp01, EMBER, GOLD, hash01, hashString, lerp, mixColor, TAU, WHITE } from './mgMath';

// src/components/visualizer/hanabi/mg/burstPlan.ts
// 烟花的解析模型（纯函数，不碰 Pixi）：一个 BurstEvent 展开成一组「星」的参数，每颗星在任意时刻的位置、亮度、颜色都由闭式解算出。
// 运动：初速度 v0、线性阻尼 k、重力（终端下落速度 vt）—— p(τ) = p0 + v0·(1−e^{−kτ})/k + vt·(τ − (1−e^{−kτ})/k)，外加蜂的螺旋项。
// 尾迹沿轨迹往回取几个时间点连成段。seek 到哪一刻结果都一样；按精灵池上限按比例抽稀（每朵花都等比例变稀）。

/** 一颗星（或分裂出来的子星）。时间是绝对秒，坐标是烟花层本地像素。 */
export interface StarPlan {
    x0: number;
    y0: number;
    vx: number;
    vy: number;
    /** 阻尼（1/s）。 */
    drag: number;
    /** 终端下落速度（px/s），重力 = fall × drag。 */
    fall: number;
    /** 点燃时刻与寿命。 */
    start: number;
    life: number;
    /** 星的直径（px）。 */
    size: number;
    color: number;
    /** 寿命的 shift 处变成 endColor（牡丹的变色）。 */
    endColor: number;
    shift: number;
    trailColor: number;
    /** 尾迹覆盖的时间长度（秒）与段数。 */
    trail: number;
    segments: number;
    /** 寿命末尾多大一段用来熄灭（0..1）。 */
    fadeTail: number;
    /** 点滅频率（Hz），0 = 不闪；strobeFrom 之后才开始闪。 */
    strobe: number;
    strobeFrom: number;
    /** 末段的随机闪烁（0..1）。 */
    twinkle: number;
    /** 金粉闪光（0..1）：冠、柳、椰的碎闪。 */
    glitter: number;
    /** 蜂的螺旋半径（px）与角速度（rad/s）。 */
    spiral: number;
    spin: number;
    phase: number;
    /** 球面背面的星暗一点（0..1）。 */
    depth: number;
    /** 抽稀次序（0..1，低差异序列）：rank < 保留比例的星才画。 */
    rank: number;
    /** 0 = 柔光点，1 = 四角星。 */
    tex: 0 | 1;
}

/** 开花瞬间（或千輪每一朵、分裂点、スターマイン每一发）的闪光。 */
export interface FlashPlan {
    x: number;
    y: number;
    at: number;
    size: number;
    color: number;
    life: number;
}

export interface BurstPlan {
    at: number;
    /** 最后一颗星熄灭的时刻（≤ at + duration）。 */
    end: number;
    stars: StarPlan[];
    flashes: FlashPlan[];
}

export interface BurstEnv {
    /** 画面短边（px）：BurstSpec.radius 以它为单位。 */
    unit: number;
    /** 粒子数倍率（tuning.sparkAmount）。 */
    amount: number;
}

const GOLDEN = 0.6180339887498949;
const GOLDEN_ANGLE = 2.399963229728653;

const sparkColor = (palette: HanabiPalette, colors: readonly number[], i: number) => {
    const sparks = palette.sparks.length > 0 ? palette.sparks : [WHITE];
    const n = sparks.length;
    const index = colors.length > 0 ? colors[((i % colors.length) + colors.length) % colors.length]! : i;
    return sparks[((Math.round(index) % n) + n) % n]!;
};

type StarInput = Partial<StarPlan> & Pick<StarPlan, 'vx' | 'vy' | 'drag' | 'life' | 'size' | 'color'>;

export const planBurst = (event: BurstEvent, palette: HanabiPalette, env: BurstEnv): BurstPlan => {
    const { spec } = event;
    const kind: BurstKind = spec.kind;
    const rng = createRng(`${event.seed}:${kind}`);
    const R = Math.max(4, spec.radius * env.unit * (event.scale || 1));
    const D = Math.max(0.2, spec.duration);
    const at = event.at;
    const n = Math.max(0, Math.round(spec.count * Math.max(0, env.amount)));
    const trailK = clamp01(spec.trail);
    const twinkleK = clamp01(spec.twinkle);
    const squash = event.squash ?? 1;
    const rotation = event.rotation ?? 0;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const c = (i: number) => sparkColor(palette, spec.colors, i);
    const stars: StarPlan[] = [];
    const flashes: FlashPlan[] = [];
    const minSize = Math.max(1.4, env.unit * 0.0022);

    const add = (input: StarInput) => {
        const delay = input.start ?? 0;
        // 所有星都在 duration 之内燃尽：寿命按剩余时间截断。
        const life = Math.min(input.life, D - delay - 0.02);
        if (life <= 0.05) return;
        stars.push({
            x0: event.x + (input.x0 ?? 0),
            y0: event.y + (input.y0 ?? 0),
            vx: input.vx,
            vy: input.vy,
            drag: input.drag,
            fall: input.fall ?? 0,
            start: at + delay,
            life,
            size: Math.max(minSize, input.size),
            color: input.color,
            endColor: input.endColor ?? input.color,
            shift: input.shift ?? 1,
            trailColor: input.trailColor ?? mixColor(input.color, EMBER, 0.3),
            trail: input.trail ?? 0,
            segments: input.trail && input.trail > 0 ? Math.max(1, input.segments ?? 3) : 0,
            fadeTail: input.fadeTail ?? 0.3,
            strobe: input.strobe ?? 0,
            strobeFrom: input.strobeFrom ?? 0,
            twinkle: input.twinkle ?? 0,
            glitter: input.glitter ?? 0,
            spiral: input.spiral ?? 0,
            spin: input.spin ?? 0,
            phase: input.phase ?? rng() * TAU,
            depth: input.depth ?? 1,
            rank: 0,
            tex: input.tex ?? 0,
        });
    };

    const flash = (x: number, y: number, delay: number, size: number, color: number, life = 0.32) => {
        if (delay >= D) return;
        flashes.push({ x: event.x + x, y: event.y + y, at: at + delay, size, color: mixColor(color, WHITE, 0.7), life: Math.min(life, D - delay) });
    };

    /** 球面上均匀的方向（斐波那契球 + 随机倾斜 + 抖动），返回投影到画面的 (x, y) 与深度 z。 */
    const tiltA = rng() * TAU;
    const tiltCos = Math.cos(tiltA);
    const tiltSin = Math.sin(tiltA);
    const sphere = (i: number, count: number, jitter = 0.25): [number, number, number] => {
        const z = 1 - (2 * (i + 0.5)) / count;
        const r = Math.sqrt(Math.max(0, 1 - z * z));
        const phi = i * GOLDEN_ANGLE + (rng() - 0.5) * jitter;
        const x = r * Math.cos(phi);
        const y0 = r * Math.sin(phi);
        return [x, y0 * tiltCos - z * tiltSin, y0 * tiltSin + z * tiltCos];
    };
    /** 平面方向 → 压扁 + 旋转（輪、型物）。 */
    const planar = (x: number, y: number): [number, number] => {
        const sy = y * squash;
        return [x * cosR - sy * sinR, x * sinR + sy * cosR];
    };
    const depthOf = (z: number) => 0.62 + 0.38 * (z + 1) / 2;
    const life = (low: number, high: number) => D * lerp(low, high, rng());

    const c0 = c(0);
    const c1 = c(1);
    const c2 = c(2);

    switch (kind) {
        case 'kiku': {
            // 菊：带尾迹的球，外层末段转白、内层一小圈「芯」。
            const core = Math.round(n * 0.2);
            const main = n - core;
            const k = 3.2;
            for (let i = 0; i < main; i += 1) {
                const [dx, dy, dz] = sphere(i, main);
                const speed = R * k * (0.94 + rng() * 0.12);
                add({
                    vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.3,
                    life: life(0.78, 0.98), size: R * 0.02, color: c0, endColor: mixColor(c0, WHITE, 0.65), shift: 0.7,
                    trail: 0.1 + trailK * 0.38, segments: 3, trailColor: mixColor(c0, EMBER, 0.3),
                    twinkle: twinkleK, depth: depthOf(dz),
                });
            }
            for (let i = 0; i < core; i += 1) {
                const [dx, dy, dz] = sphere(i, core);
                const speed = R * 3.6 * 0.42 * (0.95 + rng() * 0.1);
                add({
                    vx: dx * speed, vy: dy * speed, drag: 3.6, fall: R * 0.2,
                    life: life(0.4, 0.55), size: R * 0.017, color: c1, trail: 0.04 + trailK * 0.08, segments: 1,
                    fadeTail: 0.2, depth: depthOf(dz),
                });
            }
            flash(0, 0, 0, R * 1.1, c0, 0.36);
            break;
        }
        case 'botan': {
            // 牡丹：没有尾迹的饱满大色点，半程变色，干脆地熄灭；芯换第三色。
            const core = Math.round(n * 0.22);
            const main = n - core;
            const k = 3.6;
            for (let i = 0; i < main; i += 1) {
                const [dx, dy, dz] = sphere(i, main, 0.12);
                const speed = R * k * (0.97 + rng() * 0.06);
                add({
                    vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.24,
                    life: life(0.85, 0.97), size: R * 0.034, color: c0, endColor: c1, shift: 0.48,
                    fadeTail: 0.12, twinkle: twinkleK * 0.6, depth: depthOf(dz),
                });
            }
            for (let i = 0; i < core; i += 1) {
                const [dx, dy, dz] = sphere(i, core, 0.12);
                const speed = R * k * 0.5;
                add({
                    vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.2,
                    life: life(0.6, 0.72), size: R * 0.03, color: c2, endColor: mixColor(c2, WHITE, 0.5), shift: 0.55,
                    fadeTail: 0.12, depth: depthOf(dz),
                });
            }
            flash(0, 0, 0, R * 1.2, c0, 0.3);
            break;
        }
        case 'yanagi': {
            // 柳：初速小、重力大，长长的金色尾迹一路垂下来，末段碎闪。
            const k = 2.5;
            const gold = mixColor(c0, GOLD, 0.6);
            for (let i = 0; i < n; i += 1) {
                const [dx, dy, dz] = sphere(i, n, 0.4);
                const speed = R * k * 0.72 * (0.9 + rng() * 0.2);
                add({
                    vx: dx * speed, vy: dy * speed - R * 0.25, drag: k, fall: R * 0.95,
                    life: life(0.88, 0.99), size: R * 0.013, color: gold, endColor: mixColor(gold, EMBER, 0.6), shift: 0.6,
                    trail: 0.35 + trailK * 0.95, segments: 4, trailColor: mixColor(gold, EMBER, 0.35),
                    fadeTail: 0.45, glitter: 0.25 + twinkleK * 0.5, depth: depthOf(dz) * 0.9,
                });
            }
            flash(0, 0, 0, R * 0.8, gold, 0.3);
            break;
        }
        case 'kamuro': {
            // 冠：金色、又大又密，像一把慢慢垂下的伞，全程金粉碎闪，最后一点点暗下去。
            const k = 3.0;
            const gold = mixColor(c0, GOLD, 0.78);
            for (let i = 0; i < n; i += 1) {
                const [dx, dy, dz] = sphere(i, n, 0.2);
                const speed = R * k * 1.05 * (0.95 + rng() * 0.1);
                add({
                    vx: dx * speed, vy: dy * speed - R * 0.12, drag: k, fall: R * 0.55,
                    life: life(0.9, 0.99), size: R * 0.017, color: gold, endColor: mixColor(gold, EMBER, 0.5), shift: 0.55,
                    trail: 0.45 + trailK * 0.8, segments: 4, trailColor: mixColor(gold, EMBER, 0.25),
                    fadeTail: 0.5, glitter: 0.55 + twinkleK * 0.45, depth: depthOf(dz),
                });
            }
            flash(0, 0, 0, R * 1.3, gold, 0.42);
            break;
        }
        case 'senrin': {
            // 千輪：一群小花在大半径里依次开，每朵自己的颜色与闪光。
            const flowers = Math.max(4, Math.min(10, Math.round(n / 14)));
            const per = Math.max(6, Math.round(n / flowers));
            const k = 4.4;
            for (let f = 0; f < flowers; f += 1) {
                const angle = f * GOLDEN_ANGLE + rng() * 0.6;
                const dist = R * 0.78 * Math.sqrt((f + 0.5) / flowers);
                const ox = Math.cos(angle) * dist;
                const oy = Math.sin(angle) * dist;
                const delay = 0.06 + (f / flowers) * D * 0.42 + rng() * 0.05;
                const r = R * (0.2 + rng() * 0.08);
                const color = c(f);
                for (let i = 0; i < per; i += 1) {
                    const [dx, dy, dz] = sphere(i, per, 0.3);
                    const speed = r * k * (0.92 + rng() * 0.16);
                    add({
                        x0: ox, y0: oy, start: delay, vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.16,
                        life: D * (0.32 + rng() * 0.12), size: R * 0.017, color, endColor: mixColor(color, WHITE, 0.6), shift: 0.65,
                        trail: trailK * 0.08, segments: 1, fadeTail: 0.25, twinkle: 0.3 + twinkleK * 0.7, depth: depthOf(dz),
                    });
                }
                flash(ox, oy, delay, r * 1.4, color, 0.22);
            }
            break;
        }
        case 'ring': {
            // 輪：一个平面圆环（按 squash / rotation 倾斜成椭圆），内侧第二圈，中心几颗芯。
            const k = 3.4;
            const outer = Math.round(n * 0.7);
            const inner = Math.round(n * 0.2);
            const core = n - outer - inner;
            const ringOf = (count: number, reach: number, color: number, size: number, lifeLow: number) => {
                for (let i = 0; i < count; i += 1) {
                    const [dx, dy] = planar(Math.cos((TAU * i) / count), Math.sin((TAU * i) / count));
                    const speed = R * k * reach * (0.99 + rng() * 0.02);
                    add({
                        vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.18,
                        life: life(lifeLow, lifeLow + 0.12), size, color, endColor: mixColor(color, WHITE, 0.5), shift: 0.75,
                        trail: 0.05 + trailK * 0.2, segments: 2, twinkle: twinkleK,
                    });
                }
            };
            ringOf(outer, 1, c0, R * 0.022, 0.85);
            ringOf(inner, 0.58, c1, R * 0.018, 0.7);
            for (let i = 0; i < core; i += 1) {
                const [dx, dy, dz] = sphere(i, Math.max(1, core));
                const speed = R * k * 0.18;
                add({ vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.15, life: life(0.45, 0.6), size: R * 0.02, color: c2, depth: depthOf(dz) });
            }
            flash(0, 0, 0, R * 0.9, c0, 0.3);
            break;
        }
        case 'heart':
        case 'star': {
            // 型物：方向按轮廓给，所有星阻尼相同，所以形状整体放大；重力很小、寿命短，形状散开前就熄灭。
            const k = 3.4;
            const outline = Math.max(12, Math.round(n * 0.88));
            for (let i = 0; i < outline; i += 1) {
                const u = i / outline;
                let x: number;
                let y: number;
                if (kind === 'heart') {
                    const t = u * TAU;
                    x = (16 * Math.sin(t) ** 3) / 17;
                    y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
                } else {
                    // 五角星：外顶点 1、内顶点 0.4，沿十条边均匀取点。
                    const edge = u * 10;
                    const e = Math.floor(edge);
                    const f = edge - e;
                    const vertex = (index: number) => {
                        const radius = index % 2 === 0 ? 1 : 0.4;
                        const a = -Math.PI / 2 + (index * Math.PI) / 5;
                        return [Math.cos(a) * radius, Math.sin(a) * radius] as const;
                    };
                    const [ax, ay] = vertex(e);
                    const [bx, by] = vertex(e + 1);
                    x = lerp(ax, bx, f);
                    y = lerp(ay, by, f);
                }
                const [dx, dy] = planar(x, y);
                const speed = R * k * (0.99 + rng() * 0.02);
                add({
                    vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.1,
                    life: life(0.8, 0.92), size: R * 0.024, color: c0, endColor: mixColor(c0, WHITE, 0.55), shift: 0.7,
                    trail: 0.04 + trailK * 0.1, segments: 1, fadeTail: 0.25, twinkle: twinkleK,
                });
            }
            const core = n - outline;
            for (let i = 0; i < core; i += 1) {
                const [dx, dy, dz] = sphere(i, Math.max(1, core));
                const speed = R * k * 0.15;
                add({ vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.1, life: life(0.4, 0.55), size: R * 0.018, color: c1, depth: depthOf(dz) });
            }
            flash(0, 0, 0, R * 0.8, c0, 0.28);
            break;
        }
        case 'palm': {
            // 椰：少量粗枝向外冲出再弯垂，每枝后面跟几颗碎金，像棕榈叶。
            const branches = Math.max(6, Math.min(14, Math.round(n / 9)));
            const crumbs = Math.max(0, Math.min(6, Math.floor((n - branches) / branches)));
            const k = 2.3;
            const gold = mixColor(c0, GOLD, 0.45);
            for (let b = 0; b < branches; b += 1) {
                const angle = (TAU * b) / branches + (rng() - 0.5) * 0.35;
                // 枝略朝上：上半圈的枝长一点，整体像一棵树冠。
                const up = -Math.sin(angle);
                const reach = 1 + up * 0.15 + (rng() - 0.5) * 0.1;
                const dx = Math.cos(angle);
                const dy = Math.sin(angle);
                const speed = R * k * reach;
                add({
                    vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.7,
                    life: life(0.88, 0.98), size: R * 0.05, color: gold, endColor: mixColor(gold, EMBER, 0.55), shift: 0.55,
                    trail: 0.4 + trailK * 0.55, segments: 5, trailColor: mixColor(gold, EMBER, 0.3),
                    fadeTail: 0.4, glitter: 0.3 + twinkleK * 0.4,
                });
                for (let j = 0; j < crumbs; j += 1) {
                    const f = 0.9 - j * 0.1;
                    add({
                        vx: dx * speed * f + (rng() - 0.5) * R * 0.3, vy: dy * speed * f + (rng() - 0.5) * R * 0.3, drag: k, fall: R * 0.75,
                        life: life(0.55, 0.85), size: R * 0.014, color: mixColor(gold, WHITE, 0.3), trail: 0.08, segments: 1,
                        fadeTail: 0.5, glitter: 0.8,
                    });
                }
            }
            flash(0, 0, 0, R * 1.0, gold, 0.4);
            break;
        }
        case 'crossette': {
            // 分裂：母星飞出一段后「啪」地十字分裂成四颗子星，子星换色。
            const parents = Math.max(6, Math.min(16, Math.round(n / 5)));
            const k = 2.8;
            const kc = 3.4;
            const fall = R * 0.32;
            for (let p = 0; p < parents; p += 1) {
                const angle = (TAU * p) / parents + (rng() - 0.5) * 0.4;
                const speed = R * k * 0.72 * (0.9 + rng() * 0.2);
                const vx = Math.cos(angle) * speed;
                const vy = Math.sin(angle) * speed;
                const split = D * (0.28 + rng() * 0.08);
                add({
                    vx, vy, drag: k, fall, life: split, size: R * 0.024, color: c0,
                    trail: 0.08 + trailK * 0.2, segments: 2, fadeTail: 0.05,
                });
                // 分裂点与那一刻的速度（闭式解），子星从这里接着飞。
                const e = Math.exp(-k * split);
                const f = (1 - e) / k;
                const sx = vx * f;
                const sy = vy * f + fall * (split - f);
                const svx = vx * e;
                const svy = (vy - fall) * e + fall;
                const turn = angle + Math.PI / 4 + (rng() - 0.5) * 0.3;
                for (let q = 0; q < 4; q += 1) {
                    const a = turn + (q * Math.PI) / 2;
                    const cs = R * kc * 0.36;
                    add({
                        x0: sx, y0: sy, start: split, vx: svx * 0.35 + Math.cos(a) * cs, vy: svy * 0.35 + Math.sin(a) * cs,
                        drag: kc, fall: R * 0.38, life: D * (0.45 + rng() * 0.12), size: R * 0.018, color: c1,
                        endColor: mixColor(c1, WHITE, 0.5), shift: 0.7, trail: 0.06 + trailK * 0.18, segments: 2, twinkle: twinkleK,
                    });
                }
                flash(sx, sy, split, R * 0.2, c1, 0.16);
            }
            flash(0, 0, 0, R * 0.8, c0, 0.3);
            break;
        }
        case 'strobe': {
            // 点滅：星几乎悬停，开花后不久开始按各自相位一亮一灭。
            const k = 4;
            const white = mixColor(c0, WHITE, 0.55);
            for (let i = 0; i < n; i += 1) {
                const [dx, dy, dz] = sphere(i, n, 0.6);
                const speed = R * k * 0.88 * (0.8 + rng() * 0.3);
                add({
                    vx: dx * speed, vy: dy * speed, drag: k, fall: R * 0.12,
                    life: life(0.85, 0.99), size: R * 0.028, color: white, endColor: c(i), shift: 0.25,
                    strobe: 7 + rng() * 7, strobeFrom: 0.3 + rng() * 0.25, fadeTail: 0.15, depth: depthOf(dz), tex: rng() < 0.3 ? 1 : 0,
                });
            }
            flash(0, 0, 0, R * 0.9, white, 0.3);
            break;
        }
        case 'hachi': {
            // 蜂：银白色小火花各自绕螺旋乱飞，发出「嗡」的一团。
            const k = 2.5;
            const silver = mixColor(c0, WHITE, 0.7);
            for (let i = 0; i < n; i += 1) {
                const angle = rng() * TAU;
                const speed = R * k * (0.3 + rng() * 0.6);
                add({
                    vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, drag: k, fall: R * 0.25,
                    life: life(0.5, 0.98), size: R * 0.013, color: silver, endColor: c(i), shift: 0.6,
                    trail: 0.08 + trailK * 0.14, segments: 2, trailColor: mixColor(silver, EMBER, 0.3),
                    spiral: R * (0.05 + rng() * 0.11), spin: (rng() < 0.5 ? -1 : 1) * (9 + rng() * 12),
                    twinkle: 0.4 + twinkleK * 0.6, fadeTail: 0.3,
                });
            }
            flash(0, 0, 0, R * 0.6, silver, 0.24);
            break;
        }
        case 'willow-ring': {
            // 双层：内层是（可倾斜的）平面牡丹环，外层是垂下的金柳。
            const inner = Math.round(n * 0.35);
            const outer = n - inner;
            const gold = mixColor(c1, GOLD, 0.7);
            for (let i = 0; i < inner; i += 1) {
                const [dx, dy] = planar(Math.cos((TAU * i) / inner), Math.sin((TAU * i) / inner));
                const speed = R * 3.6 * 0.46;
                add({
                    vx: dx * speed, vy: dy * speed, drag: 3.6, fall: R * 0.15,
                    life: life(0.45, 0.55), size: R * 0.03, color: c0, endColor: mixColor(c0, WHITE, 0.5), shift: 0.6, fadeTail: 0.1,
                });
            }
            for (let i = 0; i < outer; i += 1) {
                const [dx, dy, dz] = sphere(i, outer, 0.4);
                const speed = R * 2.6 * (0.92 + rng() * 0.12);
                add({
                    vx: dx * speed, vy: dy * speed - R * 0.2, drag: 2.6, fall: R * 0.9,
                    life: life(0.88, 0.99), size: R * 0.013, color: gold, endColor: mixColor(gold, EMBER, 0.6), shift: 0.6,
                    trail: 0.35 + trailK * 0.9, segments: 4, trailColor: mixColor(gold, EMBER, 0.3),
                    fadeTail: 0.45, glitter: 0.3 + twinkleK * 0.4, depth: depthOf(dz) * 0.9,
                });
            }
            flash(0, 0, 0, R * 1.0, c0, 0.34);
            break;
        }
        case 'mine': {
            // スターマイン：从事件点往上扇形连发几轮，每轮换色、扇面左右摆。
            const volleys = Math.max(4, Math.min(8, Math.round(D * 2.6)));
            const per = Math.max(4, Math.round(n / volleys));
            const k = 1.7;
            for (let v = 0; v < volleys; v += 1) {
                const delay = (v / volleys) * D * 0.55;
                const lean = (v % 2 === 0 ? -1 : 1) * (0.12 + rng() * 0.2);
                const color = c(v);
                const lifeV = Math.min(0.9 + rng() * 0.5, D * 0.6);
                for (let i = 0; i < per; i += 1) {
                    const angle = -Math.PI / 2 + lean + ((i + 0.5) / per - 0.5) * 1.3 + (rng() - 0.5) * 0.12;
                    const speed = R * k * (1.45 + rng() * 0.45);
                    add({
                        start: delay, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, drag: k, fall: R * 0.9,
                        life: lifeV * (0.8 + rng() * 0.2), size: R * 0.02, color, endColor: mixColor(color, WHITE, 0.6), shift: 0.7,
                        trail: 0.1 + trailK * 0.3, segments: 3, fadeTail: 0.3, twinkle: twinkleK,
                    });
                }
                flash(0, 0, delay, R * 0.35, color, 0.18);
            }
            break;
        }
        default: {
            const never: never = kind;
            return never;
        }
    }

    for (let i = 0; i < stars.length; i += 1) stars[i]!.rank = ((i + 1) * GOLDEN) % 1;
    let end = at;
    for (const star of stars) end = Math.max(end, star.start + star.life);
    for (const item of flashes) end = Math.max(end, item.at + item.life);
    return { at, end, stars, flashes };
};

// ─── 闭式求值 ───────────────────────────────────────────────────────────

export interface Point {
    x: number;
    y: number;
}

/** 星点燃后 tau 秒的位置（写进 out，不分配）。 */
export const starPosition = (star: StarPlan, tau: number, out: Point): Point => {
    const t = tau < 0 ? 0 : tau;
    const e = Math.exp(-star.drag * t);
    const f = (1 - e) / star.drag;
    let x = star.x0 + star.vx * f;
    let y = star.y0 + star.vy * f + star.fall * (t - f);
    if (star.spiral > 0) {
        const r = star.spiral * (1 - Math.exp(-3 * t));
        const a = star.phase + star.spin * t;
        x += r * Math.cos(a);
        y += r * Math.sin(a);
    }
    out.x = x;
    out.y = y;
    return out;
};

/** 不含点滅的亮度（尾迹用）：点燃、背面变暗、末段熄灭。 */
const starBase = (star: StarPlan, tau: number) => {
    if (tau < 0 || tau > star.life) return 0;
    const u = tau / star.life;
    let b = star.depth * clamp01(tau / 0.035);
    if (u > 1 - star.fadeTail) {
        const k = (1 - u) / star.fadeTail;
        b *= k * k * (3 - 2 * k);
    }
    return b;
};

/** 星在 tau 时的亮度（0..1，超出寿命为 0）。 */
export const starBrightness = (star: StarPlan, tau: number) => {
    let b = starBase(star, tau);
    if (b <= 0) return 0;
    if (star.strobe > 0 && tau > star.strobeFrom) {
        const on = ((tau * star.strobe + star.phase) % 1) < 0.42;
        b *= on ? 1 : 0.05;
    }
    const u = tau / star.life;
    if (star.twinkle > 0 && u > 0.5) {
        const n = hash01(Math.floor(tau * 24), star.phase * 97);
        b *= 1 - star.twinkle * clamp01((u - 0.5) / 0.2) * (n < 0.45 ? 0.85 : 0);
    }
    return b;
};

/** 星在 tau 时的颜色：变色 + 金粉碎闪时偏白。 */
export const starColor = (star: StarPlan, tau: number) => {
    const u = tau / star.life;
    let color = star.shift < 1 ? mixColor(star.color, star.endColor, (u - star.shift) / 0.1) : star.color;
    if (star.glitter > 0 && hash01(Math.floor(tau * 30), star.phase * 53) < star.glitter * 0.35) color = mixColor(color, WHITE, 0.75);
    return color;
};

/** 星在 tau 时的直径：随燃烧变小，金粉闪一下时变大。 */
export const starSize = (star: StarPlan, tau: number) => {
    const u = clamp01(tau / star.life);
    let size = star.size * (1 - 0.45 * u);
    if (star.glitter > 0 && hash01(Math.floor(tau * 30), star.phase * 53) < star.glitter * 0.35) size *= 1.6;
    return size;
};

export const burstActive = (plan: BurstPlan, time: number) => time >= plan.at && time <= plan.end;

// ─── 画一帧（访问者，不分配） ────────────────────────────────────────────

/** 精灵种类：柔光点、实心点、四角星、拖尾段、闪光（加色混合）。 */
export type SparkTexture = 'glow' | 'dot' | 'star4' | 'streak' | 'flash';

/**
 * 发一个精灵：中心 (x, y)、宽高、旋转、不透明度、颜色。返回 false = 池已满。
 * streak 的纹理是竖向的（上亮下暗）：rotation 让它的「上」朝向星头。
 */
export type SparkEmit = (texture: SparkTexture, x: number, y: number, width: number, height: number, rotation: number, alpha: number, tint: number) => boolean;

const scratchA: Point = { x: 0, y: 0 };
const scratchB: Point = { x: 0, y: 0 };

/** 一段拖尾：从 a（新）到 b（旧）。 */
const emitSegment = (emit: SparkEmit, a: Point, b: Point, thickness: number, alpha: number, tint: number) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.6 || alpha < 0.01) return true;
    // 纹理的「上」是 −y：旋转后指向 a。
    const rotation = Math.atan2(dy, dx) + Math.PI / 2;
    return emit('streak', (a.x + b.x) / 2, (a.y + b.y) / 2, thickness, length + thickness * 0.5, rotation, alpha, tint);
};

/** 某一时刻这批烟花一共要多少个精灵（不抽稀时）。 */
export const burstDemand = (plans: readonly BurstPlan[], time: number) => {
    let stars = 0;
    let flashes = 0;
    for (const plan of plans) {
        if (!burstActive(plan, time)) continue;
        for (const item of plan.flashes) if (time >= item.at && time < item.at + item.life) flashes += 2;
        for (const star of plan.stars) {
            const tau = time - star.start;
            if (tau >= 0 && tau <= star.life) stars += 1 + star.segments;
        }
    }
    return { stars, flashes };
};

/** 画出 time 时刻的所有星与闪光。超出 budget 时按 rank 等比例抽稀每一朵。返回用掉的精灵数。 */
export const drawBursts = (plans: readonly BurstPlan[], time: number, budget: number, emit: SparkEmit) => {
    const demand = burstDemand(plans, time);
    if (demand.stars + demand.flashes === 0 || budget <= 0) return 0;
    const keep = demand.stars + demand.flashes <= budget
        ? 2
        : Math.max(0, (budget - demand.flashes) * 0.97) / Math.max(1, demand.stars);
    let used = 0;
    const put: SparkEmit = (texture, x, y, w, h, r, a, tint) => {
        if (used >= budget) return false;
        if (!emit(texture, x, y, w, h, r, a, tint)) return false;
        used += 1;
        return true;
    };
    for (const plan of plans) {
        if (!burstActive(plan, time)) continue;
        for (const item of plan.flashes) {
            const age = time - item.at;
            if (age < 0 || age >= item.life) continue;
            const k = age / item.life;
            const alpha = clamp01(age / 0.02) * (1 - k) ** 2;
            const halo = item.size * (0.55 + 0.6 * Math.sqrt(k));
            if (!put('flash', item.x, item.y, halo, halo, 0, alpha * 0.55, item.color)) return used;
            const core = item.size * 0.35 * (1 - k * 0.6);
            if (!put('flash', item.x, item.y, core, core, 0, alpha, WHITE)) return used;
        }
    }
    for (const plan of plans) {
        if (!burstActive(plan, time)) continue;
        for (const star of plan.stars) {
            const tau = time - star.start;
            if (tau < 0 || tau > star.life || star.rank >= keep) continue;
            const base = starBase(star, tau);
            if (base <= 0) continue;
            const head = starPosition(star, tau, scratchA);
            const hx = head.x;
            const hy = head.y;
            const size = starSize(star, tau);
            if (star.segments > 0) {
                const step = star.trail / star.segments;
                let prevX = hx;
                let prevY = hy;
                for (let j = 1; j <= star.segments; j += 1) {
                    const back = Math.max(0, tau - step * j);
                    const old = starPosition(star, back, scratchB);
                    const fade = (1 - (j - 1) / star.segments) ** 1.3;
                    const thickness = Math.max(1.2, size * 0.75 * (1 - 0.45 * (j / star.segments)));
                    scratchA.x = prevX;
                    scratchA.y = prevY;
                    if (!emitSegment(put, scratchA, old, thickness, base * fade * 0.95, star.trailColor)) return used;
                    prevX = old.x;
                    prevY = old.y;
                    if (back <= 0) break;
                }
            }
            const alpha = starBrightness(star, tau);
            if (alpha < 0.01) continue;
            const tint = starColor(star, tau);
            const drawn = star.tex === 1 ? size * 3.4 : size * 3.4;
            if (!put(star.tex === 1 ? 'star4' : 'glow', hx, hy, drawn, drawn, star.phase, alpha, tint)) return used;
        }
    }
    return used;
};

// ─── 升空尾迹 ───────────────────────────────────────────────────────────

/** 尾部掉下的火星寿命（秒）与发射间隔。 */
export const LAUNCH_EMBER_LIFE = 0.6;
const LAUNCH_EMBER_STEP = 0.032;
const LAUNCH_TRAIL_SEGMENTS = 5;

/** 升空尾迹结束（最后一颗火星熄灭）的时刻。 */
export const launchEnd = (launch: LaunchEvent) => launch.at + launch.duration + LAUNCH_EMBER_LIFE;

/** 弹头在进度 p（0..1）处的位置：减速上升（到顶速度为 0），左右摇曳、越到顶越稳。 */
export const launchHead = (launch: LaunchEvent, p: number, salt: number, out: Point): Point => {
    const k = clamp01(p);
    const rise = 1 - (1 - k) ** 2;
    const span = Math.hypot(launch.toX - launch.fromX, launch.toY - launch.fromY);
    const freq = 2.2 + hash01(1, salt) * 1.6;
    const phase = hash01(2, salt) * TAU;
    const sway = Math.sin(k * freq * TAU + phase) * span * 0.018 * (1 - k * 0.7);
    out.x = lerp(launch.fromX, launch.toX, rise) + sway;
    out.y = lerp(launch.fromY, launch.toY, rise);
    return out;
};

/** 画一条升空尾迹：弹头（光点 + 白芯）、往回的拖尾段、一路掉下的火星。unit = 画面短边。 */
export const drawLaunch = (launch: LaunchEvent, time: number, unit: number, emit: SparkEmit) => {
    const age = time - launch.at;
    if (age < 0 || time > launchEnd(launch)) return true;
    const salt = hashString(launch.seed) % 100000;
    const duration = Math.max(0.05, launch.duration);
    const color = launch.color;
    const ember = mixColor(color, GOLD, 0.55);
    const size = unit * 0.009;
    // 火星：固定时间间隔从弹头处掉出，各自按阻尼 + 重力的闭式解下落。
    const firstJ = Math.max(0, Math.ceil((age - LAUNCH_EMBER_LIFE) / LAUNCH_EMBER_STEP));
    const lastJ = Math.floor(Math.min(age, duration) / LAUNCH_EMBER_STEP);
    for (let j = firstJ; j <= lastJ; j += 1) {
        const born = j * LAUNCH_EMBER_STEP;
        const tau = age - born;
        if (tau < 0 || tau > LAUNCH_EMBER_LIFE) continue;
        const from = launchHead(launch, born / duration, salt, scratchB);
        const vx = (hash01(j * 3 + 1, salt) - 0.5) * unit * 0.12;
        const vy = (hash01(j * 3 + 2, salt) - 0.2) * unit * 0.05;
        const drag = 2.4;
        const fall = unit * 0.09;
        const e = Math.exp(-drag * tau);
        const f = (1 - e) / drag;
        const x = from.x + vx * f;
        const y = from.y + vy * f + fall * (tau - f);
        const k = tau / LAUNCH_EMBER_LIFE;
        const flicker = hash01(j * 7 + Math.floor(tau * 20), salt) < 0.3 ? 0.4 : 1;
        const alpha = (1 - k) ** 1.5 * flicker * 0.85;
        const s = size * (0.35 + hash01(j * 5, salt) * 0.35) * (1 - k * 0.5);
        if (!emit('glow', x, y, s * 2.6, s * 2.6, 0, alpha, ember)) return false;
    }
    if (age > duration) return true;
    const p = age / duration;
    const head = launchHead(launch, p, salt, scratchA);
    const hx = head.x;
    const hy = head.y;
    // 拖尾：往回五段（约 0.35 秒的轨迹），越旧越暗越细。
    let prevX = hx;
    let prevY = hy;
    for (let j = 1; j <= LAUNCH_TRAIL_SEGMENTS; j += 1) {
        const old = launchHead(launch, Math.max(0, p - (0.07 * j) / duration), salt, scratchB);
        const fade = 1 - (j - 1) / LAUNCH_TRAIL_SEGMENTS;
        scratchA.x = prevX;
        scratchA.y = prevY;
        if (!emitSegment(emit, scratchA, old, Math.max(1, size * 0.9 * fade), 0.8 * fade, mixColor(color, EMBER, 0.3))) return false;
        prevX = old.x;
        prevY = old.y;
    }
    const pulse = 0.85 + 0.15 * Math.sin(age * 40 + salt);
    // 快到顶时弹头变暗（减速、准备开花）。
    const dim = 1 - 0.35 * clamp01((p - 0.8) / 0.2);
    if (!emit('glow', hx, hy, size * 4.2 * pulse, size * 4.2 * pulse, 0, 0.9 * dim, color)) return false;
    return emit('dot', hx, hy, size * 0.9, size * 0.9, 0, dim, mixColor(color, WHITE, 0.8));
};

/** 某一时刻升空尾迹要多少精灵（上限估计）。 */
export const launchDemand = (launch: LaunchEvent, time: number) => {
    const age = time - launch.at;
    if (age < 0 || time > launchEnd(launch)) return 0;
    const embers = Math.floor(Math.min(age, LAUNCH_EMBER_LIFE) / LAUNCH_EMBER_STEP) + 1;
    return embers + (age <= launch.duration ? LAUNCH_TRAIL_SEGMENTS + 2 : 0);
};
