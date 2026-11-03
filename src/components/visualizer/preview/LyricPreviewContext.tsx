import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Theme } from '../../../types';
import type { VisualizerBackgroundConfig } from '../backgrounds/definition';
import type { VisualizerSharedProps } from '../definition';
import { themeForPictures } from './pictureImages';
import type { Size } from './previewScale';
import type { PreviewClock } from './usePreviewClock';

// src/components/visualizer/preview/LyricPreviewContext.tsx
// What every small picture in a picker shares: the one clock, the theme being previewed, and the
// settings a style or a background draws with. A picker sets it once around its pictures; the pictures are
// drawn by a grid that knows nothing of lyric styles, so they cannot take it as props.

/**
 * The settings a style draws with, as the renderer takes them. Not the app's static mode: a
 * picture is the style in motion, and a WebGL style that draws one frame and stops cannot be copied.
 */
export type LyricPreviewLook = Pick<
    VisualizerSharedProps,
    'visualizerTunings' | 'lyricsFontScale' | 'cappellaCustomEmojiImages' | 'cappellaCustomAvatarImages' | 'monetPortraitImage'
>;

export type LyricPreview = {
    clock: PreviewClock;
    /** The theme being previewed, as a picture draws it (themeForPictures): its background colour is the pictures' surface. */
    theme: Theme;
    isDaylight: boolean;
    look: LyricPreviewLook;
    /** The settings the pictures of the backgrounds draw with; each picture sets its own kind. */
    background?: VisualizerBackgroundConfig;
    /** The stage a style is drawn on before it is scaled down: as large as the app's window. */
    stage: Size;
    /**
     * Whether images may be made now. Making one draws a second copy of a style as large as the
     * window: a picker over a playing page says no while that would stall the lyrics. A picture
     * then keeps the image it has, or shows its glyph.
     */
    making: boolean;
};

const LyricPreviewContext = createContext<LyricPreview | null>(null);

/** The size of the app's window, followed as it changes. */
export const useWindowSize = (): Size => {
    const [size, setSize] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
    useEffect(() => {
        const update = () => setSize(before => (
            before.width === window.innerWidth && before.height === window.innerHeight
                ? before
                : { width: window.innerWidth, height: window.innerHeight }
        ));
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);
    return size;
};

type LyricPreviewProviderProps = Omit<LyricPreview, 'stage' | 'making'> & { making?: boolean; children: React.ReactNode };

export const LyricPreviewProvider: React.FC<LyricPreviewProviderProps> = ({ clock, theme, isDaylight, look, background, making = true, children }) => {
    const stage = useWindowSize();
    const value = useMemo(
        () => ({ clock, theme: themeForPictures(theme), isDaylight, look, background, stage, making }),
        [clock, theme, isDaylight, look, background, stage, making],
    );
    return <LyricPreviewContext.Provider value={value}>{children}</LyricPreviewContext.Provider>;
};

export const useLyricPreview = (): LyricPreview => {
    const preview = useContext(LyricPreviewContext);
    if (!preview) {
        throw new Error('[LyricPreview] A picture was drawn outside a LyricPreviewProvider');
    }
    return preview;
};
