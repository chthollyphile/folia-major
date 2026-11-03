import { clamp, NEBBIA_FIXED, smooth } from './nebbiaConstants';
import { lineRect, type LaidLine } from './nebbiaScene';
import { createVisualizerRng } from '../visualizerSeedHash';

// src/components/visualizer/nebbia/nebbiaBreath.ts
// 让位时用来腾地方：屏上满了，后面那句要写到一句还没消失的句子上（nebbiaScene.ts 的让位），就在那句开写前
// 对着旧句子哈一口气。嘴哈出的是扁的一股气，打到玻璃上先是贴着句子中线的一条横带（已有整句七成宽），
// 很快上下鼓开成一整片白气（贴着整句外框的椭圆再叠几团大圆），旧句子被盖掉（nebbiaScene.ts 的 yieldFactor），
// 新句子马上写在白气上；新句子唱完后白气再留一会儿，慢慢从薄的边上往里散，散完就是普通的雾。白气只是这一片的雾变密（着色器把它
// 加进雾的浓度），所以写过的地方照样擦开、水珠周围照样抹开一圈。白气画在一张 1/4 分辨率的遮罩上：
// R 通道是形状（散的时候变小，着色器按噪声取阈值，所以边往里退），G 通道是浓度（刚哈出来的头一下淡），
// B 通道是盖住的旧字糊开多少（只在鼓开的那一阵）。
// 省 CPU：每帧先只记下要画哪几口、浓淡（取整到 0..255）和鼓开的进度，和上一帧一样就不重画（挂着的那段一直一样，慢慢散的 8 秒里
// 也大约 4 帧才变一级），version 不变，nebbiaGl.ts 也就不重传纹理。
// 出现方式选了「哈气后书写」的句子也用同一口气：开写前对着自己的位置哈，再写在白气上（nebbiaScene.ts 的 applyAppear）。
// 原型在 fog-write-demo 的 index.html。

const BREATH_SCALE = 0.25;

interface Lobe { x: number; y: number; rx: number; ry: number }
export interface NebbiaBreath { lobes: Lobe[]; cx: number; cy: number; ry: number }

/** 一句的白气：贴着整句外框的椭圆，再在四周叠几团大圆，边缘不齐。 */
export const buildBreath = (line: LaidLine, idx: number): NebbiaBreath | null => {
    const rnd = createVisualizerRng((idx * 6151 + 29) >>> 0);
    const { x0, x1, y0, y1, S } = lineRect(line);
    if (!Number.isFinite(x0)) return null;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + S * 0.3, ry = (y1 - y0) / 2 + S * 0.3;
    const lobes: Lobe[] = [{ x: cx, y: cy, rx: rx * 0.95, ry: ry * 0.95 }];
    const n = 5 + Math.floor(rnd() * 2), r0 = Math.min(rx, ry);
    for (let k = 0; k < n; k += 1) {
        const a = (k + rnd() * 0.6) / n * Math.PI * 2, r = r0 * (0.45 + rnd() * 0.25);
        lobes.push({ x: cx + Math.cos(a) * rx * 0.6, y: cy + Math.sin(a) * ry * 0.6, rx: r, ry: r });
    }
    return { lobes, cx, cy, ry };
};

/**
 * 这一帧要画的一口气：画哪口、形状浓度（0..255）、头上浓度（0..255）、糊开旧字多少（B 通道，0..255）、鼓开的进度。
 * 同一句的让位白气和出场白气是同一个 `b`，所以每一项都要比，少比一项会把两口气当成一样。
 */
interface Puff { b: NebbiaBreath; c0: number; g0: number; b0: number; u: number }

const samePuffs = (a: readonly Puff[], b: readonly Puff[]) => (
    a.length === b.length && a.every((p, i) => p.b === b[i].b && p.c0 === b[i].c0 && p.g0 === b[i].g0 && p.b0 === b[i].b0 && p.u === b[i].u)
);

export class NebbiaBreathMask {
    readonly canvas = document.createElement('canvas');
    private readonly ctx: CanvasRenderingContext2D;
    /** 这一帧有白气（没有时不必上传、着色器也不采样）。 */
    active = false;
    /** 画布内容的版本：重画一次加一（nebbiaGl.ts 版本没变就不重传）。 */
    version = 0;
    private puffs: Puff[] = [];
    private drawn: Puff[] = [];

    constructor() {
        const ctx = this.canvas.getContext('2d');
        if (!ctx) throw new Error('Nebbia: no 2D context for the breath mask');
        this.ctx = ctx;
    }

    resize(W: number, H: number) {
        this.canvas.width = Math.max(1, Math.round(W * BREATH_SCALE));
        this.canvas.height = Math.max(1, Math.round(H * BREATH_SCALE));
        // 改尺寸会清空画布：下一帧照画
        this.drawn = [];
        this.version += 1;
    }

    /** 每帧开头：重新记这一帧的几口气。 */
    begin() { this.puffs = []; }

    /**
     * 一句外框上的一口白气：`t0` 起在 `spread` 秒里从中线鼓开（要写的那句 0.3 秒后开写），到 `until`
     * 再用 breathFade 秒慢慢散。字照常写（nebbiaMask.ts），写过的地方在白气上擦开。这里只记下，end() 时才画。
     * `melt`：让位时盖掉旧句的那口气才把底下的字糊开（B 通道）；「哈气后书写」的出场白气不糊旁边的字。
     */
    drawLine(line: LaidLine, idx: number, T: number, t0: number, until: number, spread: number, melt: boolean) {
        const { breathFade } = NEBBIA_FIXED;
        if (T < t0) return;
        const s = 1 - smooth(clamp((T - Math.max(until, t0 + spread)) / breathFade));
        if (s <= 0.002) return;
        if (line.breath === undefined) line.breath = buildBreath(line, idx);
        const b = line.breath;
        if (!b) return;
        const u = clamp((T - t0) / spread);
        // G 浓度在鼓开的头七成里慢慢浓起来；B 是盖住的旧字糊开多少（着色器），鼓开快完时回到 0，新句子写上来时不糊
        const g0 = Math.round(255 * smooth(clamp(u * 1.4)));
        const b0 = melt ? Math.round(255 * smooth(clamp(u * 2.5)) * (1 - smooth(clamp((u - 0.8) / 0.2)))) : 0;
        this.puffs.push({ b, c0: Math.round(255 * s), g0, b0, u });
    }

    /** 每帧结尾：和上一帧画的一样就不动画布，不一样才清掉重画。 */
    end() {
        const { puffs } = this;
        this.active = puffs.length > 0;
        if (samePuffs(puffs, this.drawn)) return;
        const { ctx } = this;
        if (this.drawn.length) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }
        for (const p of puffs) this.paint(p);
        this.drawn = puffs;
        this.version += 1;
    }

    private paint({ b, c0, g0, b0, u }: Puff) {
        const e = 1 - (1 - u) ** 3;
        const kx = 0.7 + 0.3 * e, ky = 0.08 + 0.92 * e;
        const { ctx } = this;
        ctx.globalCompositeOperation = 'lighten';
        for (const lb of b.lobes) {
            // 每团跟着往中线压扁；按单位圆画，用变换拉成椭圆
            const x = b.cx + (lb.x - b.cx) * kx, y = b.cy + (lb.y - b.cy) * ky;
            ctx.setTransform(BREATH_SCALE * lb.rx * kx, 0, 0, BREATH_SCALE * Math.max(lb.ry * ky, 4), BREATH_SCALE * x, BREATH_SCALE * y);
            const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
            gr.addColorStop(0, `rgb(${c0},${g0},${b0})`);
            gr.addColorStop(0.45, `rgb(${Math.round(c0 * 0.7)},${g0},${b0})`);
            gr.addColorStop(0.999, `rgb(0,${g0},${b0})`);
            gr.addColorStop(1, 'rgb(0,0,0)');
            ctx.fillStyle = gr;
            ctx.beginPath();
            ctx.arc(0, 0, 1, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
}
