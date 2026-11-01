import { createVisualizerRng } from '../visualizerSeedHash';

// src/components/visualizer/nebbia/nebbiaCondensation.ts
// 凝露玻璃的雾上水珠（玻璃选了凝露时代替 nebbiaDrops.ts 的凝结水珠，水族箱默认配它）：照 raindrop-fx 的 droplets 那一层，
// 一层很密很细的小水珠，没有大水珠。像水族箱玻璃上渗出来的冷凝水：一颗颗慢慢凝出来、长大，挂一阵再慢慢缩没，
// 在别处再凝出来；越往下越密、略大。实例格式和 nebbiaDrops.ts 的 fieldInstances 一样（x、y、宽、高、折射强度、alpha），
// 画进同一张 uField 纹理。不跟颠簸晃。多少、大小在设置里调（tuning.dew、dewSize），高光在主着色器里（NEBBIA_DEW）。

/** full：这颗长足了、它那一格实例已经按足尺寸写好，挂着的这段时间不用再写。 */
interface Droplet { x: number; y: number; r: number; sy: number; born: number; life: number; full: boolean }

/** 多少为 1 时每这么多平方 CSS 像素一颗；滑杆最多拉到 MAX_DEW 倍，先按最多的铺好。 */
const AREA_PER_DROP = 81;
const MAX_DEW = 1.5;
/** 刚换尺寸时这么多秒里陆续凝出来；之后每颗凝出、缩没各用的秒数。 */
const FIRST_FILL = 10, GROW = 6, FADE = 4;
/** 每颗挂多久（不算凝出、缩没）。 */
const LIFE_MIN = 25, LIFE_SPAN = 50;
/** 实例隔这么多秒才更新一次：水珠长得很慢（一帧不到 0.02 像素），每 50 毫秒变一下看不出一顿一顿，水珠纹理也不用每帧重画。 */
const UPDATE_EVERY = 0.05;

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

    /** 换尺寸时重铺：全部从头陆续凝出来。 */
    build(W: number, H: number) {
        this.W = W;
        this.H = H;
        this.time = 0;
        const n = Math.round(W * H / AREA_PER_DROP * MAX_DEW);
        this.list = Array.from({ length: n }, () => this.spawn(this.rng() * FIRST_FILL));
        this.inst = new Float32Array(n * 6);
        this.dirty = true;
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
     * 每 UPDATE_EVERY 秒才更新一次，只改正在凝出、缩没的那些格，长足挂着的不动；没改时 changed 为 false。
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
            if (now - d.born > GROW + d.life + FADE) d = this.list[i] = this.spawn(now + this.rng() * 3);
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
