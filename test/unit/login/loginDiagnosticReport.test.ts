import { describe, expect, it, vi } from 'vitest';
import { buildLoginIssueUrl, diagnosticLine, formatLoginDiagnosticReport, formatLoginSelfCheck } from '@/services/onlineMusic/login/loginDiagnosticReport';
import { formatNeteaseLoginDiagnostics } from '@/services/onlineMusic/netease/neteaseLoginDiagnostics';
import { formatQqLoginDiagnostics } from '@/services/onlineMusic/qq/qqLoginDiagnostics';
import { loginCaseOf, loginFailureFacts } from '@/services/onlineMusic/login/loginFailureCase';
import { omni } from '@/services/onlineMusic/omni';
import { listOnlineMusicProviders } from '@/services/onlineMusic/providerRegistry';
import type { LoginDiagnosticLine, LoginSelfCheckResult } from '@/types/onlineMusic';

// test/unit/login/loginDiagnosticReport.test.ts

const AT = Date.UTC(2026, 8, 26, 12, 0, 0);

type Netease = ElectronNeteaseLoginDiagnostics;
type Login = NonNullable<Netease['login']>;

// What a network interface carries, as the main process lists it: an IPv4 address, a global IPv6 one, a link-local one.
const interfacesOf = (items: Array<{ name: string; ipv4: boolean; globalIpv6: boolean }>): Login['network'] => ({
    interfaces: items.map(({ name, ipv4, globalIpv6 }) => ({
        name,
        addresses: [
            ...(ipv4 ? [{ address: '192.0.2.10', family: 4 as const }] : []),
            ...(globalIpv6 ? [{ address: '2001:db8::10', family: 6 as const }] : []),
            { address: 'fe80::1', family: 6 as const },
        ],
    })),
});
const printedAddresses = (ipv4: boolean, globalIpv6: boolean): string => [ipv4 ? '192.0.2.10' : '', globalIpv6 ? '2001:db8::10' : '', 'fe80::1'].filter(Boolean).join(', ');

const login: Login = {
    capturedAt: AT,
    startup: { anonymousTokenAtLoad: 'present' },
    network: { interfaces: [{ name: 'Wi-Fi', addresses: [{ address: '192.0.2.10', family: 4 }, { address: '2001:db8::10', family: 6 }, { address: '2001:db8::11', family: 6 }] }] },
    requests: [{
        at: AT,
        uri: '/api/login/qrcode/client/login',
        crypto: '',
        ipHeader: 'none',
        deviceIdTail: 'ABCDEF',
        hasMusicU: false,
        hasMusicA: true,
        durationMs: 140,
        outcome: { settled: 'rejected', status: 400, code: 8821, message: '需要行为验证码验证' },
        connections: [],
    }],
};

const snapshot: Netease = {
    providerId: 'netease',
    capturedAt: AT,
    app: { version: '1.2.3', electron: '38.0.0', node: '22.20.0', chrome: '140.0.7339.0', platform: 'win32', arch: 'x64', osRelease: '10.0.22631' } as ElectronAppEnvironment,
    backend: { status: 'running', port: 52001, error: null, updatedAt: AT },
    startup: [],
    login,
    identity: null,
    connections: [],
};

const reportOf = (providerLines: readonly unknown[]): string => formatLoginDiagnosticReport({
    generatedAt: AT, appVersion: '1.2.3', userAgent: 'test-agent', providerId: 'netease', methodId: null, failure: 'check-error', timeline: [],
    providerLines: providerLines as LoginDiagnosticLine[],
});

// Made-up text of the kinds triage needs whole: a user's folder in an error, a platform's answer, an
// address with a query and an IP. The report keeps it as it was said; the user is told what it holds.
const SAID = {
    path: "EPERM: operation not permitted, open 'C:\\Users\\Zhang San\\AppData\\Roaming\\Folia\\ncm\\anonymous_token'",
    answer: 'refused for uin 2873651094',
    address: 'request to https://music.example.test/login/qr/check?key=qr-1 from 203.0.113.7 failed',
};
// A start-up run and a connection with such text in every field that comes from the main process.
const startupSaying: ElectronBackendStartupRun = {
    startedAt: AT,
    finishedAt: AT + 5,
    outcome: 'failed',
    steps: [{ id: 'load', startedAt: AT, durationMs: 5, outcome: 'failed', detail: { file: SAID.path }, error: SAID.path }],
};
const connectionSaying: ElectronNetworkConnection = {
    at: AT,
    method: 'POST',
    host: 'proxy.example.test',
    path: '/login/qr/check?key=qr-1',
    dns: [{ address: '203.0.113.7', family: 4 }],
    attempts: [{ address: '203.0.113.7', family: 4, outcome: 'failed', error: { code: 'ECONNREFUSED', message: SAID.address } }, { address: '203.0.113.8', family: 4, outcome: 'connected', error: null }],
    remote: { address: '203.0.113.8', family: 4 },
    reusedSocket: false,
    connectMs: 3,
    tlsMs: null,
    responseMs: null,
    totalMs: 9,
    status: null,
    error: { code: 'ECONNRESET', message: SAID.address, phase: 'tls' },
};

describe('QR login diagnostic report', () => {
    it('lays out the main-process record so the swallowed NetEase code is visible', () => {
        const lines = formatNeteaseLoginDiagnostics(snapshot, { hasLoginCookie: false, hasAnonymousCookie: true }).map(line => line.text);

        expect(lines).toContain('runtime: electron (local API)');
        expect(lines).toContain('app: 1.2.3 electron 38.0.0 (node 22.20.0, chrome 140.0.7339.0) win32 x64');
        expect(lines).toContain('local api: running 127.0.0.1:52001 (since 12:00:00.000)');
        expect(lines).toContain('session: login cookie=no, anonymous cookie=yes');
        expect(lines).toContain('network interfaces: Wi-Fi: 192.0.2.10, 2001:db8::10, 2001:db8::11');
        expect(lines).toContain(
            '  12:00:00.000 /api/login/qrcode/client/login rejected status=400 code=8821 msg="需要行为验证码验证" 140ms ip-header=none device=…ABCDEF MUSIC_U=no MUSIC_A=yes',
        );
    });

    it('says plainly when there is no main process to ask', () => {
        expect(formatNeteaseLoginDiagnostics(null, { hasLoginCookie: false, hasAnonymousCookie: false })[0].text)
            .toBe('runtime: web (remote API, no main-process record)');
    });

    describe('what a platform adds to the report', () => {
        it('keeps every value as it was handed in, between the words the platform\'s code wrote', () => {
            const line = diagnosticLine`check status=${200} cookie=${'yes'} error="${SAID.path}" said="${SAID.answer}" at ${SAID.address}`;
            expect(line.text).toBe(`check status=200 cookie=yes error="${SAID.path}" said="${SAID.answer}" at ${SAID.address}`);
            expect(diagnosticLine`a=${null} b=${undefined} c=${''} d=${true}${diagnosticLine` e="${'uin 2873651094'}"`}`.text).toBe('a=- b=- c= d=true e="uin 2873651094"');
        });

        // Every platform that declares diagnostics has a row here: its builder is fed the text above
        // in the fields that come from the main process. A new platform's diagnostics fail the first
            // assertion until it has a row. Compact stage/code diagnostics have their own adapter tests.
        it('keeps what the main process handed over, for every platform that adds lines of its own', () => {
            const builders: Record<string, () => LoginDiagnosticLine[]> = {
                netease: () => formatNeteaseLoginDiagnostics({
                    ...snapshot,
                    backend: { status: 'error', port: null, error: SAID.path, updatedAt: AT },
                    startup: [startupSaying],
                    connections: [connectionSaying],
                    login: {
                        ...login,
                        network: { interfaces: [{ name: "Zhang San's iPhone", addresses: [{ address: '203.0.113.9', family: 4 }] }] },
                        requests: [{ ...login.requests[0], outcome: { settled: 'rejected', status: 502, code: null, message: SAID.answer }, connections: [connectionSaying] }],
                    },
                }, { hasLoginCookie: true, hasAnonymousCookie: true }),
                qq: () => formatQqLoginDiagnostics({
                    hasSession: true,
                    channels: ['qq', 'wx'],
                    lastAccountCheck: diagnosticLine`failed: ${SAID.address}`,
                }, {
                    providerId: 'qq',
                    capturedAt: AT,
                    app: snapshot.app,
                    backend: { status: 'error', port: 41057, error: SAID.answer, updatedAt: AT },
                    version: '3.3.0',
                    startup: [startupSaying],
                    hooks: { installed: ['logger'], error: null },
                    failures: [{
                        at: AT, kind: 'session', stage: 'poll', channel: 'qq', sessionState: 'exchanging',
                        error: { message: SAID.answer, stack: ['at QrLoginService.poll (qq-music-api/dist/src/services/auth/qrLogin.node.js:185:23)'] },
                    }],
                    authEvents: [{ at: AT, level: 'warn', event: 'qq-auth.session-failed', details: { said: SAID.answer } }],
                    connections: [connectionSaying],
                }),
            };
            const declaring = listOnlineMusicProviders().filter(provider => provider.auth?.getLoginDiagnostics).map(provider => provider.id);
            // The car adapter reports only safe stage/code fields, exercised in qishui/adapter.test.ts.
            expect([...Object.keys(builders), 'qishui'].sort()).toEqual(declaring.sort());
            for (const [providerId, build] of Object.entries(builders)) {
                const report = reportOf(build());
                expect(report, providerId).toContain('2873651094');
                expect(report, providerId).toContain('https://music.example.test/login/qr/check?key=qr-1 from 203.0.113.7');
                expect(report, providerId).toContain('POST proxy.example.test/login/qr/check?key=qr-1 → 203.0.113.8 (v4)');
                expect(report, providerId).toContain('attempts: 203.0.113.7 v4 failed ECONNREFUSED, 203.0.113.8 v4 connected');
                expect(report, providerId).toContain('Zhang San');
            }
            expect(reportOf(builders.netease())).toContain("network interfaces: Zhang San's iPhone: 203.0.113.9");
            expect(reportOf(builders.qq())).toContain('      at QrLoginService.poll (qq-music-api/dist/src/services/auth/qrLogin.node.js:185:23)');
        });

        it('keeps a long list of network interfaces whole, a start-up error of several lines on its line, and a kernel release readable', () => {
            const names = ['Wi-Fi', '以太网', 'vEthernet (WSL (Hyper-V firewall))', 'vEthernet (Default Switch)', 'VMware Network Adapter VMnet1', 'VMware Network Adapter VMnet8', 'Tailscale', '蓝牙网络连接', 'Loopback Pseudo-Interface 1', '李华的 iPhone'];
            const lines = formatNeteaseLoginDiagnostics({
                ...snapshot,
                app: { ...snapshot.app, platform: 'linux', arch: 'arm64', osRelease: '6.8.0-45-generic' },
                backend: { status: 'error', port: null, error: "Cannot find module '@neteasecloudmusicapienhanced/api'\nRequire stack:\n- /opt/Folia/resources/app.asar/electron/neteaseApi.cjs", updatedAt: AT },
                login: { ...login, network: interfacesOf(names.map((name, index) => ({ name, ipv4: true, globalIpv6: index % 2 === 0 }))) },
            }, { hasLoginCookie: false, hasAnonymousCookie: false }).map(line => line.text);
            expect(lines).toContain('app: 1.2.3 electron 38.0.0 (node 22.20.0, chrome 140.0.7339.0) linux arm64');
            expect(lines).toContain('local api: error error="Cannot find module \'@neteasecloudmusicapienhanced/api\'\\nRequire stack:\\n- /opt/Folia/resources/app.asar/electron/neteaseApi.cjs" (since 12:00:00.000)');
            // Ten interfaces, each with every address it carries.
            expect(lines).toContain(`network interfaces: ${names.map((name, index) => `${name}: ${printedAddresses(true, index % 2 === 0)}`).join('; ')}`);
            expect(lines.every(line => !line.includes('\n'))).toBe(true);
        });

        it('prints a built line as it was written: it cannot be changed, a copy of it is only an object', () => {
            const line = diagnosticLine`ok ${1}`;
            expect(() => { (line as { text: string }).text = SAID.path; }).toThrow();
            const copy = { ...line, text: SAID.answer };
            const called = (diagnosticLine as unknown as (...parts: unknown[]) => LoginDiagnosticLine)([`said ${SAID.path} `, ' end'], SAID.answer);
            expect(called.text).toBe(`said ${SAID.path} ${SAID.answer} end`);
            expect(reportOf([line, copy, called]).split('\n').slice(-4, -1)).toEqual(['  ok 1', '  [object Object]', `  ${called.text}`]);
        });

        it('is written whatever a platform hands in for its lines', async () => {
            // A line that cannot be turned into a string; something that is not a list at all.
            expect(reportOf([Object.create(null), Symbol('x'), [SAID.answer]]).split('\n').slice(-4, -1)).toEqual(['  [object Object]', '  Symbol(x)', `  ${SAID.answer}`]);
            for (const notAList of [SAID.path, null, undefined, 42]) expect(reportOf(notAList as never).split('\n').slice(-2, -1)).toEqual(['  (none)']);
            // A platform that fails while it collects them, with something that is no error.
            const netease = listOnlineMusicProviders().find(provider => provider.id === 'netease')!;
            const collect = vi.spyOn(netease.auth!, 'getLoginDiagnostics');
            for (const thrown of [Object.create(null), SAID.path, { toString: () => SAID.answer }]) {
                collect.mockRejectedValue(thrown);
                expect(reportOf(await omni.getLoginDiagnostics('netease'))).toContain('  provider diagnostics unavailable: ');
            }
            collect.mockRestore();
            await expect(omni.getLoginDiagnostics('a-platform-that-is-gone')).resolves.toHaveLength(1);
        });

        it('prints a line the builder did not make as a string', () => {
            const report = reportOf([SAID.answer, { text: SAID.path }, 42, null, diagnosticLine`kept: status=${200}`]);
            expect(report.split('\n').slice(-6, -1)).toEqual([`  ${SAID.answer}`, '  [object Object]', '  42', '  null', '  kept: status=200']);
        });

        it('keeps the sentence of an error a platform throws while it collects its lines', async () => {
            const netease = listOnlineMusicProviders().find(provider => provider.id === 'netease')!;
            const collect = vi.spyOn(netease.auth!, 'getLoginDiagnostics').mockRejectedValue(new Error(SAID.path));
            const report = reportOf(await omni.getLoginDiagnostics('netease'));
            collect.mockRestore();
            expect(report).toContain(`  provider diagnostics unavailable: ${SAID.path}`);
        });
    });

    it('wraps the report in a code block ready to paste into an issue', () => {
        const report = formatLoginDiagnosticReport({
            generatedAt: AT,
            appVersion: '1.2.3',
            userAgent: 'test-agent',
            providerId: 'netease',
            methodId: null,
            failure: 'check-error',
            timeline: [{ at: AT, event: 'state', detail: { state: 'error', message: 'code 404: Not Found', elapsedMs: 2000 } }],
            providerLines: [diagnosticLine`runtime: electron (local API)`],
        });

        expect(report.split('\n')).toEqual([
            '### Folia QR login diagnostics',
            '',
            '```text',
            'generated: 2026-09-26T12:00:00.000Z',
            'app: 1.2.3',
            'user agent: test-agent',
            'provider: netease',
            'failure: check-error',
            'QR session timeline (1, UTC):',
            '  12:00:00.000 state state=error message="code 404: Not Found" elapsedMs=2000',
            'self-check: not run',
            'netease details:',
            '  runtime: electron (local API)',
            '```',
        ]);
    });

    // The case the window shows and its facts stand in the report, after the old `failure` line.
    // What a fact may hold is decided where the facts are made (loginFailureCase.test.ts): the
    // platform's words stay as they were said, and the sentence of a thrown error never becomes a fact.
    it('says which build produced the report and, on the web, which site it ran on', () => {
        const report = formatLoginDiagnosticReport({
            generatedAt: AT,
            appVersion: '1.2.3',
            userAgent: 'test-agent',
            build: 'unofficial (someone/folia-fork@abc1234)',
            origin: 'https://folia.example.com',
            providerId: 'netease',
            methodId: null,
            failure: 'start-error',
            timeline: [],
            providerLines: [],
        });

        expect(report.split('\n').slice(4, 7)).toEqual([
            'app: 1.2.3',
            'build: unofficial (someone/folia-fork@abc1234)',
            'origin: https://folia.example.com',
        ]);
        expect(report).toContain('self-check: not run');
    });

    it('writes the self-check verdict first, then every layer it checked, without a proxy\'s password', () => {
        const result: LoginSelfCheckResult = {
            providerId: 'netease',
            runtime: 'electron',
            startedAt: AT,
            durationMs: 1556,
            backend: { status: 'running', port: 52001, error: null, probe: { ok: true, httpStatus: 200, durationMs: 6, error: null } },
            proxy: { env: { HTTPS_PROXY: 'http://zhang:secret@10.0.0.2:8080' }, system: 'DIRECT' },
            hosts: [{
                host: 'interfacepc.music.163.com',
                dns: { addresses: [{ address: '198.18.6.189', family: 4 }], durationMs: 10, error: null, fakeIp: true },
                connections: [{ address: '198.18.6.189', family: 4, tcpMs: 9, tlsMs: 906, error: null, protocol: 'TLSv1.3' }],
                https: { httpStatus: 200, durationMs: 1543, remote: { address: '198.18.6.189', family: 4 }, error: null, clockSkewMs: -57627 },
            }],
            credentialStore: { encryptionAvailable: true, backend: null },
        };

        const lines = formatLoginSelfCheck({ status: 'done', result, verdict: { kind: 'network-ok', detail: null, proxy: 'fake-ip' } });
        expect(lines.slice(0, 4)).toEqual([
            'self-check: electron, 1556ms',
            '  verdict: network-ok; proxy: fake-ip',
            '  backend: running 127.0.0.1:52001; GET / → HTTP 200 in 6ms',
            '  credential store: encryption=yes',
        ]);
        // A proxy's address stays; the user name and password in it are a credential.
        expect(lines[4]).toBe('  proxy: env HTTPS_PROXY=http://***@10.0.0.2:8080; system DIRECT');
        expect(lines.slice(5)).toEqual([
            '  interfacepc.music.163.com',
            '    dns: 10ms → 198.18.6.189 (v4) [fake-ip]',
            '    v4 198.18.6.189: tcp 9ms, tls 906ms TLSv1.3',
            '    https: HTTP 200 in 1543ms via 198.18.6.189 (v4), clock skew -57.6s',
        ]);
        expect(formatLoginSelfCheck({ status: 'running' })).toEqual(['self-check: still running when the report was generated']);
        expect(formatLoginSelfCheck({ status: 'failed', message: 'IPC channel closed' })).toEqual(['self-check: failed (IPC channel closed)']);
        expect(formatLoginSelfCheck({ status: 'failed', message: SAID.path })).toEqual([`self-check: failed (${SAID.path})`]);
    });

    it('adds the case and its facts when the sign-in failed, and nothing when it did not', () => {
        const facts = loginFailureFacts({ step: 'check', inBrowser: false, scanned: true }, {
            detail: { case: 'retry-later', code: '800', message: 'uin 2873651094 is slowed down', upstreamCode: '50006', retryAfterMs: 31000, httpStatus: 200 },
            error: new Error("request to localhost:3300 failed, open 'C:\\Users\\Zhang San\\x.json'"),
        });
        const report = formatLoginDiagnosticReport({
            generatedAt: AT, appVersion: '1.2.3', userAgent: 'test-agent', providerId: 'qq', methodId: 'wechat', failure: 'check-error',
            loginFailure: { case: loginCaseOf(facts), facts, at: AT + 2000 },
            timeline: [], providerLines: [],
        }).split('\n');
        expect(report.slice(6, 10)).toEqual([
            'provider: qq (method wechat)',
            'failure: check-error',
            'case: retry-later (kind C) at 12:00:02.000',
            'facts: step=check inBrowser=false scanned=true code=800 message="uin 2873651094 is slowed down" httpStatus=200 upstreamCode=50006 retryAfterMs=31000',
        ]);
        // The thrown error's sentence is not a fact: it goes into the timeline.
        expect(report.join('\n')).not.toMatch(/localhost|Zhang/);

        const fine = formatLoginDiagnosticReport({
            generatedAt: AT, appVersion: null, userAgent: '', providerId: 'qq', methodId: null, failure: null, loginFailure: null, timeline: [], providerLines: [],
        });
        expect(fine).not.toMatch(/^case:|^facts:/m);
    });

    it('puts a short report into the issue link and falls back to a paste hint when it is too long', () => {
        const short = new URL(buildLoginIssueUrl({ providerId: 'netease', report: 'short report', pasteHint: 'paste here' }));
        expect(short.searchParams.get('title')).toBe('[QR login] netease login failed');
        expect(short.searchParams.get('body')).toBe('short report');

        const long = new URL(buildLoginIssueUrl({ providerId: 'netease', report: 'x'.repeat(10_000), pasteHint: 'paste here' }));
        expect(long.searchParams.get('body')).toBe('paste here');

        const empty = new URL(buildLoginIssueUrl({ providerId: 'netease', report: '', pasteHint: 'paste here' }));
        expect(empty.searchParams.get('body')).toBe('paste here');
    });
});
