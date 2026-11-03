const crypto = require('node:crypto');

// electron/spotify/session.cjs
// The signed-in Spotify account as it is kept between runs: its tokens, and what the app shows of it.

const SESSION_KEY = 'SPOTIFY_SESSION_V1';

const isCredentials = value => Boolean(value && typeof value.access_token === 'string' && value.access_token
  && typeof value.refresh_token === 'string' && value.refresh_token && Number.isFinite(value.expires_at));
const isUser = value => Boolean(value && typeof value.id === 'string' && value.id && typeof value.nickname === 'string');

// The renderer shows and stores the account id, so it only ever sees a digest of Spotify's own name for the account.
const publicAccountId = username => crypto.createHash('sha256').update(`folia-spotify:${username}`).digest('hex').slice(0, 24);

// Spotify credentials stay in the main process, encrypted with the OS keychain when it is available.
function createSpotifySessionRepository({ store, safeStorage, log = (...args) => console.log(...args), warn = (...args) => console.warn(...args) }) {
  let loaded = false;
  let current = null;
  // A sign-in is stored that this run could not read for want of OS encryption (see `get`).
  let unread = false;
  const canEncrypt = () => safeStorage?.isEncryptionAvailable()
    && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
  // Where nothing can be sealed, the sign-in of this run still replaces the stored one: that one
  // is deleted, so an older account cannot come back at a later start. Where the store cannot be
  // written (a file locked for a moment), what is stored stays as it was, unless it is another
  // account's: `replaced` is the sign-in a new one takes the place of (`set`), and where its account
  // is not the new one's, it is deleted as well. The first is said once a run.
  let toldUnsealed = false;
  const persist = (replaced = null) => {
    if (!canEncrypt()) {
      store.delete(SESSION_KEY);
      if (!toldUnsealed) warn('[Spotify] Sign-in is kept for this run only: OS encryption is unavailable');
      toldUnsealed = true;
      return;
    }
    try {
      store.set(SESSION_KEY, safeStorage.encryptString(JSON.stringify(current)).toString('base64'));
    } catch (error) {
      let removed = false;
      if (replaced && replaced.user.id !== current.user.id) {
        try {
          store.delete(SESSION_KEY);
          removed = true;
        } catch { /* as locked as the write: what is stored stays, as said below */ }
      }
      warn(`[Spotify] Sign-in could not be stored; ${removed ? 'the one of another account stored before was removed' : 'what is stored stays as it was'}`, error);
    }
  };
  return {
    get() {
      if (loaded) return current;
      loaded = true;
      try {
        const sealed = store.get(SESSION_KEY);
        if (typeof sealed !== 'string') {
          log('[Spotify] No stored sign-in');
          return null;
        }
        // Only a run without OS encryption leaves it unread, for a run that has it. What does not
        // unseal while encryption works (sealed by another OS account, a keychain that was reset,
        // damaged) is nothing stored.
        if (!canEncrypt()) {
          unread = true;
          warn('[Spotify] Stored sign-in cannot be read: OS encryption is unavailable');
          return null;
        }
        const value = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
        if (value.version === 1 && isCredentials(value.credentials) && isUser(value.user)) current = value;
      } catch { /* damaged, or sealed by another OS account: reported below */ }
      if (current) log('[Spotify] Stored sign-in restored');
      else warn('[Spotify] Stored sign-in could not be restored');
      return current;
    },
    set({ credentials, user }) {
      if (!isCredentials(credentials) || !isUser(user)) throw new Error('Invalid Spotify session');
      const replaced = canEncrypt() ? this.get() : null;
      loaded = true;
      current = { version: 1, credentials: { ...credentials }, user: { ...user } };
      persist(replaced);
    },
    // A renewed access token, or the account read again, replaces what is stored; without a
    // session there is nothing to replace.
    update({ credentials, user }) {
      if (!this.get() || (credentials && !isCredentials(credentials)) || (user && !isUser(user))) return;
      current = { ...current, ...(credentials ? { credentials: { ...credentials } } : {}), ...(user ? { user: { ...user } } : {}) };
      persist();
    },
    // Whether a sign-in is stored that this run could not read (see `get`): who is signed in is
    // then not known, which is not the same as nobody.
    unreadable() {
      return !this.get() && unread;
    },
    clear() {
      loaded = true;
      current = null;
      unread = false;
      store.delete(SESSION_KEY);
    },
  };
}

module.exports = { createSpotifySessionRepository, publicAccountId, SESSION_KEY };
