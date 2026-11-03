import type { LoginDiagnosticLine } from '../../../types/onlineMusic';
import { diagnosticLine, formatDiagnosticClock } from './loginDiagnosticReport';

// src/services/onlineMusic/login/loginBackendDiagnostics.ts
// 诊断报告里内嵌后端快照（electron/loginBackendIpc.cjs 的 get-login-diagnostics）几个平台共用的几段：
// 应用环境与凭据保存、拉起后端的每一步、一次出站连接（electron/networkRecorder.cjs 记下的）。平台自己的部分
// 在各自的文件夹里排。报告原样贴进公开 issue，界面已告知用户其中包含哪些数据（版本、网卡与 IP、请求记录与
// 错误原文）；凭据的值从不进快照。

const MAX_RECENT_CONNECTIONS = 20;

const yesNo = (value: boolean | null | undefined): string => (value == null ? 'unknown' : value ? 'yes' : 'no');
const ms = (value: number | null | undefined): string => (value == null ? '-' : `${value}ms`);
const line = (text: string): LoginDiagnosticLine => diagnosticLine`${text}`;

export const formatValue = (value: unknown): string => {
    if (typeof value === 'string') return /\s/.test(value) || value === '' ? JSON.stringify(value) : value;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

/** 一串字段排成 key=value，用空格隔开；没有字段时是空串。 */
export const formatFields = (fields: Record<string, unknown> | null | undefined): string => Object.entries(fields ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
    .join(' ');

/** 本地后端听在哪里：127.0.0.1 加端口，没有端口时不印。 */
export const formatListen = (port: number | null | undefined): string => (port ? ` 127.0.0.1:${port}` : '');

const formatAddress = (address: string | null | undefined, family: 4 | 6 | null | undefined): string => (
    address ? `${address} (v${family ?? '?'})` : 'no connection'
);

/** 应用与系统、凭据保存（safeStorage）各一行；快照里没有这一段时只一行 unknown。 */
export const formatBackendApp = (app: ElectronAppEnvironment | null | undefined): LoginDiagnosticLine[] => {
    if (!app) return [line('app: unknown')];
    const store = app.credentialStore;
    return [
        line(`app: ${app.version} electron ${app.electron} (node ${app.node}, chrome ${app.chrome}) ${app.platform} ${app.arch}`),
        line(`os: ${app.osRelease}${app.osVersion ? ` (${app.osVersion})` : ''}, locale ${app.locale ?? '?'}, time zone ${app.timeZone ?? '?'}, uptime ${app.uptimeSec}s`),
        line(store?.error
            ? `credential store: error ${JSON.stringify(store.error)}`
            : `credential store: encryption=${yesNo(store?.encryptionAvailable)}${store?.backend ? ` backend=${store.backend}` : ''}`),
    ];
};

/** 每一轮拉起后端：结局与耗时，下面是每一步的结局、耗时、细节和错误原文；快照里没有这一段时只一行 unknown。 */
export const formatBackendStartup = (runs: ElectronBackendStartupRun[] | null | undefined): LoginDiagnosticLine[] => {
    if (!runs) return [line('startup runs: unknown')];
    if (runs.length === 0) return [line('startup runs: none')];
    return [
        line(`startup runs (${runs.length}, oldest first, UTC):`),
        ...runs.flatMap(run => [
            line(`  ${formatDiagnosticClock(run.startedAt)} ${run.outcome}${run.finishedAt != null ? ` (${run.finishedAt - run.startedAt}ms)` : ''}`),
            ...(run.steps ?? []).map(step => line([
                `    ${step.id} ${step.outcome} ${ms(step.durationMs)}`,
                formatFields(step.detail),
                step.error ? `error=${formatValue(step.error)}` : '',
            ].filter(Boolean).join(' '))),
        ]),
    ];
};

/**
 * 一次连接一行：去向 → 连上的地址、TCP / TLS 耗时 → 结局（总耗时）；Happy Eyeballs 换过地址时附上每次尝试。
 * withTarget 为 false 时不印去向（登录请求下面的那几行，去向由调用的地方印）。
 */
export const formatConnection = (connection: ElectronNetworkConnection, withTarget = true): LoginDiagnosticLine => {
    const target = withTarget ? `${connection.method ? `${connection.method} ` : ''}${connection.host}${connection.path ?? ''} ` : '';
    const timing = [
        `tcp=${ms(connection.connectMs)}`,
        connection.tlsMs != null ? `tls=${ms(connection.tlsMs)}` : '',
        connection.reusedSocket ? 'reused-socket' : '',
    ].filter(Boolean).join(' ');
    const outcome = connection.error
        ? `${connection.error.code ?? 'error'} at ${connection.error.phase}: ${connection.error.message}`
        : connection.dnsError
            ? `DNS ${connection.dnsError.code ?? 'error'}: ${connection.dnsError.message}`
            : connection.status != null ? `HTTP ${connection.status}` : connection.settled ?? 'pending';
    const attempts = (connection.attempts ?? []).length > 1
        ? `; attempts: ${connection.attempts.map(attempt => `${attempt.address} v${attempt.family ?? '?'} ${attempt.outcome}${attempt.error?.code ? ` ${attempt.error.code}` : ''}`).join(', ')}`
        : '';
    return line(`${target}→ ${formatAddress(connection.remote?.address, connection.remote?.family)} ${timing} → ${outcome} (${ms(connection.totalMs)})${attempts}`);
};

/** 最近的连接，最多 20 条，每条带时刻。 */
export const formatRecentConnections = (label: string, connections: ElectronNetworkConnection[]): LoginDiagnosticLine[] => {
    const all = connections ?? [];
    const recent = all.slice(-MAX_RECENT_CONNECTIONS);
    return [
        line(`${label} (${recent.length}${all.length > recent.length ? ` of ${all.length}` : ''}, oldest first, UTC):`),
        ...(recent.length > 0
            ? recent.map(connection => diagnosticLine`  ${connection.at != null ? `${formatDiagnosticClock(connection.at)} ` : ''}${formatConnection(connection)}`)
            : [line('  (none)')]),
    ];
};

/** 去主进程取快照；取不到时那句错误成为报告的一行（诊断自己不能再失败）。 */
export const readBackendSnapshot = async (
    providerId: ElectronLoginDiagnostics['providerId'],
): Promise<{ snapshot: ElectronLoginDiagnostics | null; failure: LoginDiagnosticLine | null }> => {
    const getSnapshot = typeof window === 'undefined' ? undefined : window.electron?.getLoginDiagnostics;
    if (!getSnapshot) return { snapshot: null, failure: null };
    try {
        return { snapshot: await getSnapshot(providerId), failure: null };
    } catch (error) {
        return { snapshot: null, failure: line(`backend diagnostics unavailable: ${error instanceof Error ? error.message : String(error)}`) };
    }
};
