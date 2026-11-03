const crypto = require('node:crypto');

// electron/ytm/session.cjs

// Where an earlier version kept its device sign-in: Google OAuth tokens, sealed with the OS
// keychain. Nothing is stored under this key any more, and what is found there is taken out
// (`takeDeviceSignIn`).
const SESSION_KEY = 'YTM_SESSION_V1';

const isUser = value => Boolean(value && typeof value.id === 'string' && value.id && typeof value.nickname === 'string');

// The renderer shows and stores the account id, so it only ever sees a digest of Google's own id.
const publicAccountId = gaiaId => crypto.createHash('sha256').update(`folia-ytm:${gaiaId}`).digest('hex').slice(0, 24);

// Takes the device sign-in an earlier version stored out of the store. Answers undefined where
// none is stored. Else the key is removed, and the answer holds the sign-in's `credentials`
// where they could be read: the stored value opens in this run and names a grant. One that is
// damaged, was sealed by another OS account, or is met without OS encryption has none.
function takeDeviceSignIn({ store, safeStorage }) {
  const sealed = store.get(SESSION_KEY);
  if (sealed === undefined) return undefined;
  let credentials;
  try {
    const value = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
    if (typeof value?.credentials?.refresh_token === 'string' && value.credentials.refresh_token) credentials = value.credentials;
  } catch { /* cannot be read: the key goes all the same */ }
  store.delete(SESSION_KEY);
  return { credentials };
}

module.exports = { isUser, publicAccountId, takeDeviceSignIn, SESSION_KEY };
