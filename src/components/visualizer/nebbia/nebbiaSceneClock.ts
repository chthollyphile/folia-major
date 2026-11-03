import { clamp } from './nebbiaConstants';

// src/components/visualizer/nebbia/nebbiaSceneClock.ts
// 窗外的时钟（从 createNebbiaRuntime.ts 拆出）：播放时按真实时间匀速走，暂停时停。着色器里是 float32：
// 走过 SCENE_RESET 秒后，换歌时归零，跳变藏在换歌里；一首歌连着放满 SCENE_WRAP 秒才硬回绕一次，
// 那时窗外雨丝的精度约一像素（1080p）。

const SCENE_RESET = 1000;
const SCENE_WRAP = 3600;

export class NebbiaSceneClock {
    time = 0;
    private last = 0;

    /** 走一帧，返回这一帧的 dt（暂停时 0，最多 0.1 秒）。`now` 是秒。 */
    tick(now: number, paused: boolean) {
        const dt = paused ? 0 : clamp(now - this.last, 0, 0.1);
        this.time = (this.time + dt) % SCENE_WRAP;
        this.last = now;
        return dt;
    }

    songChanged() {
        if (this.time > SCENE_RESET) this.time = 0;
    }
}
