// Copyright (c) 2026 chthollyphile
// src/components/visualizer/hanabi/hanabiKernel.ts
// 花火原本依赖的 lumisynth 内核 / 风格包契约类型的最小子集：mood、运镜变换、片尾卡帧、歌曲信息。
// folia 里没有内核，这些只是花火自己的场景、编译与片尾卡之间的约定；运行时（createHanabiPixiRuntime）按这里的含义去用。

/** 预设的情绪：quiet / neutral / loud（编译时按段落性质挑）。 */
export type Mood = 'quiet' | 'neutral' | 'loud';

/** 容器的变换参数（与 Pixi 相同的含义：先减 pivot，再缩放、旋转，最后移到 position）。 */
export interface TransformParams {
    x: number;
    y: number;
    pivotX: number;
    pivotY: number;
    scale: number;
    rotation: number;
}

/** 片尾卡要显示的歌曲信息。 */
export interface SongMetadata {
    title: string | null;
    artist: string | null;
    album: string | null;
}

/** 片尾卡的时间线帧：歌词层的透明度与失焦、片尾卡本身的透明度、位移与缩放。 */
export interface CreditsFrame {
    active: boolean;
    lyricAlpha: number;
    lyricBlur: number;
    posterAlpha: number;
    posterOffsetY: number;
    posterScale: number;
}
