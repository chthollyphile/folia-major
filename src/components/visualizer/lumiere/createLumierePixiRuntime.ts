// Copyright (c) 2026 chthollyphile
import type { MotionValue } from 'framer-motion';
import type { Filter } from 'pixi.js';
import type { AudioBands, LumiereTuning, LyricRenderScale, Theme } from '../../../types';
import { PixiSceneCache } from '../pixiSceneCache';
import { loadPixi } from '../pixi/loadPixi';
import { linkPixiPrograms } from '../pixi/pixiProgramLinks';
import { makePixiContext } from '../pixi/pixiWebGLContext';
import { createLumiereAudioSampler, type LumiereAudioSampler } from './lumiereAudio';
import { findLumiereParagraphIndexAtTime, type LumiereProgram } from './lumiereProgram';
import {
    resolveLumiereBloomLevelDrop,
    resolveLumiereGraphicsResolution,
    resolveLumiereScaledRenderResolution,
    requiresLumiereSceneRebuild,
    toLumiereSceneTuning,
} from './lumiereRuntimeTuning';
import { resolveLumiereSceneFrames } from './lumiereSceneFrames';
import {
    applyLumiereLayerFrame,
    applyLumiereSceneQuality,
    buildLumiereSceneEntry,
    destroyLumiereSceneEntry,
    type LumiereSceneEntry,
    type LumiereSceneQuality,
} from './lumiereSceneEntry';
import { LumiereCreditsLayer } from './lumiereCreditsLayer';
import { LumiereDarkFieldLayer } from './lumiereDarkField';
import { PixiSongSwap } from '../pixiSongSwap';
import { buildLumiereOverlay } from './overlay';
import { createLightSprites, type LightSprites } from './light/sprites';
import type { LumiereSceneTuning } from './types';

// src/components/visualizer/lumiere/createLumierePixiRuntime.ts
// 绘光的 Pixi 运行时：建一次，换歌就地交接（pixiRuntimeHost.ts）。每帧只读 currentTime 这个 MotionValue，
// 按 lumiereSceneFrames 决定画哪几个段落场景，场景缓存当前段 ±1（同 tempera），一帧最多做一件贵的事
// （建一个场景 / 建片尾卡 / 销毁一个被换下的场景）。帧率跟随全局限帧（Pixi ticker 走被 frameRateLimiter
// 接管的 requestAnimationFrame）。只支持 WebGL：光场、bloom 都是 GLSL。
// 分辨率与抗锯齿（#929）：外壳把合出来的倍数与抗锯齿传进来；倍数就地改（同窗口缩放：渲染器立刻跟上，场景防抖重建），
// 抗锯齿只能建上下文时定，变了由外壳重建运行时。
type PixiModule = typeof import('pixi.js');

export interface LumiereSongMetadata {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
}

/** 一首歌的全部输入；identity 变了就交给 swapSong。 */
export interface LumiereSongContext {
    /** 曲目身份；只有它变了才是真正的换歌，其余字段变（主题、歌词晚到）直接替换。 */
    seed: string | number | undefined;
    program: LumiereProgram;
    theme: Theme;
}

export interface LumiereRuntimeOptions {
    host: HTMLDivElement;
    song: LumiereSongContext;
    tuning: LumiereTuning;
    currentTime: MotionValue<number>;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    staticMode: boolean;
    showText: boolean;
    paused: boolean;
    metadata: LumiereSongMetadata;
    /** 分辨率倍数（乘在 resolveLumiereRenderResolution 上，画质档再从乘过的分辨率降图形组）；预览传 1。 */
    renderScale: LyricRenderScale;
    /** MSAA：建上下文时定，原来写死关着。 */
    antialias: boolean;
    signal?: AbortSignal;
}

/** 场景要重建时等多久（滑块拖动、窗口拖拽缩放时不每帧重建）。 */
const REBUILD_DEBOUNCE_MS = 220;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

export class LumierePixiRuntime {
    /** 换歌时换下来的场景进缓存的 retired 队列，之后一帧销毁一个，免得交接那一帧卡住。 */
    private readonly sceneCache = new PixiSceneCache<LumiereSceneEntry>({
        count: () => this.options.song.program.paragraphs.length,
        build: index => {
            const entry = this.buildEntry(this.options.song, index);
            this.sceneLayer.addChild(entry.holder);
            return entry;
        },
        destroy: entry => this.destroyEntry(entry),
        detach: entry => entry.holder.parent?.removeChild(entry.holder),
    });
    private activeIndex = -1;
    private destroyed = false;
    private resizeObserver: ResizeObserver | null = null;
    private width = 0;
    private height = 0;
    private renderResolution = 1;
    private readonly quality: LumiereSceneQuality = {
        bloom: 1, textBloom: 1, graphicsResolution: null, bloomLevelDrop: 0, passthrough: null,
    };
    /** 所有场景共用、就地修改的场景 tuning：每帧现读的字段改了立刻生效（见 LUMIERE_LIVE_SCENE_KEYS）。 */
    private readonly sceneTuning: LumiereSceneTuning;
    private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
    private rebuildDue = false;
    private readonly songSwap = new PixiSongSwap<LumiereSongContext, LumiereSceneEntry>({
        stage: song => this.stageSong(song),
        commit: (song, staged) => this.commitSong(song, staged),
        discard: entry => this.destroyEntry(entry),
    });
    private readonly audio: LumiereAudioSampler;
    private readonly audioAt = () => this.audio.frame;

    /** 暗场底：在所有场景与片尾卡之下，不随段落转场变（见 lumiereDarkField.ts）。 */
    private darkField!: LumiereDarkFieldLayer;
    private sceneLayer!: import('pixi.js').Container;
    private overlayLayer!: import('pixi.js').Container;
    private credits!: LumiereCreditsLayer;
    private sprites!: LightSprites;
    private passthrough!: Filter;

    private constructor(
        private readonly pixi: PixiModule,
        private readonly options: LumiereRuntimeOptions,
        private readonly app: import('pixi.js').Application,
    ) {
        this.sceneTuning = toLumiereSceneTuning(options.tuning, { showText: options.showText });
        this.audio = createLumiereAudioSampler({ audioPower: options.audioPower, audioBands: options.audioBands });
    }

    static async create(options: LumiereRuntimeOptions) {
        const pixi = await loadPixi();
        // WebGL 上下文按这几项先建好，再交给 Pixi（makePixiContext）。
        const contextOptions = {
            // 画布透明：folia 的共享背景层要透出来，由运行时的暗场层按暗场强度压暗。
            backgroundAlpha: 0,
            // 大头（图形组）画进 filter 纹理，MSAA 管不到；只剩画框细线，不值得整屏多重采样的解析开销。
            // 所以默认关；用户在「抗锯齿」里选了开才开。
            antialias: options.antialias,
            powerPreference: 'high-performance',
        } as const;
        const context = await makePixiContext(pixi, contextOptions, options.signal);
        const app = new pixi.Application();
        const width = Math.max(options.host.clientWidth, MIN_WIDTH);
        const height = Math.max(options.host.clientHeight, MIN_HEIGHT);
        const resolution = resolveLumiereScaledRenderResolution(window.devicePixelRatio, options.renderScale);
        await app.init({
            width,
            height,
            ...contextOptions,
            ...context,
            autoDensity: true,
            resolution,
            autoStart: false,
            sharedTicker: false,
            preference: 'webgl',
        });
        if (app.renderer.type !== pixi.RendererType.WEBGL) {
            app.destroy({ removeView: true });
            throw new Error('Lumiere requires WebGL');
        }
        const runtime = new LumierePixiRuntime(pixi, options, app);
        runtime.renderResolution = resolution;
        runtime.sprites = createLightSprites(pixi);
        runtime.passthrough = new pixi.AlphaFilter({ alpha: 1 });
        runtime.quality.passthrough = runtime.passthrough;
        runtime.darkField = new LumiereDarkFieldLayer(pixi);
        runtime.sceneLayer = new pixi.Container();
        // 交叉渐变时两个段落场景叠放，按段落顺序排。
        runtime.sceneLayer.sortableChildren = true;
        runtime.overlayLayer = new pixi.Container();
        runtime.credits = new LumiereCreditsLayer(pixi, runtime.sprites);
        app.stage.addChild(runtime.darkField.view, runtime.sceneLayer, runtime.credits.holder, runtime.overlayLayer);

        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Lumiere runtime creation was cancelled', 'AbortError');
        }
        await runtime.install();
        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Lumiere runtime creation was cancelled', 'AbortError');
        }
        return runtime;
    }

    /**
     * 第一帧分几步做，步与步之间页面照常跑：建 WebGL 上下文之后另起一个任务建第一个场景，它的着色器程序
     * 在页面照常跑时链接（linkPixiPrograms），之后画布才放上页面、画出来。中途取消就提前返回。
     */
    private async install() {
        await new Promise((resolve) => { window.setTimeout(resolve); });
        if (this.options.signal?.aborted) return;
        this.resizeToHost(true);
        this.renderFrame();
        await linkPixiPrograms(this.pixi, this.app.renderer, this.app.stage, 'Lumiere', this.options.signal);
        if (this.options.signal?.aborted) return;
        this.options.host.appendChild(this.app.canvas);
        this.app.canvas.style.cssText = 'width:100%;height:100%;display:block';
        this.app.ticker.add(this.renderFrame);
        this.resizeObserver = new ResizeObserver(() => {
            if (this.destroyed || !this.resizeToHost(false)) return;
            if (this.options.paused) this.renderOnce();
        });
        this.resizeObserver.observe(this.options.host);
        this.app.renderer.render(this.app.stage);
        if (!this.options.paused) this.app.start();
    }

    /** 尺寸没变返回 false。渲染器立刻跟上，场景（尺寸烘焙在里面）防抖重建。 */
    private resizeToHost(immediate: boolean) {
        if (this.destroyed) return false;
        const width = Math.max(this.options.host.clientWidth, MIN_WIDTH);
        const height = Math.max(this.options.host.clientHeight, MIN_HEIGHT);
        const resolution = resolveLumiereScaledRenderResolution(window.devicePixelRatio, this.options.renderScale);
        if (width === this.width && height === this.height && resolution === this.renderResolution) return false;
        this.width = width;
        this.height = height;
        this.renderResolution = resolution;
        this.app.renderer.resize(width, height, resolution);
        this.refreshQuality();
        this.drawOverlay();
        if (immediate) this.rebuildDue = true;
        else this.scheduleRebuild();
        return true;
    }

    /** 画质档 + 视口 → 图形组分辨率与 bloom 减级，写到所有现存场景与片尾卡上。 */
    private refreshQuality() {
        const graphicsResolution = resolveLumiereGraphicsResolution(
            this.width, this.height, this.renderResolution, this.options.tuning.renderQuality,
        );
        this.quality.bloom = this.sceneTuning.bloom;
        this.quality.textBloom = this.sceneTuning.textBloom;
        this.quality.graphicsResolution = graphicsResolution < this.renderResolution ? graphicsResolution : null;
        this.quality.bloomLevelDrop = resolveLumiereBloomLevelDrop(this.renderResolution, graphicsResolution);
        this.sceneCache.forEach(entry => applyLumiereSceneQuality(entry.unit.scene, this.quality));
        if (this.songSwap.staged) applyLumiereSceneQuality(this.songSwap.staged.unit.scene, this.quality);
        this.credits.applyQuality(this.quality);
    }

    private scheduleRebuild() {
        if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = setTimeout(() => {
            this.rebuildTimer = null;
            if (this.destroyed) return;
            this.rebuildDue = true;
            if (this.options.paused) this.renderOnce();
        }, REBUILD_DEBOUNCE_MS);
    }

    private drawOverlay() {
        // 画框是自建 context 的 Graphics，带 context: true 才会连 GPU 批数据一起放掉（见 lineArt 的 destroy）。
        this.overlayLayer.removeChildren().forEach(child => child.destroy({ children: true, context: true }));
        // 仅显示歌词文字时画框也是装饰，不画。
        if (!this.options.tuning.overlayFrame || this.options.tuning.textOnly || this.width === 0) return;
        this.overlayLayer.addChild(buildLumiereOverlay(this.pixi, {
            width: this.width,
            height: this.height,
            theme: this.options.song.theme,
            themeColorMix: this.options.tuning.themeColorMix,
        }));
    }

    private buildEntry(song: LumiereSongContext, index: number) {
        return buildLumiereSceneEntry(this.pixi, {
            width: this.width,
            height: this.height,
            resolution: this.renderResolution,
            program: song.program,
            theme: song.theme,
            tuning: this.sceneTuning,
            sprites: this.sprites,
            audioAt: this.audioAt,
            showText: this.options.showText,
            quality: this.quality,
        }, index);
    }

    private destroyEntry(entry: LumiereSceneEntry) {
        destroyLumiereSceneEntry(entry, this.passthrough);
    }

    private clearScenes() {
        this.sceneCache.clear();
        this.activeIndex = -1;
    }

    private renderFrame = () => {
        if (this.destroyed) return;
        const time = this.options.currentTime.get();
        this.audio.sample(performance.now(), this.options.paused);
        this.songSwap.advance();
        if (this.rebuildDue) {
            this.rebuildDue = false;
            this.songSwap.dropStaged();
            this.clearScenes();
            this.credits.invalidate();
        }
        const { program, theme } = this.options.song;
        // 暗场强度每帧从共享 tuning 现读：拖滑块不重建场景；场景还没建好的第一帧也已经铺上。
        this.darkField.update(theme, this.sceneTuning.darkField, this.width, this.height);
        const frames = resolveLumiereSceneFrames(program, time, !this.options.staticMode);
        let builtThisFrame = false;
        if (frames.activeIndex !== this.activeIndex) {
            this.activeIndex = frames.activeIndex;
            this.sceneCache.prune(frames.activeIndex, new Set(frames.layers.map(layer => layer.index)));
        }
        frames.layers.forEach(layer => {
            if (!this.sceneCache.has(layer.index)) {
                this.sceneCache.ensure(layer.index);
                builtThisFrame = true;
            }
        });

        const creditsFrame = this.credits.resolveFrame(time, program, this.options.metadata);
        if (!builtThisFrame && !this.songSwap.active) {
            // 一帧只做一件贵的事，按优先级：释放换下的场景 → 预建下一段 → 片尾卡 → 预建上一段。
            const next = frames.activeIndex + 1;
            const previous = frames.activeIndex - 1;
            if (this.sceneCache.hasRetired) {
                this.sceneCache.drainRetired();
            } else if (next < program.paragraphs.length && !this.sceneCache.has(next)) {
                this.sceneCache.ensure(next);
            } else if (this.credits.needsBuild(time, program, this.options.metadata)) {
                this.credits.build(this.creditBuildContext(theme));
            } else if (previous >= 0 && !this.sceneCache.has(previous)) {
                this.sceneCache.ensure(previous);
            }
        }
        if (creditsFrame.active && !this.credits.built && this.credits.hasMetadata(this.options.metadata)) {
            this.credits.build(this.creditBuildContext(theme));
        }

        const lyricAlpha = creditsFrame.active ? creditsFrame.lyricAlpha : 1;
        const lyricBlur = creditsFrame.active ? creditsFrame.lyricBlur : 0;
        const blurResolution = this.renderResolution * 0.5;
        this.sceneCache.forEach((entry, index) => {
            // 同时在画的段落最多两三个，直接找，不必每帧建一张表。
            const layer = frames.layers.find(candidate => candidate.index === index);
            const alpha = (layer?.alpha ?? 0) * lyricAlpha;
            entry.holder.visible = alpha > 0.002;
            if (!entry.holder.visible || !layer) return;
            entry.unit.update(time);
            applyLumiereLayerFrame(this.pixi, entry, {
                alpha,
                scale: layer.scale,
                blur: Math.max(layer.blur, lyricBlur),
            }, blurResolution);
        });
        this.credits.update(time, creditsFrame, this.width, this.height);
    };

    private creditBuildContext(theme: Theme) {
        return {
            width: this.width,
            height: this.height,
            resolution: this.renderResolution,
            theme,
            metadata: this.options.metadata,
            tuning: this.sceneTuning,
            quality: this.quality,
        };
    }

    renderOnce() {
        if (this.destroyed || !this.app.canvas.isConnected) return;
        this.renderFrame();
        if (this.destroyed) return;
        this.app.renderer.render(this.app.stage);
    }

    /**
     * 换歌：新歌当前段落的场景在第一帧建好（旧歌还在画），第二帧切过去；换下的场景之后一帧销毁一个。
     * 不是真正的换歌（同一个 seed：主题改了、歌词晚到）、暂停中、还没有画面时直接替换。
     */
    swapSong(next: LumiereSongContext, signal?: AbortSignal): Promise<void> {
        if (this.destroyed) return Promise.resolve();
        if (
            next.seed === this.options.song.seed
            || this.songSwap.active
            || this.width === 0
            || this.sceneCache.size === 0
            || this.options.paused
            || signal?.aborted
        ) {
            this.commitSong(next, null);
            if (this.options.paused) this.renderOnce();
            return Promise.resolve();
        }
        return this.songSwap.begin(next, signal);
    }

    /** 交接的第一帧：离屏建好新歌当前段落的场景（不进缓存，旧歌的场景被换下时它不受影响）。 */
    private stageSong(song: LumiereSongContext) {
        const index = findLumiereParagraphIndexAtTime(song.program, this.options.currentTime.get());
        if (index < 0 || index >= song.program.paragraphs.length) return null;
        const entry = this.buildEntry(song, index);
        entry.holder.visible = false;
        this.sceneLayer.addChild(entry.holder);
        return entry;
    }

    private commitSong(next: LumiereSongContext, staged: LumiereSceneEntry | null) {
        const themeChanged = next.theme !== this.options.song.theme;
        this.options.song = next;
        if (staged) {
            this.sceneCache.retireAll();
            this.sceneCache.adopt(staged.index, staged);
            this.activeIndex = staged.index;
        } else {
            this.clearScenes();
        }
        this.credits.invalidate();
        if (themeChanged) this.drawOverlay();
    }

    /** 就地应用 tuning：每帧现读的字段直接改，bloom 强度写进 filter，烘焙进场景的字段防抖重建。 */
    setTuning(tuning: LumiereTuning) {
        if (this.destroyed || tuning === this.options.tuning) return;
        const previousTuning = this.options.tuning;
        this.options.tuning = tuning;
        this.applySceneTuning();
        if (
            previousTuning.overlayFrame !== tuning.overlayFrame
            || previousTuning.textOnly !== tuning.textOnly
            || previousTuning.themeColorMix !== tuning.themeColorMix
        ) this.drawOverlay();
        if (this.options.paused) this.renderOnce();
    }

    /** 就地换分辨率倍数：同窗口缩放，渲染器立刻跟上，图形组画质随之重算，场景（字按分辨率光栅化）防抖重建。 */
    setRenderScale(scale: LyricRenderScale) {
        if (this.destroyed || scale === this.options.renderScale) return;
        this.options.renderScale = scale;
        // 还没装好（第一帧前）时 install 里的 resizeToHost 会按新倍数来。
        if (this.width === 0) return;
        if (this.resizeToHost(false) && this.options.paused) this.renderOnce();
    }

    setShowText(showText: boolean) {
        if (this.destroyed || showText === this.options.showText) return;
        this.options.showText = showText;
        this.sceneCache.forEach(entry => {
            entry.unit.scene.text.visible = showText;
        });
        if (this.songSwap.staged) this.songSwap.staged.unit.scene.text.visible = showText;
        this.applySceneTuning();
        if (this.options.paused) this.renderOnce();
    }

    private applySceneTuning() {
        const previous = { ...this.sceneTuning };
        const next = toLumiereSceneTuning(this.options.tuning, { showText: this.options.showText });
        Object.assign(this.sceneTuning, next);
        this.refreshQuality();
        if (requiresLumiereSceneRebuild(previous, next)) this.scheduleRebuild();
    }

    setStaticMode(staticMode: boolean) {
        if (this.destroyed || staticMode === this.options.staticMode) return;
        this.options.staticMode = staticMode;
        if (this.options.paused) this.renderOnce();
    }

    setAudioSources(audioPower: MotionValue<number>, audioBands: AudioBands) {
        this.audio.setSources({ audioPower, audioBands });
    }

    setSongMetadata(metadata: LumiereSongMetadata) {
        if (this.destroyed) return;
        const current = this.options.metadata;
        if (current.title === metadata.title && current.artist === metadata.artist && current.album === metadata.album) return;
        this.options.metadata = { ...metadata };
        this.credits.invalidate();
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
        // 先放掉等交接的人，否则 pixiRuntimeHost 的 drain 循环会一直停在这个 promise 上。
        this.songSwap.settle(false);
        if (this.rebuildTimer !== null) clearTimeout(this.rebuildTimer);
        this.rebuildTimer = null;
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.app.stop();
        this.app.ticker.remove(this.renderFrame);
        this.sceneCache.destroyAll();
        this.credits?.destroy();
        this.darkField?.destroy();
        this.overlayLayer?.removeChildren().forEach(child => child.destroy({ children: true, context: true }));
        // 光点纹理与直通 filter 由运行时持有，场景与片尾卡都已销毁，这里最后释放。
        this.sprites?.destroy();
        this.passthrough?.destroy();
        this.app.destroy({ removeView: true }, { children: true });
    }
}
