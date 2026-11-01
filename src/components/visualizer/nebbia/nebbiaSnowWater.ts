import { segDist, type NebbiaSegments } from './nebbiaSegments';
import { clamp, MASK_SCALE, smooth } from './nebbiaConstants';

// src/components/visualizer/nebbia/nebbiaSnowWater.ts
// 雪窗玻璃上的水（nebbiaSnow.ts 用）：照 raindrop-fx（SardineFish，MIT，见 nebbiaRaindrop.LICENSE.txt）的 raindrop.ts、simulator.ts 改写，
// 去掉 zogra 的向量，y 朝下。每颗水珠有质量、受重力、随机的阻力（挂住）和横偏，走过一段距离分出一颗小水珠留在身后（水痕上的珠串），
// 碰到就合并、按动量算新速度，一直慢慢蒸发。尺寸、距离按库的单位（size 是精灵边长，看得见的半径约 size/4），画面高 1000 时和库的默认一样。
// 钉住的水珠（pin）是还在化的雪底下那颗：不动，外面按化掉的量往上加质量，合并进来的照样算它的。
// 碰到歌词的水（笔尖、往下淌的水珠、写好的笔画）就被吸走（absorb）：当作并进了歌词的水，水量不另算。
// 走动的水珠把雾擦薄一条（drawFog 画进擦痕遮罩，只擦掉一半，宽是水珠直径的六成；全擦开的话后面清楚的街景透出来，一道道像黑条），
// 停下后过 hold 的一半、用 refog 的六成回雾（库里水痕上的雾也回得快）。

export interface WaterDrop {
    x: number; y: number; vx: number; vy: number;
    mass: number; density: number;
    /** 横向、纵向的摊开（刚打上去扁，走得快拉长），慢慢收回。 */
    sx: number; sy: number;
    resist: number; shift: number; nextMotion: number;
    lastTx: number; lastTy: number; nextTrail: number;
    parent: WaterDrop | null;
    dead: boolean;
    /** 钉在这里（还在化的雪底下）；null = 照物理走。 */
    pin: { x: number; y: number } | null;
    /** 正在擦雾的那一道。 */
    wipe: FogWipe | null;
}
interface FogWipe { pts: number[]; w: number; end: number | null }

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const MOVE_MIN = 3;
/** 水珠走过的地方雾擦掉多少（1 = 全擦开）。 */
const WIPE_CLEAR = 0.5;

export class NebbiaSnowWater {
    readonly drops: WaterDrop[] = [];
    private readonly wipes: FogWipe[] = [];
    private cells: WaterDrop[][] = [];
    private gw = 1; private gh = 1; private cell = 30;
    private W = 1; private H = 1;
    /** 画面高 / 1000：库的像素参数按它缩放。 */
    private k = 1;
    private time = 0;
    /** 打滑程度（库的 slipRate，0..1）。雪窗用 0：挂得最牢，化出的水多半留在原地，要并得很大才往下滑。 */
    slip = 0;
    /** 能滑的最小质量（画面高 1000 时）：库里没有这个门槛，小水珠也会随机滑一小段，雪窗水珠多，满屏都是一道道水痕。 */
    stick = 1600;
    /** 按面积蒸发的时间常数（秒）。 */
    evapTau = 150;

    resize(W: number, H: number) {
        if (W === this.W && H === this.H) return;
        this.W = W; this.H = H; this.k = H / 1000;
        this.cell = 70 * this.k * 0.3;
        this.gw = Math.ceil(W / this.cell) + 1; this.gh = Math.ceil(H / this.cell) + 1;
        this.cells = Array.from({ length: this.gw * this.gh }, () => []);
        this.drops.length = 0; this.wipes.length = 0;
    }

    /** 放一颗水珠：size 是精灵边长（看得见的半径约 size/4）。 */
    spawn(x: number, y: number, size: number, density = 1, spread = 0.5): WaterDrop {
        const d: WaterDrop = {
            x, y, vx: 0, vy: 0, mass: (size * density) ** 2, density, sx: spread, sy: spread,
            resist: 0, shift: 0, nextMotion: 0, lastTx: x, lastTy: y, nextTrail: rand(20, 30) * this.k,
            parent: null, dead: false, pin: null, wipe: null,
        };
        this.drops.push(d);
        return d;
    }

    /** 精灵边长（横、竖）。 */
    size(d: WaterDrop): [number, number] { return [this.sizeX(d), (d.sy + 1) * Math.sqrt(Math.max(0, d.mass)) / d.density]; }
    /** 精灵横向边长（热路径用，不分配数组）。 */
    sizeX(d: WaterDrop) { return (d.sx + 1) * Math.sqrt(Math.max(0, d.mass)) / d.density; }

    step(dt: number) {
        if (dt <= 0) return;
        this.time += dt;
        for (let i = 0; i < this.drops.length; i += 1) if (!this.drops[i].dead) this.move(this.drops[i], dt);
        this.collide();
        for (let i = this.drops.length - 1; i >= 0; i -= 1) {
            const d = this.drops[i];
            if (!d.dead) continue;
            if (d.wipe && d.wipe.end === null) d.wipe.end = this.time;
            this.drops[i] = this.drops[this.drops.length - 1];
            this.drops.pop();
        }
    }

    // 一颗水珠走 dt 秒（库的 updateRaindrop）
    private move(d: WaterDrop, dt: number) {
        const k = this.k;
        // 库里每秒蒸发固定一点；这里再按面积（和质量成正比）多蒸发一点：大水珠也会慢慢缩，雪一直下也不会越积越大、越流越多
        d.mass -= (3 * k * k + d.mass / this.evapTau) * dt;
        if (d.mass <= 0) { d.dead = true; return; }
        d.sx *= 0.01 ** dt; d.sy *= 0.01 ** dt;
        if (d.pin) { d.x = d.pin.x; d.y = d.pin.y; d.vx = d.vy = 0; return; }
        if (this.time >= d.nextMotion) {
            d.nextMotion = this.time + rand(0.1, 0.4);
            // 库里按生成尺寸 spawnSize 插值；雪窗没有库自己生成的雨，用 [30, 70]（和 demo 一样）
            const maxResist = (30 + 40 * (1 - this.slip)) ** 2 * k * k * 4;
            d.resist = Math.random() * 2400 * k * maxResist;
            d.shift = Math.random() * rand(0, 0.1);
            // 不够重的水珠挂住不动（真玻璃上小水珠靠挂壁力粘着，要并大了才滑）；正在滑的掉到门槛以下也很快停下
            if (d.mass < this.stick * k * k) d.resist = Math.max(d.resist, 2 * 2400 * k * d.mass);
        }
        const acc = (2400 * k * d.mass - d.resist) / d.mass;
        d.vy = Math.max(0, d.vy + acc * dt);
        d.vx = d.vy * d.shift;
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.sy = Math.max(d.sy, 0.3 * 2 * Math.atan(d.vy * 0.005) / Math.PI);
        if (d.y > this.H + 100) { d.dead = true; return; }
        this.trackWipe(d);
        if (Math.hypot(d.x - d.lastTx, d.y - d.lastTy) > d.nextTrail) this.split(d);
    }

    // 走过一段，身后分出一颗小水珠（库的 split）
    private split(d: WaterDrop) {
        if (d.mass < 1000 * this.k * this.k) return;
        const [w, h] = this.size(d);
        const t = this.spawn(d.x + rand(-5, 5) * this.k, d.y - h / 4, w * rand(0.3, 0.5), 0.2, 0);
        t.sx = 0.1; t.sy = d.vy * 0.01 * 0.6;
        t.parent = d;
        d.mass -= t.mass;
        d.lastTx = d.x; d.lastTy = d.y;
        d.nextTrail = rand(20, 30) * this.k;
    }

    // 碰到就合并：大的吃掉小的，动量守恒（库的 collisionUpdate，网格每帧重建）
    private collide() {
        const { cells, gw, gh, cell } = this;
        for (const c of cells) c.length = 0;
        const at = (x: number, y: number) => Math.min(gw - 1, Math.max(0, Math.floor(x / cell))) + Math.min(gh - 1, Math.max(0, Math.floor(y / cell))) * gw;
        for (const d of this.drops) if (!d.dead) cells[at(d.x, d.y)].push(d);
        for (const d of this.drops) {
            if (d.dead) continue;
            const cx = Math.floor(d.x / cell), cy = Math.floor(d.y / cell), md = this.mergeDistance(d);
            for (let gy = cy - 1; gy <= cy + 1; gy += 1) for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
                if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) continue;
                for (const o of cells[gx + gy * gw]) {
                    if (o === d || o.dead || o.parent === d || d.parent === o || (d.parent && d.parent === o.parent)) continue;
                    if (Math.hypot(d.x - o.x, d.y - o.y) >= md + this.mergeDistance(o)) continue;
                    const [big, small] = d.mass >= o.mass ? [d, o] : [o, d];
                    const m = big.mass + small.mass;
                    big.vx = (big.vx * big.mass + small.vx * small.mass) / m;
                    big.vy = (big.vy * big.mass + small.vy * small.mass) / m;
                    big.mass = m;
                    small.dead = true;
                    if (small === d) break;
                }
                if (d.dead) break;
            }
        }
    }

    /**
     * 吸走挨着这些线段的水珠（每段 5 个数：x0、y0、x1、y1、宽）：水珠边碰到线段两边 pad 以内就算。
     * 只查线段附近几格（网格是上一次 step 建的，刚放下的水珠也在里面）；吸走的这一帧不再画，下一次 step 清掉。
     */
    absorb(segs: readonly number[], pad: number) {
        const { cells, gw, gh, cell } = this, reach = 40 * this.k;
        const gi = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v / cell)));
        for (let p = 0; p < segs.length; p += 5) {
            const ax = segs[p], ay = segs[p + 1], bx = segs[p + 2], by = segs[p + 3], hw = segs[p + 4] / 2, m = hw + pad + reach;
            const x0 = gi(Math.min(ax, bx) - m, gw), x1 = gi(Math.max(ax, bx) + m, gw), y0 = gi(Math.min(ay, by) - m, gh), y1 = gi(Math.max(ay, by) + m, gh);
            for (let gy = y0; gy <= y1; gy += 1) for (let gx = x0; gx <= x1; gx += 1) for (const d of cells[gx + gy * gw]) {
                if (!d.dead && segDist(d.x, d.y, segs, p) < hw + pad + this.sizeX(d) / 4) d.dead = true;
            }
        }
    }

    /** (x, y) 落在哪颗水珠上：看得见的半径再加 extra 以内的第一颗，没有返回 null（用上一次 step 建的网格）。 */
    near(x: number, y: number, extra: number): WaterDrop | null {
        const { cells, gw, gh, cell } = this, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
        for (let gy = Math.max(0, cy - 1); gy <= Math.min(gh - 1, cy + 1); gy += 1) for (let gx = Math.max(0, cx - 1); gx <= Math.min(gw - 1, cx + 1); gx += 1) {
            for (const d of cells[gx + gy * gw]) if (!d.dead && Math.hypot(d.x - x, d.y - y) < this.sizeX(d) / 4 + extra) return d;
        }
        return null;
    }

    private mergeDistance(d: WaterDrop) { return this.sizeX(d) * (1 + d.sx) * 0.16; }

    // 走动时记下走过的路，擦雾用；停下来记停的时刻
    private trackWipe(d: WaterDrop) {
        const moving = d.vy > 8 * this.k;
        if (!moving) { if (d.wipe && d.wipe.end === null) { d.wipe.end = this.time; d.wipe = null; } return; }
        const w = this.sizeX(d) * 0.3;
        if (!d.wipe) { d.wipe = { pts: [d.x, d.y], w, end: null }; this.wipes.push(d.wipe); return; }
        const p = d.wipe.pts;
        d.wipe.w = Math.max(d.wipe.w * 0.98, w);
        if (Math.hypot(d.x - p[p.length - 2], d.y - p[p.length - 1]) > MOVE_MIN) p.push(d.x, d.y);
    }

    /** 水珠走过的地方把雾擦薄：停下后保持 hold / 2 秒，用 refog × 0.6 秒回雾，完全回雾的丢掉。 */
    drawFog(ctx: NebbiaSegments, hold: number, refog: number) {
        ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
        for (let i = this.wipes.length - 1; i >= 0; i -= 1) {
            const wp = this.wipes[i];
            const v = wp.end === null ? 1 : 1 - smooth(clamp((this.time - wp.end - hold * 0.5) / (refog * 0.6)));
            if (v <= 0.002) { this.wipes.splice(i, 1); continue; }
            const p = wp.pts;
            if (p.length < 4) continue;
            ctx.moveTo(p[0], p[1]);
            for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]);
            ctx.stroke(wp.w, v * WIPE_CLEAR);
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    /** 水珠实例（nebbiaDrops.ts 的格式：x、y、宽、高、折射强度、alpha）：看得见的半径 size/4，四边形是它的 8 倍。 */
    instances(out: number[]) {
        out.length = 0;
        for (const d of this.drops) {
            const s = Math.sqrt(Math.max(0, d.mass)) / d.density, w = (d.sx + 1) * s, h = (d.sy + 1) * s;
            if (w < 2 || d.dead) continue;
            out.push(d.x, d.y, w * 2, h * 2, w / 50, 1);
        }
        return out;
    }
}

