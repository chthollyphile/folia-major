import React from 'react';
import type { MotionValue } from 'framer-motion';
import PulsingBorderProgress, { type BorderTuning } from './PulsingBorderProgress';
// dev/probes/pulsing-border-progress/PulsingBorderProgressRing.tsx

/** 圆环形态：正方形画布 + 默认圆角，环内放百分比或封面。 */

interface PulsingBorderProgressRingProps {
    /** 0-100 */
    progress: MotionValue<number>;
    /** 画布边长（px），环直径 = size - 2 * pad */
    size: number;
    /** 环到画布边缘的留白，给辉光留位置 */
    pad?: number;
    colors?: string[];
    trackColor?: string;
    tuning?: Partial<BorderTuning>;
    children?: React.ReactNode;
    className?: string;
}

const PulsingBorderProgressRing: React.FC<PulsingBorderProgressRingProps> = ({
    progress,
    size,
    pad = 34,
    colors,
    trackColor,
    tuning,
    children,
    className,
}) => (
    <div className={`relative shrink-0 ${className ?? ''}`} style={{ width: size, height: size }} data-probe-ring="">
        <PulsingBorderProgress
            className="pointer-events-none absolute inset-0"
            progress={progress}
            width={size}
            height={size}
            pad={pad}
            colors={colors}
            trackColor={trackColor}
            tuning={tuning}
        />
        <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
);

export default PulsingBorderProgressRing;
