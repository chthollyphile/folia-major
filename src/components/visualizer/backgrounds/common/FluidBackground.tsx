import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Theme } from '../../../../types';
import { ARRIVING_MARK } from '../../preview/frozenPicture';
import { useFirstFrameDrawn, useLayerUnseen } from '../../styleTransition/firstFrame';
import { useBlendedColors } from '../useBlendedColors';

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

// Width (px) of the buffer each non-iOS cover layer draws into; its height follows the element's aspect.
// A full-screen blurred cover layer at scale 1.5 cost about 100 MB of Chromium's per-window tile memory
// per copy, and the two copies kept during a song change ran that budget out, so whole layers dropped
// for single frames. A small canvas stretched over the screen is composited as one small texture.
const COVER_CANVAS_WIDTH = 320;
/** Longest side (px) a cover is kept at for drawing: plenty under the blur, and not the full-size picture. */
const COVER_SOURCE_MAX = 640;
/** How long the overlay's colours take to follow a theme change: the backdrop's transition-colors duration-1000. */
const OVERLAY_BLEND_MS = 1000;

/** A CSS colour as the canvas writes it, and the same colour with alpha 0. */
const stopsOf = (ctx: CanvasRenderingContext2D, color: string): [string, string] => {
    ctx.fillStyle = '#000';
    ctx.fillStyle = color;
    const solid = String(ctx.fillStyle);
    const [r, g, b] = solid.startsWith('#')
        ? [1, 3, 5].map((at) => parseInt(solid.slice(at, at + 2), 16))
        : (solid.match(/[\d.]+/g) ?? ['0', '0', '0']);
    return [solid, `rgba(${r}, ${g}, ${b}, 0)`];
};

const createCanvas = (width: number, height: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
};

let canvasBlurSupported: boolean | null = null;
/**
 * Whether `ctx.filter` blurs here. WebKit (Safari on macOS, every browser on iOS) has no canvas
 * filters and ignores the assignment, so it is tried on a probe once rather than trusted.
 */
const canvasBlurWorks = (): boolean => {
    if (canvasBlurSupported !== null) return canvasBlurSupported;
    try {
        const ctx = createCanvas(4, 1).getContext('2d', { willReadFrequently: true });
        if (!ctx || typeof ctx.filter !== 'string') {
            canvasBlurSupported = false;
        } else {
            ctx.filter = 'blur(1px)';
            ctx.fillStyle = '#fff';
            ctx.fillRect(2, 0, 1, 1);
            canvasBlurSupported = ctx.getImageData(1, 0, 1, 1).data[3] > 0;
        }
    } catch {
        canvasBlurSupported = false;
    }
    return canvasBlurSupported;
};

/**
 * Blurs a canvas without `ctx.filter`: halves it down to about one pixel per blur radius, then doubles
 * it back up, each step smoothed. Softer at the edges than a gaussian, which a backdrop does not show.
 */
const blurByScaling = (source: HTMLCanvasElement, blurPx: number): HTMLCanvasElement => {
    const { width: w, height: h } = source;
    // A bilinear step back up spreads one pixel over about 2.5 radii of a gaussian of the same spread.
    const smallest = w / Math.max(1, blurPx * 2.5);
    const sizes: Array<[number, number]> = [];
    let sw = w;
    let sh = h;
    while (sw / 2 >= smallest && sw > 2 && sh > 2) {
        sw = Math.ceil(sw / 2);
        sh = Math.ceil(sh / 2);
        sizes.push([sw, sh]);
    }
    const steps = [...sizes, ...sizes.slice(0, -1).reverse(), [w, h] as [number, number]];
    let current = source;
    for (const [stepWidth, stepHeight] of steps) {
        const next = createCanvas(stepWidth, stepHeight);
        const ctx = next.getContext('2d');
        if (!ctx) return current;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(current, 0, 0, stepWidth, stepHeight);
        current = next;
    }
    return current;
};

/**
 * The cover as the CSS stack it replaces drew it, without the overlay: object-cover in the box,
 * blurred 40px and then zoomed 1.5x about the centre. Drawn once per cover and size, so a theme
 * blending in redraws only the gradient over it.
 */
const bakeBlurredCover = (image: ImageBitmap, w: number, h: number, cssWidth: number): HTMLCanvasElement | null => {
    const baked = createCanvas(w, h);
    const ctx = baked.getContext('2d');
    if (!ctx) return null;
    const scale = Math.max(w / image.width, h / image.height) * 1.5;
    const dw = image.width * scale;
    const dh = image.height * scale;
    const blurPx = (40 * 1.5 * w) / cssWidth;
    const filtered = canvasBlurWorks();
    if (filtered) ctx.filter = `blur(${blurPx}px)`;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return filtered ? baked : blurByScaling(baked, blurPx);
};

/**
 * Draws a cover layer: the blurred cover under linear-gradient(to bottom right, primary, transparent,
 * secondary) at opacity 0.4 with mix-blend-mode overlay. No cover draws nothing.
 */
const drawCover = (canvas: HTMLCanvasElement, blurred: HTMLCanvasElement | null, primary: string, secondary: string) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { width: w, height: h } = canvas;
    ctx.clearRect(0, 0, w, h);
    if (!blurred) return;
    ctx.drawImage(blurred, 0, 0, w, h);

    // The CSS gradient line for "to bottom right": through the centre, at right angles to the diagonal
    // from bottom left to top right, 2wh / diagonal long. CSS fades to 'transparent' premultiplied, so
    // each half keeps its own colour and only its alpha falls to 0.
    const diagonal = Math.hypot(w, h);
    const half = (w * h) / diagonal;
    const dx = (h / diagonal) * half;
    const dy = (w / diagonal) * half;
    const gradient = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
    const [primarySolid, primaryClear] = stopsOf(ctx, primary);
    const [secondarySolid, secondaryClear] = stopsOf(ctx, secondary);
    gradient.addColorStop(0, primarySolid);
    gradient.addColorStop(0.5, primaryClear);
    gradient.addColorStop(0.5, secondaryClear);
    gradient.addColorStop(1, secondarySolid);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
};

interface CoverCanvasProps {
    image: ImageBitmap | null;
    primaryColor: string;
    secondaryColor: string;
    /** Called once, a frame after the first draw. */
    onDrawn: () => void;
}

/** One cover layer: redrawn when the cover, the colours or the element's size change; blurred again only for the first and last. */
const CoverCanvas: React.FC<CoverCanvasProps> = ({ image, primaryColor, secondaryColor, onDrawn }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [box, setBox] = useState<{ width: number; height: number } | null>(null);
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const measure = () => {
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            setBox((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(canvas);
        return () => observer.disconnect();
    }, []);

    const onDrawnRef = useRef(onDrawn);
    useLayoutEffect(() => {
        onDrawnRef.current = onDrawn;
    });
    const reportedRef = useRef(false);
    const bakedRef = useRef<{ image: ImageBitmap; width: number; height: number; cssWidth: number; canvas: HTMLCanvasElement | null } | null>(null);
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !box) return undefined;
        if (box.width > 0 && box.height > 0) {
            const height = Math.max(1, Math.round((COVER_CANVAS_WIDTH * box.height) / box.width));
            if (canvas.width !== COVER_CANVAS_WIDTH || canvas.height !== height) {
                canvas.width = COVER_CANVAS_WIDTH;
                canvas.height = height;
            }
            let baked = bakedRef.current;
            if (!image) {
                baked = null;
            } else if (!baked || baked.image !== image || baked.width !== canvas.width
                || baked.height !== canvas.height || baked.cssWidth !== box.width) {
                baked = {
                    image,
                    width: canvas.width,
                    height: canvas.height,
                    cssWidth: box.width,
                    canvas: bakeBlurredCover(image, canvas.width, canvas.height, box.width),
                };
            }
            bakedRef.current = baked;
            drawCover(canvas, baked?.canvas ?? null, primaryColor, secondaryColor);
        }
        if (reportedRef.current) return undefined;
        // One frame for the drawn canvas to reach the screen while still transparent, then it may fade in.
        // A box of no size reports too: a change never waits on it.
        const frame = requestAnimationFrame(() => {
            reportedRef.current = true;
            onDrawnRef.current();
        });
        return () => cancelAnimationFrame(frame);
    }, [box, image, primaryColor, secondaryColor]);

    return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 w-full h-full" />;
};

const FluidBackground: React.FC<FluidBackgroundProps> = memo(({ coverUrl, theme }) => {
    const isIOSSafari = useMemo(detectIOSSafari, []);
    const [softFocusCoverUrl, setSoftFocusCoverUrl] = useState<string | null>(null);
    // A theme that arrives for the song on screen blends the overlay gradient in, as the backdrop colour
    // does, instead of switching it at once. A gradient cannot take a CSS transition, so its colours are
    // blended here; a cover canvas redraws with them each frame of that second.
    const [overlayPrimary, overlaySecondary] = useBlendedColors([theme.primaryColor, theme.secondaryColor], OVERLAY_BLEND_MS);

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

    // A copy for a new song is ready once its cover is drawn: the background layer around it starts
    // the change then. Without a cover (or on iOS, which draws the cover itself) it is ready at once.
    const coverDrawn = useFirstFrameDrawn();
    // Non-iOS cross-fade layers, each drawing its cover into a small canvas (COVER_CANVAS_WIDTH). A new
    // cover is stacked once it is decoded; its layer fades in a frame after its first draw, and once the
    // top layer has faded in the ones beneath it are pruned. iOS keeps its own soft-focus path.
    const coverKeyRef = useRef(0);
    const [coverLayers, setCoverLayers] = useState<Array<{ image: ImageBitmap | null; sourceCover: string; key: number }>>([]);
    const [readyCoverKeys, setReadyCoverKeys] = useState<Set<number>>(() => new Set());
    // Every decoded cover not yet closed. A layer's bitmap holds about 1.6 MB of decoded pixels until it
    // is closed, so each is closed once no layer draws it: pruned, never stacked, or the background gone.
    const openBitmapsRef = useRef(new Set<ImageBitmap>());
    useEffect(() => {
        const drawn = new Set(coverLayers.map((layer) => layer.image));
        openBitmapsRef.current.forEach((bitmap) => {
            if (drawn.has(bitmap)) return;
            bitmap.close();
            openBitmapsRef.current.delete(bitmap);
        });
    }, [coverLayers]);
    useEffect(() => () => {
        openBitmapsRef.current.forEach((bitmap) => bitmap.close());
        openBitmapsRef.current.clear();
    }, []);
    useEffect(() => {
        if (isIOSSafari) return undefined;
        if (!coverUrl) { setCoverLayers([]); return undefined; }
        let cancelled = false;
        // No crossOrigin: the canvas is never read back, so a cover without CORS headers draws as well.
        const image = new Image();
        image.decoding = 'async';
        image.src = coverUrl;
        image.decode().then(() => {
            const fit = Math.min(1, COVER_SOURCE_MAX / Math.max(image.naturalWidth, image.naturalHeight));
            return createImageBitmap(image, {
                resizeWidth: Math.max(1, Math.round(image.naturalWidth * fit)),
                resizeHeight: Math.max(1, Math.round(image.naturalHeight * fit)),
                resizeQuality: 'high',
            });
        }).then((bitmap) => {
            if (cancelled) {
                bitmap.close();
                return;
            }
            openBitmapsRef.current.add(bitmap);
            setCoverLayers((prev) => {
                const top = prev[prev.length - 1];
                if (top && top.sourceCover === coverUrl) return prev;
                coverKeyRef.current += 1;
                // Keep only the current top (to fade out beneath the newcomer) plus the newcomer.
                return [...(top ? [top] : []), { image: bitmap, sourceCover: coverUrl, key: coverKeyRef.current }];
            });
        }, () => {
            if (cancelled) return;
            // A broken cover (e.g. a stale one whose object URL was revoked before it finished loading)
            // is not stacked over the current one; only with no layer at all does it stand, drawing
            // nothing. The copy starts anyway, so a change never waits on it.
            setCoverLayers((prev) => {
                if (prev.length > 0) return prev;
                coverKeyRef.current += 1;
                return [{ image: null, sourceCover: coverUrl, key: coverKeyRef.current }];
            });
            coverDrawn();
        });
        return () => { cancelled = true; };
    }, [coverUrl, isIOSSafari, coverDrawn]);
    const unseen = useLayerUnseen();
    // Read when a cover becomes ready, not in the render that fades it in: that render also starts the
    // change, so the copy is seen there already, and the cover faded in for 1.5s over the copy coming in.
    const unseenRef = useRef(unseen);
    useLayoutEffect(() => {
        unseenRef.current = unseen;
    });
    // The cover ready while the copy is still unseen shows at once: the background layer around it
    // plays the change of song. One that comes after fades in.
    const [atOnceCoverKey, setAtOnceCoverKey] = useState<number | null>(null);
    useEffect(() => {
        if (!coverUrl || isIOSSafari) coverDrawn();
    }, [coverUrl, isIOSSafari, coverDrawn]);
    const markCoverReady = useCallback((key: number) => {
        if (unseenRef.current) setAtOnceCoverKey(key);
        setReadyCoverKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
        coverDrawn();
    }, [coverDrawn]);
    // The cover is there once the layer made for it has faded in. Until then the root says that a
    // part is still to come, so that a small picture of this background is not taken without it.
    const [arrivedCoverKey, setArrivedCoverKey] = useState<number | null>(null);
    const topCoverLayer = coverLayers[coverLayers.length - 1];
    const isCoverArriving = Boolean(coverUrl) && !isIOSSafari
        && !(topCoverLayer && topCoverLayer.sourceCover === coverUrl && topCoverLayer.key === arrivedCoverKey);

    const iosDisplayCoverUrl = isIOSSafari ? (softFocusCoverUrl ?? coverUrl ?? null) : null;
    const isSoftFocusReady = isIOSSafari && Boolean(softFocusCoverUrl);
    const coverLayerStyle = useMemo<React.CSSProperties>(() => ({
        transform: `scale(${isSoftFocusReady ? 1.28 : 1.2}) translateZ(0)`,
        opacity: isSoftFocusReady ? 0.94 : 0.3,
        willChange: 'transform, opacity',
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
    }), [isSoftFocusReady]);

    return (
        <div
            className="absolute inset-0 w-full h-full overflow-hidden pointer-events-none z-0"
            style={{
                isolation: 'isolate',
                contain: 'paint',
                transform: 'translateZ(0)',
            }}
            {...(isCoverArriving ? { [ARRIVING_MARK]: '' } : {})}
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
                        <>
                        {/* Under the cover, which hides it: what shows until the cover is drawn, for a copy
                            started before its cover came (BACKGROUND_READY_LIMIT_MS). */}
                        <div
                            className="absolute inset-0 w-full h-full transition-colors duration-1000"
                            style={{ backgroundColor: theme.backgroundColor, opacity: 0.8 }}
                        />
                        {/* Cross-fade the cover on song change instead of hard-swapping the <img src>: the
                            outgoing cover fades out while the incoming one fades in (both mounted during the
                            change), so the world's backdrop glides between songs like the camera does.
                            The opacity is animated on a wrapper div; the canvas in it, with the blur and the
                            overlay gradient baked in, is drawn only when its cover, colours or size change. */}
                        {coverLayers.map((layer, index) => {
                            const isTop = index === coverLayers.length - 1;
                            const ready = readyCoverKeys.has(layer.key);
                            return (
                                <motion.div
                                    key={layer.key}
                                    className="absolute inset-0 w-full h-full"
                                    style={{ willChange: 'opacity' }}
                                    initial={{ opacity: isTop ? 0 : 1 }}
                                    animate={{ opacity: isTop && !ready ? 0 : 1 }}
                                    transition={{ duration: layer.key === atOnceCoverKey ? 0 : 1.5, ease: 'easeInOut' }}
                                    onAnimationComplete={() => {
                                        // Once the newcomer has fully faded in, drop the layers beneath it.
                                        if (isTop && ready) {
                                            setCoverLayers((prev) => prev.filter((l) => l.key === layer.key));
                                            setReadyCoverKeys((prev) => (prev.has(layer.key) ? new Set([layer.key]) : prev));
                                            setArrivedCoverKey(layer.key);
                                        }
                                    }}
                                >
                                    <CoverCanvas
                                        image={layer.image}
                                        primaryColor={overlayPrimary}
                                        secondaryColor={overlaySecondary}
                                        onDrawn={() => markCoverReady(layer.key)}
                                    />
                                </motion.div>
                            );
                        })}
                        </>
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

            {/* Overlay Gradient for better text readability and blending. Off iOS a cover layer bakes it in:
                here only for a cover that failed to load. */}
            {(!coverUrl || isIOSSafari || (topCoverLayer && !topCoverLayer.image)) && (
                <div
                    className="absolute inset-0 w-full h-full"
                    style={{
                        background: `linear-gradient(to bottom right, ${overlayPrimary}, transparent, ${overlaySecondary})`,
                        opacity: isIOSSafari ? 0.2 : 0.4,
                        mixBlendMode: isIOSSafari ? 'normal' : 'overlay',
                    }}
                />
            )}
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
