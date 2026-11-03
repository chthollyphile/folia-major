// electron/qq/qqAuthSessionRepository.cjs
//
// Persists the QQ API's server-side credential state in Electron's main process. The renderer keeps
// only the opaque `qqmusic_session` token; musickey, refresh keys and device context are encrypted
// before electron-store writes them to disk and are never sent over IPC.

const { assertEncryptionAvailable, encryptionAvailable } = require('../osEncryption.cjs');

const SESSION_KEY = 'QQ_API_AUTH_SESSION_V1';
const ENVELOPE_VERSION = 1;

// The package (sessionState.js) prunes a session at restore once its `expiresAt`, the musickey's own expiry (about
// 3 days after sign-in), has passed, and refreshes a credential only inside resolve(), in the last 6 hours before
// that expiry. A user who keeps Folia closed through those hours would come back signed out without the refresh key
// ever being tried. So a session that can still be refreshed comes back with one more hour, the hour the package
// itself gives a credential that is already expired (credentialExpiry.js authSessionExpiryAt): the first request of
// that hour, normally the login check at start, runs the refresh. If QQ refuses it, the old key is refused as well
// and the login ends as it would have. The proper place is the package: keep such a session past its expiry and try
// the refresh once before pruning it. Whether QQ takes a refresh key after the musickey expired is not measured.
const EXPIRED_REFRESH_GRACE_MS = 60 * 60 * 1000;
// The hour is not written to disk, so every start gives it anew. A session that expired longer ago than this is no
// longer brought back and the package prunes it: without the bound, a session nobody resolves any more (an earlier
// sign-in whose token the page no longer keeps) would never be refreshed nor pruned while Folia is never open for an
// hour, and its credential would stay on disk for good. 30 days is the longest the package renews a sign-in for at
// all (the serverless backend, counted from the first sign-in); how long QQ takes a refresh key is not measured.
const EXPIRED_REFRESH_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const isPositiveNumber = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

// The package's shouldRefreshStoredCredential: only a credential that says when it expires and carries a
// refresh_key is refreshed, so only such a session is worth keeping.
const canRefresh = (credential) => Boolean(credential) &&
  typeof credential.refresh_key === 'string' &&
  credential.refresh_key.length > 0 &&
  isPositiveNumber(credential.musickeyCreateTime) &&
  isPositiveNumber(credential.keyExpiresIn);

function keepRefreshableSessions(sessions, now, logger) {
  const current = now();
  let kept = 0;
  const result = sessions.map((session) => {
    if (!session || typeof session.expiresAt !== 'number' || session.expiresAt > current
      || current - session.expiresAt > EXPIRED_REFRESH_WINDOW_MS || !canRefresh(session.credential)) {
      return session;
    }
    kept += 1;
    return { ...session, expiresAt: current + EXPIRED_REFRESH_GRACE_MS };
  });
  if (kept > 0) logger.info('[QQ API] expired sessions kept for one refresh attempt', { count: kept });
  return result;
}

function readStoredSessions(store, safeStorage, platform) {
  const encoded = store.get(SESSION_KEY);
  if (encoded === undefined || encoded === null) {
    return [];
  }
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new Error('Stored QQ auth session payload is invalid');
  }

  assertEncryptionAvailable(safeStorage, platform);
  const plaintext = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  const envelope = JSON.parse(plaintext);
  if (
    !envelope ||
    typeof envelope !== 'object' ||
    envelope.version !== ENVELOPE_VERSION ||
    !Array.isArray(envelope.sessions)
  ) {
    throw new Error('Stored QQ auth session envelope is invalid');
  }
  return envelope.sessions;
}

function createQqAuthSessionRepository({ store, safeStorage, platform = process.platform, now = Date.now, logger = console }) {
  if (!store || typeof store.get !== 'function' || typeof store.set !== 'function') {
    throw new TypeError('A compatible electron-store instance is required');
  }

  // Whether what is on disk could not be read at load() for want of OS encryption in this run (encryption
  // unavailable, basic_text), and is still there. The package then serves no session at all for this run
  // (sessionState.js restore), so "the backend does not know this token" no longer means "signed out"; qqBackend
  // reports it to the renderer, asked anew each time. A save of this run replaces or removes what is on disk (see
  // `save`), and from then on nothing unread is left: every session the backend was asked about since is one it issued
  // itself. What does not open while encryption works (a decrypt failure, damaged JSON, an envelope of another
  // version) is nothing stored, as it always was.
  let loadFailed = false;
  const removeStored = () => {
    if (typeof store.delete === 'function') {
      store.delete(SESSION_KEY);
    } else {
      store.set(SESSION_KEY, undefined);
    }
    loadFailed = false;
  };

  return {
    kind: 'electron-safe-storage',
    load() {
      try {
        const sessions = readStoredSessions(store, safeStorage, platform);
        loadFailed = false;
        return keepRefreshableSessions(sessions, now, logger);
      } catch (error) {
        loadFailed = !encryptionAvailable(safeStorage, platform);
        throw error;
      }
    },
    loadFailed: () => loadFailed,
    save(sessions) {
      if (!Array.isArray(sessions)) {
        throw new TypeError('QQ auth sessions must be an array');
      }
      if (sessions.length === 0) {
        // Logout and TTL cleanup must still be able to remove stale ciphertext even when the OS
        // keychain becomes temporarily unavailable after the record was originally created.
        removeStored();
        return;
      }

      // Nothing can be sealed in this run: the sessions of this run live in the package's memory only, and they
      // replace what is stored, as on the other platforms. The sign-in of an earlier run is deleted, so it cannot
      // come back at a later start, and a token the page keeps from this run is never taken for that one. The
      // throw below is what the package logs (qq-auth.auth-session.save-failed).
      if (!encryptionAvailable(safeStorage, platform)) removeStored();
      assertEncryptionAvailable(safeStorage, platform);
      const plaintext = JSON.stringify({ version: ENVELOPE_VERSION, sessions });
      const encrypted = safeStorage.encryptString(plaintext);
      store.set(SESSION_KEY, encrypted.toString('base64'));
    },
  };
}

module.exports = {
  SESSION_KEY,
  createQqAuthSessionRepository,
};
