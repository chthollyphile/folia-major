// electron/debug/redactCredentials.cjs
// 写进运行日志和日志面板之前，把登录凭据的值换成 <redacted>。别的照记（IP、错误原文、请求路径都要留着查问题），
// 只动值本身：哪个参数、哪个 Cookie 名在场仍看得出来。
//
// 凭据进日志的路子：有的平台接口把整串 Cookie 放在请求地址的 `cookie=` 里，本地后端（"Request Success: [eapi]
// /song/url?…&cookie=…"）和出错日志会把整个地址连同解码后的 Cookie 写出来；也有把 Cookie 头或带 cookie 字段的对象整个打出来的。

const REDACTED = '<redacted>';

const fs = require('fs');
const path = require('path');

/**
 * 登录态的 Cookie 名：各平台在自己的目录里放一个 credentialCookies.cjs（导出名字数组），这里逐个目录找来合起来，
 * 不在这里写平台。读不到的目录跳过：少认几个名字时地址里的 cookie= 和 Cookie 头照样会被换掉。
 */
const loadCredentialCookieNames = (root = path.join(__dirname, '..')) => {
    let folders = [];
    try {
        folders = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch {
        return [];
    }
    return folders.flatMap((folder) => {
        const file = path.join(root, folder, 'credentialCookies.cjs');
        if (!fs.existsSync(file)) return [];
        try {
            const names = require(file);
            return Array.isArray(names) ? names.filter(name => typeof name === 'string' && /^\w+$/.test(name)) : [];
        } catch {
            return [];
        }
    });
};

const CREDENTIAL_COOKIE_NAMES = loadCredentialCookieNames();

const RULES = [
    // 地址里的 ?cookie= / &cookie=：到下一个 & 或行尾。解码过的值里有空格和分号（"MUSIC_U=…; os=pc"），不能停在空白上。
    [/([?&]cookie=)[^&\r\n]*/gi, `$1${REDACTED}`],
    // JSON 或打出来的对象里的 cookie 字段："cookie":"…"、cookie: '…'。hasLoginCookie 之类的名字不算。
    [/((?:^|[^\w])["']?(?:set-)?cookie["']?\s*:\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/gim, `$1"${REDACTED}"`],
    // 没加引号的 Cookie / Set-Cookie 头：到行尾。加了引号的是上一条的字段，已经换过了。
    [/(^|[\s{,;])((?:set-)?cookie:(?!\s*["'])\s*)[^\r\n]*/gim, `$1$2${REDACTED}`],
    // 散落在别处的登录 Cookie：名字=值。一个名字都没找到时没有这一条（空的 (?:) 会配上每一个 =）。
    ...(CREDENTIAL_COOKIE_NAMES.length > 0
        ? [[new RegExp(`(\\b(?:${CREDENTIAL_COOKIE_NAMES.join('|')})=)[^;&\\s"',]+`, 'g'), `$1${REDACTED}`]]
        : []),
];

/** 一行日志去掉凭据的值；不是字符串原样返回。 */
const redactCredentials = (text) => {
    if (typeof text !== 'string' || !text) return text;
    let result = text;
    for (const [pattern, replacement] of RULES) result = result.replace(pattern, replacement);
    return result;
};

module.exports = { REDACTED, redactCredentials };
