import { create } from 'zustand';
import type {
    HifiDevice,
    HifiEngineState,
    HifiErrorEvent,
    HifiInstallProgress,
    HifiOutputProbe,
    HifiRuntimeStatus,
} from '../../types/hifi';

// src/services/hifi/hifiEngineStore.ts
// 渲染端看到的 HiFi 主进程：支不支持、mpv 运行时、引擎状态、安装进度、设备、最近的错误、熔断和 PipeWire 探测。只有 hifiEngine 写它。

export type HifiEngineStoreState = {
    /** preload 暴露了 window.electron.hifi，即桌面版。 */
    supported: boolean;
    /** 最近一次问到的 mpv 检测结果；还没问过时为 null。 */
    runtime: HifiRuntimeStatus | null;
    /** 主进程最新的引擎状态，乱序到达的旧 seq 已丢掉。 */
    engine: HifiEngineState | null;
    installProgress: HifiInstallProgress | null;
    /** 最近一次成功列出的输出设备。 */
    devices: HifiDevice[];
    /** 主进程推来的错误，或起播失败的错误码。 */
    lastError: HifiErrorEvent | null;
    /** mpv 短时间内反复崩溃、主进程熔断后为 true，本次会话不再回到 false：之后的歌都走 Web 引擎。 */
    circuitOpen: boolean;
    /**
     * 最近一次收下的 PipeWire 探测（Linux，hifiEngine.probeOutput）和它是替哪个 trackKey 探的；还没探过时为 null。
     * probe 为 null 表示探过了但没有结果（没有 pw-dump、找不到流、调用失败）。读的一方要核对 trackKey 是不是当前这首。
     */
    outputProbe: { probe: HifiOutputProbe | null; trackKey: string | null } | null;
};

export const createHifiEngineStore = () => create<HifiEngineStoreState>(() => ({
    supported: false,
    runtime: null,
    engine: null,
    installProgress: null,
    devices: [],
    lastError: null,
    circuitOpen: false,
    outputProbe: null,
}));

export type HifiEngineStore = ReturnType<typeof createHifiEngineStore>;

export const useHifiEngineStore = createHifiEngineStore();
