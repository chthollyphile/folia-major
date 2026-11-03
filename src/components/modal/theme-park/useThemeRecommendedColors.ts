import { useEffect, useMemo, useState } from 'react';
import type { DualTheme } from '../../../types';
import { extractColors } from '../../../utils/colorExtractor';
import { buildRecommendedColors } from '../../../utils/themeEditorPalette';

// src/components/modal/theme-park/useThemeRecommendedColors.ts
// The colours a theme editor offers under its picker: the cover's own palette first, then the
// eight colours of the theme the editing started from. Theme Park and the quick editor both read
// them here. Twelve are offered in all: with eight from the cover the theme's dark side does not
// fit, so an editor that wants all eight theme colours (a press on one puts a colour back to where
// it started) asks for four from the cover.

const COVER_COLOR_COUNT = 8;

export const useThemeRecommendedColors = (theme: DualTheme, coverUrl: string | null, coverCount = COVER_COLOR_COUNT): string[] => {
    const [coverColors, setCoverColors] = useState<string[]>([]);

    useEffect(() => {
        let cancelled = false;
        if (!coverUrl) {
            setCoverColors([]);
            return undefined;
        }

        extractColors(coverUrl, coverCount)
            .then(colors => {
                if (!cancelled) {
                    setCoverColors(colors);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setCoverColors([]);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [coverUrl, coverCount]);

    return useMemo(() => buildRecommendedColors(theme, coverColors), [theme, coverColors]);
};
