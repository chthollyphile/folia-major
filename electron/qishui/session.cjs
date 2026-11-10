const { createQishuiDeviceId, isQishuiDeviceId, isAccountId } = require('qishui-music-api');

// Stores only accounts explicitly authorized in Folia; never imports another application's files.
// Account IDs are opaque strings; unlike track IDs they are not necessarily decimal numbers.
const SESSION_KEY = 'QISHUI_SESSION_V1';
const DEVICE_KEY = 'QISHUI_DEVICE_ID';
function createSessionRepository({ store, safeStorage, warn = console.warn }) {
    let loaded = false;
    let current = null;
    let revision = 0;
    let deviceId = store.get(DEVICE_KEY);
    if (!isQishuiDeviceId(deviceId)) {
        deviceId = createQishuiDeviceId();
        store.set(DEVICE_KEY, deviceId);
    }
    const canEncrypt = () => safeStorage?.isEncryptionAvailable() && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    return {
        deviceId,
        get revision() { return revision; },
        get() {
            if (!loaded) {
                loaded = true;
                try {
                    const sealed = store.get(SESSION_KEY);
                    if (typeof sealed === 'string' && canEncrypt()) {
                        const value = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
                        if (value.version === 1 && isAccountId(value.userId) && value.ticket && value.guardKey
                            && value.guardCert && value.guardTsSign && value.accessCode && Number.isFinite(value.expiresAt)) current = value;
                    }
                } catch (error) {
                    // JSON.parse quotes the text it could not read, and that text is the decrypted account:
                    // only its kind is logged. Other errors (the store, safeStorage) carry no account text.
                    if (error instanceof SyntaxError) warn('[Qishui] Account could not be restored: the saved account is not readable');
                    else warn('[Qishui] Account could not be restored', error);
                }
            }
            return current;
        },
        set(value) {
            loaded = true;
            current = { ...value, version: 1 };
            revision++;
            try {
                if (!canEncrypt()) throw new Error('OS credential encryption is unavailable');
                store.set(SESSION_KEY, safeStorage.encryptString(JSON.stringify(current)).toString('base64'));
            } catch {
                store.delete(SESSION_KEY);
                warn('[Qishui] Account kept in memory for this run; OS encryption is unavailable');
            }
        },
        clear() { loaded = true; current = null; revision++; store.delete(SESSION_KEY); },
    };
}
module.exports = { createSessionRepository, SESSION_KEY, DEVICE_KEY, isAccountId };
