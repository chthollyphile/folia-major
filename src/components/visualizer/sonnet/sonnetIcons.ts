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

export const resolveSonnetIconNames = (names: string[] | undefined): string[] => {
    const resolved = [
        ...new Set((names ?? [])
            .map(name => LUCIDE_ICON_NAMES_BY_LOWERCASE.get(name.toLowerCase()))
            .filter(Boolean)),
    ] as string[];
    return resolved.length > 0 ? resolved : ['Flower'];
};

// Spreads icon particles through the scene while guaranteeing every available theme icon is used.
export const buildSonnetIconParticleIndices = (
    iconCount: number,
    particleCount: number,
    seed: number,
): Array<number | null> => {
    const safeIconCount = Math.max(0, Math.floor(iconCount));
    const safeParticleCount = Math.max(0, Math.floor(particleCount));
    if (safeIconCount === 0) {
        return Array.from({ length: safeParticleCount }, () => null);
    }

    const iconParticleCount = Math.min(
        safeParticleCount,
        Math.max(Math.ceil(safeParticleCount / 4), safeIconCount),
    );
    let emittedIconCount = 0;
    return Array.from({ length: safeParticleCount }, (_, index) => {
        const previousBand = Math.floor(index * iconParticleCount / safeParticleCount);
        const currentBand = Math.floor((index + 1) * iconParticleCount / safeParticleCount);
        if (currentBand === previousBand) {
            return null;
        }

        const iconIndex = ((seed + emittedIconCount) % safeIconCount + safeIconCount) % safeIconCount;
        emittedIconCount += 1;
        return iconIndex;
    });
};

// Distributes icon starts across most of a shot while reserving time for the final reveal.
export const resolveSonnetIconEntryPhase = (index: number, iconCount: number) => {
    const safeCount = Math.max(0, Math.floor(iconCount));
    if (safeCount <= 1) return 0.12;
    const safeIndex = Math.min(safeCount - 1, Math.max(0, Math.floor(index)));
    return 0.04 + (safeIndex / (safeCount - 1)) * 0.82;
};

export const resolveSonnetIconEntryDuration = (sceneDuration: number, preferredDuration: number) => {
    const safeSceneDuration = Math.max(0.01, sceneDuration);
    return Math.min(
        Math.max(0.01, preferredDuration),
        Math.max(0.08, safeSceneDuration * 0.18),
        safeSceneDuration,
    );
};

export const resolveSonnetIconEntryDelay = (
    entryPhase: number,
    sceneDuration: number,
    entryDuration: number,
) => Math.min(1, Math.max(0, entryPhase)) * Math.max(0, sceneDuration - entryDuration);

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
