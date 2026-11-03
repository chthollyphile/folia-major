import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DEFAULT_MONET_BACKGROUND_TUNING, type MonetBackgroundImage, type MonetBackgroundTuning, type Theme } from '../../../../types';
import { colorWithAlpha } from '../../colorMix';
import { getMonetBackgroundCacheKey, wantMonetBackgroundUrl, checkCanvasFilterSupport } from '../../monet/monetBackgroundPipeline';
import { buildMonetDriftTrack } from './monetBackgroundDrift';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { ARRIVING_MARK } from '../../preview/frozenPicture';
import { useFirstFrameDrawn } from '../../styleTransition/firstFrame';

// src/components/visualizer/backgrounds/monet/MonetBackgroundLayer.tsx
// Shared shell-level Monet image background. Its picture is made in a worker; a new theme or setting
// for the image on screen waits PIPELINE_DEBOUNCE_MS before its picture is asked for.
interface MonetBackgroundLayerProps {
    coverUrl?: string | null;
    monetBackgroundImage?: MonetBackgroundImage | null;
    theme: Theme;
    isDaylight?: boolean;
    tuning?: MonetBackgroundTuning;
    transparentBackground?: boolean;
    staticMode?: boolean;
}

const PIPELINE_DEBOUNCE_MS = 180;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Plays the noise-driven drift track on `ref` for as long as it stays enabled. The keyframes are
 * handed to the Web Animations API rather than written per frame, so playback stays on the
 * compositor and costs no main-thread work once started.
 */
const useMonetBackgroundDrift = (
    ref: React.RefObject<HTMLDivElement | null>,
    enabled: boolean,
    strength: number,
    reducedMotion: boolean,
) => {
    useEffect(() => {
        const element = ref.current;
        if (!element || !enabled || strength <= 0 || typeof element.animate !== 'function') {
            return;
        }

        if (reducedMotion) return;

        const track = buildMonetDriftTrack(strength);
        const animation = element.animate(track.keyframes, {
            duration: track.durationMs,
            iterations: Infinity,
            easing: 'linear',
        });

        return () => animation.cancel();
    }, [enabled, ref, strength, reducedMotion]);
};

/** The image the picture is made from: the cover, or the uploaded image where that comes first. */
export const resolveMonetSourceUrl = (
    coverUrl: string | null | undefined,
    monetBackgroundImage: MonetBackgroundImage | null | undefined,
    tuning: MonetBackgroundTuning,
) => (
    tuning.backgroundSource === 'uploaded-global'
        ? monetBackgroundImage?.url ?? coverUrl ?? null
        : coverUrl ?? monetBackgroundImage?.url ?? null
);

const MonetBackgroundLayer: React.FC<MonetBackgroundLayerProps> = ({
    coverUrl,
    monetBackgroundImage,
    theme,
    isDaylight = false,
    tuning = DEFAULT_MONET_BACKGROUND_TUNING,
    transparentBackground = false,
    staticMode = false,
}) => {
    const [pipelineUrl, setPipelineUrl] = useState<string | null>(null);
    // The processed picture of what is shown now is still being made: the root says that a part is
    // still to come, so that a small picture of this background is not taken with the raw cover.
    const [isPipelinePending, setIsPipelinePending] = useState(false);
    const sourceUrl = resolveMonetSourceUrl(coverUrl, monetBackgroundImage, tuning);
    // A copy for a new song (or a new type) is ready once its first picture is made, and shows that
    // picture at once rather than crossfading it in from the raw cover: the background layer around
    // it plays the change. Later pictures (another theme, a setting) crossfade in place, as they did.
    const pictureDrawn = useFirstFrameDrawn();
    const [firstPicture, setFirstPicture] = useState<string | null>(null);
    // The image the picture on screen was made from.
    const shownSource = useRef<string | null>(null);

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
        let timeoutId: number | undefined;

        if (!sourceUrl || transparentBackground) {
            setPipelineUrl(null);
            setIsPipelinePending(false);
            pictureDrawn();
            return () => {
                cancelled = true;
            };
        }

        setIsPipelinePending(true);
        const options = { coverUrl, monetBackgroundImage, theme, tuning };
        // A picture of an image not shown yet (a new copy, a new song) is started at once, in a
        // worker. The wait below still decides which picture is shown, so a theme that arrives
        // within it is not missed; the picture is then taken from the cache, made or half made.
        // A new theme or setting for the image on screen waits, so a slider does not start a
        // picture per step. Both are released when the inputs change again: a picture not begun by
        // then is not made.
        const early = sourceUrl !== shownSource.current ? wantMonetBackgroundUrl(options) : null;
        let timed: ReturnType<typeof wantMonetBackgroundUrl> | null = null;
        timeoutId = window.setTimeout(() => {
            timed = wantMonetBackgroundUrl(options);
            void timed.url.then(url => {
                if (!cancelled) {
                    setPipelineUrl(current => (current === url ? current : url));
                    setIsPipelinePending(false);
                    // Where the picture failed too: the raw cover then shown is this image's.
                    shownSource.current = sourceUrl;
                    if (url) {
                        setFirstPicture(current => current ?? url);
                    }
                    pictureDrawn();
                }
            });
        }, PIPELINE_DEBOUNCE_MS);

        return () => {
            cancelled = true;
            if (timeoutId !== undefined) {
                window.clearTimeout(timeoutId);
            }
            early?.release();
            timed?.release();
        };
    }, [backgroundCacheKey, sourceUrl, transparentBackground, pictureDrawn]);

    const driftRef = useRef<HTMLDivElement | null>(null);
    const driftStrength = clamp(tuning.backgroundDriftStrength ?? 0, 0, 1);
    const driftEnabled = Boolean(tuning.backgroundDriftEnabled) && !staticMode && driftStrength > 0;
    const reduceBackgroundMotion = useReducedMotionFor('monetBackground');
    useMonetBackgroundDrift(driftRef, driftEnabled, driftStrength, reduceBackgroundMotion);
    // Only promote the layer while it actually moves; an idle drift wrapper stays a plain div.
    const driftStyle = useMemo<React.CSSProperties | undefined>(
        () => (driftEnabled ? { willChange: 'transform' } : undefined),
        [driftEnabled],
    );

    const isCanvasFilterSupported = useMemo(() => checkCanvasFilterSupport(), []);
    const blurValue = !isCanvasFilterSupported ? tuning.backgroundBlurPx : 0;

    const blurStyle = useMemo<React.CSSProperties>(() => {
        if (blurValue <= 0) return {};
        return {
            filter: `blur(${blurValue}px)`,
            WebkitFilter: `blur(${blurValue}px)`,
            transform: 'scale(1.1) translateZ(0)',
        };
    }, [blurValue]);

    if (transparentBackground) {
        return null;
    }

    const resolvedBackgroundImage = pipelineUrl
        ? `url(${pipelineUrl})`
        : sourceUrl
            ? `linear-gradient(135deg, ${colorWithAlpha(theme.accentColor, 0.2)}, ${colorWithAlpha(theme.backgroundColor, 0.78)}), url(${sourceUrl})`
            : fallbackGradient;

    const arriving = isPipelinePending ? { [ARRIVING_MARK]: '' } : {};
    const pictureKey = pipelineUrl || sourceUrl || 'fallback';
    const comesFrom = pictureKey === firstPicture ? false : { opacity: 0 };

    if (tuning.backgroundLayout === 'full-overlay') {
        return (
            <div className="absolute inset-0 z-0 overflow-hidden" {...arriving}>
                <div ref={driftRef} className="absolute inset-0" style={driftStyle}>
                    <AnimatePresence initial={false}>
                        <motion.div
                            key={pictureKey}
                            initial={comesFrom}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.8, ease: 'easeInOut' }}
                            className="absolute inset-0"
                            style={{
                                backgroundColor: theme.backgroundColor,
                                backgroundImage: resolvedBackgroundImage,
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                                ...blurStyle,
                            }}
                        />
                    </AnimatePresence>
                </div>
                <div
                    className="absolute inset-0"
                    style={{ background: readabilityGradient }}
                />
            </div>
        );
    }

    const baseImageOpacity = isDaylight ? 0.7 : 0.3;
    const imageOpacity = baseImageOpacity + clamp(tuning.backgroundOverlayOpacity, 0, 1) * 0.16;
    const imagePositionX = clamp(50 + tuning.backgroundHalfPaneOffsetX, 10, 90);

    return (
        <div className="absolute inset-0 z-0 overflow-hidden" {...arriving}>
            <div
                className="absolute inset-0"
                style={{
                    backgroundColor: theme.backgroundColor,
                    backgroundImage: fallbackGradient,
                }}
            />
            <AnimatePresence initial={false}>
                {pipelineUrl || sourceUrl ? (
                    <div
                        className="absolute inset-y-0 left-0 w-[72%] sm:w-[68%] lg:w-[60%] overflow-hidden"
                        style={{
                            WebkitMaskImage: 'linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 48%, rgba(0,0,0,0.46) 74%, rgba(0,0,0,0) 100%)',
                            maskImage: 'linear-gradient(90deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.94) 48%, rgba(0,0,0,0.46) 74%, rgba(0,0,0,0) 100%)',
                        }}
                    >
                        <div ref={driftRef} className="absolute inset-0" style={driftStyle}>
                            <motion.div
                                key={pictureKey}
                                initial={comesFrom}
                                animate={{ opacity: imageOpacity }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: 0.8, ease: 'easeInOut' }}
                                className="absolute inset-0"
                                style={{
                                    backgroundImage: resolvedBackgroundImage,
                                    backgroundRepeat: 'no-repeat',
                                    backgroundSize: 'cover',
                                    backgroundPosition: `${imagePositionX}% center`,
                                    ...blurStyle,
                                }}
                            />
                        </div>
                    </div>
                ) : null}
            </AnimatePresence>
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

export default MonetBackgroundLayer;
