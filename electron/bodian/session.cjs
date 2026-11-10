const crypto = require('node:crypto');

// electron/bodian/session.cjs

const SESSION_KEY = 'BODIAN_SESSION_V2';
const DEVICE_KEY = 'BODIAN_DEVICE_ID';

// Credentials are loaded lazily, after Electron's OS encryption service becomes available.
function createSessionRepository({ store, safeStorage, warn = console.warn }) {
  let loaded = false;
  let current = null;
  let revision = 0;
  let unread = false;
  let toldUnsealed = false;
  const canEncrypt = () => safeStorage?.isEncryptionAvailable()
    && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  let deviceId = store.get(DEVICE_KEY);
  if (typeof deviceId !== 'string' || !/^[a-f0-9]{32}$/.test(deviceId)) {
    deviceId = crypto.randomBytes(16).toString('hex');
    store.set(DEVICE_KEY, deviceId);
  }
  return {
    deviceId,
    get revision() { return revision; },
    get() {
      if (loaded) return current;
      loaded = true;
      try {
        const sealed = store.get(SESSION_KEY);
        if (typeof sealed !== 'string') return null;
        // No OS encryption in this run: the session stays stored, unread, for a run that has it.
        // What does not unseal while encryption works (another OS account, a keychain that was
        // reset, damaged) is nothing stored.
        if (!canEncrypt()) {
          unread = true;
          warn('[BodianSession] Stored session cannot be read: OS encryption is unavailable');
          return null;
        }
        const value = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
        if (value.version === 2 && /^[1-9]\d{0,19}$/.test(value.uid) && value.user?.id === value.uid
          && typeof value.token === 'string' && value.token) current = value;
      } catch { warn('[BodianSession] Encrypted session could not be restored'); }
      return current;
    },
    set(value) {
      // The login this one takes the place of, read before it (see the write below).
      const replaced = canEncrypt() ? this.get() : null;
      loaded = true;
      current = { version: 2, uid: String(value.uid), token: value.token, user: value.user };
      revision++;
      // Where nothing can be sealed, the login of this run still replaces the stored one: that one
      // is deleted, so an older account cannot come back at a later start. Where the store cannot
      // be written (a file locked for a moment), what is stored stays as it was, unless it is
      // another account's: that one is deleted as well. The first is said once a run.
      if (!canEncrypt()) {
        store.delete(SESSION_KEY);
        if (!toldUnsealed) warn('[BodianSession] Login is available for this run only; OS encryption is unavailable');
        toldUnsealed = true;
        return;
      }
      try {
        store.set(SESSION_KEY, safeStorage.encryptString(JSON.stringify(current)).toString('base64'));
      } catch (error) {
        let removed = false;
        if (replaced && replaced.uid !== current.uid) {
          try {
            store.delete(SESSION_KEY);
            removed = true;
          } catch { /* as locked as the write: what is stored stays, as said below */ }
        }
        warn(`[BodianSession] Login could not be stored; ${removed ? 'the one of another account stored before was removed' : 'what is stored stays as it was'}`, error);
      }
    },
    // Removes the stored session, but not one this run could not read for want of OS encryption
    // (see `unreadable`): that one is left for a run that can. A sign-out (`signOut`) removes it
    // either way.
    clear({ signOut = false } = {}) {
      const kept = !signOut && this.unreadable();
      loaded = true;
      current = null;
      revision++;
      if (kept) return;
      store.delete(SESSION_KEY);
      unread = false;
    },
    // Whether a session is stored that this run could not read (see `get`): who is signed in is
    // then not known, which is not the same as nobody.
    unreadable() {
      return !this.get() && unread;
    },
  };
}

module.exports = { createSessionRepository, SESSION_KEY, DEVICE_KEY };
