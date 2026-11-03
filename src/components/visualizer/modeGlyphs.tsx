import React from 'react';
import type { VisualizerBackgroundMode, VisualizerMode } from '../../types';
import { getVisualizerRegistryEntry, hasVisualizerMode } from './registry';
import { getVisualizerBackgroundRegistryEntry, hasVisualizerBackgroundMode } from './backgrounds/registry';

// src/components/visualizer/modeGlyphs.tsx
// 面板内的 14px 极简线性字形，只示意每种模式的版式骨架，不追求预览精度。
// 字形写在各模式自己的 entry.tsx 里（glyph），这里只有画框和通用字形。
// 注册表是开放的字符串枚举，未登记的模式回落到通用字形，不会因为新增模式而崩。

const GLYPH_FRAME = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
};

const FALLBACK_GLYPH = (
    <>
        <path d="M5 8h14" />
        <path d="M5 12h9" opacity="0.5" />
        <path d="M5 16h12" opacity="0.5" />
    </>
);

type ModeGlyphProps = {
    mode: string;
    size?: number;
};

// The registry lookups fall back to the default mode for an id they do not know, so ask first:
// an unknown mode must get the generic glyph, not the default mode's.
export const VisualizerModeGlyph: React.FC<ModeGlyphProps & { mode: VisualizerMode; }> = ({ mode, size = 14 }) => (
    <svg width={size} height={size} {...GLYPH_FRAME} aria-hidden="true" focusable="false">
        {(hasVisualizerMode(mode) ? getVisualizerRegistryEntry(mode).glyph : null) ?? FALLBACK_GLYPH}
    </svg>
);

export const BackgroundModeGlyph: React.FC<ModeGlyphProps & { mode: VisualizerBackgroundMode; }> = ({ mode, size = 14 }) => (
    <svg width={size} height={size} {...GLYPH_FRAME} aria-hidden="true" focusable="false">
        {(hasVisualizerBackgroundMode(mode) ? getVisualizerBackgroundRegistryEntry(mode).glyph : null) ?? FALLBACK_GLYPH}
    </svg>
);
