import type { NebbiaBeatHit } from './nebbiaBeatCursor';
import type { NebbiaAquaUniforms } from './nebbiaGlUtils';
import { NEBBIA_MAX_JELLIES, type NebbiaTuning } from './types';

// src/components/visualizer/nebbia/nebbiaJellies.ts
// 水族箱的水母（窗外是水族箱时运行时每帧调）：每只自己的节奏一收一缩，缩的时候往上窜一点，慢慢浮上去，
// 浮出水面上沿就换个位置从底下再来。位置、大小、收缩、颜色算好写进两个数组，着色器（nebbiaJellyGlsl.ts）只读。
// 智能动感模式「舞潮踏拍」的水母一项开着时（走过的拍由 nebbiaAquarium.ts 给），水母跟拍：每拍全部收一下，普通拍收得轻、小节第一拍收得重，
// 自己的节奏压小，跟拍的那一下更大、往上窜得更多；拍的力度按节拍表的 accent。
// 颜色一半是固定的几种鲜艳色、一半取主题的灯光色，近的大而亮，远的小而暗。

type Rgb = [number, number, number];

interface Jelly { xf: number; y: number; depth: number; rate: number; phase: number; rise: number; hue: number; kick: number; kickFrom: number; kickAge: number; seed: number }

const VIVID: Rgb[] = [[1, 0.35, 0.72], [0.35, 0.8, 1], [0.72, 0.5, 1], [1, 0.72, 0.35]];
/** 浮到这里（画面上沿外）就从 BOTTOM 再来。 */
const TOP = -0.35, BOTTOM = 1.35;
/** 跟拍时自己那份节奏留多少。 */
const OWN_WITH_BEATS = 0.4;
/** 普通拍收多紧（小节第一拍按 1）。 */
const WEAK_BEAT = 0.6;

/** 0..1 的伪随机，只由 n 决定。 */
const rand = (n: number) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
};
/** 跟拍那一下的收缩：从 from（上一下还没舒张完的）70 毫秒收紧到 kick，再慢慢舒张。 */
const kickLevel = (j: Jelly) => (j.kickAge < 0.07 ? j.kickFrom + (j.kick - j.kickFrom) * j.kickAge / 0.07 : j.kick * Math.exp(-(j.kickAge - 0.07) / 0.3));
/** 跟拍开关时自己那份节奏在这么多秒里过渡，不突变。 */
const OWN_EASE = 1.5;

const spawn = (i: number, seed: number, y: number): Jelly => ({
    xf: rand(seed * 3.1 + i),
    y,
    depth: rand(seed * 5.7 + i * 1.3),
    rate: 1.6 + 0.9 * rand(seed * 2.3 + i),
    phase: rand(seed + i * 7.3) * Math.PI * 2,
    rise: 0.012 + 0.012 * rand(seed * 9.1 + i),
    hue: rand(seed * 4.4 + i * 11.0),
    kick: 0,
    kickFrom: 0,
    kickAge: 10,
    seed,
});

export class NebbiaJellies {
    private readonly list: Jelly[] = Array.from({ length: NEBBIA_MAX_JELLIES }, (_, i) => spawn(i, i + 1, TOP + rand(i * 13.7) * (BOTTOM - TOP)));
    private palette: Rgb[] = [[1, 0.81, 0.54], [0.54, 0.8, 1], [0.8, 0.54, 1]];
    /** 自己那份节奏留多少：不跟拍 1，跟拍 OWN_WITH_BEATS，切换时慢慢过渡。 */
    private own = 1;

    /** 主题的三个灯光色（nebbiaPalette.ts 的 la、lb、lc）。 */
    setPalette(la: Rgb, lb: Rgb, lc: Rgb) {
        this.palette = [la, lb, lc];
    }

    /**
     * 走一帧：dt 是窗外时钟走的秒数（暂停时 0），time 是窗外时钟，aspect 是画面宽高比；fired 是这一帧走过的拍，
     * strength 是水母这一项的强度（0 就是不跟拍）。写进 out 的水母几项（jelly、jellyColor、count）。
     */
    step(out: NebbiaAquaUniforms, dt: number, time: number, aspect: number, tuning: NebbiaTuning, fired: readonly NebbiaBeatHit[], strength: number) {
        const count = Math.round(tuning.jellies);
        const target = strength > 0 ? OWN_WITH_BEATS : 1;
        this.own += Math.sign(target - this.own) * Math.min(Math.abs(target - this.own), dt * (1 - OWN_WITH_BEATS) / OWN_EASE);
        const { own } = this;
        const { jelly, jellyColor } = out;
        for (let i = 0; i < count; i += 1) {
            let j = this.list[i];
            j.phase += dt * j.rate;
            const swim = Math.max(Math.sin(j.phase), 0);
            for (const beat of fired) {
                if (strength <= 0) break;
                j.kickFrom = kickLevel(j);
                j.kick = Math.max(j.kickFrom, beat.gain * strength * (beat.down ? 1 : WEAK_BEAT));
                j.kickAge = 0;
            }
            j.kickAge += dt;
            const kick = kickLevel(j);
            j.y -= dt * (j.rise * (1 + 0.9 * swim * own) + 0.06 * kick);
            if (j.y < TOP) j = this.list[i] = spawn(i, j.seed + NEBBIA_MAX_JELLIES, BOTTOM);
            const x = (j.xf + 0.02 * Math.sin(time * 0.15 + j.hue * 10)) * (aspect + 0.2) - 0.1;
            const o = i * 4;
            jelly[o] = x; jelly[o + 1] = j.y; jelly[o + 2] = (0.03 + 0.055 * j.depth) * tuning.jellySize;
            jelly[o + 3] = Math.min(1.3, Math.max(swim ** 3 * own, kick));
            const vivid = VIVID[Math.floor(j.hue * 4) % 4], theme = this.palette[Math.floor((j.hue * 3.7 % 1) * 3)];
            const shade = 0.45 + 0.55 * j.depth;
            for (let c = 0; c < 3; c += 1) jellyColor[o + c] = (vivid[c] * 0.65 + theme[c] * 0.35) * shade;
            jellyColor[o + 3] = j.phase;
        }
        out.count = count;
    }
}
