import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Theme } from '../../../../types';

// src/components/visualizer/backgrounds/common/FluidBackground.tsx

interface FluidBackgroundProps {
    coverUrl?: string | null;
    theme: Theme;
}

const IOS_SOFT_FOCUS_SAMPLE_SIZE = 24;
const IOS_SOFT_FOCUS_OUTPUT_SIZE = 96;

const detectIOSSafari = () => {
    if (typeof navigator === 'undefined') return false;

    const ua = navigator.userAgent;
    const isAppleMobile = /iPad|iPhone|iPod/i.test(ua)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isWebKit = /WebKit/i.test(ua);
    const isAltIOSBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|YaBrowser|GSA/i.test(ua);

    return isAppleMobile && isWebKit && !isAltIOSBrowser;
};

const buildSoftFocusCover = (coverUrl: string): Promise<string | null> => new Promise((resolve) => {
    if (typeof document === 'undefined') {
        resolve(null);
        return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
        try {
            const sourceCanvas = document.createElement('canvas');
            const outputCanvas = document.createElement('canvas');
            sourceCanvas.width = IOS_SOFT_FOCUS_SAMPLE_SIZE;
            sourceCanvas.height = IOS_SOFT_FOCUS_SAMPLE_SIZE;
            outputCanvas.width = IOS_SOFT_FOCUS_OUTPUT_SIZE;
            outputCanvas.height = IOS_SOFT_FOCUS_OUTPUT_SIZE;

            const sourceCtx = sourceCanvas.getContext('2d');
            const outputCtx = outputCanvas.getContext('2d');
            if (!sourceCtx || !outputCtx) {
                resolve(null);
                return;
            }

            const naturalWidth = img.naturalWidth || img.width;
            const naturalHeight = img.naturalHeight || img.height;
            const squareSize = Math.min(naturalWidth, naturalHeight);
            const sx = Math.max(0, (naturalWidth - squareSize) / 2);
            const sy = Math.max(0, (naturalHeight - squareSize) / 2);

            sourceCtx.imageSmoothingEnabled = true;
            sourceCtx.imageSmoothingQuality = 'high';
            sourceCtx.drawImage(
                img,
                sx,
                sy,
                squareSize,
                squareSize,
                0,
                0,
                IOS_SOFT_FOCUS_SAMPLE_SIZE,
                IOS_SOFT_FOCUS_SAMPLE_SIZE
            );

            outputCtx.imageSmoothingEnabled = true;
            outputCtx.imageSmoothingQuality = 'high';
            outputCtx.globalAlpha = 1;
            outputCtx.drawImage(
                sourceCanvas,
                0,
                0,
                IOS_SOFT_FOCUS_SAMPLE_SIZE,
                IOS_SOFT_FOCUS_SAMPLE_SIZE,
                0,
                0,
                IOS_SOFT_FOCUS_OUTPUT_SIZE,
                IOS_SOFT_FOCUS_OUTPUT_SIZE
            );

            const softPasses = [
                { x: -8, y: -8, size: IOS_SOFT_FOCUS_OUTPUT_SIZE + 16, alpha: 0.22 },
                { x: 6, y: 0, size: IOS_SOFT_FOCUS_OUTPUT_SIZE, alpha: 0.14 },
                { x: 0, y: 6, size: IOS_SOFT_FOCUS_OUTPUT_SIZE, alpha: 0.14 },
            ];

            softPasses.forEach(({ x, y, size, alpha }) => {
                outputCtx.globalAlpha = alpha;
                outputCtx.drawImage(
                    sourceCanvas,
                    0,
                    0,
                    IOS_SOFT_FOCUS_SAMPLE_SIZE,
                    IOS_SOFT_FOCUS_SAMPLE_SIZE,
                    x,
                    y,
                    size,
                    size
                );
            });

            outputCtx.globalAlpha = 1;
            resolve(outputCanvas.toDataURL('image/jpeg', 0.72));
        } catch (error) {
            console.warn('[FluidBackground] Failed to build soft focus cover', error);
            resolve(null);
        }
    };

    img.onerror = () => resolve(null);
    img.src = coverUrl;
});

// Longest-edge size (px) of the downscaled blur SOURCE used on non-iOS. The world backdrop is a
// heavy blur(40px) of the cover, and a 40px blur already erases every detail finer than ~40px - so a
// ~384px source produces a blurred result visually identical to the full-resolution one. What it
// changes is the GPU cost: a full-res cover (often 1000-3000px) uploads its texture in TILES on first
// composite, and each tile appears as it lands - THAT is the grid/raster flicker, and it is why big
// covers flicker while small ones never do. A 384px source uploads in a single tile: no flicker, any
// cover size. The offscreen decode of the full-res image to build this never touches the screen.
const COVER_BLUR_SOURCE_MAX = 384;
const buildDownscaledCover = (coverUrl: string, maxSize: number): Promise<string | null> => new Promise((resolve) => {
    if (typeof document === 'undefined') {
        resolve(null);
        return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
        try {
            const naturalWidth = img.naturalWidth || img.width;
            const naturalHeight = img.naturalHeight || img.height;
            if (!naturalWidth || !naturalHeight) {
                resolve(null);
                return;
            }
            const scale = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight));
            const width = Math.max(1, Math.round(naturalWidth * scale));
            const height = Math.max(1, Math.round(naturalHeight * scale));
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(null);
                return;
            }
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        } catch (error) {
            // Cross-origin cover without CORS headers taints the canvas: fall back to the original URL.
            console.warn('[FluidBackground] Failed to downscale cover', error);
            resolve(null);
        }
    };
    img.onerror = () => resolve(null);
    img.src = coverUrl;
});

const FluidBackground: React.FC<FluidBackgroundProps> = memo(({ coverUrl, theme }) => {
    const isIOSSafari = useMemo(detectIOSSafari, []);
    const [softFocusCoverUrl, setSoftFocusCoverUrl] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        if (!isIOSSafari || !coverUrl) {
            setSoftFocusCoverUrl(null);
            return () => {
                cancelled = true;
            };
        }

        setSoftFocusCoverUrl(null);

        void buildSoftFocusCover(coverUrl).then((nextUrl) => {
            if (!cancelled) {
                setSoftFocusCoverUrl(nextUrl);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [coverUrl, isIOSSafari]);

    // Non-iOS cross-fade layers. The blur SOURCE is a downscaled copy of the cover (see
    // COVER_BLUR_SOURCE_MAX / buildDownscaledCover): building it off-screen first, then stacking the small
    // result, is what kills the grid/raster flicker at its root - the visible layer only ever uploads a
    // tiny single-tile texture, never a large tiled one. A new cover is stacked once its small source is
    // built; the layer still decode-gates before fading in (belt-and-suspenders, instant on a tiny image),
    // and once the top layer has faded in the ones beneath it are pruned. iOS keeps its own soft-focus path.
    const coverKeyRef = useRef(0);
    const [coverLayers, setCoverLayers] = useState<Array<{ url: string; sourceCover: string; key: number }>>([]);
    const [readyCoverKeys, setReadyCoverKeys] = useState<Set<number>>(() => new Set());
    useEffect(() => {
        if (isIOSSafari) return undefined;
        if (!coverUrl) { setCoverLayers([]); return undefined; }
        let cancelled = false;
        void buildDownscaledCover(coverUrl, COVER_BLUR_SOURCE_MAX).then((smallUrl) => {
            if (cancelled) return;
            const src = smallUrl ?? coverUrl;
            setCoverLayers((prev) => {
                const top = prev[prev.length - 1];
                if (top && top.sourceCover === coverUrl) return prev;
                coverKeyRef.current += 1;
                // Keep only the current top (to fade out beneath the newcomer) plus the newcomer.
                return [...(top ? [top] : []), { url: src, sourceCover: coverUrl, key: coverKeyRef.current }];
            });
        });
        return () => { cancelled = true; };
    }, [coverUrl, isIOSSafari]);
    const markCoverReady = useCallback((key: number) => {
        setReadyCoverKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    }, []);

    const iosDisplayCoverUrl = isIOSSafari ? (softFocusCoverUrl ?? coverUrl ?? null) : null;
    const isSoftFocusReady = isIOSSafari && Boolean(softFocusCoverUrl);
    const coverLayerStyle = useMemo<React.CSSProperties>(() => {
        if (isIOSSafari) {
            return {
                transform: `scale(${isSoftFocusReady ? 1.28 : 1.2}) translateZ(0)`,
                opacity: isSoftFocusReady ? 0.94 : 0.3,
                willChange: 'transform, opacity',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
            };
        }

        return {
            filter: 'blur(40px)',
            transform: 'scale(1.5) translateZ(0)',
            opacity: 1,
            willChange: 'transform, opacity, filter',
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
        };
    }, [isIOSSafari, isSoftFocusReady]);

    return (
        <div
            className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0"
            style={{
                isolation: 'isolate',
                contain: 'paint',
                transform: 'translateZ(0)',
            }}
        >
            {/* Background Image / Fallback */}
            {coverUrl ? (
                <>
                    {isIOSSafari ? (
                        <img
                            src={iosDisplayCoverUrl ?? coverUrl}
                            alt=""
                            aria-hidden="true"
                            draggable={false}
                            decoding="async"
                            className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-out"
                            style={coverLayerStyle}
                        />
                    ) : (
                        // Cross-fade the cover on song change instead of hard-swapping the <img src>: the
                        // outgoing cover fades out while the incoming one fades in (both mounted during the
                        // change), so the world's backdrop glides between songs like the camera does.
                        // The opacity is animated on a WRAPPER div, not on the blurred <img>: animating
                        // opacity directly on a blur(40px) layer makes the browser re-rasterise the blur
                        // every frame and tile-flicker it, so the blur stays baked (rasterised once) on the
                        // static img while only the cheap composited wrapper fades.
                        coverLayers.map((layer, index) => {
                            const isTop = index === coverLayers.length - 1;
                            const ready = readyCoverKeys.has(layer.key);
                            return (
                                <motion.div
                                    key={layer.key}
                                    className="absolute inset-0 w-full h-full"
                                    style={{ willChange: 'opacity' }}
                                    initial={{ opacity: isTop ? 0 : 1 }}
                                    animate={{ opacity: isTop && !ready ? 0 : 1 }}
                                    transition={{ duration: 1.5, ease: 'easeInOut' }}
                                    onAnimationComplete={() => {
                                        // Once the newcomer has fully faded in, drop the layers beneath it.
                                        if (isTop && ready) {
                                            setCoverLayers((prev) => prev.filter((l) => l.key === layer.key));
                                            setReadyCoverKeys((prev) => (prev.has(layer.key) ? new Set([layer.key]) : prev));
                                        }
                                    }}
                                >
                                    <img
                                        src={layer.url}
                                        alt=""
                                        aria-hidden="true"
                                        draggable={false}
                                        decoding="async"
                                        className="absolute inset-0 w-full h-full object-cover"
                                        style={coverLayerStyle}
                                        ref={(el) => {
                                            // layer.url is normally the tiny downscaled source (single-tile upload,
                                            // no grid flicker). This decode + one-frame settle before revealing is
                                            // belt-and-suspenders that also covers the fallback path (a CORS-tainted
                                            // cover keeps its full-res URL): decode the REAL element, let one frame
                                            // composite it while still transparent, then fade in an already-painted
                                            // image. On decode failure, reveal anyway (never get stuck).
                                            if (!el || readyCoverKeys.has(layer.key)) return;
                                            el.decode()
                                                .then(() => requestAnimationFrame(() => markCoverReady(layer.key)))
                                                .catch(() => markCoverReady(layer.key));
                                        }}
                                        onError={() => {
                                            // A broken layer (e.g. a stale cover whose object URL was revoked before
                                            // it finished loading) drops out cleanly instead of lingering under the
                                            // incoming cover. Never drop the last remaining layer.
                                            setCoverLayers((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== layer.key) : prev));
                                        }}
                                    />
                                </motion.div>
                            );
                        })
                    )}

                    {isIOSSafari && (
                        <>
                            {!isSoftFocusReady && (
                                <img
                                    src={coverUrl}
                                    alt=""
                                    aria-hidden="true"
                                    draggable={false}
                                    decoding="async"
                                    className="absolute inset-0 w-full h-full object-cover"
                                    style={{
                                        transform: 'scale(1.36) translateZ(0)',
                                        opacity: 0.12,
                                        willChange: 'transform, opacity',
                                        backfaceVisibility: 'hidden',
                                        WebkitBackfaceVisibility: 'hidden',
                                    }}
                                />
                            )}

                            <div
                                className="absolute inset-0 w-full h-full"
                                style={{
                                    backgroundColor: theme.backgroundColor,
                                    opacity: 0.28,
                                }}
                            />

                            <div
                                className="absolute inset-0 w-full h-full"
                                style={{
                                    background: `radial-gradient(circle at 20% 20%, ${theme.accentColor}55 0%, transparent 42%), radial-gradient(circle at 80% 28%, ${theme.secondaryColor}50 0%, transparent 44%), radial-gradient(circle at 50% 78%, ${theme.primaryColor}28 0%, transparent 52%)`,
                                    opacity: isSoftFocusReady ? 0.52 : 0.7,
                                }}
                            />
                        </>
                    )}
                </>
            ) : (
                <div
                    className="absolute inset-0 w-full h-full transition-colors duration-1000"
                    style={{
                        backgroundColor: theme.backgroundColor,
                        opacity: 0.8
                    }}
                />
            )}

            {/* Overlay Gradient for better text readability and blending */}
            <div
                className="absolute inset-0 w-full h-full"
                style={{
                    background: `linear-gradient(to bottom right, ${theme.primaryColor}, transparent, ${theme.secondaryColor})`,
                    opacity: isIOSSafari ? 0.2 : 0.4,
                    mixBlendMode: isIOSSafari ? 'normal' : 'overlay',
                }}
            />
        </div>
    );
}, (prevProps, nextProps) => {
    // Custom comparison function for React.memo
    if (prevProps.coverUrl !== nextProps.coverUrl) return false;

    const pTheme = prevProps.theme;
    const nTheme = nextProps.theme;

    return (
        pTheme.backgroundColor === nTheme.backgroundColor &&
        pTheme.primaryColor === nTheme.primaryColor &&
        pTheme.secondaryColor === nTheme.secondaryColor
    );
});

export default FluidBackground;
