import type {
    HifiClockUpdate,
    HifiDevice,
    HifiEngineConfig,
    HifiEngineState,
    HifiErrorEvent,
    HifiInstallResult,
    HifiLoadRequest,
    HifiLoadResult,
    HifiOutputProbe,
    HifiRuntimeStatus,
} from '../../types/hifi';
import { createHifiEngineStore, useHifiEngineStore, type HifiEngineStore } from './hifiEngineStore';
import {
    CANCELLED_LOAD_DETAILS,
    RUNTIME_FAILURE_CODES,
    createListeners,
    isHifiLoadCancelled,
    isLoadResult,
    isOutputProbe,
    isSameEngineConfig,
    isSameOutputProbe,
    outputProbeLogFields,
    type HifiApi,
    type HifiEngine,
} from './hifiEngineRules';
import { createHifiSourceResponder } from './hifiSourceResponder';

// src/services/hifi/hifiEngine.ts
// 渲染端的 HiFi 引擎客户端：包住 window.electron.hifi，把主进程推来的状态写进 useHifiEngineStore，把时钟、错误和状态
// 分发给订阅者，替源桥读本地文件，按需问 PipeWire 探测。网页版没有这套接口，每个方法都回安全的默认值，不抛错。

export { useHifiEngineStore };
export type { HifiEngineStore, HifiEngineStoreState } from './hifiEngineStore';
export { isHifiLoadCancelled };
export type { HifiApi, HifiEngine } from './hifiEngineRules';

const getWindowHifiApi = (): HifiApi | undefined => (
    typeof window === 'undefined' ? undefined : window.electron?.hifi
);

/** store 默认是新建的一份，测试互不干扰；单例传入 useHifiEngineStore。 */
export const createHifiEngine = (
    getApi: () => HifiApi | undefined = getWindowHifiApi,
    store: HifiEngineStore = createHifiEngineStore(),
): HifiEngine => {
    const stateListeners = createListeners<HifiEngineState>('state');
    const clockListeners = createListeners<HifiClockUpdate>('clock');
    const errorListeners = createListeners<HifiErrorEvent>('error');
    const forcedWebSongs = new Set<string>();
    let unsubscribers: Array<() => void> | null = null;
    let lastSeq = Number.NEGATIVE_INFINITY;
    // 刚发出 load / preloadNext 时主进程的状态还没跟上，而起播那一下的时钟先到：这两首的时钟也放行。
    let requestedTrackKey: string | null = null;
    let requestedNextTrackKey: string | null = null;
    // 最近一次发出（或正在发）的配置：桥在音量变化时也会推，一样的就不再走 IPC。
    let sentConfig: HifiEngineConfig | null = null;
    // 主进程现在按哪个手动 mpv 路径检测；undefined 表示不知道（还没发过，或上一次发送失败）。
    let sentMpvPath: string | null | undefined;
    // PipeWire 探测：发出的次序和最近收下的那次，晚发的先回来时早发的那次丢掉。
    let probeSeq = 0;
    let acceptedProbeSeq = 0;
    // 连着失败只记第一次；面板开着时每 2 秒探一次，主进程一直失败就会刷屏。
    let probeFailing = false;
    // 上一次记进日志的探测摘要：同一首、PipeWire 那边没变时不再记。
    let loggedProbe: string | null = null;

    const responder = createHifiSourceResponder({
        respond: async (readId, response) => {
            await getApi()?.respondRead(readId, response);
        },
    });

    store.setState({ supported: Boolean(getApi()) });

    const openCircuit = () => {
        if (store.getState().circuitOpen) return;
        console.warn('[HiFi] circuit open: mpv kept failing, the rest of this session plays on the Web engine');
        store.setState({ circuitOpen: true });
    };

    /** 收下一份引擎状态；seq 不比上一份新的是乱序或重发，丢掉。 */
    const acceptState = (state: HifiEngineState) => {
        if (state.seq <= lastSeq) return;
        lastSeq = state.seq;
        if (state.circuitOpen) openCircuit();
        store.setState({ engine: state });
        stateListeners.notify(state);
    };

    /**
     * 收下主动拉来的快照。主进程拼快照时 seq 不加一，和已收下的相同是常态，而快照是更新的那份（比如暂停时 seek 过）：
     * 写进 store，但不再通知订阅者，同一个 seq 只通知一次（免得 'ended' 之类被处理两遍）。
     */
    const acceptSnapshot = (snapshot: HifiEngineState) => {
        if (snapshot.seq !== lastSeq) {
            acceptState(snapshot);
            return;
        }
        if (snapshot.circuitOpen) openCircuit();
        store.setState({ engine: snapshot });
    };

    const isClockForKnownTrack = ({ trackKey }: HifiClockUpdate) => {
        if (trackKey === null) return true;
        const engine = store.getState().engine;
        return trackKey === engine?.trackKey
            || trackKey === engine?.next?.trackKey
            || trackKey === requestedTrackKey
            || trackKey === requestedNextTrackKey;
    };

    const handleError = (event: HifiErrorEvent) => {
        console.warn('[HiFi] engine error', event);
        store.setState({ lastError: event });
        if (event.code === 'CIRCUIT_OPEN') openCircuit();
        errorListeners.notify(event);
    };

    /** 调一个主进程方法；没有接口或调用抛错时回 fallback，不往外抛。 */
    const invoke = async <T>(label: string, fallback: T, call: (api: HifiApi) => Promise<T>): Promise<T> => {
        const api = getApi();
        if (!api) return fallback;
        try {
            return await call(api);
        } catch (error) {
            console.warn(`[HiFi] ${label} failed`, error);
            return fallback;
        }
    };

    const keepRuntime = (runtime: HifiRuntimeStatus | null) => {
        if (runtime) store.setState({ runtime });
        return runtime;
    };

    const refreshRuntime = async () => keepRuntime(await invoke('runtime status', null, api => api.getRuntimeStatus()));

    /**
     * 把设置推给主进程。和上一次发出的一样就跳过；手动 mpv 路径变了，等主进程收下后重新取运行时状态，
     * 否则 runtime.available 还停在旧路径的检测结果上，路由会一直按它走。
     */
    const configure = async (config: HifiEngineConfig) => {
        const api = getApi();
        if (!api) return;
        if (sentConfig && isSameEngineConfig(sentConfig, config)) return;
        const previousMpvPath = sentMpvPath;
        const sending = { ...config };
        sentConfig = sending;
        sentMpvPath = config.mpvPath;
        try {
            await api.configure(config);
        } catch (error) {
            console.warn('[HiFi] configure failed', error);
            // 主进程没收下：忘掉这份，下次同样的配置还会再发。
            if (sentConfig === sending) {
                sentConfig = null;
                sentMpvPath = undefined;
            }
            return;
        }
        if (config.mpvPath !== previousMpvPath) await refreshRuntime();
    };

    const load = async (request: HifiLoadRequest): Promise<HifiLoadResult> => {
        const api = getApi();
        if (!api) return { ok: false, errorCode: 'UNSUPPORTED_PLATFORM' };
        requestedTrackKey = request.trackKey;
        let result: HifiLoadResult;
        try {
            const answer: unknown = await api.load(request);
            result = isLoadResult(answer) ? answer : { ok: false, errorCode: 'UNKNOWN' };
        } catch (error) {
            console.warn('[HiFi] load failed', error);
            result = { ok: false, errorCode: 'UNKNOWN' };
        }
        // 只记 trackKey 和来源种类：Navidrome 的 url 里带着凭据。
        const fields = { trackKey: request.trackKey, sourceKind: request.source.kind };
        if (result.ok) {
            acceptState(result.state);
            console.info('[HiFi] load ready', fields);
            return result;
        }
        if (isHifiLoadCancelled(result)) {
            console.info(`[HiFi] load ${CANCELLED_LOAD_DETAILS[result.detail]}`, fields);
            return result;
        }
        console.warn('[HiFi] load failed', { ...fields, errorCode: result.errorCode, detail: result.detail });
        if (result.errorCode === 'CIRCUIT_OPEN') openCircuit();
        store.setState({
            lastError: { code: result.errorCode, trackKey: request.trackKey, detail: result.detail, fatal: true },
        });
        if (RUNTIME_FAILURE_CODES.has(result.errorCode)) await refreshRuntime();
        return result;
    };

    /** 收下一次探测：不是当前这首的、比已收下的更早发出的丢掉；和 store 里的一样就不写。 */
    const acceptProbe = (seq: number, trackKey: string | null, probe: HifiOutputProbe | null): boolean => {
        if (seq < acceptedProbeSeq) return false;
        if (store.getState().engine?.trackKey !== trackKey) return false;
        acceptedProbeSeq = seq;
        const current = store.getState().outputProbe;
        if (current && current.trackKey === trackKey && isSameOutputProbe(current.probe, probe)) return true;
        store.setState({ outputProbe: { probe, trackKey } });
        const fields = { trackKey, ...(outputProbeLogFields(probe) ?? { probe: null }) };
        const summary = JSON.stringify(fields);
        if (summary !== loggedProbe) {
            loggedProbe = summary;
            console.info('[HiFi] PipeWire reports', fields);
        }
        return true;
    };

    const probeOutput = async (trackKey: string | null): Promise<HifiOutputProbe | null> => {
        const api = getApi();
        // 没接上探测的 preload（旧版本）没有这个方法：当作没有 PipeWire 可看，不报错。
        if (!api || typeof api.probeOutput !== 'function') return null;
        probeSeq += 1;
        const seq = probeSeq;
        let probe: HifiOutputProbe | null = null;
        try {
            const answer: unknown = await api.probeOutput();
            probe = isOutputProbe(answer) ? answer : null;
            probeFailing = false;
        } catch (error) {
            if (!probeFailing) console.warn('[HiFi] output probe failed', error);
            probeFailing = true;
        }
        return acceptProbe(seq, trackKey, probe) ? probe : null;
    };

    return {
        store,
        responder,
        attach: () => {
            if (unsubscribers) return true;
            const api = getApi();
            store.setState({ supported: Boolean(api) });
            if (!api) return false;
            unsubscribers = [
                api.onState(acceptState),
                api.onClock((update) => {
                    if (isClockForKnownTrack(update)) clockListeners.notify(update);
                }),
                api.onError(handleError),
                api.onInstallProgress((installProgress) => {
                    store.setState({ installProgress });
                }),
                api.onReadRequest((request) => {
                    void responder.handleRead(request);
                }),
            ];
            return true;
        },
        detach: () => {
            unsubscribers?.forEach(unsubscribe => unsubscribe());
            unsubscribers = null;
            lastSeq = Number.NEGATIVE_INFINITY;
        },
        refreshRuntime,
        detect: async () => keepRuntime(await invoke('runtime detect', null, api => api.detectRuntime())),
        install: async () => {
            const result = await invoke<HifiInstallResult | null>('runtime install', null, api => api.installRuntime());
            // 不管装没装成都换上新的运行时状态：主进程装完会重新检测并随结果带回；调用本身失败了就另外问一次。
            if (result?.status) keepRuntime(result.status);
            else await refreshRuntime();
            return result;
        },
        cancelInstall: () => invoke('cancel install', undefined, api => api.cancelInstall()),
        pickRuntimePath: async () => (await invoke('pick runtime path', null, api => api.pickRuntimePath())) ?? null,
        configure,
        listDevices: async () => {
            const devices = await invoke<HifiDevice[] | null>('list devices', null, api => api.listDevices());
            if (!Array.isArray(devices)) return [];
            store.setState({ devices });
            return devices;
        },
        load,
        play: () => invoke('play', undefined, api => api.play()),
        pause: () => invoke('pause', undefined, api => api.pause()),
        seek: positionSec => invoke('seek', undefined, api => api.seek(positionSec)),
        stop: () => {
            requestedTrackKey = null;
            requestedNextTrackKey = null;
            return invoke('stop', undefined, api => api.stop());
        },
        setLoopFile: loop => invoke('set loop-file', undefined, api => api.setLoopFile(loop)),
        preloadNext: async (request) => {
            if (getApi()) requestedNextTrackKey = request.trackKey;
            return (await invoke('preload next', false, api => api.preloadNext(request))) === true;
        },
        clearNext: () => {
            requestedNextTrackKey = null;
            return invoke('clear next', undefined, api => api.clearNext());
        },
        getSnapshot: async () => {
            const snapshot = await invoke<HifiEngineState | null>('snapshot', null, api => api.getSnapshot());
            if (!snapshot) return null;
            acceptSnapshot(snapshot);
            return store.getState().engine ?? snapshot;
        },
        probeOutput,
        onState: stateListeners.add,
        onClock: clockListeners.add,
        onError: errorListeners.add,
        isSongForcedWeb: songKey => forcedWebSongs.has(songKey),
        markSongForcedWeb: (songKey) => {
            if (forcedWebSongs.has(songKey)) return;
            forcedWebSongs.add(songKey);
            console.info('[HiFi] song falls back to the Web engine for this session', { songKey });
        },
        clearForcedWeb: () => {
            forcedWebSongs.clear();
        },
    };
};

export const hifiEngine = createHifiEngine(getWindowHifiApi, useHifiEngineStore);
