import { describe, expect, it } from 'vitest';

const { redactCredentials } = require('../../../electron/debug/redactCredentials.cjs');

// test/unit/electron/redactCredentials.test.ts
// What the runtime log keeps of a credential: the parameter or cookie name, never its value. Everything
// else on the line stays as it was, so the log still says which request it was and why it failed.

describe('redactCredentials', () => {
    it('blanks the cookie in an address, encoded or decoded, and keeps the rest of the query', () => {
        expect(redactCredentials('/song/url?id=1&cookie=MUSIC_U%3Dabc%3B%20os%3Dpc&br=999000'))
            .toBe('/song/url?id=1&cookie=<redacted>&br=999000');
        expect(redactCredentials('Request Success: [eapi] /lyric?cookie=MUSIC_U=abc; __csrf=def; os=pc&id=7'))
            .toBe('Request Success: [eapi] /lyric?cookie=<redacted>&id=7');
        expect(redactCredentials('GET /search?cookie=uin=1; qqmusic_key=Q'))
            .toBe('GET /search?cookie=<redacted>');
    });

    it('blanks a Cookie header and a cookie field, but not a field that only names cookies', () => {
        expect(redactCredentials('headers: Cookie: MUSIC_U=abc; os=pc')).toBe('headers: Cookie: <redacted>');
        expect(redactCredentials('{"status":301,"cookie":"MUSIC_U=abc; Path=/","body":{}}'))
            .toBe('{"status":301,"cookie":"<redacted>","body":{}}');
        expect(redactCredentials("{ cookie: 'MUSIC_U=abc' }")).toBe('{ cookie: "<redacted>" }');
        expect(redactCredentials('session: login cookie=yes, anonymous cookie=no'))
            .toBe('session: login cookie=yes, anonymous cookie=no');
        expect(redactCredentials('{"hasLoginCookie":true}')).toBe('{"hasLoginCookie":true}');
    });

    it('blanks known login cookies wherever they turn up', () => {
        expect(redactCredentials('set MUSIC_U=abc123; MUSIC_A_T=1 and qm_keyst=Q_H_L_x, psrf_qqaccess_token=T'))
            .toBe('set MUSIC_U=<redacted>; MUSIC_A_T=<redacted> and qm_keyst=<redacted>, psrf_qqaccess_token=<redacted>');
    });

    it('leaves lines without credentials and non-strings alone', () => {
        expect(redactCredentials('[HiFi] load failed {"errorCode":"DEVICE_BUSY"} 192.168.1.4')).toBe('[HiFi] load failed {"errorCode":"DEVICE_BUSY"} 192.168.1.4');
        expect(redactCredentials('')).toBe('');
        expect(redactCredentials(undefined)).toBeUndefined();
    });
});
