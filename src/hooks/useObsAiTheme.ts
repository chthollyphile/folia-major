import { useEffect, useRef, useState } from 'react';
import type { DualTheme } from '../types';
import type { WebLyricSourceState } from '../types/webLyricSource';
import { generateObsThemeFromLyrics, type ObsAiConfig } from '../services/aiText';

// Dynamic AI web OBS overlay: regenerate an AI DualTheme once per song from the lyrics the source
// provides. Returns null until (and unless) one is generated, so the overlay shows the cover-derived
// builtin theme meanwhile and on any failure. Runs in the OBS browser context, so it never touches
// the app's localStorage/cache (a replayed song regenerates); generation is keyless, hitting the
// same server endpoint the main-window path uses.
//
// track and lyrics arrive on separate source messages (and sticky mode keeps a previous song's
// lyrics), so on a song change the lyrics still in state belong to the OLD song. Generating from
// those would lock a wrong theme onto the new song. Hence: on a real song change we snapshot the
// lingering lyrics as a stale baseline and only generate once genuinely-fresh lyrics for the new
// song arrive.
export function useObsAiTheme(params: {
  enabled: boolean;
  aiConfig: ObsAiConfig | null;
  state: WebLyricSourceState;
}): DualTheme | null {
  const { enabled, aiConfig, state } = params;
  const [aiTheme, setAiTheme] = useState<DualTheme | null>(null);
  const prevTrackKeyRef = useRef<string>('');    // last non-empty song seen (song-change detector)
  const staleLyricsRef = useRef<string>('');      // the previous song's lyrics, to reject as not-yet-fresh
  const completedForKeyRef = useRef<string>('');  // song we've successfully generated for (don't regenerate)
  const failedForKeyRef = useRef<string>('');     // song whose generation failed (don't retry until it changes)

  const track = state.track;
  const trackName = track?.name;
  const trackKey = track ? `${track.name} ${track.artist}` : '';
  const lyricsText = (state.lyrics?.lines ?? []).map((line) => line.fullText).join('\n').trim();

  useEffect(() => {
    if (!enabled || !aiConfig) {
      setAiTheme(null);
      return;
    }
    // Transient no-track (e.g. player_clear) — keep the current theme, decide nothing until a track returns.
    if (!trackKey) return;

    if (trackKey !== prevTrackKeyRef.current) {
      // Real song change. On the very first song there is no previous song, so its lyrics are not stale.
      const isFirstSong = prevTrackKeyRef.current === '';
      prevTrackKeyRef.current = trackKey;
      staleLyricsRef.current = isFirstSong ? '' : lyricsText;
      completedForKeyRef.current = '';
      failedForKeyRef.current = '';
      setAiTheme(null); // show the cover builtin until this song's AI theme (if any) is generated
    }

    if (completedForKeyRef.current === trackKey) return; // already have this song's theme
    if (failedForKeyRef.current === trackKey) return;    // this song's generation failed — don't hammer the endpoint
    if (!lyricsText || lyricsText === staleLyricsRef.current) return; // no genuinely-fresh lyrics for this song yet

    // Debounce on lyric settle: lyricsText is a dependency, so each update reschedules; the request
    // fires ~1s after lyrics stop changing.
    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(() => {
      void generateObsThemeFromLyrics(
        lyricsText,
        trackName ? { songTitle: trackName } : undefined,
        aiConfig,
        controller.signal,
      )
        .then((theme) => {
          if (cancelled) return;
          completedForKeyRef.current = trackKey;
          setAiTheme(theme);
        })
        .catch(() => {
          // Aborted (cancelled) means lyrics changed mid-flight — leave it retryable. A genuine
          // failure marks the song so we don't re-hit the endpoint on every later lyric tweak.
          if (!cancelled) failedForKeyRef.current = trackKey;
        });
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, aiConfig, trackKey, trackName, lyricsText]);

  return aiTheme;
}
