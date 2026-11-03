import type { LoginSelfCheckHost, LoginSelfCheckResult } from '../../../types/onlineMusic';
import type {
    LoginSelfCheckItem,
    LoginSelfCheckItemId,
    LoginSelfCheckProxyKind,
    LoginSelfCheckVerdict,
    LoginSelfCheckVerdictKind,
} from './account.contract';
import type { LibraryHomeMessage } from '../home/homeModel.contract';

// src/library/core/account/loginSelfCheckRules.ts
// 扫码登录自检的纯规则：从自检结果（主进程或网页版探测得到的结构化数据）推出一个结论，以及界面上逐项显示的检查结果。
// 结论按「离用户最近、最确定」的顺序取第一个命中的：本地后端 → 凭据保存 → DNS → 整个域名都连不上 → 只有 IPv6 不通 →
// HTTPS 失败 → 系统时间 → 都正常。代理只作为附加提示（TUN 模式的 fake-ip、系统代理、环境变量代理）。
// 这里只返回 i18n key 与参数，翻译在绑定 / UI。

/** 时钟偏差超过它才算问题：Date 头只到秒，几十秒的偏差对登录没有影响。 */
export const LOGIN_SELF_CHECK_CLOCK_SKEW_LIMIT_MS = 5 * 60_000;

const errorLabel = (error: { code: string | null; message: string } | null | undefined): string => (
    error ? error.code ?? error.message : 'error'
);

const connectionsOf = (result: LoginSelfCheckResult, family: 4 | 6) => result.hosts.flatMap(host => (
    host.connections.filter(connection => connection.family === family).map(connection => ({ host: host.host, connection }))
));

const resolveProxyKind = (result: LoginSelfCheckResult): LoginSelfCheckProxyKind | null => {
    if (result.hosts.some(host => host.dns.fakeIp)) return 'fake-ip';
    const system = result.proxy?.system?.trim();
    if (system && system.toUpperCase() !== 'DIRECT' && !system.startsWith('unavailable')) return 'system';
    const env = result.proxy?.env ?? {};
    if (env.HTTPS_PROXY || env.HTTP_PROXY || env.ALL_PROXY) return 'env';
    return null;
};

const backendProblem = (result: LoginSelfCheckResult): LoginSelfCheckVerdict['detail'] | undefined => {
    const { backend } = result;
    if (!backend) return undefined;
    if (backend.status !== 'running' && backend.status !== 'remote') return backend.error ?? backend.status;
    if (backend.probe && !backend.probe.ok) return backend.probe.error?.message ?? 'no response';
    return undefined;
};

const credentialStoreProblem = (result: LoginSelfCheckResult): string | null => {
    const store = result.credentialStore;
    if (!result.keepsSignInEncrypted || !store) return null;
    if (store.backend === 'basic_text') return 'basic_text';
    if (store.encryptionAvailable === false) return 'encryption unavailable';
    return null;
};

const isResetError = (error: { code: string | null; message: string } | null): boolean => Boolean(
    error && (error.code === 'ECONNRESET' || /ECONNRESET|socket hang up|disconnected before secure TLS/i.test(error.message)),
);

// 一个域名所有握手都失败：有 TLS 阶段被重置的就报 tls-reset，否则报连不上。
const unreachableHost = (host: LoginSelfCheckHost): LoginSelfCheckVerdict | null => {
    if (host.connections.length === 0 || host.connections.some(connection => !connection.error)) return null;
    const reset = host.connections.find(connection => connection.error?.phase === 'tls' && isResetError(connection.error));
    const failed = reset ?? host.connections[0];
    return {
        kind: reset ? 'tls-reset' : 'upstream-unreachable',
        detail: `${host.host} ${failed.address} (IPv${failed.family}): ${errorLabel(failed.error)}`,
        proxy: null,
    };
};

/** 从自检结果推出结论。 */
export const resolveLoginSelfCheckVerdict = (result: LoginSelfCheckResult): LoginSelfCheckVerdict => {
    const proxy = resolveProxyKind(result);
    const verdict = (kind: LoginSelfCheckVerdictKind, detail: string | null = null): LoginSelfCheckVerdict => ({ kind, detail, proxy });

    const backend = backendProblem(result);
    if (backend !== undefined) {
        return verdict(result.runtime === 'web' ? 'remote-unreachable' : 'backend-down', result.runtime === 'web'
            ? `${result.backend?.url ?? ''} ${backend ?? ''}`.trim()
            : backend);
    }

    const credentialStore = credentialStoreProblem(result);
    if (credentialStore) return verdict('credential-store', credentialStore);

    const dnsFailures = result.hosts.filter(host => host.dns.error);
    if (dnsFailures.length > 0) {
        return verdict('dns-failed', dnsFailures.map(host => `${host.host}: ${errorLabel(host.dns.error)}`).join(', '));
    }

    for (const host of result.hosts) {
        const unreachable = unreachableHost(host);
        if (unreachable) return { ...unreachable, proxy };
    }

    for (const host of result.hosts) {
        const v4 = host.connections.find(connection => connection.family === 4);
        const v6 = host.connections.find(connection => connection.family === 6);
        if (v4 && !v4.error && v6?.error) {
            return verdict('ipv6-failed', `${host.host} ${v6.address}: ${errorLabel(v6.error)}${v6.error.phase ? ` at ${v6.error.phase}` : ''}`);
        }
    }

    const httpsFailure = result.hosts.find(host => host.https?.error);
    if (httpsFailure) return verdict('https-failed', `${httpsFailure.host}: ${errorLabel(httpsFailure.https?.error)}`);

    const skewed = result.hosts.find(host => Math.abs(host.https?.clockSkewMs ?? 0) > LOGIN_SELF_CHECK_CLOCK_SKEW_LIMIT_MS);
    // 界面只说差了多少分钟；方向（快还是慢）在报告里的原始值上看。
    if (skewed) return verdict('clock-skew', String(Math.abs(Math.round((skewed.https?.clockSkewMs ?? 0) / 60_000))));

    return verdict('network-ok');
};

const familyItem = (result: LoginSelfCheckResult, family: 4 | 6): LoginSelfCheckItem => {
    const id = family === 4 ? 'ipv4' : 'ipv6';
    const connections = connectionsOf(result, family);
    if (connections.length === 0) return { id, state: 'skip', detail: null };
    const failed = connections.find(({ connection }) => connection.error);
    return failed
        ? { id, state: 'fail', detail: `${failed.host}: ${errorLabel(failed.connection.error)}${failed.connection.error?.phase ? ` (${failed.connection.error.phase})` : ''}` }
        : { id, state: 'ok', detail: null };
};

/** 界面上逐项显示的检查结果；网页版只有一项（远端 API）。 */
export const summarizeLoginSelfCheck = (result: LoginSelfCheckResult): LoginSelfCheckItem[] => {
    const backend = backendProblem(result);
    const items: LoginSelfCheckItem[] = [{
        id: 'backend',
        state: result.backend ? (backend === undefined ? 'ok' : 'fail') : 'skip',
        detail: backend ?? null,
    }];
    if (result.runtime === 'web') return items;

    const credentialStore = credentialStoreProblem(result);
    if (result.keepsSignInEncrypted) items.push({ id: 'credential-store', state: credentialStore ? 'fail' : 'ok', detail: credentialStore });

    const dnsFailure = result.hosts.find(host => host.dns.error);
    items.push(result.hosts.length === 0
        ? { id: 'dns', state: 'skip', detail: null }
        : { id: 'dns', state: dnsFailure ? 'fail' : 'ok', detail: dnsFailure ? `${dnsFailure.host}: ${errorLabel(dnsFailure.dns.error)}` : null });
    items.push(familyItem(result, 4), familyItem(result, 6));

    const httpsHosts = result.hosts.filter(host => host.https);
    const httpsFailure = httpsHosts.find(host => host.https?.error);
    items.push(httpsHosts.length === 0
        ? { id: 'https', state: 'skip', detail: null }
        : { id: 'https', state: httpsFailure ? 'fail' : 'ok', detail: httpsFailure ? `${httpsFailure.host}: ${errorLabel(httpsFailure.https?.error)}` : null });

    // 系统代理只是一条信息：内嵌后端的请求不走它（Node 不读系统代理）；fake-ip 接管与环境变量代理才会影响登录请求。
    const proxy = resolveProxyKind(result);
    items.push({
        id: 'proxy',
        state: proxy === 'fake-ip' || proxy === 'env' ? 'warn' : 'ok',
        detail: proxy === 'system' ? result.proxy?.system ?? null : proxy,
    });

    const skews = result.hosts.map(host => host.https?.clockSkewMs).filter((value): value is number => typeof value === 'number');
    const worst = skews.reduce((max, value) => (Math.abs(value) > Math.abs(max) ? value : max), 0);
    items.push(skews.length === 0
        ? { id: 'clock', state: 'skip', detail: null }
        : Math.abs(worst) > LOGIN_SELF_CHECK_CLOCK_SKEW_LIMIT_MS
            ? { id: 'clock', state: 'warn', detail: `${Math.abs(Math.round(worst / 60_000))} min` }
            : { id: 'clock', state: 'ok', detail: null });
    return items;
};

const VERDICT_MESSAGE_KEYS: Readonly<Record<LoginSelfCheckVerdictKind, string>> = {
    'backend-down': 'home.qrSelfCheckBackendDown',
    'remote-unreachable': 'home.qrSelfCheckRemoteUnreachable',
    'credential-store': 'home.qrSelfCheckCredentialStore',
    'dns-failed': 'home.qrSelfCheckDnsFailed',
    'tls-reset': 'home.qrSelfCheckTlsReset',
    'upstream-unreachable': 'home.qrSelfCheckUnreachable',
    'ipv6-failed': 'home.qrSelfCheckIpv6Failed',
    'https-failed': 'home.qrSelfCheckHttpsFailed',
    'clock-skew': 'home.qrSelfCheckClockSkew',
    'network-ok': 'home.qrSelfCheckNetworkOk',
};

const PROXY_MESSAGE_KEYS: Readonly<Partial<Record<LoginSelfCheckProxyKind, string>>> = {
    'fake-ip': 'home.qrSelfCheckProxyFakeIp',
    env: 'home.qrSelfCheckProxyEnv',
};

const ITEM_LABEL_KEYS: Readonly<Record<LoginSelfCheckItemId, string>> = {
    backend: 'home.qrSelfCheckItemBackend',
    'credential-store': 'home.qrSelfCheckItemCredentialStore',
    dns: 'home.qrSelfCheckItemDns',
    ipv4: 'home.qrSelfCheckItemIpv4',
    ipv6: 'home.qrSelfCheckItemIpv6',
    https: 'home.qrSelfCheckItemHttps',
    proxy: 'home.qrSelfCheckItemProxy',
    clock: 'home.qrSelfCheckItemClock',
};

/** 结论的文案（i18n key 与参数）。 */
export const resolveLoginSelfCheckVerdictMessage = (
    verdict: LoginSelfCheckVerdict,
    providerLabel: string,
): LibraryHomeMessage => ({
    key: VERDICT_MESSAGE_KEYS[verdict.kind],
    values: { provider: providerLabel, detail: verdict.detail ?? '' },
});

/** 代理提示的文案：只有会影响登录请求的代理（fake-ip 接管、环境变量代理）才提示；其余为 null。 */
export const resolveLoginSelfCheckProxyMessage = (
    verdict: LoginSelfCheckVerdict,
    providerLabel: string,
): LibraryHomeMessage | null => {
    const key = verdict.proxy ? PROXY_MESSAGE_KEYS[verdict.proxy] : undefined;
    return key ? { key, values: { provider: providerLabel } } : null;
};

/** 逐项结果的标签；网页版的「后端」是远端 API。 */
export const resolveLoginSelfCheckItemLabel = (id: LoginSelfCheckItemId, runtime: LoginSelfCheckResult['runtime']): LibraryHomeMessage => ({
    key: id === 'backend' && runtime === 'web' ? 'home.qrSelfCheckItemRemote' : ITEM_LABEL_KEYS[id],
});

/** 自检还在跑、或自检本身出错时的一行文案。 */
export const LOGIN_SELF_CHECK_COPY: Readonly<{ title: LibraryHomeMessage; running: LibraryHomeMessage; failedKey: string }> = {
    title: { key: 'home.qrSelfCheckTitle' },
    running: { key: 'home.qrSelfCheckRunning' },
    failedKey: 'home.qrSelfCheckFailed',
};
