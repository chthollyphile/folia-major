import { animate } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import {
    BRAVAIS_SEAM_TWEEN_S,
    BRAVAIS_TILT_EASE,
    BRAVAIS_TILT_IN_DELAY_S,
    BRAVAIS_TILT_IN_S,
    BRAVAIS_TILT_OUT_S,
} from './bravaisConstants';
import type { BravaisFrameState } from './useBravaisFrame';

// src/library/suites/bravais/useBravaisTilt.ts
// 整层倾斜到给定的角度（首页、集合页与歌手 / 专辑海报共用；转多少由 bravaisTilt 的 resolveBravaisTiltDeg 按缝里的内容定）：
// 两半墙与缝是同一张纸，一起绕缝的右缘、视口半高转——海报仍是墙上裂开的那一列，不是盖在墙上的一层。角度换了（换层、
// 换等级、开合面板与表单、过滤、折叠）就补间过去，回到 0 就是回正。
// 倾斜只是两个世界层与缝的 transform 前面多一段旋转（bravaisFrame 的 withTilt），每帧写帧状态再 renderFrame，不经过 React。
// 节奏：张开时裂缝先走一小段再开始转，转得比开口与相机慢一点、两头都平，三者差不多一起落定（不是一下子甩过去）；
// 回正短一些，跟着缝合上走。
// 倾斜着拖动、滚动沿着纸自己的方向走（滚轮往下，整张纸顺着倾斜的竖向走），缝这一列不会被拖到一边。
// 裁剪按反转回去的视口算（useBravaisCamera 的 getVisibleWorldBounds / bravaisFrame 的 getTiltReach）：支点跟着缝走，
// 缝拖远了视口会整块偏开，光靠 BRAVAIS_OVERSCAN 的多渲染范围兜不住。转的途中可见范围跟着变，快到已裁剪范围的边缘时补裁剪（checkCull）。
// 降低动态效果（lattice）时不倾斜（目标角度是 0），已经转着的直接回正。

export const useBravaisTilt = ({
    frameRef,
    renderFrame,
    checkCull,
    deg,
    seamFollowsTilt,
    quickOut = false,
    reducedMotion,
}: {
    frameRef: MutableRefObject<BravaisFrameState>;
    renderFrame: () => void;
    checkCull: (force?: boolean) => void;
    /** 整层该转到的角度（度；0 = 回正）。 */
    deg: number;
    /** 缝里此刻画着的是会跟着整层倾斜的内容（信息条、书脊、首页窄缝）：内容随角度缩进（useBravaisFrame）。 */
    seamFollowsTilt: boolean;
    /** 回正要赶上缝合上（翻牌交接：缝一合上就量磁贴的位置，那时墙得已经回正）：回正的时长换成开口补间的时长。 */
    quickOut?: boolean;
    reducedMotion: boolean;
}) => {
    // 内容缩进跟着画着的内容走：与内容换上来同一次提交里写（先于绘制）。
    useLayoutEffect(() => {
        frameRef.current.seamFollowsTilt = seamFollowsTilt;
        renderFrame();
    }, [frameRef, renderFrame, seamFollowsTilt]);
    const animationRef = useRef<{ stop: () => void } | null>(null);
    useEffect(() => {
        const to = deg;
        const from = frameRef.current.tiltDeg;
        animationRef.current?.stop();
        animationRef.current = null;
        frameRef.current.tiltTargetDeg = to;
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
            duration: turningIn ? BRAVAIS_TILT_IN_S : quickOut ? BRAVAIS_SEAM_TWEEN_S : BRAVAIS_TILT_OUT_S,
            delay: turningIn ? BRAVAIS_TILT_IN_DELAY_S : 0,
            ease: [...BRAVAIS_TILT_EASE],
            onUpdate: value => {
                frameRef.current.tiltDeg = value;
                renderFrame();
                // 转的途中可见范围跟着变（支点在远处时视口整块扫过去）：快到已裁剪范围的边缘时补一次裁剪，不等落定。
                checkCull();
            },
            onComplete: () => {
                animationRef.current = null;
                settle();
                checkCull(true);
            },
        });
    }, [checkCull, deg, frameRef, quickOut, reducedMotion, renderFrame]);
    useEffect(() => () => animationRef.current?.stop(), []);
};
