// src/components/visualizer/bandOnsetTracker.ts
//
// 通用的「单频段起音检测」：把一个频段的能量序列拆成两个信号 —— 瞬态（这一下有多重）
// 和持续能量（这个频段现在有多响），并给出「单击一次」的 onset 触发（带迟滞，不会在一个
// 鼓点里连发）。纯函数 + 一个可变状态对象，任何要「跟着鼓点动」的 visualizer 都能用。
//
// 这段实现原本长在 diorama 的粒子模型里（那里用它给每个频段生成涟漪），
// 波环的「重拍透视」是第二个使用者，所以提到公共层 —— 两处共用同一套经过验证的口径，
// 不再各写一份。diorama 侧保留原来的名字（re-export），行为与常量完全不变。

/** 非对称指数包络：attack/release 是速率（1/秒），目标高于当前用 attack，反之用 release。 */
export const stepEnvelopeToward = (
    current: number,
    target: number,
    attack: number,
    release: number,
    delta: number,
): number => current + (target - current) * (1 - Math.exp(-(target > current ? attack : release) * delta));

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Per-band tracker that separates the two signals geometry needs, and - crucially - does NOT lose
 * sensitivity to a beat that keeps playing.
 *
 * The naive model is `onset = level - EMA(level)`. A single symmetric EMA converges to the MEAN of
 * its input, so under a steady kick pattern the reference climbed toward the kick itself and the onset
 * shrank away: the drums were still there, the geometry had simply decided they were the new background.
 * (It also started at 0, so the first seconds read `onset = level` - a full-scale spike. That inflated
 * opening was the "normal" the rest of the song then appeared to decay away from.)
 *
 * Instead we track the band's VALLEY and its PEAK separately, each asymmetric:
 *
 *   floor - rises slowly, falls fast. A kick is too brief to drag it up, so it settles in the gaps
 *           BETWEEN kicks. `fast - floor` is then the kick's full height, forever, however long the
 *           pattern runs. When the drums actually stop, the floor drops out from under it within ~0.25s
 *           and the response falls away on its own - so this stays honest, not a latch.
 *   peak  - rises fast, falls slowly (~3.5s of memory). This is the only adaptive part, and it can only
 *           adapt to how loud the SONG is, which is what it is for. Its fall is bounded and MIN_RANGE
 *           stops a near-silent passage from being normalised back up into full-scale flicker.
 *
 * transient = (fast - floor) / (peak - floor): the hit, normalised against the band's own live dynamic
 *             range. Loudness-invariant, and constant under a constant beat.
 * sustained = fast / peak: how present this band is relative to the song, which does NOT self-cancel
 *             (a held bass note keeps reading high) - the continuous-energy signal.
 */
export interface BandOnsetTracker {
    fast: number;
    floor: number;
    peak: number;
    /** Schmitt trigger: true once a transient crossed the high edge, until it falls back under the low. */
    armed: boolean;
    primed: boolean;
}

export const createBandOnsetTracker = (): BandOnsetTracker => ({
    fast: 0, floor: 0, peak: 0, armed: false, primed: false,
});

const FAST_ATTACK = 22;
const FAST_RELEASE = 7;
/**
 * The floor's rise has to clear a real range: slow enough that a hit cannot drag it up to itself, fast
 * enough to SETTLE into the gaps of a dense band. Too slow and a continuous band (sustained hi-hats) never
 * lets the floor reach its valleys, the transient never falls back to the re-arm level, and the trigger
 * latches armed - measurably zero onsets in 40s at 0.35, against ~3.7/s at 2.0. A 2 Hz kick reads
 * identically either way (its gaps are long), so one value serves every band; 2.5 keeps margin over the
 * cliff between 1.4 and 2.0.
 */
const FLOOR_RISE = 2.5;
const FLOOR_FALL = 4;
const PEAK_RISE = 9;
const PEAK_FALL = 0.28;
/** Floors both denominators, so a silent or near-silent band can never be amplified into noise. */
const MIN_RANGE = 0.12;
const MIN_PEAK = 0.22;
/** Hysteresis. One event per hit: fire crossing HIGH, re-arm only after falling back under LOW. */
const TRIGGER_HIGH = 0.42;
const TRIGGER_LOW = 0.2;

export interface BandOnsetSignal {
    /** 0..1 hit strength, normalised against the band's own dynamic range. */
    transient: number;
    /** 0..1 continuous energy in this band relative to the song's loudness. */
    sustained: number;
    /** True on the single frame a hit crosses the trigger - the only thing that fires an event. */
    onset: boolean;
}

export const stepBandOnsetTracker = (
    state: BandOnsetTracker,
    level: number,
    delta: number,
): BandOnsetSignal => {
    const safe = clamp01(level);
    if (!state.primed) {
        // Start ON the signal, not at zero: otherwise the first frames read a full-scale transient that
        // nothing later in the song can match.
        state.fast = safe;
        state.floor = safe;
        state.peak = safe;
        state.primed = true;
    } else {
        state.fast = stepEnvelopeToward(state.fast, safe, FAST_ATTACK, FAST_RELEASE, delta);
        state.floor = stepEnvelopeToward(state.floor, safe, FLOOR_RISE, FLOOR_FALL, delta);
        state.peak = stepEnvelopeToward(state.peak, safe, PEAK_RISE, PEAK_FALL, delta);
    }
    const range = Math.max(MIN_RANGE, state.peak - state.floor);
    const transient = clamp01((state.fast - state.floor) / range);
    const sustained = clamp01(state.fast / Math.max(MIN_PEAK, state.peak));
    let onset = false;
    if (!state.armed && transient >= TRIGGER_HIGH) {
        state.armed = true;
        onset = true;
    } else if (state.armed && transient <= TRIGGER_LOW) {
        state.armed = false;
    }
    return { transient, sustained, onset };
};
