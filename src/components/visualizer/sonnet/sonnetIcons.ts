import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as LucideIcons from 'lucide-react';

// src/components/visualizer/sonnet/sonnetIcons.ts
// Validates theme icon names and produces cacheable SVG data URLs for Pixi.
const LUCIDE_ICON_NAMES = Object.keys(LucideIcons).filter(name => {
    const candidate = LucideIcons[name as keyof typeof LucideIcons];
    return /^[A-Z]/.test(name) && (typeof candidate === 'object' || typeof candidate === 'function');
});
const LUCIDE_ICON_NAMES_BY_LOWERCASE = new Map(LUCIDE_ICON_NAMES.map(name => [name.toLowerCase(), name]));

export const resolveSonnetIconNames = (names: string[] | undefined): string[] => (
    [...new Set((names ?? []).map(name => LUCIDE_ICON_NAMES_BY_LOWERCASE.get(name.toLowerCase())).filter(Boolean))]
) as string[];

export const buildSonnetIconTextureKey = (
    name: string,
    color: string,
    strokeWidth: number,
    size: number,
    resolution: number,
) => `${name}|${color}|${strokeWidth}|${size}|${resolution}`;

export const buildSonnetIconDataUrl = (
    name: string,
    color: string,
    strokeWidth: number,
    size: number,
) => {
    const Icon = LucideIcons[name as keyof typeof LucideIcons] as React.ElementType | undefined;
    if (!Icon) return null;
    const markup = renderToStaticMarkup(React.createElement(Icon, {
        size,
        color,
        strokeWidth,
        absoluteStrokeWidth: true,
        fill: 'none',
        xmlns: 'http://www.w3.org/2000/svg',
    }));
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
};
