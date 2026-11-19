import type { MetaphorGlyph, MetaphorRect } from './metaphorLayout';

// src/components/visualizer/metaphor/metaphorShapes.ts
// 隐喻的融球和装饰图形（纯函数）。三样东西，都按播放时间直接算位置，不积分，拖进度、暂停都对：
// 1. 一个 cue 一份规划：网点云、远处的大墨团和绕着它的小墨滴、贴着字的墨滴、压在字上的强调色融球、圆环、细线，都只极慢地漂。
// 2. 对撞：两颗墨球沿一条直线相向加速，撞上的一刻炸开一圈冲击环，碎片沿螺旋线甩出去、越走越慢越小，
//    身后留一串小点——气泡室里带电粒子在磁场中打转的轨迹。撞的时刻卡在词开唱上（间奏里隔几秒一次）。
// 3. 刚唱到的字放出一对粒子：朝相反的方向、各自往相反的一边打转。
// 写进一段实例数据（每个 10 个数：位置 2、半轴 2、转角 1、墨 / 网点 / 强调色三路的量 3、形状 1、形状自己的参数 1），交给着色器画进墨场。
// 线稿（metaphorFigures.ts）也是这里的图形：细线（可以是虚线）、圆弧、波浪线，和融球一起写进同一段实例数据。

export const METAPHOR_SHAPE_STRIDE = 10;
export const METAPHOR_SHAPE_CAPACITY = 1024;
/**
 * 留给每帧现算的那些（字放出的粒子、对撞、拍上的小环）的名额：一个 cue 的规划（版面、融球、线稿）最多写到容量减去它，
 * 不然规划占满了，最热闹的时候对撞和智能动感的小环反倒被丢掉。三次对撞同时在飞（碎片拉满约 86 个一次）、
 * 一句四十来个字刚唱完（每个字两颗）、两秒多的拍上小环，加起来不到这么多。
 */
export const METAPHOR_DYNAMIC_RESERVE = 384;
/** 一个 cue 的规划最多这么多个，剩下的留给对撞和字放出的粒子。 */
const PLAN_LIMIT = 80;

export const METAPHOR_SHAPE_BLOB = 0;
export const METAPHOR_SHAPE_RING = 1;
export const METAPHOR_SHAPE_BAR = 2;
/** 圆弧：sx 是那一格的半边长（弧画在 0.9 处），sy 是线宽的倍数，param 是半张角占 π 的多少（1 是整圆）。 */
export const METAPHOR_SHAPE_ARC = 3;
/** 波浪线：sx 是半长，sy 是那一格的半高，param 是半波的个数。 */
export const METAPHOR_SHAPE_WAVE = 4;

export interface MetaphorShape {
    shape: number;
    x: number; y: number;
    /** 半轴：融球和圆环是半径，细线是半长与半宽。 */
    sx: number; sy: number;
    /** 形状自己的参数：细线是分成几段虚线（0 是实线），圆弧和波浪线见上。 */
    param: number;
    /** cue 开始后多久才出现。 */
    born: number;
    rot: number;
    ink: number; tone: number; accent: number;
    /** 漂移：两个方向的幅度、角速度、相位。 */
    ampX: number; ampY: number;
    w1: number; w2: number;
    p1: number; p2: number;
    /** 绕着 shapes 里的第几个转（小墨滴）；-1 时 orbit 大于 0 就绕着自己的位置转。 */
    parent: number;
    orbit: number;
    orbitSpeed: number;
    /** 轨道半径不变（不然时远时近）。 */
    steady: boolean;
    /** 跟音量鼓起多少。 */
    pulse: number;
}

const TAU = Math.PI * 2;
/** 「流体」能调到的最大倍数（types.ts 的 METAPHOR_LIMITS.flow.max）：摆墨团时按它留白。 */
const MAX_FLOW = 2;

/** 一个不漂、不鼓的图形（线稿用）。 */
export const staticMetaphorShape = (shape: number, patch: Partial<MetaphorShape>): MetaphorShape => ({
    shape, x: 0, y: 0, sx: 1, sy: 1, param: 0, born: 0, rot: 0, ink: 0, tone: 0, accent: 0,
    ampX: 0, ampY: 0, w1: 0, w2: 0, p1: 0, p2: 0, parent: -1, orbit: 0, orbitSpeed: 0, steady: false, pulse: 0,
    ...patch,
});

const make = (rng: () => number, shape: number, patch: Partial<MetaphorShape>): MetaphorShape => ({
    shape, x: 0, y: 0, sx: 1, sy: 1, param: 0, born: 0, rot: 0, ink: 0, tone: 0, accent: 0,
    // 漂一个来回要四十秒到一百秒
    ampX: 0, ampY: 0, w1: 0.06 + rng() * 0.1, w2: 0.06 + rng() * 0.1, p1: rng() * TAU, p2: rng() * TAU,
    parent: -1, orbit: 0, orbitSpeed: 0, steady: false, pulse: 0,
    ...patch,
});

interface Stage { halfW: number; halfH: number; reach: number; }

const stageOf = (bounds: MetaphorRect): Stage => {
    const halfW = (bounds.x1 - bounds.x0) / 2;
    const halfH = (bounds.y1 - bounds.y0) / 2;
    return { halfW, halfH, reach: Math.max(halfW, halfH, 2) };
};

/** 从中心朝随机方向走到字的包围盒外面 pad 这么远，再往外 0..far：落点离字至少 pad。 */
const outsidePoint = (stage: Stage, rng: () => number, pad: number, far: number) => {
    const angle = rng() * TAU;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const edge = Math.min((stage.halfW + pad) / Math.max(0.001, Math.abs(cos)), (stage.halfH + pad) / Math.max(0.001, Math.abs(sin)));
    const radius = edge + rng() * far;
    return { x: cos * radius, y: sin * radius };
};

/**
 * 一个 cue 的图形规划。墨团都摆在字的包围盒外面（墨压墨就看不见字了）；压在字上的只有强调色融球，
 * 显影时墨画在它上面，字照样读得出来。amount 是设置里「融球」的倍数，interlude 时更多、可以进到舞台中间。
 */
export const planMetaphorShapes = (bounds: MetaphorRect, rng: () => number, amount: number, interlude: boolean): MetaphorShape[] => {
    const shapes: MetaphorShape[] = [];
    const stage = stageOf(bounds);
    const { halfW, halfH, reach } = stage;
    const scale = amount * (interlude ? 1.5 : 1);
    const count = (base: number) => Math.round(base * scale + rng() * 0.6 * Math.min(1, scale));
    const span = (min: number, max: number) => min + rng() * (max - min);
    const around = (min: number, max: number) => {
        const angle = rng() * TAU;
        const radius = span(min, max);
        return { x: Math.cos(angle) * radius * (halfW / reach + 0.6), y: Math.sin(angle) * radius * (halfH / reach + 0.6) };
    };

    for (let index = count(4); index > 0; index -= 1) {
        const radius = span(0.5, 1.4) * reach;
        shapes.push(make(rng, METAPHOR_SHAPE_BLOB, {
            ...around(reach * 0.5, reach * 2.4), sx: radius, sy: radius, tone: span(0.5, 1),
            ampX: span(0.3, 1.2), ampY: span(0.3, 1), pulse: 0.5,
        }));
    }

    // 间奏时舞台里摆着线稿：墨团少一些、小一些，不把它们吞掉
    for (let index = interlude ? Math.min(2, count(1.2)) : count(3); index > 0; index -= 1) {
        const radius = (interlude ? span(0.1, 0.24) : span(0.25, 0.7)) * reach;
        const ampX = span(0.2, 0.9);
        const ampY = span(0.2, 0.8);
        // 留白算上绕着它转的小墨滴（轨道最远 0.98 倍半径，自己阈值以上的那块 0.2 倍）、鼓起的那一成多和漂移（「流体」最大 2 倍）
        const place = interlude ? around(reach * 0.2, reach * 1.6) : outsidePoint(stage, rng, radius * 1.4 + 0.2 + Math.max(ampX, ampY) * MAX_FLOW, reach);
        const parent = shapes.length;
        shapes.push(make(rng, METAPHOR_SHAPE_BLOB, { ...place, sx: radius, sy: radius, ink: 1, tone: 0.6, ampX, ampY, pulse: 1 }));
        for (let drop = 2 + Math.floor(rng() * 2); drop > 0; drop -= 1) {
            const small = radius * span(0.12, 0.3);
            shapes.push(make(rng, METAPHOR_SHAPE_BLOB, {
                sx: small, sy: small, ink: 1, parent, orbit: radius * span(0.55, 0.85),
                orbitSpeed: (rng() < 0.5 ? -1 : 1) * span(0.08, 0.22), pulse: 0.4,
            }));
        }
    }

    if (!interlude) {
        for (let index = count(4); index > 0; index -= 1) {
            const radius = span(0.18, 0.45);
            const side = Math.floor(rng() * 4);
            const along = span(-1, 1);
            const out = span(0.35, 0.9);
            shapes.push(make(rng, METAPHOR_SHAPE_BLOB, {
                x: side < 2 ? along * halfW : (side === 2 ? -1 : 1) * (halfW + out),
                y: side < 2 ? (side === 0 ? -1 : 1) * (halfH + out) : along * halfH,
                sx: radius, sy: radius, ink: 1, ampX: span(0.1, 0.45), ampY: span(0.1, 0.45), pulse: 0.8,
            }));
        }
    }

    for (let index = count(1.6); index > 0; index -= 1) {
        // 盖住一两个字的大小，不把整句都吞掉（只有一两个字的短句，它也跟着小）
        const radius = span(0.9, 1.5) * Math.min(1.6, Math.max(0.45, Math.min(halfW, halfH) * 0.9));
        shapes.push(make(rng, METAPHOR_SHAPE_BLOB, {
            x: span(-0.9, 0.9) * halfW, y: span(-0.9, 0.9) * halfH, sx: radius, sy: radius, accent: 1, tone: 0.4,
            ampX: span(0.3, 0.9) * Math.min(1.5, halfW), ampY: span(0.2, 0.6) * Math.min(1.5, halfH), pulse: 1,
        }));
    }

    for (let index = count(0.8); index > 0; index -= 1) {
        const radius = span(0.5, 1.5) * reach;
        const accent = rng() < 0.35;
        shapes.push(make(rng, METAPHOR_SHAPE_RING, {
            ...around(0, reach * 2), sx: radius, sy: radius,
            ink: accent ? 0 : 1, accent: accent ? 1 : 0, ampX: span(0, 0.4), ampY: span(0, 0.4),
        }));
    }

    return shapes.slice(0, PLAN_LIMIT);
};

/**
 * 几份规划拼成一份。小墨滴的 parent 是它在自己那份里的下标：拼在别的几份后面时要加上前面的长度，
 * 不然它绕着的是排在前面的别的图形（版面的网点、方格线），会转到字上去。
 */
export const joinMetaphorShapes = (...groups: ReadonlyArray<readonly MetaphorShape[]>): MetaphorShape[] => {
    const joined: MetaphorShape[] = [];
    for (const group of groups) {
        const base = joined.length;
        for (const shape of group) joined.push(shape.parent >= 0 && base > 0 ? { ...shape, parent: shape.parent + base } : shape);
    }
    return joined;
};

/** 往实例数据里写一个图形，返回下一个写在第几个；满了就不写。 */
export const putMetaphorShape = (
    out: Float32Array, count: number, shape: number, x: number, y: number, sx: number, sy: number, rot: number, ink: number, tone: number, accent: number,
    param = 0,
): number => {
    if (count >= METAPHOR_SHAPE_CAPACITY) return count;
    const at = count * METAPHOR_SHAPE_STRIDE;
    out[at] = x;
    out[at + 1] = y;
    out[at + 2] = sx;
    out[at + 3] = sy;
    out[at + 4] = rot;
    out[at + 5] = ink;
    out[at + 6] = tone;
    out[at + 7] = accent;
    out[at + 8] = shape;
    out[at + 9] = param;
    return count + 1;
};

/**
 * 把规划在 time 这一刻的样子写进实例数据，返回写了几个。audio 是 0..1 的音量，flow 是「流体」的倍数（漂移的幅度）。
 * 绕着大墨团转的小墨滴时远时近：近了和大墨团融在一起，远了又断开。since 是 cue 开始了多久：还没到 born 的图形不写。
 * 最多写 limit 个（默认留出 METAPHOR_DYNAMIC_RESERVE 给后面现算的那些）。
 */
export const writeMetaphorShapes = (
    shapes: readonly MetaphorShape[], time: number, audio: number, flow: number, out: Float32Array, since = Number.POSITIVE_INFINITY,
    limit = METAPHOR_SHAPE_CAPACITY - METAPHOR_DYNAMIC_RESERVE,
): number => {
    let count = 0;
    const xs: number[] = [];
    const ys: number[] = [];
    for (const shape of shapes) {
        if (count >= limit) break;
        let x = shape.x + shape.ampX * flow * Math.sin(time * shape.w1 + shape.p1);
        let y = shape.y + shape.ampY * flow * Math.cos(time * shape.w2 + shape.p2);
        if (shape.orbit > 0) {
            const angle = time * shape.orbitSpeed + shape.p1;
            const radius = shape.steady ? shape.orbit : shape.orbit * (0.8 + 0.35 * Math.sin(time * 0.3 + shape.p2));
            x = (shape.parent >= 0 ? xs[shape.parent] : x) + Math.cos(angle) * radius;
            y = (shape.parent >= 0 ? ys[shape.parent] : y) + Math.sin(angle) * radius;
        }
        xs.push(x);
        ys.push(y);
        if (shape.born > since) continue;
        const swell = 1 + shape.pulse * (0.06 * Math.sin(time * 0.4 + shape.p2) + 0.14 * audio);
        count = putMetaphorShape(out, count, shape.shape, x, y, shape.sx * swell, shape.sy * swell, shape.rot, shape.ink, shape.tone, shape.accent, shape.param);
    }
    return count;
};

/** 沿螺旋线甩出去的一颗碎片。 */
export interface MetaphorFragment {
    /** 出发的方向（弧度）。 */
    dir: number;
    /** 每走一个 unit 转多少弧度：正负是往哪边打转，小的碎片转得急。 */
    curl: number;
    /** 最远走多远。 */
    range: number;
    size: number;
    life: number;
}

export interface MetaphorCollision {
    /** 撞上的时刻（cue 里的时间）。 */
    time: number;
    x: number; y: number;
    /** 两颗墨球来的那条直线的方向。 */
    angle: number;
    /** 这一次的尺度：墨球的大小、飞来的距离、碎片走多远都按它算。 */
    unit: number;
    fragments: MetaphorFragment[];
}

/** 两颗墨球从出发到撞上用多久：开头几乎不动，越来越快。 */
export const METAPHOR_COLLISION_APPROACH = 2.6;
/** 撞完以后碎片最多还活多久。 */
export const METAPHOR_COLLISION_LIFE = 6.5;
const TRAIL_DOTS = 5;
const TRAIL_GAP = 0.3;

/**
 * 一个 cue 里的几次对撞：times 是撞上的时刻（调用方挑好的词开唱时刻，或间奏里隔几秒一个）。
 * 撞的地方在字的包围盒外面（interlude 时在舞台中间），碎片只有小点那么大，飞过字边上也不遮字。
 */
export const planMetaphorCollisions = (
    bounds: MetaphorRect, rng: () => number, times: readonly number[], amount: number, interlude: boolean,
): MetaphorCollision[] => {
    if (amount <= 0) return [];
    const stage = stageOf(bounds);
    const span = (min: number, max: number) => min + rng() * (max - min);
    return times.map((time) => {
        const unit = Math.max(1, stage.reach * 0.32) * span(0.8, 1.2);
        const place = interlude
            ? { x: span(-0.5, 0.5) * stage.halfW, y: span(-0.5, 0.5) * stage.halfH }
            : outsidePoint(stage, rng, unit * 0.9, stage.reach * 0.5);
        const total = Math.max(3, Math.round(span(5, 9) * Math.min(1.5, amount)));
        const fragments: MetaphorFragment[] = [];
        for (let index = 0; index < total; index += 1) {
            const size = span(0.05, 0.15);
            fragments.push({
                dir: rng() * TAU,
                curl: (rng() < 0.5 ? -1 : 1) * span(0.5, 1.2) * (0.16 / (size + 0.04)),
                range: unit * span(1.2, 3.2),
                size: unit * size,
                life: span(3.5, METAPHOR_COLLISION_LIFE),
            });
        }
        return { time, ...place, angle: rng() * TAU, unit, fragments };
    });
};

/** 接着 offset 把对撞在 time 这一刻的样子写进实例数据，返回写到第几个。 */
export const writeMetaphorCollisions = (collisions: readonly MetaphorCollision[], time: number, out: Float32Array, offset: number): number => {
    let count = offset;
    for (const hit of collisions) {
        const since = time - hit.time;
        if (since < -METAPHOR_COLLISION_APPROACH || since >= METAPHOR_COLLISION_LIFE) continue;
        const cos = Math.cos(hit.angle);
        const sin = Math.sin(hit.angle);
        if (since < 0) {
            // 相向加速：剩下的路程按 1 - u³ 缩短，身后拖三个越来越小的点
            for (let dot = 0; dot <= 3; dot += 1) {
                const u = 1 + since / METAPHOR_COLLISION_APPROACH - dot * 0.035;
                if (u < 0) continue;
                const left = hit.unit * 5 * (1 - u * u * u);
                const radius = hit.unit * (dot === 0 ? 0.22 : 0.13 - dot * 0.025);
                count = putMetaphorShape(out, count, METAPHOR_SHAPE_BLOB, hit.x + cos * left, hit.y + sin * left, radius, radius, 0, 1, 0.3, 0);
                count = putMetaphorShape(out, count, METAPHOR_SHAPE_BLOB, hit.x - cos * left, hit.y - sin * left, radius, radius, 0, 1, 0.3, 0);
            }
            continue;
        }
        // 撞上的一下：一团墨炸开又缩回去，一圈冲击环慢慢扩出去（先是墨线，后来只剩网点）
        const burst = hit.unit * 0.95 * Math.exp(-since * 1.6);
        if (burst > hit.unit * 0.04) count = putMetaphorShape(out, count, METAPHOR_SHAPE_BLOB, hit.x, hit.y, burst, burst, 0, 1, 0.8, 0);
        if (since < 4) {
            const ring = hit.unit * (0.35 + 2.6 * (1 - Math.exp(-since * 0.55)));
            count = putMetaphorShape(out, count, METAPHOR_SHAPE_RING, hit.x, hit.y, ring, ring, 0, since < 2.2 ? 1 : 0, 1, 0);
        }
        for (const fragment of hit.fragments) {
            for (let dot = 0; dot <= TRAIL_DOTS; dot += 1) {
                const age = since - dot * TRAIL_GAP;
                if (age < 0 || age >= fragment.life) continue;
                // 越走越慢；转过的角度跟走过的路成正比，所以轨迹是往里卷的螺旋
                const travelled = fragment.range * (1 - Math.exp(-age * 0.6));
                const angle = fragment.dir + (fragment.curl * travelled) / hit.unit;
                const fade = 1 - age / fragment.life;
                const radius = fragment.size * fade * (dot === 0 ? 1 : 0.6 - dot * 0.07);
                count = putMetaphorShape(out, count, METAPHOR_SHAPE_BLOB, hit.x + Math.cos(angle) * travelled, hit.y + Math.sin(angle) * travelled, radius, radius, 0, 1, 0.25, 0);
            }
        }
    }
    return count;
};

const PAIR_LIFE = 3.6;

/**
 * 刚唱到的字放出一对粒子：朝相反的方向出发、各往相反的一边打转，越走越慢越小。
 * 接着 offset 写进实例数据，返回写到第几个。
 */
export const writeMetaphorPairs = (glyphs: readonly MetaphorGlyph[], time: number, out: Float32Array, offset: number): number => {
    let count = offset;
    for (const glyph of glyphs) {
        const age = time - glyph.t0;
        if (age < 0 || age >= PAIR_LIFE) continue;
        const life = age / PAIR_LIFE;
        const travelled = glyph.size * (0.4 + 1.5 * (1 - Math.exp(-age * 0.7)));
        const radius = glyph.size * (0.07 + glyph.seed * 0.05) * (1 - life * life);
        const curl = 0.9 + glyph.seed * 1.4;
        const ink = glyph.accent ? 0 : 1;
        const accent = glyph.accent ? 1 : 0;
        for (const side of [1, -1]) {
            const angle = glyph.seed * TAU + (side > 0 ? 0 : Math.PI) + (side * curl * travelled) / glyph.size;
            count = putMetaphorShape(out, count, METAPHOR_SHAPE_BLOB, glyph.x + Math.cos(angle) * travelled, glyph.y + Math.sin(angle) * travelled, radius, radius, 0, ink, 0.3, accent);
        }
    }
    return count;
};
