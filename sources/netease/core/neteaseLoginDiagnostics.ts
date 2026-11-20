import type { FoliumSourceDiagnosticLine } from '@folia/folium';
import { isNeteaseDesktop, neteaseEnv, readNeteaseAnonymousCookie, readNeteaseCookie } from './neteaseEnv';

// sources/netease/core/neteaseLoginDiagnostics.ts
// 网易扫码登录诊断报告里网易这一份（auth@1.getLoginDiagnostics）。真正有用的现场在 main 入口的工作线程里：上游会把
// 网易的真实返回码吞成 404，只有线程里的请求层记下了它（main/neteaseLoginDiagnostics.cjs）。快照经 rpc `diagnostics` →
// api.diagnostics.snapshot 取（宿主补上应用环境）。宿主只收 64 行、label 64 字、value 512 字，所以这里按「标签 + 一行值」写，
// 长的列表只留最近几条。网页版没有 main 入口可问，只报会话状态。

type Line = FoliumSourceDiagnosticLine;

// 列表各留最近几条：64 行要装下前后的几行。
const MAX_REQUESTS = 16;
const MAX_STARTUP_RUNS = 3;
const MAX_CONNECTIONS = 10;

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

// 快照里的一个字段印进一行：缺的印 ?。
const text = (value: unknown): string => {
    if (value == null) return '?';
    return typeof value === 'string' ? value : valueText(value);
};

const yesNo = (value: boolean | null | undefined): string => (value == null ? 'unknown' : value ? 'yes' : 'no');

const listOf = <T>(value: readonly T[] | null | undefined): readonly T[] => (Array.isArray(value) ? value as readonly T[] : []);

// 一份列表：一行总数，后面最近的几条各一行。
const section = <T>(label: string, items: readonly T[], max: number, lineOf: (item: T) => string): Line[] => {
    const recent = items.slice(-max);
    return [
        { label, value: `${items.length}${items.length > recent.length ? ` (last ${recent.length})` : ''}, oldest first, UTC` },
        ...recent.map(item => ({ label: `  ${label}`, value: lineOf(item) })),
    ];
};

// main 入口给的快照（main/neteaseBackend.cjs 的 getDiagnostics，宿主补 app）。经 rpc 来，什么都可能缺：main 入口与页面
// 不同版（开发时只热更了一边）也照样出报告，缺的列表按空的算，缺的一段印 unknown 或 ?。
interface NeteaseAppEnvironment {
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

interface NeteaseStartupRun {
    startedAt?: number;
    finishedAt?: number | null;
    outcome?: string;
    steps?: Array<{ id?: string; startedAt?: number; outcome?: string; durationMs?: number | null; detail?: unknown; error?: unknown }>;
}

interface NeteaseConnection {
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

interface NeteaseLoginRequest {
    at?: number;
    uri?: string;
    crypto?: string;
    outcome?: { settled?: string; status?: number | null; code?: number | string | null; message?: string | null } | null;
    durationMs?: number | null;
    ipHeader?: string;
    deviceIdTail?: string | null;
    hasMusicU?: boolean | null;
    hasMusicA?: boolean | null;
    connections?: NeteaseConnection[];
}

interface NeteaseIdentity {
    processStartedAt?: number;
    deviceId?: string | null;
    connectionResets?: number;
    rotations?: number;
    lastRotatedAt?: number | null;
    lastTokenRenewed?: boolean | null;
    pendingRotation?: boolean;
}

/** The snapshot as the host hands it (api.diagnostics.snapshot): the main entry's record with the host's part. */
export interface NeteaseBackendSnapshot {
    providerId?: string;
    capturedAt?: number;
    app?: NeteaseAppEnvironment | null;
    backend?: { status?: string; port?: number | null; error?: string | null; offline?: boolean; updatedAt?: number } | null;
    startup?: NeteaseStartupRun[];
    login?: {
        capturedAt?: number;
        startup?: { anonymousTokenAtLoad?: string } | null;
        network?: { interfaces?: Array<{ name?: string; addresses?: Array<{ address?: string; family?: number | string }> }>; error?: string } | null;
        requests?: NeteaseLoginRequest[];
    } | null;
    identity?: NeteaseIdentity | null;
    connections?: NeteaseConnection[];
}

export interface NeteaseLoginSession {
    hasLoginCookie: boolean;
    hasAnonymousCookie: boolean;
    // 最近一次读登录状态的结论（neteaseProvider.ts 记下的：哪个接口、回的码）；没读过时没有。
    lastAccountCheck?: string | null;
}

const appLines = (app: NeteaseAppEnvironment | null | undefined): Line[] => {
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

const startupLine = (run: NeteaseStartupRun): string => {
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

const connectionOutcome = (connection: NeteaseConnection): string => {
    if (connection.error) return `${connection.error.code ?? 'error'} at ${text(connection.error.phase)}: ${text(connection.error.message)}`;
    if (connection.dnsError) return `DNS ${connection.dnsError.code ?? 'error'}: ${text(connection.dnsError.message)}`;
    return connection.status != null ? `HTTP ${connection.status}` : connection.settled ?? 'pending';
};

const connectionLine = (connection: NeteaseConnection, withTarget = true): string => {
    const target = withTarget ? `${connection.method ? `${connection.method} ` : ''}${text(connection.host)}${connection.path ?? ''} → ` : '';
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
    return `${withTarget ? `${clock(connection.at)} ` : ''}${target}${remote}${timing} → ${connectionOutcome(connection)}${took}${attempts}`;
};

// 一次登录请求一行：结果、网易的码和原话、来源 IP 的做法、设备标识的尾巴、带没带登录凭据；后面是它打开的连接
// （连上了哪个地址、断在 TCP 还是 TLS）。
const requestLine = (request: NeteaseLoginRequest): string => {
    const outcome = request.outcome ?? {};
    const head = [
        `${clock(request.at)} ${text(request.uri)}`,
        text(outcome.settled),
        `status=${outcome.status ?? '-'}`,
        `code=${outcome.code ?? '-'}`,
        outcome.message ? `msg=${JSON.stringify(outcome.message)}` : '',
        typeof request.durationMs === 'number' ? `${request.durationMs}ms` : '',
        `ip-header=${text(request.ipHeader)}`,
        `device=…${request.deviceIdTail || '-'}`,
        `MUSIC_U=${yesNo(request.hasMusicU)}`,
        `MUSIC_A=${yesNo(request.hasMusicA)}`,
    ].filter(Boolean).join(' ');
    const connections = listOf(request.connections).map(connection => `${text(connection.host)} ${connectionLine(connection, false)}`);
    return connections.length > 0 ? `${head}; ↳ ${connections.join('; ↳ ')}` : head;
};

const interfacesLine = (network: NonNullable<NonNullable<NeteaseBackendSnapshot['login']>['network']>): Line => {
    if (network.error) return { label: 'network interfaces', value: `error ${JSON.stringify(network.error)}` };
    const interfaces = listOf(network.interfaces)
        .map(item => `${text(item.name)}: ${listOf(item.addresses).map(address => text(address.address)).join(', ')}`)
        .join('; ');
    return { label: 'network interfaces', value: interfaces || 'none' };
};

// 用户说「重启后好了」时，看进程启动时刻与轮换次数，才分得清是换了设备标识还是换了网络。
const identityLine = (identity: NeteaseIdentity): Line => {
    const last = identity.lastRotatedAt == null
        ? ''
        : ` (last ${clock(identity.lastRotatedAt)}, new anonymous token=${yesNo(identity.lastTokenRenewed)})`;
    return {
        label: 'identity',
        value: [
            `process started ${typeof identity.processStartedAt === 'number' ? new Date(identity.processStartedAt).toISOString() : '?'}`,
            `deviceId=${identity.deviceId ?? '-'}`,
            `qr connection resets=${text(identity.connectionResets)}`,
            `device rotations=${text(identity.rotations)}${last}`,
            `rotation pending=${yesNo(identity.pendingRotation)}`,
        ].join(', '),
    };
};

const sessionLines = (session: NeteaseLoginSession): Line[] => [
    { label: 'session', value: `login cookie=${yesNo(session.hasLoginCookie)}, anonymous cookie=${yesNo(session.hasAnonymousCookie)}` },
    ...(session.lastAccountCheck === undefined ? [] : [{ label: 'last account check', value: session.lastAccountCheck ?? 'none' }]),
];

/** 把 main 入口的快照与页面的会话状态排成报告行；纯函数，便于测试。`unavailable`：去取快照失败时的那句话。 */
export const formatNeteaseLoginDiagnostics = (
    snapshot: NeteaseBackendSnapshot | null,
    session: NeteaseLoginSession,
    unavailable: string | null = null,
): Line[] => {
    if (!snapshot || typeof snapshot !== 'object') {
        return [
            unavailable
                ? { label: 'backend diagnostics', value: `unavailable: ${unavailable}` }
                : { label: 'runtime', value: 'web (remote API, no main-process record)' },
            ...sessionLines(session),
        ];
    }
    const { backend, login, identity } = snapshot;
    const startup = Array.isArray(snapshot.startup) ? snapshot.startup : null;
    // login 为 null：上游包没加载起来（startup 里 load 那一步失败），没有登录请求与网卡的记录。
    const requests = listOf(login?.requests);
    // 同一轮扫码里 deviceId 变过是一个可疑点，连接被重置后的主动轮换也会换它，对照 identity 行区分。
    const deviceTails = new Set(requests.map(request => request.deviceIdTail).filter(Boolean));
    const lastRun = startup?.at(-1);
    const localApi = backend
        ? [
            text(backend.status),
            backend.port ? ` 127.0.0.1:${backend.port}` : '',
            backend.offline ? ' offline' : '',
            backend.error ? ` error=${valueText(backend.error)}` : '',
            backend.updatedAt ? ` (since ${clock(backend.updatedAt)})` : '',
        ].join('')
        : 'unknown';
    return [
        { label: 'runtime', value: 'electron (local API)' },
        ...appLines(snapshot.app),
        { label: 'local api', value: localApi },
        {
            label: 'startup',
            value: `anonymous token at load=${login?.startup?.anonymousTokenAtLoad ?? 'unknown'}, runs=${startup?.length ?? 'unknown'}, last run=${lastRun?.outcome ?? 'none'}`,
        },
        ...(startup ? section('startup runs', startup, MAX_STARTUP_RUNS, startupLine) : [{ label: 'startup runs', value: 'unknown' }]),
        ...(login ? [interfacesLine(login.network ?? { interfaces: [] })] : [{ label: 'upstream package', value: 'not loaded (see the load step above)' }]),
        ...(identity ? [identityLine(identity)] : []),
        ...sessionLines(session),
        { label: 'device ids seen in login requests', value: deviceTails.size },
        ...section('login requests', requests, MAX_REQUESTS, requestLine),
        // 不属于哪一次登录请求的连接，例如拉起时取 xeapi 公钥。
        ...section('other upstream connections', listOf(snapshot.connections), MAX_CONNECTIONS, connection => connectionLine(connection)),
    ];
};

/** 收集网易扫码登录的诊断行。去 main 入口取快照失败时那句错误成为报告的一行（诊断自己不能再失败）。 */
export const collectNeteaseLoginDiagnostics = async (lastAccountCheck: string | null = null): Promise<Line[]> => {
    const session: NeteaseLoginSession = {
        hasLoginCookie: Boolean(readNeteaseCookie()),
        hasAnonymousCookie: Boolean(readNeteaseAnonymousCookie()),
        lastAccountCheck,
    };
    if (!isNeteaseDesktop()) return formatNeteaseLoginDiagnostics(null, session);
    try {
        return formatNeteaseLoginDiagnostics(await neteaseEnv().call<NeteaseBackendSnapshot | null>('diagnostics'), session);
    } catch (error) {
        return formatNeteaseLoginDiagnostics(null, session, error instanceof Error ? error.message : String(error));
    }
};
