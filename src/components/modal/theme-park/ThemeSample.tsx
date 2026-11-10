import React, { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../../types';
import { onAccentColor } from '../settings/kit/kitTheme';
import { VIS_PLAYGROUND_PREVIEW_PLACEHOLDERS } from '../../visualizer/PreviewPlaceholder';

// src/components/modal/theme-park/ThemeSample.tsx
// What a theme's colours do outside the lyrics, drawn small for the theme editors' samples: a
// now-playing card (the card surface, the primary and the secondary text) and a button (the accent
// and the text on it). The parts read the theme from the variables themeSampleVars sets on the
// sample they sit in, so they show the theme being edited whatever the window around them looks like.

const SAMPLE_SONG = VIS_PLAYGROUND_PREVIEW_PLACEHOLDERS.default;

/** The theme as the variables of a sample, for its `style`. */
export const themeSampleVars = (theme: Theme): CSSProperties => ({
    '--ts-bg': theme.backgroundColor,
    '--ts-fg': theme.primaryColor,
    '--ts-accent': theme.accentColor,
    '--ts-muted': theme.secondaryColor,
    '--ts-on-accent': onAccentColor(theme.accentColor),
} as CSSProperties);

/** Colours of a sample change with the kit's travel time, as its other parts do. */
export const SAMPLE_COLOR_MOTION_CLASS = 'st-t-move transition-colors';

/** The song of the lyric sample as a now-playing card. */
export const ThemeSampleCard: React.FC = () => (
    <div className={`${SAMPLE_COLOR_MOTION_CLASS} flex min-w-0 shrink-0 items-center gap-2.5 rounded-xl bg-[color-mix(in_srgb,var(--ts-fg)_9%,var(--ts-bg))] py-2 pl-2 pr-4`}>
        <img src={SAMPLE_SONG.coverUrl} alt="" draggable={false} className="h-9 w-9 shrink-0 rounded-lg object-cover" />
        <span className="min-w-0">
            <span className={`${SAMPLE_COLOR_MOTION_CLASS} block truncate text-[13px] font-semibold leading-[18px] text-[color:var(--ts-fg)]`}>{SAMPLE_SONG.title}</span>
            <span className={`${SAMPLE_COLOR_MOTION_CLASS} block truncate text-xs leading-4 text-[color:var(--ts-muted)]`}>Folia</span>
        </span>
    </div>
);

/** A button in the accent colour. It is a picture of one: it takes no press. */
export const ThemeSampleButton: React.FC = () => {
    const { t } = useTranslation();

    return (
        <span className={`${SAMPLE_COLOR_MOTION_CLASS} inline-flex h-8 shrink-0 items-center rounded-full bg-[var(--ts-accent)] px-4 text-[13px] font-semibold text-[color:var(--ts-on-accent)]`}>
            {t('ui.play')}
        </span>
    );
};
