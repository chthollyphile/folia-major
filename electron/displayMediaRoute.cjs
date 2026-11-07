'use strict';

// electron/displayMediaRoute.cjs
// One session has a single display-media request handler, and two features ask it for a source: the
// video export records the main window, and the external playback route analyses the machine's own
// sound so the visualizer can follow a song another program is playing. This decides which of them a
// request belongs to, from the request's own flags and the state the two features armed.

/** No source: the request is refused. */
const DISPLAY_MEDIA_ROUTE_DENY = 'deny';
/** The main window's own tab, for the video export's recording. */
const DISPLAY_MEDIA_ROUTE_VIDEO_EXPORT = 'video-export';
/** The machine's own sound (Windows loopback), for the external route's spectrum. */
const DISPLAY_MEDIA_ROUTE_SPECTRUM = 'spectrum';

/**
 * Which source a display-media request may see.
 *
 * Trust comes first: only the main window may ever be granted one. The spectrum is granted only while
 * the renderer has armed it, only to a request that asked for audio, only off Windows (the only
 * platform whose loopback Streams supports), and never while an export holds the handler - the export
 * and the spectrum would then both be recognised as the same request, and the recorder must not be
 * handed a stream of the system's sound.
 */
function decideDisplayMediaRoute({ trusted, videoExportActive, spectrumCaptureArmed, audioRequested, platform }) {
  if (!trusted) return DISPLAY_MEDIA_ROUTE_DENY;
  if (spectrumCaptureArmed && audioRequested && !videoExportActive && platform === 'win32') {
    return DISPLAY_MEDIA_ROUTE_SPECTRUM;
  }
  if (videoExportActive) return DISPLAY_MEDIA_ROUTE_VIDEO_EXPORT;
  return DISPLAY_MEDIA_ROUTE_DENY;
}

/** An arm buys one display-media call; one that is never spent lapses after this long. */
const SPECTRUM_ARM_TTL_MS = 10_000;

/**
 * The renderer's arm for the machine's own sound. One arm buys exactly one call: the handler spends
 * it when answering, and it lapses by itself when that call never comes. Everything that ends or
 * replaces the page (a crash, a reload, a navigation) disarms it, so a renderer cannot leave the
 * handler answering the machine's sound to some later request of its own.
 */
function createSpectrumArm({
  ttlMs = SPECTRUM_ARM_TTL_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onLapse = null,
} = {}) {
  let expiry = null;

  const clearExpiry = () => {
    if (expiry === null) return;
    clearTimer(expiry);
    expiry = null;
  };

  const arm = () => {
    clearExpiry();
    expiry = setTimer(() => {
      expiry = null;
      if (onLapse) onLapse();
    }, ttlMs);
  };

  /** Clears the arm without spending it. Answers whether one was held. */
  const disarm = () => {
    if (expiry === null) return false;
    clearExpiry();
    return true;
  };

  /** Spends the arm on the one call it bought. Answers whether that call was expected. */
  const spend = () => disarm();

  const isArmed = () => expiry !== null;

  return { arm, disarm, spend, isArmed };
}

module.exports = {
  DISPLAY_MEDIA_ROUTE_DENY,
  DISPLAY_MEDIA_ROUTE_VIDEO_EXPORT,
  DISPLAY_MEDIA_ROUTE_SPECTRUM,
  SPECTRUM_ARM_TTL_MS,
  decideDisplayMediaRoute,
  createSpectrumArm,
};