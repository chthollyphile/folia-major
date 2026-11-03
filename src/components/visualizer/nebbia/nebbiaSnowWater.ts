import type { NebbiaSegments } from './nebbiaSegments';
import { NebbiaSnowGrid } from './nebbiaSnowGrid';
import { NebbiaSnowTrails, type FogWipe } from './nebbiaSnowTrails';

// src/components/visualizer/nebbia/nebbiaSnowWater.ts
// 雪窗玻璃上的水（nebbiaSnow.ts 用）：照 raindrop-fx（SardineFish，MIT，见 nebbiaRaindrop.LICENSE.txt）的 raindrop.ts、simulator.ts 改写，
// 去掉 zogra 的向量，y 朝下。每颗水珠有质量、受重力、随机的阻力（挂住）和横偏，走过一段距离分出一颗小水珠留在身后（水痕上的珠串），
// 碰到就合并、按动量算新速度，一直慢慢蒸发。尺寸、距离按库的单位（size 是精灵边长，看得见的半径约 size/4），画面高 1000 时和库的默认一样。
// 钉住的水珠（pin）是还在化的雪底下那颗：不动，外面按化掉的量往上加质量，合并进来的照样算它的。
// 碰到歌词的水（笔尖、往下淌的水珠、写好的笔画）就被吸走（absorb）：当作并进了歌词的水，水量不另算。
// 走动的水珠把雾擦薄一条（nebbiaSnowTrails.ts）。省 CPU：网格增量维护；合并只查这一帧动过、变大过的（woken）；
// 水珠纹理只在有水珠在走、被吸走、并掉时每帧重画，别的时候（钉住的水珠慢慢长）每 FIELD_EVERY 秒一次。
// 结冰（原型，参数在 iceParams）：停着不动够 freezeAfter 秒、够大的水珠开始从中间往外冻（ice 0→1，用 freezeDur 秒冻透），
// 冻着的水珠蒸发得慢；冻到 SLIDE_AT 以后变重变慢，靠外面那层水贴着玻璃一点点往下挪（不再挂住，速度每颗略不同、左右轻轻晃），
// 一直滑出画面底下；一路每隔一段身后留一颗冻住的小冰点（不滑，慢慢升华掉）。冰芯在 nebbiaSnow.ts 里排成雪花实例画（bead 贴图）。

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
    /** 这一帧动过、变大过，等着查合并（没动、没变大的上次没碰上，现在也碰不上：合并距离只会变小）。 */
    awake: boolean;
    /** 在网格的哪一格（-1 = 不在）。 */
    cell: number;
    /** 上次查合并时的质量（grew 用）。 */
    wokeMass: number;
    /** 上次查合并时在哪（滑着的冰珠走过 1 像素再查，wake 记）。 */
    wokeX: number; wokeY: number;
    /** 停着不动了多少秒；冻了多少（0..1）；冻住后往下挪的速度倍数（每颗不同）；冰芯的转角；是不是滑过留下的小冰点（不滑）。 */
    still: number; ice: number; iceV: number; rot: number; speck: boolean;
    /** 这颗冻透要几秒（开始冻时按大小定，iceSizeScale）。 */
    iceDur: number;
    /** 往下滑过的路程；大冰珠滑的时候左右来回转的角度（加在 rot 上）。 */
    slid: number; tilt: number;
}

/**
 * 结冰的参数：停多久开始冻、多久冻透（秒）；往下挪多快（画面高 1000 时每秒像素）；多大的水珠才冻（看得见的半径，画面高 1000 时）；
 * 冻透时看得见的半径是原来的几倍（grow，水的透镜收成更小更实的冰珠，小于 1）；看得见的半径大于 spinR（画面高 1000 时）的冰珠滑的时候左右来回转，最多转 spin 弧度。
 */
export const iceParams = { freezeAfter: 1.5, freezeDur: 3, slide: 3, minR: 2.5, grow: 0.75, spinR: 7.5, spin: 0.35, maxIce: 200, off: false };
/** 冻到多少开始往下挪。 */
const SLIDE_AT = 0.3;
/** 开始冻、冻透的时间按水珠大小（取对数）放长：看得见的半径刚到 minR 的照 freezeAfter、freezeDur 的秒数，大一倍的约 1.7 倍、大三倍的约 2.4 倍（大水珠难冻一些）。r 是看得见的半径，k 是画面高 / 1000。 */
export const iceSizeScale = (r: number, k: number) => 1 + Math.log(Math.max(1, r / (Math.max(0.5, iceParams.minR) * k)));
/** 窗上最多留多少颗小冰点（冰珠上限 iceParams.maxIce 的几倍）：冻住的蒸发得慢，一颗能挂二十来秒，不封顶会攒到几千颗。到顶了滑的就先不留，旧的化掉再留。 */
const SPECKS_PER_ICE = 1.5;

const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** 没有水珠在走时，水珠纹理多久重画一次（秒）。 */
const FIELD_EVERY = 0.05;

export class NebbiaSnowWater {
    readonly drops: WaterDrop[] = [];
    private readonly trails = new NebbiaSnowTrails();
    private woken: WaterDrop[] = [];
    /** 水珠纹理：这回改没改；有没有要立刻重画的（走动、吸走、并掉）；上次重画的时刻；最大的水珠看得见的半径（吸水时查多远）。 */
    changed = true;
    private urgent = true; private fieldAt = -Infinity; private maxR = 40;
    private readonly grid = new NebbiaSnowGrid<WaterDrop>();
    private W = 1; private H = 1;
    /** 画面高 / 1000：库的像素参数按它缩放。 */
    private k = 1;
    private time = 0;
    /** 上一帧窗上的小冰点数（MAX_SPECKS 用）。 */
    private specks = 0;
    /** 上一帧在冻、在滑的冰珠数（不算小冰点）：到 iceParams.maxIce 了新的先不冻。冰珠蒸发得慢、滑得慢，不封顶会攒到上千颗，又碍眼又费 CPU。 */
    private frozen = 0;
    /** 打滑程度（库的 slipRate，0..1）。雪窗用 0：挂得最牢，化出的水多半留在原地，要并得很大才往下滑。 */
    slip = 0;
    /** 能滑的最小质量（画面高 1000 时）：库里没有这个门槛，小水珠也会随机滑一小段，雪窗水珠多，满屏都是一道道水痕。 */
    stick = 1600;
    /** 按面积蒸发的时间常数（秒）。 */
    evapTau = 150;
    /**
     * 沿边蒸发（每秒质量，乘 k·√质量，画面高 1000 时）：水从边上蒸发，小水珠相对边长多、干得快。
     * 一片常见的雪化出的水十来秒干，雪一直下时玻璃上的水二十来秒就稳住（库里每秒固定蒸发一点，小水珠要挂四五十秒，满屏越攒越多）。
     */
    evapEdge = 2.6;
    /**
     * 一颗水珠最多多大（画面高 1000 时，看得见的半径 18；按 size 算，质量上限是 (这个 × 密度)²）：滑下去的水珠一路并掉别的会越滚越大，滑得越宽并得越多，
     * 到这么大以后多出来的当作摊成一层薄水膜流走，不再长（不然雪大、水多时能滚出半径近百像素的水珠、擦出一道道宽痕）。
     */
    maxSize = 72;

    resize(W: number, H: number) {
        if (W === this.W && H === this.H) return;
        this.W = W; this.H = H; this.k = H / 1000;
        this.grid.reset(W, H, 70 * this.k * 0.3);
        this.drops.length = 0; this.trails.clear(); this.woken = []; this.urgent = true; this.maxR = 40 * this.k;
    }

    /** 放一颗水珠：size 是精灵边长（看得见的半径约 size/4）。 */
    spawn(x: number, y: number, size: number, density = 1, spread = 0.5): WaterDrop {
        const d: WaterDrop = {
            x, y, vx: 0, vy: 0, mass: (size * density) ** 2, density, sx: spread, sy: spread,
            resist: 0, shift: 0, nextMotion: 0, lastTx: x, lastTy: y, nextTrail: rand(20, 30) * this.k,
            parent: null, dead: false, pin: null, wipe: null, awake: false, cell: -1, wokeMass: 0, wokeX: 0, wokeY: 0,
            still: 0, ice: 0, iceV: 1, iceDur: 1, rot: Math.random() * Math.PI * 2, speck: false, slid: 0, tilt: 0,
        };
        this.drops.push(d);
        this.grid.place(d);
        this.wake(d);
        return d;
    }

    /** 变大了（外面加了水）或刚放下：这一帧查合并。 */
    wake(d: WaterDrop) { if (!d.awake && !d.dead) { d.awake = true; d.wokeMass = d.mass; d.wokeX = d.x; d.wokeY = d.y; this.woken.push(d); } }

    /**
     * 慢慢变大（还在化的雪往底下钉住的水珠里一点点加水）：比上次查合并时重了 5% 以上才再查。
     * 合并距离和半径成正比，每帧长那一点点碰不上新的水珠，不用每帧都查。
     */
    grew(d: WaterDrop) { if (d.mass > d.wokeMass * 1.05) this.wake(d); }

    /** 外面直接拿走一颗（雪被抹掉时它底下的水珠）：水珠纹理立刻重画。 */
    kill(d: WaterDrop) { d.dead = true; this.urgent = true; }

    /** 精灵边长（横、竖）。 */
    size(d: WaterDrop): [number, number] { return [this.sizeX(d), (d.sy + 1) * Math.sqrt(Math.max(0, d.mass)) / d.density]; }
    /** 精灵横向边长（热路径用，不分配数组）。 */
    sizeX(d: WaterDrop) { return (d.sx + 1) * Math.sqrt(Math.max(0, d.mass)) / d.density; }

    step(dt: number) {
        if (dt <= 0) return;
        this.time += dt;
        // 摊开每秒收回到 1%：这一帧的倍数所有水珠一样，算一次
        const spread = 0.01 ** dt;
        for (let i = 0; i < this.drops.length; i += 1) if (!this.drops[i].dead) this.move(this.drops[i], dt, spread);
        this.collide();
        let specks = 0, frozen = 0;
        for (const d of this.drops) {
            if (d.speck) specks += 1;
            else if (d.ice > 0) frozen += 1;
        }
        this.specks = specks; this.frozen = frozen;
        for (let i = this.drops.length - 1; i >= 0; i -= 1) {
            const d = this.drops[i];
            if (!d.dead) continue;
            this.endWipe(d);
            this.grid.unplace(d);
            this.drops[i] = this.drops[this.drops.length - 1];
            this.drops.pop();
        }
    }

    // 一颗水珠走 dt 秒（库的 updateRaindrop）
    private move(d: WaterDrop, dt: number, spread: number) {
        const k = this.k;
        // 库里每秒蒸发固定一点；这里改成沿边蒸发（小水珠干得快），再按面积（和质量成正比）多蒸发一点：大水珠也会慢慢缩，雪一直下也不会越积越大、越流越多
        d.mass = Math.min(d.mass, this.massCap(d));
        // 冻着的蒸发得慢（冻透的只剩一点升华）
        d.mass -= (this.evapEdge * k * Math.sqrt(Math.max(0, d.mass)) + d.mass / this.evapTau) * dt * (1 - 0.85 * d.ice);
        if (d.mass <= 0) { d.dead = true; return; }
        d.sx *= spread; d.sy *= spread;
        if (d.pin) { d.x = d.pin.x; d.y = d.pin.y; d.vx = d.vy = 0; d.still = 0; return; }
        if (this.freeze(d, dt)) return;
        // 停着的轻水珠挂住不动：不用算受力（雪窗玻璃上绝大多数水珠都这样）
        if (d.vy === 0 && d.mass < this.stick * k * k) { if (d.wipe) this.endWipe(d); return; }
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
        this.grid.place(d);
        if (d.vy > 8 * k) { d.wipe = this.trails.track(d.wipe, d.x, d.y, this.sizeX(d) * 0.3); this.wake(d); this.urgent = true; } else this.endWipe(d);
        if (Math.hypot(d.x - d.lastTx, d.y - d.lastTy) > d.nextTrail) this.split(d);
    }

    /** 结冰：停够了开始冻、冻着的往下挪；挪动由这里管了返回 true（不再走库的受力）。 */
    private freeze(d: WaterDrop, dt: number): boolean {
        const p = iceParams, k = this.k;
        if (d.speck) { d.ice = 1; return true; }
        if (d.ice === 0) {
            if (p.off || d.vy > 0 || this.sizeX(d) / 4 < p.minR * k) { d.still = 0; return false; }
            d.still += dt;
            const scale = iceSizeScale(this.sizeX(d) / 4, k);
            if (d.still < p.freezeAfter * scale || this.frozen >= p.maxIce) return false;
            this.frozen += 1;
            d.ice = 1e-3; d.iceV = rand(0.65, 1.35); d.iceDur = Math.max(1, p.freezeDur * scale);
        }
        // 冻的时候水的透镜慢慢收成冰珠，冻透时看着是原来的 grow 倍（质量 grow² 倍）
        if (d.ice < 1) d.mass = Math.min(this.massCap(d), d.mass * Math.max(0.25, p.grow) ** (2 * dt / d.iceDur));
        d.ice = Math.min(1, d.ice + dt / d.iceDur);
        if (d.ice < SLIDE_AT) { d.vx = d.vy = 0; return true; }
        // 往下挪：开头慢慢起步，左右轻轻晃
        const v = p.slide * k * d.iceV * Math.min(1, (d.ice - SLIDE_AT) / 0.15);
        d.vy += (v - d.vy) * Math.min(1, dt * 2);
        d.vx = Math.sin(this.time * 0.7 + d.rot * 5) * d.vy * 0.15;
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.y > this.H + 100) { d.dead = true; return true; }
        // 大冰珠滑的时候左右来回转（冰块在水膜里被玻璃蹭着晃）：越大转得越多，滑一段来回一次；小的慢慢转回去
        d.slid += d.vy * dt;
        const over = this.sizeX(d) / 4 / k - p.spinR;
        const amp = over > 0 ? p.spin * Math.min(1, over / 6) : 0;
        d.tilt += (amp * Math.sin(d.slid / (14 * k) + d.rot * 3) - d.tilt) * Math.min(1, dt * 3);
        this.grid.place(d);
        // 冰珠滑得慢（每帧零点几像素）：走过 1 像素或者长大 5% 才再查合并；
        // 慢的不催水珠纹理每帧重画，照常每 FIELD_EVERY 秒一次（落后不到 0.25 像素），快的才催
        if (Math.abs(d.x - d.wokeX) + Math.abs(d.y - d.wokeY) > k) this.wake(d); else this.grew(d);
        if (d.vy * FIELD_EVERY > 0.25 * k) this.urgent = true;
        // 身后每隔一段留一颗冻住的小冰点
        if (Math.hypot(d.x - d.lastTx, d.y - d.lastTy) > d.nextTrail && d.mass > 300 * k * k && this.specks < p.maxIce * SPECKS_PER_ICE) {
            const t = this.spawn(d.x + rand(-1.5, 1.5) * k, d.y - this.sizeX(d) / 4, this.sizeX(d) * rand(0.18, 0.3), 1, 0);
            t.speck = true; t.ice = 1; t.parent = d;
            d.mass -= t.mass;
            d.lastTx = d.x; d.lastTy = d.y;
            d.nextTrail = rand(10, 18) * k;
            this.specks += 1;
        }
        return true;
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

    // 停下来了：它擦的那一道记下停的时刻，开始回雾
    private endWipe(d: WaterDrop) {
        if (d.wipe && d.wipe.end === null) d.wipe.end = this.time;
        d.wipe = null;
    }

    // 碰到就合并：大的吃掉小的，动量守恒（库的 collisionUpdate）。只拿这一帧动过、变大过（或刚放下）的去查
    private collide() {
        const { cells, gw, gh, size: cell } = this.grid, list = this.woken;
        this.woken = [];
        for (const d of list) {
            d.awake = false;
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
                    // 密度按质量平均：拖尾留下的小珠（密度 0.2）并进来一颗比它还轻的水珠时，不会一下子显得大 5 倍
                    big.density = (big.density * big.mass + small.density * small.mass) / m;
                    big.mass = Math.min(m, this.massCap(big));
                    // 冰按质量平均（大的冰珠吃掉水珠就化掉一些）；没冻的水珠吃掉冰珠、小冰点，冰就化进水里，要冻照常停够了再冻（不绕过上限和时间）。
                    // 小冰点并进别的就不再是小冰点
                    big.ice = big.ice > 0 ? (big.ice * (m - small.mass) + small.ice * small.mass) / m : 0;
                    if (big.ice < 1e-3) big.ice = 0;
                    big.speck = big.speck && small.speck;
                    small.dead = true;
                    this.urgent = true;
                    this.wake(big);
                    if (small === d) break;
                }
                if (d.dead) break;
            }
        }
    }

    /**
     * 吸走挨着这些线段的水珠（每段 5 个数：x0、y0、x1、y1、宽）：水珠边碰到线段两边 pad 以内就算。
     * 只查线段附近几格；吸走的这一帧不再画，下一次 step 清掉。
     */
    absorb(segs: readonly number[], pad: number) { this.grid.alongSegments(segs, pad, this.maxR, d => this.sizeX(d) / 4, d => this.kill(d)); }

    /** (x, y) 落在哪颗水珠上：看得见的半径再加 extra 以内的第一颗，没有返回 null。 */
    near(x: number, y: number, extra: number): WaterDrop | null { return this.grid.at(x, y, extra, d => this.sizeX(d) / 4); }

    private massCap(d: WaterDrop) { return (this.maxSize * this.k * d.density) ** 2; }

    private mergeDistance(d: WaterDrop) { return this.sizeX(d) * (1 + d.sx) * 0.16; }

    /** 水珠走过的地方把雾擦薄（nebbiaSnowTrails.ts）。 */
    drawFog(ctx: NebbiaSegments, hold: number, refog: number) { this.trails.draw(ctx, this.time, hold, refog); }

    /** 水珠实例（nebbiaDrops.ts 的格式：x、y、宽、高、折射强度、alpha）：看得见的半径 size/4，四边形是它的 8 倍。 */
    /** 没变到要重画时原样返回 out、changed 为 false。 */
    instances(out: number[]) {
        this.changed = this.urgent || this.time - this.fieldAt >= FIELD_EVERY;
        if (!this.changed) return out;
        this.urgent = false; this.fieldAt = this.time;
        out.length = 0;
        let maxR = 0;
        for (const d of this.drops) {
            const s = Math.sqrt(Math.max(0, d.mass)) / d.density, w = (d.sx + 1) * s, h = (d.sy + 1) * s;
            if (w < 2 || d.dead) continue;
            out.push(d.x, d.y, w * 2, h * 2, w / 50, 1);
            maxR = Math.max(maxR, w / 4);
        }
        this.maxR = maxR + 2 * this.k;
        return out;
    }
}

