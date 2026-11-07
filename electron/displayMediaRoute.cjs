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

module.exports = {
  DISPLAY_MEDIA_ROUTE_DENY,
  DISPLAY_MEDIA_ROUTE_VIDEO_EXPORT,
  DISPLAY_MEDIA_ROUTE_SPECTRUM,
  decideDisplayMediaRoute,
};
