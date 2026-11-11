import React from 'react';
import { motion, useTransform, type MotionValue } from 'framer-motion';
import { resolvePendoloRotatingLineOpacity } from './pendoloTimeline';
import { resolvePendoloLineWave, resolvePendoloLitOpacity } from './pendoloBeatFx';

// src/components/visualizer/pendolo/PendoloRotatingLine.tsx

/** 轮心视角下弧线上的句子转过这个角度（度）开始淡出，到 PENDOLO_STAND_HIDE_DEG 完全看不见。 */
const PENDOLO_STAND_FADE_DEG = 65;
const PENDOLO_STAND_HIDE_DEG = 75;
const resolvePendoloStandEdgeFade = (angleDeg: number) => Math.max(
    0,
    Math.min(1, (PENDOLO_STAND_HIDE_DEG - Math.abs(angleDeg)) / (PENDOLO_STAND_HIDE_DEG - PENDOLO_STAND_FADE_DEG)),
);

export interface PendoloStandUp {
    /** 句子在平面内要转的角度（抵掉轨道的转角，字的横向朝相机的右手）。 */
    rotationDeg: MotionValue<number>;
    /** 绕底边立起来的角度（rotateX，度）：-90 垂直于表盘，按相机俯角少转一点，字面正对相机。 */
    tiltDeg: number;
}

interface PendoloRotatingLineProps {
    /** The rail's on-screen rotation (deg); mirrored, it is the wheel's rotation negated. */
    wheelRotationDeg: MotionValue<number>;
    /** 歌词左右镜像：句子以右端挂在锚点上，往左排；可见弧的判断按没镜像时的转角算。 */
    mirrored?: boolean;
    /** 镜像时用 right 定位要知道轨道的宽度（就是视口宽）。 */
    railWidth?: number;
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
    /**
     * 轮心视角：句子绕自己的底边立起来、正对相机，中点对着自己在弧线上的锚点。没有时句子平躺在表盘上，
     * 和原来一样。
     */
    standUp?: PendoloStandUp;
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
    standUp,
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
            const unmirrored = mirrored ? -rotationDeg : rotationDeg;
            let base = resolvePendoloRotatingLineOpacity(baseAngleDeg, unmirrored, baseOpacity);
            // 立起来时弧线两端的句子贴近相机平面，透视会把它们放得很大（DOM 没有近平面裁剪）：转过一定角度就淡掉
            if (standUp) base *= resolvePendoloStandEdgeFade(baseAngleDeg + unmirrored);
            return lens.length ? resolvePendoloLitOpacity(base, resolveLens(lens).light) : base;
        },
    );
    // 轮心视角下淡到看不见的句子被透视放大、挡在两侧，不能再接点击（不立起来时不碰，和原来一样）
    const standPointerEvents = useTransform(opacity, value => (value < 0.01 ? 'none' : 'auto'));
    const x = useTransform(lensInputs ?? [wheelRotationDeg], (values: number[]) => (lensInputs ? resolveLens(values).x : 0));
    const y = useTransform(lensInputs ?? [wheelRotationDeg], (values: number[]) => (lensInputs ? resolveLens(values).y : 0));

    return (
        <motion.div
            className={`absolute pointer-events-auto ${canSeek ? 'cursor-pointer' : ''}`}
            style={{
                ...(mirrored ? { right: railWidth - left } : { left }),
                top,
                // 立起来时绕锚点那条线转（盒子顶边就是锚点所在的高度），句子才正对刻度针，不往一侧偏半行字高
                transformOrigin: `${mirrored ? 'right' : 'left'} ${standUp ? 'top' : 'center'}`,
                x,
                y,
                // 先绕 X 轴立起来（字的上方朝离开表盘、略向后仰到正对相机），再在平面内转向相机
                ...(standUp ? { rotate: standUp.rotationDeg, rotateX: standUp.tiltDeg } : null),
                // 总是写这一项：从轮心视角切回平放时 motion 不会清掉去掉的样式键，留着 none 就点不到了
                pointerEvents: standUp ? standPointerEvents : 'auto',
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
