import React, { useEffect, useMemo, useState } from 'react';
import { colorWithAlpha } from '../colorMix';
import type { MonetBackgroundImage, MonetTuning, Theme } from '../../../types';
import { getMonetBackgroundCacheKey, resolveMonetBackgroundDataUrl } from './monetBackgroundPipeline';

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
    const [pipelineUrl, setPipelineUrl] = useState<string | null>(null);
    const sourceUrl = tuning.backgroundSource === 'uploaded-global'
        ? monetBackgroundImage?.url ?? coverUrl ?? null
        : coverUrl ?? monetBackgroundImage?.url ?? null;

    const fallbackGradient = useMemo(
        () => `linear-gradient(135deg, ${colorWithAlpha(theme.accentColor, 0.22)}, ${colorWithAlpha(theme.backgroundColor, 0.96)} 50%, ${colorWithAlpha(theme.primaryColor, 0.18)})`,
        [theme],
    );
    const readabilityGradient = useMemo(
        () => `linear-gradient(90deg, ${colorWithAlpha(theme.backgroundColor, 0.18)} 0%, ${colorWithAlpha(theme.backgroundColor, 0.32)} 34%, ${colorWithAlpha(theme.backgroundColor, 0.66)} 70%, ${colorWithAlpha(theme.backgroundColor, 0.82)} 100%)`,
        [theme],
    );
    const backgroundCacheKey = useMemo(
        () => getMonetBackgroundCacheKey({
            coverUrl,
            monetBackgroundImage,
            theme,
            tuning,
        }),
        [coverUrl, monetBackgroundImage, theme, tuning],
    );

    useEffect(() => {
        let cancelled = false;
        if (!sourceUrl || transparentBackground) {
            setPipelineUrl(null);
            return () => {
                cancelled = true;
            };
        }

        void resolveMonetBackgroundDataUrl({
            coverUrl,
            monetBackgroundImage,
            theme,
            tuning,
        }).then(url => {
            if (!cancelled) {
                setPipelineUrl(current => (current === url ? current : url));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [backgroundCacheKey, sourceUrl, transparentBackground]);

    if (transparentBackground) {
        return null;
    }

    const resolvedBackgroundImage = pipelineUrl
        ? `url(${pipelineUrl})`
        : sourceUrl
            ? `linear-gradient(135deg, ${colorWithAlpha(theme.accentColor, 0.2)}, ${colorWithAlpha(theme.backgroundColor, 0.78)}), url(${sourceUrl})`
            : fallbackGradient;

    if (tuning.backgroundLayout === 'full-overlay') {
        return (
            <div className="absolute inset-0 overflow-hidden">
                <div
                    className="absolute inset-0"
                    style={{
                        backgroundColor: theme.backgroundColor,
                        backgroundImage: resolvedBackgroundImage,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                    }}
                />
                <div
                    className="absolute inset-0"
                    style={{ background: readabilityGradient }}
                />
            </div>
        );
    }

    const imageOpacity = 0.3 + Math.min(Math.max(tuning.backgroundOverlayOpacity, 0), 1) * 0.16;

    return (
        <div className="absolute inset-0 overflow-hidden">
            <div
                className="absolute inset-0"
                style={{
                    backgroundColor: theme.backgroundColor,
                    backgroundImage: fallbackGradient,
                }}
            />
            {pipelineUrl || sourceUrl ? (
                <div
                    className="absolute inset-y-0 left-0 w-[72%] sm:w-[68%] lg:w-[60%]"
                    style={{
                        backgroundImage: resolvedBackgroundImage,
                        backgroundRepeat: 'no-repeat',
                        backgroundSize: 'cover',
                        backgroundPosition: 'center left',
                        opacity: imageOpacity,
                        WebkitMaskImage: 'linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 48%, rgba(0,0,0,0.46) 74%, rgba(0,0,0,0) 100%)',
                        maskImage: 'linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 48%, rgba(0,0,0,0.46) 74%, rgba(0,0,0,0) 100%)',
                    }}
                />
            ) : null}
            <div
                className="absolute inset-0"
                style={{
                    background: `linear-gradient(90deg, ${colorWithAlpha(theme.backgroundColor, 0.14)} 0%, ${colorWithAlpha(theme.backgroundColor, 0.28)} 28%, ${colorWithAlpha(theme.backgroundColor, 0.62)} 64%, ${colorWithAlpha(theme.backgroundColor, 0.86)} 100%)`,
                }}
            />
            <div
                className="absolute inset-0"
                style={{
                    backgroundImage: `radial-gradient(circle at 18% 34%, ${colorWithAlpha(theme.accentColor, 0.18)}, transparent 36%)`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                }}
            />
            <div
                className="absolute inset-0"
                style={{ background: readabilityGradient }}
            />
        </div>
    );
};

export default MonetBackground;
