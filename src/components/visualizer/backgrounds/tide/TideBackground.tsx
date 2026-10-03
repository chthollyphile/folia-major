import React, { useState } from 'react';
import { type MotionValue } from 'framer-motion';
import type { AudioBands, Line, Theme, TideBackgroundTuning } from '../../../../types';
import { useTideRuntime } from './useTideRuntime';

// src/components/visualizer/backgrounds/tide/TideBackground.tsx
// The tide fluid background: a canvas whose forces come from where the lyric layer currently is,
// and whose shape follows the music. It never draws lyrics itself, it only reacts to them.

interface TideBackgroundProps {
    theme: Theme;
    isDaylight: boolean;
    /** 静态模式（关闭首页动态背景 / 全局静帧）：只画一帧，不进入逐帧循环。 */
    staticMode?: boolean;
    paused?: boolean;
    tuning: TideBackgroundTuning;
    stageRef?: { readonly current: HTMLElement | null };
    lines?: Line[];
    currentLineIndex?: number;
    currentTime?: MotionValue<number>;
    audioPower?: MotionValue<number>;
    audioBands?: AudioBands;
}

const TideBackground: React.FC<TideBackgroundProps> = ({
    theme,
    isDaylight,
    staticMode,
    paused,
    tuning,
    stageRef,
    lines,
    currentLineIndex,
    currentTime,
    audioPower,
    audioBands,
}) => {
    // Callback ref keeps the runtime in sync with the real node without an extra effect pass.
    const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
    // An opaque canvas that never draws would cover the stage with black, so a failed fluid unmounts.
    const [unavailable, setUnavailable] = useState(false);

    useTideRuntime({
        canvas,
        theme,
        isDaylight,
        staticMode: Boolean(staticMode),
        paused: Boolean(paused),
        tuning,
        stageRef,
        lines,
        currentLineIndex,
        currentTime,
        audioPower,
        audioBands,
        onUnavailable: () => setUnavailable(true),
    });

    if (unavailable) {
        return null;
    }

    return (
        <canvas
            ref={setCanvas}
            className="absolute inset-0 w-full h-full block pointer-events-none"
            style={{
                width: '100%',
                height: '100%',
                willChange: 'transform',
                transform: 'translateZ(0)',
            }}
        />
    );
};

export default TideBackground;
