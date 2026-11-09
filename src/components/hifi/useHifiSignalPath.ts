import { useMemo } from 'react';
import type { HifiSignalPath } from '../../types/hifi';
import { useHifiEngineStore } from '../../services/hifi/hifiEngineStore';
import { useHifiTrackStore } from '../../services/hifi/hifiTrackStore';
import { buildSignalPath } from '../../services/hifi/signalPath';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { useHifiSettingsStore } from '../../stores/useHifiSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';

// src/components/hifi/useHifiSignalPath.ts
// 播放界面读 HiFi 信号链路的 hook：现在是不是 HiFi 路线，当前曲目载入了没有，以及它从源文件到声卡的每一级
// （Linux 上经 PipeWire 时还有 PipeWire 报的那一级）。

/** 当前这首歌由 mpv 发声。 */
export const useIsHifiRoute = () => usePlaybackStore(state => state.playbackRoute === 'hifi');

/** 当前曲目是恢复出来、暂停着、还没交给 mpv 载入的（loadState 'deferred'）：按下播放才载入，在那之前没有输出格式可比。 */
export const useHifiTrackDeferred = () => useHifiTrackStore(state => state.loadState === 'deferred');

/** 桌面版所在的系统（'win32'、'darwin'、'linux'），网页版为 null。每次现读，测试可以换。 */
export const readHifiPlatform = (): string | null => (
    typeof window !== 'undefined' ? window.electron?.platform ?? null : null
);

/**
 * 当前曲目的信号链路：源格式 + 主进程的引擎状态 + HiFi 设置，Linux 上再加 PipeWire 的探测。不在 HiFi 路线上时为 null。
 * 引擎状态还是上一首的（新曲目在载入）或者这首还没载入时不拿它比，结论先是 unknown，免得把别的曲目的输出格式安到这一首上。
 * 探测也一样只用替这一首探的（无缝换曲之后、新的探测回来之前，结论先按没有探测算）。
 */
export const useHifiSignalPath = (): HifiSignalPath | null => {
    const isHifiRoute = useIsHifiRoute();
    const trackKey = useHifiTrackStore(state => state.current?.trackKey ?? null);
    const sourceSpec = useHifiTrackStore(state => state.sourceSpec);
    const deferred = useHifiTrackDeferred();
    const engine = useHifiEngineStore(state => state.engine);
    const outputProbe = useHifiEngineStore(state => state.outputProbe);
    const exclusive = useHifiSettingsStore(state => state.exclusive);
    const dsdMode = useHifiSettingsStore(state => state.dsdMode);
    const softwareVolume = useHifiSettingsStore(state => state.softwareVolume);
    // 0–100 的整数。静音单独下发给 mpv 的 mute，不算改了采样值，这里不折算进音量。
    const volume = useAudioSettingsStore(state => Math.round(state.volume * 100));

    return useMemo(() => {
        if (!isHifiRoute) return null;
        const engineForTrack = !deferred && engine && trackKey !== null && engine.trackKey === trackKey ? engine : null;
        const probe = engineForTrack && outputProbe?.trackKey === trackKey && readHifiPlatform() === 'linux'
            ? outputProbe.probe
            : null;
        return buildSignalPath(sourceSpec, engineForTrack, { exclusive, dsdMode, softwareVolume, volume }, probe);
    }, [isHifiRoute, trackKey, sourceSpec, deferred, engine, outputProbe, exclusive, dsdMode, softwareVolume, volume]);
};
