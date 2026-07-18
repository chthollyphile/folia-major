import { useCallback, useEffect, useRef, useState } from 'react';
import { NowPlayingProvider, buildNowPlayingWsUrl } from '../services/nowPlayingProvider';
import { buildNowPlayingLyricSource } from '../utils/lyrics/nowPlayingSource';
import { LyricParserFactory } from '../utils/lyrics/LyricParserFactory';
import { currentWebLyricTimeSec } from '../utils/webLyricSource';
import { initialWebLyricSourceState } from '../types/webLyricSource';
import type { WebLyricSource, WebLyricSourceState } from '../types/webLyricSource';
import type { LyricData, NowPlayingLyricPayload, NowPlayingTrackSnapshot } from '../types';

// Adapt the upstream NowPlayingProvider (browser WS, pure I/O) into the neutral
// WebLyricSource consumed by the OBS web shell. Reuses the existing lyric mapping
// (buildNowPlayingLyricSource + LyricParserFactory); the clock anchor is driven by the
// WS progress/pause events. The clock is read through a ref so getCurrentTimeSec keeps a
// stable identity and does not tear down the shared rAF loop (mirrors usePlayerCapSource).

export interface UseNowPlayingSourceOptions {
  enabled: boolean;
  host: string; // e.g. 'localhost:9863'
}

export function useNowPlayingSource({ enabled, host }: UseNowPlayingSourceOptions): WebLyricSource {
  const [state, setState] = useState<WebLyricSourceState>(initialWebLyricSourceState);

  const clockRef = useRef(state.clock);
  clockRef.current = state.clock;
  // Latest duration (track first, then lyric) used to clamp the clock.
  const durationSecRef = useRef(0);
  // Request id guarding the async lyric parse against races: a stale parse must not
  // overwrite a newer track.
  const lyricRequestIdRef = useRef(0);

  // Lifecycle: build and start a provider per host while enabled; a host change rebuilds
  // it (the provider has no mutable endpoint).
  useEffect(() => {
    if (!enabled) return undefined;
    durationSecRef.current = 0;

    const provider = new NowPlayingProvider(
      {
        onConnectionStatusChange: (status) => setState((s) => ({ ...s, connectionStatus: status })),
        onTrack: (track: NowPlayingTrackSnapshot | null) => {
          const durMs = track?.durationMs ?? 0;
          if (durMs > 0) durationSecRef.current = durMs / 1000;
          setState((s) => ({
            ...s,
            track: track
              ? { name: track.title, artist: track.artist, coverUrl: track.coverUrl, seed: track.title }
              : null,
          }));
        },
        onLyric: (payload: NowPlayingLyricPayload | null) => {
          const requestId = lyricRequestIdRef.current + 1;
          lyricRequestIdRef.current = requestId;
          if (!payload) {
            setState((s) => ({ ...s, lyrics: null }));
            return;
          }
          if (payload.durationMs) durationSecRef.current = Math.max(durationSecRef.current, payload.durationMs / 1000);
          const lyricSource = buildNowPlayingLyricSource(payload);
          if (!lyricSource) {
            setState((s) => ({ ...s, lyrics: null }));
            return;
          }
          void LyricParserFactory.parse(lyricSource as never)
            .then((parsed: LyricData | null) => {
              if (lyricRequestIdRef.current === requestId) setState((s) => ({ ...s, lyrics: parsed }));
            })
            .catch(() => {
              // Parse failed: keep the current lyrics.
            });
        },
        onPauseState: (isPaused: boolean) => {
          setState((s) => {
            // Re-anchor on pause/resume: freeze at the current extrapolated position /
            // continue from now, avoiding a jump.
            const nowMs = Date.now();
            const pos = currentWebLyricTimeSec(s.clock, nowMs);
            return {
              ...s,
              playerState: isPaused ? 'paused' : 'playing',
              clock: { positionSec: pos, durationSec: durationSecRef.current, anchoredAtMs: nowMs, playing: !isPaused },
            };
          });
        },
        onProgress: ({ progressMs }) => {
          // Progress event provides the anchor position; playing is the current non-paused
          // state (treated as playing when the first progress arrives before any pause state).
          setState((s) => ({
            ...s,
            clock: {
              positionSec: Math.max(0, progressMs / 1000),
              durationSec: durationSecRef.current,
              anchoredAtMs: Date.now(),
              playing: s.playerState !== 'paused',
            },
          }));
        },
      },
      { wsUrl: buildNowPlayingWsUrl(host) },
    );

    provider.start();
    return () => provider.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, host]);

  const getCurrentTimeSec = useCallback((nowMs: number) => currentWebLyricTimeSec(clockRef.current, nowMs), []);

  return { state, getCurrentTimeSec };
}
