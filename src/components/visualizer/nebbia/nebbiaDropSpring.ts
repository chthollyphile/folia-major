import { clamp } from './nebbiaConstants';

// src/components/visualizer/nebbia/nebbiaDropSpring.ts
// 水珠的惯性：玻璃跟车身一震，挂在玻璃上的水珠被表面张力拉着，像挂在弹簧上一样先被甩开、再阻尼回弹。
// 每颗水珠相对玻璃的偏移是一个弹簧阻尼振子 u'' + 2ζω u' + ω² u = -G·g''（g 是玻璃在屏幕上的位移）：
// 大水珠重、弹簧软，频率低、甩得开，回弹慢；小水珠被玻璃粘住，不动（PIN_R 以下），中间渐变。
// 按几个半径各算一个振子，中间插值。
// 振子只跟真实时间走（颠簸本来就不跟歌词时间），暂停时停住。

/** 振子对应的可见半径（CSS 像素）和固有频率（Hz）。 */
const RADII = [1.5, 3, 5, 8];
const FREQ = [11, 8, 5.5, 3.6];
const ZETA = 0.18;
/** 玻璃位移在屏幕上只有车身位移的 0.35（nebbiaFrameUniforms.ts 的 glassShift），水珠被甩开的幅度放大一点才看得出。 */
const GLASS = 0.35;
const GAIN = 3;
/** 半径（CSS 像素）在 PIN_R 以下的水珠被粘住不动，到 FREE_R 才完全甩得动。 */
const PIN_R = 2.5, FREE_R = 6;
/** 积分步长和二阶差分的间隔（秒）。 */
const STEP = 1 / 480;

export class NebbiaDropSpring {
    private readonly u = RADII.map(() => [0, 0]);
    private readonly v = RADII.map(() => [0, 0]);
    private last = -1;

    /** 推进到 now：`shakeAt(t)` 是车身在 t 时刻的位移。frozen 时只记下时刻。 */
    step(now: number, frozen: boolean, shakeAt: (t: number) => [number, number]) {
        const from = this.last;
        this.last = now;
        if (frozen || from < 0 || now <= from) return;
        // 掉帧或切走很久回来：只补最后 0.1 秒，不一下子积分一大段
        let t = Math.max(from, now - 0.1);
        while (t < now) {
            const h = Math.min(STEP, now - t);
            const g0 = shakeAt(t - STEP), g1 = shakeAt(t), g2 = shakeAt(t + STEP);
            for (let axis = 0; axis < 2; axis += 1) {
                const acc = -GAIN * GLASS * (g2[axis] - 2 * g1[axis] + g0[axis]) / (STEP * STEP);
                RADII.forEach((_, i) => {
                    const w = FREQ[i] * Math.PI * 2;
                    const a = acc - 2 * ZETA * w * this.v[i][axis] - w * w * this.u[i][axis];
                    // 半隐式欧拉：先更新速度再更新位置，弹簧不会越积越大
                    this.v[i][axis] += a * h;
                    this.u[i][axis] += this.v[i][axis] * h;
                });
            }
            t += h;
        }
    }

    /** 半径 r 的水珠这一帧相对玻璃的偏移 [dx, dy]，和顺着甩动方向的拉长量（正 = 竖着拉长）。 */
    offset(r: number): [number, number, number] {
        let i = 0;
        while (i < RADII.length - 2 && r > RADII[i + 1]) i += 1;
        const f = clamp((r - RADII[i]) / (RADII[i + 1] - RADII[i]));
        const free = clamp((r - PIN_R) / (FREE_R - PIN_R));
        const dx = (this.u[i][0] + (this.u[i + 1][0] - this.u[i][0]) * f) * free;
        const dy = (this.u[i][1] + (this.u[i + 1][1] - this.u[i][1]) * f) * free;
        // 甩得越远拉得越长：偏移和半径比，竖的比横的明显
        const stretch = clamp((Math.abs(dy) - Math.abs(dx) * 0.5) / Math.max(r, 1) * 0.12, -0.25, 0.35);
        return [dx, dy, stretch];
    }
}
