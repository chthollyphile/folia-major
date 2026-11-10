import type { LoginDiagnosticLine } from '../../../types/onlineMusic';
import { diagnosticLine, formatDiagnosticClock } from '../login/loginDiagnosticReport';
import { formatBackendApp, formatBackendStartup, formatFields, formatListen, formatRecentConnections, formatValue, readBackendSnapshot } from '../login/loginBackendDiagnostics';

// src/services/onlineMusic/qq/qqLoginDiagnostics.ts
// QQ 扫码登录诊断报告里的 provider 专属部分：渲染进程这边的会话状态，和桌面版主进程里内嵌 qq-music-api 的
// 快照（electron/qq/qqBackend.cjs：包内扫码服务的失败、qq-auth.* 日志事件、上游连接）。

type QqLoginSession = {
    hasSession: boolean;
    channels: readonly string[] | null;
    // 登录窗口此刻给的方式；只有一种时窗口不显示选择器。没给就不印这一行。
    shownMethods?: readonly string[];
    lastAccountCheck: LoginDiagnosticLine | null;
};

// 包内一次失败：时刻、类别、停在哪一步，下面是错误的调用栈（主进程只留了前几行）。
const formatFailure = (failure: ElectronQqLoginDiagnostics['failures'][number]): LoginDiagnosticLine[] => {
    const { stack, ...error } = (failure.error ?? {}) as Record<string, unknown> & { stack?: unknown };
    const fields = formatFields(error);
    return [
        diagnosticLine`  ${formatDiagnosticClock(failure.at)} ${failure.kind}${failure.stage ? diagnosticLine` stage=${failure.stage}` : ''}${failure.channel ? diagnosticLine` channel=${failure.channel}` : ''}${failure.sessionState ? diagnosticLine` state=${failure.sessionState}` : ''}${fields ? diagnosticLine` ${fields}` : ''}`,
        ...(Array.isArray(stack) ? stack.map(line => diagnosticLine`      ${String(line)}`) : []),
    ];
};

const formatAuthEvent = (event: ElectronQqLoginDiagnostics['authEvents'][number]): LoginDiagnosticLine => {
    const details = event.details && typeof event.details === 'object'
        ? formatFields(event.details as Record<string, unknown>)
        : event.details == null ? null : diagnosticLine`${String(event.details)}`;
    return diagnosticLine`  ${formatDiagnosticClock(event.at)} ${event.level} ${event.event}${details ? diagnosticLine` ${details}` : ''}`;
};

// 报告里 QQ 这一边的行：会话存没存下、后端声明的扫码通道、最近一次读账号的结论、窗口给的方式；桌面版在前面加上内嵌后端
// 的状态与拉起步骤，后面加上包内的失败、qq-auth 事件和上游连接。每一行都由 diagnosticLine 写。
export const formatQqLoginDiagnostics = (
    state: QqLoginSession,
    snapshot: ElectronQqLoginDiagnostics | null = null,
    // 去主进程取快照失败时的那一行（snapshot 这时为 null）。
    unavailable: LoginDiagnosticLine | null = null,
): LoginDiagnosticLine[] => {
    const lines = [
        diagnosticLine`session: backend session stored=${state.hasSession ? 'yes' : 'no'}`,
        diagnosticLine`login channels: ${state.channels ? state.channels.join(', ') : 'not declared by the backend'}`,
        diagnosticLine`last account check: ${state.lastAccountCheck ?? 'none'}`,
        ...(state.shownMethods ? [diagnosticLine`login methods shown: ${state.shownMethods.join(', ') || 'none'}${state.shownMethods.length === 1 ? ' (no picker)' : ''}`] : []),
    ];
    if (!snapshot) return [...(unavailable ? [unavailable] : []), ...lines];
    // 主进程与渲染进程不同版（开发时只热更了一边）也照样出报告：缺的列表按空的算，缺的一段印一行 unknown。
    const { backend, hooks, failures = [], authEvents = [] } = snapshot;
    return [
        diagnosticLine`runtime: electron (local API)`,
        ...formatBackendApp(snapshot.app),
        backend
            ? diagnosticLine`local api: ${backend.status}${formatListen(backend.port)}${backend.error ? ` error=${formatValue(backend.error)}` : ''}${backend.updatedAt ? ` (since ${formatDiagnosticClock(backend.updatedAt)})` : ''}`
            : diagnosticLine`local api: unknown`,
        diagnosticLine`qq-music-api: ${snapshot.version ?? 'unknown'}, hooks: ${hooks?.installed?.join(', ') || 'none'}${hooks?.error ? diagnosticLine` (error "${hooks?.error}")` : ''}`,
        ...formatBackendStartup(snapshot.startup),
        ...lines,
        diagnosticLine`backend login failures (${failures.length}, oldest first, UTC):`,
        ...(failures.length > 0 ? failures.flatMap(formatFailure) : [diagnosticLine`  (none)`]),
        diagnosticLine`auth events (${authEvents.length}, oldest first, UTC):`,
        ...(authEvents.length > 0 ? authEvents.map(formatAuthEvent) : [diagnosticLine`  (none)`]),
        ...formatRecentConnections('upstream connections', snapshot.connections),
    ];
};

// 收集 QQ 扫码登录的诊断行。Web 端没有主进程可问，只报会话状态。
export const collectQqLoginDiagnostics = async (state: QqLoginSession): Promise<LoginDiagnosticLine[]> => {
    const { snapshot, failure } = await readBackendSnapshot('qq');
    return formatQqLoginDiagnostics(state, snapshot?.providerId === 'qq' ? snapshot : null, failure);
};
