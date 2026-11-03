import { useEffect } from 'react';
import type { HifiMpvAudioParams, HifiPlaybackStatus } from '../../types/hifi';
import { hifiEngine, type HifiEngine } from '../../services/hifi/hifiEngine';
import { isPipewireOutputDriver } from '../../services/hifi/hifiEngineRules';
import { useHifiEngineStore } from '../../services/hifi/hifiEngineStore';
import { useHifiTrackStore } from '../../services/hifi/hifiTrackStore';
import { readHifiPlatform, useIsHifiRoute } from './useHifiSignalPath';

// src/components/hifi/useHifiOutputProbe.ts
// 什么时候问主进程要一次 PipeWire 的探测（pw-dump），供信号链路的 system 一级和徽标的结论用。
// 只在 Linux、HiFi 路线、mpv 走 pipewire / pulse 输出、引擎在放的正是当前这首时探：开始放约 1.5 秒后一次（PipeWire 要先
// 把流接上设备、决定采样率），mpv 交出的格式变了或无缝换了曲目后再一次；信号链路面板开着时每 2 秒一次。
// 在 HifiSignalPathPanel 里挂一次，面板关着也在跑。只订阅几个离散的值，不逐帧、不往 React state 里写探测结果。

/** 开始放（或格式、曲目变了）之后等多久再探：太早时 PipeWire 还没切好采样率。 */
export const OUTPUT_PROBE_SETTLE_MS = 1500;

/** 面板开着时多久重探一次：用户改完 PipeWire 的配置、换了默认设备，开着面板就能看到。 */
export const OUTPUT_PROBE_PANEL_INTERVAL_MS = 2000;

export type OutputProbeConditions = {
    /** window.electron.platform；网页版为 null。 */
    platform: string | null;
    isHifiRoute: boolean;
    /** hifiTrackStore 里当前曲目的 trackKey。 */
    trackKey: string | null;
    /** 主进程的引擎状态在放哪个 trackKey、什么状态、用哪个输出驱动。 */
    engineTrackKey: string | null;
    status: HifiPlaybackStatus | null;
    ao: string | null;
};

/** 现在该不该探：Linux、HiFi 路线、引擎在放的就是当前这首、mpv 的输出落在 PipeWire 上（pipewire 或 pulse）。 */
export const shouldProbeOutput = ({ platform, isHifiRoute, trackKey, engineTrackKey, status, ao }: OutputProbeConditions) => (
    platform === 'linux'
    && isHifiRoute
    && trackKey !== null
    && engineTrackKey === trackKey
    && status === 'playing'
    && isPipewireOutputDriver(ao)
);

/** mpv 交出的格式写成一个比较用的字符串：变了就重探。 */
export const audioOutParamsKey = (params: HifiMpvAudioParams | null | undefined): string | null => (
    params ? `${params.samplerate}/${params.format}/${params.channelCount}/${params.channels}` : null
);

/**
 * 按上面的时机调 engine.probeOutput(trackKey)；结果由引擎写进 useHifiEngineStore 的 outputProbe，
 * 回来时已经不是当前这首的由引擎丢掉。panelOpen：信号链路面板开着，开的那一下先探一次，之后每 2 秒一次。
 */
export const useHifiOutputProbe = (panelOpen: boolean, engine: Pick<HifiEngine, 'probeOutput'> = hifiEngine) => {
    const isHifiRoute = useIsHifiRoute();
    const trackKey = useHifiTrackStore(state => state.current?.trackKey ?? null);
    const engineTrackKey = useHifiEngineStore(state => state.engine?.trackKey ?? null);
    const status = useHifiEngineStore(state => state.engine?.status ?? null);
    const ao = useHifiEngineStore(state => state.engine?.currentAo ?? null);
    const outParams = useHifiEngineStore(state => audioOutParamsKey(state.engine?.audioOutParams));
    const active = shouldProbeOutput({ platform: readHifiPlatform(), isHifiRoute, trackKey, engineTrackKey, status, ao });

    // 开始放、恢复播放、换了格式或曲目：等 PipeWire 定下来再探一次。条件在等的时候变了，就作废重等。
    useEffect(() => {
        if (!active || trackKey === null) return undefined;
        const timer = window.setTimeout(() => {
            void engine.probeOutput(trackKey);
        }, OUTPUT_PROBE_SETTLE_MS);
        return () => window.clearTimeout(timer);
    }, [active, trackKey, outParams, engine]);

    useEffect(() => {
        if (!active || !panelOpen || trackKey === null) return undefined;
        void engine.probeOutput(trackKey);
        const timer = window.setInterval(() => {
            void engine.probeOutput(trackKey);
        }, OUTPUT_PROBE_PANEL_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, [active, panelOpen, trackKey, engine]);
};
