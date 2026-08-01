import type { MotionValue } from 'framer-motion';
import type { SonnetTuning, Theme } from '../../../types';
import type { SonnetProgram } from './types';
import { findSonnetParagraphIndexAtTime } from './sonnetProgram';
import { buildSonnetIconDataUrl, buildSonnetIconTextureKey, resolveSonnetIconNames } from './sonnetIcons';
import {
    clamp01,
    easeSonnetInOut,
    resolveSegmentProgress,
    resolveSonnetFocusWeights,
    resolveShotMotionFrame,
    resolveShotProgress,
    resolveTimelineShake,
    resolveTransitionFrame,
} from './sonnetMotion';
import { buildSonnetScene, type SceneView, type ShotView } from './sonnetSceneBuilder';
import { getSonnetTexturePool } from './sonnetTexturePool';
import {
    destroySonnetContainerChildren,
    unloadSonnetDisplayTree,
} from './sonnetPixiResources';
import {
    buildSonnetCreditsPoster,
    hasSonnetCreditsMetadata,
    resolveSonnetCreditsFrame,
} from './sonnetCredits';

// src/components/visualizer/sonnet/createSonnetPixiRuntime.ts
// Owns Pixi lifecycle and mutates bounded scene views directly from absolute playback time.
type PixiModule = typeof import('pixi.js');

export interface SonnetSongMetadata {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
}

export interface SonnetRuntimeOptions {
    host: HTMLDivElement;
    program: SonnetProgram;
    theme: Theme;
    tuning: SonnetTuning;
    currentTime: MotionValue<number>;
    lyricsFontScale: number;
    staticMode: boolean;
    paused: boolean;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    signal?: AbortSignal;
}

const animationScale = (theme: Theme) => (
    theme.animationIntensity === 'calm' ? 0.65 : theme.animationIntensity === 'chaotic' ? 1.35 : 1
);

export class SonnetPixiRuntime {
    private readonly sceneCache = new Map<number, SceneView>();
    private readonly iconTextures = new Map<string, import('pixi.js').Texture>();
    private readonly iconUrls = new Set<string>();
    private activeParagraphIndex = -1;
    private destroyed = false;
    private resizeObserver: ResizeObserver | null = null;
    private lastWidth = 0;
    private lastHeight = 0;

    private sceneContainer!: import('pixi.js').Container;
    private creditsContainer!: import('pixi.js').Container;
    private overlayContainer!: import('pixi.js').Container;
    private outroBlurFilter: import('pixi.js').BlurFilter | null = null;
    private outroBlurScene: SceneView | null = null;

    private constructor(
        private readonly pixi: PixiModule,
        private readonly options: SonnetRuntimeOptions,
        private readonly app: import('pixi.js').Application,
    ) { }

    static async create(options: SonnetRuntimeOptions) {
        const pixi = await import('pixi.js');
        const app = new pixi.Application();
        const width = Math.max(options.host.clientWidth, 320);
        const height = Math.max(options.host.clientHeight, 240);
        await app.init({
            width,
            height,
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: options.tuning.textureResolution,
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
            powerPreference: 'high-performance',
        });
        const runtime = new SonnetPixiRuntime(pixi, options, app);
        runtime.sceneContainer = new pixi.Container();
        runtime.creditsContainer = new pixi.Container();
        runtime.overlayContainer = new pixi.Container();
        app.stage.addChild(runtime.sceneContainer, runtime.creditsContainer, runtime.overlayContainer);

        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Sonnet runtime creation was cancelled', 'AbortError');
        }
        options.host.appendChild(app.canvas);
        app.canvas.style.cssText = 'width:100%;height:100%;display:block';
        await runtime.preloadIcons();
        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Sonnet runtime creation was cancelled', 'AbortError');
        }
        runtime.install();
        return runtime;
    }

    private install() {
        this.resizeToHost();
        this.app.ticker.add(this.renderFrame);
        this.resizeObserver = new ResizeObserver(() => {
            if (this.destroyed || !this.resizeToHost()) return;
            if (this.options.paused) this.renderOnce();
        });
        this.resizeObserver.observe(this.options.host);
        this.renderOnce();
        if (!this.options.paused) this.app.start();
    }

    private resizeToHost() {
        if (this.destroyed) return false;
        const width = Math.max(this.options.host.clientWidth, 320);
        const height = Math.max(this.options.host.clientHeight, 240);
        if (width === this.lastWidth && height === this.lastHeight) return false;
        this.lastWidth = width;
        this.lastHeight = height;
        this.app.renderer.resize(width, height);
        this.clearScenes();
        this.drawCredits(width, height);
        this.drawOverlay(width, height);
        return true;
    }

    private drawCredits(width: number, height: number) {
        destroySonnetContainerChildren(this.creditsContainer);
        const metadata = {
            title: this.options.songTitle,
            artist: this.options.songArtist,
            album: this.options.songAlbum,
        };
        if (!hasSonnetCreditsMetadata(metadata)) return;
        this.creditsContainer.addChild(buildSonnetCreditsPoster(
            this.pixi,
            this.options.theme,
            metadata,
            width,
            height,
            this.options.lyricsFontScale,
        ));
        this.creditsContainer.pivot.set(width / 2, height / 2);
        this.creditsContainer.position.set(width / 2, height / 2);
        this.creditsContainer.visible = false;
    }

    setSongMetadata(metadata: SonnetSongMetadata) {
        if (this.destroyed) return;
        const changed = this.options.songTitle !== metadata.title
            || this.options.songArtist !== metadata.artist
            || this.options.songAlbum !== metadata.album;
        if (!changed) return;

        this.options.songTitle = metadata.title;
        this.options.songArtist = metadata.artist;
        this.options.songAlbum = metadata.album;
        if (this.lastWidth > 0 && this.lastHeight > 0) {
            this.drawCredits(this.lastWidth, this.lastHeight);
            if (this.options.paused) this.renderOnce();
        }
    }

    private clearOutroBlur() {
        if (this.outroBlurFilter && this.outroBlurScene) {
            this.outroBlurScene.container.filters = (this.outroBlurScene.container.filters ?? [])
                .filter(filter => filter !== this.outroBlurFilter);
            this.outroBlurFilter.destroy();
        }
        this.outroBlurFilter = null;
        this.outroBlurScene = null;
    }

    private updateOutroBlur(scene: SceneView, strength: number) {
        if (strength <= 0) {
            this.clearOutroBlur();
            return;
        }
        if (this.outroBlurScene !== scene) this.clearOutroBlur();
        if (!this.outroBlurFilter) {
            this.outroBlurFilter = new this.pixi.BlurFilter({
                strength: 0,
                quality: 2,
                kernelSize: 5,
                resolution: 0.75,
            });
            scene.container.filters = [...(scene.container.filters ?? []), this.outroBlurFilter];
            this.outroBlurScene = scene;
        }
        this.outroBlurFilter.strength = strength;
    }

    private drawOverlay(width: number, height: number) {
        destroySonnetContainerChildren(this.overlayContainer);
        const g = new this.pixi.Graphics();

        const paddingX = Math.max(30, width * 0.05);
        const paddingY = Math.max(30, height * 0.05);

        const primary = this.pixi.Color.shared.setValue(this.options.theme.primaryColor).toNumber();
        const alpha = 0.5;

        // Asymmetrical, partial perimeter (Not enclosing the whole screen)
        // 1. Top-Left cluster
        g.rect(paddingX, paddingY, 30, 4).fill({ color: primary, alpha: 0.8 }); // Thick bar
        g.moveTo(paddingX, paddingY + 16).lineTo(paddingX, paddingY + 120).stroke({ color: primary, width: 1, alpha }); // Dropping line

        // 2. Bottom-Right cluster
        g.rect(width - paddingX - 4, height - paddingY - 16, 4, 16).fill({ color: primary, alpha: 0.8 }); // Thick vertical bar
        g.moveTo(width - paddingX - 160, height - paddingY).lineTo(width - paddingX - 20, height - paddingY).stroke({ color: primary, width: 1, alpha }); // Horizontal line
        g.moveTo(width - paddingX, height - paddingY - 180).lineTo(width - paddingX, height - paddingY - 30).stroke({ color: primary, width: 1, alpha }); // Rising line

        // 3. Floating accents
        const drawCross = (cx: number, cy: number, size: number) => {
            g.moveTo(cx - size, cy).lineTo(cx + size, cy).stroke({ color: primary, width: 1, alpha: 0.8 });
            g.moveTo(cx, cy - size).lineTo(cx, cy + size).stroke({ color: primary, width: 1, alpha: 0.8 });
        };
        // Top-Right cross
        drawCross(width - paddingX, paddingY + 20, 6);

        // Bottom-Left diamond
        g.moveTo(paddingX, height - paddingY - 4).lineTo(paddingX + 4, height - paddingY).lineTo(paddingX, height - paddingY + 4).lineTo(paddingX - 4, height - paddingY).fill({ color: primary, alpha: 0.7 });

        // Minimalist Asymmetrical Typography
        const textStyle = new this.pixi.TextStyle({
            fontFamily: 'sans-serif',
            fontSize: 10,
            fill: primary,
            letterSpacing: 4,
            fontWeight: 'bold'
        });

        const topText = new this.pixi.Text({ text: 'SONNET', style: textStyle });
        topText.alpha = 0.5;
        topText.position.set(paddingX + 40, paddingY - 2);
        topText.anchor.set(0, 0);

        const bottomText = new this.pixi.Text({ text: 'VISUALIZER', style: textStyle });
        bottomText.alpha = 0.5;
        bottomText.position.set(width - paddingX - 150, height - paddingY);
        bottomText.anchor.set(0, 0.5);

        // Typographic star ✦
        const starStyle = new this.pixi.TextStyle({
            fontFamily: 'sans-serif',
            fontSize: 12,
            fill: primary,
        });
        const starText = new this.pixi.Text({ text: '✦', style: starStyle });
        starText.alpha = 0.6;
        starText.position.set(width - paddingX - 10, height - paddingY);
        starText.anchor.set(1, 0.5);

        this.overlayContainer.addChild(g, topText, bottomText, starText);
    }

    private async preloadIcons() {
        const names = resolveSonnetIconNames(this.options.theme.lyricsIcons).slice(0, 4);
        const resolution = this.options.tuning.textureResolution;
        const texturePool = getSonnetTexturePool(this.pixi);
        await Promise.all(names.map(async (name, index) => {
            const size = 192 + index * 32;
            const colors = [
                this.options.theme.accentColor,
                this.options.theme.secondaryColor,
                this.options.theme.primaryColor,
            ];
            const color = colors[index % colors.length];
            const key = buildSonnetIconTextureKey(name, color, 3.5, size, resolution);
            const url = buildSonnetIconDataUrl(name, color, 3.5, size);
            if (!url) return;
            try {
                this.iconTextures.set(key, await texturePool.acquire(url));
                this.iconUrls.add(url);
            } catch {
                // Invalid theme icons are optional; geometric MG remains available.
            }
        }));
    }

    private clearScenes() {
        this.clearOutroBlur();
        this.sceneCache.forEach(scene => {
            this.destroyScene(scene);
        });
        this.sceneCache.clear();
        this.activeParagraphIndex = -1;
    }
    private destroyScene(scene: SceneView) {
        if (this.outroBlurScene === scene) this.clearOutroBlur();
        this.sceneContainer.removeChild(scene.container);
        unloadSonnetDisplayTree(scene.container);
        scene.container.filters = null;
        scene.shots.forEach(shot => {
            shot.haloLayer.filters = null;
        });
        scene.postProcessFilters.forEach(filter => filter.destroy());
        scene.container.destroy({ children: true });
    }

    private ensureScene(index: number) {
        if (index < 0 || index >= this.options.program.paragraphs.length) return null;
        const cached = this.sceneCache.get(index);
        if (cached) return cached;
        const scene = buildSonnetScene(this.pixi, {
            programSeed: this.options.program.seed,
            host: this.options.host,
            theme: this.options.theme,
            tuning: this.options.tuning,
            lyricsFontScale: this.options.lyricsFontScale,
            staticMode: this.options.staticMode,
        }, this.iconTextures, this.options.program.paragraphs[index]);
        this.sceneCache.set(index, scene);
        this.sceneContainer.addChild(scene.container);
        return scene;
    }

    private pruneScenes(index: number) {
        this.sceneCache.forEach((scene, sceneIndex) => {
            if (Math.abs(sceneIndex - index) <= 1) return;
            this.destroyScene(scene);
            this.sceneCache.delete(sceneIndex);
        });
    }

    private updateShot(view: ShotView, time: number, width: number, height: number, shakeIntensity: number) {
        const progress = resolveShotProgress(view.shot, time);
        const motion = this.options.tuning.typographyMotion * animationScale(this.options.theme);
        const camera = this.options.tuning.cameraIntensity * animationScale(this.options.theme);
        const cameraFrame = resolveShotMotionFrame(view.shot.kind, progress);

        // Add a slow continuous pan during the time gap to prevent the scene from looking frozen
        const gapTime = Math.max(0, time - view.shot.endTime);
        if (gapTime > 0) {
            // Inherit the movement direction from the tail end of the shot (progress 0.8 to 1.0)
            const tailStart = resolveShotMotionFrame(view.shot.kind, 0.8);
            const dx = cameraFrame.x - tailStart.x;
            const dy = cameraFrame.y - tailStart.y;
            const dScale = cameraFrame.scale - tailStart.scale;
            const dRot = cameraFrame.rotation - tailStart.rotation;

            // Continue drifting in that direction at a slow, relaxed PV pace
            // speed = 0.8 means it takes 1.25 seconds of gap to drift the same distance 
            // the camera covered in the last 20% of the shot.
            const maxDrift = 2.0;
            const driftSpeed = (1 - Math.exp(-gapTime * 0.4)) * maxDrift;
            cameraFrame.x += dx * driftSpeed;
            cameraFrame.y += dy * driftSpeed;
            cameraFrame.scale += dScale * driftSpeed;
            cameraFrame.rotation += dRot * driftSpeed;
        }

        const shake = resolveTimelineShake(time, shakeIntensity);

        let trackSegments = view.segments.filter(s => s.role !== 'decoration' && s.glyphs.length > 0);
        if (trackSegments.length === 0) trackSegments = view.segments.filter(s => s.glyphs.length > 0);

        let currentFocusX = view.basePivotX;
        let currentFocusY = view.basePivotY;

        if (trackSegments.length > 0) {
            const getSegmentFocus = (seg: typeof view.segments[0], t: number) => {
                if (seg.glyphs.length === 0) return { x: 0, y: 0 };
                const first = seg.glyphs[0];
                const last = seg.glyphs[seg.glyphs.length - 1];
                
                // Dampen the tracking distance to prevent the camera from advancing too fast
                // and pushing settled text off the screen edge.
                const trackingFactor = 0.35; 
                const segCenterX = (first.baseX + last.baseX) / 2;
                const segCenterY = (first.baseY + last.baseY) / 2;
                const applyFactor = (exactX: number, exactY: number) => ({
                    x: segCenterX + (exactX - segCenterX) * trackingFactor,
                    y: segCenterY + (exactY - segCenterY) * trackingFactor
                });

                if (t <= first.startTime) return applyFactor(first.baseX, first.baseY);
                if (t >= last.startTime) return applyFactor(last.baseX, last.baseY);
                
                for (let i = 0; i < seg.glyphs.length - 1; i++) {
                    if (t >= seg.glyphs[i].startTime && t <= seg.glyphs[i+1].startTime) {
                        const g1 = seg.glyphs[i];
                        const g2 = seg.glyphs[i+1];
                        const p = (t - g1.startTime) / Math.max(0.001, g2.startTime - g1.startTime);
                        const exactX = g1.baseX + (g2.baseX - g1.baseX) * p;
                        const exactY = g1.baseY + (g2.baseY - g1.baseY) * p;
                        return applyFactor(exactX, exactY);
                    }
                }
                return applyFactor(first.baseX, first.baseY);
            };

            const focusTime = Math.max(view.shot.startTime, Math.min(time, view.shot.endTime));
            let focusX = 0;
            let focusY = 0;
            const focusWeights = resolveSonnetFocusWeights(
                trackSegments.map(segment => ({
                    startTime: segment.glyphs[0]?.startTime ?? view.shot.startTime,
                    endTime: segment.glyphs.at(-1)?.startTime ?? view.shot.endTime,
                })),
                focusTime,
            );

            for (let i = 0; i < trackSegments.length; i++) {
                const seg = trackSegments[i];
                if (seg.glyphs.length === 0) continue;
                const weight = focusWeights[i] ?? 0;
                const pos = getSegmentFocus(seg, focusTime);
                focusX += pos.x * weight;
                focusY += pos.y * weight;
            }

            currentFocusX = focusX;
            currentFocusY = focusY;
        }

        view.container.pivot.set(
            view.basePivotX + (currentFocusX - view.basePivotX) * camera,
            view.basePivotY + (currentFocusY - view.basePivotY) * camera
        );

        view.container.scale.set(
            view.shot.camera.zoom
            * (1 + (cameraFrame.scale - 1) * camera),
        );
        view.container.rotation = (
            view.shot.camera.rotation + cameraFrame.rotation + shake.rotation
        ) * camera;
        view.container.x = view.baseX + (cameraFrame.x * width + shake.x * width) * camera;
        view.container.y = view.baseY + (cameraFrame.y * height + shake.y * height) * camera;

        if (view.mgParticleLayer) {
            // Create a slight time-difference/parallax effect for decorative elements
            const particleParallaxX = (cameraFrame.x * width + shake.x * width) * camera * 0.4;
            const particleParallaxY = (cameraFrame.y * height + shake.y * height) * camera * 0.4;
            view.mgParticleLayer.position.set(particleParallaxX, particleParallaxY);
            
            // Continuous independent rotation based on shot time
            view.mgParticleLayer.rotation = (time - view.shot.startTime) * 0.05;
            // Slower scale response creates depth illusion
            view.mgParticleLayer.scale.set(1 + (cameraFrame.scale - 1) * 0.3);
        }
        
        if (view.mgFixedGeoLayer) {
            // Keep fixed geometry upright regardless of camera rotation
            view.mgFixedGeoLayer.rotation = -view.container.rotation;
        }

        if ((view.mgLayer as any).updateTime) {
            (view.mgLayer as any).updateTime(time, view.shot.cues, view.shot.startTime, view.shot.endTime);
        }

        view.segments.forEach(segmentView => {
            const guide = segmentView.guide;
            const guideActive = time >= guide.startTime && time <= guide.endTime;
            guide.container.visible = guideActive;
            if (guideActive) {
                const guideProgress = clamp01(
                    (time - guide.startTime) / Math.max(0.001, guide.endTime - guide.startTime),
                );
                if ((guide as any).update) {
                    guide.container.alpha = guide.maxAlpha;
                    (guide as any).update(guideProgress);
                } else {
                    const eased = easeSonnetInOut(guideProgress);
                    guide.container.alpha = Math.sin(eased * Math.PI) * guide.maxAlpha;
                    guide.container.scale.set(0.76 + eased * 0.24);
                }
            }

            segmentView.glyphs.forEach(glyph => {
                const glyphProgress = resolveSegmentProgress(
                    glyph.startTime,
                    glyph.settleTime,
                    time,
                );
                const waiting = time < glyph.startTime;
                const offset = (1 - glyphProgress) * motion;
                const coreAlpha = waiting ? 0 : 0.16 + glyphProgress * 0.84;
                const haloAlpha = waiting ? 0 : 1 - glyphProgress * 0.28;
                const scale = segmentView.role === 'hero' && view.shot.kind === 'type-impact'
                    ? 0.52 + glyphProgress * 0.48
                    : 0.86 + glyphProgress * 0.14;
                const x = glyph.baseX + glyph.enterX * offset;
                const y = glyph.baseY + glyph.enterY * offset;
                const rotation = glyph.finalRotation + glyph.entryRotation * offset;

                // Simulated Parallax 3D effect
                const depth = glyph.zDepth || 0;
                // Move faster/slower than camera
                const parallaxX = (cameraFrame.x * width + shake.x * width) * camera * depth * 2.5;
                const parallaxY = (cameraFrame.y * height + shake.y * height) * camera * depth * 2.5;
                // Scale larger if closer to camera (positive depth)
                const depthScale = 1 + depth * 0.45;

                glyph.display.alpha = coreAlpha;
                glyph.display.scale.set(scale * depthScale);
                glyph.display.position.set(x + parallaxX, y + parallaxY);
                glyph.display.rotation = rotation;
                if (glyph.halo) {
                    glyph.halo.alpha = haloAlpha;
                    glyph.halo.scale.set(scale * (1.08 - glyphProgress * 0.08));
                    glyph.halo.position.set(x, y);
                    glyph.halo.rotation = rotation;
                }

                // Animate Chromatic Aberration separation and merging
                if (glyph.caCyan && glyph.caRed && glyph.caOffset) {
                    // Starts separated (impact), and gently merges to a very subtle base offset
                    const mergeEased = easeSonnetInOut(glyphProgress);
                    const currentOffset = glyph.caOffset * (1 - mergeEased * 0.8); // 1.0 -> 0.2

                    glyph.caCyan.position.set(-currentOffset, currentOffset * 0.5);
                    glyph.caRed.position.set(currentOffset, -currentOffset * 0.5);
                }
            });
        });
    }

    private renderFrame = () => {
        if (this.destroyed || this.options.program.paragraphs.length === 0) return;
        const time = this.options.currentTime.get();
        const paragraphIndex = findSonnetParagraphIndexAtTime(this.options.program, time);
        if (paragraphIndex !== this.activeParagraphIndex) {
            this.activeParagraphIndex = paragraphIndex;
            this.ensureScene(paragraphIndex - 1);
            this.ensureScene(paragraphIndex);
            this.ensureScene(paragraphIndex + 1);
            this.pruneScenes(paragraphIndex);
        }
        const width = Math.max(this.options.host.clientWidth, 320);
        const height = Math.max(this.options.host.clientHeight, 240);
        const finalParagraph = this.options.program.paragraphs.at(-1);
        const creditsFrame = resolveSonnetCreditsFrame(
            time,
            finalParagraph?.endTime ?? Number.POSITIVE_INFINITY,
        );
        const hasCredits = this.creditsContainer.children.length > 0;

        this.sceneCache.forEach((scene, index) => {
            const isActive = index === paragraphIndex;

            // Strict visibility: only the active scene is ever drawn. Zero overlap between scenes.
            scene.container.visible = isActive;
            if (!isActive) {
                const previousShot = scene.shots[scene.activeShotIndex];
                if (previousShot) unloadSonnetDisplayTree(previousShot.container);
                scene.activeShotIndex = -1;
                return;
            }

            const transition = resolveTransitionFrame(scene.paragraph, time);

            // Strictly determine the single active shot within this scene to avoid intra-scene residues
            let activeShotIndex = 0;
            for (let i = scene.shots.length - 1; i >= 0; i--) {
                if (time >= scene.shots[i].shot.startTime) {
                    activeShotIndex = i;
                    break;
                }
            }

            const visibleShotIndex = activeShotIndex;
            scene.shots.forEach((shot, shotIndex) => {
                const isShotActive = shotIndex === visibleShotIndex;
                shot.container.visible = isShotActive;
                if (!isShotActive) return;
                this.updateShot(shot, time, width, height, transition.shakeIntensity);
            });
            if (scene.activeShotIndex !== visibleShotIndex) {
                const previousShot = scene.shots[scene.activeShotIndex];
                if (previousShot) unloadSonnetDisplayTree(previousShot.container);
                scene.activeShotIndex = visibleShotIndex;
            }

            // If this is the active scene, we simulate an 'entrance' by reversing the previous scene's transition
            let enterX = 0, enterY = 0, enterScale = 1, enterRotation = 0, enterAlpha = 1;
            if (isActive && index > 0) {
                const prevScene = this.sceneCache.get(index - 1);
                if (prevScene && prevScene.paragraph.transitionOut) {
                    const prevT = prevScene.paragraph.transitionOut;
                    if (time >= prevT.startTime && time <= prevT.endTime + 0.1) {
                        const inProgress = clamp01((time - prevT.startTime) / Math.max(0.001, prevT.endTime - prevT.startTime));
                        const easedIn = easeSonnetInOut(inProgress);

                        // Counter-animate against the previous scene's exit direction
                        const tFrame = resolveTransitionFrame(prevScene.paragraph, prevT.startTime + (prevT.endTime - prevT.startTime) * 0.99);
                        enterX = -tFrame.x * (1 - easedIn) * 0.5;
                        enterY = -tFrame.y * (1 - easedIn) * 0.5;
                        enterScale = 1 + (1 - easedIn) * 0.15;
                        enterAlpha = easedIn;
                    }
                }
            }

            const isFinalScene = index === this.options.program.paragraphs.length - 1;
            const lyricAlpha = isFinalScene && hasCredits ? creditsFrame.lyricAlpha : 1;
            scene.container.alpha = (isActive ? enterAlpha : transition.alpha) * lyricAlpha;
            scene.container.pivot.set(width / 2, height / 2);

            const finalX = isActive ? enterX : transition.x;
            const finalY = isActive ? enterY : transition.y;
            const finalScale = isActive ? enterScale : transition.scale;
            const finalRotation = isActive ? enterRotation : transition.rotation;

            scene.container.position.set(width / 2 + finalX * width, height / 2 + finalY * height);
            scene.container.scale.set(finalScale);
            scene.container.rotation = finalRotation;

            if (isFinalScene && hasCredits) {
                this.updateOutroBlur(scene, creditsFrame.lyricBlur);
            }
        });

        if (!creditsFrame.active || !hasCredits) this.clearOutroBlur();
        this.creditsContainer.visible = creditsFrame.active && hasCredits;
        this.creditsContainer.alpha = creditsFrame.posterAlpha;
        this.creditsContainer.position.set(
            width / 2,
            height / 2 + creditsFrame.posterOffsetY * height,
        );
        this.creditsContainer.scale.set(creditsFrame.posterScale);
    };

    renderOnce() {
        if (this.destroyed || !this.app.canvas.isConnected) return;
        this.renderFrame();
        if (this.destroyed) return;
        this.app.renderer.render(this.app.stage);
    }

    setPaused(paused: boolean) {
        if (this.destroyed) return;
        this.options.paused = paused;
        if (paused) {
            this.app.stop();
            this.renderOnce();
        } else {
            this.app.start();
        }
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.app.stop();
        this.app.ticker.remove(this.renderFrame);
        this.clearScenes();
        destroySonnetContainerChildren(this.creditsContainer);
        this.iconTextures.clear();
        const texturePool = getSonnetTexturePool(this.pixi);
        this.iconUrls.forEach(url => {
            texturePool.release(url);
        });
        this.iconUrls.clear();
        this.app.destroy({ removeView: true }, { children: true, texture: true });
    }
}
