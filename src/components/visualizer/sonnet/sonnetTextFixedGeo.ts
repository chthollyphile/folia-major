import type { Theme } from '../../../types';

// src/components/visualizer/sonnet/sonnetTextFixedGeo.ts
// Plans and draws deterministic fixed geometry that sits behind ordinary Sonnet text.
type PixiModule = typeof import('pixi.js');

export type SonnetTextFixedGeoPlan =
    | { category: 'hollow'; variant: 'straight-frame' | 'rotated-frame' }
    | { category: 'solid'; variant: 'orb-hatch' | 'music-steps' | 'bent-lines' };

export const resolveSonnetTextFixedGeoPlan = (
    seed: number,
    isChorusEffect: boolean,
): SonnetTextFixedGeoPlan => {
    if (isChorusEffect) {
        const chorusSeed = seed % 10;
        if (chorusSeed < 5) return { category: 'hollow', variant: 'straight-frame' };
        if (chorusSeed < 9) return { category: 'hollow', variant: 'rotated-frame' };
        const solidVariants = ['orb-hatch', 'music-steps', 'bent-lines'] as const;
        return { category: 'solid', variant: solidVariants[Math.floor(seed / 10) % solidVariants.length] };
    }

    const legacyType = seed % 4;
    if (legacyType === 1) return { category: 'hollow', variant: 'straight-frame' };
    if (legacyType === 2) return { category: 'hollow', variant: 'rotated-frame' };
    const solidVariants = ['orb-hatch', 'music-steps', 'bent-lines'] as const;
    return { category: 'solid', variant: solidVariants[Math.floor(seed / 4) % solidVariants.length] };
};

export interface SonnetTextFixedGeoOptions {
    seed: number;
    isChorusEffect: boolean;
    fontSize: number;
    layoutWidth: number;
    theme: Theme;
}

const drawMusicSteps = (
    graphic: import('pixi.js').Graphics,
    width: number,
    height: number,
    alpha: number,
    theme: Theme,
) => {
    const heights = [0.24, 0.35, 0.2, 0.82, 0.3, 0.1, 0.23, 0.16];
    const spacing = width / (heights.length + 1);
    heights.forEach((heightRatio, index) => {
        const x = -width / 2 + spacing * (index + 1);
        const baseline = height * (0.12 - index * 0.035);
        const color = index % 2 === 0 ? theme.accentColor : theme.secondaryColor;
        graphic
            .moveTo(x - spacing * 0.12, baseline - height * heightRatio * 0.5)
            .lineTo(x + spacing * 0.12, baseline + height * heightRatio * 0.5)
            .stroke({ color, width: Math.max(2, height * 0.025), alpha });
    });
};

const drawBentLines = (
    graphic: import('pixi.js').Graphics,
    width: number,
    height: number,
    alpha: number,
    theme: Theme,
) => {
    const lineCount = 5;
    for (let index = 0; index < lineCount; index += 1) {
        const x = -width * 0.34 + index * width * 0.17;
        const topY = -height * (0.42 - index * 0.035);
        const elbowY = -height * (0.08 - index * 0.025);
        const bottomY = height * (0.35 + index * 0.035);
        const color = index % 2 === 0 ? theme.accentColor : theme.secondaryColor;
        graphic
            .moveTo(x - width * 0.16, topY)
            .lineTo(x, elbowY)
            .lineTo(x - width * 0.015, bottomY)
            .stroke({ color, width: Math.max(2, height * 0.022), alpha });
    }
};

// Keeps the legacy hollow/solid class probabilities while expanding only the solid-class artwork.
export const buildSonnetTextFixedGeo = (
    pixi: PixiModule,
    options: SonnetTextFixedGeoOptions,
) => {
    const { seed, isChorusEffect, fontSize, layoutWidth, theme } = options;
    const plan = resolveSonnetTextFixedGeoPlan(seed, isChorusEffect);
    const graphic = new pixi.Graphics();
    const color = seed % 2 === 0 ? theme.primaryColor : theme.secondaryColor;
    const alpha = (isChorusEffect ? 0.4 : 0.25) + (seed % 10) * 0.03;
    const scaleMultiplier = isChorusEffect ? 1.5 + (seed % 5) * 0.3 : 1;
    const width = Math.max(fontSize * 2.5 * scaleMultiplier, layoutWidth * 0.12 * scaleMultiplier);
    const height = Math.max(fontSize * 1.8 * scaleMultiplier, layoutWidth * 0.08 * scaleMultiplier);

    if (plan.category === 'hollow') {
        const frameWidth = plan.variant === 'rotated-frame' ? width * 0.8 : width;
        const frameHeight = plan.variant === 'rotated-frame' ? height * 0.8 : height;
        graphic
            .rect(-frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight)
            .stroke({ color, width: Math.max(1.5, fontSize * 0.02), alpha });
        if (isChorusEffect && seed % 2 === 0) {
            graphic
                .rect(-frameWidth * 0.6, -frameHeight * 0.6, frameWidth * 1.2, frameHeight * 1.2)
                .stroke({ color, width: 1, alpha: alpha * 0.5 });
        }
        if (plan.variant === 'rotated-frame') graphic.rotation = Math.PI / 4;
        return graphic;
    }

    if (plan.variant === 'music-steps') {
        drawMusicSteps(graphic, width, height, alpha, theme);
        return graphic;
    }
    if (plan.variant === 'bent-lines') {
        drawBentLines(graphic, width, height, alpha, theme);
        return graphic;
    }

    const radius = width * 0.5;
    graphic.circle(0, 0, radius).fill({ color, alpha: alpha * 0.15 });
    const hatch = new pixi.Graphics();
    const hatchSpacing = Math.max(4, width * 0.05);
    for (let offset = -radius; offset < radius; offset += hatchSpacing) {
        const lineHeight = Math.sqrt(Math.max(0, radius * radius - offset * offset));
        hatch.moveTo(offset + radius * 0.4, -lineHeight + radius * 0.4);
        hatch.lineTo(offset + radius * 0.4, lineHeight + radius * 0.4);
    }
    hatch.stroke({ color, width: 1.5, alpha: alpha * 0.6 });
    graphic.addChild(hatch);
    return graphic;
};
