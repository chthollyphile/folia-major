// src/components/visualizer/backgrounds/tide/tideAudio.ts
// The sound half of the tide: smoothed band energies, a bass onset detector, and the ring/focus
// payload the surface pass consumes. Kept apart from the runtime so the maths stays testable — and
// so it is obvious that nothing here ever pushes the fluid solver around (that is what turned the
// old audio-reactive mode into a jittering mess). Everything below only shapes the water surface.

/** How many beat rings can be alive at once. 少一层：多层薄脊叠加时会互相穿过、读出闪烁。 */
export const TIDE_PULSE_COUNT = 2;
/** How many lyric clusters the surface can lift at once (matches the anchor cap). */
export const TIDE_FOCUS_COUNT = 6;

export interface TideAudioBands {
    bass: number;
    lowMid: number;
    mid: number;
    vocal: number;
    treble: number;
}

export interface TideAudioInput {
    power: number;
    bands: TideAudioBands | null;
    dt: number;
    /** Seconds; used to age the rings. */
    time: number;
    /** Where a new ring is born (uv). */
    originX: number;
    originY: number;
    /** Smoothed lyric clusters, strongest first. */
    focus: Array<{ x: number; y: number; strength: number }>;
    /** 0 disables the whole sound layer (and scales the voicing and the rings up to 2). */
    amount: number;
    /** 0 disables the lyric pool (and scales the focus lift up to 2). */
    focusAmount: number;
}

export interface TideAudioFrame {
    /** 平滑后的整体响度（0..1）：歌词推水的动量按它放大，见 tideMomentumGain。 */
    level: number;
    /** 鼓点呼吸包络（0..1）：命中鼓点吸满，然后慢慢呼出。 */
    breath: number;
    bass: number;
    /** 秒级慢包络（0..1）：这首歌此刻多用力。上面那些是「响度」，这个是「情绪」。 */
    mood: number;
    /** 段落状态（0 主歌 / 1 副歌）：带迟滞、平滑过渡，所以水面像是知道自己在哪一段。 */
    chorus: number;
    mid: number;
    treble: number;
    /** TIDE_PULSE_COUNT slots of (x, y, ageSeconds, strength); strength 0 marks a free slot. */
    pulses: number[][];
    /** TIDE_FOCUS_COUNT slots of (x, y, strength, 0); strength 0 marks a free slot. */
    focus: number[][];
}

/** The surface follows these, so they have to be smooth: a band that snaps every frame reads as a flicker. */
const BAND_TAU = 0.22;
/** The onset detector compares a fast follower against a slow one. */
const BASS_FAST_TAU = 0.03;
const BASS_SLOW_TAU = 1.1;
/**
 * 鼓点 = 快跟随者抬离慢基线。两点都是被踩过的坑：
 * 1) 用「加性余量」而不是比值 —— 慢基线升到 0.8 时「快 > 慢 × 1.22」需要 0.976，而快的上限也
 *    就 ~1.0，于是歌曲播几秒、基线收敛后就再也触发不了（波环/呼吸"只有开头几秒有效果"）；
 * 2) 快档要够快（~2 帧）—— 慢一点 EMA 就把鼓点的瞬态磨平，抬升量还是不够阈值。
 */
const ONSET_MARGIN = 0.07;
const ONSET_FLOOR = 0.05;
/** Two kicks closer than this are the same beat. */
const ONSET_MIN_GAP = 0.16;
/** A ring expands for this long before it is recycled. */
const RING_LIFE = 2.4;
/** 环从 0 升到满强度所需时间（秒）：凭空满强度出现会读成「闪一下」，涌出来才像水。 */
const RING_ATTACK = 0.18;
/** 鼓点呼吸：命中时吸满，之后按这个时间常数呼出去（比鼓点间隔长，所以是"呼吸"不是"打点"）。 */
const BREATH_TAU = 0.55;
/** 持续低频也托一点呼吸：鼓点不密时水面不会完全停住。压得很低，安静时水面要真的静下来。 */
const BREATH_BASS_FLOOR = 0.08;
/**
 * 情绪主线的时间常数（秒）。这是整个文件里唯一「秒级」的量：0.2s 级的频段/响度跟的是
 * 「此刻多响」，秒级的它跟的才是「这首歌此刻多用力」—— 段落与起伏靠它才存在。
 */
const MOOD_TAU = 3.0;
/** 段落迟滞：进副歌与退回主歌用不同门槛，避免慢包络在门槛上来回抖。 */
const SECTION_ENTER = 0.52;
const SECTION_EXIT = 0.36;
/** 段落状态的过渡时间常数（秒）：换段是滑过去的，不是跳过去的。 */
const SECTION_TAU = 0.9;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const approach = (current: number, target: number, dt: number, tau: number): number =>
    current + (target - current) * (1 - Math.exp(-dt / Math.max(tau, 0.01)));

/**
 * 主播放链路的 analyser 写的是 0..255（见 usePlaybackVisualizerBridge 的 process()：归一后乘回 255），
 * 预览 / 主题公园写的是 0..1 —— 双刻度。必须按这个规则归一：直接 `clamp(x, 0, 1)` 会把 0..255 全压成 1，
 * 于是低频/中频/高频、响度、鼓点检测全部冻在最大值（水面看起来和音乐毫无关系），
 * 安静段数值在 1.0 上下穿时还会在 0/1 之间反复跳（水面抽搐）。
 */
const normalizeAudio = (value: number): number => {
    if (!Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return value > 1 ? Math.min(1, value / 255) : value;
};

interface TideRing {
    x: number;
    y: number;
    age: number;
    strength: number;
}

export class TideAudio {
    private level = 0;
    private breath = 0;
    private mood = 0;
    private chorus = 0;
    private bass = 0;
    private mid = 0;
    private treble = 0;
    private bassFast = 0;
    private bassSlow = 0;
    private lastOnset = Number.NEGATIVE_INFINITY;
    private rings: TideRing[] = [];

    reset(): void {
        this.rings = [];
        this.lastOnset = Number.NEGATIVE_INFINITY;
    }

    update(input: TideAudioInput): TideAudioFrame {
        const dt = clamp(input.dt, 1 / 240, 1 / 12);
        const source = input.bands;
        const power = normalizeAudio(input.power || 0);
        const bass = normalizeAudio(source ? source.bass : power);
        const mid = normalizeAudio(source ? (source.mid + source.vocal) / 2 : power * 0.6);
        const treble = normalizeAudio(source ? source.treble : power * 0.5);

        const amount = clamp(input.amount, 0, 2);
        const focusAmount = clamp(input.focusAmount, 0, 2);

        this.level = approach(this.level, power, dt, BAND_TAU);
        this.bass = approach(this.bass, bass, dt, BAND_TAU);
        this.mid = approach(this.mid, mid, dt, BAND_TAU);
        this.treble = approach(this.treble, treble, dt, BAND_TAU);
        this.bassFast = approach(this.bassFast, bass, dt, BASS_FAST_TAU);
        this.bassSlow = approach(this.bassSlow, bass, dt, BASS_SLOW_TAU);

        // A kick: the fast follower lifts clear of the slow baseline. One ring per beat, capped so a
        // busy low end cannot flood the surface.
        const onsetLift = this.bassFast - this.bassSlow;
        const kick = amount > 0
            && input.time - this.lastOnset >= ONSET_MIN_GAP
            && this.bassFast > ONSET_FLOOR
            && onsetLift > Math.max(ONSET_FLOOR, this.bassSlow * ONSET_MARGIN);

        if (kick) {
            this.lastOnset = input.time;
            this.rings.push({
                x: clamp(input.originX, 0.04, 0.96),
                y: clamp(input.originY, 0.12, 0.94),
                age: 0,
                // 环的强度就是这一击抬高了多少：轻鼓也看得见，重鼓到顶。
                strength: clamp(0.35 + onsetLift * 2, 0, 1),
            });
            if (this.rings.length > TIDE_PULSE_COUNT) {
                this.rings.shift();
            }
        }

        // 鼓点呼吸：命中时吸满，之后一直呼出（时间常数比鼓点间隔长），持续低频再托一个底。
        if (kick) {
            this.breath = 1;
        }
        this.breath *= Math.exp(-dt / BREATH_TAU);

        // 情绪：秒级慢包络，只跟乐句走。它是「状态」，与上面那些「事件」互不干扰。
        this.mood = approach(this.mood, this.level, dt, MOOD_TAU);
        // 段落：迟滞二值化后再平滑成 0..1 —— 有记忆（不会在门槛上抖），换段又是滑过去的。
        const wantsChorus = this.chorus > 0.5 ? this.mood > SECTION_EXIT : this.mood > SECTION_ENTER;
        this.chorus = approach(this.chorus, wantsChorus ? 1 : 0, dt, SECTION_TAU);

        for (const ring of this.rings) {
            ring.age += dt;
        }
        while (this.rings.length > 0 && this.rings[0].age > RING_LIFE) {
            this.rings.shift();
        }

        const pulses: number[][] = [];
        for (let index = 0; index < TIDE_PULSE_COUNT; index += 1) {
            const ring = this.rings[index];
            if (ring) {
                // 出生渐强 + 寿命线性衰减。渐强用 smoothstep，保证值和斜率都连续（不会在成帧边界上突变）。
                const ramp = Math.min(1, ring.age / RING_ATTACK);
                const life = clamp(1 - ring.age / RING_LIFE, 0, 1) * ramp * ramp * (3 - 2 * ramp);
                pulses.push([ring.x, ring.y, ring.age, ring.strength * life * amount]);
            } else {
                pulses.push([0, 0, 0, 0]);
            }
        }

        // The focus slots are filled left to right so a re-ordered anchor list cannot make the pool jump.
        const focus: number[][] = [];
        const ordered = [...input.focus].sort((left, right) => left.x - right.x);
        for (let index = 0; index < TIDE_FOCUS_COUNT; index += 1) {
            const entry = ordered[index];
            focus.push(entry
                ? [clamp(entry.x, 0, 1), clamp(entry.y, 0, 1), clamp(entry.strength, 0, 1) * focusAmount, 0]
                : [0, 0, 0, 0]);
        }

        return {
            level: this.level,
            // mood 跟着总闸门走；chorus 是结构状态，只要该层没关就保持满幅，否则「强烈」的分档会被闸门削掉一半。
            mood: this.mood * amount,
            chorus: amount > 0 ? this.chorus : 0,
            breath: clamp(Math.max(this.breath, this.bass * BREATH_BASS_FLOOR), 0, 1) * amount,
            bass: this.bass * amount,
            mid: this.mid * amount,
            treble: this.treble * amount,
            pulses,
            focus,
        };
    }
}
