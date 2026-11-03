import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en';
import inLocale from '@/i18n/locales/in';
import zh from '@/i18n/locales/zh-CN';
import {
    LOGIN_SELF_CHECK_COPY,
    resolveLoginSelfCheckItemLabel,
    resolveLoginSelfCheckProxyMessage,
    resolveLoginSelfCheckVerdict,
    resolveLoginSelfCheckVerdictMessage,
    summarizeLoginSelfCheck,
} from '@/library/core/account/loginSelfCheckRules';
import type { LoginSelfCheckVerdictKind } from '@/library/core/account/account.contract';
import type { LoginSelfCheckHost, LoginSelfCheckResult } from '@/types/onlineMusic';

// test/unit/library/core/loginSelfCheckRules.test.ts
// 自检结论按「离用户最近、最确定」的顺序取第一个命中的；代理只作附加提示。

const host = (name: string, overrides: Partial<LoginSelfCheckHost> = {}): LoginSelfCheckHost => ({
    host: name,
    dns: { addresses: [{ address: '59.111.181.35', family: 4 }], durationMs: 8, error: null, fakeIp: false },
    connections: [{ address: '59.111.181.35', family: 4, tcpMs: 20, tlsMs: 60, error: null }],
    https: { httpStatus: 200, durationMs: 90, remote: { address: '59.111.181.35', family: 4 }, error: null, clockSkewMs: 800 },
    ...overrides,
});

const result = (overrides: Partial<LoginSelfCheckResult> = {}): LoginSelfCheckResult => ({
    providerId: 'netease',
    runtime: 'electron',
    startedAt: 0,
    durationMs: 1000,
    backend: { status: 'running', port: 4100, error: null, probe: { ok: true, httpStatus: 200, durationMs: 4, error: null } },
    proxy: { env: {}, system: 'DIRECT' },
    hosts: [host('interfacepc.music.163.com'), host('interface.music.163.com')],
    credentialStore: { encryptionAvailable: true, backend: null },
    ...overrides,
});

const reset = { code: 'ECONNRESET', message: 'read ECONNRESET', phase: 'tls' as const };

describe('login self-check verdict', () => {
    it('finds nothing wrong when every layer answered', () => {
        expect(resolveLoginSelfCheckVerdict(result())).toEqual({ kind: 'network-ok', detail: null, proxy: null });
    });

    it('blames the local backend first, whether it is not running or not answering', () => {
        expect(resolveLoginSelfCheckVerdict(result({
            backend: { status: 'error', port: null, error: 'xeapi-key: timed out', probe: null },
            hosts: [host('interfacepc.music.163.com', { connections: [{ address: '59.111.181.35', family: 4, tcpMs: null, tlsMs: null, error: reset }] })],
        }))).toMatchObject({ kind: 'backend-down', detail: 'xeapi-key: timed out' });
        expect(resolveLoginSelfCheckVerdict(result({
            backend: { status: 'running', port: 4100, error: null, probe: { ok: false, httpStatus: null, durationMs: 3000, error: { code: 'ETIMEDOUT', message: 'no response within 3000ms' } } },
        }))).toMatchObject({ kind: 'backend-down', detail: 'no response within 3000ms' });
        expect(resolveLoginSelfCheckVerdict(result({
            runtime: 'web',
            backend: { status: 'remote', port: null, error: null, url: 'https://api.example.test', probe: { ok: false, httpStatus: null, durationMs: 10, error: { code: null, message: 'Failed to fetch' } } },
            hosts: [],
            proxy: null,
        }))).toMatchObject({ kind: 'remote-unreachable', detail: 'https://api.example.test Failed to fetch' });
    });

    it('points QQ users at the keyring when the session cannot be stored encrypted', () => {
        expect(resolveLoginSelfCheckVerdict(result({ providerId: 'qq', keepsSignInEncrypted: true, credentialStore: { encryptionAvailable: true, backend: 'basic_text' } })))
            .toMatchObject({ kind: 'credential-store', detail: 'basic_text' });
        expect(resolveLoginSelfCheckVerdict(result({ providerId: 'qq', keepsSignInEncrypted: true, credentialStore: { encryptionAvailable: false, backend: null } })))
            .toMatchObject({ kind: 'credential-store', detail: 'encryption unavailable' });
        // 网易不用这个凭据仓库。
        expect(resolveLoginSelfCheckVerdict(result({ credentialStore: { encryptionAvailable: true, backend: 'basic_text' } })).kind).toBe('network-ok');
    });

    it('reports DNS failures before any connection problem', () => {
        expect(resolveLoginSelfCheckVerdict(result({
            hosts: [host('interfacepc.music.163.com', {
                dns: { addresses: [], durationMs: 5, error: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND', phase: 'dns' }, fakeIp: false },
                connections: [],
                https: null,
            })],
        }))).toMatchObject({ kind: 'dns-failed', detail: 'interfacepc.music.163.com: ENOTFOUND' });
    });

    it('tells a TLS-handshake reset apart from a host that simply cannot be reached', () => {
        expect(resolveLoginSelfCheckVerdict(result({
            hosts: [host('interfacepc.music.163.com', { connections: [{ address: '59.111.181.35', family: 4, tcpMs: 20, tlsMs: null, error: reset }] })],
        }))).toMatchObject({ kind: 'tls-reset', detail: 'interfacepc.music.163.com 59.111.181.35 (IPv4): ECONNRESET' });
        expect(resolveLoginSelfCheckVerdict(result({
            hosts: [host('interfacepc.music.163.com', {
                connections: [{ address: '59.111.181.35', family: 4, tcpMs: null, tlsMs: null, error: { code: 'ETIMEDOUT', message: 'no progress', phase: 'tcp' } }],
            })],
        }))).toMatchObject({ kind: 'upstream-unreachable', detail: 'interfacepc.music.163.com 59.111.181.35 (IPv4): ETIMEDOUT' });
    });

    it('singles out a broken IPv6 path when IPv4 works', () => {
        expect(resolveLoginSelfCheckVerdict(result({
            hosts: [host('interfacepc.music.163.com', {
                connections: [
                    { address: '59.111.181.35', family: 4, tcpMs: 20, tlsMs: 60, error: null },
                    { address: '2001:0:2851:782c::1', family: 6, tcpMs: 30, tlsMs: null, error: reset },
                ],
            })],
        }))).toMatchObject({ kind: 'ipv6-failed', detail: 'interfacepc.music.163.com 2001:0:2851:782c::1: ECONNRESET at tls' });
    });

    it('then looks at the HTTPS request and the clock', () => {
        expect(resolveLoginSelfCheckVerdict(result({
            hosts: [host('interfacepc.music.163.com', {
                https: { httpStatus: null, durationMs: 5000, remote: null, error: { code: 'ETIMEDOUT', message: 'no response', phase: 'http' }, clockSkewMs: null },
            })],
        }))).toMatchObject({ kind: 'https-failed', detail: 'interfacepc.music.163.com: ETIMEDOUT' });
        expect(resolveLoginSelfCheckVerdict(result({
            hosts: [host('interfacepc.music.163.com', {
                https: { httpStatus: 200, durationMs: 90, remote: null, error: null, clockSkewMs: -12 * 60_000 },
            })],
        }))).toMatchObject({ kind: 'clock-skew', detail: '12' });
        // 一分钟以内的偏差不算问题（这台开发机实测偏 58 秒，登录照常）。
        expect(resolveLoginSelfCheckVerdict(result({
            hosts: [host('interfacepc.music.163.com', { https: { httpStatus: 200, durationMs: 90, remote: null, error: null, clockSkewMs: -57_627 } })],
        })).kind).toBe('network-ok');
    });

    it('adds a proxy hint for fake-ip, environment and system proxies', () => {
        const fakeIp = host('interfacepc.music.163.com', { dns: { addresses: [{ address: '198.18.6.189', family: 4 }], durationMs: 9, error: null, fakeIp: true } });
        expect(resolveLoginSelfCheckVerdict(result({ hosts: [fakeIp] })).proxy).toBe('fake-ip');
        expect(resolveLoginSelfCheckVerdict(result({ proxy: { env: { HTTPS_PROXY: 'http://127.0.0.1:7890' }, system: 'DIRECT' } })).proxy).toBe('env');
        expect(resolveLoginSelfCheckVerdict(result({ proxy: { env: {}, system: 'PROXY 127.0.0.1:7890' } })).proxy).toBe('system');
        expect(resolveLoginSelfCheckVerdict(result({ proxy: { env: {}, system: 'unavailable: timed out' } })).proxy).toBeNull();
    });
});

describe('login self-check items and copy', () => {
    it('lists each layer, skipping what was not checked', () => {
        const items = summarizeLoginSelfCheck(result({
            providerId: 'qq',
            keepsSignInEncrypted: true,
            proxy: { env: {}, system: 'PROXY 127.0.0.1:7890' },
            hosts: [host('u.y.qq.com', {
                connections: [
                    { address: '59.111.181.35', family: 4, tcpMs: 20, tlsMs: 60, error: null },
                    { address: '240e::7', family: 6, tcpMs: 30, tlsMs: null, error: reset },
                ],
                https: { httpStatus: 200, durationMs: 90, remote: null, error: null, clockSkewMs: 9 * 60_000 },
            })],
        }));
        expect(items).toEqual([
            { id: 'backend', state: 'ok', detail: null },
            { id: 'credential-store', state: 'ok', detail: null },
            { id: 'dns', state: 'ok', detail: null },
            { id: 'ipv4', state: 'ok', detail: null },
            { id: 'ipv6', state: 'fail', detail: 'u.y.qq.com: ECONNRESET (tls)' },
            { id: 'https', state: 'ok', detail: null },
            // 系统代理只是信息：内嵌后端的请求不走它。
            { id: 'proxy', state: 'ok', detail: 'PROXY 127.0.0.1:7890' },
            { id: 'clock', state: 'warn', detail: '9 min' },
        ]);
        expect(summarizeLoginSelfCheck(result({ hosts: [host('x.163.com', { connections: [], https: null })] })).find(item => item.id === 'ipv6'))
            .toEqual({ id: 'ipv6', state: 'skip', detail: null });
    });

    it('has only the remote API on the web build', () => {
        expect(summarizeLoginSelfCheck(result({
            runtime: 'web',
            backend: { status: 'remote', port: null, error: null, url: 'https://api.example.test', probe: { ok: true, httpStatus: null, durationMs: 40, error: null } },
            hosts: [],
            proxy: null,
        }))).toEqual([{ id: 'backend', state: 'ok', detail: null }]);
        expect(resolveLoginSelfCheckItemLabel('backend', 'web')).toEqual({ key: 'home.qrSelfCheckItemRemote' });
        expect(resolveLoginSelfCheckItemLabel('backend', 'electron')).toEqual({ key: 'home.qrSelfCheckItemBackend' });
    });

    it('hands out keys that exist in every locale', () => {
        const kinds: LoginSelfCheckVerdictKind[] = [
            'backend-down', 'remote-unreachable', 'credential-store', 'dns-failed', 'tls-reset',
            'upstream-unreachable', 'ipv6-failed', 'https-failed', 'clock-skew', 'network-ok',
        ];
        const keys = [
            ...kinds.map(kind => resolveLoginSelfCheckVerdictMessage({ kind, detail: 'd', proxy: null }, '网易云').key),
            ...(['fake-ip', 'env'] as const).map(proxy => resolveLoginSelfCheckProxyMessage({ kind: 'network-ok', detail: null, proxy }, 'QQ音乐')!.key),
            ...(['backend', 'credential-store', 'dns', 'ipv4', 'ipv6', 'https', 'proxy', 'clock'] as const).map(id => resolveLoginSelfCheckItemLabel(id, 'electron').key),
            resolveLoginSelfCheckItemLabel('backend', 'web').key,
            LOGIN_SELF_CHECK_COPY.title.key,
            LOGIN_SELF_CHECK_COPY.running.key,
            LOGIN_SELF_CHECK_COPY.failedKey,
            'home.qrDiagnosticsDisclosure',
        ];
        for (const locale of [en, zh, inLocale]) {
            const home = (locale as unknown as { home: Record<string, unknown> }).home;
            for (const key of keys) expect(home[key.replace(/^home\./, '')], key).toBeTruthy();
        }
        expect(resolveLoginSelfCheckProxyMessage({ kind: 'network-ok', detail: null, proxy: 'system' }, 'x')).toBeNull();
        expect(resolveLoginSelfCheckVerdictMessage({ kind: 'tls-reset', detail: 'host: ECONNRESET', proxy: null }, '网易云'))
            .toEqual({ key: 'home.qrSelfCheckTlsReset', values: { provider: '网易云', detail: 'host: ECONNRESET' } });
    });
});
