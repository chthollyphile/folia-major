import type { CSSProperties } from 'react';
import type { PonderRelativeRect } from '../../../types/ponder';

// src/components/ponder/surfaces/relativeRectStyle.ts
// 合成界面把一条尺寸记录翻成 CSS 定位用的那一个换算。
//
// 每张合成界面的尺寸在它自己旁边的 *.geometry.ts 里：界面用这里的 relativeRectStyle 定位，
// 教程把同一条记录原样交给 relative 锚点。各写一遍百分比的写法做不到对齐 —— 高亮框会落在
// 真实元素旁边几个百分点，指向线也跟着指偏，看起来就是骨架和界面对不上。
//
// 坐标系一律是「所属容器的 0..1」，和 CSS 的 inset / aspect-square 同义。

/** 相对矩形 → 绝对定位样式。和 resolvePonderAnchors 的 relativeRectToPx 必须是同一套换算。 */
export const relativeRectStyle = (rect: PonderRelativeRect): CSSProperties => {
    const pct = (value: number) => `${value * 100}%`;
    return {
        position: 'absolute',
        ...(rect.left !== undefined ? { left: pct(rect.left) } : {}),
        ...(rect.right !== undefined ? { right: pct(rect.right) } : {}),
        ...(rect.top !== undefined ? { top: pct(rect.top) } : {}),
        ...(rect.bottom !== undefined ? { bottom: pct(rect.bottom) } : {}),
        ...(rect.width !== undefined ? { width: pct(rect.width) } : {}),
        ...(rect.square
            ? { aspectRatio: '1 / 1' }
            : rect.aspect !== undefined ? { aspectRatio: `1 / ${rect.aspect}` }
            : rect.height !== undefined ? { height: pct(rect.height) } : {}),
    };
};
