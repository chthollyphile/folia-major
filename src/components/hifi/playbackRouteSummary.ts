import type { HifiSignalPath } from '../../types/hifi';
import type { webAudioSignal } from './webAudioSignal';

// 信号链路入口和 Web 面板上的一词概括：原生直通 / 原生处理 / 原生（未确认）/ 转码播放 / Web 引擎；没有音频时为 null。

export type PlaybackRouteSummary = 'nativePassthrough' | 'nativeProcessed' | 'nativeUnconfirmed' | 'transcoded' | 'webEngine';

/** HiFi 路线按结论分直通和处理（经 PipeWire 的采样率直通也算处理）；Web 路线按当前源是不是 Folia 的转码副本分。 */
export const playbackRouteSummary = (
    hifiPath: HifiSignalPath | null,
    web: ReturnType<typeof webAudioSignal>,
): PlaybackRouteSummary | null => {
    if (hifiPath) {
        if (hifiPath.verdict === 'bit-perfect' || hifiPath.verdict === 'dop') return 'nativePassthrough';
        return hifiPath.verdict === 'unknown' ? 'nativeUnconfirmed' : 'nativeProcessed';
    }
    if (web.transcode === 'transcoded') return 'transcoded';
    return web.transcode === 'notTranscoded' ? 'webEngine' : null;
};
