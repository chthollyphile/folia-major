import type { Line, LyricData, Word } from '../types';
import { finalizeParsedLyricLines } from './lyrics/parserCore';
import type {
  PlayerCapAllLyricsData,
  PlayerCapLyricLine,
  PlayerCapMaybeDetailed,
  PlayerCapSongInfoData,
  PlayerCapTextDetailed,
} from '../types/playerCap';

// Pure mapping from PlayerCap events to Folia shapes (black-box consumption, no side effects, unit-testable).
// The time basis is chosen by the timeBasis switch; both modes clock on progress×duration (realtime, offset-independent):
//   - 'play_time' (default): lines/words use play_time (already includes each PlayerCap player's offset tuning).
//     Since PlayerCap only pushes lyric_update when realtime≈play_time, lines keyed on play_time align naturally
//     with the progress clock, matching PlayerCap's display timing — no need to recompute offset on the Folia side.
//   - 'timestamp': lines/words use the raw timestamp (on-beat, ignores PlayerCap offset; can be fine-tuned via Folia's own offset control).

export type PlayerCapTimeBasis = 'timestamp' | 'play_time';

const DEFAULT_TIME_BASIS: PlayerCapTimeBasis = 'play_time';
const LAST_LINE_FALLBACK_SEC = 5;
// Matches parserCore attachInterludes' interlude threshold (only gaps >3s get an interlude "……").
// Word-by-word line content may end before the next line; this constant distinguishes "small gap attached to next line"
// vs "large gap handed to the interlude" (see buildLine).
const INTERLUDE_GAP_SEC = 3;

const hasWords = (td: PlayerCapMaybeDetailed): td is PlayerCapTextDetailed =>
  !!td && Array.isArray((td as PlayerCapTextDetailed).words) && (td as PlayerCapTextDetailed).words.length > 0;

// Content end of a line: for word-by-word lines = last word's endTime; line-level lines have no internal duration,
// so content end equals their (converged) start. Used for monotonic start convergence.
function lineContentEnd(line: PlayerCapLyricLine, basis: PlayerCapTimeBasis, start: number): number {
  const td = line.text_detailed;
  return hasWords(td) ? td.words.reduce((end, w) => Math.max(end, w[basis] + w.duration), start) : start;
}

// A single PlayerCap lyric line → Folia Line. Word-by-word lines use the words' timing; line-level lines degrade to one Word for the whole line.
// startTime/nextStart are computed uniformly by buildLyricLines (already monotonic-start-converged) and passed in; basis selects timestamp or play_time.
function buildLine(line: PlayerCapLyricLine, basis: PlayerCapTimeBasis, startTime: number, nextStart: number | undefined): Line {
  const detailed = hasWords(line.text_detailed) ? line.text_detailed : null;
  let rawEnd: number;
  if (detailed) {
    rawEnd = detailed.words.reduce((end, w) => Math.max(end, w[basis] + w.duration), startTime);
  } else if (nextStart === undefined) {
    rawEnd = startTime + LAST_LINE_FALLBACK_SEC;
  } else {
    // Line-level lines have no internal duration: cap at Folia's native parseLRC reading duration (text.length×0.5+2,
    // capping only when the gap exceeds both that value and 5s), so long instrumental gaps leave room for
    // attachInterludes to insert "……", matching native LRC rendering; short gaps are still snapped below to the next line's start.
    const gap = nextStart - startTime;
    const readingCap = line.text.length * 0.5 + 2;
    rawEnd = gap > readingCap && gap > 5 ? startTime + readingCap : nextStart;
  }
  // Snap strategy: the last line uses content end; if it overlaps the next line, snap to the next line's start. Word-by-word
  // content (last word's end) often finishes before the next line — a small gap (≤3s, no interlude) snaps to the next line's
  // start to avoid the "content sung early then disappears → blank" look under large offsets; a large gap (>3s) keeps the
  // content end and hands it to attachInterludes to insert an interlude "……".
  let endTime: number;
  if (nextStart === undefined) {
    endTime = rawEnd;
  } else if (rawEnd >= nextStart || nextStart - rawEnd <= INTERLUDE_GAP_SEC) {
    endTime = nextStart;
  } else {
    endTime = rawEnd;
  }
  if (endTime < startTime) endTime = startTime;

  const words: Word[] = detailed
    ? detailed.words.map((w) => ({ text: w.text, startTime: w[basis], endTime: w[basis] + w.duration }))
    : [{ text: line.text, startTime, endTime }];

  const translation = line.sub_text && line.sub_text.trim() ? line.sub_text : undefined;
  return { words, startTime, endTime, fullText: line.text, ...(translation ? { translation } : {}) };
}

// Raw line construction without finalize (interludes/renderHints), for precise unit-test assertions.
export function buildLyricLines(data: PlayerCapAllLyricsData, basis: PlayerCapTimeBasis = DEFAULT_TIME_BASIS): Line[] {
  // Pass platform lyrics through as-is: the contract states "downstream can neither assume the first lines are metadata
  // (lyricist/composer/Written by…) nor assume they are not", so we do no heuristic stripping here; users who want to remove
  // credit lines use Folia's existing lyric-filtering regex.
  const usable = (data.lyrics ?? []).filter((l) => l.index >= 0);
  // Monotonic start convergence: PlayerCap's line-level play_time/timestamp and the word-by-word (text_detailed) timings are
  // two separate clocks with inconsistent lead times, so the next line's line-level start (especially a line-level line with no
  // words) may precede the previous line's last word → premature line switch that swallows the trailing words (mixed
  // word-by-word + line-level behaves the same). Force each line's start no earlier than the previous line's content end to
  // flatten this overlap; the line-level lead is preserved (when there is no overlap, the line head still appears early as usual).
  const starts: number[] = [];
  let prevContentEnd = Number.NEGATIVE_INFINITY;
  for (const l of usable) {
    const start = Math.max(l[basis], prevContentEnd);
    starts.push(start);
    prevContentEnd = lineContentEnd(l, basis, start);
  }
  return usable.map((l, i) => buildLine(l, basis, starts[i], starts[i + 1]));
}

// all_lyrics → LyricData; returns null for instrumental / no lyrics (count:0 or empty after filtering).
export function mapAllLyricsToLyricData(
  data: PlayerCapAllLyricsData,
  basis: PlayerCapTimeBasis = DEFAULT_TIME_BASIS,
): LyricData | null {
  if (!data || data.count === 0 || !Array.isArray(data.lyrics) || data.lyrics.length === 0) {
    return null;
  }
  const lines = buildLyricLines(data, basis);
  if (lines.length === 0) return null;

  const isWordByWord = (data.lyrics ?? []).some((l) => hasWords(l.text_detailed));
  const title = (data.title ?? '').trim();
  return {
    lines: finalizeParsedLyricLines(lines),
    ...(title ? { title } : {}),
    isWordByWord,
  };
}

export interface PlayerCapTrack {
  name: string;
  artist: string;
  coverUrl: string; // URL or data: URI, may be ""
  title: string;
}

// Cover base64 → a directly usable image source. Verified on real devices (four vendors): cover_base64 already carries a full
// data:image/...;base64, prefix (cloudmusicv3 is image/jpg, the rest image/jpeg), so a startsWith('data:') value is returned
// as-is; the bare-base64 branch is only a defensive fallback.
export function toCoverSrc(coverBase64: string, coverUrl: string): string {
  const b64 = coverBase64?.trim();
  if (b64) {
    if (b64.startsWith('data:') || b64.startsWith('http')) return b64;
    return `data:image/jpeg;base64,${b64}`;
  }
  return coverUrl || '';
}

// song_info_update → Folia track snapshot. Read name/singer directly for title/artist; do not parse title.
export function mapSongInfoToTrack(data: PlayerCapSongInfoData): PlayerCapTrack {
  return {
    name: data.name || data.title || '',
    artist: data.singer || '',
    coverUrl: toCoverSrc(data.cover_base64, data.cover),
    title: data.title || data.name || '',
  };
}

export type PlayerCapPlaybackState = 'playing' | 'paused' | 'idle';

// status_update.status → playback state. Unknown/standby/offline/error all map to idle (fail-safe, aligned with the PlayerCap contract).
export function mapStatusToPlaybackState(status: string): PlayerCapPlaybackState {
  if (status === 'playing') return 'playing';
  if (status === 'paused') return 'paused';
  return 'idle';
}
