import React from 'react';
import { defineVisualizerBackground } from '../definition';
import TransparentBackgroundSettingsCard from './TransparentBackgroundSettingsCard';
import TransparentCoverBackground from './TransparentCoverBackground';

// src/components/visualizer/backgrounds/transparent/entry.tsx
// Registers the cover-only shell background: the song artwork fills the layer like Monet's
// full-overlay layout, but with the color wash and blur removed.

export default defineVisualizerBackground({
    mode: 'transparent',
    order: 60,
    labelKey: 'options.visualizerBackgroundModeTransparent',
    labelFallback: 'Transparent',
    // 透明：整幅封面铺满画面，无叠色无模糊
    glyph: (
        <>
            <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
            <path d="M5.5 16l4-4.5 3 3 3.5-4 3.5 4.2" opacity="0.7" />
            <circle cx="9" cy="8.5" r="1.3" opacity="0.7" />
        </>
    ),
    command: {
        title: 'Background: Transparent',
        description: 'Switch background to a fully transparent layout',
        keywords: ['transparent background', 'no background', 'clear background', '透明背景', '无背景', '空背景', '背景切换到 透明', '背景切换到透明'],
    },
    render: ({ coverUrl, theme }) => (
        <TransparentCoverBackground coverUrl={coverUrl} theme={theme} />
    ),
    renderSettingsPanel: ({ t, isDaylight, theme, controlCardBg }) => (
        <TransparentBackgroundSettingsCard
            t={t}
            isDaylight={isDaylight}
            theme={theme}
            controlCardBg={controlCardBg}
        />
    ),
});
