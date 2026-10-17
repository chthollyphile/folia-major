import React from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import { resolvePendoloRotatingLineOpacity } from './pendoloTimeline';
import { resolvePendoloLineWave, resolvePendoloLitOpacity } from './pendoloBeatFx';

// src/components/visualizer/pendolo/PendoloRotatingLine.tsx

interface PendoloRotatingLineProps {
    wheelRotationDeg: MotionValue<number>;
    baseAngleDeg: number;
    baseOpacity: number;
    left: number;
    top: number;
    /** The wheel hub and 智能动感模式's shockwave lens (usePendoloBeatFx); all 0 leaves the line as is. */
    hubX?: number;
    hubY?: number;
    waveRadius?: MotionValue<number>;
    waveBand?: MotionValue<number>;
    waveStrength?: MotionValue<number>;
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
    hubX = 0,
    hubY = 0,
    waveRadius,
    waveBand,
    waveStrength,
    fontFamily,
    fontWeight,
    canSeek,
    onClick,
    children,
}) => {
    // Without the lens values the line keeps its original single-input transform. The rail rotates
    // about the hub, so the line's distance and radial direction in rail space are its real ones.
    const lensInputs = waveRadius && waveBand && waveStrength ? [waveRadius, waveBand, waveStrength] : null;
    const resolveLens = (values: number[]) => resolvePendoloLineWave(left - hubX, top - hubY, values[0], values[1], values[2]);
    const opacity = useTransform(
        lensInputs ? [wheelRotationDeg, ...lensInputs] : [wheelRotationDeg],
        ([rotationDeg, ...lens]: number[]) => {
            const base = resolvePendoloRotatingLineOpacity(baseAngleDeg, rotationDeg, baseOpacity);
            return lens.length ? resolvePendoloLitOpacity(base, resolveLens(lens).light) : base;
        },
    );
    const x = useTransform(lensInputs ?? [wheelRotationDeg], (values: number[]) => (lensInputs ? resolveLens(values).x : 0));
    const y = useTransform(lensInputs ?? [wheelRotationDeg], (values: number[]) => (lensInputs ? resolveLens(values).y : 0));

    return (
        <motion.div
            className={`absolute pointer-events-auto ${canSeek ? 'cursor-pointer' : ''}`}
            style={{
                left,
                top,
                transformOrigin: 'left center',
                x,
                y,
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
