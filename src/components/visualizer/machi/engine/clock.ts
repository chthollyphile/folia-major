// src/components/visualizer/machi/engine/clock.ts
// 町景的统一时钟：雨、涟漪、滴水、招牌闪烁、门这些氛围动效都只读它。暂停（播放暂停、窗口最小化、静态模式）时
// 它停住，场景就定格成一张画；一帧最多走 0.1 秒，切回前台不会一下子跳一大截。歌词相关的东西读歌曲时间，不读它。

const MAX_STEP_SECONDS = 0.1;

export class MachiClock {
    /** 氛围时间（秒），只在没暂停时前进。 */
    elapsed = 0;
    /** 这一帧氛围时间走了多少（暂停时是 0）。 */
    delta = 0;
    /** 这一帧的真实时间（镜头回正这类界面动画用，不随暂停停住）。 */
    realDelta = 0;
    paused = false;
    /** 动效强度（主题的 animationIntensity）乘在速度上。 */
    timeScale = 1;
    private last = -1;

    /** 每帧调一次，now 是 requestAnimationFrame 给的毫秒时间戳。 */
    tick(now: number) {
        const real = this.last < 0 ? 0 : Math.min(MAX_STEP_SECONDS, Math.max(0, (now - this.last) / 1000));
        this.last = now;
        this.realDelta = real;
        this.delta = this.paused ? 0 : real * this.timeScale;
        this.elapsed += this.delta;
    }

    /** 循环停过一阵后重新开始：不把停着的这段算进下一帧。 */
    resync() {
        this.last = -1;
    }
}
