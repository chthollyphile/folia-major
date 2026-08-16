import { type Theme } from '../../../types';
import { desaturateColor, mixColors } from '../colorMix';

// src/components/visualizer/brut/brutPalette.ts
// Theme -> the handful of colors the shaft needs.
//
// Concrete is deliberately DESATURATED: AI themes hand us fully saturated palettes, and without
// this the "concrete" reads as coloured plastic. Lights, channels and glyphs keep full saturation,
// so the theme still comes through - as coloured light falling on grey concrete, which is also what
// makes the material read as real.

export interface BrutPalette {
    concrete: string;
    concreteDeep: string;
    steel: string;
    daylight: string;
    channel: string;
    glyphIdle: string;
    glyphActive: string;
    graffiti: string;
    fog: string;
    sky: string;
    dust: string;
}

// Concrete is a material with its own albedo. Deriving it purely from the theme background makes it
// vanish under dark themes and turn into plastic under saturated ones, so the theme TINTS a neutral
// mid grey instead of replacing it - the light and the accents carry the theme, the wall carries the
// material. Both theme polarities still shift it, just within the range concrete can actually be.
const CONCRETE_BASE = '#8f8c85';

export const buildBrutPalette = (theme: Theme): BrutPalette => {
    const tint = mixColors(theme.backgroundColor, theme.secondaryColor, 0.55);
    const concrete = desaturateColor(mixColors(CONCRETE_BASE, tint, 0.38), 0.5);

    return {
        concrete,
        concreteDeep: mixColors(concrete, '#000000', 0.86),
        steel: desaturateColor(mixColors(theme.secondaryColor, '#cfd2d6', 0.62), 0.45),
        daylight: mixColors(mixColors(theme.primaryColor, theme.accentColor, 0.35), '#ffffff', 0.5),
        channel: theme.accentColor,
        glyphIdle: mixColors(mixColors(theme.primaryColor, '#ffffff', 0.35), concrete, 0.2),
        glyphActive: theme.accentColor,
        graffiti: mixColors(theme.accentColor, theme.primaryColor, 0.4),
        fog: mixColors(mixColors(concrete, theme.backgroundColor, 0.72), '#000000', 0.55),
        sky: mixColors(theme.primaryColor, '#ffffff', 0.66),
        dust: mixColors(theme.primaryColor, '#ffffff', 0.5),
    };
};
