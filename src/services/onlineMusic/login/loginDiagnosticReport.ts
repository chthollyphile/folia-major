import type { LoginDiagnosticLine, LoginFailureKind, LoginSelfCheckError, LoginSelfCheckHost, LoginSelfCheckResult, OnlineProviderId } from '../../../types/onlineMusic';
import type { LoginFailure } from '../../../types/loginFailure';

// src/services/onlineMusic/login/loginDiagnosticReport.ts
// 扫码登录诊断报告的格式。报告是给用户原样贴进 issue 的，所以用固定的英文字段、包在代码块里，
// 不随界面语言变化。几段：本轮登录的时间线、窗口显示的那一种情况、失败后的主动自检、provider 自己的行
// （provider 用这里的 diagnosticLine 一行一行写好再交进来）。界面已告知用户报告里有哪些数据
// （版本、网卡与 IP、代理设置、请求记录与错误原文）；凭据的值从不进报告。

// diagnosticLine 写出来的行，和每一行写成的那句话。报告只原样印这里记着的；别的东西整行转成字符串再印。
// 印的是这里记着的那句话，不读行上的 text：行写成之后改不了（行本身也冻住了）。
const builtLines = new WeakMap<object, string>();

type DiagnosticValue = string | number | boolean | null | undefined | LoginDiagnosticLine;

// 一样不知道是什么的东西的字样。没有原型的对象转不成字符串：那也不能让报告出不来。
const asText = (value: unknown): string => {
    try {
        return String(value);
    } catch {
        return Object.prototype.toString.call(value);
    }
};

// 一段文字放在一行里：里面的换行换成 /，一行还是一行。
const onOneLine = (text: string | undefined): string => (text ?? '').replace(/\s*\n\s*/g, ' / ');

// 放进一行里的一个值：数和是否原样印，没有值是一个短横；一段文字原样放进来（换行折成 /）；
// 另一行（diagnosticLine 写的一小段）原样接上。
const diagnosticValue = (value: DiagnosticValue): string => {
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value == null) return '-';
    if (typeof value === 'object') return builtLines.get(value) ?? onOneLine(asText(value));
    return onOneLine(value);
};

// 是不是当作模板的标签来叫的：模板里写死的那几段是一个冻住的、带着 raw 的数组。
const isTemplate = (fixed: unknown): fixed is TemplateStringsArray => (
    Array.isArray(fixed) && Object.isFrozen(fixed) && Array.isArray((fixed as { raw?: unknown }).raw)
);

/**
 * provider 写诊断报告里自己的一行，只有这一条路。模板里写死的字和放进去的值按顺序接起来；
 * 一段文字里的换行折成 /，报告的一行还是一行。当成普通的函数来叫的，几段字按顺序接成一句。
 */
export const diagnosticLine = (fixed: TemplateStringsArray, ...values: DiagnosticValue[]): LoginDiagnosticLine => {
    const text = isTemplate(fixed)
        ? fixed.reduce((text, part, index) => text + diagnosticValue(values[index - 1]) + part)
        : onOneLine([fixed].flat().map((part, index) => (index > 0 ? asText(values[index - 1]) : '') + asText(part)).join(''));
    const line = Object.freeze({ text });
    builtLines.set(line, text);
    return line as LoginDiagnosticLine;
};

// 报告里 provider 的一行：diagnosticLine 写的原样印，别的（mod 交来的一个字符串，或者随便什么）转成字符串再印。
const formatProviderLine = (line: unknown): string => (
    (typeof line === 'object' && line !== null ? builtLines.get(line) : undefined) ?? onOneLine(asText(line))
);

export type LoginTimelineEvent = {
    at: number;
    event: string;
    detail: Record<string, unknown>;
};

export const LOGIN_TIMELINE_LIMIT = 60;

// UTC 时刻，精确到毫秒。渲染进程时间线和主进程请求记录都用它，两边的行才能对着看。
export const formatDiagnosticClock = (at: number): string => new Date(at).toISOString().slice(11, 23);

const formatDetailValue = (value: unknown): string => {
    if (typeof value === 'string') return /\s/.test(value) || value === '' ? JSON.stringify(value) : value;
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return String(value);
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
};

const formatTimelineEvent = ({ at, event, detail }: LoginTimelineEvent): string => {
    const fields = Object.entries(detail)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}=${formatDetailValue(value)}`);
    return [`  ${formatDiagnosticClock(at)} ${event}`, ...fields].join(' ');
};

// 登录窗口显示的那一种情况：它的名字、类别、时刻，和事实（点名的情况已经在第一行，不再重复）。
const formatLoginFailure = ({ case: failed, facts, at }: LoginFailure): string[] => [
    `case: ${failed.id} (kind ${failed.kind}) at ${formatDiagnosticClock(at)}`,
    `facts: ${Object.entries(facts).filter(([key]) => key !== 'case').map(([key, value]) => `${key}=${formatDetailValue(value)}`).join(' ')}`,
];

/** 报告里的自检（结构与 core/account/account.contract 的 LibraryLoginSelfCheck 相同；这里只认结构，不依赖 core）。 */
export type LoginReportSelfCheck =
    | { status: 'running' }
    | { status: 'done'; result: LoginSelfCheckResult; verdict: { kind: string; detail: string | null; proxy: string | null } }
    | { status: 'failed'; message: string };

// 自检里从外面来的文字（错误原文、后端的错误、远端地址、代理设置）放在一行里印。
const said = (text: string | null | undefined): string => onOneLine(text ?? '');
// 代理地址里的用户名和密码（http://user:pass@host:port）是凭据，报告说过不带：换成 ***，主机和端口照印。
const withoutProxyPassword = (text: string): string => text.replace(/(\/\/)[^\s/@]+@/g, '$1***@');

const formatSelfCheckError = (error: LoginSelfCheckError): string => (
    `${error.code ?? 'error'}${error.phase ? ` at ${error.phase}` : ''}: ${said(error.message)}`
);

const formatSelfCheckHost = (host: LoginSelfCheckHost): string[] => {
    const dns = host.dns.error
        ? `dns: ${formatSelfCheckError(host.dns.error)} (${host.dns.durationMs}ms)`
        : `dns: ${host.dns.durationMs}ms → ${host.dns.addresses.map(item => `${item.address} (v${item.family})`).join(', ') || 'no address'}${host.dns.fakeIp ? ' [fake-ip]' : ''}`;
    const connections = host.connections.map(connection => (
        `v${connection.family} ${connection.address}: tcp ${connection.tcpMs ?? '-'}ms`
        + `${connection.tlsMs != null ? `, tls ${connection.tlsMs}ms${connection.protocol ? ` ${connection.protocol}` : ''}` : ''}`
        + `${connection.error ? ` → ${formatSelfCheckError(connection.error)}` : ''}`
    ));
    const https = host.https
        ? host.https.error
            ? `https: ${formatSelfCheckError(host.https.error)} (${host.https.durationMs}ms)`
            : `https: HTTP ${host.https.httpStatus ?? '?'} in ${host.https.durationMs}ms`
                + `${host.https.remote ? ` via ${host.https.remote.address} (v${host.https.remote.family})` : ''}`
                + `${host.https.clockSkewMs != null ? `, clock skew ${(host.https.clockSkewMs / 1000).toFixed(1)}s` : ''}`
        : '';
    return [`  ${host.host}`, ...[dns, ...connections, https].filter(Boolean).map(line => `    ${line}`)];
};

/** 自检段：结论在第一行，后面是本地后端、凭据保存、代理与每个上游域名的逐项结果。 */
export const formatLoginSelfCheck = (selfCheck: LoginReportSelfCheck | null): string[] => {
    if (!selfCheck) return ['self-check: not run'];
    if (selfCheck.status === 'running') return ['self-check: still running when the report was generated'];
    if (selfCheck.status === 'failed') return [`self-check: failed (${said(selfCheck.message)})`];
    const { result, verdict } = selfCheck;
    const backend = result.backend;
    const probe = backend?.probe;
    const lines = [
        `self-check: ${result.runtime}, ${result.durationMs}ms`,
        `  verdict: ${verdict.kind}${verdict.detail ? ` (${said(verdict.detail)})` : ''}${verdict.proxy ? `; proxy: ${verdict.proxy}` : ''}`,
    ];
    if (backend) {
        lines.push(`  backend: ${backend.status}${backend.url ? ` ${said(backend.url)}` : backend.port ? ` 127.0.0.1:${backend.port}` : ''}`
            + `${backend.error ? ` error=${JSON.stringify(said(backend.error))}` : ''}`
            + `${probe ? probe.ok ? `; GET / → HTTP ${probe.httpStatus ?? '?'} in ${probe.durationMs}ms` : `; GET / → ${probe.error ? formatSelfCheckError(probe.error) : 'failed'}` : ''}`);
    }
    if (result.credentialStore) {
        const store = result.credentialStore;
        lines.push(store.error
            ? `  credential store: error ${JSON.stringify(said(store.error))}`
            : `  credential store: encryption=${store.encryptionAvailable ? 'yes' : 'no'}${store.backend ? ` backend=${store.backend}` : ''}`);
    }
    if (result.proxy) {
        const env = Object.entries(result.proxy.env).map(([name, value]) => `${name}=${withoutProxyPassword(said(value))}`).join(' ');
        lines.push(`  proxy: env ${env || 'none'}; system ${result.proxy.system ? withoutProxyPassword(said(result.proxy.system)) : 'unknown'}`);
    }
    return [...lines, ...result.hosts.flatMap(formatSelfCheckHost)];
};

// 把一次扫码会话排成可以直接贴进 GitHub issue 的 Markdown 文本。
export const formatLoginDiagnosticReport = ({
    generatedAt,
    appVersion,
    userAgent,
    build = null,
    origin = null,
    providerId,
    methodId,
    failure,
    loginFailure,
    timeline,
    selfCheck = null,
    providerLines,
}: {
    generatedAt: number;
    appVersion: string | null;
    userAgent: string;
    /** 官方 / 非官方构建与来源仓库（utils/buildProvenance）；没有时不出这一行。 */
    build?: string | null;
    /** 网页版的站点 origin；桌面版没有。 */
    origin?: string | null;
    providerId: OnlineProviderId;
    methodId: string | null;
    failure: LoginFailureKind | null;
    // 登录窗口显示的那一种情况和它的事实；没有失败就不给。
    loginFailure?: LoginFailure | null;
    timeline: readonly LoginTimelineEvent[];
    selfCheck?: LoginReportSelfCheck | null;
    providerLines: readonly LoginDiagnosticLine[];
}): string => [
    '### Folia QR login diagnostics',
    '',
    '```text',
    `generated: ${new Date(generatedAt).toISOString()}`,
    `app: ${appVersion ?? 'unknown'}`,
    ...(build ? [`build: ${build}`] : []),
    ...(origin ? [`origin: ${origin}`] : []),
    `user agent: ${userAgent || 'unknown'}`,
    `provider: ${providerId}${methodId ? ` (method ${methodId})` : ''}`,
    `failure: ${failure ?? 'none'}`,
    ...(loginFailure ? formatLoginFailure(loginFailure) : []),
    `QR session timeline (${timeline.length}, UTC):`,
    ...(timeline.length > 0 ? timeline.map(formatTimelineEvent) : ['  (none)']),
    ...formatLoginSelfCheck(selfCheck),
    `${providerId} details:`,
    // provider 交来的不是一列（一个 mod 回了别的东西）就当它什么都没交。
    ...(Array.isArray(providerLines) && providerLines.length > 0 ? providerLines.map(line => `  ${formatProviderLine(line)}`) : ['  (none)']),
    '```',
].join('\n');

const FOLIA_NEW_ISSUE_URL = 'https://github.com/chthollyphile/folia-major/issues/new';
// GitHub 对过长的 new-issue 链接会直接报错；超过这个长度就不把报告塞进链接，改让用户粘贴剪贴板里的内容。
const MAX_ISSUE_URL_LENGTH = 7000;

// 生成预填好的 new-issue 链接：报告不长就直接放进正文，太长则只留粘贴提示。
export const buildLoginIssueUrl = ({
    providerId,
    report,
    pasteHint,
}: {
    providerId: OnlineProviderId;
    report: string;
    pasteHint: string;
}): string => {
    const title = `[QR login] ${providerId} login failed`;
    const build = (body: string) => `${FOLIA_NEW_ISSUE_URL}?${new URLSearchParams({ title, body }).toString()}`;
    // 报告为空说明生成或复制失败了，同样只留粘贴提示。
    const withReport = report ? build(report) : '';
    return withReport && withReport.length <= MAX_ISSUE_URL_LENGTH ? withReport : build(pasteHint);
};
