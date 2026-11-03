import type { LoginDiagnosticLine } from '../../../types/onlineMusic';
import { diagnosticLine, formatDiagnosticClock } from '../login/loginDiagnosticReport';
import { formatBackendApp, formatBackendStartup, formatConnection, formatListen, formatRecentConnections, formatValue, readBackendSnapshot } from '../login/loginBackendDiagnostics';
import { readProviderSessionValue } from '../providerStorage';

// src/services/onlineMusic/netease/neteaseLoginDiagnostics.ts
// 网易扫码登录诊断报告里的 provider 专属部分。真正有用的现场在 Electron 主进程：上游会把网易的
// 真实返回码吞成 404，只有主进程的请求层记下了它（electron/netease/neteaseLoginDiagnostics.cjs）。

type NeteaseLoginSession = {
    hasLoginCookie: boolean;
    hasAnonymousCookie: boolean;
    // 最近一次读登录状态的结论（neteaseProvider.ts 记下的：哪个接口、回的码）；没读过时没有。
    lastAccountCheck?: LoginDiagnosticLine | null;
};

const yesNo = (value: boolean | undefined): string => (value === undefined ? 'unknown' : value ? 'yes' : 'no');
const line = (text: string): LoginDiagnosticLine => diagnosticLine`${text}`;

const formatRequest = (request: ElectronNeteaseLoginRequestRecord): LoginDiagnosticLine[] => {
    const { outcome } = request;
    const head = [
        `  ${formatDiagnosticClock(request.at)} ${request.uri}`,
        outcome.settled,
        `status=${outcome.status ?? '-'}`,
        `code=${outcome.code ?? '-'}`,
        outcome.message ? `msg=${JSON.stringify(outcome.message)}` : '',
        request.durationMs === null ? '' : `${request.durationMs}ms`,
        `ip-header=${request.ipHeader}`,
        `device=…${request.deviceIdTail || '-'}`,
        `MUSIC_U=${yesNo(request.hasMusicU)}`,
        `MUSIC_A=${yesNo(request.hasMusicA)}`,
    ].filter(Boolean).join(' ');
    // 下面几行是这次请求打开的连接：连上了哪个地址、断在 TCP 还是 TLS。
    return [line(head), ...(request.connections ?? []).map(connection => diagnosticLine`      ↳ ${connection.host} ${formatConnection(connection, false)}`)];
};

const formatInterfaces = (network: { interfaces: Array<{ name: string; addresses: Array<{ address: string }> }>; error?: string }): LoginDiagnosticLine => {
    if (network.error) return line(`network interfaces: error ${JSON.stringify(network.error)}`);
    const interfaces = network.interfaces
        .map(item => `${item.name}: ${item.addresses.map(address => address.address).join(', ')}`)
        .join('; ');
    return line(`network interfaces: ${interfaces || 'none'}`);
};

// 用户说「重启后好了」时，看进程启动时刻与轮换次数，才分得清是换了设备标识还是换了网络。
const formatIdentity = (identity: NonNullable<ElectronNeteaseLoginDiagnostics['identity']>): LoginDiagnosticLine => {
    const last = identity.lastRotatedAt === null
        ? ''
        : ` (last ${formatDiagnosticClock(identity.lastRotatedAt)}, new anonymous token=${identity.lastTokenRenewed === null ? 'unknown' : yesNo(identity.lastTokenRenewed)})`;
    return line([
        `identity: process started ${new Date(identity.processStartedAt).toISOString()}`,
        `deviceId=${identity.deviceId ?? '-'}`,
        `qr connection resets=${identity.connectionResets}`,
        `device rotations=${identity.rotations}${last}`,
        `rotation pending=${yesNo(identity.pendingRotation)}`,
    ].join(', '));
};

// 把主进程快照和渲染进程会话状态排成报告行；纯函数，便于测试。
export const formatNeteaseLoginDiagnostics = (
    snapshot: ElectronNeteaseLoginDiagnostics | null,
    session: NeteaseLoginSession,
    // 去主进程取快照失败时的那一行（snapshot 这时为 null）。
    unavailable: LoginDiagnosticLine | null = null,
): LoginDiagnosticLine[] => {
    const lines = [
        line(`session: login cookie=${yesNo(session.hasLoginCookie)}, anonymous cookie=${yesNo(session.hasAnonymousCookie)}`),
        ...(session.lastAccountCheck === undefined ? [] : [diagnosticLine`last account check: ${session.lastAccountCheck ?? 'none'}`]),
    ];
    if (!snapshot) {
        return [unavailable ?? line('runtime: web (remote API, no main-process record)'), ...lines];
    }

    const { app, backend, startup, login, identity } = snapshot;
    // login 为 null：上游包没加载起来（startup 里 load 那一步失败），没有登录请求与网卡的记录。
    const requests = login?.requests ?? [];
    // 同一轮扫码里 deviceId 变过是一个可疑点（渲染进程注册匿名身份会改掉主进程的全局 deviceId），
    // 连接被重置后的主动轮换也会换它，对照 identity 行区分。
    const deviceTails = new Set(requests.map(request => request.deviceIdTail).filter(Boolean));
    // 主进程与渲染进程不同版（开发时只热更了一边）时缺的一段印一行 unknown，报告照出。
    const lastRun = startup?.at(-1);
    return [
        line('runtime: electron (local API)'),
        ...formatBackendApp(app),
        backend
            ? line(`local api: ${backend.status}${formatListen(backend.port)}${backend.offline ? ' offline' : ''}${backend.error ? ` error=${formatValue(backend.error)}` : ''}`
                + `${backend.updatedAt ? ` (since ${formatDiagnosticClock(backend.updatedAt)})` : ''}`)
            : line('local api: unknown'),
        line(`startup: anonymous token at load=${login?.startup?.anonymousTokenAtLoad ?? 'unknown'}, runs=${startup?.length ?? 'unknown'}, last run=${lastRun?.outcome ?? 'none'}`),
        ...formatBackendStartup(startup),
        ...(login ? [formatInterfaces(login.network ?? { interfaces: [] })] : [line('upstream package: not loaded (see the load step above)')]),
        ...(identity ? [formatIdentity(identity)] : []),
        ...lines,
        line(`device ids seen in login requests: ${deviceTails.size}`),
        line(`login requests (${requests.length}, oldest first, UTC):`),
        ...(requests.length > 0 ? requests.flatMap(formatRequest) : [line('  (none)')]),
        // 不属于哪一次登录请求的连接，例如拉起时取 xeapi 公钥。
        ...formatRecentConnections('other upstream connections', snapshot.connections),
    ];
};

// 收集网易扫码登录的诊断行。Web 端没有主进程可问，只报会话状态。`lastAccountCheck`：最近一次读登录状态的结论。
export const collectNeteaseLoginDiagnostics = async (lastAccountCheck: LoginDiagnosticLine | null = null): Promise<LoginDiagnosticLine[]> => {
    const session = {
        hasLoginCookie: Boolean(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])),
        hasAnonymousCookie: Boolean(readProviderSessionValue('netease', 'anonymous_cookie', ['netease_anonymous_cookie'])),
        lastAccountCheck,
    };
    const { snapshot, failure } = await readBackendSnapshot('netease');
    return formatNeteaseLoginDiagnostics(snapshot?.providerId === 'netease' ? snapshot : null, session, failure);
};
