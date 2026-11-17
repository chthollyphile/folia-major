const { encryptionAvailable } = require('../osEncryption.cjs');

// electron/huawei/session.cjs
//
// The Huawei Music session is one opaque `token` plus the account's SNS user id. It is sealed by
// Electron's OS encryption before it is stored; where the OS cannot seal it, the session lives for
// this run only instead of being written in plaintext.

const SESSION_KEY = 'HUAWEI_SESSION_V1';

// loginex uses yyyyMMddHHmmss in UTC (also observed by Solathis/HWMusic). Unknown
// formats stay unknown; OAuth's expires_in is not the music session's lifetime.
function musicSessionExpiresAt(value) {
    if (typeof value !== 'string' || !/^\d{14}$/.test(value)) return null;
    const parts = [value.slice(0, 4), value.slice(4, 6), value.slice(6, 8),
        value.slice(8, 10), value.slice(10, 12), value.slice(12, 14)].map(Number);
    const [year, month, day, hour, minute, second] = parts;
    const at = Date.UTC(year, month - 1, day, hour, minute, second);
    const date = new Date(at);
    if (year < 2000 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
        || date.getUTCDate() !== day || date.getUTCHours() !== hour
        || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) return null;
    return at;
}

function createSessionRepository({ store, safeStorage, warn = console.warn, now = Date.now }) {
    let loaded = false;
    let current = null;
    let revision = 0;
    let unread = false;
    let toldUnsealed = false;
    const canEncrypt = () => encryptionAvailable(safeStorage, process.platform);

    const read = () => {
        if (loaded) return current;
        loaded = true;
        try {
            const sealed = store.get(SESSION_KEY);
            if (typeof sealed !== 'string') return null;
            if (!canEncrypt()) {
                unread = true;
                warn('[HuaweiSession] Stored session cannot be read: OS encryption is unavailable');
                return null;
            }
            const value = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
            if (value.version === 1 && typeof value.token === 'string' && value.token
        && typeof value.userId === 'string' && value.userId) current = value;
        } catch {
            warn('[HuaweiSession] Encrypted session could not be restored');
        }
        return current;
    };

    return {
        get revision() { return revision; },
        get() {
            const value = read();
            const expiresAt = musicSessionExpiresAt(value?.expireTime);
            if (value && expiresAt !== null && now() >= expiresAt) {
                this.clear();
                return null;
            }
            return value;
        },
        // Asking whether a session exists must not read the credentials themselves.
        peek() {
            return this.get();
        },
        set(value) {
            loaded = true;
            current = {
                version: 1,
                token: String(value.token || ''),
                userId: String(value.userId || ''),
                expireTime: String(value.expireTime || ''),
                nickname: String(value.nickname || ''),
            };
            revision++;
            if (!canEncrypt()) {
                try { store.delete(SESSION_KEY); } catch { /* keep the in-memory session */ }
                if (!toldUnsealed) warn('[HuaweiSession] Login is available for this run only; OS encryption is unavailable');
                toldUnsealed = true;
                return;
            }
            try {
                store.set(SESSION_KEY, safeStorage.encryptString(JSON.stringify(current)).toString('base64'));
            } catch (error) {
                warn('[HuaweiSession] Login could not be stored', error);
            }
        },
        clear({ signOut = false } = {}) {
            const kept = !signOut && this.unreadable();
            loaded = true;
            current = null;
            revision++;
            if (kept) return;
            try { store.delete(SESSION_KEY); } catch { /* ignore */ }
            unread = false;
        },
        unreadable() {
            return !read() && unread;
        },
    };
}

module.exports = { createSessionRepository, SESSION_KEY };
