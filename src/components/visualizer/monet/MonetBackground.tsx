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
    const sourceUrl = tuning.backgroundSource === 'uploaded-global'
        ? monetBackgroundImage?.url ?? coverUrl ?? null
        : coverUrl ?? monetBackgroundImage?.url ?? null;

    const fallbackGradient = useMemo(
        () => `linear-gradient(135deg, ${colorWithAlpha(theme.accentColor, 0.18)}, ${colorWithAlpha(theme.backgroundColor, 0.96)} 48%, ${colorWithAlpha(theme.primaryColor, 0.14)})`,
        [theme],
    );

    if (transparentBackground) {
        return null;
    }

    if (tuning.backgroundLayout === 'full-overlay') {
        return <FullOverlayBackground sourceUrl={sourceUrl} theme={theme} tuning={tuning} fallbackGradient={fallbackGradient} />;
    }

    return <HalfPaneGradientBackground sourceUrl={sourceUrl} theme={theme} tuning={tuning} fallbackGradient={fallbackGradient} />;
};

const FullOverlayBackground: React.FC<{
    sourceUrl: string | null;
    theme: Theme;
    tuning: MonetTuning;
    fallbackGradient: string;
}> = ({ sourceUrl, theme, tuning, fallbackGradient }) => {
    const [pipelineUrl, setPipelineUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        void resolveMonetBackgroundDataUrl({
            coverUrl: sourceUrl,
            monetBackgroundImage: null,
            theme,
            tuning,
        }).then(url => {
            if (!cancelled) {
                setPipelineUrl(url);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [sourceUrl, theme, tuning]);

    const fullOverlayGradient = useMemo(
        () => `linear-gradient(135deg, ${colorWithAlpha(theme.accentColor, 0.34)}, ${colorWithAlpha(theme.backgroundColor, 0.9)} 52%, ${colorWithAlpha(theme.primaryColor, 0.18)})`,
        [theme],
    );

    return (
        <div className="absolute inset-0 overflow-hidden">
            <div
                className="absolute inset-0"
                style={{
                    backgroundColor: theme.backgroundColor,
                    backgroundImage: pipelineUrl
                        ? `url(${pipelineUrl}), ${fullOverlayGradient}`
                        : sourceUrl
                            ? `linear-gradient(135deg, ${colorWithAlpha(theme.accentColor, 0.28)}, ${colorWithAlpha(theme.backgroundColor, 0.92)}), url(${sourceUrl})`
                            : fullOverlayGradient,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    filter: pipelineUrl ? undefined : `blur(${Math.max(0, tuning.backgroundBlurPx * 0.55)}px) saturate(1.06)`,
                    transform: pipelineUrl ? undefined : 'scale(1.08)',
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

const HalfPaneGradientBackground: React.FC<{
    sourceUrl: string | null;
    theme: Theme;
    tuning: MonetTuning;
    fallbackGradient: string;
}> = ({ sourceUrl, theme, tuning, fallbackGradient }) => {
    const imageOpacity = 0.25 + Math.min(Math.max(tuning.backgroundOverlayOpacity, 0), 1) * 0.07;
    const blurPx = Math.min(tuning.backgroundBlurPx * 0.18, 18);

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
