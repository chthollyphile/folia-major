// electron/soda/session.cjs
//
// 汽水登录状态的存放处：`ly-music-source` 的 SessionBundle（cookie + LunaPC 请求头 + 设备号），
// 用 OS 的 safeStorage 加密后写进 electron-store，和波点、酷狗的做法一致。加密不可用时只在这次运行里留着。

const { readFileSync, writeFileSync, rmSync } = require('node:fs');

const SESSION_KEY = 'SODA_SESSION_V1';

function createSodaSessionStore({ store, safeStorage, filePath = '', warn = console.warn }) {
    let loaded = false;
    let current = null;
    const canEncrypt = () => Boolean(safeStorage?.isEncryptionAvailable?.())
        && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';

    return {
        get() {
            if (loaded) return current;
            loaded = true;
            // 先看独立文件，再看 electron-store：实测 store 那边写入后重启读不到。
            let sealed = '';
            if (filePath) {
                try { sealed = readFileSync(filePath, 'utf8').trim(); } catch { sealed = ''; }
            }
            if (!sealed) {
                const fromStore = store.get(SESSION_KEY);
                sealed = typeof fromStore === 'string' ? fromStore : '';
            }
            const hasSealed = sealed.length > 0;
            if (!hasSealed) {
                console.info('[SodaSession] no saved session on disk');
                return null;
            }
            if (!canEncrypt()) {
                console.info('[SodaSession] OS encryption is unavailable, cannot read the saved session');
                return null;
            }
            try {
                const value = JSON.parse(safeStorage.decryptString(Buffer.from(sealed, 'base64')));
                if (value && typeof value === 'object' && value.platforms) {
                    current = value;
                    console.info('[SodaSession] session decrypted; platforms:', Object.keys(value.platforms).join(','));
                } else {
                    console.info('[SodaSession] decrypted value has no platforms');
                }
            } catch (error) {
                console.warn('[SodaSession] Encrypted session could not be restored:', error?.message || error);
            }
            return current;
        },
        set(bundle) {
            loaded = true;
            current = bundle;
            try {
                if (!canEncrypt()) throw new Error('Encryption unavailable');
                const sealed = safeStorage.encryptString(JSON.stringify(bundle)).toString('base64');
                store.set(SESSION_KEY, sealed);
                if (filePath) writeFileSync(filePath, sealed, { mode: 0o600 });
                console.info('[SodaSession] session encrypted and saved');
            } catch (error) {
                console.warn('[SodaSession] could not save the session:', error?.message || error);
                store.delete(SESSION_KEY);
                warn('[SodaSession] Login is available for this run only; OS encryption is unavailable');
            }
        },
        clear() {
            loaded = true;
            current = null;
            try { store.delete(SESSION_KEY); } catch { /* already gone */ }
            if (filePath) { try { rmSync(filePath, { force: true }); } catch { /* already gone */ } }
        },
    };
}

module.exports = { createSodaSessionStore };
