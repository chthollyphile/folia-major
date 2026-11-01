import { clamp, NEBBIA_FIXED, smooth } from './nebbiaConstants';
import { isIconChar, type NebbiaChar, type NebbiaSourceLine } from './nebbiaChars';
import { isWideChar } from './nebbiaBlocks';
import { pointAt, warpGlyph, type NebbiaGlyphCache, type Glyph } from './nebbiaGlyphs';
import { layoutNebbiaSong } from './nebbiaLayout';
import type { NebbiaBreath } from './nebbiaBreath';
import type { NebbiaWipe } from './nebbiaWipe';
import type { NebbiaTuning } from './types';
import { createVisualizerRng, hashVisualizerSeed } from '../visualizerSeedHash';

// src/components/visualizer/nebbia/nebbiaScene.ts
// 一首歌在雾笺上的全部安排：每个字的位置、变形后的字形、擦痕边的水珠和下淌的水珠、出现方式（手写或透出）；
// 每句的淡出方式和「让位」时刻（后面某句要写到这句的位置、而这句还没被雾吞掉时，这句提前快速起雾，
// 屏上满了来不及的就哈一口气盖掉，nebbiaBreath.ts）。
// 只由歌词、tuning 和屏幕尺寸决定；每帧怎么画在 nebbiaMask.ts。

export interface Bead { s: number; x: number; y: number; nx: number; ny: number; r: number; j: number }
export interface Drip { delay: number; len: number; dur: number; r: number; seed: number }
export interface LaidChar extends NebbiaChar {
    x: number; y: number; s: number; rot: number;
    /** 手写变形后的字形；空格、画不出来的字没有。 */
    glyph: Glyph | null;
    beads: Bead[][];
    drips: (Drip | null)[];
    ends: { h: number; j: number }[];
    /** 慢慢显现用几秒；0 = 手指书写。 */
    appearDur: number;
    /** 手指书写的开始时刻和用时（不早于开唱，前一个字写完才轮到它），见 applyAppear。 */
    wt: number; wd: number;
}
export interface LaidLine {
    chars: LaidChar[];
    t: number; end: number; next: number;
    mode: 'fog' | 'fingers';
    /** 开始起雾（或手指抹除）的时刻：屏上还空着时比 fogStartOf 晚，见 buildNebbiaScene。 */
    fogAt: number;
    yieldAt: number;
    /** 手指抹除的几何，第一次用到时才建（undefined = 还没建，null = 没有可抹的字）。 */
    wipe?: NebbiaWipe | null;
    /**
     * 让位时还没消失：屏上满了、后面那句要写到这里，就对着这句哈一口气把它盖掉（nebbiaBreath.ts）。
     * breathAt 是开始哈的时刻（Infinity = 不用哈），breathUntil 是白气开始散的时刻（后面那句唱完再留一会儿）。
     */
    breathAt: number;
    breathUntil: number;
    /** 出现方式选到「哈气后书写」的：开写前对着自己的位置哈一口气（Infinity = 不哈），白气留到 appearBreathUntil 再散。 */
    appearBreathAt: number;
    appearBreathUntil: number;
    /** 哈气的白气，第一次用到时才建（undefined = 还没建，null = 没有字）。 */
    breath?: NebbiaBreath | null;
}

/** 一句的消失方式：两种都开就按种子随机。 */
const lineModeOf = (fade: NebbiaTuning['fade'], idx: number, seed: number): 'fog' | 'fingers' => (
    fade.length === 1 ? fade[0] : (createVisualizerRng((seed + idx * 977 + 3) >>> 0)() < 0.5 ? 'fog' : 'fingers')
);
/** 写完后开始起雾的时刻：下一句开始（最多唱完 6 秒）后再保持 hold 秒。 */
export const fogStartOf = (end: number, next: number, hold: number) => Math.min(next, end + 6) + hold;
/** 屏上还空着时，一句最多比 fogStartOf 多留几秒；也最多留到后面第 LINGER_LINES 句开始后 hold 秒。 */
const LINGER_MAX = 16;
const LINGER_LINES = 3;

/** 一个字挑水珠：每一笔沿边缘零星凝出小水珠，少数笔画底部会淌下一颗。 */
const decorate = (c: LaidChar, base: Glyph, rnd: () => number, warp: number) => {
    const g = warpGlyph(base, createVisualizerRng(Math.floor(rnd() * 1e9)), warp);
    c.glyph = g;
    c.beads = g.strokes.map(st => {
        const out: Bead[] = [], step = 7 / c.s;
        for (let s = step * rnd(); s < st.len; s += step * (0.5 + rnd())) {
            if (rnd() > NEBBIA_FIXED.beads) continue;
            const [x, y, nx, ny] = pointAt(st, s), side = rnd() < 0.5 ? -1 : 1;
            out.push({ s, x, y, nx: nx * side, ny: ny * side, r: 1.6 + rnd() ** 2.2 * 3.6, j: rnd() });
        }
        return out;
    });
    c.drips = g.strokes.map(() => (rnd() < NEBBIA_FIXED.drip * 0.22
        ? { delay: 0.3 + rnd() * 1.6, len: 30 + rnd() * 130, dur: 2 + rnd() * 3.5, r: 3.2 + rnd() * 2.6, seed: rnd() * 100 } : null));
    // 收笔水珠的随机量放在最后取，不打乱前面的随机序列
    c.ends = g.strokes.map(() => ({ h: rnd(), j: rnd() }));
};

/** 自然书写一个字要几秒。 */
export const naturalWriteTime = (g: Glyph, speed: number) => (g.total * 0.28 + (g.strokes.length - 1) * 0.06) / speed;

/** 按速度系数 k（用时 = 自然用时 × k）一个接一个写，返回每个字的开始时刻和写完的时刻。 */
const scheduleWrite = (cs: LaidChar[], nat: number[], k: number) => {
    let end = -Infinity;
    const starts = cs.map((c, i) => { const t0 = Math.max(c.t, end); end = t0 + nat[i] * k; return t0; });
    return { starts, end };
};

/**
 * 一句的出现方式和书写节奏：写字不必跟着每个字唱的那一点，可以一直写到下一句开唱（或这句唱完，取晚的）。
 * 字照顺序一个接一个写，不早于开唱；整句统一一个速度系数，正好写完，最慢是自然速度、最快压到 0.3 倍。
 * 书写的两种（手指书写、哈气后书写）开着几种就按种子挑一种；慢慢显现也开着时，压到 0.3 倍都写不完的句子改成慢慢显现，
 * 只开慢慢显现就句句显现。
 */
const applyAppear = (line: LaidLine, tuning: NebbiaTuning, idx: number, seed: number) => {
    const kinds = tuning.appear.filter(a => a !== 'fade');
    const canFade = tuning.appear.includes('fade');
    const kind = kinds.length ? kinds[Math.floor(createVisualizerRng((seed + idx * 613 + 11) >>> 0)() * kinds.length)] : null;
    const cs = line.chars.filter(c => c.glyph);
    const nat = cs.map(c => naturalWriteTime(c.glyph!, tuning.writeSpeed));
    const until = Math.max(line.next, line.end);
    let k = 1;
    if (scheduleWrite(cs, nat, 1).end > until) {
        // 写完的时刻随 k 单调，二分找正好写完的 k
        let lo = 0.3, hi = 1;
        for (let n = 0; n < 14; n += 1) { const m = (lo + hi) / 2; if (scheduleWrite(cs, nat, m).end > until) hi = m; else lo = m; }
        k = lo;
    }
    const plan = scheduleWrite(cs, nat, k);
    const fade = !kind || (canFade && cs.length > 0 && plan.end > until + 1e-3);
    cs.forEach((c, i) => { c.wt = plan.starts[i]; c.wd = nat[i] * k; });
    if (kind === 'breath' && !fade && cs.length) {
        line.appearBreathAt = cs[0].wt - NEBBIA_FIXED.breathSpread - 0.3;
        line.appearBreathUntil = line.end + NEBBIA_FIXED.breathHold;
    }
    for (const c of line.chars) c.appearDur = fade ? clamp(c.d * 3, 0.35, 1.2) : 0;
};

/** 片尾的歌手等曲名写完再写：整句的书写时刻往后挪到曲名最后一个字写完后 0.4 秒。 */
const alignCredits = (laid: LaidLine[], source: NebbiaSourceLine[]) => {
    const ti = source.findIndex(l => l.credits === 'title'), ai = source.findIndex(l => l.credits === 'artist');
    if (ti < 0 || ai < 0) return;
    const written = laid[ti].chars.filter(c => c.glyph);
    const last = written[written.length - 1];
    if (!last) return;
    const first = laid[ai].chars.find(c => c.glyph);
    const shift = first ? Math.max(0, last.wt + last.wd + 0.4 - first.wt) : 0;
    for (const c of laid[ai].chars) c.wt += shift;
};

export const lineRect = (line: LaidLine) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, S = 0;
    for (const c of line.chars) if (c.glyph) {
        x0 = Math.min(x0, c.x - c.s / 2); x1 = Math.max(x1, c.x + c.s / 2);
        y0 = Math.min(y0, c.y - c.s / 2); y1 = Math.max(y1, c.y + c.s / 2); S = Math.max(S, c.s);
    }
    return { x0, x1, y0, y1, S };
};

/** 排一首歌：source 来自 buildNebbiaLines，glyphs 是按主题字体的字形缓存。 */
export const buildNebbiaScene = (
    source: NebbiaSourceLine[],
    glyphs: NebbiaGlyphCache,
    tuning: NebbiaTuning,
    size: { W: number; H: number; fontScale: number },
    seed: string | number,
): LaidLine[] => {
    const seedHash = hashVisualizerSeed(String(seed));
    const modes = source.map((l, i) => (l.credits ? 'fog' : lineModeOf(tuning.fade, i, seedHash)));
    const fadeOf = (i: number) => tuning.refog + (modes[i] === 'fog' ? 0 : 2.5);
    // 片尾（nebbiaCredits.ts）：曲名开写时前面的句子已经散得差不多（起雾不晚于开写前 0.6 个起雾用时），片尾两句不起雾
    const creditsAt = source.find(l => l.credits)?.t ?? Infinity;
    const beforeCredits = (i: number) => Math.max(source[i].end + 0.5, creditsAt - fadeOf(i) * 0.6);
    const fogAt = (i: number) => (source[i].credits ? Infinity
        : Math.min(fogStartOf(source[i].end, source[i].next, tuning.hold), beforeCredits(i)));
    const lingerAt = (i: number) => Math.max(fogAt(i), Math.min(fogAt(i) + LINGER_MAX, (source[i + LINGER_LINES]?.t ?? Infinity) + tuning.hold, beforeCredits(i)));
    const goneAt = (i: number) => fogAt(i) + fadeOf(i);
    const pos = layoutNebbiaSong(source, {
        W: size.W, H: size.H, jitter: tuning.jitter, layouts: tuning.layouts, fontScale: size.fontScale, visibleUntil: goneAt, fogAt,
        lingerUntil: i => lingerAt(i) + fadeOf(i),
    });
    const laid: LaidLine[] = source.map((line, li) => ({
        t: line.t, end: line.end, next: line.next, mode: modes[li], fogAt: fogAt(li), yieldAt: Infinity, breathAt: Infinity, breathUntil: Infinity,
        appearBreathAt: Infinity, appearBreathUntil: Infinity,
        chars: line.chars.map((c, i) => {
            const p = pos[li][i], wide = isWideChar(c.ch) || isIconChar(c.ch);
            const out: LaidChar = { ...c, x: p.x, y: p.y, s: p.s * (wide ? 1 : 1.15), rot: p.rot, glyph: null, beads: [], drips: [], ends: [], appearDur: 0, wt: c.t, wd: 0 };
            const base = glyphs.get(c.ch);
            if (base) decorate(out, base, createVisualizerRng((li * 131 + i * 17 + 5) >>> 0), tuning.warp);
            return out;
        }),
    }));
    laid.forEach((line, li) => applyAppear(line, tuning, li, seedHash));
    alignCredits(laid, source);
    // 让位：后面第一句和这句重叠、且在这句（多留之后）消失前开始的，记下它开始的时刻。
    // 多留：屏上还空着就晚点起雾，留到让位前 refog 秒（来得及慢慢起雾），不早于原来的时刻。
    // 到让位时还消失不了的（屏上满了），在那句开写前哈一口气把这句盖掉，那句写在白气上
    const rects = laid.map(lineRect);
    const { breathSpread, breathHold } = NEBBIA_FIXED;
    laid.forEach((line, i) => {
        if (source[i].credits) return;
        const gone = lingerAt(i) + fadeOf(i);
        let by = -1;
        for (let j = i + 1; j < laid.length && laid[j].t < gone; j += 1) {
            const a = rects[i], b = rects[j];
            if (Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0)) { line.yieldAt = yieldMoment(laid[j].t, line); by = j; break; }
        }
        line.fogAt = Math.max(fogAt(i), Math.min(lingerAt(i), line.yieldAt - fadeOf(i)));
        // 给片尾让位的不哈气：前面已经在散了，按让位快速起雾就好
        if (by >= 0 && !source[by].credits && line.yieldAt < line.fogAt + fadeOf(i)) {
            line.breathAt = line.yieldAt - breathSpread - 0.3;
            line.breathUntil = laid[by].end + breathHold;
        }
    });
    return laid;
};

/** 让位前多少秒开始收（快速起雾从让位前 0.6 秒起，哈气从 breathSpread + 0.3 秒起），和写完后至少留着看清的秒数。 */
const YIELD_LEAD = 0.6, YIELD_READ = 0.3;
/**
 * 这句最早什么时候让位：后面那句开写的时刻，但不早于这句最后一个字写完（慢慢显现的显出一半）再留 YIELD_READ 秒。
 * 不然唱得快、屏上又挤时，后面那句一压上来，这句写到一半就被哈气盖掉了（比如一句只唱一秒多，后半句没写就没了）。
 */
export const yieldMoment = (nextT: number, line: Pick<LaidLine, 'chars' | 't'>) => {
    let done = line.t;
    for (const c of line.chars) if (c.glyph) done = Math.max(done, c.wd > 0 ? c.wt + c.wd : c.t + Math.min(c.appearDur, 0.5));
    return Math.max(nextT, done + YIELD_READ + YIELD_LEAD);
};

/** 让位的句子在后面那句开写前 0.6 秒起用 1 秒快速起雾；屏上满了要哈气盖掉的，在白气鼓开的这一下里没了。 */
export const yieldFactor = (line: LaidLine, T: number) => (line.breathAt < Infinity
    // 哈气盖掉的：白气鼓开的这一下里没了
    ? 1 - smooth(clamp((T - line.breathAt) / NEBBIA_FIXED.breathSpread))
    : 1 - smooth(clamp((T - line.yieldAt + YIELD_LEAD) / 1)));
