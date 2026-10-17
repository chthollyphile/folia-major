const { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, writeSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createDecipheriv } = require('node:crypto');
const { tmpdir } = require('node:os');
const path = require('node:path');

// electron/soda/pcSession.cjs
//
// 从汽水音乐 PC 客户端（SodaMusic，Electron）里读出已登录的会话。
//
// 平台会拒绝第三方客户端的扫码登录（passport 回 1049「非官方渠道」），所以登录态只能拿官方客户端
// 自己那份：Chromium 把 cookie 存在 `%APPDATA%\SodaMusic\Network\Cookies`（SQLite），加密值是
// v10 = AES-256-GCM，主密钥在 `Local State` 的 os_crypt.encrypted_key 里、由 Windows DPAPI 保护。
//
// 解密主密钥这一步交给 PowerShell（System.Security.Cryptography.ProtectedData），密钥用 stdin 传，
// 不出现在命令行里。读 SQLite 用 Node 24 自带的 node:sqlite，不引第三方包。

const USER_DATA_CANDIDATES = [
    () => path.join(process.env.APPDATA || '', 'SodaMusic'),
    () => path.join(process.env.APPDATA || '', 'luna_pc'),
    () => path.join(process.env.LOCALAPPDATA || '', 'SodaMusic'),
];

const COOKIE_DB = path.join('Network', 'Cookies');
const LOCAL_STATE = 'Local State';
const SESSION_NAMES = ['sessionid', 'sessionid_ss', 'sid_tt', 'sid_guard', 'uid_tt', 'uid_tt_ss'];

/** Windows DPAPI：把 Local State 里那段 encrypted_key 解成 AES 密钥。 */
const dpapiUnprotect = (sealed) => {
    const script = [
        'Add-Type -AssemblyName System.Security',
        '$b = [Convert]::FromBase64String([Console]::In.ReadToEnd())',
        '$d = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, \'CurrentUser\')',
        '[Convert]::ToBase64String($d)',
    ].join('; ');
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        input: sealed.toString('base64'),
        timeout: 15000,
        windowsHide: true,
    });
    return Buffer.from(String(out).trim(), 'base64');
};

const aesKeyFromLocalState = (userDataDir) => {
    const statePath = path.join(userDataDir, LOCAL_STATE);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const encoded = state?.os_crypt?.encrypted_key;
    if (typeof encoded !== 'string' || !encoded) throw new Error('Local State has no os_crypt.encrypted_key');
    const raw = Buffer.from(encoded, 'base64');
    // 前 5 个字节是 "DPAPI" 标记。
    if (raw.slice(0, 5).toString() !== 'DPAPI') throw new Error('encrypted_key is not DPAPI-sealed');
    return dpapiUnprotect(raw.slice(5));
};

/** Chromium 的 v10/v11 加密 cookie：3 字节前缀 + 12 字节 nonce + 密文 + 16 字节 tag。 */
const decryptCookieValue = (encrypted, key) => {
    const buffer = Buffer.from(encrypted);
    if (buffer.length < 3 + 12 + 16) return '';
    const prefix = buffer.slice(0, 3).toString();
    if (prefix !== 'v10' && prefix !== 'v11') return '';
    const nonce = buffer.slice(3, 15);
    const tag = buffer.slice(buffer.length - 16);
    const payload = buffer.slice(15, buffer.length - 16);
    try {
        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(payload), decipher.final()]).toString('utf8');
    } catch {
        return '';
    }
};

const COOKIE_SQL = 'SELECT host_key, name, value, encrypted_value FROM cookies';

const queryCookies = (DatabaseSync, file) => {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
        return db.prepare(COOKIE_SQL).all();
    } finally {
        db.close();
    }
};

/**
 * 按字节复制。客户端的库被占用时 CopyFileEx 会 EBUSY，但普通读句柄通常还允许读
 * （SQLite 在 Windows 上是用 FILE_SHARE_READ|WRITE 打开的）。
 */
const copyBytes = (from, to) => {
    const source = openSync(from, 'r');
    try {
        const target = openSync(to, 'w');
        try {
            const buffer = Buffer.allocUnsafe(1 << 16);
            let read;
            while ((read = readSync(source, buffer, 0, buffer.length, null)) > 0) {
                writeSync(target, buffer, 0, read);
            }
        } finally {
            closeSync(target);
        }
    } finally {
        closeSync(source);
    }
};

/**
 * 读 cookie 库。客户端开着时库是锁的：
 *   1. 先直接只读打开（SQLite 自己处理并发，最省事）；
 *   2. 不行就按字节拷一份到临时目录再打开（copyFileSync 会 EBUSY，这里绕开它）。
 */
const readCookieRows = (dbPath) => {
    const { DatabaseSync } = require('node:sqlite');
    try {
        return queryCookies(DatabaseSync, dbPath);
    } catch (directError) {
        const workspace = mkdtempSync(path.join(tmpdir(), 'folia-soda-cookies-'));
        try {
            const copy = path.join(workspace, 'Cookies');
            copyBytes(dbPath, copy);
            for (const suffix of ['-wal', '-shm']) {
                const side = `${dbPath}${suffix}`;
                if (!existsSync(side)) continue;
                try { copyBytes(side, `${copy}${suffix}`); } catch { /* 拷不到就只读主库 */ }
            }
            return queryCookies(DatabaseSync, copy);
        } catch {
            throw new Error(String(directError?.message || 'cookie db is locked'));
        } finally {
            rmSync(workspace, { recursive: true, force: true });
        }
    }
};

const domainOfInterest = (host) => /(^|\.)(qishui\.com|douyin\.com)$/i.test(String(host || '').replace(/^\./, ''));

const dirsToInspect = () => {
    const seen = new Set();
    const out = [];
    for (const make of USER_DATA_CANDIDATES) {
        const dir = make();
        if (!dir || seen.has(dir) || !existsSync(dir)) continue;
        seen.add(dir);
        out.push(dir);
    }
    return out;
};

/**
 * 读出官方客户端里的汽水会话。
 * 返回 { cookie, names, domains, userDataDir }；找不到登录态时抛错，错误信息不带任何 cookie 值。
 */
function readPcSession() {
    const errors = [];
    for (const userDataDir of dirsToInspect()) {
        const dbPath = path.join(userDataDir, COOKIE_DB);
        if (!existsSync(dbPath)) { errors.push(`${userDataDir}: no cookie db`); continue; }
        let key;
        try {
            key = aesKeyFromLocalState(userDataDir);
        } catch (error) {
            errors.push(`${userDataDir}: ${error?.message || 'key failed'}`);
            continue;
        }
        let rows;
        try {
            rows = readCookieRows(dbPath);
        } catch (error) {
            errors.push(`${userDataDir}: ${error?.message || 'db failed'}`);
            continue;
        }
        const picked = [];
        for (const row of rows) {
            if (!domainOfInterest(row.host_key)) continue;
            const name = String(row.name || '');
            if (!name) continue;
            const plain = typeof row.value === 'string' ? row.value : '';
            const value = plain || decryptCookieValue(row.encrypted_value, key);
            if (!value) continue;
            picked.push({ name, value, host: String(row.host_key || '') });
        }
        if (!picked.some((item) => SESSION_NAMES.includes(item.name))) {
            // 区分「没有登录」和「cookie 用了我们解不开的加密」：v20 是 Chromium 的应用绑定加密。
            const prefixes = new Map();
            for (const row of rows) {
                if (!domainOfInterest(row.host_key)) continue;
                const raw = row.encrypted_value ? Buffer.from(row.encrypted_value).slice(0, 3).toString() : 'plain';
                prefixes.set(raw, (prefixes.get(raw) || 0) + 1);
            }
            const shape = Array.from(prefixes, ([kind, count]) => `${kind}×${count}`).join(' ');
            errors.push(`${userDataDir}: ${picked.length} readable cookies, no login cookie (${shape || 'no cookies'})`);
            continue;
        }
        // 同名的 cookie 按域名长度排序，具体域名优先于 .qishui.com 这种父域。
        picked.sort((a, b) => b.host.length - a.host.length);
        const byName = new Map();
        for (const item of picked) if (!byName.has(item.name)) byName.set(item.name, item.value);
        return {
            cookie: Array.from(byName, ([name, value]) => `${name}=${value}`).join('; '),
            names: Array.from(byName.keys()),
            domains: Array.from(new Set(picked.map((item) => item.host))),
            userDataDir,
        };
    }
    throw new Error(`没有找到汽水客户端的登录态（${errors.join('; ') || '客户端数据目录不存在'}）。汽水音乐正在运行时它的 cookie 库可能被锁，退出客户端后切一下音源会重试。`);
}

const DEVICE_KEYS = ['device_id', 'deviceId', 'deviceID', 'deviceid'];

/**
 * 客户端请求里的 device_id：VIP 签名必须和请求参数里的那个一致（bdms 绑设备）。
 * 先看 cookie（有些桶会把 did 放进 cookie），再扫数据目录下的小 JSON。
 */
let cachedDeviceId = null;
function findPcDeviceId() {
    if (cachedDeviceId !== null) return cachedDeviceId;
    for (const userDataDir of dirsToInspect()) {
        try {
            const entries = [];
            const walk = (dir, depth) => {
                if (depth > 3) return;
                for (const entry of require('node:fs').readdirSync(dir, { withFileTypes: true })) {
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) { walk(full, depth + 1); continue; }
                    if (!/\.(json|txt|conf|cfg|ini)$/i.test(entry.name)) continue;
                    try { if (require('node:fs').statSync(full).size < 512 * 1024) entries.push(full); } catch { /* skip */ }
                }
            };
            walk(userDataDir, 0);
            for (const file of entries) {
                let text = '';
                try { text = readFileSync(file, 'utf8'); } catch { continue; }
                if (!/device/i.test(text)) continue;
                let json = null;
                try { json = JSON.parse(text); } catch { continue; }
                const stack = [json];
                while (stack.length) {
                    const node = stack.pop();
                    if (!node || typeof node !== 'object') continue;
                    for (const [key, value] of Object.entries(node)) {
                        if (DEVICE_KEYS.includes(key.toLowerCase()) && typeof value === 'string' && /^\d{8,24}$/.test(value)) {
                            cachedDeviceId = value;
                            return cachedDeviceId;
                        }
                        if (value && typeof value === 'object') stack.push(value);
                    }
                }
            }
        } catch { /* 目录读不了就跳过 */ }
    }
    cachedDeviceId = '';
    return cachedDeviceId;
}

module.exports = { readPcSession, findPcDeviceId, SESSION_NAMES, decryptCookieValue, domainOfInterest };
