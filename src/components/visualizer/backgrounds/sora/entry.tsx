import React from 'react';
import SoraBackground from './SoraBackground';
import { defineVisualizerBackground } from '../definition';

// src/components/visualizer/backgrounds/sora/entry.tsx
// Registers the shader-based Sora starfield shell background.

export default defineVisualizerBackground({
    mode: 'sora',
    order: 50,
    labelKey: 'options.visualizerBackgroundModeSora',
    labelFallback: 'Sora',
    render: ({ theme, isDaylight, paused }) => (
        <div className="absolute inset-0 z-0">
            <SoraBackground theme={theme} isDaylight={isDaylight} paused={paused} />
        </div>
    ),
});
