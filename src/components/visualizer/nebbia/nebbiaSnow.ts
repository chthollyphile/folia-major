import { segDist, type NebbiaSegments } from './nebbiaSegments';
import { buildFlakeKind, FLAKE_FILL, FLAKE_R, FLAKE_SPRITE, FLAKE_STAGES, type FlakeKind } from './nebbiaSnowFlakes';
import { NebbiaSnowWater, type WaterDrop } from './nebbiaSnowWater';
import type { NebbiaTuning } from './types';

// src/components/visualizer/nebbia/nebbiaSnow.ts
// 雪窗（tuning.glass = 'snow'）：雪花很轻，被风吹着从四面八方飘过来（方向、弯度、飘晃各片不同，车速只带一点往后偏），越近越慢，轻轻贴上玻璃粘住；粘一会儿开始化，细枝、薄边先没，
// 化出来的水从最厚的几处渗出来，在原地长成几颗钉住的水珠（nebbiaSnowWater.ts），化完放开，照 raindrop-fx 的物理走。
// 和歌词的水联动：写字的笔尖、抹字的手指、从笔画往下淌的水珠扫过时，雪当帧化开、连同那里的水珠一起被吸走（当作并进了歌词的水，水量不另算）；
// 写好的笔画边上不另积雪水（挨着的雪水被笔画吸走）。落在水上的雪（雪化的水珠、还挂着水珠的笔画、往下淌的水珠、笔尖）
// 一沾水就化，QUICK_MELT 秒化完，水并进那里的水。慢慢显现的字没有手指、不带水珠，雪不受影响。雪花画在叠在 WebGL 画布上面的一张 2D 画布上（预先画好的阶段贴图，相邻两张交叉淡入淡出）。

/** 一段线：5 个数 x0、y0、x1、y1、宽（CSS 像素）。扫过的（sweeps）和写好的笔画（wet）都是这个格式，nebbiaInk.ts / nebbiaMask.ts 收。 */
export const PEN_FLOATS = 5;

interface Flake {
    x: number; y: number; r: number; rot: number; spin: number; kind: FlakeKind;
    age: number; hold: number; dur: number; melt: number;
    /** 飘过来：用 app 秒，从落点偏 (ox, oy) 处出发，路线往一侧弯 curl，飘晃频率 ff、幅度 fa、相位 fp。 */
    app: number; ox: number; oy: number; curl: number; ff: number; fa: number; fp: number;
    /** 已经化出来的水（质量）；还在化的雪底下钉住的水珠，每处疙瘩一颗。 */
    water: number; drops: (WaterDrop | null)[] | null;
    /** 落在水上：水已经并进去了，雪只是很快化没。 */
    quick: boolean;
}

const KINDS = 12;
/** 落在水上的雪几秒化完。 */
const QUICK_MELT = 0.25;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
/** 还没飘到焦点上那圈糊光：预先画好一张，画的时候按大小、透明度贴（不用每帧每片新建渐变）。 */
const HALO = 32;
const haloSprite = () => {
    const c = document.createElement('canvas'), x = c.getContext('2d');
    c.width = c.height = HALO;
    if (x?.createRadialGradient) {
        const g = x.createRadialGradient(HALO / 2, HALO / 2, 0, HALO / 2, HALO / 2, HALO / 2);
        g.addColorStop(0, 'rgba(235,242,255,1)'); g.addColorStop(1, 'rgba(235,242,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, HALO, HALO);
    }
    return c;
};

export class NebbiaSnow {
    private readonly canvas = document.createElement('canvas');
    private readonly ctx = this.canvas.getContext('2d')!;
    private readonly kinds: FlakeKind[] = Array.from({ length: KINDS }, buildFlakeKind);
    private readonly water = new NebbiaSnowWater();
    private readonly halo = haloSprite();
    private flakes: Flake[] = [];
    private spawnAcc = 0;
    private W = 0; private H = 0; private k = 1; private dpr = 1;

    constructor(host: HTMLElement) {
        this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
        host.appendChild(this.canvas);
    }

    /** 尺寸真变了才清空玻璃上的雪和水；只换像素比（渲染倍数）时只重设画布。 */
    resize(W: number, H: number, dpr: number) {
        const same = W === this.W && H === this.H;
        this.W = W; this.H = H; this.k = H / 1000; this.dpr = dpr;
        this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
        if (same) return;
        this.water.resize(W, H);
        this.flakes = [];
    }

    destroy() { this.canvas.remove(); }

    /** 走 dt 秒（暂停、静止时 0）：落新雪、化雪、长水；sweeps 是这一帧扫过的几段（抹雪、吸水），wet 是写好的笔画（只吸水），暂停时也照样算。 */
    step(dt: number, t: NebbiaTuning, sweeps: readonly number[], wet: readonly number[]) {
        this.spawnAcc += dt * t.snow * 25 * this.W * this.H / (1280 * 720);
        for (; this.spawnAcc >= 1; this.spawnAcc -= 1) this.flakes.push(this.newFlake(t));
        for (let i = this.flakes.length - 1; i >= 0; i -= 1) {
            const f = this.flakes[i];
            const landing = f.age < f.app;
            f.age += dt;
            if (f.age < f.app) { f.rot += f.spin * (1 - f.age / f.app) * dt; continue; }
            if (landing && this.landsInWater(f, sweeps, wet)) f.quick = true;
            if (f.quick) f.melt = Math.min(1, f.melt + dt / QUICK_MELT);
            if (f.quick ? f.melt >= 1 : this.wiped(f, sweeps) || (f.age >= f.app + f.hold && this.melt(f, dt * t.snowMelt))) {
                this.flakes[i] = this.flakes[this.flakes.length - 1];
                this.flakes.pop();
            }
        }
        this.water.step(dt);
        if (sweeps.length) this.water.absorb(sweeps, 0);
        if (wet.length) this.water.absorb(wet, 3 * this.k);
    }

    // 一片雪：大的三成、半径 4.5–6，小的 2.5–4.5（画面高 1000 时）；多数粘上去很快就化，少数挂很久，大的化得慢
    private newFlake(t: NebbiaTuning): Flake {
        const { k } = this;
        const r = (Math.random() < 0.3 ? rand(4.5, 6) : rand(2.5, 4.5)) * k * t.snowSize;
        // 从哪边来都有：随机方向、远近；车速带的风让出发点往前（车头方向）偏一点，飘过来就是往后；多数从稍高处往下飘
        const a = Math.random() * TAU, D = rand(50, 170) * k;
        return {
            x: Math.random() * this.W, y: Math.random() * this.H, r, rot: Math.random() * TAU, spin: rand(-4, 4),
            kind: this.kinds[Math.floor(Math.random() * KINDS)],
            app: rand(0.5, 1.2), ox: Math.cos(a) * D + t.busSpeed * rand(30, 90) * k, oy: Math.sin(a) * D - rand(0, 50) * k,
            curl: rand(-0.6, 0.6), ff: rand(5, 11), fa: rand(2, 7) * k, fp: Math.random() * TAU,
            age: 0, hold: 0.3 + Math.random() ** 2.5 * 7, dur: rand(2.5, 4.5) + r / k * 0.18, melt: 0, water: 0, drops: null, quick: false,
        };
    }

    /** 化 rate × dt / dur：水从疙瘩渗出来、按比例分给还在的那几颗水珠；化完放开水珠，返回 true。 */
    private melt(f: Flake, amount: number): boolean {
        f.melt = Math.min(1, f.melt + amount / f.dur);
        // 化完时水珠看得见的半径 ≈ 雪花半径（size 是看得见半径的 4 倍）
        const total = (f.r * 4) ** 2 * f.melt, delta = total - f.water;
        f.water = total;
        if (!f.drops && f.melt > 0.12) {
            f.drops = f.kind.lumps.map(l => {
                const [x, y] = this.lumpAt(f, l), d = this.water.spawn(x, y, Math.sqrt(Math.max(1, total * l.w)), 1, 0);
                d.pin = { x, y };
                return d;
            });
        } else if (f.drops) {
            const lumps = f.kind.lumps;
            let sw = 0;
            f.drops.forEach((d, j) => { if (d?.dead) f.drops![j] = null; else if (d) sw += lumps[j].w; });
            f.drops.forEach((d, j) => { if (d) d.mass += delta * lumps[j].w / (sw || 1); });
        }
        if (f.melt < 1) return false;
        for (const d of f.drops ?? []) if (d) d.pin = null;
        return true;
    }

    /** 疙瘩的位置转过雪花的角度，再往下挪一点（水往下坠）。 */
    private lumpAt(f: Flake, l: { x: number; y: number }): [number, number] {
        const s = f.r * 2 / (FLAKE_SPRITE * FLAKE_FILL) * FLAKE_R, c = Math.cos(f.rot), sn = Math.sin(f.rot);
        return [f.x + (l.x * c - l.y * sn) * s, f.y + (l.x * sn + l.y * c) * s + f.r * 0.25];
    }

    /** 刚落下就沾到水：歌词的水（扫过的、写好的笔画）或一颗水珠；沾到水珠的话雪的水并进那颗。 */
    private landsInWater(f: Flake, sweeps: readonly number[], wet: readonly number[]): boolean {
        if (this.touches(f, sweeps) || this.touches(f, wet)) return true;
        const d = this.water.near(f.x, f.y, f.r * 0.6);
        if (d) d.mass += (f.r * 4) ** 2;
        return d !== null;
    }

    private touches(f: Flake, segs: readonly number[]) {
        for (let p = 0; p < segs.length; p += PEN_FLOATS) if (segDist(f.x, f.y, segs, p) < segs[p + 4] / 2 + f.r * 0.6) return true;
        return false;
    }

    /** 扫到这片雪：雪当帧化开，水（包括底下已经化出的水珠）当作并进了歌词的水，不在玻璃上留下。 */
    private wiped(f: Flake, sweeps: readonly number[]): boolean {
        for (let p = 0; p < sweeps.length; p += PEN_FLOATS) {
            if (segDist(f.x, f.y, sweeps, p) > sweeps[p + 4] / 2 + f.r * 0.6) continue;
            for (const d of f.drops ?? []) if (d) d.dead = true;
            return true;
        }
        return false;
    }

    /** 水珠走过的地方擦开雾（画进擦痕遮罩），停下后保持 hold 秒、用 refog 秒回雾。 */
    drawFog(ctx: NebbiaSegments, t: NebbiaTuning) { this.water.drawFog(ctx, t.hold, t.refog); }

    /** 水珠实例，画进水珠纹理（和雨窗的凝结水珠同一个位置）。 */
    instances(out: number[]) { return this.water.instances(out); }

    /** 画雪：飘过来时从糊到清、转着、左右晃，越近越慢；贴上去轻轻压扁一下再回来，不弹；化的时候冰往上缩一点，水在底下积。 */
    draw() {
        const { ctx, dpr } = this, half = FLAKE_SPRITE / 2;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, this.W, this.H);
        for (const f of this.flakes) {
            const s0 = f.r * 2 / (FLAKE_SPRITE * FLAKE_FILL);
            let x = f.x, y = f.y, scx = s0, scy = s0, alpha = 0.92;
            const p = Math.min(1, f.age / f.app);
            if (p < 1) {
                // 离落点还差 q（先快后慢），路线往一侧弯，再加上越近越小的飘晃
                const q = (1 - p) ** 2, bend = Math.sin(Math.PI * p) * f.curl, fl = f.fa * q;
                x += f.ox * q - f.oy * bend + Math.sin(f.age * f.ff + f.fp) * fl;
                y += f.oy * q + f.ox * bend + Math.cos(f.age * f.ff * 0.7 + f.fp) * fl;
                scx = scy = s0 * (0.7 + 0.3 * p); alpha *= 0.45 + 0.55 * p;
            } else {
                const e = Math.exp(-(f.age - f.app) * 14);
                scx = s0 * (1 + 0.07 * e); scy = s0 * (1 - 0.08 * e);
                y -= f.r * 0.1 * f.melt;
            }
            // 融化阶段：相邻两张交叉淡入淡出
            const pos = f.melt * (FLAKE_STAGES - 1), st = Math.min(FLAKE_STAGES - 2, Math.floor(pos)), fr = Math.min(1, pos - st);
            ctx.setTransform(dpr * scx * Math.cos(f.rot), dpr * scx * Math.sin(f.rot), -dpr * scy * Math.sin(f.rot), dpr * scy * Math.cos(f.rot), dpr * x, dpr * y);
            if (fr < 1) { ctx.globalAlpha = alpha * (1 - fr); ctx.drawImage(f.kind.stages[st], -half, -half); }
            if (fr > 0) { ctx.globalAlpha = alpha * fr; ctx.drawImage(f.kind.stages[st + 1], -half, -half); }
            if (p < 1) {
                // 还没到焦点上：外面套一圈糊的
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                const rr = f.r * (1.6 - 0.6 * p);
                ctx.globalAlpha = 0.35 * (1 - p); ctx.drawImage(this.halo, x - rr, y - rr, rr * 2, rr * 2);
            }
        }
        ctx.globalAlpha = 1;
    }
}

