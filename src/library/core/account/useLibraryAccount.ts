import { useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { OnlineProviderId, ProviderAccountSummary } from '../../../types/onlineMusic';
import type {
    LibraryAccountController,
    LibraryAccountSnapshot,
    LibraryLoginSessionSnapshot,
    LibraryProviderSwitchRequest,
    LoginSelfCheckItem,
} from './account.contract';
import {
    resolveLoginReportRoute,
    resolveProviderSwitchCopy,
    type LibraryLoginReportEnvironment,
    type LibraryLoginReportRoute,
} from './accountRules';
import { translateHomeMessage } from '../home/homeSources';
import { getBuildKind } from '../../../utils/buildProvenance';
import {
    LOGIN_SELF_CHECK_COPY,
    resolveLoginSelfCheckItemLabel,
    resolveLoginSelfCheckProxyMessage,
    resolveLoginSelfCheckVerdictMessage,
    summarizeLoginSelfCheck,
} from './loginSelfCheckRules';

// src/library/core/account/useLibraryAccount.ts
// 在线账户 controller 的 React 绑定：useSyncExternalStore 订阅 controller 快照，把切换确认与失败后的自检翻译好
// 交给 suite 与登录窗口。细粒度 selector 只订阅快照里的一块（controller 保证各块在未变时保持身份），
// 登录窗口不会因为账户列表刷新而重渲染。controller 由宿主创建（A4），这里不创建、不 dispose。

/** 订阅快照里的一块；selector 必须返回快照里已有的引用（或原始值），不能每次新建对象。 */
export const useLibraryAccountSelector = <T,>(
    controller: LibraryAccountController,
    selector: (snapshot: LibraryAccountSnapshot) => T,
): T => useSyncExternalStore(
    controller.subscribe,
    () => selector(controller.getSnapshot()),
    () => selector(controller.getSnapshot()),
);

const selectLogin = (snapshot: LibraryAccountSnapshot) => snapshot.login;
const selectPendingSwitch = (snapshot: LibraryAccountSnapshot) => snapshot.pendingSwitch;
const selectProviders = (snapshot: LibraryAccountSnapshot) => snapshot.providers;
const selectActiveProviderId = (snapshot: LibraryAccountSnapshot) => snapshot.activeProviderId;
const selectSnapshot = (snapshot: LibraryAccountSnapshot) => snapshot;

/** 已翻译的失败后自检。 */
export type LibraryLoginSelfCheckView = {
    title: string;
    /** 还在检查：界面显示 runningText。 */
    running: boolean;
    runningText: string;
    /** 结论；还在跑或自检本身出错时为 null。 */
    verdict: string | null;
    /** 代理提示；没有会影响登录请求的代理时为 null。 */
    proxyNote: string | null;
    /** 自检本身出错时的说明。 */
    error: string | null;
    /** 逐项结果（标签已翻译，detail 是错误码、域名等原文）。 */
    items: Array<LoginSelfCheckItem & { label: string }>;
};

/** 翻译失败后的自检（纯函数）。 */
export const translateLoginSelfCheck = (
    t: TFunction,
    selfCheck: LibraryLoginSessionSnapshot['selfCheck'],
    providerLabel: string,
): LibraryLoginSelfCheckView | null => {
    if (!selfCheck) return null;
    const base = {
        title: translateHomeMessage(t, LOGIN_SELF_CHECK_COPY.title),
        runningText: translateHomeMessage(t, LOGIN_SELF_CHECK_COPY.running),
    };
    if (selfCheck.status === 'running') {
        return { ...base, running: true, verdict: null, proxyNote: null, error: null, items: [] };
    }
    if (selfCheck.status === 'failed') {
        return {
            ...base,
            running: false,
            verdict: null,
            proxyNote: null,
            error: t(LOGIN_SELF_CHECK_COPY.failedKey, { message: selfCheck.message }),
            items: [],
        };
    }
    const proxyMessage = resolveLoginSelfCheckProxyMessage(selfCheck.verdict, providerLabel);
    return {
        ...base,
        running: false,
        verdict: translateHomeMessage(t, resolveLoginSelfCheckVerdictMessage(selfCheck.verdict, providerLabel)),
        proxyNote: proxyMessage ? translateHomeMessage(t, proxyMessage) : null,
        error: null,
        items: summarizeLoginSelfCheck(selfCheck.result)
            .filter(item => item.state !== 'skip')
            .map(item => ({ ...item, label: translateHomeMessage(t, resolveLoginSelfCheckItemLabel(item.id, selfCheck.result.runtime)) })),
    };
};

/** 已翻译的切换确认。 */
export type LibraryProviderSwitchView = {
    request: LibraryProviderSwitchRequest;
    title: string;
    description: string;
};

// 确认框里的平台名：与 omni.getProviderLabel 相同的取法（shortName → displayName → id）。
const providerLabelOf = (providers: readonly ProviderAccountSummary[], providerId: OnlineProviderId): string => {
    const provider = providers.find(candidate => candidate.providerId === providerId);
    return provider?.shortName || provider?.displayName || providerId;
};

/** 翻译一个待确认切换（纯函数）。 */
export const translateProviderSwitch = (
    t: TFunction,
    request: LibraryProviderSwitchRequest,
    providers: readonly ProviderAccountSummary[],
): LibraryProviderSwitchView => {
    const copy = resolveProviderSwitchCopy(providerLabelOf(providers, request.to));
    return {
        request,
        title: translateHomeMessage(t, copy.title),
        description: translateHomeMessage(t, copy.description),
    };
};

// 构建与运行环境在页面生命周期内不变：构建类别由构建期注入，网页版即没有 Electron 桥。
const LOGIN_REPORT_ENVIRONMENT: LibraryLoginReportEnvironment = {
    build: getBuildKind(),
    web: typeof window !== 'undefined' && !window.electron,
};

/** 这一次登录的诊断报告该交给谁（core/account/accountRules 的 resolveLoginReportRoute，环境是这个页面的）。 */
export const resolveLoginSessionReportRoute = (
    session: Pick<LibraryLoginSessionSnapshot, 'failure' | 'selfCheck'>,
): LibraryLoginReportRoute => resolveLoginReportRoute(LOGIN_REPORT_ENVIRONMENT, session);

/** 只订阅登录会话（原始快照，登录窗口自己定画什么）：没有登录时为 null。 */
export const useLibraryAccountLogin = (controller: LibraryAccountController): LibraryLoginSessionSnapshot | null => (
    useLibraryAccountSelector(controller, selectLogin)
);

/** 只订阅待确认切换（平台名要读 provider 列表，所以也订阅它）：没有待确认请求时为 null。 */
export const useLibraryAccountPendingSwitch = (controller: LibraryAccountController): LibraryProviderSwitchView | null => {
    const { t } = useTranslation();
    const request = useLibraryAccountSelector(controller, selectPendingSwitch);
    const providers = useLibraryAccountSelector(controller, selectProviders);
    return useMemo(() => (request ? translateProviderSwitch(t, request, providers) : null), [providers, request, t]);
};

/** 只订阅 provider 列表与当前平台（账户列表 / 切换器用）。 */
export const useLibraryAccountProviders = (controller: LibraryAccountController): {
    providers: ProviderAccountSummary[];
    activeProviderId: OnlineProviderId;
} => {
    const providers = useLibraryAccountSelector(controller, selectProviders);
    const activeProviderId = useLibraryAccountSelector(controller, selectActiveProviderId);
    return useMemo(() => ({ providers, activeProviderId }), [activeProviderId, providers]);
};

export type LibraryAccountView = {
    snapshot: LibraryAccountSnapshot;
    pendingSwitch: LibraryProviderSwitchView | null;
};

/** 整份快照 + 已翻译的切换确认（account surface 一次拿全用）。 */
export const useLibraryAccount = (controller: LibraryAccountController): LibraryAccountView => {
    const snapshot = useLibraryAccountSelector(controller, selectSnapshot);
    const pendingSwitch = useLibraryAccountPendingSwitch(controller);
    return useMemo(() => ({ snapshot, pendingSwitch }), [pendingSwitch, snapshot]);
};
