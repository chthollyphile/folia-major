import type { LyricData, NowPlayingLyricPayload, NowPlayingTrackSnapshot, SongResult } from '../types';
import { formatLrcLineTimestamp, serializeEnhancedLrc } from './lyrics/enhancedLrcSerializer';
import { isInterludeLine } from './lyrics/parserCore';
import { getSongAlbumLabel, getSongArtistLabel } from '../services/onlineMusic/songMetadata';

// src/utils/nowPlayingSenderPayload.ts
// Maps Folia's internal playback state onto the outbound now-playing wire shapes
// (track snapshot + lyric payload). Kept pure so the publisher hook only deals with I/O.

export interface NowPlayingSenderTrackInput {
    song: SongResult | null;
    lyrics: LyricData | null;
    coverUrl: string | null;
    durationMs: number;
}

export interface NowPlayingSenderTrackWithKey {
    snapshot: NowPlayingTrackSnapshot;
    /** Stable identity used to skip redundant publications. */
    key: string;
}

export const buildNowPlayingSenderTrack = ({
    song,
    lyrics,
    coverUrl,
    durationMs,
}: NowPlayingSenderTrackInput): NowPlayingSenderTrackWithKey | null => {
    const title = (song?.name || lyrics?.title || '').trim();
    const artist = (getSongArtistLabel(song) || lyrics?.artist || '').trim();
    const album = getSongAlbumLabel(song).trim();
    const safeDurationMs = Number.isFinite(durationMs) && durationMs > 0 ? Math.round(durationMs) : 0;

    if (!title && !artist && !song && !lyrics) {
        return null;
    }

    const id = song?.id === undefined || song?.id === null ? null : String(song.id);
    const snapshot: NowPlayingTrackSnapshot = {
        id,
        title: title || 'Now Playing',
        artist: artist || 'Now Playing',
        album,
        coverUrl: coverUrl || null,
        durationMs: safeDurationMs > 0 ? safeDurationMs : null,
    };

    return {
        snapshot,
        key: JSON.stringify([id, snapshot.title, snapshot.artist, album, coverUrl || '', safeDurationMs]),
    };
};

const buildLrcText = (lyrics: LyricData, wordTiming: 'word' | 'line'): string | null => {
    if (lyrics.lines.length === 0) {
        return null;
    }
    const text = serializeEnhancedLrc(lyrics, {
        includeTranslation: false,
        includeRomanization: false,
        wordTiming,
    }).trim();
    return text ? text : null;
};

const oneLine = (text: string): string => text.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/**
 * LYS (Lyricify Syllable), the only word-level format now-playing clients read: its frontend
 * calls `parseLys` on `karaokeLyric` and gets `[]` from anything else. A line is `[0]` followed
 * by `word(startMs,durationMs)` pairs — no line timestamp, the first syllable carries it.
 */
const buildLysText = (lyrics: LyricData): string | null => {
    const lines: string[] = [];

    for (const line of lyrics.lines) {
        if (isInterludeLine(line) || line.words.length === 0) {
            continue;
        }
        let body = '';
        for (const word of line.words) {
            const startMs = Math.round(Math.max(0, word.startTime) * 1000);
            const durationMs = Math.max(0, Math.round((word.endTime - word.startTime) * 1000));
            body += `${word.text}(${startMs},${durationMs})`;
        }
        if (body) {
            lines.push(`[0]${body}`);
        }
    }

    return lines.length > 0 ? `${lines.join('\n')}\n` : null;
};

/** Clients parse `translatedLyric` as LRC and pair it to the main line by timestamp, so the tag
 *  has to be there — a bare list of translations parses to zero lines and vanishes. */
const buildTranslationText = (lyrics: LyricData): string | null => {
    const lines = lyrics.lines
        .filter(line => !isInterludeLine(line) && line.translation && line.translation.trim())
        .map(line => `${formatLrcLineTimestamp(line.startTime)}${oneLine(line.translation!)}`);
    return lines.length > 0 ? `${lines.join('\n')}\n` : null;
};

/**
 * Builds the outbound `Lyric` payload. `lrc` carries the line timeline and
 * `karaokeLyric` the word timeline as LYS (only when the lyric is genuinely word-by-word),
 * matching how the consumer side distinguishes the two.
 */
export const buildNowPlayingSenderLyric = (lyrics: LyricData | null): NowPlayingLyricPayload | null => {
    if (!lyrics || lyrics.lines.length === 0) {
        return null;
    }

    const isWordByWord = lyrics.isWordByWord === true;
    const lrc = buildLrcText(lyrics, 'line');
    const karaokeLyric = isWordByWord ? buildLysText(lyrics) : null;
    const translatedLyric = buildTranslationText(lyrics);

    if (!lrc && !karaokeLyric && !translatedLyric) {
        return null;
    }

    return {
        source: 'folia',
        title: (lyrics.title || '').trim(),
        artist: (lyrics.artist || '').trim(),
        durationMs: null,
        hasLyric: Boolean(lrc),
        hasTranslatedLyric: Boolean(translatedLyric),
        hasKaraokeLyric: Boolean(karaokeLyric),
        lrc,
        translatedLyric,
        karaokeLyric,
    };
};
