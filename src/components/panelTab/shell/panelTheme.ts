import type { CSSProperties } from 'react';
import type { Theme } from '../../../types';
import { settingsTokens } from '../../modal/settings/kit/kitTheme';
import { kitMotionTokens } from '../../modal/settings/kit/motion';

// src/components/panelTab/shell/panelTheme.ts
// The colours of the playing page's panel. It is a glass surface over the playing page, drawn with
// the settings kit's parts, so it sets the kit's colour and motion variables on itself and adds the
// three the kit does not hold: the glass, its shadow and the colour of a liked heart. The text is
// the song theme's, as it was before the panel used the kit.

/**
 * The 1px edge the glass carries inside its shadow. Exported so the player bar's small popovers
 * draw the same line as the panel they sit next to.
 */
export const panelEdgeColor = (isDaylight: boolean) => (
    isDaylight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.09)'
);

/** The variables, for the `style` of the panel's surface. */
export const panelTokens = (isDaylight: boolean, theme: Theme, reduced: boolean): CSSProperties => ({
    '--text-primary': theme.primaryColor,
    ...settingsTokens(isDaylight, theme),
    ...kitMotionTokens(reduced),
    // The kit's raised colour in the dark is a fixed grey for its own dark window. Here the page
    // shows through the glass, and under a bright page that grey is no lighter than what it lies
    // on. A white veil is that same grey on dark glass and stays lighter on any page.
    ...(isDaylight ? null : { '--st-raise': 'rgba(255, 255, 255, 0.18)' }),
    '--pn-glass': isDaylight ? 'rgba(244, 244, 245, 0.8)' : 'rgba(28, 28, 31, 0.8)',
    '--pn-shadow': isDaylight
        ? `0 30px 80px rgba(0, 0, 0, 0.24), 0 0 0 1px ${panelEdgeColor(true)}`
        : `0 30px 80px rgba(0, 0, 0, 0.55), 0 0 0 1px ${panelEdgeColor(false)}`,
    '--pn-like': isDaylight ? '#e0354f' : '#f2607a',
} as CSSProperties);
