import type * as THREE from 'three';
import type { Line, Theme } from '../../../../types';
import type { MachiSongContext } from '../createMachiRuntime';
import type { MachiBeatFrame } from '../engine/beatFx';
import type { MachiCameraFraming } from '../engine/camera';
import type { MachiBoardTarget } from '../engine/director';
import type { MachiEnvironmentLook, MachiEnvironmentState } from '../engine/environment';
import type { MachiAtmosphereFrame } from '../engine/fx/post';
import type { MachiWeatherLayout } from '../engine/fx/weather';
import type { MachiGeometryCache } from '../engine/geometry/shapes';
import type { MachiColorBlend, MachiMaterials } from '../engine/materials';
import type { MachiArtResolver, MachiPalette } from '../engine/palette';
import type { MachiFont } from '../engine/signRaster';

// src/components/visualizer/machi/scenes/types.ts
// 场景与引擎之间的约定。引擎（createMachiRuntime.ts）管渲染器、镜头、天光、天气、地面、倒影、后处理、时钟和编排；
// 场景管自己的几何、灯、招牌和会动的东西，每帧按 MachiSceneFrame 推一步。换场景时引擎拆掉旧场景、建新场景，
// WebGL 上下文和后处理都留着。

export interface MachiSceneContext {
    /** 场景自己的一份材质（场景拆掉时一起销毁），与引擎共用 ColorBlend。 */
    materials: MachiMaterials;
    blend: MachiColorBlend;
    /** 场景自己的几何缓存（场景拆掉时一起销毁）。 */
    geometryCache: MachiGeometryCache;
    song: MachiSongContext;
    previewMode: boolean;
    /** 场景里的东西动了，下一帧重画阴影图（开关门）。 */
    invalidateShadows: () => void;
}

/** 换歌、换主题时重画招牌要的东西。 */
export interface MachiSceneContent {
    song: MachiSongContext;
    theme: Theme;
    palette: MachiPalette;
    font: MachiFont;
    /** 主题图标（已加载、已规范化的名字），可能是空的。 */
    icons: string[];
    fallbacks: readonly string[];
}

export interface MachiSceneFrame {
    songTime: number;
    ambientTime: number;
    delta: number;
    staticMode: boolean;
    /** 静态模式或暂停：换牌面不做动画。 */
    immediate: boolean;
    showText: boolean;
    seed: string | number;
    lines: readonly Line[];
    /** 此刻的牌面；牌面变了时 targetChanged 为 true。 */
    target: MachiBoardTarget;
    targetChanged: boolean;
    /** 下一行快到了：空闲时先画好。 */
    preheat: MachiBoardTarget | null;
    /** 副歌权重（平滑后）、音频包络、招牌闪烁（亮度倍数）。 */
    chorus: number;
    audio: number;
    flicker: number;
    /** 雨量（0..1 附近，音频与副歌推它）。 */
    rain: number;
    /** 每个窗口有车开过的概率。 */
    trafficChance: number;
    /** 时间与天气此刻的状态（渐变中的），和由它推出的灯光标量（人造光、路灯……）。 */
    environment: MachiEnvironmentState;
    look: MachiEnvironmentLook;
    /** 每个世界单位多少像素（粒子按它定大小）。 */
    pixelsPerUnit: number;
    /** 后处理的氛围参数：场景填雾里的两处灯（位置与颜色）。 */
    atmosphere: MachiAtmosphereFrame;
    /** 智能动感模式这一帧的量（engine/beatFx.ts）：霓虹、暖色灯的亮度倍数，光斑的一跳，歌词屏的闪拍。 */
    beat: MachiBeatFrame;
}

export interface MachiScene {
    /** 场景的整棵树（已合批的静态部分 + 灯、招牌、会动的东西）。 */
    readonly root: THREE.Group;
    readonly framing: MachiCameraFraming;
    readonly weather: MachiWeatherLayout;
    /** 倒影的镜像平面高度。 */
    readonly reflectionPlaneY: number;
    /** 路面与场地 / 人行道的顶面：引擎给它们装湿地面材质。 */
    readonly surfaces: { road: THREE.Mesh[]; lot: THREE.Mesh[] };
    /** 水洼噪声的平移与覆盖量（按歌变）。 */
    readonly puddles: { offset: [number, number]; amount: number };
    /** 歌词屏的中心：景深对焦在歌词上时对着它。 */
    readonly focusPoint: THREE.Vector3;
    setContent(content: MachiSceneContent): void;
    swapSong(song: MachiSongContext, content: MachiSceneContent): void;
    direct(frame: MachiSceneFrame): void;
    /** 插值后的颜色写回场景的材质、灯、实例色。 */
    syncColors(): void;
    /** 场景里有动画在走（换牌面）：暂停时也要继续出帧。 */
    readonly busy: boolean;
    /** 换了一首 seed 不同的歌时整个场景重建（车位、车色这些建场景时按 seed 定死的东西）。 */
    readonly rebuildsForSeed?: boolean;
    /** 调试钩子用：从氛围时间 from 往后找下一辆开到路中间的车。 */
    nextCar?(from: number, seed: string | number, chance: number): number | null;
    dispose(): void;
}

export interface MachiSceneDefinition {
    /** 场景自己的颜色（墙、货架……）。 */
    resolveArt: MachiArtResolver;
    create(context: MachiSceneContext): MachiScene;
}
