import { animate } from 'framer-motion';
import { useEffect, useRef, type MutableRefObject } from 'react';
import {
    BRAVAIS_POSTER_TILT_DEG,
    BRAVAIS_POSTER_TILT_EASE,
    BRAVAIS_POSTER_TILT_IN_DELAY_S,
    BRAVAIS_POSTER_TILT_IN_S,
    BRAVAIS_POSTER_TILT_OUT_S,
} from './bravaisConstants';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisPosterTilt.ts
// 歌手海报在场时整层倾斜（BRAVAIS_POSTER_TILT_DEG）：两半墙与缝（海报）是同一张纸，一起绕海报右缘、视口半高转——
// 海报仍是墙上裂开的那一列，不是盖在墙上的一层。海报收起（过滤、面板、表单、书脊、折叠、换到别的层）时补间回正。
// 倾斜只是两个世界层与缝的 transform 前面多一段旋转（bravaisFrame 的 withTilt），每帧写帧状态再 renderFrame，不经过 React。
// 节奏：张开时裂缝先走一小段再开始转，转得比开口与相机慢一点、两头都平，三者差不多一起落定（不是一下子甩过去）；
// 回正短一些，跟着缝合上走。
// 倾斜着拖动、滚动沿着纸自己的方向走（滚轮往下，整张纸顺着倾斜的竖向走），海报这一列不会被拖到一边。
// 裁剪按反转回去的视口算（useBravaisCamera 的 getVisibleWorldBounds / bravaisFrame 的 getTiltReach）：支点跟着缝走，
// 缝拖远了视口会整块偏开，光靠 BRAVAIS_OVERSCAN 的多渲染范围兜不住。
// 降低动态效果（lattice）时不倾斜。

export const useBravaisPosterTilt = ({
    frameRef,
    renderFrame,
    checkCull,
    poster,
    reducedMotion,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    renderFrame: () => void;
    checkCull: (force?: boolean) => void;
    /** 此刻是歌手海报。 */
    poster: boolean;
    reducedMotion: boolean;
}) => {
    const tilted = poster && !reducedMotion;
    const animationRef = useRef<{ stop: () => void } | null>(null);
    useEffect(() => {
        const to = tilted ? BRAVAIS_POSTER_TILT_DEG : 0;
        const from = frameRef.current.tiltDeg;
        animationRef.current?.stop();
        animationRef.current = null;
        // 补间中缝整块交给合成器转，落定后旋转才画进轨道那一层（字清楚，见 bravaisFrame 的 seamTransforms）。
        const settle = () => {
            frameRef.current.tiltSettled = true;
            renderFrame();
        };
        if (Math.abs(to - from) < 0.01) {
            if (!frameRef.current.tiltSettled) settle();
            return;
        }
        if (reducedMotion) {
            frameRef.current.tiltDeg = to;
            frameRef.current.tiltSettled = true;
            renderFrame();
            checkCull(true);
            return;
        }
        const turningIn = Math.abs(to) > Math.abs(from);
        frameRef.current.tiltSettled = false;
        animationRef.current = animate(from, to, {
            duration: turningIn ? BRAVAIS_POSTER_TILT_IN_S : BRAVAIS_POSTER_TILT_OUT_S,
            delay: turningIn ? BRAVAIS_POSTER_TILT_IN_DELAY_S : 0,
            ease: [...BRAVAIS_POSTER_TILT_EASE],
            onUpdate: value => {
                frameRef.current.tiltDeg = value;
                renderFrame();
            },
            onComplete: () => {
                animationRef.current = null;
                settle();
                checkCull(true);
            },
        });
    }, [checkCull, frameRef, reducedMotion, renderFrame, tilted]);
    useEffect(() => () => animationRef.current?.stop(), []);

    return { tilted };
};
