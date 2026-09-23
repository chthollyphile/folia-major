// mods/cinerama/cineramaAnimation.mjs
// 行相位与逐段进度：**只有时序，没有形态**。
//
// 行的入场 / 退场形态现在全部归转场层（`cineramaTransition`）：
//   - 下一行紧邻 → 转场窗口驱动交叉（退出方 + 进入方同时存在）；
//   - 不紧邻（首行 / 空档后起行 / 行末有空档）→ 这里给的 phase 直接喂给转场那对
//     enter / exit 帧，只是屏上没有旧层，没有交叉对象。
//
// 这里以前还带一条「怎么进」的形态轴（编译期按行抽
// `fade / slide-up / wipe / zoom-settle / flicker`）。它**只在没有交叉对象时才生效**——
// 紧邻时被转场的 dissolve 顶掉，而密集段落的绝大多数行都是紧邻的，
// 剩下首行与几处间奏后各露一次，五档里每一档整首歌出现率是个位数百分比，
// 且没有一条测试覆盖它。形态轴已移除，形态只剩转场那一套（`CINERAMA_TRANSITION_POOL`）。

export const CINERAMA_IDLE_ANIMATION_FRAME = {
    opacity: 1,
    x: 0,
    y: 0,
    scale: 1,
    blur: 0,
    clip: null,
};

const smoothstep = (value) => {
    const t = Math.min(1, Math.max(0, value));
    return t * t * (3 - 2 * t);
};

/*
 * Classifies where `time` sits inside a line window. Durations are capped by a
 * share of the window so short lines never spend their whole life transitioning.
 *
 * `exit: 0` 表示**这一行的退场交给转场**（见 cineramaTransition）：下一行紧邻时，
 * 这一行不再自己淡到 0——自己淡到 0 再让下一行淡入，中间会出现一帧全空，
 * 大屏上读出来是「每次换行都眨一下」。退场改由转场窗口驱动，两侧在那一段里交叠。
 * 不紧邻（有空档、或是最后一行）时 `exit > 0`，这一相由调用方送去
 * `resolveCineramaTransitionExitFrame`。
 *
 * `phase: 'pre'` 表示**这一行还没出现**（`progress` 恒为 0），调用方必须按 opacity 0
 * 显示它——落进恒等帧就是整屏满不透明地提前出现。
 */
export const resolveCineramaLinePhase = (window, time, { enter = 0.28, exit = 0.22 } = {}) => {
    const span = Math.max(0.001, window.endTime - window.startTime);
    const enterDuration = Math.min(enter, span * 0.4);
    const exitDuration = Math.min(exit, span * 0.35);
    if (time < window.startTime) return { phase: 'pre', progress: 0 };
    if (time < window.startTime + enterDuration) {
        return { phase: 'enter', progress: (time - window.startTime) / enterDuration };
    }
    if (exitDuration > 0 && time > window.endTime - exitDuration) {
        return {
            phase: 'exit',
            progress: Math.min(1, (time - (window.endTime - exitDuration)) / exitDuration),
        };
    }
    return { phase: 'hold', progress: 1 };
};

/*
 * Per-unit presence 0..1, the seam between the split layer and the renderer:
 * units carry their own window, so a line lands as one wave sweeping across the
 * screen instead of appearing all at once.
 */
export const resolveCineramaUnitProgress = (unit, time, { enter = 0.3 } = {}) => {
    const span = Math.max(0.001, (unit?.endTime ?? 0) - (unit?.startTime ?? 0));
    const duration = Math.min(enter, span * 0.5);
    return smoothstep((time - (unit?.startTime ?? 0)) / duration);
};
