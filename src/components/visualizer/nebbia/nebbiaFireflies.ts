import { clamp } from './nebbiaConstants';

// src/components/visualizer/nebbia/nebbiaFireflies.ts
// 凝露玻璃上的萤虫：从四面八方飞过来（照融雪最早那版雪花，提交 71446614，从糊到清、越近越大），但飞得像虫：
// 路线忽左忽右地折、一顿一顿忽快忽慢；落到玻璃上停着，尾巴亮完 5～10 次之前一阵一阵地爬几步；再起飞，往随机方向越飞越快、越飞越糊，淡没。
// 身子淡，被窗外的光照到才看得清；尾巴有一点自己发的光，颜色和窗外的灯一样：主题的三个灯光色，加上路灯的钠黄、车灯的白（每只随机一个），各只按自己的节奏慢慢亮起、暗下，同一时刻只有少数几只亮着。
// 头朝着它正在走的方向（按这一帧挪了多少算）。样子在 nebbiaFireflyGl.ts。参数在 fireflyParams 里。

/** 一只萤虫的实例：x、y、半径（CSS 像素）、透明度；对焦（1 = 在玻璃上，清楚）、柔光强弱、头朝向（弧度）、翅膀张开多少（0..1）；尾巴的光（0..1）、光的颜色 RGB。 */
export const FIREFLY_FLOATS = 12;

/** 屏上大约多少只（画面 1280×720 时）、大小倍数、柔光大小倍数、飞的速度倍数、尾巴光的亮度。 */
export const fireflyParams = { count: 100, size: 1, halo: 2, speed: 1, glow: 1 };

interface Fly {
    /** 落点（在玻璃上爬时跟着挪）、半径 */
    x: number; y: number; r: number;
    /** 飞过来要几秒、从落点偏多远出发、横着折的幅度、折的频率、一顿一顿的相位 */
    app: number; ox: number; oy: number; zig: number; zf: number; fp: number;
    /** 停几秒、飞走要几秒、往哪个方向飞走（弧度）、飞多远、出来了多久 */
    hold: number; leave: number; dir: number; far: number; age: number;
    /** 在玻璃上爬的方向 */
    crawl: number;
    /** 尾巴光一亮一暗的周期、相位、用第几个颜色（palette） */
    blink: number; bp: number; tint: number;
    /** 上一帧画在哪、头朝哪 */
    px: number; py: number; head: number;
}

const TAU = Math.PI * 2;
/** 尾巴光一个周期里亮着的那段到哪结束（周期的几成） */
const GLOW_END = 0.4;
/** 平均在玻璃上停几秒：周期平均 4.5 秒 × 平均亮 7.5 次（算出生速度用） */
const HOLD_AVG = 4.5 * (7.5 - 1 + GLOW_END + 0.05);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** a 往 b 转（走近的那边），t 是转了多少（0..1）。 */
const turn = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

export class NebbiaFireflies {
    private flies: Fly[] = [];
    private out = new Float32Array(0);
    private W = 0; private H = 0; private k = 1;
    private spawnAcc = 0;
    /** 尾巴光挑的颜色：主题的三个灯光色（nebbiaPalette.ts 的 la、lb、lc），提亮到最亮的通道是 1；后两个固定，是窗外路灯的钠黄（SODIUM）和车灯的白 */
    private palette: number[][] = [[1, 0.81, 0.54], [0.54, 0.8, 1], [0.8, 0.54, 1], [1, 0.68, 0.32], [1, 0.95, 0.85]];

    setPalette(la: number[], lb: number[], lc: number[]) {
        const theme = [la, lb, lc].map(c => { const m = Math.max(c[0], c[1], c[2], 0.05); return c.map(v => v / m); });
        this.palette = [...theme, ...this.palette.slice(3)];
    }

    resize(W: number, H: number) {
        if (W === this.W && H === this.H) return;
        const first = !this.W;
        const sx = W / (this.W || W), sy = H / (this.H || H);
        this.W = W; this.H = H; this.k = H / 1000;
        if (first) {
            // 一开始就按稳态铺一批，各只随机已经活了一段（不然要半分钟以上才慢慢长满）；上一帧位置不算，免得第一帧头朝错
            const p = fireflyParams, want = Math.round(p.count * W * H / (1280 * 720));
            this.flies = Array.from({ length: want }, () => {
                const f = this.spawn();
                f.age = Math.random() * (f.app + f.hold + f.leave); f.px = f.py = NaN;
                return f;
            });
            return;
        }
        // 窗口变了：按比例挪，不清掉（停着的要停半分钟）
        for (const f of this.flies) { f.x *= sx; f.y *= sy; f.px *= sx; f.py *= sy; }
    }

    private spawn(): Fly {
        const { k } = this, s = fireflyParams.speed || 1;
        // 从哪边来都有：随机方向、远近；多数从稍高处过来
        const a = Math.random() * TAU, D = rand(80, 220) * k;
        const x = Math.random() * this.W, y = Math.random() * this.H, ox = Math.cos(a) * D, oy = Math.sin(a) * D - rand(0, 50) * k;
        // 落上玻璃那一刻尾巴正好开始亮；亮完 5～10 次（最后一次暗下去之后）再飞走
        const app = rand(1.5, 3) / s, blink = rand(3, 6), flashes = 5 + Math.floor(Math.random() * 6);
        return {
            x, y, r: (Math.random() < 0.3 ? rand(4.5, 6) : rand(2.5, 4.5)) * k * fireflyParams.size,
            app, ox, oy, zig: rand(12, 30) * k, zf: rand(1.2, 2.2), fp: Math.random() * TAU,
            hold: blink * (flashes - 1 + GLOW_END + 0.05), leave: rand(0.8, 1.4) / s, dir: Math.random() * TAU, far: rand(120, 260) * k, age: 0,
            crawl: Math.random() * TAU, blink, bp: (1 - (app / blink) % 1) % 1, tint: Math.floor(Math.random() * 5),
            px: x + ox, py: y + oy, head: Math.atan2(-oy, -ox),
        };
    }

    /** 往前走 dt 秒，排好实例：返回 [数据, 只数]。 */
    step(dt: number): [Float32Array, number] {
        const p = fireflyParams, { W, H } = this;
        if (!W || !H) return [this.out, 0];
        // 按一只平均活多久算出生的速度，屏上大约稳定在 count 只（屏幕大了按面积多放）
        const want = p.count * W * H / (1280 * 720);
        const life = 3.35 / (p.speed || 1) + HOLD_AVG;
        this.spawnAcc += dt * want / life;
        for (; this.spawnAcc >= 1; this.spawnAcc -= 1) this.flies.push(this.spawn());
        // 原地剔掉飞走了的（每帧都跑，不新建数组）
        const flies = this.flies;
        let n = 0;
        for (const f of flies) if ((f.age += dt) < f.app + f.hold + f.leave) flies[n++] = f;
        flies.length = n;
        if (this.out.length < n * FIREFLY_FLOATS) this.out = new Float32Array(Math.ceil(n * 1.5) * FIREFLY_FLOATS);
        for (let i = 0; i < n; i += 1) this.pack(flies[i], i * FIREFLY_FLOATS, dt);
        return [this.out, n];
    }

    /** 排一只：飞过来 → 停在玻璃上一阵一阵地爬 → 飞走。 */
    private pack(f: Fly, o: number, dt: number) {
        const { k } = this;
        let x = f.x, y = f.y, sc = 1, alpha = 0.92, focus = 1, flap = 0;
        const p = Math.min(1, f.age / f.app), lt = (f.age - f.app - f.hold) / f.leave;
        if (p < 1) {
            // 一顿一顿：进度按正弦扭一下（两头对齐，不往回走，扭到的地方几乎停住），再先快后慢地接近落点
            const c = TAU * 2.5, pe = clamp(p + 0.85 * (Math.sin(c * p + f.fp) - Math.sin(f.fp) * (1 - p) - Math.sin(c + f.fp) * p) / c), q = (1 - pe) ** 2;
            // 横着折：沿路线的垂直方向忽左忽右，越近越小
            const L = Math.hypot(f.ox, f.oy) || 1, nx = -f.oy / L, ny = f.ox / L;
            const z = f.zig * (1 - pe) * (Math.sin(f.age * f.zf * TAU + f.fp) + 0.5 * Math.sin(f.age * f.zf * 2.7 * TAU + f.fp * 2));
            x += f.ox * q + nx * z; y += f.oy * q + ny * z;
            sc = 0.7 + 0.3 * p; alpha *= 0.45 + 0.55 * p; focus = p;
            // 飞着：翅膀张开快速扇，快落上时收起来
            flap = (0.6 + 0.4 * Math.abs(Math.sin(f.age * 47 + f.fp))) * (1 - p ** 4);
        } else if (lt < 0) {
            // 停着（尾巴亮 5～10 次）：一阵一阵地爬（爬的方向慢慢拐），偶尔抖一下翅膀
            const st = f.age - f.app, go = smooth(clamp((Math.sin(st * 0.9 + f.fp) - 0.2) / 0.4));
            // 爬的方向随机拐：按 √dt 走，和帧率无关
            f.crawl += (Math.random() - 0.5) * 0.78 * Math.sqrt(dt);
            f.x += Math.cos(f.crawl) * 7 * k * go * dt; f.y += Math.sin(f.crawl) * 7 * k * go * dt;
            x = f.x; y = f.y;
            flap = 0.35 * Math.max(0, Math.sin(st * 1.7 + f.fp * 3) - 0.94) / 0.06 * Math.abs(Math.sin(st * 40));
        } else {
            // 飞走：越飞越快（加速），离玻璃越远越小、越糊，最后淡没；路上也折
            const d = lt * lt * f.far, w = f.zig * 0.6 * lt * Math.sin(f.age * f.zf * TAU + f.fp);
            x += Math.cos(f.dir) * d - Math.sin(f.dir) * w;
            y += Math.sin(f.dir) * d + Math.cos(f.dir) * w;
            sc = 1 - 0.3 * lt; focus = 1 - lt; alpha *= 1 - lt ** 1.5;
            flap = 0.6 + 0.4 * Math.abs(Math.sin(f.age * 47 + f.fp));
        }
        // 头朝着正在走的方向，转得有点惯性
        const mx = x - f.px, my = y - f.py;
        if (mx * mx + my * my > 0.0025 * k * k) f.head = turn(f.head, Math.atan2(my, mx), Math.min(1, dt * 10));
        f.px = x; f.py = y;
        // 尾巴的光：每个周期里先慢慢亮起（约一成半），再暗下去（约两成半），剩下的时候熄着
        const u = (f.age / f.blink + f.bp) % 1;
        const glow = u < 0.15 ? smooth(u / 0.15) : u < GLOW_END ? 1 - smooth((u - 0.15) / (GLOW_END - 0.15)) : 0;
        const out = this.out;
        out[o] = x; out[o + 1] = y; out[o + 2] = f.r * sc; out[o + 3] = alpha;
        out[o + 4] = focus; out[o + 5] = lt < 0 ? 1 : 1 - lt; out[o + 6] = f.head; out[o + 7] = flap;
        out[o + 8] = glow * fireflyParams.glow * (lt < 0 ? 1 : 1 - lt);
        const c = this.palette[f.tint];
        out[o + 9] = c[0]; out[o + 10] = c[1]; out[o + 11] = c[2];
    }
}
