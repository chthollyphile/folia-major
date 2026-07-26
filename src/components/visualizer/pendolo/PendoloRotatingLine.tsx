import React from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import { resolvePendoloRotatingLineOpacity } from './pendoloTimeline';

// src/components/visualizer/pendolo/PendoloRotatingLine.tsx

interface PendoloRotatingLineProps {
    wheelRotationDeg: MotionValue<number>;
    baseAngleDeg: number;
    baseOpacity: number;
    left: number;
    top: number;
    fontFamily: string;
    fontWeight: number;
    canSeek: boolean;
    onClick: React.MouseEventHandler<HTMLDivElement>;
    children: React.ReactNode;
}

/** Keeps lyrics hidden outside the unwrapped visible arc while the wheel preserves its full rotation. */
const PendoloRotatingLine: React.FC<PendoloRotatingLineProps> = ({
    wheelRotationDeg,
    baseAngleDeg,
    baseOpacity,
    left,
    top,
    fontFamily,
    fontWeight,
    canSeek,
    onClick,
    children,
}) => {
    const opacity = useTransform(wheelRotationDeg, rotationDeg => (
        resolvePendoloRotatingLineOpacity(baseAngleDeg, rotationDeg, baseOpacity)
    ));

    return (
        <motion.div
            className={`absolute pointer-events-auto ${canSeek ? 'cursor-pointer' : ''}`}
            style={{
                left,
                top,
                transformOrigin: 'left center',
                opacity,
                fontFamily,
                fontWeight,
            }}
            onClick={onClick}
        >
            {children}
        </motion.div>
    );
};

export default React.memo(PendoloRotatingLine);
