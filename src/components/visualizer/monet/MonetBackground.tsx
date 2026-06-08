import React, { useMemo } from 'react';
import { colorWithAlpha } from '../colorMix';
import type { MonetBackgroundImage, MonetTuning, Theme } from '../../../types';

// src/components/visualizer/monet/MonetBackground.tsx
// Resolves the static poster-like background for Monet and keeps all heavy image work off the animation path.
interface MonetBackgroundProps {
    coverUrl?: string | null;
    monetBackgroundImage?: MonetBackgroundImage | null;
    theme: Theme;
    tuning: MonetTuning;
    transparentBackground?: boolean;
}

const MonetBackground: React.FC<MonetBackgroundProps> = ({
    coverUrl,
    monetBackgroundImage,
    theme,
    tuning,
    transparentBackground = false,
}) => {
    const sourceUrl = tuning.backgroundSource === 'uploaded-global'
        ? monetBackgroundImage?.url ?? coverUrl ?? null
        : coverUrl ?? monetBackgroundImage?.url ?? null;

    const fallbackGradient = useMemo(
        () => `linear-gradient(135deg, ${colorWithAlpha(theme.accentColor, 0.18)}, ${colorWithAlpha(theme.backgroundColor, 0.96)} 48%, ${colorWithAlpha(theme.primaryColor, 0.14)})`,
        [theme],
    );
    const imageOpacity = 0.25 + Math.min(Math.max(tuning.backgroundOverlayOpacity, 0), 1) * 0.07;
    const blurPx = tuning.backgroundBlurPx >= 42 ? Math.min(tuning.backgroundBlurPx * 0.18, 18) : 0;

    if (transparentBackground) {
        return null;
    }

    return (
        <div className="absolute inset-0 overflow-hidden">
            <div
                className="absolute inset-0"
                style={{
                    backgroundColor: theme.backgroundColor,
                    backgroundImage: fallbackGradient,
                }}
            />
            {sourceUrl ? (
                <div
                    className="absolute inset-y-0 left-0 w-[72%] sm:w-[68%] lg:w-[60%]"
                    style={{
                        backgroundImage: `url(${sourceUrl})`,
                        backgroundPosition: tuning.backgroundCropMode === 'full-artwork' ? 'left center' : 'center left',
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: tuning.backgroundCropMode === 'full-artwork' ? 'contain' : 'cover',
                        opacity: imageOpacity,
                        filter: `saturate(1.02) ${blurPx > 0 ? `blur(${blurPx}px)` : ''}`.trim(),
                        transform: blurPx > 0 ? 'scale(1.02)' : undefined,
                        WebkitMaskImage: 'linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 48%, rgba(0,0,0,0.46) 74%, rgba(0,0,0,0) 100%)',
                        maskImage: 'linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 48%, rgba(0,0,0,0.46) 74%, rgba(0,0,0,0) 100%)',
                    }}
                />
            ) : null}
            <div
                className="absolute inset-0"
                style={{
                    background: `linear-gradient(90deg, ${colorWithAlpha(theme.backgroundColor, 0.18)} 0%, ${colorWithAlpha(theme.backgroundColor, 0.3)} 24%, ${colorWithAlpha(theme.backgroundColor, 0.62)} 58%, ${colorWithAlpha(theme.backgroundColor, 0.84)} 100%)`,
                }}
            />
        </div>
    );
};

export default MonetBackground;
