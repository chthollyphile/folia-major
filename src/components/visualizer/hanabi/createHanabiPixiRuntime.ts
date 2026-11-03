// Copyright (c) 2026 chthollyphile
import type { MotionValue } from 'framer-motion';
import type { Container } from 'pixi.js';
import type { LyricRenderScale, Theme } from '../../../types';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
import {
    getBeatEffectStrength,
    getBeatFxEvents,
    getBeatFxIntensities,
    getBeatFxRotationSign,
    getBeatFxTrackScale,
    isBeatFxReady,
} from '../../../services/beatFx/beatFxLive';
import { resolveLucideIconNames } from '../../../services/lucideIconResolver';
import { resolveLyricPixelRatio } from '../../../utils/lyricRenderQuality';
import { beatImpact, downbeatImpact } from '../../../stores/motionSignals';
import { loadPixi } from '../pixi/loadPixi';
import { linkPixiPrograms } from '../pixi/pixiProgramLinks';
import { makePixiContext } from '../pixi/pixiWebGLContext';
import { destroyPixiContainerChildren } from '../pixi/pixiDisplayResources';
import { PixiSceneCache } from '../pixiSceneCache';
import { PixiSongSwap } from '../pixiSongSwap';
import { HanabiCreditsLayer, type HanabiCreditsMetadata } from './hanabiCreditsLayer';
import { findHanabiParagraphIndexAtTime, type HanabiProgram } from './hanabiProgram';
import { applyHanabiLayerFrame, buildHanabiSceneEntry, destroyHanabiSceneEntry, hanabiSpinDirection, type HanabiSceneEntry } from './hanabiSceneEntry';
import { resolveHanabiSceneFrames } from './hanabiSceneFrames';
import { HanabiSkyLayer } from './hanabiSky';
import { changedHanabiKeys, HANABI_OVERLAY_KEYS, requiresHanabiSceneRebuild, resolveHanabiBaseResolution } from './hanabiTuning';
import { createBloomFilter, type BloomFilter } from '../pixi/bloomFilter';
import { rescaleBeatEnvelope, resolveHanabiBeatPulse } from './hanabiBeatFx';
import { resolveHanabiChorusWeight, resolveHanabiScreenBloomStrength } from './hanabiScreenBloom';
import { createHanabiTextures } from './mg/textures';
import { setHanabiGlyphTextureLimit } from './text/glyphs';
import type { HanabiBeatSource } from './scene';
import { buildHanabiOverlay } from './overlay';
import type { HanabiTextures, HanabiTuning, PixiModule } from './types';

// src/components/visualizer/hanabi/createHanabiPixiRuntime.ts
// 花火的 Pixi 运行时：建一次，换歌就地交接（pixiRuntimeHost.ts）。每帧只读 currentTime 这个 MotionValue，
// 按 hanabiSceneFrames 决定画哪几个段落场景，场景缓存当前段 ±1（同绘光），一帧最多做一件贵的事
// （建一个场景 / 备一个马上要出场的镜头 / 建片尾卡 / 销毁一个被换下的场景）。粒子纹理整个运行时共用（分辨率变了重画）。
// 层级：夜空底 → 段落场景 → 片尾卡 → 画框。
// 智能动感模式（hanabiBeatFx.ts）：节拍表装好、效果开着时，「随拍开花」把节拍表交给在画的场景，「随拍推镜」把拍的包络
// 套在整个场景层上（以画面中心推近、左右轻摆）。静态模式下两个都不放。
// 全屏辉光（hanabiScreenBloom.ts）：整体辉光 + 副歌辉光 × 副歌权重，挂在场景层上（夜空底与片尾卡不进），强度为 0 时摘掉。
// 分辨率与抗锯齿（#929）：外壳把合出来的倍数与抗锯齿传进来；倍数就地改（同窗口缩放：渲染器立刻跟上，场景防抖重建），
// 抗锯齿只能建上下文时定，变了由外壳重建运行时。

/** 一首歌的全部输入；seed 变了才是真正的换歌。 */
export interface HanabiSongContext {
    seed: string | number | undefined;
    program: HanabiProgram;
    theme: Theme;
}

export interface HanabiRuntimeOptions {
    host: HTMLDivElement;
    song: HanabiSongContext;
    tuning: HanabiTuning;
    currentTime: MotionValue<number>;
    staticMode: boolean;
    showText: boolean;
    paused: boolean;
    metadata: HanabiCreditsMetadata;
    /** 分辨率倍数（乘在 resolveBaseResolution 上）；预览传 1。 */
    renderScale: LyricRenderScale;
    /** MSAA：建上下文时定，原来写死关着。 */
    antialias: boolean;
    signal?: AbortSignal;
}

/** 场景要重建时等多久（滑块拖动、窗口拖拽缩放时不每帧重建）。 */
const REBUILD_DEBOUNCE_MS = 220;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;
/** 夜空不透明度到这里以上，配色按深色底算（纸白字、亮色描边）。 */
const DARK_SKY = 0.5;
const NIGHT_BACKGROUND = '#0b0d24';

/** 实际的渲染倍率：花火自己的像素密度（resolveHanabiBaseResolution）乘上用户选的分辨率倍数（>1 时封顶 3，见 utils/lyricRenderQuality.ts）。 */
const resolveRenderResolution = (devicePixelRatio: number, scale: LyricRenderScale) => (
    resolveLyricPixelRatio(resolveHanabiBaseResolution(devicePixelRatio), scale)
);

export class HanabiPixiRuntime {
    private readonly sceneCache = new PixiSceneCache<HanabiSceneEntry>({
        count: () => this.options.song.program.paragraphs.length,
        build: index => {
            const entry = this.buildEntry(this.options.song, index);
            this.sceneLayer.addChild(entry.holder);
            return entry;
        },
        destroy: entry => destroyHanabiSceneEntry(entry),
        detach: entry => entry.holder.parent?.removeChild(entry.holder),
    });
    private readonly songSwap = new PixiSongSwap<HanabiSongContext, HanabiSceneEntry>({
        stage: song => this.stageSong(song),
        commit: (song, staged) => this.commitSong(song, staged),
        discard: entry => destroyHanabiSceneEntry(entry),
    });
    private activeIndex = -1;
    private destroyed = false;
    private resizeObserver: ResizeObserver | null = null;
    private width = 0;
    private height = 0;
    private renderResolution = 1;
    private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
    private rebuildDue = false;
    /** 场景、片尾卡、画框用的主题：夜空够深时背景色换成夜色，配色按深色底取。 */
    private sceneTheme: { source: Theme; dark: boolean; theme: Theme } | null = null;

    private textures: HanabiTextures | null = null;
    private texturesResolution = 0;
    /** 分辨率变了换下来的纹理：还被已建好的场景用着，等场景都换掉后再放。 */
    private readonly retiredTextures: HanabiTextures[] = [];
    /** 上一次重建之后，换下来的纹理可以放了。 */
    private texturesReleasable = false;

    /** 全屏辉光：第一次需要时才建；滤镜区域固定为整个画面（随内容包围盒变会让降采样网格跟着抖）。 */
    private screenBloom: BloomFilter | null = null;
    private screenBloomArea: import('pixi.js').Rectangle | null = null;

    /** 每帧交给场景的「随拍开花」输入（就地改，不分配）。 */
    private readonly beatSource: HanabiBeatSource = { events: [], strength: 0, trackScale: 1 };

    private sky!: HanabiSkyLayer;
    private sceneLayer!: Container;
    private overlayLayer!: Container;
    private credits!: HanabiCreditsLayer;

    private constructor(
        private readonly pixi: PixiModule,
        private readonly options: HanabiRuntimeOptions,
        private readonly app: import('pixi.js').Application,
    ) { }

    static async create(options: HanabiRuntimeOptions) {
        const pixi = await loadPixi();
        const contextOptions = {
            // 画布透明：夜空不透明度小于 1 时 folia 的共享背景要透出来。
            backgroundAlpha: 0,
            antialias: options.antialias,
            powerPreference: 'high-performance',
        } as const;
        const context = await makePixiContext(pixi, contextOptions, options.signal);
        const app = new pixi.Application();
        const width = Math.max(options.host.clientWidth, MIN_WIDTH);
        const height = Math.max(options.host.clientHeight, MIN_HEIGHT);
        const resolution = resolveRenderResolution(window.devicePixelRatio, options.renderScale);
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
            throw new Error('Hanabi requires WebGL');
        }
        // 字形图集按物理像素封顶时要知道 GPU 单张纹理能多大。
        const gl = (app.renderer as { gl?: WebGLRenderingContext | WebGL2RenderingContext }).gl;
        if (gl) setHanabiGlyphTextureLimit(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
        const runtime = new HanabiPixiRuntime(pixi, options, app);
        runtime.renderResolution = resolution;
        runtime.sky = new HanabiSkyLayer(pixi);
        runtime.sceneLayer = new pixi.Container();
        // 交叉渐变时两个段落场景叠放，按段落顺序排。
        runtime.sceneLayer.sortableChildren = true;
        runtime.overlayLayer = new pixi.Container();
        runtime.credits = new HanabiCreditsLayer(pixi);
        app.stage.addChild(runtime.sky.view, runtime.sceneLayer, runtime.credits.holder, runtime.overlayLayer);

        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Hanabi runtime creation was cancelled', 'AbortError');
        }
        await runtime.install();
        if (options.signal?.aborted) {
            runtime.destroy();
            throw new DOMException('Hanabi runtime creation was cancelled', 'AbortError');
        }
        return runtime;
    }

    /** 第一帧分几步做（同绘光）：建上下文后另起一个任务建第一个场景并链接着色器，之后画布才放上页面。 */
    private async install() {
        await new Promise((resolve) => { window.setTimeout(resolve); });
        if (this.options.signal?.aborted) return;
        this.resizeToHost(true);
        this.renderFrame();
        await linkPixiPrograms(this.pixi, this.app.renderer, this.app.stage, 'Hanabi', this.options.signal);
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
        const resolution = resolveRenderResolution(window.devicePixelRatio, this.options.renderScale);
        if (width === this.width && height === this.height && resolution === this.renderResolution) return false;
        this.width = width;
        this.height = height;
        this.renderResolution = resolution;
        this.app.renderer.resize(width, height, resolution);
        this.drawOverlay();
        if (immediate) this.rebuildDue = true;
        else this.scheduleRebuild();
        return true;
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

    private themeFor(theme: Theme) {
        const dark = !this.options.tuning.textOnly && this.options.tuning.sky >= DARK_SKY;
        if (this.sceneTheme?.source !== theme || this.sceneTheme.dark !== dark) {
            this.sceneTheme = { source: theme, dark, theme: dark ? { ...theme, backgroundColor: NIGHT_BACKGROUND } : theme };
        }
        return this.sceneTheme.theme;
    }

    private texturesNow() {
        if (!this.textures || this.texturesResolution !== this.renderResolution) {
            if (this.textures) this.retiredTextures.push(this.textures);
            this.textures = createHanabiTextures(this.pixi, this.renderResolution);
            this.texturesResolution = this.renderResolution;
        }
        return this.textures;
    }

    private drawOverlay() {
        destroyPixiContainerChildren(this.overlayLayer);
        const { tuning } = this.options;
        if (!tuning.overlayFrame || tuning.textOnly || this.width === 0) return;
        this.overlayLayer.addChild(buildHanabiOverlay(
            this.pixi,
            this.width,
            this.height,
            this.themeFor(this.options.song.theme),
            tuning.colorMode,
            this.renderResolution,
        ));
    }

    private buildEntry(song: HanabiSongContext, index: number) {
        return buildHanabiSceneEntry(this.pixi, {
            width: this.width,
            height: this.height,
            resolution: this.renderResolution,
            program: song.program,
            theme: this.themeFor(song.theme),
            tuning: this.options.tuning,
            textures: this.texturesNow(),
            showText: this.options.showText,
            motifs: this.motifs(),
            songTitle: this.options.metadata.title?.trim() || null,
            songArtist: this.options.metadata.artist?.trim() || null,
            icons: this.iconsFor(song.theme),
        }, index);
    }

    /** 拼贴的字样：曲名在前，再是 HANABI / 花火（没有关键词时重复字用它们）。 */
    private motifs() {
        const title = this.options.metadata.title?.trim();
        return [...(title ? [title] : []), 'HANABI', '花火'];
    }

    /** 主题图标里已经加载好的那些（外壳在建运行时与换歌前加载）；一个都没有时拼贴用花。 */
    private iconsFor(theme: Theme) {
        return resolveLucideIconNames(theme.lyricsIcons);
    }

    private clearScenes() {
        this.sceneCache.clear();
        this.activeIndex = -1;
    }

    /**
     * 换下来的纹理只在分辨率变化时出现，而分辨率变化总会跟着一次重建：重建清掉缓存场景与片尾卡之后（换歌换下、
     * 还没销毁完的场景也放完），就没有谁再用它们了。重建之前（防抖期间）旧场景还在画，不能放。
     */
    private releaseRetiredTextures() {
        if (!this.texturesReleasable || this.sceneCache.hasRetired || this.songSwap.active) return;
        this.texturesReleasable = false;
        this.retiredTextures.splice(0).forEach(textures => textures.destroy());
    }

    private renderFrame = () => {
        if (this.destroyed) return;
        const time = this.options.currentTime.get();
        this.songSwap.advance();
        if (this.rebuildDue) {
            this.rebuildDue = false;
            this.songSwap.dropStaged();
            this.clearScenes();
            this.credits.invalidate();
            // 分辨率变了就在这里换纹理：用旧纹理的场景刚清掉。
            this.texturesNow();
            if (this.retiredTextures.length > 0) this.texturesReleasable = true;
        }
        const { program, theme } = this.options.song;
        const { tuning } = this.options;
        this.sky.update(theme, tuning.textOnly ? 0 : tuning.sky, this.width, this.height);
        const frames = resolveHanabiSceneFrames(program, time, !this.options.staticMode);
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
            // 一帧只做一件贵的事，按优先级：释放换下的场景 → 备好马上要出场的镜头 → 预建下一段 → 片尾卡 → 预建上一段。
            const next = frames.activeIndex + 1;
            const previous = frames.activeIndex - 1;
            if (this.sceneCache.hasRetired) {
                this.sceneCache.drainRetired();
            } else if (this.prepareShots(time)) {
                // 画了一个镜头的字形图集，或建了它的烟花池、装饰件与拼贴。
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
        this.releaseRetiredTextures();

        const beats = this.readBeatSource();
        this.applyBeatPulse();
        this.applyScreenBloom(time);

        const lyricAlpha = creditsFrame.active ? creditsFrame.lyricAlpha : 1;
        const lyricBlur = creditsFrame.active ? creditsFrame.lyricBlur : 0;
        const blurResolution = this.renderResolution * 0.5;
        const spinTurn = tuning.textOnly ? 0 : tuning.spin * hanabiSpinDirection(program.seed);
        this.sceneCache.forEach((entry, index) => {
            const layer = frames.layers.find(candidate => candidate.index === index);
            const alpha = (layer?.alpha ?? 0) * lyricAlpha;
            entry.holder.visible = alpha > 0.002;
            if (!entry.holder.visible || !layer) return;
            entry.scene.update(time, beats);
            applyHanabiLayerFrame(this.pixi, entry, {
                alpha,
                scale: layer.scale,
                blur: Math.max(layer.blur, lyricBlur),
                y: layer.y,
                // 段落转场的旋转跟着「旋转」设置与整首歌的旋转方向走；仅显示歌词文字时不转。
                rotation: layer.rotation * spinTurn,
            }, { width: this.width, height: this.height }, blurResolution);
        });
        this.credits.update(time, creditsFrame, this.width, this.height);
    };

    /** 缓存里的场景（当前段与预建好的下一段）谁有马上要出场的镜头就备一个；做了返回 true。 */
    private prepareShots(time: number) {
        let done = false;
        this.sceneCache.forEach(entry => {
            if (!done) done = entry.scene.prepare(time);
        });
        return done;
    }

    /** 「随拍开花」这一帧的输入；节拍表没装好、效果关着、静态模式时为 null。 */
    private readBeatSource(): HanabiBeatSource | null {
        if (this.options.staticMode || this.options.tuning.textOnly || !isBeatFxReady()) return null;
        const strength = getBeatEffectStrength(BEAT_EFFECT_IDS.hanabiBeatBursts);
        if (strength <= 0) return null;
        this.beatSource.events = getBeatFxEvents();
        this.beatSource.strength = strength;
        this.beatSource.trackScale = getBeatFxTrackScale();
        return this.beatSource;
    }

    /** 全屏辉光：强度为 0 时摘掉 filter，否则挂上并按画面尺寸固定滤镜区域。 */
    private applyScreenBloom(time: number) {
        const { tuning, song } = this.options;
        const strength = resolveHanabiScreenBloomStrength(tuning.bloom, tuning.chorusBloom, resolveHanabiChorusWeight(song.program.chorus, time));
        if (strength <= 0.01) {
            if (this.sceneLayer.filters?.length) this.sceneLayer.filters = [];
            return;
        }
        if (!this.screenBloom) {
            // 亮部才进 bloom（字的白、烟花、贴纸的白边），阈值比烟花层自己的辉光高，画面不至于整片发灰。
            this.screenBloom = createBloomFilter(this.pixi, { strength, threshold: 0.5, knee: 0.3, levels: 5, spread: 0.85, tint: [1, 0.95, 0.98], padding: 0 });
            // 满分辨率：默认 1 时 1.5× / 2× 屏上整层字会先画成 1× 再拉伸，开着辉光时字会糊。
            this.screenBloom.resolution = 'inherit';
            this.screenBloomArea = new this.pixi.Rectangle();
        }
        this.screenBloom.options.strength = strength;
        this.screenBloomArea!.x = 0;
        this.screenBloomArea!.y = 0;
        this.screenBloomArea!.width = this.width;
        this.screenBloomArea!.height = this.height;
        this.sceneLayer.filterArea = this.screenBloomArea!;
        if (!this.sceneLayer.filters?.includes(this.screenBloom)) this.sceneLayer.filters = [this.screenBloom];
    }

    /** 「随拍推镜」：整个场景层以画面中心推近、左右轻摆；没有拍时复原。 */
    private applyBeatPulse() {
        const strength = this.options.staticMode || this.options.tuning.textOnly || !isBeatFxReady()
            ? 0
            : getBeatEffectStrength(BEAT_EFFECT_IDS.hanabiBeatPulse);
        this.sceneLayer.pivot.set(this.width / 2, this.height / 2);
        this.sceneLayer.position.set(this.width / 2, this.height / 2);
        if (strength <= 0) {
            this.sceneLayer.scale.set(1);
            this.sceneLayer.rotation = 0;
            return;
        }
        const clock = getBeatFxIntensities();
        const pulse = resolveHanabiBeatPulse(
            rescaleBeatEnvelope(beatImpact.get(), clock.beat, strength),
            rescaleBeatEnvelope(downbeatImpact.get(), clock.downbeat, strength),
            getBeatFxRotationSign(),
        );
        this.sceneLayer.scale.set(pulse.scale);
        this.sceneLayer.rotation = pulse.rotation;
    }

    private creditBuildContext(theme: Theme) {
        return {
            width: this.width,
            height: this.height,
            resolution: this.renderResolution,
            theme: this.themeFor(theme),
            metadata: this.options.metadata,
            tuning: this.options.tuning,
            textures: this.texturesNow(),
            icons: this.iconsFor(theme),
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
    swapSong(next: HanabiSongContext, signal?: AbortSignal): Promise<void> {
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
    private stageSong(song: HanabiSongContext) {
        const index = findHanabiParagraphIndexAtTime(song.program, this.options.currentTime.get());
        if (index < 0 || index >= song.program.paragraphs.length) return null;
        const entry = this.buildEntry(song, index);
        entry.holder.visible = false;
        this.sceneLayer.addChild(entry.holder);
        return entry;
    }

    private commitSong(next: HanabiSongContext, staged: HanabiSceneEntry | null) {
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

    /** 就地应用 tuning：夜空每帧现读，画框按需重画，烘焙进场景的字段（含夜空深浅换配色）防抖重建。 */
    setTuning(tuning: HanabiTuning) {
        if (this.destroyed || tuning === this.options.tuning) return;
        const previous = this.options.tuning;
        this.options.tuning = tuning;
        const darkChanged = (previous.sky >= DARK_SKY) !== (tuning.sky >= DARK_SKY);
        if (changedHanabiKeys(previous, tuning, HANABI_OVERLAY_KEYS) || darkChanged) this.drawOverlay();
        if (requiresHanabiSceneRebuild(previous, tuning) || darkChanged) this.scheduleRebuild();
        if (this.options.paused) this.renderOnce();
    }

    /** 就地换分辨率倍数：同窗口缩放，渲染器立刻跟上，场景（字形图集、粒子纹理按分辨率画）防抖重建。 */
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
        const apply = (entry: HanabiSceneEntry) => entry.scene.setLayerVisibility({ graphics: true, text: showText, mid: false });
        this.sceneCache.forEach(apply);
        if (this.songSwap.staged) apply(this.songSwap.staged);
        if (this.options.paused) this.renderOnce();
    }

    setStaticMode(staticMode: boolean) {
        if (this.destroyed || staticMode === this.options.staticMode) return;
        this.options.staticMode = staticMode;
        if (this.options.paused) this.renderOnce();
    }

    setSongMetadata(metadata: HanabiCreditsMetadata) {
        if (this.destroyed) return;
        const current = this.options.metadata;
        if (current.title === metadata.title && current.artist === metadata.artist && current.album === metadata.album) return;
        const titleChanged = current.title?.trim() !== metadata.title?.trim() || current.artist?.trim() !== metadata.artist?.trim();
        this.options.metadata = { ...metadata };
        this.credits.invalidate();
        // 曲名、艺人烘焙进了拼贴的开场标题卡与重复字：换了就重建场景（防抖，同一首歌里一般只在开头晚到一次）。
        if (titleChanged) this.scheduleRebuild();
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
        this.sky?.destroy();
        if (this.sceneLayer) this.sceneLayer.filters = [];
        this.screenBloom?.destroy();
        this.screenBloom = null;
        if (this.overlayLayer) destroyPixiContainerChildren(this.overlayLayer);
        // 粒子纹理由运行时持有，场景与片尾卡都已销毁，这里最后释放。
        this.textures?.destroy();
        this.retiredTextures.splice(0).forEach(textures => textures.destroy());
        this.app.destroy({ removeView: true }, { children: true });
    }
}
