import type { FoliumSourceLyricsResult } from '@folia/folium';
import type { BodianLyricsPayload } from 'bodian-music-api';

// sources/bodian/client/bodianLyrics.ts
// The API package decodes platform timing; the source hands the host its standard lyric text as tracks
// (lyrics@1): the line-timed LRC, and the word-timed awlrc where Bodian has one. The host parses them and
// shows the word-timed track where it has lines. The instrumental notice is read by the host's own rule
// (folium.lyrics.isPureMusicText), and may come with the lines (plan §4.5, third rule).

export function toBodianLyrics(
    { mainText, wordByWordText }: BodianLyricsPayload,
    isPureMusicText: (text: string) => boolean,
): FoliumSourceLyricsResult {
    return {
        ...(mainText ? { main: { format: 'lrc', text: mainText } } : {}),
        ...(wordByWordText ? { wordByWord: { format: 'awlrc', text: wordByWordText } } : {}),
        isPureMusic: isPureMusicText(mainText),
    };
}
