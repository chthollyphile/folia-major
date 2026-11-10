import React, { memo } from 'react';
import { scratchpadShapePath, type ScratchpadShapeKind } from './scratchpadLook';

// src/components/app/scratchpad/ScratchpadShape.tsx
// 一个几何体（圆 / 三角 / 「》」），画成内联 SVG：填充、线框或两者。只是装饰，读屏跳过。

type ScratchpadShapeProps = {
    kind: ScratchpadShapeKind;
    size: number;
    /** 填充色；线框时给 'none'。 */
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    className?: string;
    style?: React.CSSProperties;
};

const ScratchpadShape: React.FC<ScratchpadShapeProps> = ({ kind, size, fill = 'currentColor', stroke, strokeWidth, className, style }) => (
    <svg
        aria-hidden="true"
        focusable="false"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={className}
        style={{ overflow: 'visible', flex: 'none', ...style }}
    >
        <path d={scratchpadShapePath(kind, size)} fill={fill} stroke={stroke} strokeWidth={strokeWidth} strokeLinejoin="round" />
    </svg>
);

export default memo(ScratchpadShape);
