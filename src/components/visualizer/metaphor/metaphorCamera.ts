import type { MetaphorLayout, MetaphorRect } from './metaphorLayout';
import { METAPHOR_TAIL, type MetaphorCue, type MetaphorProgram, type MetaphorShot } from './metaphorProgram';

// src/components/visualizer/metaphor/metaphorCamera.ts
// 隐喻的镜头（纯函数，不碰 three）：一个镜头在某一刻的机位，以及句与句之间转场在这一刻的量（漫墨）、
// 一句歌词出现和化开的进度。
// 机位永远正对画面：只有平移、远近、绕视线的滚转，没有偏转和俯仰（不做假 3D）。
// 一个镜头里机位只极慢地蠕动；要走远的（跟字、拉远、冲镜）不滑过去，分成几档在词开唱的时刻上一格一格跳切。

export interface MetaphorPose {
    /** 看向的点（机位在它正前方）。 */
    x: number; y: number;
    /** 离画面多远。 */
    distance: number;
    roll: number;
    /** 竖直视角，度。 */
    fov: number;
}

export interface MetaphorTransitionFx {
    /** 加到墨场上的量：到 1 左右整个画面都是墨。 */
    flood: number;
}

/** 所有镜头同一个视角：远近只靠机位的距离。 */
export const METAPHOR_FOV = 30;

/** 间奏没有字：留给融球的舞台。 */
export const METAPHOR_EMPTY_STAGE: MetaphorRect = { x0: -4.5, y0: -2.6, x1: 4.5, y1: 2.6 };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, amount: number) => from + (to - from) * amount;
const easeOutCubic = (u: number) => 1 - (1 - u) ** 3;

interface Focus { x: number; y: number; width: number; height: number; }

const rectFocus = (rect: MetaphorRect): Focus => ({
    x: (rect.x0 + rect.x1) / 2,
    y: (rect.y0 + rect.y1) / 2,
    width: Math.max(1.6, rect.x1 - rect.x0),
    height: Math.max(1.2, rect.y1 - rect.y0),
});

/** time 这一刻正在唱（或刚唱过）的词；还没开唱是第一个。 */
const wordIndexAt = (layout: MetaphorLayout, time: number) => {
    let found = 0;
    let latest = Number.NEGATIVE_INFINITY;
    layout.words.forEach((word, index) => {
        if (word.t0 <= time && word.t0 >= latest) {
            latest = word.t0;
            found = index;
        }
    });
    return found;
};

/** 没有字时（间奏）：舞台里按镜头的随机数挑的一小块。 */
const emptyFocus = (bounds: MetaphorRect, seed: number): Focus => {
    const width = bounds.x1 - bounds.x0;
    const height = bounds.y1 - bounds.y0;
    return {
        x: bounds.x0 + width * (0.2 + 0.6 * seed),
        y: bounds.y0 + height * (0.2 + 0.6 * ((seed * 7.31) % 1)),
        width: width * 0.3,
        height: height * 0.3,
    };
};

/** 正在唱的词：换词时直接跳过去，不滑。 */
const wordFocus = (layout: MetaphorLayout, time: number, seed: number): Focus => (
    layout.words.length === 0 ? emptyFocus(layout.bounds, seed) : rectFocus(layout.words[wordIndexAt(layout, time)])
);

/** time 这一刻正在唱（或刚唱过）的字；还没开唱是第一个。 */
const glyphAt = (layout: MetaphorLayout, time: number) => {
    let found = layout.glyphs[0];
    for (const glyph of layout.glyphs) {
        if (glyph.t0 <= time && glyph.t0 >= found.t0) found = glyph;
    }
    return found;
};

const glyphFocus = (layout: MetaphorLayout, time: number, seed: number): Focus => {
    if (layout.glyphs.length === 0) return emptyFocus(layout.bounds, seed);
    const found = glyphAt(layout, time);
    return { x: found.x, y: found.y, width: found.size * 0.9, height: found.size * 0.9 };
};

/** 大特写对准的字所在的那个词（镜头开头那一刻的字）；没有字是 -1。 */
const macroWord = (layout: MetaphorLayout, shot: MetaphorShot) => (layout.glyphs.length === 0 ? -1 : glyphAt(layout, shot.start).word);

/**
 * 大特写对准的那个词唱完、后面的词开唱以后，正在唱的词（还没到是 -1）：大特写的画面只装得下约一个字，
 * 后面的词改用特写的取景一个词一个词地跳，不然它们都在画外唱。
 */
const macroFollowWord = (layout: MetaphorLayout, shot: MetaphorShot, time: number) => {
    const anchor = macroWord(layout, shot);
    if (anchor < 0) return -1;
    const current = wordIndexAt(layout, time);
    return current !== anchor && layout.words[current].t0 > layout.words[anchor].t0 ? current : -1;
};

const fitDistance = (focus: Focus, margin: number, aspect: number) => (
    (Math.max(focus.height / 2, focus.width / (2 * Math.max(0.2, aspect))) * margin) / Math.tan((METAPHOR_FOV * Math.PI) / 360)
);

/**
 * 一个镜头分几档跳切时，time 这一刻跳到了第几档（0..steps）。跳的时刻取镜头里词开唱的时刻（卡在词上）；
 * 镜头里的词不够就按时间均分。
 */
const stepAt = (shot: MetaphorShot, layout: MetaphorLayout, time: number, steps: number) => {
    const onsets = [...new Set(layout.words.map(word => word.t0))]
        .filter(onset => onset > shot.start + 0.3 && onset < shot.end - 0.3)
        .sort((a, b) => a - b);
    const times: number[] = [];
    if (onsets.length >= steps) {
        for (let index = 0; index < steps; index += 1) times.push(onsets[Math.floor((index * onsets.length) / steps)]);
    } else {
        for (let index = 1; index <= steps; index += 1) times.push(shot.start + ((shot.end - shot.start) * index) / (steps + 1));
    }
    return times.filter(at => at <= time).length;
};

/** 极慢的漂：十几秒才晃一个来回。 */
const wobble = (time: number, phase: number) => Math.sin(time * 0.23 + phase) * 0.6 + Math.sin(time * 0.37 + phase * 2.3) * 0.4;

/** 全景里整句占画面的几分之一的倒数：字尽量大，四周只留一圈边。 */
const WIDE_MARGIN = 1.1;
const PULLBACK_STEPS = 3;
const PUSHIN_STEPS = 3;
/** 大特写只框住一个字的一部分（比 1 小）。 */
const MACRO_MARGIN = 0.8;
const CLOSE_MARGIN = 1.3;
/** 大特写换成特写跟词以后，斜度留几成（大特写斜 0.25～0.6，特写在 0.07 以内）。 */
const MACRO_FOLLOW_ROLL = 0.12;
/** 冲镜的三档隔这么久跳一格。 */
const PUSHIN_BEAT = 0.16;

export interface MetaphorPoseInput {
    shot: MetaphorShot;
    layout: MetaphorLayout;
    /** cue 里的时间（循环的 cue 已经折回）。 */
    time: number;
    aspect: number;
    /** 运镜幅度，0..2。 */
    motion: number;
}

/** 一个镜头按分镜在 time 这一刻的机位（还没管正在唱的字在不在画里）。 */
const plannedPose = ({ shot, layout, time, aspect, motion }: MetaphorPoseInput): MetaphorPose => {
    const u = clamp01((time - shot.start) / Math.max(0.001, shot.end - shot.start));
    // 一个镜头从头到尾只推近（或拉开）百分之几，匀速
    const creep = 1 - 0.035 * motion * u;
    const whole = rectFocus(layout.bounds);
    let focus = whole;
    let distance: number;
    let { roll } = shot;
    switch (shot.kind) {
        case 'wide':
            distance = fitDistance(whole, WIDE_MARGIN, aspect) * creep;
            break;
        case 'close':
            focus = wordFocus(layout, shot.start, shot.seed);
            distance = fitDistance(focus, CLOSE_MARGIN, aspect) * creep;
            break;
        case 'follow':
            focus = wordFocus(layout, time, shot.seed);
            distance = fitDistance(focus, 1.45, aspect);
            break;
        case 'macro': {
            const following = macroFollowWord(layout, shot, time);
            if (following >= 0) {
                // 换成特写跟词：取景和特写一样，斜度收到特写的范围
                focus = rectFocus(layout.words[following]);
                distance = fitDistance(focus, CLOSE_MARGIN, aspect) * creep;
                roll *= MACRO_FOLLOW_ROLL;
                break;
            }
            focus = glyphFocus(layout, shot.start, shot.seed);
            distance = fitDistance(focus, MACRO_MARGIN, aspect) * creep;
            roll += 0.03 * motion * (u - 0.5);
            break;
        }
        case 'dutch':
            distance = fitDistance(whole, 1.1, aspect) * creep;
            break;
        case 'void':
            distance = fitDistance(whole, 1.85, aspect) * (2 - creep);
            break;
        case 'pullback': {
            // 从正在唱的词上一格一格跳开，最后露出整句和周围的墨
            const near = wordFocus(layout, shot.start, shot.seed);
            const out = stepAt(shot, layout, time, PULLBACK_STEPS) / PULLBACK_STEPS;
            focus = { x: lerp(near.x, whole.x, out), y: lerp(near.y, whole.y, out), width: whole.width, height: whole.height };
            distance = lerp(fitDistance(near, 1.15, aspect), fitDistance(whole, 1.4, aspect), out);
            break;
        }
        case 'pushin': {
            // 冲镜：从很远处连跳三格，落到第一个词上
            const near = wordFocus(layout, shot.start, shot.seed);
            const into = Math.min(PUSHIN_STEPS, Math.floor(Math.max(0, time - shot.start) / PUSHIN_BEAT)) / PUSHIN_STEPS;
            focus = { x: lerp(whole.x, near.x, into), y: lerp(whole.y, near.y, into), width: near.width, height: near.height };
            distance = lerp(fitDistance(whole, 3.2, aspect), fitDistance(near, 1.3, aspect), into) * creep;
            break;
        }
    }
    const visible = 2 * distance * Math.tan((METAPHOR_FOV * Math.PI) / 360);
    const phase = shot.seed * 40;
    const drift = 0.008 * motion * visible;
    return {
        x: focus.x - shot.offsetX * visible + wobble(time, phase) * drift,
        y: focus.y - shot.offsetY * visible + wobble(time, phase + 11) * drift,
        distance,
        roll: roll + wobble(time, phase + 23) * 0.004 * motion,
        fov: METAPHOR_FOV,
    };
};

/** 正在唱的字跑出这一圈（视口半宽半高的几成）就切；切过去把它摆进更里面的一圈，机位蠕动一阵也不会马上又出去。 */
const KEEP_OUT = 0.97;
const KEEP_IN = 0.9;
/** 算出来要挪的比这还小（画面短边的几成）就不切：这么小的硬切看着像画面抖了一下，字也只差一点点。 */
const MIN_SHIFT = 0.06;
/** 这几种镜头切过去时连同后面紧接着要唱、还装得下的词一起摆进画里，不然一个词一切。 */
const LOOK_AHEAD = new Set<MetaphorShot['kind']>(['close', 'pushin']);
/** 没有唱的时长（逐句歌词的字、曲名卡）的字，开唱后这么久内仍算在唱。 */
const MIN_SUNG = 0.3;

interface SungUnit { x0: number; y0: number; x1: number; y1: number; t0: number; t1: number; }

/** at 这一刻正在唱的那个（和 wordIndexAt 一样取最近开唱的）；已经唱完或还没开唱是 null。 */
const sungUnitAt = (units: readonly SungUnit[], at: number): SungUnit | null => {
    let found: SungUnit | null = null;
    for (const unit of units) {
        if (unit.t0 <= at && (!found || unit.t0 >= found.t0)) found = unit;
    }
    return found && at < Math.max(found.t1, found.t0 + MIN_SUNG) ? found : null;
};

/** 视口的半宽半高（乘上 inner），和 rect 在画面坐标（转过滚转）里的范围。 */
const frame = (pose: MetaphorPose, rect: MetaphorRect, aspect: number, inner: number) => {
    const halfHeight = pose.distance * Math.tan((pose.fov * Math.PI) / 360);
    const half = [halfHeight * aspect * inner, halfHeight * inner];
    const cos = Math.cos(pose.roll);
    const sin = Math.sin(pose.roll);
    const low = [Infinity, Infinity];
    const high = [-Infinity, -Infinity];
    for (const x of [rect.x0, rect.x1]) {
        for (const y of [rect.y0, rect.y1]) {
            const dx = x - pose.x;
            const dy = y - pose.y;
            const along = [dx * cos + dy * sin, -dx * sin + dy * cos];
            for (const axis of [0, 1]) {
                low[axis] = Math.min(low[axis], along[axis]);
                high[axis] = Math.max(high[axis], along[axis]);
            }
        }
    }
    return { half, low, high };
};

/** rect 整个（不论摆在哪）装不装得进视口的 inner 那一圈。 */
const fitsWithin = (pose: MetaphorPose, rect: MetaphorRect, aspect: number, inner: number) => {
    const { half, low, high } = frame(pose, rect, aspect, inner);
    return high[0] - low[0] <= 2 * half[0] && high[1] - low[1] <= 2 * half[1];
};

/**
 * 切过去时要摆进画里的范围：正在唱的词，特写和冲镜再连同紧接着要唱（按开唱先后）、在这一段的机位里还装得下的几个词。
 * 只摆当前这个词的话它总落在画边上，下一个词一开唱就又出去。
 */
const placeTarget = (shot: MetaphorShot, order: readonly SungUnit[], unit: SungUnit, poses: readonly MetaphorPose[], aspect: number): MetaphorRect => {
    if (!LOOK_AHEAD.has(shot.kind)) return unit;
    let target: MetaphorRect = unit;
    for (let index = order.indexOf(unit) + 1; index < order.length; index += 1) {
        const next = order[index];
        const grown = {
            x0: Math.min(target.x0, next.x0), y0: Math.min(target.y0, next.y0),
            x1: Math.max(target.x1, next.x1), y1: Math.max(target.y1, next.y1),
        };
        if (!poses.every(pose => fitsWithin(pose, grown, aspect, KEEP_IN))) break;
        target = grown;
    }
    return target;
};

/**
 * 机位要挪多少（画面坐标，转过滚转的）才能把 unit 摆进视口的 inner 那一圈；本来就在里面是 0。
 * 比整个视口还大的一边（竖屏特写里的长词）只要求它的中心落在中间一半里。
 */
const fitShift = (pose: MetaphorPose, unit: MetaphorRect, aspect: number, inner: number, out: { x: number; y: number }) => {
    const { half, low, high } = frame(pose, unit, aspect, inner);
    const shift = [0, 0];
    for (const axis of [0, 1]) {
        const size = high[axis] - low[axis];
        const full = half[axis] / inner;
        if (size > 2 * full) {
            const room = half[axis] * 0.5;
            const center = (low[axis] + high[axis]) / 2;
            shift[axis] = center > room ? center - room : center < -room ? center + room : 0;
        } else {
            // 装得下整个视口、装不下那一圈的：摆在正中
            const limit = Math.max(half[axis], size / 2);
            shift[axis] = high[axis] > limit ? high[axis] - limit : low[axis] < -limit ? low[axis] + limit : 0;
        }
    }
    out.x = shift[0];
    out.y = shift[1];
    return out;
};

/** 机位这一刻会变的时刻（升序，第一个是镜头开头）：词开唱、拉远跳档、冲镜落定。在这些时刻上检查正在唱的在不在画里。 */
const checkpoints = (shot: MetaphorShot, units: readonly SungUnit[]) => {
    const times = units.map(unit => unit.t0);
    if (shot.kind === 'pullback') {
        // 词不够时拉远按时间均分着跳（词开唱的时刻已经在 units 里了）
        for (let step = 1; step <= PULLBACK_STEPS; step += 1) {
            times.push(shot.start + ((shot.end - shot.start) * step) / (PULLBACK_STEPS + 1));
        }
    }
    if (shot.kind === 'pushin') times.push(shot.start + PUSHIN_STEPS * PUSHIN_BEAT);
    const after = [...new Set(times)].filter(at => at > shot.start).sort((a, b) => a - b);
    return [shot.start, ...after];
};

/**
 * 一个镜头走到哪个检查点、当时偏了多少。偏移只在检查点上变，所以每帧只接着处理新跨过的检查点；
 * 换镜头、换画面比例或运镜幅度、时间退到已处理的检查点之前（拖进度）就从镜头开头重来，结果和每帧从头算一样。
 */
interface KeepTrack {
    shot: MetaphorShot;
    aspect: number;
    motion: number;
    units: readonly SungUnit[];
    /** 大特写对准的那个词：它本来就只框得下一个字，唱它的时候不守（别的镜头是 null）。 */
    skip: SungUnit | null;
    /** 词按开唱先后排（留位置时往后数）。 */
    order: readonly SungUnit[];
    times: number[];
    next: number;
    /** 上一个检查点上分镜机位去掉蠕动后的样子：和它不一样说明分镜自己在这一刻跳了。 */
    still: MetaphorPose | null;
    shiftX: number;
    shiftY: number;
}

const tracks = new WeakMap<MetaphorLayout, KeepTrack>();

const trackFor = (input: MetaphorPoseInput): KeepTrack => {
    const { shot, layout, time, aspect, motion } = input;
    const track = tracks.get(layout);
    // 时间往回抖一点（没退过已处理的检查点）不用重来
    if (track && track.shot === shot && track.aspect === aspect && track.motion === motion
        && time >= (track.next > 0 ? track.times[track.next - 1] : shot.start)) return track;
    const units = layout.words;
    const anchor = shot.kind === 'macro' ? macroWord(layout, shot) : -1;
    const fresh: KeepTrack = { shot, aspect, motion, units, skip: anchor >= 0 ? units[anchor] : null, order: [...units].sort((a, b) => a.t0 - b.t0), times: checkpoints(shot, units), next: 0, still: null, shiftX: 0, shiftY: 0 };
    tracks.set(layout, fresh);
    return fresh;
};

const shiftPose = (pose: MetaphorPose, shiftX: number, shiftY: number): MetaphorPose => {
    if (shiftX === 0 && shiftY === 0) return pose;
    const cos = Math.cos(pose.roll);
    const sin = Math.sin(pose.roll);
    return { ...pose, x: pose.x + shiftX * cos - shiftY * sin, y: pose.y + shiftX * sin + shiftY * cos };
};

const outside = (pose: MetaphorPose, unit: SungUnit, aspect: number, out: { x: number; y: number }) => {
    fitShift(pose, unit, aspect, KEEP_OUT, out);
    return out.x !== 0 || out.y !== 0;
};

const need = { x: 0, y: 0 };

/** 处理一个检查点：分镜自己跳了就清掉偏移；正在唱的在这一刻或到下一个检查点（或它唱完）之前会出画，就切。 */
const advance = (track: KeepTrack, input: MetaphorPoseInput) => {
    const { shot, aspect } = input;
    const at = track.times[track.next];
    track.next += 1;
    const still = plannedPose({ ...input, time: at, motion: 0 });
    const previous = track.still;
    track.still = still;
    // 拉远跳档、冲镜落定、跟字换词：这一刻本来就在切，偏移不带进新的构图
    if (previous && (still.x !== previous.x || still.y !== previous.y || still.distance !== previous.distance)) {
        track.shiftX = 0;
        track.shiftY = 0;
    }
    // 正在唱的是大特写对准的词就不守；这里不能把它从 units 里去掉，不然会挑到它前面那个（短的还算在唱）去守
    const unit = sungUnitAt(track.units, at);
    if (!unit || unit === track.skip) return;
    const planned = plannedPose({ ...input, time: at });
    // 两个检查点之间机位还在推近（短镜头推得快）：连那一段末尾一起看
    const until = Math.min(track.times[track.next] ?? shot.end, Math.max(unit.t1, unit.t0 + MIN_SUNG), shot.end) - 1e-3;
    const later = until > at ? plannedPose({ ...input, time: until }) : planned;
    if (!outside(shiftPose(planned, track.shiftX, track.shiftY), unit, aspect, need)
        && !outside(shiftPose(later, track.shiftX, track.shiftY), unit, aspect, need)) return;
    // 出画了：照分镜的机位还在画里就切回去，不然挪到刚好摆进去（特写、冲镜连同后面装得下的词）；
    // 挪完到那一段末尾还会出去，就按末尾的机位只摆这个词
    fitShift(planned, placeTarget(shot, track.order, unit, [planned, later], aspect), aspect, KEEP_IN, need);
    if (outside(shiftPose(later, need.x, need.y), unit, aspect, { x: 0, y: 0 })) fitShift(later, unit, aspect, KEEP_IN, need);
    // 要挪的太小就不切（按画面短的那条边算：竖屏的窄边上一点点也可能就是出画）
    const visible = 2 * planned.distance * Math.tan((planned.fov * Math.PI) / 360) * Math.min(1, aspect);
    if (Math.hypot(need.x - track.shiftX, need.y - track.shiftY) < MIN_SHIFT * visible) return;
    track.shiftX = need.x;
    track.shiftY = need.y;
};

/**
 * 一个镜头在 time 这一刻的机位：按分镜的机位，只在正在唱的词跑出画面时硬切过去——
 * 机位平移到刚好把它摆进画里，远近和滚转不动，之后一直这么偏着，直到下一个出画的再切，或者分镜自己跳档。
 * 只在开唱、跳档的时刻上判断，偏多少完全由时间决定，拖进度也一样。
 */
export const resolveMetaphorPose = (input: MetaphorPoseInput): MetaphorPose => {
    const pose = plannedPose(input);
    const { shot, layout, time } = input;
    if (time < shot.start || (layout.words.length === 0 && layout.glyphs.length === 0)) return pose;
    const track = trackFor(input);
    while (track.next < track.times.length && track.times[track.next] <= time) advance(track, input);
    return shiftPose(pose, track.shiftX, track.shiftY);
};

/** 静态模式：每句一个锁死的全景。 */
export const resolveMetaphorStillPose = (layout: MetaphorLayout, aspect: number): MetaphorPose => {
    const whole = rectFocus(layout.bounds);
    return { x: whole.x, y: whole.y, distance: fitDistance(whole, WIDE_MARGIN, aspect), roll: 0, fov: METAPHOR_FOV };
};

const FLOOD_IN = 0.7;
const FLOOD_OUT = 0.9;

/** 转场在 time 这一刻的量：进当前 cue 的那一半，和出到下一个 cue 的那一半。 */
export const resolveMetaphorTransitionFx = (program: MetaphorProgram, cueIndex: number, time: number, out: MetaphorTransitionFx): MetaphorTransitionFx => {
    out.flood = 0;
    const cue = program.cues[cueIndex];
    const since = time - cue.start;
    if (since >= 0 && cue.transition === 'flood' && since < FLOOD_OUT) out.flood = 1.15 * (1 - easeOutCubic(since / FLOOD_OUT));
    if (cueIndex + 1 < program.cues.length) {
        const next = program.cues[cueIndex + 1];
        const until = next.start - time;
        if (next.transition === 'flood' && until < FLOOD_IN) out.flood = Math.max(out.flood, 1.15 * (1 - until / FLOOD_IN) ** 2);
    }
    return out;
};

/** 一句歌词的影子出现到几成（开唱前的预告）。 */
export const resolveMetaphorReveal = (cue: MetaphorCue, time: number) => clamp01((time - cue.start) / 0.5 + (cue.lineIndex < 0 ? 1 : 0));

/** 一句歌词化开到几成：只有唱完后还留着一段尾巴的才化，紧跟下一句的直接硬切。 */
export const resolveMetaphorMelt = (cue: MetaphorCue, time: number) => {
    if (cue.lineIndex < 0 || cue.end - cue.singEnd < METAPHOR_TAIL * 0.6) return 0;
    const from = Math.max(cue.singEnd + 0.3, cue.end - 1.5);
    return clamp01((time - from) / Math.max(0.05, cue.end - from));
};
