import { createContext, useContext, type CSSProperties } from 'react';
import type { Theme } from '../../../../types';
import { getContrastRatio } from '../../../../utils/themeColorMath';
import './kit.css';

// src/components/modal/settings/kit/kitTheme.ts
// The colours of the settings window. The window sets them once as CSS variables and every kit part
// reads them from there, so no part takes an isDaylight prop. Text and fills follow the app's
// --text-primary, the way the rest of the settings code colours itself; only the surfaces are fixed
// per light and dark.

const ON_ACCENT_DARK = '#17171a';
const ON_ACCENT_LIGHT = '#ffffff';

/** The colour of text and marks drawn on the accent: whichever of dark and white reads better on it. */
export const onAccentColor = (accent: string): string => (
    getContrastRatio(ON_ACCENT_DARK, accent) >= getContrastRatio(ON_ACCENT_LIGHT, accent) ? ON_ACCENT_DARK : ON_ACCENT_LIGHT
);

/** Stand-in album covers, for a picture or a preview a page draws. */
export const SAMPLE_COVERS = ['#6d5a8c', '#3f6f7a', '#a8664b', '#56745a', '#8a4f5d', '#4d5f8f', '#8c7a45', '#5d5d66'] as const;

/** The variables, for the `style` of the settings window. */
export const settingsTokens = (isDaylight: boolean, theme?: Theme): CSSProperties => {
    const accent = theme?.accentColor || (isDaylight ? '#18181b' : '#f4f4f5');
    return {
        '--st-win': isDaylight ? '#f3f3f4' : '#1a1a1d',
        '--st-side': isDaylight ? '#e9e9eb' : '#141416',
        '--st-card': isDaylight ? '#ffffff' : '#232327',
        '--st-menu': isDaylight ? '#ffffff' : '#2b2b30',
        '--st-raise': isDaylight ? '#ffffff' : '#45454c',
        '--st-knob': isDaylight ? '#ffffff' : '#ececee',
        '--st-pv': isDaylight ? '#ececef' : '#151517',
        '--st-ok': isDaylight ? '#1e9a5c' : '#56c98d',
        '--st-warn': isDaylight ? '#b97a10' : '#e3a949',
        '--st-err': isDaylight ? '#d04444' : '#ef6f6f',
        '--st-t1': 'var(--text-primary)',
        '--st-t2': 'color-mix(in srgb, var(--text-primary) 62%, transparent)',
        '--st-t3': 'color-mix(in srgb, var(--text-primary) 42%, transparent)',
        '--st-line': 'color-mix(in srgb, var(--text-primary) 8%, transparent)',
        '--st-line2': 'color-mix(in srgb, var(--text-primary) 16%, transparent)',
        '--st-fill': 'color-mix(in srgb, var(--text-primary) 7%, transparent)',
        '--st-fill2': 'color-mix(in srgb, var(--text-primary) 12%, transparent)',
        '--st-track': 'color-mix(in srgb, var(--text-primary) 17%, transparent)',
        '--st-accent': accent,
        '--st-on-accent': onAccentColor(accent),
    } as CSSProperties;
};

/** What a part needs when it draws outside the window, where the variables do not reach. */
export type SettingsKitTheme = {
    isDaylight: boolean;
    theme?: Theme;
};

export const SettingsKitThemeContext = createContext<SettingsKitTheme>({ isDaylight: false });

export const useSettingsKitTheme = (): SettingsKitTheme => useContext(SettingsKitThemeContext);
