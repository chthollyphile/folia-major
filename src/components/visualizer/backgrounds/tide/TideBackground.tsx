import React, { useState } from 'react';
import { type MotionValue } from 'framer-motion';
import type { Line, Theme, TideBackgroundTuning } from '../../../../types';
import { useTideRuntime } from './useTideRuntime';

// src/components/visualizer/backgrounds/tide/TideBackground.tsx
// The tide fluid background: a canvas whose forces come from where the lyric layer currently is.
// It never draws lyrics itself, it only reacts to them.

interface TideBackgroundProps {
    theme: Theme;
    isDaylight: boolean;
    paused?: boolean;
    tuning: TideBackgroundTuning;
    stageRef?: { readonly current: HTMLElement | null };
    lines?: Line[];
    currentLineIndex?: number;
    currentTime?: MotionValue<number>;
}

const TideBackground: React.FC<TideBackgroundProps> = ({
    theme,
    isDaylight,
    paused,
    tuning,
    stageRef,
    lines,
    currentLineIndex,
    currentTime,
}) => {
    // Callback ref keeps the runtime in sync with the real node without an extra effect pass.
    const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
    // An opaque canvas that never draws would cover the stage with black, so a failed fluid unmounts.
    const [unavailable, setUnavailable] = useState(false);

    useTideRuntime({
        canvas,
        theme,
        isDaylight,
        paused: Boolean(paused),
        tuning,
        stageRef,
        lines,
        currentLineIndex,
        currentTime,
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
