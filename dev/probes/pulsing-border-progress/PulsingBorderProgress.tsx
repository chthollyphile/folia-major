import React, { useLayoutEffect, useRef } from 'react';
import { ShaderMount } from '@paper-design/shaders-react';
import type { PaperShaderElement } from '@paper-design/shaders';
import type { MotionValue } from 'framer-motion';
import { buildProgressBorderUniforms, pulsingBorderProgressFragmentShader } from './pulsingBorderProgressShader';
// dev/probes/pulsing-border-progress/PulsingBorderProgress.tsx

/**
 * 带进度的发光描边（实验性，只在探针页使用）。
 *
 * 圆环和圆角矩形是同一个着色器：描边路径由 width/height/pad/cornerRadius 决定，
 * 正方形画布 + 默认圆角就是圆环，卡片尺寸 + 指定圆角就是卡片边框。
 * 进度直接写 u_progress，不进 React state，也不做 DOM 遮罩。
 */

export interface BorderTuning {
    speed: number;
    thickness: number;
    softness: number;
    intensity: number;
    bloom: number;
    spots: number;
    spotSize: number;
    pulse: number;
    smoke: number;
    /** 端点羽化，占周长的比例；和描边宽度同量级时端点是圆头 */
    fade: number;
    /** 端点高光强度 */
    head: number;
    /** 已完成段常亮底色的不透明度 */
    base: number;
    /** 未完成轨道的不透明度 */
    track: number;
}

export const DEFAULT_BORDER_TUNING: BorderTuning = {
    speed: 1,
    thickness: 0.06,
    softness: 0.7,
    intensity: 0.35,
    bloom: 0.6,
    spots: 3,
    spotSize: 0.35,
    pulse: 0.25,
    smoke: 0.55,
    fade: 0.02,
    head: 0.55,
    base: 0.4,
    track: 0.14,
};

export const DEFAULT_BORDER_COLORS = ['#0dc1fd', '#d915ef', '#ff8a3d'];

interface PulsingBorderProgressProps {
    /** 0-100 */
    progress: MotionValue<number>;
    /** 画布尺寸（px），含辉光留白 */
    width: number;
    height: number;
    /** 描边到画布边缘的留白（px），给辉光留位置 */
    pad?: number;
    /** 描边圆角（px），缺省取最短边的一半，即圆 / 胶囊 */
    cornerRadius?: number;
    colors?: string[];
    /** 轨道颜色，浅色宿主上用黑，深色宿主上用白 */
    trackColor?: string;
    /** 已完成段底色，缺省跟第一个光斑颜色走 */
    baseColor?: string;
    tuning?: Partial<BorderTuning>;
    className?: string;
    style?: React.CSSProperties;
}

const clampProgress = (value: number) => Math.min(1, Math.max(0, value / 100));

const PulsingBorderProgress: React.FC<PulsingBorderProgressProps> = ({
    progress,
    width,
    height,
    pad = 24,
    cornerRadius,
    colors = DEFAULT_BORDER_COLORS,
    trackColor = '#ffffff',
    baseColor,
    tuning,
    className,
    style,
}) => {
    const elementRef = useRef<PaperShaderElement>(null);
    const latestProgress = useRef(clampProgress(progress.get()));
    const merged = { ...DEFAULT_BORDER_TUNING, ...tuning };

    // 进度只写 uniform：MotionValue 每帧变化都在这里落地，不触发 React 重渲染
    useLayoutEffect(() => {
        const apply = (value: number) => {
            latestProgress.current = clampProgress(value);
            elementRef.current?.paperShaderMount?.setUniforms({ u_progress: latestProgress.current });
        };
        apply(progress.get());
        return progress.on('change', apply);
    }, [progress]);

    // 描边半宽 = min(halfSize) - pad，圆角按它归一化成着色器要的 0-1
    const strokeHalfSpan = Math.max(1, Math.min(width, height) / 2 - pad);
    const radiusPx = cornerRadius ?? strokeHalfSpan;
    const uniforms = buildProgressBorderUniforms({
        colors,
        colorBack: '#00000000',
        colorTrack: trackColor,
        trackOpacity: merged.track,
        colorBase: baseColor ?? colors[0],
        baseOpacity: merged.base,
        roundness: Math.min(1, Math.max(0, radiusPx / strokeHalfSpan)),
        thickness: merged.thickness,
        marginX: pad / width,
        marginY: pad / height,
        softness: merged.softness,
        intensity: merged.intensity,
        bloom: merged.bloom,
        spots: merged.spots,
        spotSize: merged.spotSize,
        pulse: merged.pulse,
        smoke: merged.smoke,
        smokeSize: 0,
        progress: latestProgress.current,
        progressFade: merged.fade,
        progressHead: merged.head,
    });

    return (
        <ShaderMount
            ref={elementRef}
            className={className}
            fragmentShader={pulsingBorderProgressFragmentShader}
            uniforms={uniforms}
            speed={merged.speed}
            width={width}
            height={height}
            style={{ width, height, ...style }}
        />
    );
};

export default PulsingBorderProgress;
