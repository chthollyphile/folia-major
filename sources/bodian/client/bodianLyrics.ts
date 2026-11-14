import type { ProviderLyricsResult } from '../../types/onlineMusic';
import { parseAwlrc, parseLyricsByFormat } from './parserCore';
import { isPureMusicLyricText } from './pureMusic';
import type { BodianLyricsPayload } from 'bodian-music-api';

// src/utils/lyrics/bodianLyrics.ts

// The API package decodes platform timing. Folia only maps standard lyric text to its shared model.
export function parseBodianLyrics({ mainText, wordByWordText }: BodianLyricsPayload): ProviderLyricsResult {
    const wordLyrics = wordByWordText ? parseAwlrc(wordByWordText) : null;
    const lyrics = wordLyrics?.lines.length ? wordLyrics : parseLyricsByFormat('lrc', mainText);
    return {
        lyrics: lyrics.lines.length ? lyrics : null,
        mainText, wordByWordText: wordLyrics?.lines.length ? wordByWordText : undefined,
        isPureMusic: isPureMusicLyricText(mainText),
    };
}
