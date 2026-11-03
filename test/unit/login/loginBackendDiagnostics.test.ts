import { describe, expect, it, vi } from 'vitest';
import { formatConnection } from '@/services/onlineMusic/login/loginBackendDiagnostics';
import { formatNeteaseLoginDiagnostics } from '@/services/onlineMusic/netease/neteaseLoginDiagnostics';
import { collectQqLoginDiagnostics, formatQqLoginDiagnostics } from '@/services/onlineMusic/qq/qqLoginDiagnostics';

// test/unit/login/loginBackendDiagnostics.test.ts
// What the main process records about the local API (its start-up steps, the connections it opened)
// as the report prints it. The report keeps what triage needs whole: the address each connection
// reached, the network interfaces, the device id; the user is told what it holds before sending it.

const AT = Date.UTC(2026, 8, 26, 12, 0, 0);

const app: ElectronAppEnvironment = {
    version: '1.2.3',
    electron: '43.7.5',
    node: '24.21.0',
    chrome: '150.0.7871.250',
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0.22631',
    osVersion: 'Windows 11 Pro',
    locale: 'zh-CN',
    timeZone: 'Asia/Shanghai',
    uptimeSec: 120,
    credentialStore: { encryptionAvailable: true, backend: null },
};

const resetConnection: ElectronNetworkConnection = {
    at: AT,
    method: 'POST',
    host: 'interfacepc.music.163.com',
    path: '/eapi/login/qrcode/client/login',
    dns: [{ address: '240e:96c:6100::7', family: 6 }, { address: '59.111.181.35', family: 4 }],
    attempts: [],
    remote: { address: '240e:96c:6100::7', family: 6 },
    reusedSocket: false,
    connectMs: 31,
    tlsMs: null,
    responseMs: null,
    totalMs: 80,
    status: null,
    error: { code: 'ECONNRESET', message: 'read ECONNRESET', phase: 'tls' },
};

const neteaseSnapshot: ElectronNeteaseLoginDiagnostics = {
    providerId: 'netease',
    capturedAt: AT,
    app,
    backend: { status: 'running', port: 52001, error: null, updatedAt: AT },
    startup: [{
        startedAt: AT,
        finishedAt: AT + 1500,
        outcome: 'running',
        steps: [
            { id: 'port', startedAt: AT, durationMs: 1, outcome: 'ok', detail: { port: 52001 }, error: null },
            { id: 'runtime', startedAt: AT, durationMs: 5, outcome: 'ok', detail: { deviceId: 'DEVICE0123456789CEABCDEF' }, error: null },
            { id: 'xeapi-key', startedAt: AT, durationMs: 1400, outcome: 'ok', detail: { cache: 'missing', source: 'network' }, error: null },
            { id: 'anonymous-token', startedAt: AT, durationMs: 90, outcome: 'ok', detail: { refreshed: false, error: 'socket hang up' }, error: null },
        ],
    }],
    login: {
        capturedAt: AT,
        startup: { anonymousTokenAtLoad: 'present' },
        network: { interfaces: [{ name: 'Wi-Fi', addresses: [{ address: '192.168.1.5', family: 4 }] }] },
        requests: [{
            at: AT,
            uri: '/api/login/qrcode/client/login',
            crypto: '',
            ipHeader: 'none',
            deviceIdTail: 'CEABCDEF',
            hasMusicU: false,
            hasMusicA: true,
            durationMs: 80,
            outcome: { settled: 'rejected', status: 502, code: 502, message: 'read ECONNRESET' },
            connections: [resetConnection],
        }],
    },
    identity: {
        processStartedAt: AT - 30 * 60_000,
        deviceId: 'DEVICE0123456789CEABCDEF',
        connectionResets: 3,
        rotations: 2,
        lastRotatedAt: AT + 5 * 60_000,
        lastTokenRenewed: false,
        pendingRotation: true,
    },
    connections: [{ ...resetConnection, method: 'GET', path: '/api/xeapi/key?nick=Zhang.San', error: null, status: 200, tlsMs: 40 }],
};

const session = { hasLoginCookie: false, hasAnonymousCookie: true };
const textOf = (lines: Array<{ text: string }>): string[] => lines.map(line => line.text);

describe('login backend diagnostics', () => {
    it('lays out the NetEase local API, its start-up steps and each login request with the connection it opened', () => {
        const lines = textOf(formatNeteaseLoginDiagnostics(neteaseSnapshot, session));

        expect(lines).toEqual(expect.arrayContaining([
            'app: 1.2.3 electron 43.7.5 (node 24.21.0, chrome 150.0.7871.250) win32 x64',
            'os: 10.0.22631 (Windows 11 Pro), locale zh-CN, time zone Asia/Shanghai, uptime 120s',
            'credential store: encryption=yes',
            'local api: running 127.0.0.1:52001 (since 12:00:00.000)',
            'startup runs (1, oldest first, UTC):',
            '  12:00:00.000 running (1500ms)',
            '    port ok 1ms port=52001',
            '    runtime ok 5ms deviceId=DEVICE0123456789CEABCDEF',
            '    xeapi-key ok 1400ms cache=missing source=network',
            '    anonymous-token ok 90ms refreshed=false error="socket hang up"',
            'network interfaces: Wi-Fi: 192.168.1.5',
            'identity: process started 2026-09-26T11:30:00.000Z, deviceId=DEVICE0123456789CEABCDEF, qr connection resets=3, device rotations=2 (last 12:05:00.000, new anonymous token=no), rotation pending=yes',
            'device ids seen in login requests: 1',
            '  12:00:00.000 /api/login/qrcode/client/login rejected status=502 code=502 msg="read ECONNRESET" 80ms ip-header=none device=…CEABCDEF MUSIC_U=no MUSIC_A=yes',
            '      ↳ interfacepc.music.163.com → 240e:96c:6100::7 (v6) tcp=31ms → ECONNRESET at tls: read ECONNRESET (80ms)',
            'other upstream connections (1, oldest first, UTC):',
            '  12:00:00.000 GET interfacepc.music.163.com/api/xeapi/key?nick=Zhang.San → 240e:96c:6100::7 (v6) tcp=31ms tls=40ms → HTTP 200 (80ms)',
        ]));
    });

    it('still produces a report when the NetEase upstream package never loaded', () => {
        const lines = textOf(formatNeteaseLoginDiagnostics({
            ...neteaseSnapshot,
            backend: { status: 'error', port: null, error: 'load: Cannot find module', updatedAt: AT },
            startup: [{
                startedAt: AT,
                finishedAt: AT,
                outcome: 'failed',
                steps: [{ id: 'load', startedAt: AT, durationMs: 0, outcome: 'failed', detail: {}, error: 'Cannot find module' }],
            }],
            login: null,
            identity: null,
            connections: [],
        }, session));

        expect(lines).toEqual(expect.arrayContaining([
            '    load failed 0ms error="Cannot find module"',
            'upstream package: not loaded (see the load step above)',
            'other upstream connections (0, oldest first, UTC):',
            '  (none)',
        ]));
    });

    it('still produces a NetEase report when the snapshot lacks the app, the backend and the start-up runs', () => {
        const { app: _app, backend: _backend, startup: _startup, ...rest } = neteaseSnapshot;
        const lines = textOf(formatNeteaseLoginDiagnostics(rest as ElectronNeteaseLoginDiagnostics, session));
        expect(lines).toEqual(expect.arrayContaining([
            'app: unknown',
            'local api: unknown',
            'startup runs: unknown',
            expect.stringMatching(/^startup: .*runs=unknown, last run=none$/),
        ]));
    });

    it('lists each address Happy Eyeballs tried when the first one failed', () => {
        expect(formatConnection({
            ...resetConnection,
            remote: { address: '59.111.181.35', family: 4 },
            attempts: [
                { address: '240e:96c:6100::7', family: 6, outcome: 'timeout', error: null },
                { address: '59.111.181.35', family: 4, outcome: 'connected', error: null },
            ],
            tlsMs: 120,
            status: 200,
            error: null,
        }).text).toBe('POST interfacepc.music.163.com/eapi/login/qrcode/client/login → 59.111.181.35 (v4) tcp=31ms tls=120ms → HTTP 200 (80ms); attempts: 240e:96c:6100::7 v6 timeout, 59.111.181.35 v4 connected');
    });

    it('prints any host with its path, and the error in its own words', () => {
        expect(formatConnection({ ...resetConnection, host: 'proxy.lan', error: null, dnsError: { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND proxy.lan' }, remote: null }).text)
            .toBe('POST proxy.lan/eapi/login/qrcode/client/login → no connection tcp=31ms → DNS ENOTFOUND: getaddrinfo ENOTFOUND proxy.lan (80ms)');
    });

    it('lays out the QQ local API, the package\'s failures with their original error, the auth events and the connections', () => {
        const snapshot: ElectronQqLoginDiagnostics = {
            providerId: 'qq',
            capturedAt: AT,
            app: { ...app, platform: 'linux', credentialStore: { encryptionAvailable: true, backend: 'basic_text' } },
            backend: { status: 'running', port: 41057, error: null, updatedAt: AT },
            version: '3.1.3',
            startup: [],
            hooks: { installed: ['failSession', 'failBootstrap', 'logger'], error: null },
            failures: [{
                at: AT,
                kind: 'session',
                stage: 'session-issue',
                channel: 'qq',
                sessionState: 'exchanging',
                error: {
                    name: 'Error',
                    message: 'Electron safeStorage selected the unencrypted basic_text backend',
                    stack: ['at assertEncryptionAvailable (qqAuthSessionRepository.cjs:19:11)', 'at QrLoginService.poll (@yakult-green-tea/qq-music-api/dist/src/services/auth/qrLogin.node.js:185:23)'],
                },
            }],
            authEvents: [{ at: AT, level: 'warn', event: 'qq-auth.session-failed', details: { failureStage: 'session-issue', name: 'Error' } }],
            connections: [{ ...resetConnection, host: 'u.y.qq.com', path: '/cgi-bin/musicu.fcg', error: null, status: 200, tlsMs: 90 }],
        };

        const lines = textOf(formatQqLoginDiagnostics({ hasSession: false, channels: ['qq', 'wx'], lastAccountCheck: null }, snapshot));

        expect(lines).toEqual([
            'runtime: electron (local API)',
            'app: 1.2.3 electron 43.7.5 (node 24.21.0, chrome 150.0.7871.250) linux x64',
            'os: 10.0.22631 (Windows 11 Pro), locale zh-CN, time zone Asia/Shanghai, uptime 120s',
            'credential store: encryption=yes backend=basic_text',
            'local api: running 127.0.0.1:41057 (since 12:00:00.000)',
            'qq-music-api: 3.1.3, hooks: failSession, failBootstrap, logger',
            'startup runs: none',
            'session: backend session stored=no',
            'login channels: qq, wx',
            'last account check: none',
            'backend login failures (1, oldest first, UTC):',
            '  12:00:00.000 session stage=session-issue channel=qq state=exchanging name=Error message="Electron safeStorage selected the unencrypted basic_text backend"',
            '      at assertEncryptionAvailable (qqAuthSessionRepository.cjs:19:11)',
            '      at QrLoginService.poll (@yakult-green-tea/qq-music-api/dist/src/services/auth/qrLogin.node.js:185:23)',
            'auth events (1, oldest first, UTC):',
            '  12:00:00.000 warn qq-auth.session-failed failureStage=session-issue name=Error',
            'upstream connections (1, oldest first, UTC):',
            '  12:00:00.000 POST u.y.qq.com/cgi-bin/musicu.fcg → 240e:96c:6100::7 (v6) tcp=31ms tls=90ms → HTTP 200 (80ms)',
        ]);
    });

    it('still produces a QQ report when the snapshot lacks the app, the backend and the start-up runs', () => {
        const snapshot = { providerId: 'qq', capturedAt: AT, version: '3.1.3', connections: [] } as unknown as ElectronQqLoginDiagnostics;
        expect(textOf(formatQqLoginDiagnostics({ hasSession: false, channels: null, lastAccountCheck: null }, snapshot))).toEqual([
            'runtime: electron (local API)',
            'app: unknown',
            'local api: unknown',
            'qq-music-api: 3.1.3, hooks: none',
            'startup runs: unknown',
            'session: backend session stored=no',
            'login channels: not declared by the backend',
            'last account check: none',
            'backend login failures (0, oldest first, UTC):',
            '  (none)',
            'auth events (0, oldest first, UTC):',
            '  (none)',
            'upstream connections (0, oldest first, UTC):',
            '  (none)',
        ]);
    });

    it('keeps the QQ session lines alone when there is no main process to ask, and says why when asking failed', async () => {
        const state = { hasSession: true, channels: null, lastAccountCheck: null };
        const sessionLines = ['session: backend session stored=yes', 'login channels: not declared by the backend', 'last account check: none'];
        expect(textOf(formatQqLoginDiagnostics(state))).toEqual(sessionLines);
        vi.stubGlobal('window', { electron: { getLoginDiagnostics: () => Promise.reject(new Error('IPC channel closed')) } });
        try {
            expect(textOf(await collectQqLoginDiagnostics(state))).toEqual(['backend diagnostics unavailable: IPC channel closed', ...sessionLines]);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
