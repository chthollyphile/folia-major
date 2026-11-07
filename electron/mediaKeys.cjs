// electron/mediaKeys.cjs
// The system media keys, held by Folia so that a press stays Folia's.
// Windows hands a media key to the media session that played last, and a program that keeps its own
// session between Folia's songs takes a key Folia lets go: it resumes, and moves on in its own queue.
// Why that session outlasts the song, and how it was measured: docs/spotify-official-client.md.
// Which players ask for the keys, and why, is theirs to declare (the external playback capability in
// src/types/onlineMusic.ts, answered through omni from the renderer); this module only holds the
// three keys while the renderer says so, and reports each press as one transport action. It names no
// platform: the app's own media session (useMediaSessionBridge) keeps the keys as it always has
// wherever no player asks for them.

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
      if (held.size > 0) log('[MediaKeys] the media keys go through Folia', [...held]);
      return { enabled: held.size > 0, held: [...held] };
    },
    dispose: release,
  };
}

module.exports = { MEDIA_KEYS, createMediaKeyTakeover };
