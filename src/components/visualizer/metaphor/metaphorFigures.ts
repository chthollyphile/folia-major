import type { MetaphorMeasure, MetaphorRect } from './metaphorLayout';
import {
    METAPHOR_SHAPE_ARC,
    METAPHOR_SHAPE_BAR,
    METAPHOR_SHAPE_BLOB,
    METAPHOR_SHAPE_WAVE,
    staticMetaphorShape,
    type MetaphorShape,
} from './metaphorShapes';

// src/components/visualizer/metaphor/metaphorFigures.ts
// 隐喻的线稿（纯函数）：用细线、弧、波浪线、点和注记小字画出来的图，像论文和演算纸上的插图。两类：
// 1. 图（planMetaphorFigures）：行星轨道、星图、晶格、晶胞、分子、对撞机探测器的截面、费曼图、路径积分、演算草稿。
//    一个 cue 挑几张，摆在字的包围盒外面的四边（间奏时在舞台里排开），一笔一笔隔 0.2 秒冒出来，冒出来以后不动（轨道上的行星除外）。
//    另外有一张大的垫在字后面：只进半调（网点画出来的粗线），不是墨，不碍着读字——全景里字占满画面时，看得见的主要是它。
// 2. 版面（planMetaphorBackdrop）：字后面的一层网点（色带、方格纸、同心弧、点阵），和贴着字块的规线、裁切标记、
//    行号与时间码——版面设计里的那些零件。
// 注记是公式和标签，用另一种字体（metaphorGlyphs.ts 的注记字体）画成细的墨字；这里只管放在哪，字宽由外面量。

export interface MetaphorNote {
    text: string;
    /** 锚点：align 是 0 时是左端，0.5 是中点，1 是右端；竖直方向是字的中线。 */
    x: number; y: number;
    /** 字高（em 的倍数）。 */
    size: number;
    rot: number;
    align: number;
    /** cue 开始后多久冒出来。 */
    born: number;
}

export interface MetaphorNoteGlyph { char: string; x: number; y: number; size: number; rot: number; born: number; }

export interface MetaphorFigures { shapes: MetaphorShape[]; notes: MetaphorNote[]; }

export const METAPHOR_FIGURE_KINDS = ['orbit', 'starmap', 'lattice', 'cell', 'molecule', 'detector', 'feynman', 'paths', 'draft'] as const;
export type MetaphorFigureKind = typeof METAPHOR_FIGURE_KINDS[number];

/** 一张图、一层版面各自最多这么多个图形。 */
const FIGURE_LIMIT = 240;
const BACKDROP_LIMIT = 48;

const TAU = Math.PI * 2;
/** 线的半宽（世界单位）。 */
const STROKE = 0.016;
/** 融球阈值以上的那块是它半轴的多少（metaphorShaders.ts 的融球：k³ × 1.45 过 0.5）。 */
const BLOB_CORE = 0.55;
/** 弧画在它那一格的多少处（metaphorShaders.ts 的 ARC_AT）。 */
const ARC_AT = 0.9;
/** 波浪线的振幅是它那一格半高的多少（metaphorShaders.ts 的 WAVE_AMP）。 */
const WAVE_AMP = 0.75;

type Rng = () => number;

/** 一支笔：在一张图自己的坐标里画（图大约占半径 1），落到世界里时平移、缩放、转一个角度。 */
class Pen {
    readonly shapes: MetaphorShape[] = [];
    readonly notes: MetaphorNote[] = [];
    private readonly cos: number;
    private readonly sin: number;
    private stroke = 0;

    constructor(
        private readonly cx: number, private readonly cy: number, private readonly scale: number, private readonly rot: number,
        private readonly delay: number, private readonly mix: Pick<MetaphorShape, 'ink' | 'tone' | 'accent'> = { ink: 1, tone: 0, accent: 0 },
        /** 线宽的倍数。 */
        private readonly heavy = 1,
    ) {
        this.cos = Math.cos(rot);
        this.sin = Math.sin(rot);
    }

    private at(x: number, y: number): [number, number] {
        return [this.cx + (x * this.cos - y * this.sin) * this.scale, this.cy + (x * this.sin + y * this.cos) * this.scale];
    }

    /** 三笔一组，一组比上一组晚 0.2 秒。 */
    private born() {
        const born = this.delay + Math.floor(this.stroke / 3) * 0.2;
        this.stroke += 1;
        return born;
    }

    line(x0: number, y0: number, x1: number, y1: number, dashes = 0, weight = 1) {
        const [ax, ay] = this.at(x0, y0);
        const [bx, by] = this.at(x1, y1);
        this.shapes.push(staticMetaphorShape(METAPHOR_SHAPE_BAR, {
            x: (ax + bx) / 2, y: (ay + by) / 2, sx: Math.hypot(bx - ax, by - ay) / 2, sy: STROKE * weight * this.heavy,
            rot: Math.atan2(by - ay, bx - ax), param: dashes, born: this.born(), ...this.mix,
        }));
    }

    /** 两点之间的波浪线：halfWaves 个半波（两头都落在点上），amp 是振幅。 */
    wave(x0: number, y0: number, x1: number, y1: number, halfWaves: number, amp: number) {
        const [ax, ay] = this.at(x0, y0);
        const [bx, by] = this.at(x1, y1);
        this.shapes.push(staticMetaphorShape(METAPHOR_SHAPE_WAVE, {
            x: (ax + bx) / 2, y: (ay + by) / 2, sx: Math.hypot(bx - ax, by - ay) / 2, sy: (amp * this.scale) / WAVE_AMP + STROKE * 3,
            rot: Math.atan2(by - ay, bx - ax), param: halfWaves, born: this.born(), ...this.mix, tone: this.mix.tone + (this.heavy > 1 ? 0.2 : 0),
        }));
    }

    /** 圆弧：圆心、半径、弧的中点方向和半张角（默认整圆）。 */
    arc(x: number, y: number, radius: number, mid = 0, half = Math.PI, weight = 1) {
        const [cx, cy] = this.at(x, y);
        const size = (radius * this.scale) / ARC_AT;
        this.shapes.push(staticMetaphorShape(METAPHOR_SHAPE_ARC, {
            x: cx, y: cy, sx: size, sy: weight * this.heavy, rot: mid + this.rot, param: Math.min(1, half / Math.PI), born: this.born(), ...this.mix,
        }));
    }

    dot(x: number, y: number, radius: number) {
        const [cx, cy] = this.at(x, y);
        const size = (radius * this.scale) / BLOB_CORE;
        this.shapes.push(staticMetaphorShape(METAPHOR_SHAPE_BLOB, { x: cx, y: cy, sx: size, sy: size, born: this.born(), ...this.mix }));
    }

    /** 绕着一个点匀速转的点（行星）。 */
    orbiter(x: number, y: number, orbit: number, radius: number, speed: number, phase: number) {
        const [cx, cy] = this.at(x, y);
        const size = (radius * this.scale) / BLOB_CORE;
        this.shapes.push(staticMetaphorShape(METAPHOR_SHAPE_BLOB, {
            x: cx, y: cy, sx: size, sy: size, orbit: orbit * this.scale, orbitSpeed: speed, p1: phase, steady: true, born: this.born(), ...this.mix,
        }));
    }

    /** 带箭头的线：箭头在线上 at 处，朝终点。 */
    arrow(x0: number, y0: number, x1: number, y1: number, at = 0.55) {
        this.line(x0, y0, x1, y1);
        const angle = Math.atan2(y1 - y0, x1 - x0);
        const hx = x0 + (x1 - x0) * at;
        const hy = y0 + (y1 - y0) * at;
        for (const side of [0.45, -0.45]) {
            this.line(hx, hy, hx - Math.cos(angle + side) * 0.11, hy - Math.sin(angle + side) * 0.11);
        }
    }

    note(text: string, x: number, y: number, size: number, align = 0, rot = 0) {
        const [ax, ay] = this.at(x, y);
        this.notes.push({ text, x: ax, y: ay, size: size * this.scale, rot: rot + this.rot, align, born: this.born() });
    }
}

const span = (rng: Rng, min: number, max: number) => min + rng() * (max - min);
const choose = <T>(rng: Rng, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
const shuffle = <T>(rng: Rng, items: readonly T[]): T[] => {
    const list = [...items];
    for (let index = list.length - 1; index > 0; index -= 1) {
        const other = Math.floor(rng() * (index + 1));
        [list[index], list[other]] = [list[other], list[index]];
    }
    return list;
};

/** 行星轨道：太阳、几圈轨道和轨道上慢慢走的行星（外圈走得慢），一条量半长轴的虚线。 */
const drawOrbit = (pen: Pen, rng: Rng) => {
    const rings = 3 + Math.floor(rng() * 2);
    pen.dot(0, 0, 0.085);
    for (let index = 0; index < rings; index += 1) {
        const radius = 0.3 + (index * 0.7) / (rings - 1);
        pen.arc(0, 0, radius);
        pen.orbiter(0, 0, radius, span(rng, 0.03, 0.055), ((rng() < 0.85 ? 1 : -1) * 0.1) / radius ** 1.5, rng() * TAU);
    }
    const angle = span(rng, 0.2, 1.2);
    pen.line(0, 0, Math.cos(angle), Math.sin(angle), 9);
    pen.arc(0, 0, 0.16, angle / 2, angle / 2);
    pen.note(choose(rng, ['T² ∝ a³', 'a = 1.52 AU', 'e = 0.0167', 'v² = GM/r']), Math.cos(angle) * 1.08, Math.sin(angle) * 1.08, 0.15);
    // 一段彗星的远轨道
    pen.arc(span(rng, -0.4, 0.4), span(rng, 0.9, 1.3), 1.5, -Math.PI / 2, 0.55);
};

/** 星图：几颗星连成的星座，一颗圈起来标了名，一颗打了十字，一段带刻度的赤经弧。 */
const drawStarmap = (pen: Pen, rng: Rng) => {
    const stars: Array<[number, number]> = [];
    for (let tries = 0; stars.length < 7 && tries < 60; tries += 1) {
        const angle = rng() * TAU;
        const radius = Math.sqrt(rng()) * 0.85;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (stars.every(([sx, sy]) => Math.hypot(sx - x, sy - y) > 0.32)) stars.push([x, y]);
    }
    stars.sort((a, b) => a[0] - b[0]);
    stars.forEach(([x, y], index) => {
        pen.dot(x, y, span(rng, 0.03, 0.07));
        if (index > 0) pen.line(stars[index - 1][0], stars[index - 1][1], x, y);
    });
    const [named, crossed] = [stars[1] ?? stars[0], stars.at(-1) ?? stars[0]];
    pen.arc(named[0], named[1], 0.14);
    pen.note(choose(rng, ['α', 'β', 'γ', 'δ']), named[0] + 0.18, named[1] + 0.14, 0.17);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        pen.line(crossed[0] + dx * 0.1, crossed[1] + dy * 0.1, crossed[0] + dx * 0.24, crossed[1] + dy * 0.24);
    }
    const mid = span(rng, 0.9, 2.2);
    pen.arc(0, 0, 1.08, mid, 0.5);
    for (let tick = -2; tick <= 2; tick += 1) {
        const angle = mid + tick * 0.22;
        pen.line(Math.cos(angle) * 1.08, Math.sin(angle) * 1.08, Math.cos(angle) * 1.16, Math.sin(angle) * 1.16);
    }
    pen.note(choose(rng, ['δ −05° 23′', 'RA 05h 35m', 'z = 0.0073', 'd = 4.2 ly']), -0.95, -1.05, 0.14);
};

/** 晶格：斜的二维点阵和键，一个描粗的原胞，两条基矢的名字，布拉格条件。 */
const drawLattice = (pen: Pen, rng: Rng) => {
    const gamma = choose(rng, [Math.PI / 3, Math.PI / 2, 1.3]);
    const pitch = 0.46;
    const bx = Math.cos(gamma) * pitch;
    const by = Math.sin(gamma) * pitch;
    const at = (column: number, row: number): [number, number] => [(column - 1.5) * pitch + (row - 1) * bx, (row - 1) * by];
    for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 4; column += 1) {
            const [x, y] = at(column, row);
            if (column < 3) pen.line(x, y, ...at(column + 1, row));
            if (row < 2) pen.line(x, y, ...at(column, row + 1));
            pen.dot(x, y, 0.045);
        }
    }
    const [ox, oy] = at(1, 0);
    pen.line(ox, oy, ...at(2, 0), 0, 2.2);
    pen.line(ox, oy, ...at(1, 1), 0, 2.2);
    pen.note('a', ox + pitch / 2, oy - 0.14, 0.16, 0.5);
    pen.note('b', ox + bx / 2 - 0.14, oy + by / 2, 0.16, 0.5);
    // 原胞里的第二种原子：空心圆
    for (let column = 0; column < 3; column += 1) {
        const [x, y] = at(column, 1);
        pen.arc(x + (pitch + bx) / 2, y + by / 2, 0.05);
    }
    pen.note(choose(rng, ['nλ = 2d sinθ', 'a = 5.43 Å', '(1 1 1)', 'G · R = 2πn']), -0.9, -0.82, 0.15);
};

/** 晶胞：斜着看的立方体（后面的棱是虚线），角上的原子，面心或体心。 */
const drawCell = (pen: Pen, rng: Rng) => {
    const half = 0.52;
    const front: Array<[number, number]> = [[-half - 0.2, -half - 0.14], [half - 0.2, -half - 0.14], [half - 0.2, half - 0.14], [-half - 0.2, half - 0.14]];
    const back = front.map(([x, y]): [number, number] => [x + 0.44, y + 0.32]);
    for (let index = 0; index < 4; index += 1) {
        const next = (index + 1) % 4;
        pen.line(...front[index], ...front[next]);
        pen.line(...back[index], ...back[next], index === 0 || index === 3 ? 7 : 0);
        pen.line(...front[index], ...back[index], index === 0 ? 5 : 0);
        pen.dot(...front[index], 0.055);
        pen.dot(...back[index], 0.045);
    }
    const faceCentred = rng() < 0.5;
    if (faceCentred) {
        for (const face of [front, back]) pen.arc((face[0][0] + face[2][0]) / 2, (face[0][1] + face[2][1]) / 2, 0.06);
        for (const index of [0, 1, 2, 3]) {
            const next = (index + 1) % 4;
            pen.arc((front[index][0] + back[next][0]) / 2, (front[index][1] + back[next][1]) / 2, 0.05);
        }
    } else {
        pen.dot(0.02, 0.02, 0.075);
        pen.line(...front[0], ...back[2], 9);
    }
    pen.note(faceCentred ? 'fcc' : 'bcc', -half - 0.2, half + 0.38, 0.18);
    pen.note(choose(rng, ['a = 3.61 Å', 'a = 2.87 Å', '[1 0 0]', 'Z = 4']), -half - 0.2, -half - 0.36, 0.14);
};

/** 分子：苯环的骨架式（带取代基），或者球棍式的小分子（标着键角）。 */
const drawMolecule = (pen: Pen, rng: Rng) => {
    if (rng() < 0.55) {
        const vertex = (index: number, radius: number): [number, number] => [Math.cos(Math.PI / 6 + (index * Math.PI) / 3) * radius, Math.sin(Math.PI / 6 + (index * Math.PI) / 3) * radius];
        for (let index = 0; index < 6; index += 1) {
            pen.line(...vertex(index, 0.5), ...vertex(index + 1, 0.5));
            if (index % 2 === 0) {
                const [ax, ay] = vertex(index, 0.39);
                const [bx, by] = vertex(index + 1, 0.39);
                pen.line(ax + (bx - ax) * 0.12, ay + (by - ay) * 0.12, bx + (ax - bx) * 0.12, by + (ay - by) * 0.12);
            }
        }
        const groups = shuffle(rng, ['OH', 'NH₂', 'CH₃', 'Cl', 'COOH']);
        shuffle(rng, [0, 1, 2, 3, 4, 5]).slice(0, 1 + Math.floor(rng() * 2)).forEach((index, order) => {
            const [x, y] = vertex(index, 0.5);
            const [ex, ey] = vertex(index, 0.86);
            pen.line(x, y, ex, ey);
            pen.note(groups[order], ...vertex(index, 1.02), 0.16, 0.5);
        });
        pen.note(choose(rng, ['C₆H₆', 'sp²', 'π', '1.39 Å']), 0, -1.05, 0.15, 0.5);
        return;
    }
    const [arms, angle, formula] = choose(rng, [[2, 104.5, 'H₂O'], [3, 120, 'BF₃'], [4, 109.5, 'CH₄'], [2, 180, 'CO₂']] as const);
    const spread = arms === 2 ? (angle * Math.PI) / 180 : TAU / arms;
    const start = Math.PI / 2 - (arms === 2 ? spread / 2 : 0);
    pen.dot(0, 0, 0.13);
    for (let index = 0; index < arms; index += 1) {
        const direction = start + index * spread;
        pen.line(Math.cos(direction) * 0.14, Math.sin(direction) * 0.14, Math.cos(direction) * 0.62, Math.sin(direction) * 0.62, 0, 1.6);
        pen.dot(Math.cos(direction) * 0.7, Math.sin(direction) * 0.7, 0.08);
    }
    if (angle < 180) {
        pen.arc(0, 0, 0.3, start + spread / 2, spread / 2);
        pen.note(`${angle}°`, Math.cos(start + spread / 2) * 0.42, Math.sin(start + spread / 2) * 0.42, 0.13, 0.5);
    }
    pen.note(formula, 0, -0.95, 0.18, 0.5);
};

/** 探测器的截面：几层探测器，从对撞点出来、在磁场里弯的径迹，外面一圈量能器的能量柱。 */
const drawDetector = (pen: Pen, rng: Rng) => {
    pen.arc(0, 0, 0.32);
    pen.arc(0, 0, 0.62);
    pen.arc(0, 0, 1, 0, Math.PI, 1.6);
    pen.dot(0, 0, 0.035);
    for (let track = 5 + Math.floor(rng() * 4); track > 0; track -= 1) {
        const bend = span(rng, 0.55, 2.4);
        const direction = rng() * TAU;
        const side = rng() < 0.5 ? 1 : -1;
        const reach = rng() < 0.3 ? 0.62 : 1;
        const centre = direction + (side * Math.PI) / 2;
        const half = Math.asin(Math.min(1, reach / (2 * bend)));
        pen.arc(Math.cos(centre) * bend, Math.sin(centre) * bend, bend, centre + Math.PI + side * half, half);
    }
    const jets = [rng() * TAU, rng() * TAU];
    for (let tower = 7 + Math.floor(rng() * 4); tower > 0; tower -= 1) {
        const angle = choose(rng, jets) + span(rng, -0.35, 0.35);
        const height = span(rng, 0.05, 0.3);
        pen.line(Math.cos(angle) * 1.04, Math.sin(angle) * 1.04, Math.cos(angle) * (1.04 + height), Math.sin(angle) * (1.04 + height), 0, 2.4);
    }
    pen.note(choose(rng, ['√s = 13 TeV', 'pT > 20 GeV', '|η| < 2.5', 'B = 3.8 T']), -1, -1.3, 0.14);
};

/** 费曼图：s 道湮灭、t 道交换，或者传播子上的一个圈。 */
const drawFeynman = (pen: Pen, rng: Rng) => {
    const variant = Math.floor(rng() * 3);
    if (variant === 0) {
        const [inA, inB, boson, outA, outB] = choose(rng, [['e⁻', 'e⁺', 'γ', 'μ⁻', 'μ⁺'], ['u', 'd', 'W', 'e', 'ν'], ['q', 'q', 'g', 't', 't']] as const);
        pen.arrow(-1, 0.6, -0.35, 0);
        pen.arrow(-0.35, 0, -1, -0.6);
        pen.wave(-0.35, 0, 0.35, 0, 7, 0.07);
        pen.arrow(0.35, 0, 1, 0.6);
        pen.arrow(1, -0.6, 0.35, 0);
        pen.dot(-0.35, 0, 0.04);
        pen.dot(0.35, 0, 0.04);
        pen.note(inA, -1.02, 0.78, 0.17, 0.5);
        pen.note(inB, -1.02, -0.78, 0.17, 0.5);
        pen.note(boson, 0, 0.22, 0.17, 0.5);
        pen.note(outA, 1.02, 0.78, 0.17, 0.5);
        pen.note(outB, 1.02, -0.78, 0.17, 0.5);
    } else if (variant === 1) {
        for (const y of [0.45, -0.45]) {
            pen.arrow(-1, y, 0, y);
            pen.arrow(0, y, 1, y);
            pen.dot(0, y, 0.04);
        }
        pen.wave(0, 0.45, 0, -0.45, 9, 0.07);
        pen.note('e⁻', -1.02, 0.64, 0.17, 0.5);
        pen.note('p', -1.02, -0.66, 0.17, 0.5);
        pen.note('γ', 0.2, 0, 0.17, 0.5);
        pen.note('−ie γμ', 0.2, 0.68, 0.13);
    } else {
        pen.wave(-1, 0, -0.4, 0, 7, 0.07);
        pen.arc(0, 0, 0.4);
        pen.wave(0.4, 0, 1, 0, 7, 0.07);
        pen.dot(-0.4, 0, 0.04);
        pen.dot(0.4, 0, 0.04);
        pen.line(0, 0.4, -0.1, 0.46);
        pen.line(0, 0.4, -0.1, 0.34);
        pen.line(0, -0.4, 0.1, -0.34);
        pen.line(0, -0.4, 0.1, -0.46);
        pen.note('γ', -0.72, 0.2, 0.17, 0.5);
        pen.note('k', 0, 0.6, 0.15, 0.5);
        pen.note('O(α²)', 0.5, -0.66, 0.14);
    }
    pen.line(-0.9, -1, 0.9, -1, 0, 0.8);
    pen.line(0.9, -1, 0.8, -0.95, 0, 0.8);
    pen.line(0.9, -1, 0.8, -1.05, 0, 0.8);
    pen.note('t', 1, -1, 0.14);
};

/** 路径积分：两点之间所有可能的路径——一条直的经典路径和一族越绕越远的。 */
const drawPaths = (pen: Pen, rng: Rng) => {
    pen.dot(-0.9, 0, 0.06);
    pen.dot(0.9, 0, 0.06);
    pen.line(-0.9, 0, 0.9, 0, 0, 1.5);
    for (let halfWaves = 1; halfWaves <= 6; halfWaves += 1) pen.wave(-0.9, 0, 0.9, 0, halfWaves, span(rng, 0.12, 0.6) / Math.sqrt(halfWaves));
    pen.note('A', -1.08, 0, 0.17, 0.5);
    pen.note('B', 1.08, 0, 0.17, 0.5);
    pen.note(choose(rng, ['Z = ∫Dφ exp(iS/ħ)', 'δS = 0', 'S = ∫ L dt', '⟨B|A⟩ = Σ exp(iS/ħ)']), -0.9, -0.85, 0.15);
};

const FORMULAS = [
    'E² = p²c² + m²c⁴', 'S = ∫ L d⁴x', '∇·E = ρ/ε₀', 'Δx Δp ≥ ħ/2', 'r = 2GM/c²', '1/(p² − m² + iε)', '∫ d⁴k/(2π)⁴', 'α ≈ 1/137',
    'Σ 1/n² = π²/6', 'H ψ = E ψ', '∂μ Fμν = Jν', 'T = 2.725 K', 'F = G m₁m₂/r²', 'dS ≥ 0', 'β = −11 + 2n/3',
] as const;

/** 演算草稿：几行公式，一行划掉、一行底下划线、一行框起来；旁边一张小图，共振峰上落着数据点。 */
const drawDraft = (pen: Pen, rng: Rng) => {
    const lines = shuffle(rng, FORMULAS).slice(0, 4);
    const struck = Math.floor(rng() * 2);
    const boxed = 3;
    lines.forEach((text, row) => {
        const y = 0.85 - row * 0.3;
        const width = Array.from(text).length * 0.085;
        pen.note(text, -1, y, 0.16);
        if (row === struck) pen.line(-1.04, y - 0.03, -1 + width + 0.04, y + 0.04);
        if (row === 2) pen.line(-1, y - 0.12, -1 + width, y - 0.12);
        if (row === boxed) {
            const [x0, x1, y0, y1] = [-1.08, -1 + width + 0.08, y - 0.14, y + 0.14];
            pen.line(x0, y0, x1, y0);
            pen.line(x1, y0, x1, y1);
            pen.line(x1, y1, x0, y1);
            pen.line(x0, y1, x0, y0);
        }
    });
    const [ox, oy] = [-0.2, -1.1];
    pen.line(ox, oy, ox + 1.2, oy);
    pen.line(ox, oy, ox, oy + 0.62);
    const peak = span(rng, 0.45, 0.8);
    for (let index = 0; index < 11; index += 1) {
        const x = 0.08 + index * 0.1;
        const offset = (x - peak) / 0.11;
        pen.dot(ox + x, oy + 0.06 + 0.5 / (1 + offset * offset) + span(rng, -0.025, 0.025), 0.022);
    }
    pen.line(ox + peak, oy, ox + peak, oy + 0.6, 7);
    pen.note(choose(rng, ['m = 125 GeV', 'Γ', 'm₀', 'σ(E)']), ox + peak + 0.06, oy + 0.64, 0.13);
    pen.note(choose(rng, ['∴', '= 0 ?', '→ ∞', '+ h.c.', 'QED']), 0.55, 0.55, 0.2);
};

const DRAW: Record<MetaphorFigureKind, (pen: Pen, rng: Rng) => void> = {
    orbit: drawOrbit, starmap: drawStarmap, lattice: drawLattice, cell: drawCell, molecule: drawMolecule,
    detector: drawDetector, feynman: drawFeynman, paths: drawPaths, draft: drawDraft,
};

/** 垫在字后面的那张：只进半调，线粗到网点画得出来。 */
const TONE_MIX = { ink: 0, tone: 0.75, accent: 0 };
const TONE_HEAVY = 2.6;

/** 一张图单独画出来：中心在 (x, y)，大小 scale。toned 时画成垫在字后面的那种（只进半调、粗线、不带注记）。 */
export const drawMetaphorFigure = (
    kind: MetaphorFigureKind, rng: Rng, x = 0, y = 0, scale = 1, rot = 0, delay = 0, toned = false,
): MetaphorFigures => {
    const pen = toned ? new Pen(x, y, scale, rot, delay, TONE_MIX, TONE_HEAVY) : new Pen(x, y, scale, rot, delay);
    DRAW[kind](pen, rng);
    if (toned) return { shapes: pen.shapes, notes: [] };
    return { shapes: pen.shapes, notes: pen.notes };
};

/** 间奏时图摆在舞台的这几处（半宽、半高的倍数）。 */
const STAGE_SLOTS: ReadonlyArray<[number, number]> = [[-0.72, 0.3], [0.72, -0.3], [0, -0.1]];
/** 一张图连注记大约占它 scale 的多少倍。 */
const FIGURE_REACH = 1.35;

/**
 * 一个 cue 的几张图。歌词：摆在字的包围盒外面，四边里挑几边，一边一张，不压字。间奏：摆在舞台里。
 * amount 是设置里「融球」的倍数（0 就没有）。
 */
export const planMetaphorFigures = (bounds: MetaphorRect, rng: Rng, amount: number, interlude: boolean): MetaphorFigures => {
    const figures: MetaphorFigures = { shapes: [], notes: [] };
    if (amount <= 0) return figures;
    const halfW = (bounds.x1 - bounds.x0) / 2;
    const halfH = (bounds.y1 - bounds.y0) / 2;
    const reach = Math.max(halfW, halfH, 2);
    const total = interlude ? Math.min(STAGE_SLOTS.length, 1 + Math.round(amount)) : Math.min(4, Math.max(1, Math.round(1.6 * amount + rng() * 0.9)));
    const kinds = shuffle(rng, METAPHOR_FIGURE_KINDS);
    const sides = shuffle(rng, [0, 1, 2, 3]);
    // 垫在字后面的那张：和字块差不多大，略偏一点
    const under = drawMetaphorFigure(
        kinds[total], rng, span(rng, -0.35, 0.35) * halfW, span(rng, -0.35, 0.35) * halfH,
        reach * (interlude ? 0.6 : 0.85) * span(rng, 0.85, 1.2), span(rng, -0.3, 0.3), 0, true,
    );
    figures.shapes.push(...under.shapes);
    for (let index = 0; index < total; index += 1) {
        const scale = (interlude ? 1.2 : Math.min(2, Math.max(1, reach * 0.36))) * span(rng, 0.85, 1.15);
        const out = scale * FIGURE_REACH + 0.2;
        let x: number;
        let y: number;
        if (interlude) {
            const [slotX, slotY] = STAGE_SLOTS[index % STAGE_SLOTS.length];
            x = slotX * halfW + span(rng, -0.25, 0.25);
            y = slotY * halfH + span(rng, -0.3, 0.3);
        } else {
            const side = sides[index];
            const along = span(rng, -0.7, 0.7);
            // 上、下、左、右
            x = side < 2 ? along * halfW : (side === 2 ? -1 : 1) * (halfW + out);
            y = side < 2 ? (side === 0 ? 1 : -1) * (halfH + out) : along * halfH;
        }
        const figure = drawMetaphorFigure(kinds[index % kinds.length], rng, x, y, scale, span(rng, -0.12, 0.12), 0.3 + index * 0.7);
        figures.shapes.push(...figure.shapes);
        figures.notes.push(...figure.notes);
    }
    figures.shapes.length = Math.min(figures.shapes.length, FIGURE_LIMIT);
    return figures;
};

export interface MetaphorCueInfo {
    /** 第几句（从 1 数），间奏是 0。 */
    index: number;
    /** 开唱的时刻（秒）。 */
    time: number;
}

const pad2 = (value: number) => String(Math.max(0, Math.floor(value))).padStart(2, '0');
const timecode = (seconds: number) => `${pad2(seconds / 60)}:${pad2(seconds % 60)}`;

/**
 * 一个 cue 的版面：字后面的一层网点，和贴着字块的规线、裁切标记、行号与时间码（只有歌词有）。
 * 网点那层只进半调，不是墨，压在字后面不碍着读字。
 */
export const planMetaphorBackdrop = (bounds: MetaphorRect, rng: Rng, amount: number, interlude: boolean, info: MetaphorCueInfo): MetaphorFigures => {
    const halfW = (bounds.x1 - bounds.x0) / 2;
    const halfH = (bounds.y1 - bounds.y0) / 2;
    const reach = Math.max(halfW, halfH, 2);
    const shapes: MetaphorShape[] = [];
    const tone = (shape: number, patch: Partial<MetaphorShape>) => shapes.push(staticMetaphorShape(shape, { ink: 0, accent: 0, ...patch }));

    if (amount > 0) {
        const layer = choose(rng, ['band', 'band', 'grid', 'arcs', 'dots', 'plain'] as const);
        if (layer === 'band') {
            // 一条平的网点色带，横着、竖着或者斜着穿过字块
            const upright = rng() < 0.3;
            const half = (upright ? halfW : halfH) * span(rng, 0.3, 0.75);
            const shift = (upright ? halfW : halfH) * span(rng, -0.7, 0.7);
            tone(METAPHOR_SHAPE_BAR, {
                x: upright ? shift : 0, y: upright ? 0 : shift, sx: reach * 9, sy: half, tone: span(rng, 0.3, 0.5),
                rot: (upright ? Math.PI / 2 : 0) + (rng() < 0.4 ? span(rng, -0.2, 0.2) : 0),
            });
        } else if (layer === 'grid') {
            // 方格纸
            const pitch = Math.max(1, reach / 3.5);
            const columns = Math.min(7, Math.ceil((halfW + pitch * 2) / pitch));
            const rows = Math.min(5, Math.ceil((halfH + pitch * 2) / pitch));
            for (let column = -columns; column <= columns; column += 1) {
                tone(METAPHOR_SHAPE_BAR, { x: column * pitch, sx: rows * pitch, sy: 0.022, rot: Math.PI / 2, tone: column === 0 ? 0.8 : 0.4 });
            }
            for (let row = -rows; row <= rows; row += 1) {
                tone(METAPHOR_SHAPE_BAR, { y: row * pitch, sx: columns * pitch, sy: 0.022, tone: row === 0 ? 0.8 : 0.4 });
            }
        } else if (layer === 'arcs') {
            // 圆心在画外一角的几圈同心弧
            const cx = (rng() < 0.5 ? -1 : 1) * (halfW + reach * 0.6);
            const cy = (rng() < 0.5 ? -1 : 1) * (halfH + reach * 0.4);
            for (let ring = 1; ring <= 5; ring += 1) {
                tone(METAPHOR_SHAPE_ARC, { x: cx, y: cy, sx: (reach * 0.7 * ring) / ARC_AT, sy: 2.5, param: 1, tone: 0.55 });
            }
        } else if (layer === 'dots') {
            // 点阵
            const pitch = Math.max(0.9, reach / 3);
            const skew = rng() < 0.5 ? 0.5 : 0;
            for (let row = -2; row <= 2; row += 1) {
                for (let column = -3; column <= 3; column += 1) {
                    tone(METAPHOR_SHAPE_BLOB, { x: (column + (row % 2 === 0 ? 0 : skew)) * pitch, y: row * pitch * 0.87, sx: 0.2, sy: 0.2, tone: 1 });
                }
            }
        }
    }
    shapes.length = Math.min(shapes.length, BACKDROP_LIMIT);
    if (interlude) return { shapes, notes: [] };

    // 版面零件：贴着字块，画成墨线，开头就在
    const pen = new Pen(0, 0, 1, 0, 0);
    const furniture = choose(rng, ['rules', 'rules', 'crop', 'margin', 'none'] as const);
    const left = -halfW - 0.1;
    const right = halfW + 0.1;
    const size = Math.min(0.34, Math.max(0.2, reach * 0.07));
    if (furniture === 'rules') {
        // 上面一道粗线、下面一道细线，行号和时间码压在线外
        pen.line(left, halfH + 0.3, right, halfH + 0.3, 0, 2.6);
        pen.line(left, -halfH - 0.3, right, -halfH - 0.3);
        pen.note(pad2(info.index), left, halfH + 0.3 + size * 0.95, size);
        pen.note(timecode(info.time), right, -halfH - 0.3 - size * 0.95, size, 1);
    } else if (furniture === 'crop') {
        // 四角的裁切标记
        for (const sx of [-1, 1]) {
            for (const sy of [-1, 1]) {
                const x = sx * (halfW + 0.3);
                const y = sy * (halfH + 0.3);
                pen.line(x + sx * 0.12, y, x + sx * 0.5, y);
                pen.line(x, y + sy * 0.12, x, y + sy * 0.5);
            }
        }
        pen.note(`${pad2(info.index)} — ${timecode(info.time)}`, 0, -halfH - 0.3 - size * 1.1, size, 0.5);
    } else if (furniture === 'margin') {
        // 左边一道竖线带刻度，行号竖着写在线外
        const x = left - 0.3;
        pen.line(x, -halfH, x, halfH, 0, 1.8);
        for (let tick = 0; tick <= 4; tick += 1) {
            const y = -halfH + (tick * halfH) / 2;
            pen.line(x, y, x + (tick % 2 === 0 ? 0.22 : 0.12), y);
        }
        pen.note(`${pad2(info.index)} / ${timecode(info.time)}`, x - size * 0.9, halfH, size, 1, Math.PI / 2);
    }
    return { shapes: [...shapes, ...pen.shapes], notes: pen.notes };
};

/** 注记排成一个个字：按量出来的字宽沿注记的方向排开。 */
export const layoutMetaphorNotes = (notes: readonly MetaphorNote[], measure: MetaphorMeasure): MetaphorNoteGlyph[] => {
    const glyphs: MetaphorNoteGlyph[] = [];
    for (const note of notes) {
        const chars = Array.from(note.text);
        const advances = chars.map(char => measure(char) * note.size);
        const total = advances.reduce((sum, advance) => sum + advance, 0);
        const cos = Math.cos(note.rot);
        const sin = Math.sin(note.rot);
        let pen = -total * note.align;
        chars.forEach((char, index) => {
            const along = pen + advances[index] / 2;
            pen += advances[index];
            if (char.trim() === '') return;
            glyphs.push({ char, x: note.x + along * cos, y: note.y + along * sin, size: note.size, rot: note.rot, born: note.born });
        });
    }
    return glyphs;
};
