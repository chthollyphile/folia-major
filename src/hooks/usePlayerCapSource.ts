import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayerCapProvider } from '../services/playerCapProvider';
import { currentPosition, initialPlayerCapSession, reducePlayerCapEvent } from '../utils/playerCapSession';
import type { PlayerCapSessionState } from '../utils/playerCapSession';
import { mapAllLyricsToLyricData } from '../utils/playerCapMapping';
import type { PlayerCapTimeBasis } from '../utils/playerCapMapping';
import type { PlayerCapAllLyricsData, PlayerCapConnectionStatus, PlayerCapEvent, PlayerCapPlayerSwitchData } from '../types/playerCap';

// Wire the tested PlayerCapProvider (I/O) and playerCapSession (pure reducer) into React state:
// provider event → reduce → state; host/player/timeBasis changes handled incrementally. Shared by the obs page and settings preview.

export interface UsePlayerCapSourceOptions {
  enabled: boolean;
  host: string;   // e.g. 'localhost:8765'
  player: string; // '' = follow root /ws (currently active player); non-empty = pin to that player
  timeBasis: PlayerCapTimeBasis;
  sticky?: boolean; // keep lyrics persistent: ignore clears from player_clear/player_switch(to='')/lyric_idle (see reducePlayerCapEvent)
}

export interface PlayerCapSource {
  state: PlayerCapSessionState;
  players: string[]; // /service-status.player_support, for UI selection
  // Current lyric time (seconds): extrapolated from progress×duration, shared by both time bases; feeds findLatestActiveLineIndex and per-word animation.
  getCurrentTimeSec: (nowMs: number) => number;
}

export function usePlayerCapSource({ enabled, host, player, timeBasis, sticky = false }: UsePlayerCapSourceOptions): PlayerCapSource {
  const [state, setState] = useState<PlayerCapSessionState>(initialPlayerCapSession);
  const [players, setPlayers] = useState<string[]>([]);

  // Read the latest timeBasis/sticky inside callbacks, to avoid rebuilding the connection when they change.
  const timeBasisRef = useRef(timeBasis);
  timeBasisRef.current = timeBasis;
  const stickyRef = useRef(sticky);
  stickyRef.current = sticky;
  const lastAllLyricsRef = useRef<PlayerCapAllLyricsData | null>(null);
  const providerRef = useRef<PlayerCapProvider | null>(null);
  // Read the clock via a ref so getCurrentTimeSec keeps a stable identity: state.clock is a new object on every clock event,
  // and using it as a dependency would make the shared rAF loop (usePlaybackVisualizerBridge) repeatedly cancel/remount. Mirrors the now-playing ref pattern.
  const clockRef = useRef(state.clock);
  clockRef.current = state.clock;

  // Lifecycle: when enabled, create the provider and start it; on unmount/disable, destroy it. host/player changes are applied incrementally by the effect below, not rebuilt here.
  useEffect(() => {
    if (!enabled) return undefined;
    const provider = new PlayerCapProvider(
      {
        onConnectionStatusChange: (status: PlayerCapConnectionStatus) => setState((s) => ({ ...s, connectionStatus: status })),
        onServiceStatus: (data) => {
          // player_support is a new array reference on every poll but its contents usually don't change; if a shallow compare is equal, reuse the old reference to avoid needless rebuilds downstream (settingsDialog).
          if (Array.isArray(data.player_support)) {
            const next = data.player_support;
            setPlayers((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
          }
        },
        onEvent: (event: PlayerCapEvent) => {
          // Keep lastAllLyricsRef clearing consistent with the reducer: under sticky, clear events that would wipe lyrics (player_clear, player_switch(to=''))
          // also keep the cache, so a later timeBasis switch still has a source to remap. A real source switch (to non-empty) always clears.
          if (event.type === 'all_lyrics') lastAllLyricsRef.current = event.data as PlayerCapAllLyricsData;
          else if (event.type === 'player_clear') { if (!stickyRef.current) lastAllLyricsRef.current = null; }
          else if (event.type === 'player_switch') {
            const to = (event.data as PlayerCapPlayerSwitchData)?.to || '';
            if (to || !stickyRef.current) lastAllLyricsRef.current = null;
          }
          setState((s) => reducePlayerCapEvent(s, event, { timeBasis: timeBasisRef.current, nowMs: Date.now(), sticky: stickyRef.current }));
        },
      },
      { host, player },
    );
    providerRef.current = provider;
    provider.start();
    return () => {
      provider.destroy();
      providerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // host/player change: update the provider (it disconnects and reconnects internally).
  useEffect(() => {
    const provider = providerRef.current;
    if (!provider) return;
    provider.host = host;
    provider.player = player;
  }, [host, player]);

  // timeBasis change: rebuild lyrics from the most recent all_lyrics under the new basis (the clock is basis-independent and left untouched).
  useEffect(() => {
    const raw = lastAllLyricsRef.current;
    if (!raw) return;
    setState((s) => ({ ...s, lyrics: mapAllLyricsToLyricData(raw, timeBasis) }));
  }, [timeBasis]);

  const getCurrentTimeSec = useCallback((nowMs: number) => currentPosition(clockRef.current, nowMs), []);

  return { state, players, getCurrentTimeSec };
}
