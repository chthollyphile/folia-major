import { useMotionValue, useSpring } from 'framer-motion';
import type { PointerEvent } from 'react';

// src/components/app/lattice/radio/useRadioCardTilt.ts
// 电台墙卡片的倾斜按压（Metro 的 tilt）：指针在卡上时，卡朝指针所在的那一点往里压一点——那一点下沉、对边翘起，
// 整张略微缩小；按下时压得更深。只写 motion value（经弹簧平滑），不进 React state；触屏不倾斜。
// 指针在卡上的控件（按钮、进度条）上时卡保持原样不动：按下时卡一变形，小按钮就从指针底下挪开，松开时点不中，
// 拖进度条时卡也会跟着晃。

const SPRING = { stiffness: 320, damping: 26, mass: 0.6 };

export type RadioCardTiltOptions = {
    /** 最大倾角（度）。 */
    maxDeg: number;
    /** 悬停时的缩放与按下时的缩放。 */
    hoverScale: number;
    pressScale: number;
    disabled: boolean;
};

export function useRadioCardTilt({ maxDeg, hoverScale, pressScale, disabled }: RadioCardTiltOptions) {
    const rotateXTarget = useMotionValue(0);
    const rotateYTarget = useMotionValue(0);
    const scaleTarget = useMotionValue(1);
    const rotateX = useSpring(rotateXTarget, SPRING);
    const rotateY = useSpring(rotateYTarget, SPRING);
    const scale = useSpring(scaleTarget, SPRING);

    const reset = () => {
        rotateXTarget.set(0);
        rotateYTarget.set(0);
        scaleTarget.set(1);
    };

    // 指针在卡上的位置换成 -1..1：右边（nx > 0）往里压是 rotateY 为正，下边（ny > 0）往里压是 rotateX 为负。
    const tiltTo = (event: PointerEvent<HTMLElement>, pressed: boolean) => {
        const box = event.currentTarget.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) return;
        const nx = Math.max(-1, Math.min(1, ((event.clientX - box.left) / box.width) * 2 - 1));
        const ny = Math.max(-1, Math.min(1, ((event.clientY - box.top) / box.height) * 2 - 1));
        // 按下只再压深一点：压太深时卡的边缘会缩出指针底下，按在边上的那一下就落空了。
        const depth = pressed ? 1.25 : 1;
        rotateYTarget.set(nx * maxDeg * depth);
        rotateXTarget.set(-ny * maxDeg * depth);
        scaleTarget.set(pressed ? pressScale : hoverScale);
    };

    const skip = (event: PointerEvent<HTMLElement>) => disabled
        || event.pointerType === 'touch'
        || (event.target instanceof Element && event.target.closest('button, input, [role="slider"]') !== null);

    return {
        style: { rotateX, rotateY, scale },
        handlers: {
            onPointerMove: (event: PointerEvent<HTMLElement>) => {
                if (skip(event)) return;
                tiltTo(event, event.buttons !== 0);
            },
            onPointerDown: (event: PointerEvent<HTMLElement>) => {
                if (skip(event)) return;
                tiltTo(event, true);
            },
            onPointerUp: (event: PointerEvent<HTMLElement>) => {
                if (skip(event)) return;
                tiltTo(event, false);
            },
            onPointerLeave: reset,
            onPointerCancel: reset,
        },
    };
}
