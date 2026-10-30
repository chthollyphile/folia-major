import type { NebbiaGlassMotion } from './nebbiaDrops';
import { NebbiaDrumBumps } from './nebbiaDrumBumps';
import { getDrumHits } from '../../../services/analysis/drumHits';
import { getVocalEnvelope, type VocalEnvelope } from '../../../services/analysis/vocalEnvelope';
import { BEAT_EFFECT_IDS, beatEffectPartId } from '../../../services/beatFx/beatEffects';
import { getBeatEffectStrength, getBeatFxHeard, isBeatEffectPlaying } from '../../../services/beatFx/beatFxLive';

// src/components/visualizer/nebbia/nebbiaDrizzleRide.ts
// 智能动感模式「疏雨轻车」每帧读的那一份（从 createNebbiaRuntime.ts 拆出）：开着时车跟底鼓颠、雨跟人声轨，
// 雨点、颠簸各一条强度；关着时雨按 1 走频段，车不颠。

const DRIZZLE_RIDE = BEAT_EFFECT_IDS.nebbiaDrizzleRide;
const DRIZZLE_RIDE_RAIN = beatEffectPartId(DRIZZLE_RIDE, 'rain');
const DRIZZLE_RIDE_BUMP = beatEffectPartId(DRIZZLE_RIDE, 'bump');

export class NebbiaDrizzleRide {
    private readonly drumBumps = new NebbiaDrumBumps();
    /** 雨点正在跟的人声轨包络，没有时 null、退回频段。 */
    env: VocalEnvelope | null = null;
    /** 雨点强度：乘小雨点密度和大雨点大小。 */
    rain = 1;

    /**
     * 开一帧的玻璃运动并读这一帧的效果：开着时这首有鼓点就由底鼓颠（没鼓、没分析完的随机颠），关着不颠；强度乘颠簸幅度
     * `bump`；`env`、`rain` 随后读。
     */
    step(motion: NebbiaGlassMotion, now: number, T: number, frozen: boolean, bump: number) {
        const on = isBeatEffectPlaying(DRIZZLE_RIDE);
        const key = on ? getBeatFxHeard().key : null;
        const drums = on ? getDrumHits(key) : null;
        motion.beginFrame(now, frozen, on && !drums);
        if (drums && !frozen) {
            const jolt = this.drumBumps.step(drums, key, T);
            const strength = getBeatEffectStrength(DRIZZLE_RIDE_BUMP);
            if (jolt > 0 && strength > 0 && bump > 0) motion.trigger(now, jolt * strength);
        } else if (!drums) {
            this.drumBumps.reset();
        }
        // 拉到 0 就是没有雨（还没分析完、走频段时也一样）
        this.rain = on ? getBeatEffectStrength(DRIZZLE_RIDE_RAIN) : 1;
        this.env = on ? getVocalEnvelope(key) : null;
    }
}
