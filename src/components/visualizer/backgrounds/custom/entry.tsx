import React from 'react';
import { defineVisualizerBackground } from '../definition';
import { CustomBackground, CustomBackgroundSettings } from './CustomBackground';

// src/components/visualizer/backgrounds/custom/entry.tsx
// Registers an imported image or video as a visualizer background.
export default defineVisualizerBackground({
    mode: 'custom',
    order: 50,
    labelKey: 'options.visualizerBackgroundModeCustom',
    labelFallback: 'Custom',
    glyph: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" opacity=".55" /></>,
    command: { title: 'Background: Custom', description: 'Use an imported image or video as background', keywords: ['custom background', 'image background', 'video background', '自定义背景', '图片背景', '视频背景'] },
    render: () => <CustomBackground />,
    renderSettingsPanel: ({ t }) => <CustomBackgroundSettings t={t} />,
});
