// electron/windowPlaybackHandoff.cjs
// Holds a short-lived renderer playback handoff while the main window is rebuilt or the whole
// process is relaunched (wallpaper mode). When backed by electron-store (`storage`), the handoff
// also survives a full process restart so song + position + play state can be restored; the TTL
// semantics are identical to the in-memory variant, just checked against real wall-clock time.

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function createWindowPlaybackHandoffStore(options = {}) {
  const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(0, options.ttlMs) : 15_000;
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  // Optional electron-store-like backing (get/set/delete) so the handoff survives relaunch.
  const storage = options.storage || null;
  const storageKey = options.storageKey || 'window_playback_handoff';

  let currentHandoff = null;
  let expiresAt = 0;
  // The handoff the main window last read, which window read it, when, and until when it was good. A
  // window replaced before it could answer for itself (asked before its page listened, then it read this
  // one) passes it on (`carryForward`). Memory only: a relaunch starts with no window that read anything.
  let lastConsumed = null;

  const readPersisted = () => {
    if (!storage) {
      return;
    }
    const saved = storage.get(storageKey);
    if (!isObject(saved)) {
      currentHandoff = null;
      expiresAt = 0;
      return;
    }
    currentHandoff = isObject(saved.handoff) ? saved.handoff : null;
    expiresAt = typeof saved.expiresAt === 'number' ? saved.expiresAt : 0;
  };
  readPersisted();

  const writePersisted = () => {
    if (!storage) {
      return;
    }
    try {
      if (!currentHandoff || now() > expiresAt) {
        storage.delete(storageKey);
        return;
      }
      storage.set(storageKey, { handoff: currentHandoff, expiresAt });
    } catch (error) {
      // Persisting is best-effort: the in-memory handoff still works within this process,
      // and an expired/stale disk entry simply won't be restored.
      console.warn('[WindowPlaybackHandoff] Failed to persist handoff', error);
    }
  };

  const clear = () => {
    currentHandoff = null;
    expiresAt = 0;
    writePersisted();
  };

  const save = (handoff) => {
    if (!isObject(handoff)) {
      clear();
      return false;
    }

    currentHandoff = handoff;
    expiresAt = now() + ttlMs;
    // A newer answer supersedes whatever a window read before it.
    lastConsumed = null;
    writePersisted();
    return true;
  };

  // `consumer` is the window that reads it (any value compared by identity), for `carryForward`.
  const consume = (consumer = null) => {
    if (!currentHandoff || now() > expiresAt) {
      // A page that read nothing (a reload after a crash, a fresh start) restores nothing either.
      lastConsumed = null;
      clear();
      return null;
    }

    const handoff = currentHandoff;
    lastConsumed = consumer ? { handoff, consumer, expiresAt, consumedAt: now() } : null;
    clear();
    return handoff;
  };

  const peek = () => {
    if (!currentHandoff || now() > expiresAt) {
      clear();
      return null;
    }

    return currentHandoff;
  };

  // The window `consumer` is replaced without having answered for its playback, and read a handoff at
  // or after `readSince` (when it was asked): the request reached it before its page listened, so what
  // it read is what it is still restoring. That goes on to the next window, with a fresh lifetime.
  // Nothing when another window read it, when it was read before it was asked (the page answers for
  // itself then, and its silence means something else), when it was read longer ago than it lived,
  // or when a newer handoff waits already.
  const carryForward = (consumer, readSince = Number.POSITIVE_INFINITY) => {
    if (!consumer || !lastConsumed || lastConsumed.consumer !== consumer || lastConsumed.consumedAt < readSince || peek()) {
      return false;
    }
    const { handoff, expiresAt: goodUntil } = lastConsumed;
    lastConsumed = null;
    if (now() > goodUntil) {
      return false;
    }
    return save(handoff);
  };

  return {
    carryForward,
    clear,
    consume,
    peek,
    save,
  };
}

module.exports = {
  createWindowPlaybackHandoffStore,
};
