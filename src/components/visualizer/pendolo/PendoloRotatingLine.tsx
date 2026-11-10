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
    /** Where the lens travels out from, screen CSS px from the hub (set under drum hits; else 0). */
    waveX?: MotionValue<number>;
    waveY?: MotionValue<number>;
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
    waveX,
    waveY,
    fontFamily,
    fontWeight,
    canSeek,
    onClick,
    children,
}) => {
    // Without the lens values the line keeps its original single-input transform. The rail rotates
    // about the hub, so the line's distance and radial direction in rail space are its real ones.
    // A lens off the hub is in screen space and the rail is rotated, so its origin is turned into
    // rail space by the wheel's rotation first.
    const lensInputs = waveRadius && waveBand && waveStrength
        ? (waveX && waveY ? [waveRadius, waveBand, waveStrength, waveX, waveY, wheelRotationDeg] : [waveRadius, waveBand, waveStrength])
        : null;
    const resolveLens = (values: number[]) => {
        let originX = 0;
        let originY = 0;
        if (values.length > 3 && (values[3] !== 0 || values[4] !== 0)) {
            const turn = (-values[5] * Math.PI) / 180;
            originX = values[3] * Math.cos(turn) - values[4] * Math.sin(turn);
            originY = values[3] * Math.sin(turn) + values[4] * Math.cos(turn);
        }
        return resolvePendoloLineWave(left - hubX - originX, top - hubY - originY, values[0], values[1], values[2]);
    };
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
