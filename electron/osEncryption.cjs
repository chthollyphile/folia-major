// electron/osEncryption.cjs
//
// Whether this run can seal credentials with the OS: the check the encrypted sign-in stores of the main
// process share, so that they agree on when a stored sign-in cannot be read in this run.

/**
 * Throws unless Electron's safeStorage can encrypt in this run. On Linux, Electron may fall back to
 * `basic_text` when no secret store is available; that backend only obfuscates data, so it is refused
 * instead of persisting a credential in what is practically plaintext.
 */
function assertEncryptionAvailable(safeStorage, platform) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') {
    throw new Error('Electron safeStorage is unavailable');
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage encryption is unavailable');
  }
  const backend = platform === 'linux' && typeof safeStorage.getSelectedStorageBackend === 'function'
    ? safeStorage.getSelectedStorageBackend()
    : null;
  if (backend === 'basic_text') {
    throw new Error('Electron safeStorage selected the unencrypted basic_text backend');
  }
}

// Whether this run can seal and unseal at all (`assertEncryptionAvailable` passes).
const encryptionAvailable = (safeStorage, platform) => {
  try {
    assertEncryptionAvailable(safeStorage, platform);
    return true;
  } catch {
    return false;
  }
};

module.exports = { assertEncryptionAvailable, encryptionAvailable };
