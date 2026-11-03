import { segDist, type NebbiaSegments } from './nebbiaSegments';
import { packFlakes, packIce, packInkIce, type Flake } from './nebbiaSnowDraw';
import { NebbiaSnowFall, slantOf } from './nebbiaSnowFall';
import { buildFlakeAtlas, buildFlakeKind, FLAKE_FILL, FLAKE_R, FLAKE_SPRITE, type FlakeKind, type FlakeType } from './nebbiaSnowFlakes';
import { NebbiaSnowWater } from './nebbiaSnowWater';
import type { NebbiaTuning } from './types';

// src/components/visualizer/nebbia/nebbiaSnow.ts
// 雪窗（tuning.glass = 'snow'）：窗外一直在下雪（远、中两层，nebbiaSnowFall.ts，水族箱里不下）；贴上玻璃的雪从中层里出：跟着往下落、被风往后斜，
// 最后一小段被风带向玻璃，越近越大、越清楚、越慢，轻轻贴上玻璃粘住；粘一会儿开始化，细枝、薄边先没，
// 化出来的水从最厚的几处渗出来，在原地长成几颗钉住的水珠（nebbiaSnowWater.ts），化完放开，照 raindrop-fx 的物理走。
// 和歌词的水联动：写字的笔尖、抹字的手指、从笔画往下淌的水珠扫过时，雪当帧化开、连同那里的水珠一起被吸走（当作并进了歌词的水，水量不另算）；
// 写好的笔画边上不另积雪水（挨着的雪水被笔画吸走）。落在水上的雪（雪化的水珠、还挂着水珠的笔画、往下淌的水珠、笔尖）
// 一沾水就化，QUICK_MELT 秒化完，水并进那里的水。慢慢显现的字没有手指、不带水珠，雪不受影响。
// 雪花六成是小团、四成是枝晶（nebbiaSnowFlakes.ts），在 WebGL 里被身后的光照着画（nebbiaSnowDraw.ts 排实例、nebbiaSnowGl.ts 画）。

/** 一段线：5 个数 x0、y0、x1、y1、宽（CSS 像素）。扫过的（sweeps）和写好的笔画（wet）都是这个格式，nebbiaInk.ts / nebbiaMask.ts 收。 */
export const PEN_FLOATS = 5;

/** 备几种贴图（图集一行一种）；每片雪先按 TYPE_ODDS 抽类型，再在这类里随便挑一种。 */
const KIND_TYPES: FlakeType[] = ['clump', 'clump', 'clump', 'clump', 'clump', 'clump', 'clump', 'star', 'star', 'star', 'star', 'star'];
const TYPE_ODDS: [FlakeType, number][] = [['clump', 0.6], ['star', 1]];
/** 落在水上的雪几秒化完。 */
const QUICK_MELT = 0.25;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
/**
 * 一片雪化完的水（质量）：水珠看得见的半径和雪花半径是对数关系，常见大小（2.5–6，画面高 1000 时）差不多等于雪花半径，
 * 雪花调大时水只慢慢多（半径 12 的雪只化出半径 8 的水珠），不会一下子满屏大水。size 是精灵边长，看得见的半径是它的 1/4。
 */
const waterOf = (r: number, k: number) => (4 * 4.5 * Math.log(1 + r / k / 2.5) * k) ** 2;
const TAU = Math.PI * 2;
export class NebbiaSnow {
    private readonly kinds: FlakeKind[] = KIND_TYPES.map(buildFlakeKind);
    /** 冻住的水珠的冰芯（图集里排在雪花后面）。 */
    private readonly beads: FlakeKind[] = [0, 1, 2].map(i => buildFlakeKind('bead', KIND_TYPES.length + i));
    private readonly byType = new Map<FlakeType, FlakeKind[]>(TYPE_ODDS.map(([type]) => [type, this.kinds.filter(k => k.type === type)]));
    private inst: Float32Array = new Float32Array(0);
    private readonly water = new NebbiaSnowWater();
    private readonly fall = new NebbiaSnowFall(KIND_TYPES.length);
    private flakes: Flake[] = [];
    private spawnAcc = 0;
    private W = 0; private H = 0; private k = 1;
    /** 自己的时钟、上次按写好的笔画吸水的时刻（笔画段多，每 0.05 秒吸一次就够）。 */
    private clock = 0; private wetAt = -Infinity;
    private readonly sweepBox = [0, 0, 0, 0];

    /** 尺寸真变了才清空玻璃上的雪和水（只换像素比、渲染倍数时不清）。 */
    resize(W: number, H: number) {
        if (W === this.W && H === this.H) return;
        this.W = W; this.H = H; this.k = H / 1000;
        this.water.resize(W, H);
        this.fall.resize(W, H);
        this.flakes = [];
    }

    /**
     * 全部贴图拼成的图集（nebbiaSnowFlakes.ts），和有几行。只在建运行时调一次：拼完就放掉各阶段的贴图（共约 4 MB），
     * 之后只用图集里的行号和水先渗出的几处（lumps）；WebGL 上下文丢了是整个运行时重建，连这里一起重新生成。
     */
    atlas(): [HTMLCanvasElement, number] {
        const all = [...this.kinds, ...this.beads];
        const canvas = buildFlakeAtlas(all);
        for (const kind of all) kind.stages = [];
        return [canvas, all.length];
    }

    /**
     * 走 dt 秒（暂停、静止时 0）：落新雪、化雪、长水；sweeps 是这一帧扫过的几段（抹雪、吸水），wet 是写好的笔画（只吸水），暂停时也照样算。
     * wind 是车速带的风（雨夜街景里是 tuning.busSpeed，水族箱里 0）；outside 为假（水族箱）时窗外不下雪，只有贴上玻璃的。
     */
    step(dt: number, t: NebbiaTuning, sweeps: readonly number[], wet: readonly number[], wind: number, outside = true) {
        this.fall.step(dt, outside ? t.snow : 0, wind);
        this.spawnAcc += dt * t.snow * 25 * this.W * this.H / (1280 * 720);
        for (; this.spawnAcc >= 1; this.spawnAcc -= 1) this.flakes.push(this.newFlake(t, wind));
        this.boxOf(sweeps);
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
        this.clock += dt;
        if (sweeps.length) this.water.absorb(sweeps, 0);
        if (wet.length && this.clock - this.wetAt >= 0.05) { this.wetAt = this.clock; this.water.absorb(wet, 3 * this.k); }
    }

    // 一片雪：大的三成、半径 4.5–6，小的 2.5–4.5（画面高 1000 时）；多数粘上去很快就化，少数挂很久，大的化得慢
    private newFlake(t: NebbiaTuning, wind: number): Flake {
        const { k } = this;
        const u = Math.random(), type = TYPE_ODDS.find(([, p]) => u < p)![0], pool = this.byType.get(type)!;
        const r = (Math.random() < 0.3 ? rand(4.5, 6) : rand(2.5, 4.5)) * k * t.snowSize;
        // 从远处飘过来（nebbiaSnowDraw.ts 按透视变大）：一路和窗外远层的雪一样速度往下落，出发点在落点上方，按风的斜度往前（车头方向）偏，越快偏得越远；越快落得越快、路线越直、晃得越小；
        // 只往一侧轻轻弯一点（最后一小段被风带向玻璃），慢慢转
        const app = rand(2, 3.2) / (0.75 + 0.25 * wind), fall = rand(45, 75) * k * app, calm = 1 / (0.6 + 0.4 * wind);
        return {
            x: Math.random() * this.W, y: Math.random() * this.H, r, rot: Math.random() * TAU, spin: rand(-1.33, 1.33) * (0.7 + 0.3 * wind),
            kind: pool[Math.floor(Math.random() * pool.length)],
            app, ox: rand(-15, 15) * k - slantOf(wind) * fall, oy: -fall,
            curl: rand(-0.2, 0.2) * calm, ff: rand(1.5, 3.5), fa: rand(1, 4) * k * calm, fp: Math.random() * TAU,
            age: 0, hold: 0.3 + Math.random() ** 2.5 * 7, dur: rand(2.5, 4.5) + r / k * 0.18, melt: 0, water: 0, drops: null, quick: false,
        };
    }

    /** 化 rate × dt / dur：水从疙瘩渗出来、按比例分给还在的那几颗水珠；化完放开水珠，返回 true。 */
    private melt(f: Flake, amount: number): boolean {
        f.melt = Math.min(1, f.melt + amount / f.dur);
        const total = waterOf(f.r, this.k) * f.melt, delta = total - f.water;
        f.water = total;
        if (!f.drops && f.melt > 0.12) {
            f.drops = f.kind.lumps.map(l => {
                const [x, y] = this.lumpAt(f, l), d = this.water.spawn(x, y, Math.sqrt(Math.max(1, total * l.w)), 1, 0);
                d.pin = { x, y };
                return d;
            });
        } else if (f.drops) {
            const lumps = f.kind.lumps, drops = f.drops;
            let sw = 0;
            for (let j = 0; j < drops.length; j += 1) {
                const d = drops[j];
                if (d?.dead) drops[j] = null; else if (d) sw += lumps[j].w;
            }
            for (let j = 0; j < drops.length; j += 1) {
                const d = drops[j];
                if (d) { d.mass += delta * lumps[j].w / (sw || 1); this.water.grew(d); }
            }
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
        if (d) { d.mass += waterOf(f.r, this.k); this.water.wake(d); }
        return d !== null;
    }

    private touches(f: Flake, segs: readonly number[]) {
        for (let p = 0; p < segs.length; p += PEN_FLOATS) if (segDist(f.x, f.y, segs, p) < segs[p + 4] / 2 + f.r * 0.6) return true;
        return false;
    }

    /** 这一帧扫过的几段合起来的外框（含线宽的一半）：框外的雪不用一段段算距离。 */
    private boxOf(segs: readonly number[]) {
        const b = this.sweepBox;
        b[0] = b[1] = Infinity; b[2] = b[3] = -Infinity;
        for (let p = 0; p < segs.length; p += PEN_FLOATS) {
            const hw = segs[p + 4] / 2;
            b[0] = Math.min(b[0], segs[p] - hw, segs[p + 2] - hw); b[1] = Math.min(b[1], segs[p + 1] - hw, segs[p + 3] - hw);
            b[2] = Math.max(b[2], segs[p] + hw, segs[p + 2] + hw); b[3] = Math.max(b[3], segs[p + 1] + hw, segs[p + 3] + hw);
        }
    }

    /** 扫到这片雪：雪当帧化开，水（包括底下已经化出的水珠）当作并进了歌词的水，不在玻璃上留下。 */
    private wiped(f: Flake, sweeps: readonly number[]): boolean {
        const b = this.sweepBox, m = f.r * 0.6;
        if (f.x + m < b[0] || f.x - m > b[2] || f.y + m < b[1] || f.y - m > b[3]) return false;
        for (let p = 0; p < sweeps.length; p += PEN_FLOATS) {
            if (segDist(f.x, f.y, sweeps, p) > sweeps[p + 4] / 2 + f.r * 0.6) continue;
            for (const d of f.drops ?? []) if (d) this.water.kill(d);
            return true;
        }
        return false;
    }

    /** 水珠走过的地方擦开雾（画进擦痕遮罩），停下后保持 hold 秒、用 refog 秒回雾。 */
    drawFog(ctx: NebbiaSegments, t: NebbiaTuning) { this.water.drawFog(ctx, t.hold, t.refog); }

    /** 水珠实例，画进水珠纹理（和雨窗的凝结水珠同一个位置）。 */
    instances(out: number[]) { return this.water.instances(out); }
    /** 上一次 instances() 改没改水珠（没改时水珠纹理不用重画）。 */
    get changed() { return this.water.changed; }

    /**
     * 这一帧的雪花实例（nebbiaSnowDraw.ts 排、nebbiaSnowGl.ts 画）：窗外的雪在前（画在底下），再是贴玻璃的，最后是结了冰的水珠的冰芯
     * （雪化成的水珠，和写字留下的水珠：inkIce 是 nebbiaInkIce.ts 收的冰芯数据）；数据和片数。
     */
    flakeInstances(inkIce: readonly number[] = []): [Float32Array, number] {
        const n = this.fall.count;
        this.inst = packFlakes(this.flakes, this.inst, n);
        this.fall.pack(this.inst, this.clock);
        let count = n + this.flakes.length, more: number;
        [this.inst, more] = packIce(this.water.drops, d => this.water.sizeX(d) / 4, this.beads, this.inst, count);
        count += more;
        [this.inst, more] = packInkIce(inkIce, this.beads, this.inst, count);
        return [this.inst, count + more];
    }
}

