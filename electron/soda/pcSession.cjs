const { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
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

/** SQLite 在客户端运行时会锁库，先拷一份到临时目录再读。 */
const readCookieRows = (dbPath) => {
    const { DatabaseSync } = require('node:sqlite');
    const workspace = mkdtempSync(path.join(tmpdir(), 'folia-soda-cookies-'));
    try {
        const copy = path.join(workspace, 'Cookies');
        copyFileSync(dbPath, copy);
        for (const suffix of ['-wal', '-shm']) {
            const side = `${dbPath}${suffix}`;
            if (existsSync(side)) copyFileSync(side, `${copy}${suffix}`);
        }
        const db = new DatabaseSync(copy, { readOnly: true });
        try {
            return db.prepare('SELECT host_key, name, value, encrypted_value FROM cookies').all();
        } finally {
            db.close();
        }
    } finally {
        rmSync(workspace, { recursive: true, force: true });
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
    throw new Error(`没有找到汽水客户端的登录态（${errors.join('; ') || '客户端数据目录不存在'}）`);
}

module.exports = { readPcSession, SESSION_NAMES, decryptCookieValue, domainOfInterest };
