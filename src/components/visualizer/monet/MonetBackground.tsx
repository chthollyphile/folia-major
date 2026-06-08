import React, { useEffect, useMemo, useState } from 'react';
import { colorWithAlpha } from '../colorMix';
import type { MonetBackgroundImage, MonetTuning, Theme } from '../../../types';
import { resolveMonetBackgroundDataUrl } from './monetBackgroundPipeline';

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
    const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
    const sourceUrl = tuning.backgroundSource === 'uploaded-global'
        ? monetBackgroundImage?.url ?? coverUrl ?? null
        : coverUrl ?? monetBackgroundImage?.url ?? null;

    useEffect(() => {
        if (transparentBackground) {
            setBackgroundUrl(null);
            return;
        }

        let isCancelled = false;
        void resolveMonetBackgroundDataUrl({
            coverUrl,
            monetBackgroundImage,
            theme,
            tuning,
        }).then(nextUrl => {
            if (!isCancelled) {
                setBackgroundUrl(nextUrl);
            }
        });

        return () => {
            isCancelled = true;
        };
    }, [coverUrl, monetBackgroundImage, theme, transparentBackground, tuning]);

    const fallbackGradient = useMemo(
        () => `linear-gradient(135deg, ${colorWithAlpha(theme.accentColor, 0.34)}, ${colorWithAlpha(theme.backgroundColor, 0.9)} 52%, ${colorWithAlpha(theme.primaryColor, 0.18)})`,
        [theme],
    );

    if (transparentBackground) {
        return null;
    }

    return (
        <div className="absolute inset-0 overflow-hidden">
            <div
                className="absolute inset-0"
                style={{
                    backgroundColor: theme.backgroundColor,
                    backgroundImage: backgroundUrl
                        ? `url(${backgroundUrl}), ${fallbackGradient}`
                        : sourceUrl
                            ? `linear-gradient(135deg, ${colorWithAlpha(theme.accentColor, 0.28)}, ${colorWithAlpha(theme.backgroundColor, 0.92)}), url(${sourceUrl})`
                            : fallbackGradient,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: backgroundUrl ? undefined : `blur(${Math.max(0, tuning.backgroundBlurPx * 0.55)}px) saturate(1.06)`,
                    transform: backgroundUrl ? undefined : 'scale(1.08)',
                }}
            />
            <div
                className="absolute inset-0"
                style={{
                    background: `linear-gradient(90deg, ${colorWithAlpha(theme.backgroundColor, 0.18)}, ${colorWithAlpha(theme.backgroundColor, 0.55)} 56%, ${colorWithAlpha(theme.backgroundColor, 0.3)})`,
                }}
            />
        </div>
    );
};

export default MonetBackground;
