import type { MotionValue } from 'framer-motion';
import type { AudioBands, SonnetTuning, Theme } from '../../../types';
import type { SonnetProgram } from './types';
import { findSonnetParagraphIndexAtTime } from './sonnetProgram';
import { buildSonnetScene, type SceneView } from './sonnetSceneBuilder';
import { snapResolutionToTexturePool } from '../pixiTextureBudget';
import {
    destroySonnetContainerChildren,
    destroySonnetDisplayTree,
    unloadSonnetDisplayTree,
} from './sonnetPixiResources';
import {
    buildSonnetCreditsPoster,
    hasSonnetCreditsMetadata,
    resolveSonnetCreditsFrame,
} from './sonnetCredits';
import { loadPixi } from '../loadPixi';
import { PixiSceneCache } from '../pixiSceneCache';
import { sonnetDebugState } from './sonnetDebug';
import { createSonnetBeatFxReader } from './sonnetBeatFx';
import { readSonnetModulation, type SonnetShotFrameContext, updateSonnetShot } from './sonnetShotFrame';
import { findSonnetActiveShotIndex, resolveSonnetSceneTransitionFrame } from './sonnetSceneFrame';
import { drawSonnetFrameOverlay } from './sonnetFrameOverlay';
import { SonnetOutroBlur } from './sonnetOutroBlur';
import {
    loadSonnetIconTextures,
    releaseSonnetIconUrls,
    type SonnetIconTextures,
} from './sonnetIconTextures';

// src/components/visualizer/sonnet/createSonnetPixiRuntime.ts
// Owns Pixi lifecycle and mutates bounded scene views directly from absolute playback time.
// shot 逐帧姿态、场景转场选择、画框、片尾模糊与主题图标纹理在相邻模块；这里只管生命周期、
// 段落场景缓存、换歌溶解和每帧调度。
type PixiModule = typeof import('pixi.js');

export interface SonnetSongMetadata {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
}

/**
 * Everything about the runtime that belongs to one track. Swapped in place rather than rebuilt -
 * see `swapSong`.
 */
export interface SonnetSongContext {
    /**
     * Track identity. Only a change here is a real song change; the rest of this object also
     * moves when the theme is edited or lyrics are hidden, and those must swap silently rather
     * than play a dissolve.
     */
    seed: string | number | undefined;
    program: SonnetProgram;
    theme: Theme;
}

/** Length of the full dissolve: cover in, swap, cover out. */
export const SONNET_SONG_SWAP_MS = 560;

/**
 * How far into the dissolve the incoming scene is built. Late enough that the cover is already
 * most of the way opaque, early enough to leave headroom before the swap at the halfway point.
 */
const SONNET_SWAP_STAGE_PROGRESS = 0.35;

export interface SonnetRuntimeOptions {
    host: HTMLDivElement;
    /** Track identity of `program`; see SonnetSongContext.seed. */
    songSeed?: string | number;
    program: SonnetProgram;
    theme: Theme;
    tuning: SonnetTuning;
    /** 智能动感模式 (SmartBeatSettings.enabled); its strengths reach the frame through the beat clock. */
    smartBeatEnabled: boolean;
    currentTime: MotionValue<number>;
    audioPower?: MotionValue<number>;
    audioBands?: AudioBands;
    lyricsFontScale: number;
    staticMode: boolean;
    transparentBackground: boolean;
    paused: boolean;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    signal?: AbortSignal;
    /** Mod-driven per-frame multipliers (e.g. `{ cameraScale: 1.4 }`). Defaults to 1 = no change. */
    modulation?: Record<string, number>;
}

export class SonnetPixiRuntime {
    private readonly sceneCache = new PixiSceneCache<SceneView>({
        count: () => this.options.program.paragraphs.length,
        build: index => {
            const scene = this.buildScene(this.liveSong, this.iconTextures, index);
            this.sceneContainer.addChild(scene.container);
            return scene;
        },
        destroy: scene => this.destroyScene(scene),
    });
    private readonly iconTextures = new Map<string, import('pixi.js').Texture>();
    private readonly iconUrls = new Set<string>();
    private activeParagraphIndex = -1;
    private destroyed = false;
    /** 智能动感模式 frame reader; yields null unless it is on and the track's beats are installed. */
    private readonly readBeatFx = createSonnetBeatFxReader();
    /**
     * An in-flight song handover. Driven by the wall clock, unlike every other transition here:
     * those derive their progress from absolute playback time so a seek stays stable, but that
     * clock belongs to the outgoing track and says nothing about when this swap started.
     */
    private songSwap: {
        /** Cleared once committed; the rest of the dissolve is the uncover. */
        pending: SonnetSongContext | null;
        /** Already acquired for the incoming theme; adopted on commit, released if abandoned. */
        pendingIcons: SonnetIconTextures | null;
        /** The incoming scene, built under the cover before the commit needs it. */
        staged: { scene: SceneView; index: number } | null;
        startedAt: number;
        settle: () => void;
        /** Drops the abort listener, so a long skip session cannot pile them up on one signal. */
        detachAbort: () => void;
    } | null = null;
    private swapCover: import('pixi.js').Graphics | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private lastWidth = 0;
    private lastHeight = 0;

    private sceneContainer!: import('pixi.js').Container;
    private creditsContainer!: import('pixi.js').Container;
    private overlayContainer!: import('pixi.js').Container;
    private outroBlur!: SonnetOutroBlur;

    private constructor(
        private readonly pixi: PixiModule,
        private readonly options: SonnetRuntimeOptions,
        private readonly app: import('pixi.js').Application,
    ) { }

    static async create(options: SonnetRuntimeOptions) {
        const pixi = await loadPixi();
        const app = new pixi.Application();
        const width = Math.max(options.host.clientWidth, 320);
        const height = Math.max(options.host.clientHeight, 240);
        await app.init({
            width,
            height,
            backgroundAlpha: 0,
            antialias: true,
            autoDensity: true,
            resolution: snapResolutionToTexturePool(width, height, options.tuning.textureResolution),
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
            powerPreference: 'high-performance',
        });
        const runtime = new SonnetPixiRuntime(pixi, options, app);
        runtime.sceneContainer = new pixi.Container();
        runtime.creditsContainer = new pixi.Container();
        runtime.overlayContainer = new pixi.Container();
        runtime.outroBlur = new SonnetOutroBlur(pixi);
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
        // The texture-pool snap depends on the viewport, so a resize can move the pooled filter
        // targets across a bucket boundary even though the setting never changed. Sonnet's own
        // passes carry fixed resolutions, so only the canvas has to follow.
        this.app.renderer.resize(
            width,
            height,
            snapResolutionToTexturePool(width, height, this.options.tuning.textureResolution),
        );
        // Staged against the old viewport, so its layout no longer fits.
        if (this.songSwap?.staged) {
            this.destroyScene(this.songSwap.staged.scene);
            this.songSwap.staged = null;
        }
        this.clearScenes();
        this.drawCredits(width, height);
        this.drawOverlay(width, height);
        return true;
    }

    private drawCredits(width: number, height: number) {
        destroySonnetContainerChildren(this.creditsContainer);
        if (this.options.tuning.showOnlyText) return;
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

    private drawOverlay(width: number, height: number) {
        drawSonnetFrameOverlay(this.pixi, this.overlayContainer, width, height, this.options.tuning, this.options.theme);
    }

    private async loadIconTextures(theme: Theme): Promise<SonnetIconTextures> {
        return loadSonnetIconTextures(this.pixi, theme, this.options.tuning);
    }

    private releaseIconUrls(urls: Set<string>) {
        releaseSonnetIconUrls(this.pixi, urls);
    }

    private async preloadIcons() {
        const loaded = await this.loadIconTextures(this.options.theme);
        loaded.textures.forEach((texture, key) => this.iconTextures.set(key, texture));
        loaded.urls.forEach(url => this.iconUrls.add(url));
    }

    private clearScenes() {
        this.outroBlur.clear();
        this.sceneCache.clear();
        this.activeParagraphIndex = -1;
    }
    private destroyScene(scene: SceneView) {
        if (this.outroBlur.isOn(scene)) this.outroBlur.clear();
        this.sceneContainer.removeChild(scene.container);
        unloadSonnetDisplayTree(scene.container);
        scene.container.filters = null;
        scene.shots.forEach(shot => {
            shot.haloLayer.filters = null;
        });
        scene.postProcessFilters.forEach(filter => filter.destroy());
        // 逐节点销毁：destroy({ children: true }) 会留下每个 Graphics 自建的 GraphicsContext 与它的 GPU 缓冲。
        destroySonnetDisplayTree(scene.container);
    }

    /**
     * Builds one paragraph scene. This is the expensive call in the whole runtime: it runs the
     * typography layout over every grapheme and then creates a `pixi.Text` per glyph. Nothing
     * here should ever run more than once per frame.
     */
    private buildScene(
        song: SonnetSongContext,
        iconTextures: Map<string, import('pixi.js').Texture>,
        index: number,
    ) {
        return buildSonnetScene(this.pixi, {
            programSeed: song.program.seed,
            host: this.options.host,
            theme: song.theme,
            tuning: this.options.tuning,
            smartBeatEnabled: this.options.smartBeatEnabled,
            lyricsFontScale: this.options.lyricsFontScale,
            staticMode: this.options.staticMode,
            transparentBackground: this.options.transparentBackground,
        }, iconTextures, song.program.paragraphs[index]);
    }

    /** The live song as a context, for building scenes against what is currently on screen. */
    private get liveSong(): SonnetSongContext {
        return {
            seed: this.options.songSeed,
            program: this.options.program,
            theme: this.options.theme,
        };
    }

    private renderFrame = () => {
        if (this.destroyed) return;
        // Advanced before the paragraph lookup so a commit lands on this frame's scene selection
        // instead of leaving one frame of the outgoing program on the incoming one.
        this.advanceSongSwap();
        if (this.options.program.paragraphs.length === 0) {
            sonnetDebugState.activeShot = null;
            sonnetDebugState.paragraphIndex = -1;
            return;
        }
        const time = this.options.currentTime.get();
        const paragraphIndex = findSonnetParagraphIndexAtTime(this.options.program, time);
        if (paragraphIndex !== this.activeParagraphIndex) {
            this.activeParagraphIndex = paragraphIndex;
            this.sceneCache.ensure(paragraphIndex);
            this.sceneCache.prune(paragraphIndex);
        } else if (!this.songSwap) {
            // Neighbours are pre-rolls for a boundary that is still ahead, so at most one is built
            // per frame rather than piling three onto the frame that just changed paragraph.
            // A scene build runs the layout over every grapheme and creates a pixi.Text per glyph;
            // three at once is a dropped frame.
            const next = paragraphIndex + 1;
            const previous = paragraphIndex - 1;
            if (next < this.options.program.paragraphs.length && !this.sceneCache.has(next)) {
                this.sceneCache.ensure(next);
            } else if (previous >= 0 && !this.sceneCache.has(previous)) {
                this.sceneCache.ensure(previous);
            }
        }
        // The size the renderer was last fitted to. Reading the host here instead would force a
        // synchronous layout every frame, and the ResizeObserver refits both together anyway.
        const width = this.lastWidth;
        const height = this.lastHeight;
        const finalParagraph = this.options.program.paragraphs.at(-1);
        const creditsFrame = resolveSonnetCreditsFrame(
            time,
            finalParagraph?.endTime ?? Number.POSITIVE_INFINITY,
        );
        const hasCredits = this.creditsContainer.children.length > 0;
        // Read once per frame, before any shot, so every consumer sees the same envelopes.
        const beatFx = this.options.staticMode ? null : this.readBeatFx(this.options.audioBands, this.options.smartBeatEnabled);
        const shotFrameContext: SonnetShotFrameContext = {
            tuning: this.options.tuning,
            smartBeatEnabled: this.options.smartBeatEnabled,
            theme: this.options.theme,
            audioBands: this.options.audioBands,
            audioPower: this.options.audioPower,
            mod: this.mod,
            beatFx,
        };

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

            const transitionsEnabled = this.options.tuning.enableTransitions && !this.options.staticMode;
            const visibleShotIndex = findSonnetActiveShotIndex(scene, time);
            const transitionFrame = resolveSonnetSceneTransitionFrame(
                this.options.program,
                scene,
                index,
                visibleShotIndex,
                time,
                transitionsEnabled,
            );
            scene.shots.forEach((shot, shotIndex) => {
                const isShotActive = shotIndex === visibleShotIndex;
                shot.container.visible = isShotActive;
                if (!isShotActive) return;
                updateSonnetShot(shot, time, width, height, 0, shotFrameContext);
            });
            if (scene.activeShotIndex !== visibleShotIndex) {
                const previousShot = scene.shots[scene.activeShotIndex];
                if (previousShot) unloadSonnetDisplayTree(previousShot.container);
                scene.activeShotIndex = visibleShotIndex;
            }
            // Publish the active shot so the dev overlay's Sonnet tab can inspect it.
            sonnetDebugState.activeShot = scene.shots[visibleShotIndex]?.debugInfo ?? null;
            sonnetDebugState.paragraphIndex = index;

            const isFinalScene = index === this.options.program.paragraphs.length - 1;
            const lyricAlpha = isFinalScene && hasCredits ? creditsFrame.lyricAlpha : 1;
            const transitionMotionScale = this.mod('transitionMotionScale');
            const transitionBlurScale = this.mod('transitionBlurScale');
            const transitionGlitchScale = this.mod('transitionGlitchScale');
            scene.container.alpha = transitionFrame.alpha * lyricAlpha;
            scene.container.pivot.set(width / 2, height / 2);
            scene.container.position.set(
                width / 2 + transitionFrame.x * width * transitionMotionScale,
                height / 2 + transitionFrame.y * height * transitionMotionScale,
            );
            scene.container.scale.set(1 + (transitionFrame.scale - 1) * transitionMotionScale);
            scene.container.rotation = transitionFrame.rotation * transitionMotionScale;
            if (scene.transitionBlurFilter) {
                scene.transitionBlurFilter.strength = transitionFrame.blur * transitionBlurScale;
                scene.transitionBlurFilter.enabled = transitionFrame.blur > 0.01;
            }
            if (scene.transitionGlitchEffect) {
                const transitionGlitch = transitionFrame.glitch * transitionGlitchScale;
                // The downbeat tear shares this filter; the stronger of the two drives it.
                const beatTearWins = !!beatFx && beatFx.tear > transitionGlitch;
                const glitchAmount = beatTearWins ? beatFx!.tear : transitionGlitch;
                scene.transitionGlitchEffect.update(
                    glitchAmount,
                    beatTearWins ? beatFx!.tearSeed : transitionFrame.glitchSeed,
                );
                scene.transitionGlitchEffect.filter.enabled = beatTearWins
                    ? glitchAmount > 0.01
                    : transitionFrame.glitch > 0.01;
            }

            if (isFinalScene && hasCredits) {
                this.outroBlur.update(scene, creditsFrame.lyricBlur);
            }
        });

        if (!creditsFrame.active || !hasCredits) this.outroBlur.clear();
        this.creditsContainer.visible = creditsFrame.active && hasCredits && !this.options.tuning.showOnlyText;
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

    /**
     * Hands the renderer a new track without rebuilding it. A rebuild re-initialises WebGL and the
     * icon texture pool with the canvas out of the DOM, so the frame goes empty for the whole
     * async build. Here the incoming theme's icons are warmed while the outgoing song is still
     * rendering, and only the scene layer changes - under a cover, so the cut is never a hole.
     *
     * Resolves when the cover has faded back out.
     */
    async swapSong(next: SonnetSongContext, signal?: AbortSignal): Promise<void> {
        if (this.destroyed) return;
        // Nothing is on screen to protect: no scene has been sized yet, or the outgoing program
        // had no paragraphs at all. Covering an empty frame would only add a flash. And a swap
        // that is not a track change gets no dissolve at all - see SonnetSongContext.seed.
        const isCoverWorthwhile = next.seed !== this.options.songSeed
            && !this.songSwap
            && this.lastWidth > 0
            && this.options.program.paragraphs.length > 0
            && !signal?.aborted;

        // Warmed before the cover starts, so the dissolve is never waiting on a decode.
        const pendingIcons = await this.loadIconTextures(next.theme);
        if (this.destroyed || signal?.aborted) {
            this.releaseIconUrls(pendingIcons.urls);
            return;
        }
        if (!isCoverWorthwhile) {
            this.commitSongContext(next, pendingIcons);
            return;
        }

        await new Promise<void>(resolve => {
            const onAbort = () => this.settleSongSwap();
            this.songSwap = {
                pending: next,
                pendingIcons,
                staged: null,
                startedAt: performance.now(),
                settle: resolve,
                detachAbort: () => signal?.removeEventListener('abort', onAbort),
            };
            signal?.addEventListener('abort', onAbort, { once: true });
            // The ticker is stopped while paused, so the cover would freeze halfway. Run it for
            // the length of the dissolve and hand the pause back at the end.
            if (this.options.paused) this.app.start();
        });
    }

    /** The swap itself, at the instant the cover is opaque. */
    private commitSongContext(
        next: SonnetSongContext,
        icons: SonnetIconTextures,
        staged?: { scene: SceneView; index: number } | null,
    ) {
        this.options.songSeed = next.seed;
        this.options.program = next.program;
        this.options.theme = next.theme;
        // Acquire-then-release: a url both themes want keeps a live refcount throughout.
        this.releaseIconUrls(this.iconUrls);
        this.iconTextures.clear();
        icons.textures.forEach((texture, key) => this.iconTextures.set(key, texture));
        icons.urls.forEach(url => this.iconUrls.add(url));
        // clearScenes only walks the cache, and a staged scene is deliberately not in it yet, so
        // it survives the teardown of the song it is replacing.
        this.clearScenes();
        if (staged) {
            staged.scene.container.visible = true;
            this.sceneCache.adopt(staged.index, staged.scene);
            // Adopted as the active paragraph so the frame that commits builds nothing at all.
            this.activeParagraphIndex = staged.index;
        }
        if (this.lastWidth > 0 && this.lastHeight > 0) {
            this.drawCredits(this.lastWidth, this.lastHeight);
            this.drawOverlay(this.lastWidth, this.lastHeight);
        }
    }

    /** Finishes an in-flight handover immediately, committing whatever it was still holding. */
    private settleSongSwap() {
        const swap = this.songSwap;
        if (!swap) return;
        this.songSwap = null;
        swap.detachAbort();
        if (this.destroyed) {
            if (swap.pendingIcons) this.releaseIconUrls(swap.pendingIcons.urls);
            // Never adopted, so nothing else will ever free it.
            if (swap.staged) this.destroyScene(swap.staged.scene);
        } else {
            if (swap.pending && swap.pendingIcons) {
                this.commitSongContext(swap.pending, swap.pendingIcons, swap.staged);
            } else if (swap.staged) {
                this.destroyScene(swap.staged.scene);
            }
            if (this.options.paused) this.app.stop();
        }
        this.disposeSwapCover();
        swap.settle();
    }

    private disposeSwapCover() {
        if (!this.swapCover) return;
        this.app.stage.removeChild(this.swapCover);
        this.swapCover.destroy();
        this.swapCover = null;
    }

    /**
     * Advances the wall-clock dissolve by one frame. The cover is a plain full-bleed rect added
     * above every container - not a filter - so it cannot interact with the per-scene blur and
     * glitch filters, and the frame is never transparent at any point of the swap.
     */
    private advanceSongSwap() {
        const swap = this.songSwap;
        if (!swap) return;
        const progress = (performance.now() - swap.startedAt) / SONNET_SONG_SWAP_MS;
        if (swap.pending && swap.pendingIcons && !swap.staged && progress >= SONNET_SWAP_STAGE_PROGRESS) {
            // Built here, not at the commit: this is one scene's worth of layout and glyph
            // rasterisation, and the frame it costs is spent with the cover most of the way in
            // rather than on the frame the listener is looking at the new song on.
            const index = findSonnetParagraphIndexAtTime(
                swap.pending.program,
                this.options.currentTime.get(),
            );
            if (index >= 0 && index < swap.pending.program.paragraphs.length) {
                const scene = this.buildScene(swap.pending, swap.pendingIcons.textures, index);
                scene.container.visible = false;
                this.sceneContainer.addChild(scene.container);
                swap.staged = { scene, index };
            }
        }
        if (swap.pending && swap.pendingIcons && progress >= 0.5) {
            this.commitSongContext(swap.pending, swap.pendingIcons, swap.staged);
            swap.pending = null;
            swap.pendingIcons = null;
            swap.staged = null;
        }
        if (progress >= 1) {
            this.settleSongSwap();
            return;
        }

        if (!this.swapCover) {
            this.swapCover = new this.pixi.Graphics();
            // Added last, so it sits above the scene, credits and overlay containers.
            this.app.stage.addChild(this.swapCover);
        }
        const cover = this.swapCover;
        // 0 -> 1 -> 0 across the dissolve, opaque exactly where the commit lands.
        cover.alpha = 1 - Math.abs(progress * 2 - 1);
        cover.clear();
        cover
            .rect(0, 0, this.lastWidth, this.lastHeight)
            .fill({ color: this.pixi.Color.shared.setValue(this.options.theme.backgroundColor).toNumber() });
    }

    /** Reads a mod modulation key, falling back to 1 so the frame is unchanged when absent. */
    private readonly mod = (key: string): number => readSonnetModulation(this.options.modulation, key);

    /**
     * Applies a settings change to the live runtime. Every scene is rebuilt against the new
     * tuning, but the WebGL context, the canvas and the icon textures stay; the settings that
     * shape those (`textureResolution`, `showOnlyText`, `showBackgroundDecor`) are part of the
     * host's rebuild key instead.
     */
    setTuning(tuning: SonnetTuning) {
        if (this.destroyed || this.options.tuning === tuning) return;
        this.options.tuning = tuning;
        this.rebuildScenes();
    }

    /**
     * Switches 智能动感模式. Scenes are built with or without its MG onset pop and tear filter, so they
     * are rebuilt like a tuning change; the 轻拍 / 重拍 strengths never come here, the beat clock
     * applies them to the signals every frame.
     */
    setSmartBeatEnabled(enabled: boolean) {
        if (this.destroyed || this.options.smartBeatEnabled === enabled) return;
        this.options.smartBeatEnabled = enabled;
        this.rebuildScenes();
    }

    /** Rebuilds every scene against the current options on the live context. */
    private rebuildScenes() {
        // Staged against the old options, so it can no longer be adopted.
        if (this.songSwap?.staged) {
            this.destroyScene(this.songSwap.staged.scene);
            this.songSwap.staged = null;
        }
        this.clearScenes();
        // Before the first resize pass there is nothing sized to redraw; the install pass
        // draws both against real dimensions.
        if (this.lastWidth > 0 && this.lastHeight > 0) {
            this.drawCredits(this.lastWidth, this.lastHeight);
            this.drawOverlay(this.lastWidth, this.lastHeight);
        }
        if (this.options.paused) this.renderOnce();
    }

    /** Hot-swaps the modulation map every time a mod slider moves, without recreating the Pixi context. */
    setModulation(modulation: Record<string, number>) {
        if (this.destroyed) return;
        this.options.modulation = modulation;
        if (this.options.paused) this.renderOnce();
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
        sonnetDebugState.activeShot = null;
        sonnetDebugState.paragraphIndex = -1;
        // Release whoever is awaiting the handover before tearing the app down, otherwise that
        // promise never settles and the caller's drain loop stays parked on it.
        this.settleSongSwap();
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.app.stop();
        this.app.ticker.remove(this.renderFrame);
        this.clearScenes();
        destroySonnetContainerChildren(this.creditsContainer);
        this.iconTextures.clear();
        this.releaseIconUrls(this.iconUrls);
        this.app.destroy({ removeView: true }, { children: true, texture: true });
    }
}
