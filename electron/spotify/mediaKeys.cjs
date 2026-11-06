// electron/spotify/mediaKeys.cjs
// The system media keys while a player outside Folia sounds the song (Spotify's own app). Windows hands
// a media key to the media session that played last, and that is the app's, which then moves on in its
// own queue. While the renderer asks for it, Folia holds the three keys itself and tells the main window
// which one was pressed, so previous, next and play/pause go through Folia's queue.

/** The Electron accelerators of the keys and the transport action each one runs. */
const MEDIA_KEYS = Object.freeze({
  MediaPreviousTrack: 'previous',
  MediaPlayPause: 'play-pause',
  MediaNextTrack: 'next',
});

/**
 * Holds and lets go of the media keys on `globalShortcut`. `set(true)` registers the ones not held
 * yet (a key another program took is tried again on the next call), `set(false)` lets all go.
 * `onKey` gets 'previous', 'play-pause' or 'next'.
 */
function createMediaKeyTakeover({ globalShortcut, onKey, log = (...args) => console.log(...args), warn = (...args) => console.warn(...args) }) {
  const held = new Set();

  const release = () => {
    for (const accelerator of held) {
      try {
        globalShortcut.unregister(accelerator);
      } catch (error) {
        warn('[MediaKeys] unregister failed', accelerator, error);
      }
    }
    held.clear();
  };

  return {
    set(enabled) {
      if (!enabled) {
        if (held.size > 0) log('[MediaKeys] the media keys are given back');
        release();
        return { enabled: false, held: [] };
      }
      for (const [accelerator, action] of Object.entries(MEDIA_KEYS)) {
        if (held.has(accelerator)) continue;
        let ok = false;
        try {
          ok = globalShortcut.register(accelerator, () => onKey(action));
        } catch (error) {
          warn('[MediaKeys] register threw', accelerator, error);
        }
        if (ok) held.add(accelerator);
        else warn('[MediaKeys] the system refused the key', accelerator);
      }
      if (held.size > 0) log('[MediaKeys] the media keys go through Folia\'s queue', [...held]);
      return { enabled: held.size > 0, held: [...held] };
    },
    dispose: release,
  };
}

module.exports = { MEDIA_KEYS, createMediaKeyTakeover };
