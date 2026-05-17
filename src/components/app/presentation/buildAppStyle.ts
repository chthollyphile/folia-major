import type { CSSProperties } from 'react';
import type { Theme } from '../../../types';

// src/components/app/presentation/buildAppStyle.ts

// Builds CSS custom properties for the top-level app shell theme surface.
export const buildAppStyle = ({
    bgMode,
    isDaylight,
    theme,
    daylightTheme,
    defaultTheme,
}: {
    bgMode: string;
    isDaylight: boolean;
    theme: Theme;
    daylightTheme: Theme;
    defaultTheme: Theme;
}) => {
    return {
        '--bg-color': bgMode === 'default' ? (isDaylight ? daylightTheme.backgroundColor : defaultTheme.backgroundColor) : theme.backgroundColor,
        '--text-primary': theme.primaryColor,
        '--text-secondary': theme.secondaryColor,
        '--text-accent': theme.accentColor,
        backgroundColor: 'var(--bg-color)',
        color: 'var(--text-primary)',
    } as CSSProperties;
};
