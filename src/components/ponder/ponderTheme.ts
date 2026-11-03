import type { CSSProperties } from 'react';
import { settingsTokens } from '../modal/settings/kit/kitTheme';
import { kitMotionTokens } from '../modal/settings/kit/motion';
import type { Theme } from '../../types';
import { ponderMotionTokens } from './ponderMotion';

// src/components/ponder/ponderTheme.ts
// The colours of Ponder's own interface: the settings kit's variables, and the two surfaces the
// kit does not hold. A Ponder layer sets them on two nested elements, the way Sheet does, because
// a variable cannot be redefined from itself on one element: the outer one keeps the app's text
// colour and holds what is laid over the app (ponderLayerTokens); the inner one, which also carries
// the class st-window, sets the rest (ponderWindowTokens).

/** For the layer's outer element: the text colour to hand down, the stage's veil, the index's scrim. */
export const ponderLayerTokens = (isDaylight: boolean, theme?: Theme): CSSProperties => ({
    // The app's text colour, or the theme's own where the layer is drawn outside the app shell.
    '--pd-ink': `var(--text-primary, ${theme?.primaryColor ?? (isDaylight ? '#18181b' : '#f4f4f5')})`,
    '--pd-veil': isDaylight ? 'rgba(243, 243, 244, 0.94)' : 'rgba(11, 11, 13, 0.94)',
    '--pd-scrim': isDaylight ? 'rgba(24, 18, 12, 0.34)' : 'rgba(0, 0, 0, 0.5)',
} as CSSProperties);

/** For the element inside it: the kit's colours and motion, and Ponder's motion. */
export const ponderWindowTokens = (isDaylight: boolean, theme: Theme | undefined, calm: boolean): CSSProperties => ({
    '--text-primary': 'var(--pd-ink)',
    ...settingsTokens(isDaylight, theme),
    ...kitMotionTokens(calm),
    ...ponderMotionTokens(calm),
} as CSSProperties);

/** A square icon button with no fill until the pointer is on it: step, replay, close. */
export const PONDER_ICON_BUTTON_CLASS = 'pd-t-quick grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[color:var(--st-t2)] transition-colors enabled:hover:bg-[var(--st-fill)] enabled:hover:text-[color:var(--st-t1)] disabled:opacity-30';

/** The same with a text: exit. */
export const PONDER_TEXT_BUTTON_CLASS = 'pd-t-quick inline-flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-[13px] text-[color:var(--st-t2)] transition-colors hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)]';
