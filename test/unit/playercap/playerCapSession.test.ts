import { describe, it, expect } from 'vitest';
import {
  initialPlayerCapSession,
  reducePlayerCapEvent,
  currentPosition,
  type PlayerCapSessionState,
} from '../../../src/utils/playerCapSession';
import type { PlayerCapEvent } from '../../../src/types/playerCap';

// Events taken from real PlayerCap capture data (03-wesing-healthy scenario), only trimmed in row count.
const opts = (nowMs: number) => ({ timeBasis: 'play_time' as const, nowMs });

const wesingAllLyrics: PlayerCapEvent = {
  type: 'all_lyrics',
  player: 'wesing',
  data: {
    title: '都是夜归人 - 许美静',
    duration: 296,
    play_time: 1.75,
    progress: 0.0059121624,
    count: 2,
    lyrics: [
      { index: 0, timestamp: 25.44, play_time: 25.24, text: '是冰冻的时分 已过夜深的夜晚', sub_text: '', text_detailed: {} },
      { index: 1, timestamp: 31.483, play_time: 31.282999, text: '往事就像流星刹那划过心房', sub_text: '', text_detailed: {} },
    ],
    lyrics_detailed: [],
  },
};

const sequence: PlayerCapEvent[] = [
  { type: 'player_switch', player: 'wesing', data: { from: '', to: 'wesing' } },
  { type: 'status_update', player: 'wesing', data: { status: 'playing', detail: '都是夜归人 - 许美静' } },
  { type: 'song_info_update', player: 'wesing', data: { name: '都是夜归人', singer: '许美静', title: '都是夜归人 - 许美静', cover: '', cover_base64: '' } },
  wesingAllLyrics,
  { type: 'lyric_update', player: 'wesing', data: { index: 0, text: '是冰冻的时分 已过夜深的夜晚', sub_text: '', timestamp: 25.44, play_time: 25.24, progress: 0.08530405, text_detailed: {} } },
];

function playThrough(events: PlayerCapEvent[], startNow = 1000): PlayerCapSessionState {
  return events.reduce((state, ev, i) => reducePlayerCapEvent(state, ev, opts(startNow + i * 100)), initialPlayerCapSession());
}

describe('reducePlayerCapEvent (wesing playback sequence replay)', () => {
  it('player_switch sets the active player and clears residual content', () => {
    const s = reducePlayerCapEvent(initialPlayerCapSession(), sequence[0], opts(1000));
    expect(s.activePlayer).toBe('wesing');
    expect(s.lyrics).toBeNull();
    expect(s.track).toBeNull();
  });

  it('status_update playing → playback state and clock', () => {
    const s = playThrough(sequence.slice(0, 2));
    expect(s.playerState).toBe('playing');
    expect(s.clock.playing).toBe(true);
  });

  it('song_info_update → track (name/singer, coverUrl is "" when cover is empty)', () => {
    const s = playThrough(sequence.slice(0, 3));
    expect(s.track).toEqual({ name: '都是夜归人', artist: '许美静', coverUrl: '', title: '都是夜归人 - 许美静' });
  });

  it('all_lyrics → lyrics non-empty, clock duration/position anchored from progress×duration', () => {
    const s = playThrough(sequence.slice(0, 4));
    expect(s.lyrics).not.toBeNull();
    expect(s.clock.durationSec).toBe(296);
    expect(s.clock.positionSec).toBeCloseTo(1.75, 2); // 0.0059121624 × 296
  });

  it('lyric_update → clock re-anchored to the new progress', () => {
    const s = playThrough(sequence);
    expect(s.clock.positionSec).toBeCloseTo(25.25, 1); // 0.08530405 × 296
  });

  it('playback_pause / resume toggles playing', () => {
    const paused = reducePlayerCapEvent(playThrough(sequence), { type: 'playback_pause', player: 'wesing', data: { play_time: 32.2 } }, opts(2000));
    expect(paused.playerState).toBe('paused');
    expect(paused.clock.playing).toBe(false);
    const resumed = reducePlayerCapEvent(paused, { type: 'playback_resume', player: 'wesing', data: { play_time: 32.25 } }, opts(2100));
    expect(resumed.playerState).toBe('playing');
    expect(resumed.clock.playing).toBe(true);
  });

  it('player_clear wipes all content', () => {
    const cleared = reducePlayerCapEvent(playThrough(sequence), { type: 'player_clear', player: '', data: {} }, opts(3000));
    expect(cleared.track).toBeNull();
    expect(cleared.lyrics).toBeNull();
    expect(cleared.playerState).toBe('idle');
    expect(cleared.activePlayer).toBeNull();
  });

  it('lyric_idle only clears lyrics, leaves track/playback state untouched (weaker than player_clear)', () => {
    const before = playThrough(sequence); // playerState=playing, track populated
    const idled = reducePlayerCapEvent(before, { type: 'lyric_idle', player: 'wesing', data: {} }, opts(3000));
    expect(idled.lyrics).toBeNull();
    expect(idled.track).toEqual(before.track); // track retained
    expect(idled.playerState).toBe('playing'); // not forced by lyric_idle; driven by status_update
    expect(idled.activePlayer).toBe('wesing');
  });
});

describe('sticky (lyrics persist): ignore clears, only honor real source switches', () => {
  const stickyOpts = (nowMs: number) => ({ timeBasis: 'play_time' as const, nowMs, sticky: true });

  it('under sticky, player_clear retains all content', () => {
    const before = playThrough(sequence);
    const after = reducePlayerCapEvent(before, { type: 'player_clear', player: '', data: {} }, stickyOpts(3000));
    expect(after.lyrics).not.toBeNull();
    expect(after.track).toEqual(before.track);
    expect(after.activePlayer).toBe('wesing');
  });

  it('under sticky, player_switch(to="") does not clear the display', () => {
    const before = playThrough(sequence);
    const after = reducePlayerCapEvent(before, { type: 'player_switch', player: '', data: { from: 'wesing', to: '' } }, stickyOpts(3000));
    expect(after.lyrics).not.toBeNull();
    expect(after.track).toEqual(before.track);
  });

  it('under sticky, lyric_idle does not clear lyrics', () => {
    const before = playThrough(sequence);
    const after = reducePlayerCapEvent(before, { type: 'lyric_idle', player: 'wesing', data: {} }, stickyOpts(3000));
    expect(after.lyrics).not.toBeNull();
  });

  it('under sticky, a real source switch player_switch(to="X") still runs: clears residual + sets new player', () => {
    const before = playThrough(sequence);
    const after = reducePlayerCapEvent(before, { type: 'player_switch', player: 'cloudmusicv3', data: { from: 'wesing', to: 'cloudmusicv3' } }, stickyOpts(3000));
    expect(after.activePlayer).toBe('cloudmusicv3');
    expect(after.lyrics).toBeNull();
    expect(after.track).toBeNull();
  });
});

describe('clock extrapolation', () => {
  it('currentPosition advances by wall clock while playing, clamped within duration', () => {
    const clock = { positionSec: 10, durationSec: 200, anchoredAtMs: 1000, playing: true };
    expect(currentPosition(clock, 3000)).toBeCloseTo(12, 5); // 10 + 2s
    expect(currentPosition({ ...clock, playing: false }, 3000)).toBe(10); // frozen while paused
    expect(currentPosition({ ...clock, positionSec: 199 }, 5000)).toBe(200); // clamped to duration
  });
});
