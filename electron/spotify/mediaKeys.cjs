// electron/spotify/mediaKeys.cjs
// The system media keys while Spotify's own app sounds Folia's song. Windows hands a media key to the
// media session that played last, and the official app registers one of its own (measured:
// GlobalSystemMediaTransportControlsSessionManager.GetCurrentSession() names
// SpotifyAB.SpotifyMusic…!Spotify, status Paused, while it holds a track Folia paused there), so a key
// Folia lets go is taken by Spotify, which resumes and moves on in its own queue and never asks Folia.
// While the renderer asks for them, Folia holds the three keys itself and tells the main window which
// one was pressed, so previous, next and play/pause go through Folia's queue. Only this way of playing
// Spotify asks for them (electron/spotify/officialClient.cjs); Soloist and the app's own media session
// keep the keys as they were.

/** The Electron accelerators of the keys and the transport action each one runs. */
const SPOTIFY_MEDIA_KEYS = Object.freeze({
  MediaPreviousTrack: 'previous',
  MediaPlayPause: 'play-pause',
  MediaNextTrack: 'next',
});

/**
 * Holds and lets go of the media keys on `globalShortcut` for Spotify's own app. `set(true)` registers
 * the ones not held yet (a key another program took is tried again on the next call), `set(false)`
 * lets all go. `onKey` gets 'previous', 'play-pause' or 'next'.
 */
function createSpotifyMediaKeyTakeover({ globalShortcut, onKey, log = (...args) => console.log(...args), warn = (...args) => console.warn(...args) }) {
  const held = new Set();

  const release = () => {
    for (const accelerator of held) {
      try {
        globalShortcut.unregister(accelerator);
      } catch (error) {
        warn('[SpotifyMediaKeys] unregister failed', accelerator, error);
      }
    }
    held.clear();
  };

  return {
    set(enabled) {
      if (!enabled) {
        if (held.size > 0) log('[SpotifyMediaKeys] the media keys are given back');
        release();
        return { enabled: false, held: [] };
      }
      for (const [accelerator, action] of Object.entries(SPOTIFY_MEDIA_KEYS)) {
        if (held.has(accelerator)) continue;
        let ok = false;
        try {
          ok = globalShortcut.register(accelerator, () => onKey(action));
        } catch (error) {
          warn('[SpotifyMediaKeys] register threw', accelerator, error);
        }
        if (ok) held.add(accelerator);
        else warn('[SpotifyMediaKeys] the system refused the key', accelerator);
      }
      if (held.size > 0) log('[SpotifyMediaKeys] the media keys go through Folia\'s queue', [...held]);
      return { enabled: held.size > 0, held: [...held] };
    },
    dispose: release,
  };
}

module.exports = { SPOTIFY_MEDIA_KEYS, createSpotifyMediaKeyTakeover };
