import { createVisualizerRng } from '../visualizerSeedHash';
import { segDist } from './nebbiaSegments';

// src/components/visualizer/nebbia/nebbiaCondensation.ts
// 凝露玻璃的雾上水珠（玻璃选了凝露时代替 nebbiaDrops.ts 的凝结水珠，水族箱默认配它）：照 raindrop-fx 的 droplets 那一层，
// 一层很密很细的小水珠，没有大水珠。像水族箱玻璃上渗出来的冷凝水：一颗颗慢慢凝出来、长大，挂一阵再慢慢缩没，
// 在别处再凝出来；越往下越密、略大。实例格式和 nebbiaDrops.ts 的 fieldInstances 一样（x、y、宽、高、折射强度、alpha），
// 画进同一张 uField 纹理。不跟颠簸晃。多少、大小在设置里调（tuning.dew、dewSize），高光在主着色器里（NEBBIA_DEW）。
// 和歌词的水联动（wipe）：笔尖、抹字的手指、往下淌的水珠扫过的地方，和还挂着水珠的笔画边上，小水珠被擦掉、算进歌词的水里；
// 笔画上的水珠没了以后，过几秒在原地重新慢慢凝出来（雾回来了）。

/** full：这颗长足了、它那一格实例已经按足尺寸写好，挂着的这段时间不用再写。 */
interface Droplet { x: number; y: number; r: number; sy: number; born: number; life: number; full: boolean }

/** 多少为 1 时每这么多平方 CSS 像素一颗；滑杆最多拉到 MAX_DEW 倍，先按最多的铺好。 */
const AREA_PER_DROP = 81;
const MAX_DEW = 1.5;
/** 刚换尺寸时这么多秒里陆续凝出来；之后每颗凝出、缩没各用的秒数。 */
const FIRST_FILL = 10, GROW = 6, FADE = 4;
/** 每颗挂多久（不算凝出、缩没）。 */
const LIFE_MIN = 12.5, LIFE_SPAN = 25;
/** 实例隔这么多秒才更新一次：水珠长得很慢（一帧不到 0.02 像素），每 50 毫秒变一下看不出一顿一顿，水珠纹理也不用每帧重画。 */
const UPDATE_EVERY = 0.05;
/** 查擦掉的网格边长（CSS 像素）；擦掉后过多久在原地重新凝（秒）。 */
const CELL = 24, REGROW_MIN = 2, REGROW_SPAN = 4;

export class NebbiaCondensation {
    private list: Droplet[] = [];
    /** 实例数据：每颗 6 个数，直接写进去（每帧两万多颗，push 进数组再拷一遍太慢）。 */
    private inst = new Float32Array(0);
    private rng = createVisualizerRng(9191);
    private W = 0;
    private H = 0;
    /** 自己的时钟：暂停、静止时不走，水珠就停在那里。 */
    time = 0;
    /** 离上次更新过了多久；上次的大小、画几颗；重铺过还没写。 */
    private sinceUpdate = 0;
    private lastSize = -1;
    private lastCount = -1;
    private dirty = true;
    /** 上一次 instances() 改没改实例：没改时水珠纹理不用重画（nebbiaGl.ts）。 */
    changed = true;
    /** 每格里的水珠下标；cellOf 是每颗在哪一格（重新凝到别处时挪格）。 */
    private cells: number[][] = [];
    private cellOf = new Int32Array(0);
    private gw = 1;
    /** 上一次按写好的笔画擦的时刻。 */
    private wetAt = -Infinity;

    /** 换尺寸时重铺：全部从头陆续凝出来。 */
    build(W: number, H: number) {
        this.W = W;
        this.H = H;
        this.time = 0;
        this.wetAt = -Infinity;
        const n = Math.round(W * H / AREA_PER_DROP * MAX_DEW);
        this.list = Array.from({ length: n }, () => this.spawn(this.rng() * FIRST_FILL));
        this.inst = new Float32Array(n * 6);
        this.gw = Math.ceil(W / CELL) + 1;
        this.cells = Array.from({ length: this.gw * (Math.ceil(H / CELL) + 1) }, () => []);
        this.cellOf = new Int32Array(n);
        this.list.forEach((d, i) => { this.cellOf[i] = this.cellAt(d.x, d.y); this.cells[this.cellOf[i]].push(i); });
        this.dirty = true;
    }

    private cellAt(x: number, y: number) {
        const gh = this.cells.length / this.gw;
        return Math.min(this.gw - 1, Math.max(0, Math.floor(x / CELL))) + Math.min(gh - 1, Math.max(0, Math.floor(y / CELL))) * this.gw;
    }

    /** 每帧：扫过的几段（笔尖、手指、往下淌的水珠头）每帧擦；写好的笔画段多，跟实例一样每 UPDATE_EVERY 秒擦一次。 */
    touchInk(sweeps: readonly number[], wet: readonly number[], size: number) {
        if (sweeps.length) this.wipe(sweeps, 0, size);
        if (!wet.length || this.time - this.wetAt < UPDATE_EVERY) return;
        this.wetAt = this.time;
        this.wipe(wet, 2, size);
    }

    /**
     * 擦掉挨着这些线段（每段 5 个数：x0、y0、x1、y1、宽）的小水珠：水珠边进到线段两边 pad 以内就算。
     * 擦掉的那颗下一次更新时不再显示，REGROW_MIN–REGROW_MIN+REGROW_SPAN 秒后在原地重新凝出；快到时还被擦着就再往后推。只擦正在画的（滑杆没拉满时后面那些不管）。
     */
    wipe(segs: readonly number[], pad: number, size = 1) {
        const { gw, cells, list, time } = this, gh = cells.length / gw;
        for (let p = 0; p < segs.length; p += 5) {
            const m = segs[p + 4] / 2 + pad + 5 * size;
            const x0 = Math.max(0, Math.floor((Math.min(segs[p], segs[p + 2]) - m) / CELL)), x1 = Math.min(gw - 1, Math.floor((Math.max(segs[p], segs[p + 2]) + m) / CELL));
            const y0 = Math.max(0, Math.floor((Math.min(segs[p + 1], segs[p + 3]) - m) / CELL)), y1 = Math.min(gh - 1, Math.floor((Math.max(segs[p + 1], segs[p + 3]) + m) / CELL));
            for (let gy = y0; gy <= y1; gy += 1) for (let gx = x0; gx <= x1; gx += 1) for (const i of cells[gx + gy * gw]) {
                const d = list[i];
                if (i >= this.lastCount || d.born > time + REGROW_MIN * 0.5 || segDist(d.x, d.y, segs, p) >= segs[p + 4] / 2 + pad + d.r * size) continue;
                // 还看得见的，下一次更新（最多 UPDATE_EVERY 秒后）重写成 0；不立刻重画，写字时水珠纹理也还是每 50 毫秒才画一次
                if (d.born <= time) d.full = false;
                d.born = time + REGROW_MIN + this.rng() * REGROW_SPAN;
            }
        }
    }

    /** 在随机位置凝一颗：半径 1.2–3 像素为主，少数 3–4.2 像素，越往下越密、越大。 */
    private spawn(born: number): Droplet {
        const { rng } = this;
        const y = this.H * (1 - rng() ** 1.4), low = y / Math.max(1, this.H);
        const r = rng() < 0.06 + 0.08 * low ? 3 + rng() * (0.55 + 0.7 * low) : 1.2 + rng() ** 1.5 * (1.35 + 0.4 * low);
        return { x: rng() * this.W, y, r, sy: 1 + rng() * 0.2, born, life: LIFE_MIN + rng() * LIFE_SPAN, full: false };
    }

    /**
     * 走 dt 秒（暂停、静止时 0），返回这一帧的水珠实例：每颗固定一格（还没凝出来、缩没了的那格宽高为 0），同一块内存的前 n 格。
     * dew 是多少（× 默认）：只画铺好的前面那一部分，拉多时多出来的那些早过了寿命，会从头慢慢凝出来；size 是大小（× 默认）。
     * 每 UPDATE_EVERY 秒才更新一次，只改正在凝出、缩没、被歌词的水擦掉的那些格，长足挂着的不动；没改时 changed 为 false。
     */
    instances(dt: number, dew = 1, size = 1): Float32Array {
        const out = this.inst;
        this.time += Math.min(dt, 0.1);
        this.sinceUpdate += Math.min(dt, 0.1);
        const now = this.time;
        const n = Math.min(this.list.length, Math.round(this.list.length * dew / MAX_DEW));
        const resized = size !== this.lastSize;
        let changed = this.dirty || resized || n !== this.lastCount;
        if (!changed && this.sinceUpdate < UPDATE_EVERY) {
            this.changed = false;
            return out.subarray(0, n * 6);
        }
        this.sinceUpdate = 0;
        // 大小变了：所有格（包括这回不画的）都要按新大小重写
        if (resized) for (const d of this.list) d.full = false;
        for (let i = 0; i < n; i += 1) {
            let d = this.list[i];
            if (now - d.born > GROW + d.life + FADE) {
                d = this.list[i] = this.spawn(now + this.rng() * 3);
                const c = this.cellAt(d.x, d.y), old = this.cells[this.cellOf[i]];
                old.splice(old.indexOf(i), 1);
                this.cells[c].push(i);
                this.cellOf[i] = c;
            }
            const age = now - d.born;
            const full = age >= GROW && age <= GROW + d.life;
            if (full && d.full) continue;
            // 凝出来时慢慢长大，挂够了慢慢缩没（蒸发）
            const grow = Math.min(1, Math.max(0, age / GROW)), fade = Math.min(1, Math.max(0, (GROW + d.life + FADE - age) / FADE));
            const r = d.r * size * Math.sqrt(grow) * Math.sqrt(fade);
            const w = r < 0.5 ? 0 : r * 8, o = i * 6;
            out[o] = d.x; out[o + 1] = d.y; out[o + 2] = w; out[o + 3] = w * d.sy; out[o + 4] = w / 100; out[o + 5] = 1;
            d.full = full;
            changed = true;
        }
        this.lastSize = size;
        this.lastCount = n;
        this.dirty = false;
        this.changed = changed;
        return out.subarray(0, n * 6);
    }
}
