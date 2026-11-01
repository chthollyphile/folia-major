import type { MachiTuning } from '../types';

// src/components/visualizer/machi/engine/lens.ts
// 町景的景深参数：把设置里的光圈、强度、清晰范围、移轴，和此刻相对默认构图的缩放，换成镜头 pass（fx/lensPass.ts）
// 要的对焦带宽度与离焦圆大小（纯函数，运行时与单测共用）。

/** f/8、强度 1 时离焦最多处的离焦圆半径（画面高度的比例）：原来的微缩感。 */
export const MACHI_BASE_COC = 0.012;
/** 光圈按这一档换算：f/8 是原来的样子。 */
export const MACHI_REFERENCE_APERTURE = 8;

/**
 * 清晰的那一层（米，半宽与过渡）按清晰范围放宽、随拉近变浅；光圈每大一档（f 值除以 √2），清晰的那一层薄到 1/√2、
 * 离焦圆大到 √2 倍。从清晰到最虚的过渡只按光圈的平方根收窄：离开清晰的那一层越远越虚，一路渐渐虚上去（跟着光圈一起
 * 缩的话，大光圈下离开一两米就虚到头，画面两边一团糊，对焦面斜着切过墙面、牌子的地方还会出一道生硬的分界；完全不缩
 * 的话，纵深浅的便利店到 f/1.4 也几乎不虚）。
 * 移轴的离焦圆只跟强度走，不随光圈变。
 */
export const resolveMachiLens = (tuning: Pick<MachiTuning, 'aperture' | 'dof' | 'dofRange' | 'tiltShift'>, zoom: number) => {
    const open = MACHI_REFERENCE_APERTURE / tuning.aperture;
    const depth = tuning.dofRange / Math.max(1e-3, zoom);
    return {
        focusBand: (3.4 * depth) / open,
        focusFalloff: (7.5 * depth) / Math.sqrt(open),
        coc: MACHI_BASE_COC * tuning.dof * open,
        tilt: MACHI_BASE_COC * Math.max(1, tuning.dof) * tuning.tiltShift,
    };
};
