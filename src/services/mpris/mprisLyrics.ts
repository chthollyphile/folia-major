import type { LyricData } from '../../types';
import type { MprisPlayerSnapshot } from '../../types/mpris';
import { autoMatchBestLyric } from '../../utils/lyrics/autoMatchBestLyric';
import { detectNonTtmlTimedLyricFormat } from '../../utils/lyrics/formatDetection';
import { hasRenderableLyrics } from '../../utils/lyrics/validity';
import { LyricParserFactory } from '../../utils/lyrics/LyricParserFactory';
import { hasTimedLyricText } from '../../utils/mpris';

// src/services/mpris/mprisLyrics.ts
// MPRIS 源的歌词：先解析 xesam:asText，没有再在线匹配。两条路都可能慢，调用方用请求号丢弃换歌后的结果。

/** 解析自带的时间轴歌词；没有或解析不出来为 null。 */
export const parseMprisLyricText = async (text: string): Promise<LyricData | null> => {
    if (!hasTimedLyricText(text)) return null;
    try {
        const parsed = await LyricParserFactory.parse({
            type: 'local',
            lrcContent: text,
            formatHint: detectNonTtmlTimedLyricFormat(text),
        });
        return hasRenderableLyrics(parsed) ? parsed : null;
    } catch (error) {
        console.warn('[MPRIS] could not parse the lyrics the player sent', error);
        return null;
    }
};

const matchOnline = async (player: MprisPlayerSnapshot): Promise<LyricData | null> => {
    // 视频/直播没有 xesam:artist，搜歌词只会搜到不相干的歌。
    if (!player.title.trim() || player.artists.length === 0) return null;
    try {
        const match = await autoMatchBestLyric(
            player.title,
            player.artists.join(', '),
            Math.round(player.durationSec * 1000),
            { album: player.album || undefined },
        );
        return match && !('isPureMusic' in match) ? match.lyrics : null;
    } catch (error) {
        console.warn('[MPRIS] could not match lyrics for the system track', error);
        return null;
    }
};

/** 自带优先，其次在线；都没有时只显示曲目。 */
export const resolveMprisLyrics = async (player: MprisPlayerSnapshot): Promise<LyricData | null> => (
    (await parseMprisLyricText(player.lyricText)) ?? (await matchOnline(player))
);
