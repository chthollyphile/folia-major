import { useEffect, useRef, type RefObject } from 'react';
import { drawFumeBackground } from './FumeBackground';
import { isGlowBlurQuantized } from '../../../utils/glowBlurQuantize';
import { resolveLyricPixelRatio } from '../../../utils/lyricRenderQuality';
import type { LyricRenderScale } from '../../../types';
import type { StaticBlockSnapshot } from './fumeTypes';
import { resolveFumeBackgroundView, stepFumeCamera, syncFumeCameraToArticle } from './fumeCameraStep';
import { isFumeBlockOnScreen, resolveFumeBlockTiming, resolveFumeGlowBases, resolveFumeStaticLayers, type FumeStaticLayerInput } from './fumeBlockFrame';
import { clamp } from './fumeMath';
import { createStaticBlockSnapshot, drawFumeLiveBlock, type FumeLiveBlockParams } from './fumeCanvasText';
import { FumeLiveRaster } from './fumeLiveRaster';
import { readFumeAudioLevels, type FumeStageDriver, type FumeStageScene } from './fumeStage';

// src/components/visualizer/fume/useFumeCanvasStage.ts
// Fume's stage: one full-viewport canvas redrawn every frame - background, then every block on screen,
// waiting and passed blocks from cached snapshots, printing blocks glyph by glyph.
//
// While Lab > Fix lyric animation freeze on Linux is on, a printing block goes through FumeLiveRaster
// (drawn at a bounded set of raster scales, then placed under the camera) instead of straight under
// the camera transform, which asked Chromium's glyph cache for a new size every frame. A Pixi stage
// was built and measured as the alternative: no less CPU, 85 MiB more video memory
// (docs/linux-glyph-cache-fd-leak.md).
//
// 分辨率倍数（#929）乘在三处密度上：舞台画布的位图（原来是 devicePixelRatio）、等待 / 唱过的文字快照
// （原来是 clamp(devicePixelRatio, 1, 2)，快照的缓存键带着它，倍数变了自然画新的）、打字中那块的光栅
// （FumeLiveRaster 按相机缩放 × 舞台像素密度选级）。>1 的倍数由 resolveLyricPixelRatio 封顶。

/** A snapshot unused this long is released; it is cheap to draw again. */
const SNAPSHOT_IDLE_MS = 15_000;

export const useFumeCanvasStage = (
    canvasRef: RefObject<HTMLCanvasElement | null>,
    scene: FumeStageScene,
    driver: FumeStageDriver,
    paused: boolean,
    renderScale: LyricRenderScale = 1,
) => {
    const staticBlockSnapshotCacheRef = useRef<Map<string, { snapshot: StaticBlockSnapshot; lastUsed: number }>>(new Map());
    const liveRasterRef = useRef<FumeLiveRaster | null>(null);
    const { article, theme } = scene;

    useEffect(() => () => {
        liveRasterRef.current?.clear();
        releaseSnapshots(staticBlockSnapshotCacheRef.current, Number.POSITIVE_INFINITY);
    }, []);

    useEffect(() => {
        releaseSnapshots(staticBlockSnapshotCacheRef.current, Number.POSITIVE_INFINITY);
    }, [
        article,
        theme.name,
        theme.primaryColor,
        theme.secondaryColor,
        theme.accentColor,
        theme.fontStyle,
        theme.fontFamily,
        theme.fontFamilyStack,
    ]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }

        const {
            lines, viewport, backgroundScene, overviewCamera, overviewStartTime, passedFadeDuration, cameraSpeed,
            cameraTrackingMode, glowIntensity, backgroundObjectOpacity, showPrintStamp, textHoldRatio, showText, staticMode,
        } = scene;
        const { currentTime, cameraState } = driver;
        liveRasterRef.current ??= new FumeLiveRaster();
        const liveRaster = liveRasterRef.current;
        let hasPrintedContent = false;

        const width = Math.max(Math.floor(viewport.width), 1);
        const height = Math.max(Math.floor(viewport.height), 1);
        // 舞台画布的像素密度与文字快照的光栅密度，都按样式原来的算法乘上分辨率倍数。
        const resolveStagePixelRatio = () => resolveLyricPixelRatio(window.devicePixelRatio || 1, renderScale);
        const resolveSnapshotScale = () => resolveLyricPixelRatio(clamp(window.devicePixelRatio || 1, 1, 2), renderScale);
        const dpr = resolveStagePixelRatio();

        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, width, height);

        syncFumeCameraToArticle(cameraState, article);
        let frameId = 0;
        let lastFrameAt: number | null = null;

        const draw = () => {
            const now = performance.now();
            const dt = lastFrameAt === null
                ? 1 / 60
                : clamp((now - lastFrameAt) / 1000, 1 / 240, 0.05);
            lastFrameAt = now;

            const currentWidth = Math.max(Math.floor(viewport.width), 1);
            const currentHeight = Math.max(Math.floor(viewport.height), 1);
            const currentDpr = resolveStagePixelRatio();

            if (canvas.width !== Math.floor(currentWidth * currentDpr) || canvas.height !== Math.floor(currentHeight * currentDpr)) {
                canvas.width = Math.floor(currentWidth * currentDpr);
                canvas.height = Math.floor(currentHeight * currentDpr);
                canvas.style.width = `${currentWidth}px`;
                canvas.style.height = `${currentHeight}px`;
            }

            context.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
            context.clearRect(0, 0, currentWidth, currentHeight);

            const time = currentTime.get();
            const viewportCenterX = viewport.width * 0.5;
            const viewportCenterY = viewport.height * 0.5;
            const fumeBackgroundAudioLevels = readFumeAudioLevels(driver);

            if (!article) {
                if (!staticMode) {
                    context.save();
                    context.translate(viewportCenterX, viewportCenterY);
                    context.translate(-backgroundScene.width * 0.5, -backgroundScene.height * 0.5);
                    drawFumeBackground({
                        context,
                        scene: backgroundScene,
                        theme,
                        time: time + now * 0.00018,
                        audioLevels: fumeBackgroundAudioLevels,
                        objectOpacityMultiplier: backgroundObjectOpacity * 2,
                    });
                    context.restore();
                }

                if (!paused) {
                    frameId = window.requestAnimationFrame(draw);
                }
                return;
            }

            // One-shot detection: once any block starts printing, flip hasPrintedContent
            if (!hasPrintedContent && time >= article.firstRenderableStartTime) {
                hasPrintedContent = true;
                driver.onPrintedContent();
            }

            const { overviewTextRestoreProgress } = stepFumeCamera(cameraState, {
                article,
                time,
                now,
                dt,
                lineIndex: driver.getLineIndex(),
                viewport,
                overviewCamera,
                overviewStartTime,
                cameraSpeed,
                cameraTrackingMode,
                staticMode,
                animationIntensity: theme.animationIntensity,
            });
            const camera = cameraState.camera;

            const screenScale = camera.scale;

            if (!staticMode) {
                const {
                    backgroundCenterX,
                    backgroundCenterY,
                    backgroundCameraX,
                    backgroundCameraY,
                    backgroundScale,
                } = resolveFumeBackgroundView(backgroundScene, camera, viewport);

                context.save();
                context.translate(viewportCenterX, viewportCenterY);
                context.scale(backgroundScale, backgroundScale);
                context.translate(-backgroundCameraX, -backgroundCameraY);
                drawFumeBackground({
                    context,
                    scene: backgroundScene,
                    theme,
                    time,
                    audioLevels: fumeBackgroundAudioLevels,
                    objectOpacityMultiplier: backgroundObjectOpacity * 2,
                    parallax: {
                        cameraX: backgroundCameraX,
                        cameraY: backgroundCameraY,
                        originX: backgroundCenterX,
                        originY: backgroundCenterY,
                        strength: 0.72,
                    },
                });
                context.restore();
            }

            context.save();
            context.translate(viewportCenterX, viewportCenterY);
            context.scale(screenScale, screenScale);
            context.translate(-camera.x, -camera.y);

            const { activeGlowBoost, passedGlowBase } = resolveFumeGlowBases(theme.animationIntensity, glowIntensity);
            const liveParams: FumeLiveBlockParams = { time, theme, glowIntensity, activeGlowBoost, passedGlowBase, showPrintStamp };
            const staticLayerInput: FumeStaticLayerInput = {
                time,
                theme,
                passedGlowBase,
                passedFadeDuration,
                overviewTextRestoreProgress,
                snapshotScale: resolveSnapshotScale(),
            };

            const rasterLive = isGlowBlurQuantized();
            // A little margin so glyphs entering the screen are already drawn.
            const margin = 32 / screenScale;
            const liveFrame = {
                deviceScale: screenScale * currentDpr,
                visible: {
                    left: camera.x - viewportCenterX / screenScale - margin,
                    top: camera.y - viewportCenterY / screenScale - margin,
                    right: camera.x + viewportCenterX / screenScale + margin,
                    bottom: camera.y + viewportCenterY / screenScale + margin,
                },
            };

            if (showText) {
                for (const block of article.blocks) {
                    if (!isFumeBlockOnScreen(block, camera, viewport)) {
                        continue;
                    }

                    const timing = resolveFumeBlockTiming(
                        block,
                        time,
                        lines[block.sourceLineIndex + 1]?.startTime ?? null,
                        textHoldRatio,
                    );
                    const layers = resolveFumeStaticLayers(block, timing, staticLayerInput, (spec) => {
                        let entry = staticBlockSnapshotCacheRef.current.get(spec.key);
                        if (!entry) {
                            const snapshot = createStaticBlockSnapshot(block, theme, spec.fill, spec.shadowBlur, spec.shadowColor, staticLayerInput.snapshotScale);
                            if (!snapshot) return undefined;
                            entry = { snapshot, lastUsed: now };
                            staticBlockSnapshotCacheRef.current.set(spec.key, entry);
                        }
                        entry.lastUsed = now;
                        return entry.snapshot;
                    });

                    if (layers) {
                        for (const { snapshot, alpha } of layers) {
                            context.globalAlpha = alpha;
                            context.drawImage(
                                snapshot.canvas,
                                block.x - snapshot.padding,
                                block.y - snapshot.padding,
                                block.width + snapshot.padding * 2,
                                block.height + snapshot.padding * 2,
                            );
                        }
                        context.globalAlpha = 1;
                        continue;
                    }

                    if (!rasterLive) {
                        drawFumeLiveBlock(context, block, timing, liveParams);
                        continue;
                    }
                    const image = liveRaster.draw(block, timing, liveParams, liveFrame, now);
                    if (image) {
                        context.drawImage(image.canvas, 0, 0, image.width, image.height, image.x, image.y, image.worldWidth, image.worldHeight);
                    }
                }
            }
            context.restore();
            liveRaster.sweep(now);
            releaseSnapshots(staticBlockSnapshotCacheRef.current, now);

            if (!paused) {
                frameId = window.requestAnimationFrame(draw);
            }
        };

        draw();
        return () => {
            window.cancelAnimationFrame(frameId);
            lastFrameAt = null;
        };
    }, [article, canvasRef, driver, paused, renderScale, scene, theme]);
};

/** Releases snapshots idle for longer than SNAPSHOT_IDLE_MS (all of them for `now` = Infinity). */
const releaseSnapshots = (cache: Map<string, { snapshot: StaticBlockSnapshot; lastUsed: number }>, now: number) => {
    for (const [key, entry] of cache) {
        if (now - entry.lastUsed <= SNAPSHOT_IDLE_MS) continue;
        // Give the backing store back now rather than whenever the canvas is collected.
        entry.snapshot.canvas.width = 0;
        entry.snapshot.canvas.height = 0;
        cache.delete(key);
    }
};
