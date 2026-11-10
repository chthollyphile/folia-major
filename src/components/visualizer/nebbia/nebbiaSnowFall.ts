import { FLAKE_FLOATS } from './nebbiaSnowGl';

// src/components/visualizer/nebbia/nebbiaSnowFall.ts
// 融雪窗外正在下的雪（nebbiaSnow.ts 用）：远、中两层一直往下落，远的小、糊、淡、慢，中的大一点、清楚一点；
// 跟着车速往后斜（越快越斜），左右轻轻晃，转得慢。落出画面从顶上再来。排成和玻璃上的雪一样的实例（nebbiaSnowGl.ts 画），
// 飘过来的进度当糊的程度用（进度小 = 糊）。贴上玻璃的雪从中层里出（nebbiaSnow.ts 的 newFlake）。

interface Falling { x: number; y: number; r: number; rot: number; spin: number; row: number; vy: number; sa: number; sf: number; sp: number }

/** 两层：画面 1280×720、雪量 1 时几片，半径、下落速度（画面高 1000 时），透明度，糊的程度（飘过来的进度，越小越糊），左右晃的幅度。 */
const LAYERS = [
    { n: 240, r: [0.9, 1.7], vy: [45, 75], alpha: 0.3, p: 0.2, sway: [1, 3] },
    { n: 70, r: [2, 3.2], vy: [95, 140], alpha: 0.5, p: 0.55, sway: [2, 5] },
] as const;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** 车速带的风：比车速涨得快（和贴玻璃的雪用同一个）。 */
const gustOf = (wind: number) => wind * (1 + 0.5 * (wind - 1));
/** 风把雪往后（画面左边）带：每往下落 1 像素横着走几像素。 */
export const slantOf = (wind: number) => -0.45 * Math.max(0, gustOf(wind));

export class NebbiaSnowFall {
    private readonly layers: Falling[][] = LAYERS.map(() => []);
    private W = 0; private H = 0; private k = 1;

    constructor(private readonly rows: number) {}

    resize(W: number, H: number) {
        this.W = W; this.H = H; this.k = H / 1000;
        for (const l of this.layers) l.length = 0;
    }

    get count() { return this.layers[0].length + this.layers[1].length; }

    /** 走 dt 秒：amount 是雪量（tuning.snow，0 = 不下），wind 是车速；片数按画面大小和雪量补足、多了从末尾去掉。 */
    step(dt: number, amount: number, wind: number) {
        const { W, H, k } = this, slant = slantOf(wind), area = W * H / (1280 * 720);
        LAYERS.forEach((spec, li) => {
            const list = this.layers[li], want = Math.round(spec.n * amount * area);
            while (list.length < want) list.push(this.make(li, Math.random() * H));
            if (list.length > want) list.length = want;
            const m = 20 * k;
            for (const f of list) {
                f.y += f.vy * dt;
                f.x += f.vy * slant * dt;
                f.rot += f.spin * dt;
                if (f.y > H + m) Object.assign(f, this.make(li, -m));
                // 被风横着带出去的从另一边进来
                if (f.x < -m) f.x += W + 2 * m; else if (f.x > W + m) f.x -= W + 2 * m;
            }
        });
    }

    private make(li: number, y: number): Falling {
        const spec = LAYERS[li], k = this.k;
        return {
            x: Math.random() * this.W, y, r: rand(spec.r[0], spec.r[1]) * k, rot: Math.random() * Math.PI * 2, spin: rand(-0.6, 0.6),
            row: Math.floor(Math.random() * this.rows), vy: rand(spec.vy[0], spec.vy[1]) * k,
            sa: rand(spec.sway[0], spec.sway[1]) * k, sf: rand(0.8, 1.6), sp: Math.random() * Math.PI * 2,
        };
    }

    /** 排进 out（从第 0 片起）：远层在前（先画、在底下）。 */
    pack(out: Float32Array, t: number) {
        let o = 0;
        LAYERS.forEach((spec, li) => {
            for (const f of this.layers[li]) {
                out[o] = f.x + Math.sin(t * f.sf + f.sp) * f.sa; out[o + 1] = f.y; out[o + 2] = f.r; out[o + 3] = f.rot;
                out[o + 4] = 0; out[o + 5] = f.row; out[o + 6] = spec.alpha; out[o + 7] = spec.p;
                out[o + 8] = 1; out[o + 9] = 1;
                o += FLAKE_FLOATS;
            }
        });
    }
}
