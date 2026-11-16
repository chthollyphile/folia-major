import * as THREE from 'three';
import type { MotionValue } from 'framer-motion';
import type { Line, LyricRenderScale, Theme } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { resolveLyricPixelRatio } from '../../../utils/lyricRenderQuality';
import { BEAT_EFFECT_IDS } from '../../../services/beatFx/beatEffects';
import { getBeatEffectStrength, getBeatFxEvents, getBeatFxTrackScale, isBeatFxReady } from '../../../services/beatFx/beatFxLive';
import type { BeatFxEvent } from '../../../services/beatFx/clock';
import { createVisualizerRng } from '../visualizerSeedHash';
import { buildWordColorRangesFromMatchers, prepareWordColorMatchers, resolveTokenColorMap } from '../wordColoring';
import { snapMetaphorCollisions, writeMetaphorBeatRings } from './metaphorBeatFx';
import {
    METAPHOR_EMPTY_STAGE,
    resolveMetaphorMelt,
    resolveMetaphorPose,
    resolveMetaphorReveal,
    resolveMetaphorStillPose,
    resolveMetaphorTransitionFx,
    type MetaphorPose,
    type MetaphorTransitionFx,
} from './metaphorCamera';
import { layoutMetaphorNotes, planMetaphorBackdrop, planMetaphorFigures } from './metaphorFigures';
import { buildMetaphorAtlas, METAPHOR_GLYPH_WORLD, METAPHOR_NOTE_PREFIX, MetaphorGlyphSource } from './metaphorGlyphs';
import { buildMetaphorLayout, buildMetaphorTextTokens, buildMetaphorTokens, type MetaphorLayout, type MetaphorToken } from './metaphorLayout';
import { resolveMetaphorKeywordColor, resolveMetaphorPalette, type MetaphorPalette } from './metaphorPalette';
import {
    compileMetaphorProgram,
    findMetaphorCue,
    findMetaphorShot,
    resolveMetaphorCueTime,
    type MetaphorCue,
    type MetaphorProgram,
} from './metaphorProgram';
import {
    METAPHOR_DEVELOP_FRAGMENT,
    METAPHOR_DEVELOP_VERTEX,
    METAPHOR_GLYPH_FRAGMENT,
    METAPHOR_GLYPH_VERTEX,
    METAPHOR_SHAPE_FRAGMENT,
    METAPHOR_SHAPE_VERTEX,
} from './metaphorShaders';
import {
    METAPHOR_COLLISION_APPROACH,
    METAPHOR_COLLISION_LIFE,
    METAPHOR_SHAPE_CAPACITY,
    METAPHOR_SHAPE_STRIDE,
    planMetaphorShapes,
    planMetaphorCollisions,
    writeMetaphorCollisions,
    writeMetaphorPairs,
    writeMetaphorShapes,
    type MetaphorCollision,
    type MetaphorShape,
} from './metaphorShapes';
import type { MetaphorTuning } from './types';

// src/components/visualizer/metaphor/createMetaphorRuntime.ts
// 隐喻的运行时：一个 three.js 的 WebGL 上下文，建一次；换歌、换主题、换设置、暂停都就地推给它（外壳用 useVisualizerPixiHost 托管）。
// 每帧两遍：字形和融球用加法混合画进墨场（半浮点离屏图），再全屏显影成纸、墨、网点和颗粒（metaphorShaders.ts）。
// 画什么只由播放时间决定：分镜表（metaphorProgram.ts）说这一刻是哪个 cue、哪个镜头，镜头的机位由 metaphorCamera.ts 算。
// 一个 cue 一套东西（排版、图集、几何、融球规划、线稿和版面），按需建、提前一个备好，只留当前的和相邻的。
// 自己的 requestAnimationFrame 循环（全局限帧已经管着它）；暂停时不跑，拖进度时由外壳补一帧。时间只在循环里读 currentTime，不进 React。

export interface MetaphorSong {
    seed: string | number;
    lines: Line[];
    title: string;
}

export interface MetaphorRuntimeOptions {
    host: HTMLDivElement;
    song: MetaphorSong;
    theme: Theme;
    tuning: MetaphorTuning;
    renderScale: LyricRenderScale;
    currentTime: MotionValue<number>;
    audioPower: MotionValue<number>;
    paused: boolean;
    staticMode: boolean;
    showText: boolean;
    /** 播放页透明：纸不画，画布带 alpha（切换时外壳重建运行时）。 */
    seeThrough: boolean;
    /** WebGL 上下文丢了：外壳重建运行时。 */
    onContextLost: () => void;
    signal: AbortSignal;
}

interface MetaphorSet {
    layout: MetaphorLayout;
    shapes: MetaphorShape[];
    collisions: MetaphorCollision[];
    /** 「湮灭对撞」开着时用的那一组：对撞挪到了拍上。按哪张节拍表挪的记在 from 里，表换了重挪。 */
    snapped?: { from: readonly BeatFxEvent[]; collisions: MetaphorCollision[] };
    mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null;
    texture: THREE.DataTexture | null;
}

interface MetaphorDebugHook {
    /** 按这个播放时间同步画一帧，之后的帧也停在这一刻；传 null 回到跟着歌走。 */
    renderAt: (seconds: number | null) => void;
    program: () => MetaphorProgram;
    /** 这一刻的 cue 序号、镜头种类、转场。 */
    shotAt: (seconds: number) => { cue: number; kind: string; transition: string; invert: boolean };
    runtime: MetaphorRuntime;
}

declare global {
    interface Window {
        __metaphorDebug?: MetaphorDebugHook;
    }
}

/** 换主题时要重排的那部分（字体、关键词、动效强度）；只改颜色不算。 */
const themeLayoutKey = (theme: Theme) => [
    resolveThemeFontStack(theme), resolveThemeFontWeight(theme, DEFAULT_WEIGHT), theme.animationIntensity,
    (theme.wordColors ?? []).map(entry => `${entry.word}:${entry.color}`).join(','),
].join('|');

/** 注记的字在字形几何里的结束时间：着色器靠它认出注记（metaphorShaders.ts）。 */
const NOTE_END = -100000;
/** 主题没指定字重时用的：纤细的一档（用户定的）。墨切出来本来就比字形胖一圈，细字读得更清楚。 */
const DEFAULT_WEIGHT = 300;
/** 装饰跟着一张位移场抖多远（世界单位，「流体」是 1 时）。 */
const WOBBLE = 0.05;
/** 提前多久把下一个 cue 备好。 */
const PREPARE_LEAD = 2.5;
/** 网点格子的基础大小（CSS 像素）。 */
const DOT_SIZE = 7;
const DEG = Math.PI / 180;

const additive = (material: THREE.ShaderMaterial) => {
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.depthTest = false;
    material.depthWrite = false;
    material.transparent = true;
    material.side = THREE.DoubleSide;
    return material;
};

export class MetaphorRuntime {
    private readonly renderer: THREE.WebGLRenderer;
    private readonly fieldTarget: THREE.WebGLRenderTarget;
    private readonly fieldScene = new THREE.Scene();
    private readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 400);
    private readonly developScene = new THREE.Scene();
    private readonly developCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    private readonly glyphMaterial: THREE.ShaderMaterial;
    private readonly shapeMaterial: THREE.ShaderMaterial;
    private readonly developMaterial: THREE.ShaderMaterial;
    private readonly shapeData = new Float32Array(METAPHOR_SHAPE_CAPACITY * METAPHOR_SHAPE_STRIDE);
    private readonly shapeBuffer: THREE.InstancedInterleavedBuffer;
    private readonly shapeGeometry = new THREE.InstancedBufferGeometry();
    private readonly developGeometry = new THREE.BufferGeometry();
    private readonly glyphs: MetaphorGlyphSource;
    private readonly sets = new Map<number, MetaphorSet>();
    private readonly fx: MetaphorTransitionFx = { flood: 0 };
    private readonly resizeObserver: ResizeObserver;
    private program: MetaphorProgram;
    private shown: MetaphorSet | null = null;
    private song: MetaphorSong;
    private theme: Theme;
    private themeKey: string;
    private tuning: MetaphorTuning;
    private renderScale: LyricRenderScale;
    private paused: boolean;
    private staticMode: boolean;
    private showText: boolean;
    private fontReady: boolean;
    private width = 0;
    private height = 0;
    private pixelRatio = 1;
    /** 摆线稿时用的宽高比。 */
    private layoutAspect = 1.6;
    private raf = 0;
    private disposed = false;
    /** 音量 0..1（起音快、释放慢）；见过大于 1 的值就按 0..255 换算（主播放器是 0..255，预览是 0..1）。 */
    private audio = 0;
    private palette: MetaphorPalette | null = null;
    private paletteKey = '';
    private audioRaw = false;
    private audioAt = 0;
    private debugTime: number | null = null;

    /** 建运行时并画好第一帧（换样式的过渡等它）。 */
    static async create(options: MetaphorRuntimeOptions) {
        options.signal.throwIfAborted();
        const runtime = new MetaphorRuntime(options);
        try {
            // 主题字体可能还在路上：等它一小会儿，免得第一句用回退字体画出来再整个换掉
            if (!runtime.fontReady) await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 400))]);
            options.signal.throwIfAborted();
            runtime.fontReady = runtime.glyphs.fontReady();
            runtime.render();
            runtime.renderer.domElement.style.visibility = '';
            runtime.requestFrame();
        } catch (error) {
            runtime.destroy();
            throw error;
        }
        return runtime;
    }

    private constructor(private readonly options: MetaphorRuntimeOptions) {
        this.song = options.song;
        this.theme = options.theme;
        this.themeKey = themeLayoutKey(options.theme);
        this.tuning = options.tuning;
        this.renderScale = options.renderScale;
        this.paused = options.paused;
        this.staticMode = options.staticMode;
        this.showText = options.showText;
        // 会抛错的两样（拿不到 2D 画布、编分镜）放在建 WebGL 上下文之前：抛了也没有上下文要收
        this.glyphs = new MetaphorGlyphSource(resolveThemeFontStack(options.theme), resolveThemeFontWeight(options.theme, DEFAULT_WEIGHT));
        this.fontReady = this.glyphs.fontReady();
        this.program = this.compile();

        this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: options.seeThrough, depth: false, stencil: false, powerPreference: 'high-performance' });
        this.renderer.autoClear = false;
        this.renderer.debug.checkShaderErrors = import.meta.env.DEV;
        const canvas = this.renderer.domElement;
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;visibility:hidden';
        options.host.appendChild(canvas);

        // 墨场要能加过 1（几个融球叠在一起）：半浮点；这台机器画不了半浮点时退回 8 位，叠多了会封顶，画面只是略平
        const floatTarget = this.renderer.extensions.has('EXT_color_buffer_float') || this.renderer.extensions.has('EXT_color_buffer_half_float');
        this.fieldTarget = new THREE.WebGLRenderTarget(1, 1, {
            type: floatTarget ? THREE.HalfFloatType : THREE.UnsignedByteType,
            format: THREE.RGBAFormat,
            // 第二张是强调色的墨的颜色（metaphorShaders.ts 的 uTint）
            count: 2,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            stencilBuffer: false,
            generateMipmaps: false,
        });

        this.glyphMaterial = additive(new THREE.ShaderMaterial({
            vertexShader: METAPHOR_GLYPH_VERTEX,
            fragmentShader: METAPHOR_GLYPH_FRAGMENT,
            uniforms: { uAtlas: { value: null }, uTime: { value: 0 }, uReveal: { value: 1 }, uMelt: { value: 0 }, uPop: { value: 1 }, uShakeTime: { value: 0 }, uWobble: { value: WOBBLE } },
        }));
        this.shapeMaterial = additive(new THREE.ShaderMaterial({
            vertexShader: METAPHOR_SHAPE_VERTEX,
            fragmentShader: METAPHOR_SHAPE_FRAGMENT,
            uniforms: { uTime: { value: 0 }, uWobble: { value: WOBBLE }, uAccent: { value: new THREE.Vector3() } },
        }));

        this.shapeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
        this.shapeGeometry.setIndex([0, 1, 2, 0, 2, 3]);
        this.shapeBuffer = new THREE.InstancedInterleavedBuffer(this.shapeData, METAPHOR_SHAPE_STRIDE);
        this.shapeBuffer.setUsage(THREE.DynamicDrawUsage);
        this.shapeGeometry.setAttribute('iPos', new THREE.InterleavedBufferAttribute(this.shapeBuffer, 2, 0));
        this.shapeGeometry.setAttribute('iScale', new THREE.InterleavedBufferAttribute(this.shapeBuffer, 2, 2));
        this.shapeGeometry.setAttribute('iRot', new THREE.InterleavedBufferAttribute(this.shapeBuffer, 1, 4));
        this.shapeGeometry.setAttribute('iMix', new THREE.InterleavedBufferAttribute(this.shapeBuffer, 3, 5));
        this.shapeGeometry.setAttribute('iShape', new THREE.InterleavedBufferAttribute(this.shapeBuffer, 1, 8));
        this.shapeGeometry.setAttribute('iParam', new THREE.InterleavedBufferAttribute(this.shapeBuffer, 1, 9));
        this.shapeGeometry.instanceCount = 0;
        const shapeMesh = new THREE.Mesh(this.shapeGeometry, this.shapeMaterial);
        shapeMesh.frustumCulled = false;
        this.fieldScene.add(shapeMesh);

        this.developMaterial = new THREE.ShaderMaterial({
            vertexShader: METAPHOR_DEVELOP_VERTEX,
            fragmentShader: METAPHOR_DEVELOP_FRAGMENT,
            blending: THREE.NoBlending,
            depthTest: false,
            depthWrite: false,
            uniforms: {
                uField: { value: this.fieldTarget.textures[0] },
                uTint: { value: this.fieldTarget.textures[1] },
                uRes: { value: new THREE.Vector2(1, 1) },
                uPixelRatio: { value: 1 },
                uTime: { value: 0 },
                uFlow: { value: 1 },
                uGrain: { value: 1 },
                uDot: { value: DOT_SIZE },
                uAngle: { value: 0.5 },
                uFlood: { value: 0 },
                uInvert: { value: 0 },
                uSeed: { value: 0 },
                uSeeThrough: { value: options.seeThrough ? 1 : 0 },
                uPaper: { value: new THREE.Vector3() },
                uInk: { value: new THREE.Vector3() },
                uAccent: { value: new THREE.Vector3() },
                uTone: { value: new THREE.Vector3() },
            },
        });
        // 一个盖住全屏的三角形
        this.developGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
        const developMesh = new THREE.Mesh(this.developGeometry, this.developMaterial);
        developMesh.frustumCulled = false;
        this.developScene.add(developMesh);

        this.applyPalette();

        canvas.addEventListener('webglcontextlost', this.handleContextLost);
        document.fonts.addEventListener('loadingdone', this.handleFontsLoaded);
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(options.host);
        this.resize();

        // 先建的那个占着（播放页的）：设置窗口的小图后建后拆，不抢也不拆掉它
        if (import.meta.env.DEV && !window.__metaphorDebug) {
            window.__metaphorDebug = {
                renderAt: (seconds) => {
                    this.debugTime = seconds;
                    this.render();
                    this.requestFrame();
                },
                program: () => this.program,
                shotAt: (seconds) => {
                    const cueIndex = findMetaphorCue(this.program, seconds);
                    const cue = this.program.cues[cueIndex];
                    const shot = findMetaphorShot(cue, resolveMetaphorCueTime(cue, seconds));
                    return { cue: cueIndex, kind: shot.kind, transition: cue.transition, invert: shot.invert };
                },
                runtime: this,
            };
        }
    }

    swapSong(song: MetaphorSong) {
        this.song = song;
        this.rebuildProgram();
    }

    setTheme(theme: Theme) {
        const key = themeLayoutKey(theme);
        this.theme = theme;
        this.applyPalette();
        if (key !== this.themeKey) {
            this.themeKey = key;
            if (this.glyphs.setFont(resolveThemeFontStack(theme), resolveThemeFontWeight(theme, DEFAULT_WEIGHT))) this.fontReady = this.glyphs.fontReady();
            this.rebuildProgram();
        }
        this.requestFrame();
    }

    setTuning(tuning: MetaphorTuning) {
        const previous = this.tuning;
        this.tuning = tuning;
        // 切镜头的快慢、反相、转场是编进分镜表的；融球的多少是每个 cue 的规划里的
        if (previous.cutPace !== tuning.cutPace || previous.negative !== tuning.negative || previous.transitions !== tuning.transitions) this.rebuildProgram();
        else if (previous.blobs !== tuning.blobs || previous.keywordColors !== tuning.keywordColors) this.clearSets();
        if (previous.flip !== tuning.flip) this.applyPalette();
        this.requestFrame();
    }

    /** 分辨率倍数变了：就地换画布和墨场的尺寸，不重建上下文。 */
    setRenderScale(scale: LyricRenderScale) {
        if (scale === this.renderScale) return;
        this.renderScale = scale;
        this.resize();
    }

    setShowText(show: boolean) {
        this.showText = show;
        this.requestFrame();
    }

    setPlayback(paused: boolean, staticMode: boolean) {
        this.paused = paused;
        this.staticMode = staticMode;
        this.requestFrame();
    }

    /** 补画一帧（暂停时拖进度）；在跑循环时什么都不做。 */
    requestFrame() {
        if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.frame);
    }

    destroy() {
        if (this.disposed) return;
        this.disposed = true;
        cancelAnimationFrame(this.raf);
        this.resizeObserver.disconnect();
        document.fonts.removeEventListener('loadingdone', this.handleFontsLoaded);
        const canvas = this.renderer.domElement;
        canvas.removeEventListener('webglcontextlost', this.handleContextLost);
        this.clearSets();
        this.shapeGeometry.dispose();
        this.developGeometry.dispose();
        this.glyphMaterial.dispose();
        this.shapeMaterial.dispose();
        this.developMaterial.dispose();
        this.fieldTarget.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        canvas.remove();
        if (import.meta.env.DEV && window.__metaphorDebug?.runtime === this) delete window.__metaphorDebug;
    }

    private handleContextLost = (event: Event) => {
        event.preventDefault();
        if (this.disposed) return;
        cancelAnimationFrame(this.raf);
        this.options.onContextLost();
    };

    // 别的字体加载完也会触发：只在主题字体刚变成可用时重排（之前画的是回退字体）
    private handleFontsLoaded = () => {
        if (this.disposed) return;
        const ready = this.glyphs.fontReady();
        const arrived = ready && !this.fontReady;
        this.fontReady = ready;
        if (!arrived) return;
        this.glyphs.clear();
        this.clearSets();
        this.requestFrame();
    };

    private compile() {
        return compileMetaphorProgram(this.song.lines, {
            seed: this.song.seed,
            title: this.song.title,
            cutPace: this.tuning.cutPace,
            negative: this.tuning.negative,
            transitions: this.tuning.transitions,
            intensity: this.theme.animationIntensity,
        });
    }

    private rebuildProgram() {
        this.program = this.compile();
        this.clearSets();
        this.requestFrame();
    }

    private applyPalette() {
        const palette = resolveMetaphorPalette(this.theme, this.tuning.flip);
        const { uniforms } = this.developMaterial;
        (uniforms.uPaper.value as THREE.Vector3).fromArray(palette.paper);
        (uniforms.uInk.value as THREE.Vector3).fromArray(palette.ink);
        (uniforms.uAccent.value as THREE.Vector3).fromArray(palette.accent);
        (this.shapeMaterial.uniforms.uAccent.value as THREE.Vector3).fromArray(palette.accent);
        // 关键字的颜色是按纸和墨校过的，写在每个 cue 的几何里：纸墨变了要重建
        const key = [...palette.paper, ...palette.ink, ...palette.accent].join(',');
        if (this.palette && key !== this.paletteKey) this.clearSets();
        this.paletteKey = key;
        this.palette = palette;
        (uniforms.uTone.value as THREE.Vector3).fromArray(palette.tone);
    }

    private resize() {
        // 量排版尺寸，不量 getBoundingClientRect：样式小图把大舞台缩小了画，量到的会是缩小后的尺寸
        const { clientWidth: width, clientHeight: height } = this.options.host;
        if (width < 1 || height < 1) return;
        const pixelRatio = resolveLyricPixelRatio(Math.min(2, window.devicePixelRatio || 1), this.renderScale);
        if (width === this.width && height === this.height && pixelRatio === this.pixelRatio) return;
        this.width = width;
        this.height = height;
        this.pixelRatio = pixelRatio;
        this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        const pixelWidth = Math.max(1, Math.round(width * pixelRatio));
        const pixelHeight = Math.max(1, Math.round(height * pixelRatio));
        this.fieldTarget.setSize(pixelWidth, pixelHeight);
        (this.developMaterial.uniforms.uRes.value as THREE.Vector2).set(pixelWidth, pixelHeight);
        this.developMaterial.uniforms.uPixelRatio.value = pixelRatio;
        this.camera.aspect = width / height;
        // 线稿是按画面的宽高比摆的：比例变了不少（横竖互换、拉成长条）就重摆
        if (Math.abs(Math.log(width / height / this.layoutAspect)) > 0.25) {
            this.layoutAspect = width / height;
            this.clearSets();
        }
        this.requestFrame();
    }

    private disposeSet(set: MetaphorSet) {
        if (set.mesh) {
            this.fieldScene.remove(set.mesh);
            set.mesh.geometry.dispose();
        }
        set.texture?.dispose();
        if (this.shown === set) this.shown = null;
    }

    private clearSets() {
        this.sets.forEach(set => this.disposeSet(set));
        this.sets.clear();
    }

    /** 一个 cue 的那套东西：排版、图集、几何、融球规划。 */
    private buildSet(cueIndex: number): MetaphorSet {
        const cue = this.program.cues[cueIndex];
        const rng = createVisualizerRng(`metaphor:${this.song.seed}:${cueIndex}`);
        const line = cue.lineIndex >= 0 ? this.song.lines[cue.lineIndex] : null;
        const tokens = line ? buildMetaphorTokens(line) : cue.text ? buildMetaphorTextTokens(cue.text, cue.start - 10) : [];
        const layout: MetaphorLayout = tokens.some(token => !token.space)
            ? buildMetaphorLayout({
                tokens, composition: cue.composition, measure: this.glyphs.measure, rng,
                tints: line ? this.keywordTints(tokens) : undefined,
            })
            : { composition: 'block', glyphs: [], words: [], bounds: METAPHOR_EMPTY_STAGE };
        const interlude = cue.lineIndex < 0;
        const blobs = planMetaphorShapes(layout.bounds, rng, this.tuning.blobs, interlude);
        const collisions = planMetaphorCollisions(layout.bounds, rng, this.collisionTimes(cue, layout, rng), this.tuning.blobs, interlude);
        const backdrop = planMetaphorBackdrop(layout.bounds, rng, this.tuning.blobs, interlude, { index: cue.lineIndex + 1, time: cue.singStart });
        const figures = planMetaphorFigures(layout.bounds, rng, this.tuning.blobs, interlude, this.layoutAspect);
        // 版面的网点在最底下，线稿在最上面（都是加法，先后不影响结果，只是容量满了先丢后面的）
        const shapes = [...backdrop.shapes, ...blobs, ...figures.shapes];
        const notes = layoutMetaphorNotes([...backdrop.notes, ...figures.notes], this.glyphs.measureNote);
        // 字形几何里先是歌词的字，后面是注记的字（注记的开始时间是它冒出来的时刻，结束时间是 NOTE_END）
        const entries = [
            ...layout.glyphs.map(glyph => ({ ...glyph, key: glyph.char })),
            ...notes.map(note => ({
                key: METAPHOR_NOTE_PREFIX + note.char, x: note.x, y: note.y, size: note.size, rot: note.rot,
                t0: cue.start + note.born, t1: NOTE_END, accent: false, tint: null as string | null, seed: rng(),
            })),
        ];
        if (entries.length === 0) return { layout, shapes, collisions, mesh: null, texture: null };

        const atlas = buildMetaphorAtlas(this.glyphs, entries.map(entry => entry.key));
        const texture = new THREE.DataTexture(atlas.data, atlas.width, atlas.height, THREE.RGBAFormat, THREE.UnsignedByteType);
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;

        const count = entries.length;
        const positions = new Float32Array(count * 12);
        const offsets = new Float32Array(count * 8);
        const uvs = new Float32Array(count * 8);
        const times = new Float32Array(count * 8);
        const metas = new Float32Array(count * 12);
        const tints = new Float32Array(count * 12);
        const palette = this.palette ?? resolveMetaphorPalette(this.theme, this.tuning.flip);
        const tintCache = new Map<string, readonly number[]>();
        const tintOf = (color: string | null | undefined): readonly number[] => {
            if (!color) return palette.accent;
            let rgb = tintCache.get(color);
            if (!rgb) tintCache.set(color, rgb = resolveMetaphorKeywordColor(color, palette));
            return rgb;
        };
        const indices: number[] = [];
        // 四个角：左下、右下、右上、左上
        const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        entries.forEach((glyph, index) => {
            const half = (glyph.size * METAPHOR_GLYPH_WORLD) / 2;
            const cos = Math.cos(glyph.rot);
            const sin = Math.sin(glyph.rot);
            const [u0, v0, u1, v1] = atlas.rects.get(glyph.key) ?? [0, 0, 0, 0];
            const tint = tintOf(glyph.tint);
            CORNERS.forEach(([cx, cy], corner) => {
                const vertex = index * 4 + corner;
                positions.set([glyph.x, glyph.y, 0], vertex * 3);
                offsets.set([(cx * cos - cy * sin) * half, (cx * sin + cy * cos) * half], vertex * 2);
                // 图集数据的第一行是字的上沿
                uvs.set([cx < 0 ? u0 : u1, cy > 0 ? v0 : v1], vertex * 2);
                times.set([glyph.t0, glyph.t1], vertex * 2);
                metas.set([glyph.seed, glyph.accent ? 1 : 0, glyph.size], vertex * 3);
                tints.set(tint, vertex * 3);
            });
            indices.push(index * 4, index * 4 + 1, index * 4 + 2, index * 4, index * 4 + 2, index * 4 + 3);
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('aOffset', new THREE.BufferAttribute(offsets, 2));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        geometry.setAttribute('aTime', new THREE.BufferAttribute(times, 2));
        geometry.setAttribute('aMeta', new THREE.BufferAttribute(metas, 3));
        geometry.setAttribute('aTint', new THREE.BufferAttribute(tints, 3));
        geometry.setIndex(indices);
        const mesh = new THREE.Mesh(geometry, this.glyphMaterial);
        mesh.frustumCulled = false;
        return { layout, shapes, collisions, mesh, texture };
    }

    /**
     * 一句歌词每个 token 的关键字颜色（不是关键字的是 null）。匹配走各样式共用的 wordColoring：中日韩按短语包含、英文按词。
     * 「关键字着色」关着、主题没有关键字时全是 null。
     */
    private keywordTints(tokens: readonly MetaphorToken[]): Array<string | null> {
        const matchers = prepareWordColorMatchers(this.theme.wordColors, this.tuning.keywordColors);
        const none = tokens.map(() => null);
        if (matchers.length === 0) return none;
        const ranges = buildWordColorRangesFromMatchers(tokens.map(token => token.text).join(''), matchers);
        if (ranges.length === 0) return none;
        let offset = 0;
        const spans = tokens.map((token, index) => {
            const span = { key: String(index), timed: !token.space, startOffset: offset, endOffset: offset + token.text.length };
            offset += token.text.length;
            return span;
        });
        const colors = resolveTokenColorMap(spans, ranges);
        return tokens.map((_, index) => colors.get(String(index)) ?? null);
    }

    /** 一个 cue 里哪几个时刻对撞：歌词是隔几个词挑一个词的开唱时刻（卡在词上），间奏是隔几秒一次。 */
    private collisionTimes(cue: MetaphorCue, layout: MetaphorLayout, rng: () => number): number[] {
        if (cue.lineIndex >= 0) {
            const onsets = [...new Set(layout.words.map(word => word.t0))].sort((a, b) => a - b);
            const first = Math.floor(rng() * Math.min(3, onsets.length));
            return onsets.filter((_, index) => index >= first && (index - first) % 3 === 0).slice(0, 3);
        }
        const times: number[] = [];
        const end = cue.loop > 0 ? cue.start + cue.loop : cue.end;
        // 循环的 cue 里，最后一次的碎片要在折回去之前散完
        for (let at = cue.start + METAPHOR_COLLISION_APPROACH; at < end - METAPHOR_COLLISION_LIFE && times.length < 12; at += 5 + rng() * 4) times.push(at);
        return times;
    }

    /** 挪到拍上的那组对撞。循环的 cue 时间会折回去，对不上拍，不挪。 */
    private snappedCollisions(set: MetaphorSet, cue: MetaphorCue, events: readonly BeatFxEvent[]): MetaphorCollision[] {
        if (cue.loop > 0) return set.collisions;
        if (set.snapped?.from !== events) {
            set.snapped = { from: events, collisions: snapMetaphorCollisions(set.collisions, events, cue.start) };
        }
        return set.snapped.collisions;
    }

    /** 取（没有就建）一个 cue 的那套东西；只留它和前后相邻的。 */
    private ensureSet(cueIndex: number): MetaphorSet {
        let set = this.sets.get(cueIndex);
        if (!set) {
            set = this.buildSet(cueIndex);
            this.sets.set(cueIndex, set);
            this.sets.forEach((other, index) => {
                if (Math.abs(index - cueIndex) > 1) {
                    this.disposeSet(other);
                    this.sets.delete(index);
                }
            });
        }
        return set;
    }

    private show(set: MetaphorSet) {
        if (this.shown === set) return;
        if (this.shown?.mesh) this.fieldScene.remove(this.shown.mesh);
        this.shown = set;
        if (set.mesh) this.fieldScene.add(set.mesh);
        this.glyphMaterial.uniforms.uAtlas.value = set.texture;
    }

    private sampleAudio(now: number) {
        const raw = this.options.audioPower.get();
        if (raw > 1) this.audioRaw = true;
        const level = this.paused || !Number.isFinite(raw) ? 0 : Math.min(1, Math.max(0, this.audioRaw ? raw / 255 : raw));
        const dt = this.audioAt > 0 ? Math.min(0.1, (now - this.audioAt) / 1000) : 0.016;
        this.audioAt = now;
        this.audio += (level - this.audio) * (1 - Math.exp(-dt / (level > this.audio ? 0.3 : 0.9)));
    }

    private aim(pose: MetaphorPose) {
        this.camera.fov = pose.fov;
        // 永远正对画面：只有平移、远近和绕视线的滚转
        this.camera.position.set(pose.x, pose.y, pose.distance);
        this.camera.rotation.set(0, 0, pose.roll);
        this.camera.updateProjectionMatrix();
    }

    private render() {
        if (this.disposed || !this.width || !this.height) return;
        const still = this.staticMode;
        const tuning = this.tuning;
        const time = this.debugTime ?? this.options.currentTime.get();
        const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
        const cueIndex = findMetaphorCue(this.program, safeTime);
        const cue: MetaphorCue = this.program.cues[cueIndex];
        const built = !this.sets.has(cueIndex);
        const set = this.ensureSet(cueIndex);
        this.show(set);
        // 一帧最多建一个：这一帧没建当前的，才提前备下一个
        const following = cueIndex + 1;
        if (!built && following < this.program.cues.length && this.program.cues[following].start - safeTime < PREPARE_LEAD && !this.sets.has(following)) this.ensureSet(following);

        const cueTime = resolveMetaphorCueTime(cue, safeTime);
        const shot = findMetaphorShot(cue, cueTime);
        const fx = resolveMetaphorTransitionFx(this.program, cueIndex, safeTime, this.fx);
        const aspect = this.width / this.height;
        this.aim(still
            ? resolveMetaphorStillPose(set.layout, aspect)
            : resolveMetaphorPose({ shot, layout: set.layout, time: cueTime, aspect, motion: tuning.cameraMotion }));

        // 静态模式：字照常跟着唱，融球停在这个 cue 开头的样子，流场不动，没有转场
        const fluidTime = still ? cue.start : safeTime;
        this.sampleAudio(performance.now());
        const audio = still ? 0 : this.audio;
        const glyph = this.glyphMaterial.uniforms;
        glyph.uTime.value = safeTime;
        glyph.uReveal.value = resolveMetaphorReveal(cue, safeTime);
        glyph.uMelt.value = resolveMetaphorMelt(cue, safeTime);
        glyph.uPop.value = still ? 0 : 1;
        if (set.mesh) set.mesh.visible = this.showText;

        // 线稿一笔一笔冒出来；静态模式直接是画完的样子
        let count = writeMetaphorShapes(set.shapes, fluidTime, audio, tuning.flow, this.shapeData, still ? Number.POSITIVE_INFINITY : safeTime - cue.start);
        if (!still) {
            if (this.showText) count = writeMetaphorPairs(set.layout.glyphs, safeTime, this.shapeData, count);
            // 智能动感的「湮灭对撞」：对撞挪到拍上，平常的拍从对撞点放小环。没就绪、关着时走原来的那一组
            const strength = isBeatFxReady() ? getBeatEffectStrength(BEAT_EFFECT_IDS.metaphorAnnihilation) : 0;
            const events = strength > 0 ? getBeatFxEvents() : null;
            const collisions = events ? this.snappedCollisions(set, cue, events) : set.collisions;
            count = writeMetaphorCollisions(collisions, cueTime, this.shapeData, count);
            if (events) count = writeMetaphorBeatRings(collisions, events, safeTime, cueTime - safeTime, strength, getBeatFxTrackScale(), this.shapeData, count);
        }
        // 和流场一样每秒 8 格地跳
        this.shapeMaterial.uniforms.uTime.value = Math.floor(fluidTime * 8) / 8;
        glyph.uShakeTime.value = Math.floor(fluidTime * 8) / 8;
        glyph.uWobble.value = WOBBLE * tuning.flow;
        this.shapeMaterial.uniforms.uWobble.value = WOBBLE * tuning.flow;
        this.shapeGeometry.instanceCount = count;
        this.shapeBuffer.needsUpdate = true;

        const develop = this.developMaterial.uniforms;
        develop.uTime.value = fluidTime;
        develop.uFlow.value = still ? tuning.flow * 0.5 : tuning.flow * (1 + audio * 0.6);
        develop.uGrain.value = tuning.grain;
        develop.uDot.value = DOT_SIZE * tuning.halftone;
        develop.uAngle.value = still ? 30 * DEG : shot.screenAngle;
        develop.uFlood.value = still ? 0 : fx.flood;
        develop.uInvert.value = !still && shot.invert ? 1 : 0;
        develop.uSeed.value = still ? 0.37 : shot.seed;

        this.renderer.setRenderTarget(this.fieldTarget);
        this.renderer.setClearColor(0x000000, 0);
        this.renderer.clear();
        this.renderer.render(this.fieldScene, this.camera);
        this.renderer.setRenderTarget(null);
        this.renderer.render(this.developScene, this.developCamera);
    }

    private frame = () => {
        this.raf = 0;
        if (this.disposed) return;
        this.render();
        if (!this.paused && this.debugTime === null) this.raf = requestAnimationFrame(this.frame);
    };
}
