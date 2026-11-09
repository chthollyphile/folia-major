import type {
    HifiClockUpdate,
    HifiDevice,
    HifiEngineConfig,
    HifiEngineState,
    HifiErrorCode,
    HifiErrorEvent,
    HifiInstallResult,
    HifiLoadRequest,
    HifiLoadResult,
    HifiOutputProbe,
    HifiRuntimeStatus,
} from '../../types/hifi';
import type { HifiEngineStore } from './hifiEngineStore';
import type { HifiSourceResponder } from './hifiSourceResponder';

// src/services/hifi/hifiEngineRules.ts
// HiFi 引擎客户端（hifiEngine.ts）的对外形状和它用的纯规则：主进程的载入结果怎么分（成功、取消、失败）、哪些失败说明
// mpv 本身不能用、两份配置对主进程算不算一样、PipeWire 探测结果收不收，以及向订阅者逐个分发。不碰 window，不存状态。

export type HifiApi = NonNullable<NonNullable<Window['electron']>['hifi']>;

export type HifiEngine = {
    /** 这个客户端写的 store；单例写的就是 useHifiEngineStore。 */
    store: HifiEngineStore;
    /** 本地歌曲的 sourceKey → File；起播前在这里登记。 */
    responder: HifiSourceResponder;
    /** 订阅主进程的推送；重复调用不重复订阅。没有接口时返回 false。 */
    attach: () => boolean;
    /** 退订主进程的推送并忘掉已见过的 seq，测试用。 */
    detach: () => void;
    refreshRuntime: () => Promise<HifiRuntimeStatus | null>;
    detect: () => Promise<HifiRuntimeStatus | null>;
    install: () => Promise<HifiInstallResult | null>;
    cancelInstall: () => Promise<void>;
    pickRuntimePath: () => Promise<string | null>;
    /** 和上一次发出的配置相同就不发；手动 mpv 路径变了，主进程收下后重新取运行时状态。 */
    configure: (config: HifiEngineConfig) => Promise<void>;
    listDevices: () => Promise<HifiDevice[]>;
    /** 取消的载入（见 isHifiLoadCancelled）不记 lastError；mpv 找不到、起不来或太旧时顺带刷新运行时状态。 */
    load: (request: HifiLoadRequest) => Promise<HifiLoadResult>;
    play: () => Promise<void>;
    pause: () => Promise<void>;
    seek: (positionSec: number) => Promise<void>;
    stop: () => Promise<void>;
    setLoopFile: (loop: boolean) => Promise<void>;
    preloadNext: (request: HifiLoadRequest) => Promise<boolean>;
    clearNext: () => Promise<void>;
    /** 主动拉一次引擎状态；seq 和已收下的相同也收（主进程拼快照不加 seq），更旧时返回已收下的那份。 */
    getSnapshot: () => Promise<HifiEngineState | null>;
    /**
     * Linux：问主进程要一次 mpv 那路流在 PipeWire 里的去向（pw-dump）。结果连同 trackKey 写进 store 的 outputProbe，
     * 但回来时 mpv 放的已经不是这个 trackKey、或者更晚发出的一次已经先回来了，就丢掉不写，返回 null。
     * 没有接口、主进程回的不是探测结果、调用抛错时也是 null（抛错时 store 里记成没有探测结果，不留旧的）。
     */
    probeOutput: (trackKey: string | null) => Promise<HifiOutputProbe | null>;
    onState: (listener: (state: HifiEngineState) => void) => () => void;
    onClock: (listener: (update: HifiClockUpdate) => void) => () => void;
    onError: (listener: (event: HifiErrorEvent) => void) => () => void;
    /** 这首歌本次会话里 HiFi 起播失败过，之后都走 Web 引擎。 */
    isSongForcedWeb: (songKey: string) => boolean;
    markSongForcedWeb: (songKey: string) => void;
    clearForcedWeb: () => void;
};

export type Listener<T> = (value: T) => void;

/** 一组订阅者：add 返回退订函数；notify 逐个通知，一个抛错不耽误其余的。 */
export const createListeners = <T>(label: string) => {
    const listeners = new Set<Listener<T>>();
    return {
        add: (listener: Listener<T>) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        notify: (value: T) => {
            listeners.forEach((listener) => {
                try {
                    listener(value);
                } catch (error) {
                    console.warn(`[HiFi] ${label} listener failed`, error);
                }
            });
        },
    };
};

export const isLoadResult = (value: unknown): value is HifiLoadResult => (
    typeof value === 'object' && value !== null && typeof (value as { ok?: unknown }).ok === 'boolean'
);

/**
 * HifiLoadResult 失败时 detail 有两个值不算失败，是这次载入被取消了（errorCode 仍是 LOAD_FAILED）：
 * - 'superseded'：一次更新的 load 顶替了它；
 * - 'stopped'：还在载入时被 stop() 取消，比如路由守卫切去 Web 引擎。
 * 这两种不提示、不记 lastError、不让这首歌回落 Web。
 */
export const CANCELLED_LOAD_DETAILS: Record<string, string> = {
    superseded: 'superseded by a newer one',
    stopped: 'cancelled by stop',
};

export type CancelledLoadResult = Extract<HifiLoadResult, { ok: false }> & { detail: string };

export const isHifiLoadCancelled = (result: HifiLoadResult): result is CancelledLoadResult => (
    !result.ok && typeof result.detail === 'string' && Object.hasOwn(CANCELLED_LOAD_DETAILS, result.detail)
);

/** 这几种失败说明 mpv 本身不能用了（没找到、拉不起来、版本太旧）：运行时状态要重新取，路由才会及时改走 Web。 */
export const RUNTIME_FAILURE_CODES: ReadonlySet<HifiErrorCode> = new Set<HifiErrorCode>(['MPV_NOT_FOUND', 'MPV_SPAWN_FAILED', 'MPV_TOO_OLD']);

/** 两份配置对主进程是否一样；不开软件音量时 mpv 固定 100，音量不同也算一样。静音总要比：它不看软件音量开没开。 */
export const isSameEngineConfig = (a: HifiEngineConfig, b: HifiEngineConfig) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)] as Array<keyof HifiEngineConfig>);
    return [...keys].every(key => (
        Object.is(a[key], b[key]) || (key === 'volume' && !a.softwareVolume && !b.softwareVolume)
    ));
};

/** mpv 的这几种输出驱动最后落在 PipeWire 上，可以用 pw-dump 看它的去向：pipewire 本身，和经 pipewire-pulse 的 pulse。 */
const PIPEWIRE_OUTPUT_DRIVERS: ReadonlySet<string> = new Set(['pipewire', 'pulse']);

export const isPipewireOutputDriver = (ao: string | null | undefined) => PIPEWIRE_OUTPUT_DRIVERS.has((ao ?? '').trim().toLowerCase());

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/**
 * 主进程回的是不是一份探测结果：backend 为 'pipewire'，带着流、图的时钟设置和两张表。只核对外形，字段的值照收；
 * 别的（旧的 preload、没找到流时的 null、写坏了的对象）都当没有探测结果。
 */
export const isOutputProbe = (value: unknown): value is HifiOutputProbe => (
    isRecord(value)
    && value.backend === 'pipewire'
    && isRecord(value.stream)
    && isRecord(value.stream.format)
    && isRecord(value.graph)
    && Array.isArray(value.graph.allowedRates)
    && Array.isArray(value.filters)
    && Array.isArray(value.otherStreams)
    && (value.device === null || (isRecord(value.device) && isRecord(value.device.format)))
);

/** 两份探测除了读取时刻（at）都一样：不用再写 store，徽标和面板也就不用重画。 */
export const isSameOutputProbe = (a: HifiOutputProbe | null, b: HifiOutputProbe | null) => {
    if (a === null || b === null) return a === b;
    return JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });
};

/** 写进日志的那几项：mpv 交出的、设备上的采样率，允许的采样率，经过的滤波节点和同设备上别的流。 */
export const outputProbeLogFields = (probe: HifiOutputProbe | null) => (probe
    ? {
        streamRate: probe.stream.format.rate,
        device: probe.device?.name ?? null,
        deviceRate: probe.device?.format.rate ?? null,
        allowedRates: probe.graph.allowedRates,
        filters: probe.filters.map(filter => filter.name),
        otherStreams: probe.otherStreams.map(stream => (stream.own ? `${stream.name} (own)` : stream.name)),
    }
    : null);
