import type { FoliumSourceDiagnosticLine } from '@folia/folium';
import { isQqDesktop, qqEnv } from './qqEnv';

// sources/qq/core/qqLoginDiagnostics.ts
// QQ 扫码登录诊断报告里 QQ 这一份（auth@1.getLoginDiagnostics）：页面这边的会话状态，和桌面版 main 入口里内嵌
// qq-music-api 的快照（main/qqBackend.cjs 的 getDiagnostics，经 rpc `diagnostics` → api.diagnostics.snapshot：包内扫码
// 服务的失败、qq-auth.* 日志事件、拉起的每一步，宿主补上应用环境和上游连接）。宿主只收 64 行、label 64 字、
// value 512 字，所以这里按「标签 + 一行值」写，长的列表只留最近几条。Web 端没有 main 入口可问，只报会话状态。

type Line = FoliumSourceDiagnosticLine;

export interface QqLoginSession {
    hasSession: boolean;
    channels: readonly string[] | null;
    // 登录窗口此刻给的方式；只有一种时窗口不显示选择器。没给就不印这一行。
    shownMethods?: readonly string[];
    lastAccountCheck: string | null;
}

// 列表各留最近几条：64 行要装下前后的几行。
const MAX_FAILURES = 8;
const MAX_AUTH_EVENTS = 12;
const MAX_STARTUP_RUNS = 3;
const MAX_CONNECTIONS = 12;

const clock = (at: unknown): string => (typeof at === 'number' && Number.isFinite(at) ? new Date(at).toISOString().slice(11, 23) : '--');

const valueText = (value: unknown): string => {
    if (typeof value === 'string') return /\s/.test(value) || value === '' ? JSON.stringify(value) : value;
    try {
        // JSON.stringify answers undefined for undefined, a function or a symbol (its type says string).
        return JSON.stringify(value) || String(value);
    } catch {
        return String(value);
    }
};

const fieldsText = (fields: unknown): string => (fields && typeof fields === 'object'
    ? Object.entries(fields as Record<string, unknown>)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${valueText(value)}`)
        .join(' ')
    : fields == null ? '' : typeof fields === 'string' ? fields : valueText(fields));

// main 入口给的快照（main/qqBackend.cjs 的 getDiagnostics，宿主补 app 与 connections）。经 rpc 来，什么都可能缺：
// main 入口与页面不同版（开发时只热更了一边）也照样出报告，缺的列表按空的算，缺的一段印 unknown 或 ?。
interface QqAppEnvironment {
    version?: string;
    electron?: string;
    node?: string;
    chrome?: string;
    platform?: string;
    arch?: string;
    osRelease?: string;
    osVersion?: string | null;
    locale?: string | null;
    timeZone?: string | null;
    uptimeSec?: number;
    credentialStore?: { encryptionAvailable?: boolean; backend?: string | null; error?: string } | null;
}

interface QqStartupRun {
    startedAt?: number;
    finishedAt?: number | null;
    outcome?: string;
    steps?: Array<{ id?: string; outcome?: string; durationMs?: number | null; detail?: unknown; error?: unknown }>;
}

interface QqBackendFailure {
    at?: number;
    kind?: string;
    stage?: string | null;
    channel?: string | null;
    sessionState?: string | null;
    error?: Record<string, unknown> | null;
}

interface QqAuthEvent {
    at?: number;
    level?: string;
    event?: string;
    details?: unknown;
}

interface QqConnection {
    at?: number;
    method?: string;
    host?: string;
    path?: string;
    remote?: { address?: string | null; family?: number | null } | null;
    error?: { code?: string | null; phase?: string; message?: string } | null;
    dnsError?: { code?: string | null; message?: string } | null;
    status?: number | null;
    settled?: string;
    connectMs?: number | null;
    tlsMs?: number | null;
    totalMs?: number | null;
    attempts?: Array<{ address?: string; family?: number | null; outcome?: string; error?: { code?: string | null } | null }>;
}

export interface QqBackendSnapshot {
    app?: QqAppEnvironment | null;
    backend?: { status?: string; port?: number | null; error?: string | null; updatedAt?: number } | null;
    version?: string | null;
    hooks?: { installed?: string[]; error?: string | null } | null;
    startup?: QqStartupRun[];
    failures?: QqBackendFailure[];
    authEvents?: QqAuthEvent[];
    connections?: QqConnection[];
}

const listOf = <T>(value: readonly T[] | null | undefined): readonly T[] => (Array.isArray(value) ? value as readonly T[] : []);

// 快照里的一个字段印进一行：缺的印 ?。
const text = (value: unknown): string => {
    if (value == null) return '?';
    return typeof value === 'string' ? value : valueText(value);
};

// 一份列表：一行总数，后面最近的几条各一行。
const section = <T>(label: string, items: readonly T[], max: number, lineOf: (item: T) => string): Line[] => {
    const recent = items.slice(-max);
    return [
        { label, value: `${items.length}${items.length > recent.length ? ` (last ${recent.length})` : ''}, oldest first, UTC` },
        ...recent.map(item => ({ label: `  ${label}`, value: lineOf(item) })),
    ];
};

const appLines = (app: QqAppEnvironment | null | undefined): Line[] => {
    if (!app || typeof app !== 'object') return [{ label: 'app', value: 'unknown' }];
    const store = app.credentialStore;
    const encryption = store?.encryptionAvailable == null ? 'unknown' : store.encryptionAvailable ? 'yes' : 'no';
    return [
        { label: 'app', value: `${text(app.version)} electron ${text(app.electron)} (node ${text(app.node)}, chrome ${text(app.chrome)}) ${text(app.platform)} ${text(app.arch)}` },
        { label: 'os', value: `${text(app.osRelease)}${app.osVersion ? ` (${app.osVersion})` : ''}, locale ${text(app.locale)}, time zone ${text(app.timeZone)}, uptime ${text(app.uptimeSec)}s` },
        {
            label: 'credential store',
            value: store?.error ? `error ${JSON.stringify(store.error)}` : `encryption=${encryption}${store?.backend ? ` backend=${store.backend}` : ''}`,
        },
    ];
};

const startupLine = (run: QqStartupRun): string => {
    const took = typeof run.finishedAt === 'number' && typeof run.startedAt === 'number' ? ` (${run.finishedAt - run.startedAt}ms)` : '';
    return [
        `${clock(run.startedAt)} ${text(run.outcome)}${took}:`,
        ...listOf(run.steps).map(step => [
            `${text(step.id)} ${text(step.outcome)}${typeof step.durationMs === 'number' ? ` ${step.durationMs}ms` : ''}`,
            fieldsText(step.detail),
            step.error ? `error=${valueText(step.error)}` : '',
        ].filter(Boolean).join(' ')),
    ].join('; ');
};

// 包内一次失败：时刻、类别、停在哪一步；调用栈只留第一行。
const failureLine = (failure: QqBackendFailure): string => {
    const { stack, ...error } = failure.error ?? {};
    const top = Array.isArray(stack) && stack.length > 0 ? ` at ${String(stack[0]).trim().replace(/^at\s+/, '')}` : '';
    return [
        `${clock(failure.at)} ${text(failure.kind)}`,
        failure.stage ? `stage=${failure.stage}` : '',
        failure.channel ? `channel=${failure.channel}` : '',
        failure.sessionState ? `state=${failure.sessionState}` : '',
        fieldsText(error),
    ].filter(Boolean).join(' ') + top;
};

const authEventLine = (event: QqAuthEvent): string => {
    const details = fieldsText(event.details);
    return `${clock(event.at)} ${text(event.level)} ${text(event.event)}${details ? ` ${details}` : ''}`;
};

const connectionOutcome = (connection: QqConnection): string => {
    if (connection.error) return `${connection.error.code ?? 'error'} at ${text(connection.error.phase)}: ${text(connection.error.message)}`;
    if (connection.dnsError) return `DNS ${connection.dnsError.code ?? 'error'}: ${text(connection.dnsError.message)}`;
    return connection.status != null ? `HTTP ${connection.status}` : connection.settled ?? 'pending';
};

const connectionLine = (connection: QqConnection): string => {
    const target = `${connection.method ? `${connection.method} ` : ''}${text(connection.host)}${connection.path ?? ''}`;
    const remote = connection.remote?.address ? `${connection.remote.address} (v${text(connection.remote.family)})` : 'no connection';
    const timing = [
        typeof connection.connectMs === 'number' ? ` tcp=${connection.connectMs}ms` : '',
        typeof connection.tlsMs === 'number' ? ` tls=${connection.tlsMs}ms` : '',
    ].join('');
    const took = typeof connection.totalMs === 'number' ? ` (${connection.totalMs}ms)` : '';
    // 连了几个地址才连上（IPv6 不通再试 IPv4 之类）才印。
    const attempts = listOf(connection.attempts).length > 1
        ? `; attempts: ${listOf(connection.attempts).map(attempt => (
            `${text(attempt.address)} v${attempt.family ?? '?'} ${text(attempt.outcome)}${attempt.error?.code ? ` ${attempt.error.code}` : ''}`
        )).join(', ')}`
        : '';
    return `${clock(connection.at)} ${target} → ${remote}${timing} → ${connectionOutcome(connection)}${took}${attempts}`;
};

const sessionLines = (state: QqLoginSession): Line[] => [
    { label: 'session', value: `backend session stored=${state.hasSession ? 'yes' : 'no'}` },
    { label: 'login channels', value: state.channels ? state.channels.join(', ') : 'not declared by the backend' },
    { label: 'last account check', value: state.lastAccountCheck ?? 'none' },
    ...(state.shownMethods
        ? [{ label: 'login methods shown', value: `${state.shownMethods.join(', ') || 'none'}${state.shownMethods.length === 1 ? ' (no picker)' : ''}` }]
        : []),
];

/** 报告里 QQ 这一份：会话的几行；有快照时前面是内嵌后端的状态与拉起步骤，后面是包内的失败、qq-auth 事件和上游连接。 */
export const formatQqLoginDiagnostics = (
    state: QqLoginSession,
    snapshot: QqBackendSnapshot | null = null,
    unavailable: string | null = null,
): Line[] => {
    if (!snapshot || typeof snapshot !== 'object') {
        return [...(unavailable ? [{ label: 'backend diagnostics', value: `unavailable: ${unavailable}` }] : []), ...sessionLines(state)];
    }
    const { backend, hooks } = snapshot;
    const localApi = backend
        ? [
            text(backend.status),
            backend.port ? ` 127.0.0.1:${backend.port}` : '',
            backend.error ? ` error=${valueText(backend.error)}` : '',
            backend.updatedAt ? ` (since ${clock(backend.updatedAt)})` : '',
        ].join('')
        : 'unknown';
    return [
        { label: 'runtime', value: 'electron (local API)' },
        ...appLines(snapshot.app),
        { label: 'local api', value: localApi },
        {
            label: 'qq-music-api',
            value: `${snapshot.version ?? 'unknown'}, hooks: ${listOf(hooks?.installed).join(', ') || 'none'}${hooks?.error ? ` (error "${hooks.error}")` : ''}`,
        },
        ...(Array.isArray(snapshot.startup)
            ? section('startup runs', snapshot.startup, MAX_STARTUP_RUNS, startupLine)
            : [{ label: 'startup runs', value: 'unknown' }]),
        ...sessionLines(state),
        ...section('backend login failures', listOf(snapshot.failures), MAX_FAILURES, failureLine),
        ...section('auth events', listOf(snapshot.authEvents), MAX_AUTH_EVENTS, authEventLine),
        ...section('upstream connections', listOf(snapshot.connections), MAX_CONNECTIONS, connectionLine),
    ];
};

/** 收集 QQ 扫码登录的诊断行。去 main 入口取快照失败时那句错误成为报告的一行（诊断自己不能再失败）。 */
export const collectQqLoginDiagnostics = async (state: QqLoginSession): Promise<Line[]> => {
    if (!isQqDesktop()) return formatQqLoginDiagnostics(state);
    try {
        return formatQqLoginDiagnostics(state, await qqEnv().call<QqBackendSnapshot | null>('diagnostics'));
    } catch (error) {
        return formatQqLoginDiagnostics(state, null, error instanceof Error ? error.message : String(error));
    }
};
