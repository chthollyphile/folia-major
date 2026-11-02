// src/components/visualizer/nebbia/nebbiaSnowFlakes.ts
// 雪窗的雪花贴图（nebbiaSnow.ts 用）。落在玻璃上的雪多半不是一片干净的六角星：六成是几个小晶体黏成的不规则一团（clump），
// 四成是枝晶（star，六根枝长短略有差别、侧枝各不一样，一半缺一两个角），都撒着霜粒。先把一片雪画成一张「密度图」（团、霜粒厚，枝梢薄），
// 再按融化程度出 STAGES 张阶段贴图：密度低于阈值的地方（细枝、薄边）先没，剩下的越来越湿、越透、偏灰蓝，边上一圈薄水边；
// 外面一圈很淡的暗晕，看着是贴在玻璃上。每种还记下最厚的两三处「疙瘩」，化的时候水从那里渗出来。
// 另有冻住的水珠（bead，nebbiaSnowWater.ts 里停久了结冰的水珠）：中间一团发白的冰芯、几道放射的冰纹，边上是清的冰；
// 它的阶段倒过来用：冻得越透阶段越靠前（冰芯从最厚的中间往外长）。
// 全部阶段贴图拼成一张图集（每种一行、每个阶段一格），WebGL 里画（nebbiaSnowGl.ts）。

export const FLAKE_SPRITE = 64;
/** 贴图里雪占的半径（贴图边长的比例 × 边长）。 */
export const FLAKE_R = FLAKE_SPRITE * 0.42;
export const FLAKE_STAGES = 16;
/** 雪的直径占贴图边长的比例：画的时候按它缩放到雪花半径。 */
export const FLAKE_FILL = 0.84;

export type FlakeType = 'clump' | 'star' | 'bead';

export interface FlakeKind {
    type: FlakeType;
    /** 图集里第几行。 */
    row: number;
    /** 从刚落下（0）到化没（STAGES - 1）的阶段贴图。 */
    stages: ImageData[];
    /** 水先渗出来的几处：贴图里的位置（单位是 FLAKE_R）、分到的水的比例。 */
    lumps: { x: number; y: number; w: number }[];
}

interface Disc { x: number; y: number; r: number; a: number }
interface Arm { ang: number; len: number; w: number; branches: { at: number; len: number; ang: number; side: number }[] }

const TAU = Math.PI * 2;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const canvas = () => { const c = document.createElement('canvas'); c.width = c.height = FLAKE_SPRITE; return c; };

/** 随机一片雪的形状：团是小晶体一个黏一个随机游走黏成的；枝晶有的缺一两个角（不做伸出去的碎断枝）。 */
const shape = (type: FlakeType) => {
    const arms: Arm[] = [], discs: Disc[] = [], specks: { x: number; y: number; r: number }[] = [];
    const armWidth = rand(0.13, 0.18);
    const branchesFor = (len: number) => {
        const out: Arm['branches'] = [];
        for (let at = rand(0.2, 0.4); at < len - 0.08; at += rand(0.14, 0.28)) {
            if (Math.random() < 0.3) continue;
            out.push({ at, len: rand(0.1, 0.3) * (1 - at), ang: rand(0.85, 1.2), side: Math.random() < 0.25 ? (Math.random() < 0.5 ? 1 : -1) : 0 });
        }
        return out;
    };
    if (type === 'bead') {
        // 冻住的水珠：中间一团（冻的时候挤出来的气泡发白），周围几小团不规则，几道放射的细冰纹
        discs.push({ x: rand(-0.05, 0.05), y: rand(-0.05, 0.05), r: rand(0.45, 0.55), a: 0.95 });
        for (let i = 0, n = 4 + Math.floor(Math.random() * 3); i < n; i += 1) {
            const a = Math.random() * TAU, dd = rand(0.15, 0.32);
            discs.push({ x: Math.cos(a) * dd, y: Math.sin(a) * dd, r: rand(0.18, 0.3), a: rand(0.55, 0.8) });
        }
        for (let i = 0, n = 5 + Math.floor(Math.random() * 3); i < n; i += 1) {
            arms.push({ ang: Math.random() * TAU, len: rand(0.45, 0.75), w: rand(0.04, 0.07), branches: [] });
        }
    } else if (type === 'clump') {
        let px = 0, py = 0, pa = Math.random() * TAU;
        for (let i = 0, n = 7 + Math.floor(Math.random() * 10); i < n; i += 1) {
            discs.push({ x: px, y: py, r: rand(0.1, 0.22), a: rand(0.6, 0.95) });
            pa += rand(-1.6, 1.6);
            const step = rand(0.07, 0.15);
            px = Math.max(-0.42, Math.min(0.42, px + Math.cos(pa) * step));
            py = Math.max(-0.42, Math.min(0.42, py + Math.sin(pa) * step));
        }
    } else {
        discs.push({ x: 0, y: 0, r: rand(0.1, 0.22), a: 0.9 });
        const base = rand(0.7, 1);
        // 缺角：一半的枝晶有一根枝短一截（四成干脆没了），少数再缺一根；断口是圆的，不留碎枝
        const chipped = new Set<number>();
        if (Math.random() < 0.5) chipped.add(Math.floor(Math.random() * 6));
        if (chipped.size && Math.random() < 0.3) chipped.add(Math.floor(Math.random() * 6));
        for (let i = 0; i < 6; i += 1) {
            if (chipped.has(i) && Math.random() < 0.4) continue;
            const len = base * rand(0.86, 1) * (chipped.has(i) ? rand(0.3, 0.6) : 1);
            arms.push({ ang: i * TAU / 6 + rand(-0.05, 0.05), len, w: armWidth * rand(0.9, 1.1), branches: branchesFor(len) });
        }
        if (Math.random() < 0.5) discs.push({ x: rand(-0.2, 0.2), y: rand(-0.2, 0.2), r: rand(0.12, 0.25), a: 0.6 });
    }
    // 霜粒：沿着枝、团上撒的小颗粒
    for (let i = 0, n = 6 + Math.floor(Math.random() * 14); i < n; i += 1) {
        if (arms.length && Math.random() < 0.6) {
            const arm = arms[Math.floor(Math.random() * arms.length)], at = Math.random() * arm.len;
            specks.push({ x: Math.cos(arm.ang) * at + rand(-0.04, 0.04), y: Math.sin(arm.ang) * at + rand(-0.04, 0.04), r: rand(0.025, 0.06) });
        } else {
            const d = discs[Math.floor(Math.random() * discs.length)], a = Math.random() * TAU, dd = Math.random() * d.r;
            specks.push({ x: d.x + Math.cos(a) * dd, y: d.y + Math.sin(a) * dd, r: rand(0.03, 0.07) });
        }
    }
    const lumps = discs.slice().sort((p, q) => q.r - p.r).slice(0, 3).map(d => ({ x: d.x, y: d.y, w: d.r * d.r }));
    const sw = lumps.reduce((s, l) => s + l.w, 0);
    for (const l of lumps) l.w /= sw;
    return { arms, discs, specks, lumps };
};

/** 形状画成密度图（alpha 就是厚度），先糊 blur 像素；返回 alpha 通道。 */
const density = (sh: ReturnType<typeof shape>, blur: number): Uint8ClampedArray => {
    const c = canvas(), x = c.getContext('2d')!, R = FLAKE_R;
    x.translate(FLAKE_SPRITE / 2, FLAKE_SPRITE / 2);
    x.lineCap = 'round';
    for (const d of sh.discs) {
        const g = x.createRadialGradient(d.x * R, d.y * R, 0, d.x * R, d.y * R, d.r * R);
        g.addColorStop(0, `rgba(255,255,255,${d.a})`); g.addColorStop(0.6, `rgba(255,255,255,${d.a * 0.6})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.beginPath(); x.arc(d.x * R, d.y * R, d.r * R, 0, TAU); x.fill();
    }
    // 枝比团薄（密度低），化的时候先没
    for (const a of sh.arms) {
        x.save(); x.rotate(a.ang);
        x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = a.w * R;
        x.beginPath(); x.moveTo(0, 0); x.lineTo(a.len * R, 0); x.stroke();
        x.strokeStyle = 'rgba(255,255,255,0.42)'; x.lineWidth = a.w * R * 0.75;
        for (const b of a.branches) for (const s of [-1, 1]) {
            if (b.side && b.side !== s) continue;
            x.beginPath(); x.moveTo(b.at * R, 0); x.lineTo((b.at + Math.cos(b.ang) * b.len) * R, s * Math.sin(b.ang) * b.len * R); x.stroke();
        }
        x.restore();
    }
    x.fillStyle = 'rgba(255,255,255,0.95)';
    for (const s of sh.specks) { x.beginPath(); x.arc(s.x * R, s.y * R, s.r * R, 0, TAU); x.fill(); }
    const out = canvas(), ox = out.getContext('2d')!;
    ox.filter = `blur(${blur}px)`;
    ox.drawImage(c, 0, 0);
    const px = ox.getImageData(0, 0, FLAKE_SPRITE, FLAKE_SPRITE).data, a = new Uint8ClampedArray(FLAKE_SPRITE * FLAKE_SPRITE);
    for (let i = 0; i < a.length; i += 1) a[i] = px[i * 4 + 3];
    return a;
};

/** 一种雪花的全部阶段贴图：刚落的雪白、霜粒更亮、外圈淡暗晕；化的时候薄的先没，剩下的更透、偏灰蓝，边上一圈薄水边。 */
export const buildFlakeKind = (type: FlakeType, row: number): FlakeKind => {
    const sh = shape(type);
    const D = density(sh, 0.35), S = density(sh, 2);
    const snow = [228, 236, 250], wetCol = [196, 212, 236], dark = [16, 20, 30];
    const stages: ImageData[] = [];
    for (let s = 0; s < FLAKE_STAGES; s += 1) {
        const m = s / (FLAKE_STAGES - 1), t = m * 0.85;
        const img = new ImageData(FLAKE_SPRITE, FLAKE_SPRITE), o = img.data;
        for (let i = 0; i < D.length; i += 1) {
            const d = D[i] / 255, ds = S[i] / 255;
            const keep = smooth(t, t + 0.3, d), ice = keep * (0.88 - 0.45 * m);
            const wet = m > 0 ? smooth(t - 0.2, t, d) * smooth(0.04, 0.12, d) * (1 - keep) * 0.32 * Math.min(1, m * 2) : 0;
            const halo = Math.min(1, ds * 2) * (1 - keep) * 0.2 * (1 - m);
            const a2 = ice + wet;
            if (a2 + halo < 0.004) continue;
            const spec = smooth(0.8, 1, d) * (1 - m), a = a2 + halo * (1 - a2);
            for (let ch = 0; ch < 3; ch += 1) {
                const sc = snow[ch] + (255 - snow[ch]) * spec;
                const c2 = a2 > 0 ? (sc * ice + wetCol[ch] * wet) / a2 : 0;
                o[i * 4 + ch] = (c2 * a2 + dark[ch] * halo * (1 - a2)) / a;
            }
            o[i * 4 + 3] = a * 255;
        }
        stages.push(img);
    }
    return { type, row, stages, lumps: sh.lumps };
};

/** 全部种类拼成一张图集：第 k 行是第 k 种，第 s 列是第 s 个阶段。 */
export const buildFlakeAtlas = (kinds: readonly FlakeKind[]): HTMLCanvasElement => {
    const c = document.createElement('canvas'), x = c.getContext('2d')!;
    c.width = FLAKE_SPRITE * FLAKE_STAGES; c.height = FLAKE_SPRITE * kinds.length;
    kinds.forEach((k, row) => k.stages.forEach((img, col) => x.putImageData(img, col * FLAKE_SPRITE, row * FLAKE_SPRITE)));
    return c;
};
