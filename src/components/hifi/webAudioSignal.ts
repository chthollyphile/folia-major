import type { PlaybackRepresentation } from '../../types/playbackRecovery';

// Web 播放通路只报告当前源实际使用的转码副本，不把预热或以前播放留下的记录算进来。

export const webAudioSignal = (source: string | null, representation: PlaybackRepresentation | null) => {
    const active = Boolean(source);
    const matching = active && representation?.url === source ? representation : null;
    const transcoded = active && (matching?.kind === 'transcoded' || source?.startsWith('folia-transcode:') === true);
    return {
        active,
        transcode: !active ? 'noSource' : transcoded ? 'transcoded' : 'notTranscoded',
        mimeType: matching?.mimeType || null,
    } as const;
};
