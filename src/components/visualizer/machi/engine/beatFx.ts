import { DRUM_KICK, DRUM_SNARE, type DrumHits } from '../../../../services/analysis/drumHits';
import { resolveBeatFxAccentGain, type BeatFxEvent } from '../../../../services/beatFx/clock';

// src/components/visualizer/machi/engine/beatFx.ts
// 町景在智能动感模式里的三个效果（纯函数，不碰 three）：
//   霓虹随拍 machi.neonPulse   <- beat_this 的整张节拍表：招牌霓虹分成三组，每拍轮到下一组，那组慢慢亮起、再慢慢暗下，
//                                别的组同时暗一点，此起彼伏，整条街的亮度不跟着一跳一跳；近白的灯箱只跟一小份（不然冲成白块）。
//                                店里的灯、亮窗（连同地上的光斑）只在小节第一拍慢慢涨落一点；bloom 跟三组的平均走。
//                                偏中高频的拍多亮霓虹、偏低频的小节第一拍多亮暖色的灯（按那拍的三段占比；没有重音数据时一样）。
//   鼓点涟漪 machi.drumRipple  <- htdemucs 分出的底鼓：每下底鼓从歌词屏脚下在湿地面上荡开一圈涟漪（扰动倒影、带一道亮环），
//                                最多同时四圈；地面干的时候改成地上的光斑跟着跳一下。
//   大屏闪拍 machi.screenFlash <- htdemucs 分出的军鼓：每下够响的军鼓在歌词屏的一处慢慢亮起、再慢慢暗下，先后几下落在不同的
//                                位置；军鼓再密也只是亮着起伏（叠起来有上限），不频闪。
// 拍点、鼓点都按听到的时间取，画面只由时间决定，拖进度、暂停都对。效果关着、拍点 / 鼓点没装好时得到常态值，
// 画面和关掉智能动感模式时一样。

/** 霓虹分几组轮流。 */
export const MACHI_NEON_GROUPS = 3;

/** 一帧里三个效果交给场景、地面、歌词屏的量；常态见 createMachiBeatFrame。 */
export interface MachiBeatFrame {
    /** 每组霓虹的亮度倍数（1 是常态）；场景按招牌分组取（machiNeonGroup / machiLightboxGroup）。 */
    neonGroups: Float32Array;
    /** 三组霓虹的平均倍数：照到四周的霓虹光、雾里的霓虹灯晕这类分不开组的。 */
    neon: number;
    /** 店里的灯、亮窗（连同它们投在地上的光斑）的亮度倍数（1 是常态）。 */
    warm: number;
    /** bloom 强度的倍数（1 是常态）。 */
    bloom: number;
    /** 地面干时地上的光斑多亮的量（0 是常态；城寨的环境光跟着光斑走，也一起跳）。 */
    thump: number;
    /** 歌词屏上几处亮起的位置（0..1，屏幕左到右）与亮度（0 是没有）。 */
    swellAt: Float32Array;
    swellAmp: Float32Array;
}

/** 调好的样子（各效果强度 1 时）。 */
export const MACHI_BEAT = {
    /**
     * 霓虹随拍：每组亮起多久、暗下多久（秒）、亮起时涨多少、别的组跟着暗多少（按与平均的差）；小节第一拍再乘 downbeat。
     */
    neon: { attack: 0.4, fall: 1.5, lift: 0.2, contrast: 0.2, downbeat: 1.2 },
    /** 灯箱跟霓虹那一路的几成。 */
    lightbox: 0.3,
    /** 店里的灯：小节第一拍亮起多久、暗下多久、涨多少。 */
    warm: { attack: 0.6, fall: 2.2, lift: 0.08 },
    /** bloom 跟三组平均涨多少。 */
    bloom: 0.1,
    /**
     * 鼓点涟漪：环走多快（米 / 秒）、活多久（秒）、最多几圈；弱于 floor 的底鼓不算，两圈至少隔 gap 秒（max 圈正好排满 life，
     * 底鼓再密也没有哪圈没走完就被挤掉）。路面湿度在 wet 两个值之间时，环渐渐出来、光斑的一跳渐渐退掉（地面着色器用同一对值）。
     */
    ripple: { speed: 6.5, life: 1.3, max: 4, floor: 0.3, gap: 0.33, thump: 0.55, thumpDecay: 0.14, wet: [0.1, 0.6] },
    /**
     * 大屏闪拍：每处亮起多久、暗下多久（秒）；弱于 floor 的军鼓不算，两处至少隔 gap 秒（max 处正好排满 attack + fall）。
     */
    screen: { attack: 0.25, fall: 1.15, max: 4, floor: 0.4, gap: 0.35 },
} as const;

export const createMachiBeatFrame = (): MachiBeatFrame => ({
    neonGroups: new Float32Array(MACHI_NEON_GROUPS).fill(1),
    neon: 1,
    warm: 1,
    bloom: 1,
    thump: 0,
    swellAt: new Float32Array(MACHI_BEAT.screen.max).fill(0.5),
    swellAmp: new Float32Array(MACHI_BEAT.screen.max),
});

/** 改回常态（就地，每帧复用）。 */
export const resetMachiBeatFrame = (out: MachiBeatFrame) => {
    out.neonGroups.fill(1);
    out.neon = 1;
    out.warm = 1;
    out.bloom = 1;
    out.thump = 0;
    out.swellAt.fill(0.5);
    out.swellAmp.fill(0);
    return out;
};

/** 第 group 组招牌霓虹的亮度倍数。 */
export const machiNeonGroup = (beat: MachiBeatFrame, group: number) => beat.neonGroups[group % MACHI_NEON_GROUPS]!;

/** 第 group 组近白的招牌灯箱（店招、价格立柱）：霓虹那一路的一小份。 */
export const machiLightboxGroup = (beat: MachiBeatFrame, group: number) => 1 + MACHI_BEAT.lightbox * (machiNeonGroup(beat, group) - 1);

/** 慢慢亮起、再慢慢暗下的一下（0..1）：前 attack 秒升上去，后 fall 秒落回来，两头都是缓的。 */
export const machiSwell = (age: number, attack: number, fall: number) => {
    if (age < 0 || age >= attack + fall) return 0;
    if (age < attack) {
        const u = age / attack;
        return u * u * (3 - 2 * u);
    }
    const u = (age - attack) / fall;
    return 1 - u * u * (3 - 2 * u);
};

/** 路面有多湿就有多少涟漪（0..1，与地面着色器里的 smoothstep 一样）；剩下的给光斑的一跳。 */
export const machiRippleWetness = (wetness: number) => {
    const [from, to] = MACHI_BEAT.ripple.wet;
    const t = Math.min(1, Math.max(0, (wetness - from) / (to - from)));
    return t * t * (3 - 2 * t);
};

/** 升序列表里最后一个 ≤ time 的下标；没有就 -1。 */
const lastAtOrBefore = (count: number, at: (index: number) => number, time: number) => {
    let low = 0;
    let high = count;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (at(middle) <= time) low = middle + 1;
        else high = middle;
    }
    return low - 1;
};

/** 每组这一刻有多亮（0..），每帧复用。 */
const groupSwells = new Float32Array(MACHI_NEON_GROUPS);

/**
 * 霓虹随拍：events 是整张节拍表（升序），按它在表里的序号轮到第几组（拖进度也是同一组）；够不上拍（没有节奏的小节）的不亮。
 * 一组被同一组前一拍的余光与这一拍叠着时取亮的那个。每组的倍数 = 1 + 强度 ×（lift × 这组 + contrast ×（这组 − 三组平均）），
 * 三组一样亮时 contrast 那项为零，所以只是轮流，不会整体变暗。
 */
export const resolveMachiNeonPulse = (
    events: readonly BeatFxEvent[],
    time: number,
    strength: number,
    trackScale: number,
    out: MachiBeatFrame,
) => {
    out.neonGroups.fill(1);
    out.neon = 1;
    out.warm = 1;
    out.bloom = 1;
    if (!events.length || strength <= 0) return out;
    const { neon, warm } = MACHI_BEAT;
    const life = Math.max(neon.attack + neon.fall, warm.attack + warm.fall);
    groupSwells.fill(0);
    let bar = 0;
    for (let index = lastAtOrBefore(events.length, at => events[at]!.t, time); index >= 0; index -= 1) {
        const event = events[index]!;
        const age = time - event.t;
        if (age >= life) break;
        const gain = resolveBeatFxAccentGain(event, trackScale);
        if (gain <= 0) continue;
        const tone = event.tone;
        const downbeat = event.kind === 'downbeat';
        const neonTone = tone ? Math.max(0, 0.4 + 0.9 * (tone.mid + tone.high)) : 1;
        const group = index % MACHI_NEON_GROUPS;
        const swell = gain * neonTone * (downbeat ? neon.downbeat : 1) * machiSwell(age, neon.attack, neon.fall);
        groupSwells[group] = Math.max(groupSwells[group]!, swell);
        if (downbeat) {
            const warmTone = tone ? Math.max(0, 0.4 + 1.8 * tone.low) : 1;
            bar = Math.max(bar, gain * warmTone * machiSwell(age, warm.attack, warm.fall));
        }
    }
    let mean = 0;
    for (let group = 0; group < MACHI_NEON_GROUPS; group += 1) mean += groupSwells[group]!;
    mean /= MACHI_NEON_GROUPS;
    for (let group = 0; group < MACHI_NEON_GROUPS; group += 1) {
        const swell = groupSwells[group]!;
        out.neonGroups[group] = Math.max(0, 1 + strength * (neon.lift * swell + neon.contrast * (swell - mean)));
    }
    out.neon = 1 + strength * neon.lift * mean;
    out.warm = 1 + strength * warm.lift * bar;
    out.bloom = 1 + strength * MACHI_BEAT.bloom * mean;
    return out;
};

/** 鼓点在 time 处还有效：分离还没做完的歌，until 之后的鼓点还不知道。 */
export const machiDrumHitsAt = (hits: DrumHits | null, time: number): DrumHits | null => (
    hits && (hits.until === undefined || time < hits.until) ? hits : null
);

/** 每份鼓点按规则挑好的那几下（1 是挑中），一份鼓点只挑一次（分离到一半的歌每次交来的是新的一份）。 */
const pickedCache = new WeakMap<DrumHits, Map<string, Uint8Array>>();

/**
 * kind 的鼓点里挑哪几下：够响（≥ floor）、离上一个挑中的够远（不到 gap 的那下不算，留早的那下）。从头往后挑，
 * 与画哪一帧无关：窗口滑动时不会有一下忽然冒出来或消失（只从窗口里往后挑的话，鼓点一密，挑中哪几下会跟着窗口的起点变）。
 */
const pickedDrumHits = (hits: DrumHits, kind: number, floor: number, gap: number) => {
    let byRule = pickedCache.get(hits);
    if (!byRule) {
        byRule = new Map();
        pickedCache.set(hits, byRule);
    }
    const rule = `${kind}:${floor}:${gap}`;
    let picked = byRule.get(rule);
    if (!picked) {
        picked = new Uint8Array(hits.times.length);
        let previous = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < hits.times.length; index += 1) {
            const hitAt = hits.times[index]!;
            if (hits.kinds[index] !== kind || hits.strengths[index]! < floor || hitAt - previous < gap) continue;
            previous = hitAt;
            picked[index] = 1;
        }
        byRule.set(rule, picked);
    }
    return picked;
};

/**
 * 挑中的鼓点里到 time 还活着（< life）的那几下：下标环形写进 kept（只留最新的 kept.length 个），返回一共几下；
 * kept[(count - 1 - n) % kept.length] 是倒数第 n + 1 下。gap × kept.length ≥ life 时活着的不会超过 kept.length 个，没有哪下半路被挤掉。
 */
const pickDrumHits = (
    hits: DrumHits,
    time: number,
    kind: number,
    floor: number,
    gap: number,
    life: number,
    kept: Int32Array,
) => {
    const picked = pickedDrumHits(hits, kind, floor, gap);
    const at = (index: number) => hits.times[index]!;
    const last = lastAtOrBefore(hits.times.length, at, time);
    let count = 0;
    for (let index = lastAtOrBefore(hits.times.length, at, time - life) + 1; index <= last; index += 1) {
        if (!picked[index]) continue;
        kept[count % kept.length] = index;
        count += 1;
    }
    return count;
};

/** 涟漪、大屏亮起的那几下（每帧复用）。 */
const keptKicks = new Int32Array(MACHI_BEAT.ripple.max);
const keptSnares = new Int32Array(MACHI_BEAT.screen.max);

/**
 * 鼓点涟漪：time 之前、还活着的几圈（最新的在前）。rings 是 [年龄, 幅度] × MACHI_BEAT.ripple.max 的扁平数组，
 * 空的一圈年龄 -1、幅度 0（地面上幅度按剩余寿命的平方淡）。返回地面干时光斑的那一跳（0..）。
 */
export const resolveMachiDrumRipples = (hits: DrumHits | null, time: number, strength: number, rings: Float32Array) => {
    const { life, max, floor, gap, thump, thumpDecay } = MACHI_BEAT.ripple;
    for (let slot = 0; slot < max; slot += 1) {
        rings[slot * 2] = -1;
        rings[slot * 2 + 1] = 0;
    }
    if (!hits || strength <= 0) return 0;
    const count = pickDrumHits(hits, time, DRUM_KICK, floor, gap, life, keptKicks);
    let pulse = 0;
    for (let slot = 0; slot < Math.min(count, max); slot += 1) {
        const hit = keptKicks[(count - 1 - slot) % max]!;
        const age = time - hits.times[hit]!;
        const amp = strength * hits.strengths[hit]!;
        rings[slot * 2] = age;
        rings[slot * 2 + 1] = amp;
        pulse = Math.max(pulse, thump * amp * Math.exp(-age / thumpDecay));
    }
    return pulse;
};

/**
 * 大屏闪拍：还亮着的几下军鼓各在屏上的哪、多亮（写进 out.swellAt / out.swellAmp，最新的在前，空的亮度 0）。
 * 位置按那下鼓点在表里的序号取（黄金分割步进，先后几下左右错开；拖进度也落在同一处）。
 */
export const resolveMachiScreenFlash = (hits: DrumHits | null, time: number, strength: number, out: MachiBeatFrame) => {
    out.swellAt.fill(0.5);
    out.swellAmp.fill(0);
    if (!hits || strength <= 0) return out;
    const { attack, fall, max, floor, gap } = MACHI_BEAT.screen;
    const count = pickDrumHits(hits, time, DRUM_SNARE, floor, gap, attack + fall, keptSnares);
    for (let slot = 0; slot < Math.min(count, max); slot += 1) {
        const hit = keptSnares[(count - 1 - slot) % max]!;
        out.swellAt[slot] = 0.15 + 0.7 * ((hit * 0.618034) % 1);
        out.swellAmp[slot] = strength * hits.strengths[hit]! * machiSwell(time - hits.times[hit]!, attack, fall);
    }
    return out;
};
