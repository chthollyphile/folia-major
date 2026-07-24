import { describe, it, expect } from 'vitest';
import {
  buildLyricLines,
  mapAllLyricsToLyricData,
  mapSongInfoToTrack,
  mapStatusToPlaybackState,
  toCoverSrc,
} from '../../../src/utils/playerCapMapping';
import { isInterludeLine } from '../../../src/utils/lyrics/parserCore';
import type { PlayerCapAllLyricsData } from '../../../src/types/playerCap';

// All fixtures are taken from real PlayerCap capture data (scenarios 09/03/06/04/01); only line counts are trimmed, values are unchanged.

// wesing: whole-line LRC (text_detailed is {}, no translation).
const wesingLrc: PlayerCapAllLyricsData = {
  title: '都是夜归人 - 许美静',
  duration: 296,
  position: 1.75,
  progress: 0.0059121624,
  count: 2,
  lyrics: [
    { index: 0, timestamp: 25.44, play_time: 25.24, text: '是冰冻的时分 已过夜深的夜晚', sub_text: '', text_detailed: {} },
    { index: 1, timestamp: 31.483, play_time: 31.282999, text: '往事就像流星刹那划过心房', sub_text: '', text_detailed: {} },
  ],
  lyrics_detailed: [],
};

// cloudmusicv3: YRC per-word + translation (words carry trailing spaces; join('') reconstructs the full line).
const cloudmusicYrc: PlayerCapAllLyricsData = {
  title: 'Cold - Maroon 5 / Future',
  duration: 234.308,
  position: 0,
  progress: 0,
  count: 1,
  lyrics: [
    {
      index: 0,
      timestamp: 3.6100001,
      play_time: 3.1100001,
      text: 'Cold enough to chill my bones',
      sub_text: '冷得足以冻到我的骨头',
      text_detailed: {
        timestamp: 4.44,
        play_time: 3.94,
        duration: 3.48,
        words: [
          { timestamp: 4.44, play_time: 3.94, duration: 1.08, text: 'Cold ' },
          { timestamp: 5.52, play_time: 5.02, duration: 0.36, text: 'enough ' },
          { timestamp: 5.88, play_time: 5.38, duration: 0.39, text: 'to ' },
          { timestamp: 6.27, play_time: 5.77, duration: 0.27, text: 'chill ' },
          { timestamp: 6.54, play_time: 6.04, duration: 0.33, text: 'my ' },
          { timestamp: 6.87, play_time: 6.37, duration: 1.05, text: 'bones' },
        ],
      },
    },
  ],
  lyrics_detailed: [],
};

// qqmusic: the first line is a platform metadata line ("title - artist"); per contract it is passed through as-is, not stripped.
const qqTitlePseudo: PlayerCapAllLyricsData = {
  title: '枝江 - 信陵',
  duration: 195,
  position: 0,
  progress: 0,
  count: 3,
  lyrics: [
    { index: 0, timestamp: 0, play_time: 0, text: '枝江 - 信陵', sub_text: '', text_detailed: {} },
    { index: 1, timestamp: 16.552, play_time: 16.152, text: '要问对哪个姑娘有所偏爱', sub_text: '', text_detailed: {} },
    { index: 2, timestamp: 20.534, play_time: 20.134, text: '可能换谁来都说不明白', sub_text: '', text_detailed: {} },
  ],
  lyrics_detailed: [],
};

// qqmusic instrumental: count 0, empty lyrics, but still a complete object.
const pureMusic: PlayerCapAllLyricsData = {
  title: 'FAIRY TAIL メインテーマ 2016 - 高梨康治',
  duration: 171,
  position: 0,
  progress: 0,
  count: 0,
  lyrics: [],
  lyrics_detailed: [],
};

const contentLines = (data: PlayerCapAllLyricsData) =>
  (mapAllLyricsToLyricData(data)?.lines ?? []).filter((l) => !isInterludeLine(l));

describe('buildLyricLines (default play_time basis)', () => {
  it('wesing line-level: whole line as a single Word, timing from play_time, no translation', () => {
    const lines = buildLyricLines(wesingLrc);
    expect(lines).toHaveLength(2);
    expect(lines[0].fullText).toBe('是冰冻的时分 已过夜深的夜晚');
    expect(lines[0].startTime).toBe(25.24); // play_time (default), not timestamp 25.44
    expect(lines[0].words).toHaveLength(1);
    expect(lines[0].words[0].text).toBe('是冰冻的时分 已过夜深的夜晚');
    expect(lines[0].endTime).toBe(31.282999); // closes out to the next line's play_time
    expect(lines[0].translation).toBeUndefined();
  });

  it('cloudmusic per-word: Word uses play_time/duration, join reconstructs the full line, translation comes from sub_text', () => {
    const lines = buildLyricLines(cloudmusicYrc);
    expect(lines).toHaveLength(1);
    expect(lines[0].words.map((w) => w.text).join('')).toBe('Cold enough to chill my bones');
    expect(lines[0].words[0].startTime).toBe(3.94); // first word's play_time (first word lights up only at 3.94)
    expect(lines[0].words[0].endTime).toBeCloseTo(5.02, 5); // 3.94 + 1.08
    expect(lines[0].startTime).toBe(3.1100001); // line-level play_time: keeps the line's head lead-in (the first line is not affected by convergence)
    expect(lines[0].translation).toBe('冷得足以冻到我的骨头');
  });

  it('timestamp basis: uses the raw timestamp instead', () => {
    expect(buildLyricLines(wesingLrc, 'timestamp')[0].startTime).toBe(25.44);
    const yrc = buildLyricLines(cloudmusicYrc, 'timestamp');
    expect(yrc[0].startTime).toBe(3.6100001); // line-level timestamp
    expect(yrc[0].words[0].startTime).toBe(4.44);
  });

  it('metadata line is passed through as-is, no heuristic stripping (contract: downstream must not assume the first lines are metadata)', () => {
    const lines = buildLyricLines(qqTitlePseudo);
    expect(lines).toHaveLength(3); // includes the first line "枝江 - 信陵"
    expect(lines[0].fullText).toBe('枝江 - 信陵');
  });
});

// Synthetic case (not real capture; only exercises per-word line close-out timing): two per-word lines, where line0's last word ends before line1.
// Under a large offset, if a per-word line closes out at "content end" it disappears before the next line arrives, exposing a blank gap;
// so a small gap (<=3s) should hang the per-word line to the next line's start, while a large gap (>3s) keeps content end and defers to the interlude.
const twoWordLines = (nextLineStart: number): PlayerCapAllLyricsData => ({
  title: 't',
  duration: 100,
  position: 0,
  progress: 0,
  count: 2,
  lyrics: [
    {
      index: 0, timestamp: 3.5, play_time: 3.0, text: 'ab', sub_text: '',
      text_detailed: {
        timestamp: 3.5, play_time: 3.0, duration: 2.0,
        words: [
          { timestamp: 3.5, play_time: 3.0, duration: 1.0, text: 'a' },
          { timestamp: 4.5, play_time: 4.0, duration: 1.0, text: 'b' }, // last word ends = 5.0
        ],
      },
    },
    {
      index: 1, timestamp: nextLineStart + 0.5, play_time: nextLineStart, text: 'cd', sub_text: '',
      text_detailed: {
        timestamp: nextLineStart + 0.5, play_time: nextLineStart, duration: 1.0,
        words: [{ timestamp: nextLineStart + 0.5, play_time: nextLineStart, duration: 1.0, text: 'cd' }],
      },
    },
  ],
  lyrics_detailed: [],
});

describe('per-word line close-out (avoid disappearing early under a large offset)', () => {
  it('small gap (last word 5.0 -> next line 6.0, 1s <=3): this line hangs to the next line start', () => {
    const lines = buildLyricLines(twoWordLines(6.0));
    expect(lines[0].endTime).toBe(6.0); // closes out to the next line, not the last word's end 5.0
    expect(lines[0].words[1].endTime).toBe(5.0); // per-word highlight timing unchanged, last word still ends at 5.0
  });

  it('large gap (last word 5.0 -> next line 9.0, 4s >3): keeps content end, defers to the interlude', () => {
    const lines = buildLyricLines(twoWordLines(9.0));
    expect(lines[0].endTime).toBe(5.0); // last word ends; attachInterludes inserts an interlude in 5~9
  });
});

// Whole-line (text_detailed is {}): no internal duration, so line duration is capped by Folia's native parseLRC reading time (text.length*0.5+2,
// capped only when the gap > that value AND > 5s). A short line facing a long instrumental gap should leave a blank and defer to attachInterludes for the interlude,
// rather than hanging the previous line all the way to the next line's start (matching native LRC rendering).
const twoPlainLines = (nextLineStart: number, text = 'ab'): PlayerCapAllLyricsData => ({
  title: 't',
  duration: 100,
  position: 0,
  progress: 0,
  count: 2,
  lyrics: [
    { index: 0, timestamp: 0, play_time: 0, text, sub_text: '', text_detailed: {} },
    { index: 1, timestamp: nextLineStart, play_time: nextLineStart, text: 'next', sub_text: '', text_detailed: {} },
  ],
  lyrics_detailed: [],
});

describe('whole-line duration cap (long instrumental gap deferred to the interlude)', () => {
  it('gap 4s (> reading cap 3 but <=5s): not capped, fills up to the next line start', () => {
    expect(buildLyricLines(twoPlainLines(4))[0].endTime).toBe(4);
  });

  it('long gap 15s (short line): capped to reading time 3s, leaves a blank deferred to the interlude', () => {
    expect(buildLyricLines(twoPlainLines(15))[0].endTime).toBe(3); // 0 + (2*0.5+2), not the next line start 15
  });
});

// Matches real capture "Nothing's Gonna Change My Love For You": line-level times and per-word times are two separate tracks.
// index1's line-level play_time (43.619) precedes index0's last per-word (44.76). Using line-level times for line switching would cut index0 away
// early at 43.619 and swallow the line ending "know". Switching a per-word line on the per-word boundary avoids this.
const lineVsWordOverlap: PlayerCapAllLyricsData = {
  title: 't',
  duration: 100,
  position: 0,
  progress: 0,
  count: 2,
  lyrics: [
    {
      index: 0, timestamp: 41.299, play_time: 40.799, text: 'our dreams are young and we both know', sub_text: '',
      text_detailed: {
        timestamp: 41.96, play_time: 41.46, duration: 3.3,
        words: [
          { timestamp: 41.96, play_time: 41.46, duration: 0.5, text: 'our ' },
          { timestamp: 44.54, play_time: 44.04, duration: 0.72, text: 'know' }, // last word ends 44.76
        ],
      },
    },
    {
      index: 1, timestamp: 44.119, play_time: 43.619, text: "they'll take us where we want to go", sub_text: '',
      text_detailed: {
        timestamp: 45.29, play_time: 44.79, duration: 3.39,
        words: [{ timestamp: 45.29, play_time: 44.79, duration: 0.81, text: 'go' }], // first word 44.79
      },
    },
  ],
  lyrics_detailed: [],
};

// Mixed per-word + whole-line: index0 is per-word (last word ends 6.0); index1 is whole-line and its line-level 5.0 precedes index0's last word.
// Boundary raised by the user: without start-point convergence, whole-line index1 would cut index0 away early at 5.0 and swallow the line ending.
const mixedWordThenEarlyLine: PlayerCapAllLyricsData = {
  title: 't',
  duration: 100,
  position: 0,
  progress: 0,
  count: 2,
  lyrics: [
    {
      index: 0, timestamp: 3.0, play_time: 3.0, text: 'a b', sub_text: '',
      text_detailed: {
        timestamp: 3.0, play_time: 3.0, duration: 3.0,
        words: [
          { timestamp: 3.0, play_time: 3.0, duration: 1.0, text: 'a ' },
          { timestamp: 5.0, play_time: 5.0, duration: 1.0, text: 'b' }, // last word ends 6.0
        ],
      },
    },
    { index: 1, timestamp: 5.0, play_time: 5.0, text: 'plain line', sub_text: '', text_detailed: {} }, // whole-line, line-level 5.0
  ],
  lyrics_detailed: [],
};

describe('monotonic start-point convergence: a line-level time earlier than the previous line content end is pushed forward, no early word swallowing', () => {
  it('per-word to per-word: index0 uses line-level 40.799; index1 line-level 43.619 is pushed to index0 last word 44.76', () => {
    const lines = buildLyricLines(lineVsWordOverlap);
    expect(lines[0].startTime).toBe(40.799);
    expect(lines[1].startTime).toBe(44.76);
  });

  it('per-word to per-word: index0 is fully preserved to its last word (including the line ending know, 44.76), not closed out early at line-level 43.619', () => {
    const lines = buildLyricLines(lineVsWordOverlap);
    expect(lines[0].endTime).toBe(44.76);
  });

  it('mixed per-word + whole-line: whole-line index1 line-level 5.0 precedes per-word index0 last word 6.0, pushed to 6.0, index0 fully preserved', () => {
    const lines = buildLyricLines(mixedWordThenEarlyLine);
    expect(lines[1].startTime).toBe(6.0);
    expect(lines[0].endTime).toBe(6.0);
  });

  it('whole-line -> per-word: whole-line index0 has no word tail to consume, hangs to index1 start; per-word index1 keeps its words and word tail intact', () => {
    const lineThenWord: PlayerCapAllLyricsData = {
      title: 't', duration: 100, position: 0, progress: 0, count: 2,
      lyrics: [
        { index: 0, timestamp: 3.0, play_time: 3.0, text: 'plain', sub_text: '', text_detailed: {} }, // whole-line
        {
          index: 1, timestamp: 5.0, play_time: 5.0, text: 'x y', sub_text: '',
          text_detailed: {
            timestamp: 5.3, play_time: 5.3, duration: 1.7,
            words: [
              { timestamp: 5.3, play_time: 5.3, duration: 0.5, text: 'x ' },
              { timestamp: 6.5, play_time: 6.5, duration: 0.5, text: 'y' }, // last word ends 7.0
            ],
          },
        },
      ],
      lyrics_detailed: [],
    };
    const lines = buildLyricLines(lineThenWord);
    expect(lines[0].startTime).toBe(3.0);
    expect(lines[0].endTime).toBe(5.0); // whole-line hangs to per-word index1 start
    expect(lines[1].startTime).toBe(5.0); // line-level (> previous line content end 3.0, so not pushed)
    expect(lines[1].words).toHaveLength(2);
    expect(lines[1].words[1].endTime).toBe(7.0); // word tail intact
    expect(lines[1].endTime).toBe(7.0);
  });
});

describe('mapAllLyricsToLyricData', () => {
  it('instrumental (count 0) returns null', () => {
    expect(mapAllLyricsToLyricData(pureMusic)).toBeNull();
  });

  it('wesing isWordByWord=false', () => {
    const result = mapAllLyricsToLyricData(wesingLrc);
    expect(result).not.toBeNull();
    expect(result!.isWordByWord).toBe(false);
    expect(contentLines(wesingLrc).length).toBe(2);
  });

  it('cloudmusic isWordByWord=true', () => {
    const result = mapAllLyricsToLyricData(cloudmusicYrc);
    expect(result!.isWordByWord).toBe(true);
    expect(result!.title).toBe('Cold - Maroon 5 / Future');
  });
});

describe('mapSongInfoToTrack / toCoverSrc', () => {
  it('uses the cover URL when there is no base64', () => {
    const t = mapSongInfoToTrack({ name: 'Cold', singer: 'Maroon 5 / Future', title: 'Cold - Maroon 5 / Future', cover: 'https://x/y.jpg', cover_base64: '' });
    expect(t).toEqual({ name: 'Cold', artist: 'Maroon 5 / Future', coverUrl: 'https://x/y.jpg', title: 'Cold - Maroon 5 / Future' });
  });

  it('returns as-is when it already carries a data: prefix (all four sources do so in captures, both jpg/jpeg); bare base64 falls back to jpeg', () => {
    expect(toCoverSrc('data:image/jpeg;base64,/9j/AAAQ', '')).toBe('data:image/jpeg;base64,/9j/AAAQ');
    expect(toCoverSrc('data:image/jpg;base64,/9j/BBBB', '')).toBe('data:image/jpg;base64,/9j/BBBB');
    expect(toCoverSrc('AAAA', 'https://x/y.jpg')).toBe('data:image/jpeg;base64,AAAA'); // defensive fallback
    expect(toCoverSrc('', '')).toBe('');
  });
});

describe('mapStatusToPlaybackState', () => {
  it('playing/paused map directly, everything else maps to idle', () => {
    expect(mapStatusToPlaybackState('playing')).toBe('playing');
    expect(mapStatusToPlaybackState('paused')).toBe('paused');
    expect(mapStatusToPlaybackState('standby')).toBe('idle');
    expect(mapStatusToPlaybackState('offline')).toBe('idle');
  });
});

