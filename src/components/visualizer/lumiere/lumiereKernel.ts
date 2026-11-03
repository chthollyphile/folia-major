// Copyright (c) 2026 chthollyphile
// src/components/visualizer/lumiere/lumiereKernel.ts
// 绘光原本依赖的 lumisynth 内核 / 编译器类型的最小子集：mood、段落性质、运镜变换、片尾卡帧、歌曲信息、音频帧。
// folia 里没有内核，这些只是绘光自己的场景、编译与片尾卡之间的约定；运行时（VisualizerLumiere）按这里的含义去用。

/** 光位的情绪：quiet / neutral / loud。 */
export type Mood = 'quiet' | 'neutral' | 'loud';

/** 段落性质、段落边界与编译用的行：分段规则与花火共用，见 paragraphStructure.ts。 */
export type { ParagraphBoundary, ParagraphKind, StructureLine } from '../paragraphStructure';

/** 音频特征（0..1）：低频推光束亮度、高频推浮尘闪烁、整体响度推烟雾浓度。 */
export interface LumiereAudioFrame {
    bass: number;
    treble: number;
    power: number;
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

/** 仿射矩阵：x' = a·x + c·y + tx，y' = b·x + d·y + ty。 */
export interface Affine {
    a: number;
    b: number;
    c: number;
    d: number;
    tx: number;
    ty: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/** 容器的变换参数（与 Pixi 相同的含义：先减 pivot，再缩放、旋转，最后移到 position）。 */
export interface TransformParams {
    x: number;
    y: number;
    pivotX: number;
    pivotY: number;
    scale: number;
    rotation: number;
}

export const fromParams = ({ x, y, pivotX, pivotY, scale, rotation }: TransformParams): Affine => {
    const cos = Math.cos(rotation) * scale;
    const sin = Math.sin(rotation) * scale;
    return { a: cos, b: sin, c: -sin, d: cos, tx: x - (cos * pivotX - sin * pivotY), ty: y - (sin * pivotX + cos * pivotY) };
};

/** m ∘ n：先 n 再 m。 */
export const multiply = (m: Affine, n: Affine): Affine => ({
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty,
});

export const invert = (m: Affine): Affine => {
    const det = m.a * m.d - m.b * m.c || 1e-12;
    return {
        a: m.d / det,
        b: -m.b / det,
        c: -m.c / det,
        d: m.a / det,
        tx: (m.c * m.ty - m.d * m.tx) / det,
        ty: (m.b * m.tx - m.a * m.ty) / det,
    };
};

export const applyAffine = (m: Affine, x: number, y: number) => ({ x: m.a * x + m.c * y + m.tx, y: m.b * x + m.d * y + m.ty });

/**
 * 运镜变换：没有运镜的容器变换 rest → 当前的容器变换 current。返回的矩阵把「没有运镜时的画面坐标」映射到
 * 「有运镜时的画面坐标」。想让别的图层（素材、字幕装饰）跟着场景运镜，就把它的 `setFromMatrix` 设成这个矩阵
 * （或先乘上图层自己的变换再设）；场景自己的 view 已经在 update 里套过运镜，不需要再套。
 */
export const cameraBetween = (rest: TransformParams, current: TransformParams): Affine => multiply(fromParams(current), invert(fromParams(rest)));
