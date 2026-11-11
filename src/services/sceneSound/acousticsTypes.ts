// src/services/sceneSound/acousticsTypes.ts
// 房间声的两半之间唯一的约定：渲染进程（src/services/sceneSound/）把房间交过去，后台的声学进程
// （electron/acoustics/，Steam Audio）算好一枚 IR 交回来。单位：米，Y 朝上，右手系（和 glTF 一样）。

export type Vec3 = [number, number, number];

/** 一种声学材质。三个频段是 Steam Audio 的低、中、高（约 400 Hz、2.5 kHz、15 kHz）。 */
export interface AcousticMaterial {
    /** 吸收的能量，0..1。 */
    absorption: [number, number, number];
    /** 散射，0..1。 */
    scattering: number;
    /** 透过的能量，0..1。 */
    transmission: [number, number, number];
}

export interface RoomRequest {
    /** 缓存键：渲染进程把下面所有内容和 ROOM_FORMAT 一起算出来；键相同，IR 就相同。 */
    key: string;
    meshes: { positions: Float32Array; indices: Uint32Array; triangleMaterials: Uint16Array }[];
    /** 按 triangleMaterials 的值取（渲染进程把场景的材质 id 摊平成这一张表）。 */
    materials: AcousticMaterial[];
    /** 荧幕后的两只音箱：[左, 右]。 */
    speakers: [Vec3, Vec3];
    /** 听者在座位上，面朝 forward；不跟摄像机。 */
    listener: { position: Vec3; forward: Vec3; up: Vec3 };
    /** 用户自己选的，不猜设备。耳机按 HRTF 解码，音箱按普通声像。 */
    output: 'headphones' | 'speakers';
    sampleRate: number;
}

export interface RoomResult {
    key: string;
    sampleRate: number;
    /**
     * 「真立体声」IR，正好是 ConvolverNode 吃的 4 声道顺序：左音箱→左耳、左音箱→右耳、右音箱→左耳、右音箱→右耳。
     * 已含直达声和全部反射；每只音箱按它自己的延迟放好，Steam Audio 自带的效果延迟已去掉，两只音箱共同的最短延迟也已去掉。
     */
    channels: [Float32Array, Float32Array, Float32Array, Float32Array];
    /** 这次是现算的还是从磁盘缓存读的。 */
    source: 'computed' | 'cache';
    /** 用了多少毫秒。 */
    ms: number;
}

/** 预载脚本挂在 window.electron.sceneAcoustics 上。 */
export interface SceneAcousticsApi {
    /** 这台机器上能不能算（Steam Audio 库在不在、能不能加载）；只查一次。 */
    available(): Promise<{ ok: boolean; reason?: string }>;
    computeRoom(request: RoomRequest): Promise<RoomResult>;
}

/** 换了 IR 的算法或格式就加一，旧缓存随之作废。 */
export const ROOM_FORMAT = 1;

/** 网页版、预览和测试里没有这个接口，返回 null。 */
export const getSceneAcousticsApi = (): SceneAcousticsApi | null =>
    (globalThis as { electron?: { sceneAcoustics?: SceneAcousticsApi } }).electron?.sceneAcoustics ?? null;
