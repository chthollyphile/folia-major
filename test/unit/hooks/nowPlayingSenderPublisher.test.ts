import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// test/unit/hooks/nowPlayingSenderPublisher.test.ts
// The outbound mirror has to describe what is audible. During an automix blend the raw store already
// names the arriving track while the outgoing deck is still sounding, so reading the raw fields
// broadcasts the new cover/length first and corrects them a beat later — which an external overlay
// sees as a flicker — and reports `isPaused: true` over a track that is playing.

describe('now playing sender publisher', () => {
  const hookPath = path.resolve(__dirname, '../../../src/hooks/useNowPlayingSenderPublisher.ts');
  const source = fs.readFileSync(hookPath, 'utf8');

  it('reads the display layer instead of the raw store fields', () => {
    expect(source).not.toContain('state.cachedCoverUrl');
    expect(source).not.toContain('state.duration');
    expect(source).not.toMatch(/state\.currentSong\b/);
    expect(source).not.toMatch(/state\.lyrics\b/);

    expect(source).toContain('selectDisplayCoverUrl');
    expect(source).toContain('selectDisplayDuration');
    expect(source).toContain('selectDisplaySong');
    expect(source).toContain('selectDisplayLyrics');
  });

  it('derives the pause flag from selectDisplayPlayerState', () => {
    expect(source).not.toMatch(/getState\(\)\.playerState/);
    expect(source).toContain('selectDisplayPlayerState(usePlaybackStore.getState())');
  });

  // `player.volumePercent` / `player.repeatType` are documented fields, and both live in the
  // renderer; pinning them to constants made every /api/query read wrong for those clients.
  it('sends the renderer volume and loop mode with each playback report', () => {
    expect(source).toContain('volumePercent:');
    expect(source).toContain('repeatType:');
  });

  // The user-facing heartbeat interval: a fixed 500ms timer ignored the setting entirely, and a
  // plain setInterval would stack timers of two periods while the slider moves.
  it('schedules the heartbeat from the configured interval instead of a constant', () => {
    expect(source).toContain('status.progressIntervalSec');
    expect(source).toContain('window.setTimeout');
    expect(source).not.toMatch(/SENDER_PLAYBACK_INTERVAL_MS/);
    // `0` is the documented "no timer" position, so the effect must return before scheduling.
    expect(source).toContain('if (progressIntervalSec <= 0)');
  });

  // With the timer off, playback events are the only anchors left, so each of them has to publish
  // on its own rather than waiting for a tick that never comes.
  it('publishes immediately on pause/resume, track change and seek', () => {
    expect(source).toContain('playerStateForSender');
    expect(source).toMatch(/playerStateForSender\]/);
    expect(source).toContain('SENDER_PLAYBACK_JUMP_THRESHOLD_SEC');
    expect(source).toContain('currentTime.on');
    // Track change anchors the new clock at zero rather than on the next heartbeat.
    const trackPublishIndex = source.indexOf('publishNowPlayingSenderTrack(built.snapshot)');
    const anchorIndex = source.indexOf('publishPlaybackRef.current(false)');
    expect(trackPublishIndex).toBeGreaterThan(-1);
    expect(anchorIndex).toBeGreaterThan(trackPublishIndex);
  });

  // A paused seek still moves the position a client draws, so the jump check cannot be gated on
  // "playing" the way it used to be.
  it('does not gate the seek publish on the playing state', () => {
    expect(source).not.toMatch(/PlayerState\.PLAYING\) \{\s*return;/);
    expect(source).toContain('isSenderPublishingRef.current');
  });

  // The main process throws its Track/Lyric dedupe caches away on every stop(), and the renderer
  // keeps its own dedupe refs across the round trip. Without invalidating them on the session
  // change, re-enabling the sender (or coming back from Stage) skipped the first publication as
  // "already sent" and left clients on a blank track until the song happened to change.
  it('invalidates the dedupe caches whenever the publishing session changes', () => {
    expect(source).toContain('publishSession');
    expect(source).toMatch(/lastTrackKeyRef\.current = null/);
    expect(source).toMatch(/lastLyricKeyRef\.current = null/);
    // The reset has to be declared before the track/lyric effects, since effects run in order.
    const resetIndex = source.indexOf('lastTrackKeyRef.current = null');
    expect(resetIndex).toBeGreaterThan(-1);
    expect(resetIndex).toBeLessThan(source.indexOf('const built = buildNowPlayingSenderTrack'));
  });
});
