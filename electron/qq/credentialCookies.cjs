// electron/qq/credentialCookies.cjs
// QQ 音乐登录态的 Cookie 名：写日志时只去掉它们的值（electron/debug/redactCredentials.cjs）。

module.exports = [
    'qqmusic_key', 'qm_keyst', 'psrf_qqaccess_token', 'psrf_qqrefresh_token', 'psrf_access_token',
    'wxaccess_token', 'wxrefresh_token', 'qqmusic_session',
];
