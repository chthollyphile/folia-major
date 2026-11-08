import React from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import { resolvePendoloRotatingLineOpacity } from './pendoloTimeline';
import { resolvePendoloLineWave, resolvePendoloLitOpacity } from './pendoloBeatFx';
import { projectPendoloDialPoint, type PendoloDialProjection } from './pendoloDialProjection';

// src/components/visualizer/pendolo/PendoloRotatingLine.tsx

interface PendoloRotatingLineProps {
    /** The rail's on-screen rotation (deg); mirrored, it is the wheel's rotation negated. */
    wheelRotationDeg: MotionValue<number>;
    /** 歌词左右镜像：句子以右端挂在锚点上，往左排；可见弧的判断按没镜像时的转角算。 */
    mirrored?: boolean;
    /** 镜像时用 right 定位要知道轨道的宽度（就是视口宽）。 */
    railWidth?: number;
    /** 表盘倾斜（不含镜像）：锚点跟着表盘平面投到屏幕上，字本身保持正对屏幕，只按远近缩放。 */
    tilt?: PendoloDialProjection;
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
    mirrored = false,
    railWidth = 0,
    tilt,
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
    const tilted = Boolean(tilt && !tilt.flat);
    // 倾斜时锚点要投到表盘平面上：轨道绕轮心转了 rotationDeg，先转到屏幕上（仍是平的），投影，
    // 再把位移转回轨道坐标加到 x / y 上。没倾斜时不走这里，变换和原来一模一样。
    const resolveTilt = (rotationDeg: number) => {
        const rx = left - hubX;
        const ry = top - hubY;
        const turn = (rotationDeg * Math.PI) / 180;
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        const qx = rx * c - ry * sn;
        const qy = rx * sn + ry * c;
        const p = projectPendoloDialPoint(tilt!, qx, qy);
        const dx = p.x - qx;
        const dy = p.y - qy;
        return { x: dx * c + dy * sn, y: -dx * sn + dy * c, scale: p.depthScale };
    };
    const offsetInputs = tilted
        ? (lensInputs ? [...lensInputs, wheelRotationDeg] : [wheelRotationDeg])
        : null;
    const resolveOffset = (values: number[], axis: 'x' | 'y') => {
        const lens = lensInputs ? resolveLens(values.slice(0, lensInputs.length))[axis] : 0;
        return lens + resolveTilt(values[values.length - 1])[axis];
    };
    const opacity = useTransform(
        lensInputs ? [wheelRotationDeg, ...lensInputs] : [wheelRotationDeg],
        ([rotationDeg, ...lens]: number[]) => {
            const base = resolvePendoloRotatingLineOpacity(baseAngleDeg, mirrored ? -rotationDeg : rotationDeg, baseOpacity);
            return lens.length ? resolvePendoloLitOpacity(base, resolveLens(lens).light) : base;
        },
    );
    const x = useTransform(offsetInputs ?? lensInputs ?? [wheelRotationDeg], (values: number[]) => (
        offsetInputs ? resolveOffset(values, 'x') : lensInputs ? resolveLens(values).x : 0
    ));
    const y = useTransform(offsetInputs ?? lensInputs ?? [wheelRotationDeg], (values: number[]) => (
        offsetInputs ? resolveOffset(values, 'y') : lensInputs ? resolveLens(values).y : 0
    ));
    const scale = useTransform(wheelRotationDeg, (rotationDeg: number) => (tilted ? resolveTilt(rotationDeg).scale : 1));

    return (
        <motion.div
            className={`absolute pointer-events-auto ${canSeek ? 'cursor-pointer' : ''}`}
            style={{
                ...(mirrored ? { right: railWidth - left } : { left }),
                top,
                // 倾斜时按远近缩放，原点放在锚点上（内容在里面被 translateY(-50%) 挪到锚点两侧）
                transformOrigin: `${mirrored ? 'right' : 'left'} ${tilted ? 'top' : 'center'}`,
                x,
                y,
                ...(tilted ? { scale } : null),
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
