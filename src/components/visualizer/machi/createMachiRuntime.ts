import * as THREE from 'three';
import type { MotionValue } from 'framer-motion';
import type { AudioBands, Line, Theme } from '../../../types';
import { getDrumHits, type DrumHits } from '../../../services/analysis/drumHits';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
import {
    getBeatEffectStrength,
    getBeatFxHeard,
    getBeatFxEvents,
    getBeatFxTrackScale,
    isBeatFxReady,
} from '../../../services/beatFx/beatFxLive';
import { resolveLucideIconNames } from '../../../services/lucideIconResolver';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import {
    createMachiBeatFrame,
    MACHI_BEAT,
    machiDrumHitsAt,
    machiRippleWetness,
    resetMachiBeatFrame,
    resolveMachiDrumRipples,
    resolveMachiNeonPulse,
    resolveMachiScreenFlash,
    type MachiBeatFrame,
} from './engine/beatFx';
import { MachiCamera } from './engine/camera';
import { MachiClock } from './engine/clock';
import {
    buildMachiLightningTimes,
    MachiAudioFollower,
    resolveMachiBoardTarget,
    resolveMachiChorus,
    resolveMachiFlicker,
    resolveMachiLightning,
    sameBoardTarget,
    type MachiBoardTarget,
} from './engine/director';
import {
    createMachiEnvironmentState,
    MACHI_DAYLIGHT,
    resolveMachiDaylight,
    resolveMachiEnvironmentLook,
    resolveMachiEnvironmentTarget,
    resolveMachiWeatherKind,
    sameMachiEnvironment,
    stepMachiEnvironment,
    type MachiEnvironmentLook,
    type MachiEnvironmentState,
    type MachiEnvironmentTarget,
} from './engine/environment';
import { MachiGround } from './engine/fx/ground';
import { MachiPost, type MachiAtmosphereFrame } from './engine/fx/post';
import { resolveMachiLens } from './engine/lens';
import { resolveMachiRenderQuality, type MachiRenderQuality } from './engine/quality';
import { MachiReflection } from './engine/fx/reflection';
import { MachiWeather } from './engine/fx/weather';
import { MachiColorBlend, MachiMaterials } from './engine/materials';
import { resolveMachiPalette } from './engine/palette';
import { MachiSky } from './engine/sky';
import { MachiSkyLights } from './engine/skyLights';
import { createMachiSnowUniforms, setMachiSnowRoofs } from './engine/snow';
import { resolveMachiSceneId } from './machiTuning';
import { MACHI_SCENES } from './scenes';
import type { MachiScene, MachiSceneContent, MachiSceneContext } from './scenes/types';
import { reportMachiShownScene, withdrawMachiShownScene } from './shownScene';
import type { MachiCameraView, MachiQuality, MachiSceneId, MachiTuning } from './types';

// src/components/visualizer/machi/createMachiRuntime.ts
// 町景的运行时：一个 WebGL 上下文，建一次；换歌、换主题、换设置、暂停都就地推给它（外壳用 useVisualizerPixiHost 托管）。
// 引擎管渲染器、镜头、天光、天气、湿地面、倒影、后处理、时钟、编排（牌面、副歌、闪烁、闪电、音频）和环境（时间与天气：
// 设置 → 目标，按真实时间渐变过去，天空、天光、人造光、雨雪、路面干湿、积雪、bloom 都跟着它）；场景（scenes/）
// 管自己的几何、灯、招牌和会动的东西。换场景只拆旧场景、建新场景，上下文和后处理留着。
// 自己的 requestAnimationFrame 循环：暂停时只在镜头还在动、颜色还在插值、或外面要求补一帧时出帧，其余时间不跑。
// 每帧的时间只从 currentTime（歌词）和 MachiClock（氛围）读，不进 React。
// 智能动感模式（engine/beatFx.ts）：每帧按节拍表与鼓点算出霓虹、涟漪、闪拍的量，涟漪交给地面，其余随场景帧交给场景。

export interface MachiSongContext {
    seed: string | number;
    lines: Line[];
    isInstrumental: boolean;
    title: string;
    artist: string;
    album: string;
}

export interface MachiRuntimeOptions {
    host: HTMLDivElement;
    song: MachiSongContext;
    theme: Theme;
    tuning: MachiTuning;
    currentTime: MotionValue<number>;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    paused: boolean;
    staticMode: boolean;
    showText: boolean;
    /** 样式架小图、主题乐园预览：低分辨率、不接拖拽。 */
    previewMode: boolean;
    /** 自定义视角下拖动停稳了：新视角（相对默认构图）与它属于哪个场景，交给外面存进 tuning。 */
    onViewChange?: (view: MachiCameraView, scene: MachiSceneId) => void;
    /** 换上了一个场景（取景控制条按它调视角）。 */
    onSceneShown?: (scene: MachiSceneId) => void;
    /** 主题没有图标时招牌上的兜底图标。 */
    fallbackIcons: readonly string[];
    /** WebGL 上下文丢了：外壳重建运行时。 */
    onContextLost: () => void;
    signal: AbortSignal;
}

const throwIfAborted = (signal: AbortSignal) => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
};

/** 换主题时只看真正影响画面的字段：主题对象在改字体时也会换引用。 */
const themeKey = (theme: Theme) => [
    theme.backgroundColor, theme.primaryColor, theme.accentColor, theme.secondaryColor,
    (theme.wordColors ?? []).map(entry => `${entry.word}=${entry.color}`).join(','),
    (theme.lyricsIcons ?? []).join(','),
    theme.fontStyle, theme.fontFamily ?? '', (theme.fontFamilyStack ?? []).join(','), String(theme.fontWeight ?? ''),
    theme.name ?? '', theme.description ?? '', theme.animationIntensity,
].join('|');

/** 主题的动效强度 → 雨量、闪烁这些氛围动效的倍数。 */
const INTENSITY_SCALE: Record<Theme['animationIntensity'], number> = { calm: 0.7, normal: 1, chaotic: 1.3 };
/** 每个窗口有车开过的概率，按主题的动效强度。 */
const TRAFFIC_CHANCE: Record<Theme['animationIntensity'], number> = { calm: 0.4, normal: 0.6, chaotic: 0.78 };

/** 平均帧时超过它（约 48fps 以下）就降一档；至少隔这么久才看一次。 */
const DEGRADE_FRAME_MS = 21;
const DEGRADE_WINDOW_MS = 2500;

/** 换主题时重画招牌的防抖（调色时主题一直在变）。 */
const SIGN_REPAINT_DEBOUNCE_MS = 150;
/** 提前多久把下一行画好。 */
const PREHEAT_LEAD_SECONDS = 2.5;
const DEG = Math.PI / 180;
/** 时间“自动”时多久看一次钟。 */
const CLOCK_CHECK_MS = 30_000;
/** 换场景的淡出、淡入（秒）。 */
const SCENE_FADE_OUT = 0.18;
const SCENE_FADE_IN = 0.32;

const lerpColor = (out: THREE.Color, a: THREE.Color, b: THREE.Color, t: number) => out.copy(a).lerp(b, t);
/** 画质设置的指纹：设置面板每次给的是新对象，按内容比。 */
const qualityKey = (quality: MachiQuality) => [quality.renderScale, quality.antialias, quality.shadows, quality.reflections, quality.glow, quality.adaptive].join('|');

interface MachiDebugHook {
    setView: (azimuthDeg: number, elevationDeg: number, zoom?: number) => void;
    /** 回到静止位置（默认构图或自定义视角）。 */
    resetView: () => void;
    /** 此刻的视角，相对默认构图。 */
    cameraOffset: () => MachiCameraView;
    renderAt: (songSeconds: number, ambientSeconds?: number) => void;
    /** 从氛围时间 from 往后找下一辆开到路中间的车，返回那一刻的氛围时间。 */
    nextCar: (from: number) => number | null;
    /** 改设置（场景、时间、天气），环境直接跳到目标（不渐变），同步画一帧。 */
    setTuning: (patch: Partial<MachiTuning>, transition?: boolean) => void;
    environment: () => MachiEnvironmentState;
    /** 智能动感模式的鼓点改用这一份（null 回到听到的这首歌的鼓点）：探针里没有分离，拿它看涟漪与闪拍。 */
    setDrumHits: (hits: DrumHits | null) => void;
    stats: () => Record<string, number | string>;
    runtime: MachiRuntime;
}

declare global {
    interface Window {
        __machiDebug?: MachiDebugHook;
    }
}

export class MachiRuntime {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new MachiCamera();
    private readonly clock = new MachiClock();
    private readonly blend: MachiColorBlend;
    private readonly materials: MachiMaterials;
    private readonly skyLights: MachiSkyLights;
    private readonly sky = new MachiSky();
    private readonly ground: MachiGround;
    private readonly reflection: MachiReflection;
    private readonly post: MachiPost;
    private stage!: MachiScene;
    private stageContext!: MachiSceneContext;
    private stageId!: MachiSceneId;
    private weather!: MachiWeather;
    private readonly snow = createMachiSnowUniforms();
    private environmentTarget: MachiEnvironmentTarget;
    private environment: MachiEnvironmentState;
    private look: MachiEnvironmentLook;
    private environmentDirty = true;
    private clockTimer = 0;
    /** 换场景的淡出淡入：画面亮度、阶段、淡出后要建的场景。 */
    private fade = 1;
    private fadePhase: 'idle' | 'out' | 'in' = 'idle';
    private pendingScene: MachiSceneId | null = null;
    private readonly scratchColor = new THREE.Color();
    private readonly scratchColorB = new THREE.Color();
    private lightningTimes: number[] = [];
    /** 智能动感模式这一帧的量（每帧就地改写）与鼓点涟漪的几圈。 */
    private readonly beat: MachiBeatFrame = createMachiBeatFrame();
    private readonly kickRings = new Float32Array(MACHI_BEAT.ripple.max * 2);
    /** 调试钩子给的鼓点（setDrumHits）。 */
    private debugDrumHits: DrumHits | null = null;
    /** 自动降级压下去了几格（改了画质设置就归零）。 */
    private degrade = 0;
    private renderQuality: MachiRenderQuality;
    private qualityCheckedAt = 0;
    private size = { width: 1, height: 1 };
    private readonly audio = new MachiAudioFollower();
    private boardTarget: MachiBoardTarget | null = null;
    private chorus = 0;
    private signRepaintTimer = 0;
    /** 后处理的氛围参数：雾、云、闪电、雾里的两处灯（场景填），每帧更新。 */
    private readonly atmosphere: MachiAtmosphereFrame = {
        time: 0,
        mistColor: new THREE.Color(),
        mistAmount: 0.2,
        cloudColor: new THREE.Color(),
        cloudAmount: 1,
        stars: 0,
        haze: 0,
        lightning: 0,
        glowA: new THREE.Vector4(),
        glowColorA: new THREE.Color(),
        glowB: new THREE.Vector4(),
        glowColorB: new THREE.Color(),
        wind: new THREE.Vector2(),
    };
    private readonly resizeObserver: ResizeObserver;
    private raf = 0;
    private disposed = false;
    private paused: boolean;
    private staticMode: boolean;
    private showText: boolean;
    private song: MachiSongContext;
    private theme: Theme;
    private tuning: MachiTuning;
    private themeSignature: string;
    private pixelRatio: number;
    private wantsFrame = true;
    private readonly frameTimes: number[] = [];
    private lastFrameAt = 0;
    private lastCalls = 0;
    private lastTriangles = 0;

    static async create(options: MachiRuntimeOptions) {
        throwIfAborted(options.signal);
        return new MachiRuntime(options);
    }

    private constructor(private readonly options: MachiRuntimeOptions) {
        this.paused = options.paused;
        this.staticMode = options.staticMode;
        this.showText = options.showText;
        this.song = options.song;
        this.theme = options.theme;
        this.tuning = options.tuning;
        this.themeSignature = themeKey(options.theme);
        this.renderQuality = this.resolveQuality();
        this.pixelRatio = this.renderQuality.pixelRatio;

        // 抗锯齿交给后处理（场景目标的 MSAA、最后的 FXAA / SMAA、超采样），画布本身不开。
        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
        this.renderer.setPixelRatio(this.pixelRatio);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.NeutralToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.info.autoReset = false;
        // 车从底座边缘“开出来”：车的材质带底座的裁切面。
        this.renderer.localClippingEnabled = true;
        const canvas = this.renderer.domElement;
        canvas.style.position = 'absolute';
        canvas.style.inset = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        canvas.addEventListener('webglcontextlost', this.onContextLost);
        options.host.appendChild(canvas);

        const sceneId = resolveMachiSceneId(options.tuning, options.song.seed);
        this.blend = new MachiColorBlend(resolveMachiPalette(options.theme, options.song.seed, MACHI_SCENES[sceneId].resolveArt));
        this.materials = new MachiMaterials(this.blend, this.snow);
        this.lightningTimes = buildMachiLightningTimes(options.song.lines);
        this.environmentTarget = this.resolveEnvironmentTarget();
        this.environment = createMachiEnvironmentState(this.environmentTarget);
        this.look = resolveMachiEnvironmentLook(this.environment);
        this.ground = new MachiGround(this.materials, this.blend, this.snow);
        const quality = this.renderQuality;
        this.skyLights = new MachiSkyLights(this.blend, quality.shadowMapSize);
        this.scene.add(this.skyLights.group);
        this.reflection = new MachiReflection(0.06, quality.reflectionScale || 0.3);
        this.ground.uniforms.uReflection.value = this.reflection.target.texture;
        this.ground.setReflections(quality.reflectionScale > 0);
        this.post = new MachiPost(this.renderer, this.scene, this.camera.camera, quality);
        this.scene.background = this.sky.texture;
        this.camera.onCommit = view => this.options.onViewChange?.(view, this.stageId);
        this.camera.onWake = () => this.wake();
        this.camera.setMotion(options.tuning.motion, options.tuning.motionSpeed);
        this.mountScene(sceneId);

        if (!options.previewMode) this.camera.attach(canvas);
        this.resizeObserver = new ResizeObserver(this.onResize);
        this.resizeObserver.observe(options.host);
        this.resize(options.host.clientWidth, options.host.clientHeight);

        this.clock.paused = this.paused || this.staticMode;
        this.clockTimer = window.setInterval(this.onClockCheck, CLOCK_CHECK_MS);
        // 第一帧在 create 里画好：着色器编译是起步最慢的一段，换样式的过渡等它（firstFrame.ts）。
        this.renderer.compile(this.scene, this.camera.camera);
        this.renderFrame(performance.now());
        this.wake();
        if (import.meta.env.DEV) this.installDebugHook();
    }

    /** 招牌要的东西：歌、主题、调色板、字体、图标。 */
    private sceneContent(palette = resolveMachiPalette(this.theme, this.song.seed, MACHI_SCENES[this.stageId].resolveArt)): MachiSceneContent {
        return {
            song: this.song,
            theme: this.theme,
            palette,
            font: { stack: resolveThemeFontStack(this.theme), weight: resolveThemeFontWeight(this.theme, 700) },
            icons: resolveLucideIconNames(this.theme.lyricsIcons),
            fallbacks: this.options.fallbackIcons,
        };
    }

    /** 建场景（或换场景：先拆旧的）：几何、灯、招牌进场景树，湿地面、天气、镜头取景、倒影平面跟着换。 */
    private mountScene(id: MachiSceneId) {
        if (this.stage) {
            this.stage.dispose();
            this.weather.group.removeFromParent();
            this.weather.dispose();
        }
        const definition = MACHI_SCENES[id];
        const palette = resolveMachiPalette(this.theme, this.song.seed, definition.resolveArt);
        this.blend.setTarget(palette, !this.stage || this.staticMode);
        this.stageId = id;
        this.stageContext = {
            materials: new MachiMaterials(this.blend, this.snow, id),
            blend: this.blend,
            geometryCache: new Map(),
            song: this.song,
            previewMode: this.options.previewMode,
            invalidateShadows: () => this.skyLights.invalidateShadows(),
        };
        const stage = definition.create(this.stageContext);
        this.stage = stage;
        stage.surfaces.road.forEach(surface => { surface.material = this.ground.asphalt; });
        stage.surfaces.lot.forEach(surface => { surface.material = this.ground.concrete; });
        this.ground.uniforms.uPuddleOffset.value.set(stage.puddles.offset[0], stage.puddles.offset[1]);
        this.ground.uniforms.uPuddleAmount.value = stage.puddles.amount;
        this.scene.add(stage.root);
        this.weather = new MachiWeather(
            this.stageContext.materials,
            this.blend,
            stage.weather,
            this.options.previewMode ? { rain: 800, splash: 160, snow: 500 } : { rain: 2000, splash: 560, snow: 1400 },
        );
        this.scene.add(this.weather.group);
        setMachiSnowRoofs(this.snow, stage.weather.roofs);
        this.atmosphere.wind.set(Math.sin(stage.weather.windYaw), Math.cos(stage.weather.windYaw)).multiplyScalar(0.06);
        this.reflection.planeY = stage.reflectionPlaneY;
        this.camera.setFraming(stage.framing, this.customView(id));
        reportMachiShownScene(this, id);
        this.options.onSceneShown?.(id);
        stage.setContent(this.sceneContent(palette));
        this.boardTarget = null;
        this.environmentDirty = true;
        this.syncColors();
        this.skyLights.invalidateShadows();
        this.wantsFrame = true;
    }

    /** 换场景：先淡出，在黑场里拆旧建新（重建那一下的卡顿藏在黑里），再淡入。预览和调试钩子直接换。 */
    private requestScene(id: MachiSceneId, immediate = this.options.previewMode) {
        if (immediate) {
            this.pendingScene = null;
            this.fadePhase = 'idle';
            this.fade = 1;
            this.mountScene(id);
            this.renderer.compile(this.scene, this.camera.camera);
            return;
        }
        this.pendingScene = id;
        this.fadePhase = 'out';
        this.wantsFrame = true;
        this.wake();
    }

    /** 推进淡出淡入（真实时间，暂停时也走完）；淡到黑时建新场景。 */
    private stepFade(delta: number) {
        const step = Math.min(delta, 1 / 30);
        if (this.fadePhase === 'out') {
            this.fade = Math.max(0, this.fade - step / SCENE_FADE_OUT);
            if (this.fade === 0) {
                const id = this.pendingScene;
                this.pendingScene = null;
                if (id) {
                    this.mountScene(id);
                    this.renderer.compile(this.scene, this.camera.camera);
                }
                this.fadePhase = 'in';
            }
        } else if (this.fadePhase === 'in') {
            this.fade = Math.min(1, this.fade + step / SCENE_FADE_IN);
            if (this.fade === 1) this.fadePhase = 'idle';
        }
    }

    /** 某个场景的自定义视角；默认视角时是 null。 */
    private customView(id: MachiSceneId) {
        return this.tuning.camera === 'custom' ? this.tuning.views[id] : null;
    }

    /** 正在画的场景，或淡出后马上要换上的场景。 */
    private get targetSceneId() {
        return this.pendingScene ?? this.stageId;
    }

    private readonly onContextLost = (event: Event) => {
        event.preventDefault();
        console.warn('[Machi] WebGL context lost, rebuilding the runtime');
        this.stopLoop();
        this.options.onContextLost();
    };

    private readonly onResize = (entries: ResizeObserverEntry[]) => {
        const entry = entries[0];
        if (!entry) return;
        this.resize(entry.contentRect.width, entry.contentRect.height);
        this.wake();
    };

    private resize(width: number, height: number) {
        const w = Math.max(1, Math.round(width));
        const h = Math.max(1, Math.round(height));
        this.size = { width: w, height: h };
        this.renderer.setSize(w, h, false);
        this.camera.setAspect(w, h);
        this.post.setSize();
        this.reflection.setSize(w * this.pixelRatio, h * this.pixelRatio);
        this.wantsFrame = true;
    }

    /** 画质设置 + 自动降级的格数 → 实际用的渲染参数。 */
    private resolveQuality(degrade = this.degrade): MachiRenderQuality {
        return resolveMachiRenderQuality(this.tuning.quality, {
            degrade,
            devicePixelRatio: window.devicePixelRatio || 1,
            previewMode: this.options.previewMode,
        });
    }

    /** 把画质用上：DPR、倒影、阴影、后处理（MSAA、抗锯齿、bloom / 光条、景深离焦层）。改设置与自动降级都走这里。 */
    private applyQuality() {
        const quality = this.resolveQuality();
        this.renderQuality = quality;
        this.pixelRatio = quality.pixelRatio;
        this.renderer.setPixelRatio(quality.pixelRatio);
        if (quality.reflectionScale > 0) this.reflection.setScale(quality.reflectionScale, this.size.width * quality.pixelRatio, this.size.height * quality.pixelRatio);
        this.ground.setReflections(quality.reflectionScale > 0);
        this.skyLights.setShadowMapSize(quality.shadowMapSize);
        this.post.setQuality(quality);
        this.resize(this.size.width, this.size.height);
        this.frameTimes.length = 0;
        this.wake();
    }

    /** 帧时一直偏高就在用户那套画质之下再压一格（engine/quality.ts 的顺序），只降不升；自动降级关着时不管。 */
    private adaptQuality(now: number) {
        if (this.options.previewMode || !this.tuning.quality.adaptive || this.clock.paused || document.visibilityState !== 'visible') return;
        if (now - this.qualityCheckedAt < DEGRADE_WINDOW_MS || this.frameTimes.length < 60) return;
        this.qualityCheckedAt = now;
        const average = this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length;
        if (average <= DEGRADE_FRAME_MS) return;
        // 已经压到底：再要一格也压不下去了。
        if (this.resolveQuality(this.degrade + 1).degrade <= this.renderQuality.degrade) return;
        this.degrade += 1;
        this.applyQuality();
        console.info(`[Machi] frame time ${average.toFixed(1)} ms, degraded ${this.degrade} step(s)`);
    }

    /**
     * 天空、天光、月光 / 太阳的颜色按环境推：夜、黄昏、白天三套之间插值（换时间时经过黄昏，像日落日出），
     * 阴天往灰里拉，积雪时地面反上来的光更亮。结果盖在调色板的同名键上（MachiColorBlend.setDerived）。
     */
    private applyEnvironmentColors() {
        const { daylight, snowCover } = this.environment;
        const { overcast } = this.look;
        const color = this.scratchColor;
        const other = this.scratchColorB;
        const dusk = MACHI_DAYLIGHT.dusk;
        (['skyTop', 'skyBottom', 'hemiSky', 'hemiGround', 'moon'] as const).forEach(key => {
            if (daylight <= dusk) lerpColor(color, this.blend.raw(key), this.blend.raw(`${key}Dusk`), daylight / dusk);
            else lerpColor(color, this.blend.raw(`${key}Dusk`), this.blend.raw(`${key}Day`), (daylight - dusk) / (1 - dusk));
            // 阴天：去饱和、白天略提亮（一片灰白的天），夜里压暗一点。
            const luminance = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
            other.setRGB(luminance, luminance, luminance).multiplyScalar(key === 'moon' ? 1 : 0.9 + 0.35 * daylight);
            color.lerp(other, overcast * (key === 'moon' ? 0.45 : 0.7));
            if (key === 'hemiGround') color.lerp(other.setRGB(0.55, 0.6, 0.7).multiplyScalar(0.35 + 0.65 * daylight), snowCover * 0.5);
            this.blend.setDerived(key, color);
        });
    }

    /** 插值后的颜色写回材质、灯、天空、场景。 */
    private syncColors() {
        this.applyEnvironmentColors();
        this.materials.syncColors();
        this.skyLights.sync();
        this.sky.paint(this.blend.get('skyTop'), this.blend.get('skyBottom'));
        this.ground.syncColors();
        this.weather.syncColors();
        this.stage.syncColors();
    }

    private wake() {
        if (this.disposed || this.raf) return;
        this.clock.resync();
        this.raf = requestAnimationFrame(this.frame);
    }

    private stopLoop() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
    }

    private readonly frame = (now: number) => {
        this.raf = 0;
        if (this.disposed) return;
        this.renderFrame(now);
        // 这一帧里可能已经有人 wake() 排过下一帧（镜头摆位、换场景都会叫醒）：再排一次就多出一条并行的渲染链，
        // 每个刷新周期画两遍，而且会越滚越多。
        if (this.raf) return;
        const animating = !this.clock.paused;
        if (animating || this.camera.busy || this.stage.busy || this.wantsFrame || this.environmentMoving || this.fadePhase !== 'idle') {
            this.raf = requestAnimationFrame(this.frame);
        }
    };

    /** 推进一帧并画出来。 */
    private renderFrame(now: number) {
        this.clock.tick(now);
        this.wantsFrame = false;
        if (this.lastFrameAt > 0) {
            const interval = now - this.lastFrameAt;
            if (interval > 0 && interval < 100) {
                this.frameTimes.push(interval);
                if (this.frameTimes.length > 120) this.frameTimes.shift();
            }
        }
        this.lastFrameAt = now;

        this.stepFade(this.clock.realDelta);
        this.camera.update(this.clock.realDelta, this.clock.delta);
        this.stepEnvironment(this.clock.realDelta);
        if (this.blend.step(this.clock.realDelta) || this.environmentDirty) {
            this.environmentDirty = false;
            this.syncColors();
            this.wantsFrame = true;
        }
        this.direct();

        this.renderer.info.reset();
        if (this.skyLights.moon.shadow.needsUpdate) this.renderer.shadowMap.needsUpdate = true;
        const camera = this.camera.camera;
        // 干的路面不映倒影、画质里关了倒影：都省掉倒影那一遍。
        if (this.environment.wetness > 0.02 && this.renderQuality.reflectionScale > 0) {
            this.reflection.render(this.renderer, this.scene, camera);
            this.ground.uniforms.uReflectMatrix.value.copy(this.reflection.textureMatrix);
        }
        const pixelWorldSize = (camera.top - camera.bottom) / camera.zoom / Math.max(1, this.size.height * this.pixelRatio);
        // 景深按相对默认构图的缩放走：默认构图下的微缩感不变，拉近时景深变浅。光圈按 f/8 换算：光圈每大一档，
        // 清晰的那一层薄一截、离焦圆大一圈（resolveMachiLens）。
        const zoom = camera.zoom / this.camera.defaultView.zoom;
        this.post.render(pixelWorldSize, this.camera.focusDistance, this.atmosphere, {
            focus: this.focusDepth(),
            ...resolveMachiLens(this.tuning, zoom),
            aberration: 0.014,
            vignette: 0.55,
            grain: 0.032,
            fade: this.fade,
        });
        this.adaptQuality(now);
        this.lastCalls = this.renderer.info.render.calls;
        this.lastTriangles = this.renderer.info.render.triangles;
        this.camera.rendered();
    }

    /** 设置 + 歌（自动天气按 seed）+ 本地时钟（自动时间）→ 环境目标。 */
    private resolveEnvironmentTarget(): MachiEnvironmentTarget {
        return resolveMachiEnvironmentTarget(
            resolveMachiDaylight(this.tuning.timeOfDay, new Date()),
            resolveMachiWeatherKind(this.tuning.weather, this.song.seed),
        );
    }

    /** 目标变了（设置、换歌、钟走到了黄昏）：静态模式直接跳过去，否则渐变。 */
    private refreshEnvironmentTarget(immediate = this.staticMode) {
        this.environmentTarget = this.resolveEnvironmentTarget();
        if (immediate) {
            this.environment = createMachiEnvironmentState(this.environmentTarget);
            this.look = resolveMachiEnvironmentLook(this.environment);
            this.skyLights.invalidateShadows();
        }
        this.environmentDirty = true;
        this.wantsFrame = true;
        this.wake();
    }

    private readonly onClockCheck = () => {
        if (this.tuning.timeOfDay !== 'auto' || this.disposed) return;
        const daylight = resolveMachiDaylight('auto', new Date());
        if (Math.abs(daylight - this.environmentTarget.daylight) > 1e-3) this.refreshEnvironmentTarget();
    };

    /** 环境按真实时间追目标（暂停时也走完，设置改了能看到结果）；没在变就什么都不做。 */
    private stepEnvironment(delta: number) {
        const next = stepMachiEnvironment(this.environment, this.environmentTarget, Math.min(delta, 0.1));
        if (sameMachiEnvironment(next, this.environment)) return;
        this.environment = next;
        this.look = resolveMachiEnvironmentLook(next);
        this.environmentDirty = true;
        // 太阳停下来了：按最终的方向补一次阴影。
        if (next.daylight === this.environmentTarget.daylight) this.skyLights.settleShadows();
    }

    /** 环境还在渐变：暂停时也要继续出帧。 */
    private get environmentMoving() {
        const target = this.environmentTarget;
        const state = this.environment;
        return state.daylight !== target.daylight || state.rain !== target.rain || state.snow !== target.snow || state.fog !== target.fog
            || state.wetness !== Math.max(target.rain, target.fog * 0.35) || state.snowCover !== target.snow;
    }

    /** 按歌曲时间决定牌面、副歌、闪电；按氛围时钟决定闪烁；音频包络平滑；场景推一步。 */
    private direct() {
        const songTime = this.options.currentTime.get();
        const beat = this.stepBeat(songTime);
        const lines = this.song.lines;
        const target: MachiBoardTarget = this.showText ? resolveMachiBoardTarget(lines, songTime) : { kind: 'card' };
        const targetChanged = !sameBoardTarget(this.boardTarget, target);
        let preheat: MachiBoardTarget | null = null;
        if (targetChanged) {
            this.boardTarget = target;
            this.wantsFrame = true;
        } else if (target.kind === 'line' && !this.clock.paused) {
            const next = lines[target.index + 1];
            if (next && next.startTime - songTime < PREHEAT_LEAD_SECONDS) preheat = { kind: 'line', index: target.index + 1 };
        }
        const chorusTarget = resolveMachiChorus(lines, target);
        this.chorus += (chorusTarget - this.chorus) * (1 - Math.exp(-this.clock.delta * 2.5));
        if (this.staticMode) this.chorus = chorusTarget;
        const audio = this.clock.paused ? this.audio.step(0, 0) : this.audio.step(this.options.audioPower.get(), this.clock.delta);
        const flicker = this.staticMode ? 1 : resolveMachiFlicker(this.clock.elapsed, this.song.seed);
        const intensity = INTENSITY_SCALE[this.theme.animationIntensity] ?? 1;
        const environment = this.environment;
        const look = this.look;
        const rain = environment.rain * (0.62 + 0.22 * audio + 0.12 * this.chorus) * intensity;
        const camera = this.camera.camera;
        const pixelsPerUnit = (this.size.height * this.pixelRatio) / ((camera.top - camera.bottom) / camera.zoom);
        this.weather.update({
            time: this.clock.elapsed,
            rain,
            snow: environment.snow * (0.75 + 0.25 * intensity),
            wetness: environment.wetness,
            glint: 1 - 0.9 * environment.daylight,
            pixelsPerUnit,
        });
        // 闪电只在下雨时有。
        const lightning = this.staticMode || environment.rain < 0.5 ? 0 : resolveMachiLightning(this.lightningTimes, songTime) * environment.rain;
        this.skyLights.update({ daylight: environment.daylight, sunIntensity: look.sunIntensity, hemiIntensity: look.hemiIntensity, flash: lightning });
        this.post.setGlow(look.bloom * beat.bloom, look.streaks);
        const atmosphere = this.atmosphere;
        atmosphere.lightning = lightning;
        atmosphere.time = this.clock.elapsed;
        const skyBottom = this.blend.get('skyBottom');
        atmosphere.mistColor.copy(skyBottom).multiplyScalar(1.35 - 0.4 * environment.daylight);
        atmosphere.mistAmount = look.mist + 0.06 * Math.min(1, rain);
        // 云：夜里是天色里带一点月光，白天是偏白的云，阴天更灰。
        lerpColor(this.scratchColor, skyBottom, this.blend.get('moon'), 0.25).multiplyScalar(0.7);
        this.scratchColorB.copy(skyBottom).lerp(new THREE.Color(1, 1, 1), 0.55 - 0.25 * look.overcast).multiplyScalar(0.55);
        atmosphere.cloudColor.copy(this.scratchColor).lerp(this.scratchColorB, environment.daylight);
        atmosphere.cloudAmount = look.clouds;
        atmosphere.stars = look.stars;
        atmosphere.haze = look.haze;
        this.ground.uniforms.uTime.value = this.clock.elapsed;
        this.ground.uniforms.uRain.value = environment.rain > 0.02 ? Math.min(1, 0.45 + 0.5 * rain) : 0;
        this.ground.uniforms.uWet.value = environment.wetness;
        this.snow.uMachiSnow.value = environment.snowCover;
        this.snow.uMachiWet.value = environment.wetness;
        this.snow.uMachiViewUp.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
        this.stage.direct({
            songTime,
            ambientTime: this.clock.elapsed,
            delta: this.clock.delta,
            staticMode: this.staticMode,
            immediate: this.staticMode || this.clock.paused,
            showText: this.showText,
            seed: this.song.seed,
            lines,
            target,
            targetChanged,
            preheat,
            chorus: this.chorus,
            audio,
            flicker,
            rain,
            trafficChance: TRAFFIC_CHANCE[this.theme.animationIntensity] ?? 0.6,
            environment,
            look,
            pixelsPerUnit,
            atmosphere,
            beat,
        });
    }

    /**
     * 智能动感模式：霓虹随拍读整张节拍表、鼓点效果读这首歌的鼓点，都按听到的时间取；涟漪交给地面。
     * 静态模式、暂停（停在霓虹或大屏亮到一半的那帧不留着）、效果关着、拍点 / 鼓点还没有时都是常态值，
     * 画面和关掉时一样。
     */
    private stepBeat(songTime: number): MachiBeatFrame {
        const beat = resetMachiBeatFrame(this.beat);
        const idle = this.clock.paused;
        const neonStrength = idle ? 0 : getBeatEffectStrength(BEAT_EFFECT_IDS.machiNeonPulse);
        const rippleStrength = idle ? 0 : getBeatEffectStrength(BEAT_EFFECT_IDS.machiDrumRipple);
        const flashStrength = idle ? 0 : getBeatEffectStrength(BEAT_EFFECT_IDS.machiScreenFlash);
        const heard = getBeatFxHeard();
        const time = heard.time ?? songTime;
        if (neonStrength > 0 && isBeatFxReady()) {
            resolveMachiNeonPulse(getBeatFxEvents(), time, neonStrength, getBeatFxTrackScale(), beat);
        }
        let hits: DrumHits | null = null;
        if (rippleStrength > 0 || flashStrength > 0) {
            hits = machiDrumHitsAt(this.debugDrumHits ?? getDrumHits(heard.key), time);
        }
        // 光斑的一跳只在干的地面上（湿的地面上是涟漪）。
        beat.thump = resolveMachiDrumRipples(hits, time, rippleStrength, this.kickRings) * (1 - machiRippleWetness(this.environment.wetness));
        resolveMachiScreenFlash(hits, time, flashStrength, beat);
        const focus = this.stage.focusPoint;
        this.ground.setKicks(focus.x, focus.z, this.kickRings);
        return beat;
    }

    /** 主题 / 歌换了：按目标调色板、字体、图标重画招牌。 */
    private repaintSigns() {
        window.clearTimeout(this.signRepaintTimer);
        this.signRepaintTimer = 0;
        this.stage.setContent(this.sceneContent());
        this.boardTarget = null;
        this.wantsFrame = true;
    }

    swapSong(song: MachiSongContext) {
        const seedChanged = song.seed !== this.song.seed;
        this.song = song;
        this.lightningTimes = buildMachiLightningTimes(song.lines);
        // 天气“自动”按歌选：换歌可能换天气（渐变过去）。
        this.refreshEnvironmentTarget();
        const sceneId = resolveMachiSceneId(this.tuning, song.seed);
        if (sceneId !== this.targetSceneId || (seedChanged && this.stage.rebuildsForSeed)) {
            this.requestScene(sceneId);
        } else if (!this.pendingScene) {
            const palette = resolveMachiPalette(this.theme, song.seed, MACHI_SCENES[sceneId].resolveArt);
            this.blend.setTarget(palette, this.staticMode);
            this.stage.swapSong(song, this.sceneContent(palette));
            this.boardTarget = null;
        }
        this.wantsFrame = true;
        this.wake();
    }

    setTheme(theme: Theme) {
        const signature = themeKey(theme);
        this.theme = theme;
        if (signature === this.themeSignature) return;
        this.themeSignature = signature;
        this.blend.setTarget(resolveMachiPalette(theme, this.song.seed, MACHI_SCENES[this.stageId].resolveArt), this.staticMode);
        if (this.staticMode) this.syncColors();
        window.clearTimeout(this.signRepaintTimer);
        this.signRepaintTimer = window.setTimeout(() => {
            if (this.disposed) return;
            this.repaintSigns();
            this.wake();
        }, SIGN_REPAINT_DEBOUNCE_MS);
        this.wake();
    }

    /** 对焦深度（离镜头的距离）：画面中心、歌词屏，或画面中心往前往后挪。 */
    private focusDepth() {
        const tuning = this.tuning;
        if (tuning.focus === 'lyrics') return this.camera.depthOf(this.stage.focusPoint);
        const center = this.camera.focusDistance;
        return tuning.focus === 'manual' ? center + tuning.focusOffset : center;
    }

    /** 设置变了：场景不同就换场景；时间、天气渐变到新目标；镜头换到这个场景的新视角、开关运镜；景深下一帧就用新值。 */
    setTuning(tuning: MachiTuning) {
        const previous = this.tuning;
        if (previous === tuning) return;
        this.tuning = tuning;
        if (previous.scene !== tuning.scene) {
            const sceneId = resolveMachiSceneId(tuning, this.song.seed);
            if (sceneId !== this.targetSceneId) this.requestScene(sceneId);
        }
        if (previous.timeOfDay !== tuning.timeOfDay || previous.weather !== tuning.weather) this.refreshEnvironmentTarget();
        this.camera.setCustom(this.customView(this.stageId));
        this.camera.setMotion(tuning.motion, tuning.motionSpeed);
        if (qualityKey(previous.quality) !== qualityKey(tuning.quality)) {
            // 换了画质设置：自动降级从这套设置重新开始。
            this.degrade = 0;
            this.applyQuality();
        }
        this.wantsFrame = true;
        this.wake();
    }

    setPaused(paused: boolean) {
        this.paused = paused;
        this.clock.paused = this.paused || this.staticMode;
        this.wake();
    }

    setStaticMode(staticMode: boolean) {
        this.staticMode = staticMode;
        if (staticMode) this.refreshEnvironmentTarget(true);
        this.clock.paused = this.paused || this.staticMode;
        this.wake();
    }

    setShowText(showText: boolean) {
        if (this.showText === showText) return;
        this.showText = showText;
        this.boardTarget = null;
        this.wantsFrame = true;
        this.wake();
    }

    /** 暂停时外面要求补一帧（拖进度条、换行）。 */
    renderOnce() {
        this.wantsFrame = true;
        this.wake();
    }

    private installDebugHook() {
        window.__machiDebug = {
            // 调试时窗格可能在后台、没有 requestAnimationFrame：直接同步画一帧。
            setView: (azimuthDeg, elevationDeg, zoom) => {
                this.camera.placeAt({ azimuth: azimuthDeg * DEG, elevation: elevationDeg * DEG, zoom: zoom ?? this.camera.defaultView.zoom });
                this.renderFrame(performance.now());
            },
            resetView: () => {
                this.camera.placeAtRest();
                this.renderFrame(performance.now());
            },
            cameraOffset: () => this.camera.offset(),
            renderAt: (songSeconds: number, ambientSeconds?: number) => {
                this.options.currentTime.set(songSeconds);
                if (ambientSeconds !== undefined) this.clock.elapsed = ambientSeconds;
                this.renderFrame(performance.now());
            },
            nextCar: from => this.stage.nextCar?.(from, this.song.seed, TRAFFIC_CHANCE[this.theme.animationIntensity] ?? 0.6) ?? null,
            setTuning: (patch, transition = false) => {
                const sceneId = resolveMachiSceneId({ ...this.tuning, ...patch }, this.song.seed);
                if (!transition && sceneId !== this.targetSceneId) this.requestScene(sceneId, true);
                this.setTuning({ ...this.tuning, ...patch });
                if (!transition) this.refreshEnvironmentTarget(true);
                this.renderFrame(performance.now());
            },
            environment: () => ({ ...this.environment }),
            setDrumHits: hits => {
                this.debugDrumHits = hits;
                this.renderFrame(performance.now());
            },
            stats: () => {
                const average = this.frameTimes.length ? this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length : 0;
                return {
                    scene: this.stageId,
                    daylight: Math.round(this.environment.daylight * 100) / 100,
                    weather: resolveMachiWeatherKind(this.tuning.weather, this.song.seed),
                    calls: this.lastCalls,
                    triangles: this.lastTriangles,
                    geometries: this.renderer.info.memory.geometries,
                    textures: this.renderer.info.memory.textures,
                    programs: this.renderer.info.programs?.length ?? 0,
                    frameMs: Math.round(average * 100) / 100,
                    pixelRatio: this.pixelRatio,
                    antialias: this.renderQuality.antialias,
                    samples: this.renderQuality.samples,
                    degrade: this.renderQuality.degrade,
                    showText: this.showText ? 1 : 0,
                };
            },
            runtime: this,
        };
    }

    destroy() {
        if (this.disposed) return;
        this.disposed = true;
        this.stopLoop();
        window.clearTimeout(this.signRepaintTimer);
        window.clearInterval(this.clockTimer);
        this.resizeObserver.disconnect();
        this.camera.dispose();
        withdrawMachiShownScene(this);
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('webglcontextlost', this.onContextLost);
        this.stage.dispose();
        this.weather.dispose();
        this.materials.dispose();
        this.skyLights.dispose();
        this.reflection.dispose();
        this.post.dispose();
        this.sky.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        canvas.remove();
        if (window.__machiDebug?.runtime === this) delete window.__machiDebug;
    }
}
