import type { FoliumLabel, FoliumSetting } from '../../mods/folium/contract';
import type { DualTheme, Line } from '../../types';

// src/components/scenes/definition.ts
// 场景的契约：场景作者只依赖这个文件（和可选的 kit/）。一个场景 = 一份纯数据的清单 + 第一次显示时才加载的运行体。
// 内建、模组、数据包三种来源最后都变成 SceneDefinition，宿主分不出来。
//
// 约定（定了就不改）：
// - 清单是纯数据，能原样写成 JSON（数据包的 scene.json 和内建场景 entry.ts 里的清单是同一个形状）。
// - 坐标单位是米，Y 轴朝上，右手坐标，和 glTF 一致。
// - 听者和摄像机分开：ctx.sound 里没有任何读摄像机的地方，听者只能是一个座位锚点或一个显式的位置。
// - 场景 id 的三种前缀见 src/types/sceneIds.ts：内建 `cinema`，模组 `mod:<模组>:<id>`，数据包 `pkg:<id>`。
// - 契约里没有 three.js 和 React：场景拿到一个盒子（ctx.container），怎么画都行。

/** 场景接口的版本。清单的 `engine` 写它能用的范围，比如 '^1.0'；1.x 之内接口只增不改。 */
export const SCENE_ENGINE_VERSION = '1.0.0';

export type SceneQualityPreset = 'low' | 'medium' | 'high';

/** 米，Y 朝上，右手坐标。 */
export type Vec3 = readonly [number, number, number];

export interface Pose {
    position: Vec3;
    /** 看向的点；没有时朝 -z。 */
    lookAt?: Vec3;
}

/** 盒子里的一点，CSS 像素，左上角为原点。 */
export interface ScreenPoint {
    x: number;
    y: number;
    /**
     * 齐次坐标的 w：给了时 x、y 是乘过 w 的，屏幕上的点是 (x / w, y / w)，w ≤ 0 的角在镜头后面。
     * 四个角都带 w 时，宿主按这块平面在 3D 里的位置贴（角要是 3D 里的平行四边形），镜头后面的部分由浏览器裁掉，
     * 所以只要还看得到一角，表面就照常显示。kit 的 threeStage.projectQuad 给的就是这种角。
     */
    w?: number;
}

/** 一个表面四个角在盒子里的位置：左上、右上、右下、左下。 */
export type ScreenQuad = readonly [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint];

/** 用户选的歌词样式、背景放到哪里：不能用、整窗叠在上面（歌词）或放在后面（背景）、贴到某个表面上。 */
export type SceneLyricPlacement = 'none' | 'overlay' | { surface: string };

/** 表面上场景自己的画面是暗还是亮（和 DualTheme 的两个键同名）。 */
export type SceneSurfaceTone = 'dark' | 'light';
export type SceneBackgroundPlacement = 'none' | 'behind' | { surface: string };

export interface SceneManifest {
    /** 包的文件格式版本。宿主读不懂的格式就拒绝加载。 */
    format: 1;
    /** 要求的场景接口版本范围，如 '^1.0'。 */
    engine: string;
    id: string;
    /** 场景自己的版本；存下来的设置和缓存都带着它。 */
    version: string;
    name: FoliumLabel;
    description?: FoliumLabel;
    /** 选择器里的图（数据包里的相对路径，或内建场景打包后的地址）。 */
    preview?: string;
    order?: number;
    /**
     * 宿主可以贴东西的平面。`occludable`：前面的东西会挡住它（场景要在那里留透明的洞）。
     * `tone`（1.x 新增）：这个表面上场景自己的画面是暗还是亮。只贴歌词、没贴用户背景时，宿主按它给歌词样式
     * 歌曲主题里对应的那一个（暗画面配暗主题），不跟 app 的亮暗模式走；没写时歌词样式和播放页一样。
     */
    surfaces?: { id: string; aspect: number; occludable?: boolean; tone?: SceneSurfaceTone }[];
    /**
     * 歌词永远是用户选的歌词样式，场景不自己画歌词：`style` 放在哪（'none' 这个场景不显示歌词）；
     * `exclude` 放上去不合适的样式 id：用户选了（或随机抽到）这种样式时，宿主在场景里改显示第一个合适的；选择器不受影响。
     */
    lyrics: { style: SceneLyricPlacement; exclude?: string[] };
    /** 背景永远是用户选的背景：`host` 放在哪（'none' 这个场景不用背景，它自己就是画面）；`exclude` 同上。 */
    background: { host: SceneBackgroundPlacement; exclude?: string[] };
    /** 场景发布了座位锚点时，宿主给一张座位图。 */
    viewpoints?: 'anchors' | 'none';
    sound?: { acoustics: 'mesh' | 'none'; music: 'speakers' | 'off' };
    /** 低/中/高三档各自的值；用户自己选，宿主从不自动调。 */
    quality: { presets: Record<SceneQualityPreset, Record<string, number | boolean>>; default: SceneQualityPreset };
    /** 场景的设置表，格式和 Folium 模组的一样；宿主画表单、存值、进导入导出。 */
    settings?: FoliumSetting[];
}

// ---------------------------------------------------------------- 锚点

/** 场景里一个有名字、有用途的位置。宿主和声音引擎只通过锚点理解场景。数据场景用 glTF 空物体的名字：`viewpoint.R7-12`、`speaker.L`、`surface.screen`。 */
export type SceneAnchor =
    | { kind: 'surface'; id: string; corners: readonly [Vec3, Vec3, Vec3, Vec3] }
    | { kind: 'viewpoint'; id: string; ear: Vec3; eye: Vec3; lookAt: Vec3; row?: string; number?: number; occupied?: boolean; preferred?: boolean }
    | { kind: 'speaker'; id: 'L' | 'R' | 'C'; position: Vec3 }
    | { kind: 'emitter'; id: string; position: Vec3 }
    | { kind: 'lyricPlace'; id: string; surface: string; rect: { x: number; y: number; width: number; height: number } }
    | { kind: 'path'; id: string; points: readonly { position: Vec3; lookAt: Vec3; seconds: number }[] }
    /** 可以挂内容的位置（墙上的海报框）：让模组往别人的场景里加东西。第一期只定类型。 */
    | { kind: 'slot'; id: string; pose: Pose; size?: readonly [number, number]; accepts?: string[] };

export type SceneAnchorKind = SceneAnchor['kind'];

// ---------------------------------------------------------------- 信号

/** 前奏、唱着、句间、间奏、尾奏、纯音乐（没有歌词）。宿主统一算，场景不自己扫歌词。 */
export type LyricPhase = 'intro' | 'singing' | 'between-lines' | 'interlude' | 'outro' | 'instrumental';

export interface SceneSong {
    seed: string | number | null;
    title: string | null;
    artist: string | null;
    album: string | null;
    coverUrl: string | null;
    /**
     * 歌曲的一对主题（亮、暗两个，带用户的歌词字体）。不跟 app 的亮暗模式走：场景按自己的画面挑一个
     * （影厅是暗的，用 dark）。app 现在的模式在 ctx.display.isDaylight()。
     */
    theme: DualTheme;
    /** 秒；不知道时为 0。 */
    duration: number;
}

export interface SongSignals {
    current(): SceneSong;
    /** 自动混音交接时下一首和交接进度（0..1），没在交接时为 null。 */
    handoff(): { song: SceneSong; progress: number } | null;
}

export interface LyricSignals {
    lines(): readonly Line[];
    /** 当前行，没有时为 -1。 */
    lineIndex(): number;
    phase(): LyricPhase;
    /** 离下一句开始还有几秒；后面没有了为 Infinity。 */
    nextLineIn(): number;
}

export interface MusicBands {
    bass: number;
    lowMid: number;
    mid: number;
    vocal: number;
    treble: number;
}

/** 唱片类音效的强度，0..1；场景用它让画面跟着「变旧」。 */
export interface MusicCharacter {
    saturation: number;
    bitcrush: number;
    wobble: number;
    vinylNoise: number;
    filter: number;
}

export interface MusicSignals {
    /** 总能量 0..1。 */
    power(): number;
    /** 五个频段，0..1。 */
    bands(): MusicBands;
    /** 智能动感模式开着时的拍点包络 0..1，没有时为 0。 */
    beat(): number;
    character(): MusicCharacter;
}

export interface PlayerSignals {
    paused(): boolean;
    /** 歌词时间（秒，含歌词偏移），歌词和画面按它走。 */
    lyricTime(): number;
}

export interface SceneEvents {
    songChange: { song: SceneSong };
    blendStart: { next: SceneSong };
    lineChange: { index: number; line: Line | null };
    phaseChange: { phase: LyricPhase; previous: LyricPhase };
    play: Record<string, never>;
    pause: Record<string, never>;
    seek: { time: number };
    /** 歌单放完了，播放停在最后一首的结尾。 */
    queueEnd: Record<string, never>;
}

export type Disposer = () => void;

// ---------------------------------------------------------------- 声音（接口先定好，第二期接上）

/** 房间的形状和材质（米）。 */
export interface AcousticWorld {
    meshes: {
        id: string;
        positions: Float32Array;
        indices: Uint32Array;
        triangleMaterials: Uint16Array;
        /** 声学材质 id。 */
        materials: string[];
        /** 会动的（门、幕帘），只能整体移动。 */
        dynamic?: boolean;
    }[];
}

export type SceneSoundAudible = 'always' | 'noVocals' | 'paused';

export interface SoundHandle {
    stop(): void;
}

/** 场景看到的声音一面。第一期是什么都不做的实现（tier 'off'）；房间声在第二期接到这里，场景代码不用改。 */
export interface SceneSound {
    /** 房间的形状和材质；加载时交一次，房间变了再交。 */
    setAcoustics(world: AcousticWorld): void;
    moveObject(id: string, matrix: ArrayLike<number>): void;
    /** 听者；宿主默认放在用户选的座位上。不跟摄像机。 */
    setListener(pose: Pose | { viewpoint: string }): void;
    play(clip: string, at: Pose | { emitter: string }, options?: { loop?: boolean; gainDb?: number; audible?: SceneSoundAudible }): SoundHandle;
    readonly tier: 'realtime' | 'cached' | 'baked' | 'estimated' | 'off';
}

// ---------------------------------------------------------------- 上下文和运行体

export interface SceneContext {
    /** 场景的盒子；画布由场景自己放进去，或用 kit/threeStage。 */
    readonly container: HTMLElement;
    readonly manifest: SceneManifest;
    readonly host: { kind: 'player' | 'preview' | 'obs'; staticMode: boolean; reducedMotion: boolean };
    readonly song: SongSignals;
    readonly lyrics: LyricSignals;
    readonly music: MusicSignals;
    readonly player: PlayerSignals;
    /**
     * 按住拖动转头：上次调用以来拖过的角度（弧度，向左、向上为正），拿走就清零。
     * 按下不动就松开是点击，照常落到歌词上；拖过之后的那次点击宿主吞掉。
     */
    readonly input: { look(): { yaw: number; pitch: number } };
    readonly display: { isDaylight(): boolean; showText(): boolean; lyricsFontScale(): number };
    readonly settings: { get(): Record<string, unknown>; onChange(fn: () => void): Disposer };
    /** 用户换画质时场景不重载：onChange 里就地用新值（kit 的 threeStage 换分辨率）。 */
    readonly quality: { preset(): SceneQualityPreset; get(key: string): number | boolean | undefined; onChange(fn: () => void): Disposer };
    readonly anchors: { add(anchor: SceneAnchor): void; list<K extends SceneAnchorKind>(kind: K): Extract<SceneAnchor, { kind: K }>[] };
    /**
     * 每帧告诉宿主一个表面的四个角在盒子里的位置，宿主把借来的歌词样式、背景贴上去（清单写了贴什么；
     * 贴着背景的表面，场景要在那里留透明的洞）。传 null 时盒子藏起来，也不接点击。
     * opacity（1.x 新增，默认 1）：贴上去的东西有多亮，比如放映机遮光板关上时荧幕上什么都没有。
     */
    readonly surfaces: {
        place(id: string, cornersOnScreen: ScreenQuad | null, look?: { opacity?: number }): void;
        /**
         * 这个表面现在显示的画面（用户的歌词样式和背景，看到的样子），缩成 width × height（每边最多 64）。
         * 拿不到时为 null：网页版、表面没放上或在窗口外、窗口最小化。要截窗口，一秒几次就够。
         */
        sample(id: string, width: number, height: number): Promise<ImageBitmap | null>;
    };
    /** 用户在座位图上选的座位锚点 id，没选时为 null（场景用自己的 preferred 座位）。 */
    readonly viewpoints: { chosen(): string | null };
    readonly sound: SceneSound;
    on<K extends keyof SceneEvents>(type: K, fn: (event: SceneEvents[K]) => void): Disposer;
    /** 第一帧画好了；宿主这时才把场景露出来。 */
    ready(): void;
    log: { info(message: string, ...rest: unknown[]): void; warn(message: string, ...rest: unknown[]): void };
}

export interface SceneRuntime {
    /** 每帧一次；暂停时 dt 为 0。秒。 */
    frame: (frame: { dt: number; now: number }) => void;
    resize?: (size: { width: number; height: number; dpr: number }) => void;
    dispose: () => void;
}

export type SceneFactory = (ctx: SceneContext) => SceneRuntime | Promise<SceneRuntime>;

export interface SceneDefinition {
    manifest: SceneManifest;
    /** 第一次显示时才调；返回建运行体的函数。 */
    load: () => Promise<SceneFactory>;
}

export interface SceneEntryModule {
    default: SceneDefinition;
}

export const defineScene = (definition: SceneDefinition) => definition;

// ---------------------------------------------------------------- 清单校验

const isPlacement = (value: unknown, words: readonly string[]) => (
    (typeof value === 'string' && words.includes(value))
    || (typeof value === 'object' && value !== null && typeof (value as { surface?: unknown }).surface === 'string')
);

/** 宿主读得懂的 engine 范围：主版本是 1。 */
const engineRangeFits = (range: unknown) => typeof range === 'string' && /^[\^~]?1(\.\d+){0,2}$/.test(range.trim());

/**
 * What is wrong with a manifest, as plain sentences; empty when the host can use it. Built-in scenes,
 * mod scenes and data packages are checked by this same function.
 */
export const checkSceneManifest = (manifest: unknown): string[] => {
    if (typeof manifest !== 'object' || manifest === null) return ['manifest is not an object'];
    const m = manifest as Partial<SceneManifest>;
    const problems: string[] = [];
    if (m.format !== 1) problems.push(`format ${String(m.format)} is not 1`);
    if (!engineRangeFits(m.engine)) problems.push(`engine "${String(m.engine)}" does not fit ${SCENE_ENGINE_VERSION}`);
    if (typeof m.id !== 'string' || m.id === '') problems.push('id is missing');
    if (typeof m.version !== 'string' || m.version === '') problems.push('version is missing');
    if (typeof m.name !== 'object' || m.name === null) problems.push('name is missing');
    if (!m.lyrics || !isPlacement(m.lyrics.style, ['none', 'overlay'])) problems.push('lyrics is not { style }');
    if (!m.background || !isPlacement(m.background.host, ['none', 'behind'])) problems.push('background is not { host }');
    const surfaceIds = new Set((m.surfaces ?? []).map(surface => surface.id));
    for (const surface of m.surfaces ?? []) {
        if (surface.tone !== undefined && surface.tone !== 'dark' && surface.tone !== 'light') problems.push(`surface "${surface.id}" tone is not 'dark' or 'light'`);
    }
    for (const placement of [m.lyrics?.style, m.background?.host]) {
        if (typeof placement === 'object' && placement !== null && !surfaceIds.has(placement.surface)) {
            problems.push(`surface "${placement.surface}" is not in surfaces`);
        }
    }
    const presets = m.quality?.presets;
    if (!presets || !presets.low || !presets.medium || !presets.high || !m.quality || !presets[m.quality.default]) {
        problems.push('quality needs low, medium and high presets and a default among them');
    }
    return problems;
};
