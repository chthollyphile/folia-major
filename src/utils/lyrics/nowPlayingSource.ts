import type { NowPlayingLyricPayload, StageLyricsSession } from '../../types';
import { detectTimedLyricFormat } from './formatDetection';

// Keep now-playing field mapping isolated so stage playback can evolve
// without hard-coding assumptions in App.tsx.
const isNeteaseNowPlayingSource = (source: string | null | undefined) => source === 'netease' || source === 'neteasecloudmusic';

export const buildNowPlayingLyricSource = (payload: NowPlayingLyricPayload): StageLyricsSession['lyricSource'] | null => {
    const translatedLyric = payload.translatedLyric?.trim() || undefined;
    const karaokeLyric = payload.karaokeLyric?.trim() || '';
    const lrc = payload.lrc?.trim() || '';

    if (payload.hasKaraokeLyric && karaokeLyric) {
        if (isNeteaseNowPlayingSource(payload.source)) {
            return {
                type: 'local',
                lrcContent: karaokeLyric,
                ...(translatedLyric ? { tLrcContent: translatedLyric } : {}),
                formatHint: 'yrc',
            };
        }

        return {
            type: 'qrc',
            qrcContent: karaokeLyric,
            ...(translatedLyric ? { translationContent: translatedLyric } : {}),
        };
    }

    if (!payload.hasLyric || !lrc) {
        return null;
    }

    return {
        type: 'local',
        lrcContent: lrc,
        ...(translatedLyric ? { tLrcContent: translatedLyric } : {}),
        formatHint: detectTimedLyricFormat(lrc),
    };
};
