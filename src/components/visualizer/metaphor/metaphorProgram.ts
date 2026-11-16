import type { Line, Theme } from '../../../types';
import { createVisualizerRng } from '../visualizerSeedHash';
import type { MetaphorComposition } from './metaphorLayout';

// src/components/visualizer/metaphor/metaphorProgram.ts
// 隐喻的分镜表（纯函数）：整首歌编成一串首尾相接的 cue（一句歌词，或句与句之间的间奏），每个 cue 里是几个硬切的镜头。
// 切点落在词开唱的时刻上；机位（全景、特写、跟字、大特写、倾斜、留白远景、拉远、冲镜）按歌的 seed 选，都正对画面，没有偏转和俯仰；
// 同一首歌每次都一样。画面完全由播放时间决定，拖进度、暂停、导出都对。镜头具体的位置由 metaphorCamera.ts 按排版算。

export type MetaphorShotKind = 'wide' | 'close' | 'follow' | 'macro' | 'dutch' | 'void' | 'pullback' | 'pushin';
export type MetaphorTransition = 'cut' | 'flood' | 'smash';

export interface MetaphorShot {
    start: number;
    end: number;
    kind: MetaphorShotKind;
    /** 弧度：绕视线的滚转。 */
    roll: number;
    /** 目标在画面里偏离中心多少（画面高度的倍数）。 */
    offsetX: number;
    offsetY: number;
    /** 纸和墨对调。 */
    invert: boolean;
    /** 这个镜头的网点角度（弧度）。 */
    screenAngle: number;
    /** 0..1，这个镜头自己的随机数（颗粒、漂移的相位）。 */
    seed: number;
}

export interface MetaphorCue {
    /** lines 里的第几句；间奏是 -1。 */
    lineIndex: number;
    start: number;
    end: number;
    /** 这句开唱、唱完的时刻（间奏是 cue 的起止）。 */
    singStart: number;
    singEnd: number;
    composition: MetaphorComposition;
    shots: MetaphorShot[];
    /** 进这个 cue 的转场。 */
    transition: MetaphorTransition;
    chorus: boolean;
    /** 间奏上的字（开头的曲名卡）；没有是空。 */
    text: string;
    /** 镜头按这么长循环（没有尽头的间奏切到头以后剩下的那一个 cue）；0 是不循环。 */
    loop: number;
}

export interface MetaphorProgram {
    cues: MetaphorCue[];
}

export interface MetaphorProgramOptions {
    seed: string | number;
    title?: string | null;
    cutPace: number;
    negative: boolean;
    transitions: boolean;
    intensity: Theme['animationIntensity'];
}

/** 歌词出现得比开唱早这么多：先是一层网点的影子。 */
export const METAPHOR_PREROLL = 0.6;
/** 唱完后这句还留多久（化开）；后面紧跟下一句时让给下一句。 */
export const METAPHOR_TAIL = 2;
/** 句间空这么久才插一段间奏。 */
const INTERLUDE_MIN = 2.4;
const MIN_SHOT = 0.6;
const MIN_CUE = 0.15;
const LOOP_SECONDS = 48;
/** 长的间奏（纯音乐整首都是）切成一段一段，每段是自己的一个 cue：换一版线稿、版面和对撞，不然同一张图要看到底。 */
const INTERLUDE_SEGMENT = 24;
/** 比这还长的间奏才切。 */
const INTERLUDE_SPLIT = 36;
/** 没有尽头的间奏（纯音乐、最后一句以后）切到这么远，再往后是一个循环的 cue。 */
const INTERLUDE_HORIZON = 720;

const INTENSITY_PACE: Partial<Record<string, number>> = { calm: 0.75, normal: 1, chaotic: 1.3 };
/** 两句开唱隔得比这还近（对唱、和声同时进）：只排先来的那句，后一句没有自己的画面。 */
const SAME_ONSET = 0.3;
const SCREEN_ANGLES = [0.26, 0.52, 0.79, 1.31];
const CJK = /[぀-ヿ㐀-鿿가-힯ｦ-ﾟ]/u;

type Weights<T extends string> = Partial<Record<T, number>>;

const pick = <T extends string>(rng: () => number, weights: Weights<T>, avoid?: T | null): T => {
    const entries = (Object.entries(weights) as Array<[T, number]>).filter(([key, weight]) => weight > 0 && key !== avoid);
    const pool = entries.length > 0 ? entries : (Object.entries(weights) as Array<[T, number]>);
    const total = pool.reduce((sum, [, weight]) => sum + weight, 0);
    let roll = rng() * total;
    for (const [key, weight] of pool) {
        roll -= weight;
        if (roll <= 0) return key;
    }
    return pool[pool.length - 1][0];
};

const FIRST_SHOT: Weights<MetaphorShotKind> = { wide: 3, close: 2, dutch: 1.5, void: 0.8, follow: 1.5 };
const MIDDLE_SHOT: Weights<MetaphorShotKind> = { close: 3, follow: 2, macro: 2, dutch: 1.5, wide: 1, void: 0.6 };
const INTERLUDE_SHOT: Weights<MetaphorShotKind> = { void: 3, macro: 2, pullback: 1.5, wide: 1.5, dutch: 1 };

const span = (rng: () => number, min: number, max: number) => min + rng() * (max - min);
const sign = (rng: () => number) => (rng() < 0.5 ? -1 : 1);

/** 一个镜头的角度和偏移：每种机位自己的范围。 */
const shotPose = (kind: MetaphorShotKind, rng: () => number): Pick<MetaphorShot, 'roll' | 'offsetX' | 'offsetY'> => {
    switch (kind) {
        case 'wide': return { roll: span(rng, -0.05, 0.05), offsetX: 0, offsetY: 0 };
        case 'close': return { roll: span(rng, -0.07, 0.07), offsetX: span(rng, -0.08, 0.08), offsetY: span(rng, -0.05, 0.05) };
        case 'follow': return { roll: span(rng, -0.03, 0.03), offsetX: 0, offsetY: 0 };
        case 'macro': return { roll: sign(rng) * span(rng, 0.25, 0.6), offsetX: span(rng, -0.12, 0.12), offsetY: span(rng, -0.12, 0.12) };
        case 'dutch': return { roll: sign(rng) * span(rng, 0.2, 0.4), offsetX: span(rng, -0.1, 0.1), offsetY: 0 };
        case 'void': return { roll: span(rng, -0.04, 0.04), offsetX: sign(rng) * span(rng, 0.18, 0.3), offsetY: sign(rng) * span(rng, 0.1, 0.22) };
        case 'pullback': return { roll: span(rng, -0.1, 0.1), offsetX: 0, offsetY: 0 };
        case 'pushin': return { roll: span(rng, -0.12, 0.12), offsetX: 0, offsetY: 0 };
    }
};

interface ShotContext {
    rng: () => number;
    negative: boolean;
    chorus: boolean;
    /** 上一个镜头是不是反相：不连着三个。 */
    inverted: number;
    lastKind: MetaphorShotKind | null;
    lastAngle: number;
}

const makeShot = (context: ShotContext, start: number, end: number, kind: MetaphorShotKind): MetaphorShot => {
    const { rng } = context;
    const chance = context.negative ? (context.chorus ? 0.34 : 0.2) : 0;
    // 先取随机数再判断：开关反相、连着几个反相都不改后面取到的数，机位不跟着变
    const roll = rng();
    const invert = context.inverted < 2 && roll < chance;
    context.inverted = invert ? context.inverted + 1 : 0;
    context.lastKind = kind;
    let angle = SCREEN_ANGLES[Math.floor(rng() * SCREEN_ANGLES.length)];
    if (angle === context.lastAngle) angle = SCREEN_ANGLES[(SCREEN_ANGLES.indexOf(angle) + 1) % SCREEN_ANGLES.length];
    context.lastAngle = angle;
    return { start, end, kind, ...shotPose(kind, rng), invert, screenAngle: angle, seed: rng() };
};

/** 切点：先按节奏均分，再吸到最近的词开唱时刻上。 */
const planCuts = (start: number, end: number, count: number, onsets: number[]): number[] => {
    const cuts: number[] = [];
    const spacing = (end - start) / count;
    for (let index = 1; index < count; index += 1) {
        const ideal = start + spacing * index;
        const near = onsets.reduce((best, onset) => (Math.abs(onset - ideal) < Math.abs(best - ideal) ? onset : best), Number.POSITIVE_INFINITY);
        const at = Math.abs(near - ideal) <= spacing * 0.4 ? near : ideal;
        const previous = cuts.length > 0 ? cuts[cuts.length - 1] : start;
        if (at - previous >= MIN_SHOT && end - at >= MIN_SHOT) cuts.push(at);
    }
    return cuts;
};

const lineShots = (context: ShotContext, cue: Pick<MetaphorCue, 'start' | 'end' | 'transition'>, line: Line, pace: number): MetaphorShot[] => {
    const duration = cue.end - cue.start;
    const count = Math.max(1, Math.min(7, Math.round((duration * pace * (context.chorus ? 1.25 : 1)) / 2.6)));
    const onsets = line.words.map(word => word.startTime).filter(time => time > cue.start + MIN_SHOT && time < cue.end - MIN_SHOT);
    const edges = [cue.start, ...planCuts(cue.start, cue.end, count, onsets), cue.end];
    return edges.slice(0, -1).map((start, index) => {
        const end = edges[index + 1];
        const last = index === edges.length - 2;
        let weights: Weights<MetaphorShotKind> = index === 0 ? FIRST_SHOT : MIDDLE_SHOT;
        if (index === 0 && cue.transition === 'smash') return makeShot(context, start, end, 'pushin');
        // 一句的最后一个镜头够长时多半拉远，把整句和周围的墨交代出来
        if (last && index > 0 && end - start >= 1.4) weights = { ...weights, pullback: 5 };
        if (context.chorus) weights = { ...weights, macro: (weights.macro ?? 0) + 1.5, dutch: (weights.dutch ?? 0) + 1 };
        return makeShot(context, start, end, pick(context.rng, weights, context.lastKind));
    });
};

const interludeShots = (context: ShotContext, start: number, end: number, pace: number): MetaphorShot[] => {
    const shots: MetaphorShot[] = [];
    let at = start;
    while (end - at > 0.01) {
        const length = span(context.rng, 4.5, 8) / pace;
        const next = end - (at + length) < 2.5 ? end : at + length;
        shots.push(makeShot(context, at, next, pick(context.rng, INTERLUDE_SHOT, context.lastKind)));
        at = next;
    }
    return shots;
};

const pickComposition = (rng: () => number, text: string, previous: MetaphorComposition | null): MetaphorComposition => {
    const chars = Array.from(text.replace(/\s+/gu, ''));
    const cjk = chars.filter(char => CJK.test(char)).length / Math.max(1, chars.length);
    const words = cjk > 0.5 ? chars.length / 2 : text.trim().split(/\s+/u).length;
    return pick<MetaphorComposition>(rng, {
        block: 2,
        justify: words >= 3 ? 3 : 0,
        stair: chars.length >= 6 ? 2 : 0,
        hero: words >= 2 ? 2.5 : 0,
        column: cjk > 0.7 && chars.length >= 2 && chars.length <= 16 ? 2 : 0,
        scatter: words >= 3 ? 1.5 : 0,
    }, previous);
};

const pickTransition = (rng: () => number, enabled: boolean, intoChorus: boolean): MetaphorTransition => {
    if (!enabled) return 'cut';
    return intoChorus
        ? pick<MetaphorTransition>(rng, { flood: 3, smash: 3, cut: 1.5 })
        : pick<MetaphorTransition>(rng, { cut: 5.5, flood: 1.5, smash: 1.2 });
};

/** 按开唱时间排（同时的保持原来的先后），去掉和前一句（留下的那句）几乎同时开唱的、只有标点的。 */
const sungLines = (lines: readonly Line[]) => {
    const kept: Array<{ line: Line; lineIndex: number }> = [];
    lines
        .map((line, lineIndex) => ({ line, lineIndex }))
        // 只有标点的句子（「......」这种间奏的占位）不算歌词：那一段归间奏
        .filter(({ line }) => /[\p{L}\p{N}]/u.test(line.fullText) && Number.isFinite(line.startTime))
        .sort((a, b) => a.line.startTime - b.line.startTime || a.lineIndex - b.lineIndex)
        .forEach((entry) => {
            // 和留下的上一句比：去掉的那句不算，不然一串挨得近的句子会一句接一句全被去掉
            const previous = kept.at(-1);
            if (!previous || entry.line.startTime - previous.line.startTime >= SAME_ONSET) kept.push(entry);
        });
    return kept;
};

/**
 * 整首编成分镜表。lines 为空（纯音乐、还没歌词）时整首是一段一段的间奏，曲名在第一段上。
 * 构图、转场、间奏的切点、镜头各用自己的一串随机数：改切换快慢、开关反相或转场时，只有那一样跟着变，
 * 各句的构图（屏上正在唱的那句的排法）不动。
 */
export const compileMetaphorProgram = (lines: readonly Line[], options: MetaphorProgramOptions): MetaphorProgram => {
    const rng = createVisualizerRng(`metaphor:${options.seed}`);
    const composeRng = createVisualizerRng(`metaphor:${options.seed}:compose`);
    const transitionRng = createVisualizerRng(`metaphor:${options.seed}:transition`);
    const splitRng = createVisualizerRng(`metaphor:${options.seed}:split`);
    const pace = options.cutPace * (INTENSITY_PACE[options.intensity] ?? 1);
    const context: ShotContext = { rng, negative: options.negative, chorus: false, inverted: 0, lastKind: null, lastAngle: -1 };
    const cues: MetaphorCue[] = [];
    const title = options.title?.trim() ?? '';

    const pushInterludeCue = (start: number, end: number, text: string, loop = 0) => {
        context.chorus = false;
        const shotsEnd = loop > 0 ? start + loop : end;
        cues.push({
            lineIndex: -1, start, end, singStart: start, singEnd: end, composition: 'block',
            shots: interludeShots(context, start, shotsEnd, pace),
            transition: cues.length === 0 ? 'cut' : pickTransition(transitionRng, options.transitions, false),
            chorus: false, text, loop,
        });
    };
    // 一段间奏：长的切成差不多 INTERLUDE_SEGMENT 秒的几段（切点前后挪几秒，不那么齐），曲名只在第一段上。
    // 没有尽头的切到 INTERLUDE_HORIZON 为止，后面接一个循环的 cue。
    const pushInterlude = (start: number, end: number, text: string) => {
        const endless = !Number.isFinite(end);
        const stop = endless ? start + INTERLUDE_HORIZON : end;
        const length = stop - start;
        const count = length > INTERLUDE_SPLIT ? Math.round(length / INTERLUDE_SEGMENT) : 1;
        let from = start;
        for (let index = 1; index <= count; index += 1) {
            const to = index === count ? stop : start + (length * index) / count + (splitRng() - 0.5) * 6;
            pushInterludeCue(from, to, index === 1 ? text : '');
            from = to;
        }
        if (endless) pushInterludeCue(stop, Number.POSITIVE_INFINITY, '', LOOP_SECONDS);
    };

    // 去掉和前一句几乎同时开唱的：不然先来的那句会被后一句挤得一帧都不剩
    const sung = sungLines(lines);
    if (sung.length === 0) {
        pushInterlude(0, Number.POSITIVE_INFINITY, title);
        return { cues };
    }

    let cursor = 0;
    let composition: MetaphorComposition | null = null;
    sung.forEach(({ line, lineIndex }, order) => {
        const begin = Math.max(cursor, line.startTime - METAPHOR_PREROLL);
        if (begin - cursor >= INTERLUDE_MIN || (order === 0 && begin - cursor >= 1.2)) {
            pushInterlude(cursor, begin, order === 0 ? title : '');
            cursor = begin;
        }
        const start = cursor;
        const next = sung.at(order + 1)?.line;
        const singEnd = Number.isFinite(line.endTime) ? Math.max(line.endTime, line.startTime + 0.2) : line.startTime + 0.2;
        const hold = singEnd + METAPHOR_TAIL;
        const nextBegin = next ? next.startTime - METAPHOR_PREROLL : Number.POSITIVE_INFINITY;
        // 下一句离得近就一直留到它来；离得远（或者这是最后一句），留一小会儿就让给间奏
        const end = nextBegin - hold >= INTERLUDE_MIN ? hold : Math.max(nextBegin, start);
        if (end - start < MIN_CUE) return;
        const chorus = Boolean(line.isChorus);
        const transition = cues.length === 0 ? 'cut' : pickTransition(transitionRng, options.transitions, chorus && !context.chorus);
        context.chorus = chorus;
        composition = pickComposition(composeRng, line.fullText, composition);
        const cue: MetaphorCue = {
            lineIndex, start, end, singStart: line.startTime, singEnd, composition, shots: [], transition, chorus, text: '', loop: 0,
        };
        cue.shots = lineShots(context, cue, line, pace);
        cues.push(cue);
        cursor = end;
    });
    pushInterlude(cursor, Number.POSITIVE_INFINITY, '');
    return { cues };
};

/** time 落在哪个 cue 上（二分）；第一个 cue 之前算第一个。 */
export const findMetaphorCue = (program: MetaphorProgram, time: number): number => {
    const { cues } = program;
    let low = 0;
    let high = cues.length - 1;
    while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (cues[middle].start <= time) low = middle;
        else high = middle - 1;
    }
    return low;
};

/** cue 里的时间：循环的 cue 折回它的循环长度里。 */
export const resolveMetaphorCueTime = (cue: MetaphorCue, time: number) => (
    cue.loop > 0 ? cue.start + ((((time - cue.start) % cue.loop) + cue.loop) % cue.loop) : time
);

/** cueTime 落在 cue 的哪个镜头上。 */
export const findMetaphorShot = (cue: MetaphorCue, cueTime: number): MetaphorShot => {
    const { shots } = cue;
    for (let index = shots.length - 1; index > 0; index -= 1) {
        if (shots[index].start <= cueTime) return shots[index];
    }
    return shots[0];
};
