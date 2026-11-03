'use strict';

// electron/dux/progressClock.cjs
// Some MPRIS players (KDE Connect's, for one) report Position 0 for the whole track even while
// playing. Folia's stage would then sit on the first lyric line forever. This clock trusts a
// position the player actually reports, and otherwise advances from the last known anchor.

const TRUST_THRESHOLD_MS = 300;

const createProgressClock = ({ now = Date.now } = {}) => {
    let trackId = null;
    let baseMs = 0;
    let atMs = now();
    let playing = false;
    let everTrusted = false;
    let lastReportedMs = 0;

    const currentMs = () => (playing ? baseMs + Math.max(0, now() - atMs) : baseMs);

    const reset = ({ trackId: nextTrackId = null, positionSec = 0, playing: nextPlaying = false } = {}) => {
        trackId = nextTrackId;
        const positionMs = Number.isFinite(Number(positionSec)) && Number(positionSec) > 0 ? Number(positionSec) * 1000 : 0;
        baseMs = Math.max(0, positionMs);
        atMs = now();
        playing = Boolean(nextPlaying);
        everTrusted = positionMs > TRUST_THRESHOLD_MS;
        lastReportedMs = positionMs;
    };

    const update = ({ trackId: nextTrackId = null, positionSec = 0, playing: nextPlaying = false } = {}) => {
        if (nextTrackId !== trackId) {
            reset({ trackId: nextTrackId, positionSec, playing: nextPlaying });
            return currentMs();
        }
        const reportedMs = Number.isFinite(Number(positionSec)) && Number(positionSec) > 0 ? Number(positionSec) * 1000 : 0;
        const estimatedMs = currentMs();
        // Position 0 while playing usually means the player never reports one (KDE Connect).
        // A paused 0 is a real position; a playing 0 after a trusted sample would rewind the
        // clock on every poll, so only a move to a non-zero position resyncs while playing.
        const reportedMoved = Math.abs(reportedMs - lastReportedMs) > 1;
        const usableReport = reportedMoved && (reportedMs > 0 || !nextPlaying);
        // A repeat-one that keeps the same track id rewinds Position to 0; a trusted clock has to
        // follow that instead of running past the end of the song.
        const seekedBackward = everTrusted && reportedMoved && reportedMs + 1000 < estimatedMs;
        const shouldResync = seekedBackward || (usableReport && (everTrusted
            ? Math.abs(reportedMs - estimatedMs) > TRUST_THRESHOLD_MS
            : reportedMs > 0 && Math.abs(reportedMs - baseMs) > TRUST_THRESHOLD_MS));
        if (shouldResync) {
            baseMs = reportedMs;
            atMs = now();
            everTrusted = reportedMs > TRUST_THRESHOLD_MS;
        }
        lastReportedMs = reportedMs;
        if (nextPlaying && !playing) {
            // Resuming: a real position wins, otherwise continue from where the clock was held.
            if (reportedMs > 0) {
                baseMs = reportedMs;
                atMs = now();
            }
            playing = true;
            atMs = now();
        } else if (!nextPlaying && playing) {
            baseMs = currentMs();
            atMs = now();
            playing = false;
        }
        return currentMs();
    };

    return {
        reset,
        update,
        currentMs,
    };
};

module.exports = { createProgressClock, TRUST_THRESHOLD_MS };
