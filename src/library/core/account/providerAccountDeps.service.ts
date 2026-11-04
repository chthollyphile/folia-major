import { omni } from '../../../services/onlineMusic/omni';
import { dropLoginRequestLimits } from '../../../services/onlineMusic/login/loginRequestLimit';
import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { formatBuildProvenance } from '../../../utils/buildProvenance';
import type {
    LibraryAccountAuthPort,
    LibraryAccountClock,
    LibraryAccountControllerDeps,
    LibraryAccountLogger,
    LibraryAccountStorePort,
    LibraryLoginDiagnosticsEnvironment,
    LibraryProviderAccountPort,
    LibraryProviderSwitchCleanupPort,
} from './account.contract';

// src/library/core/account/providerAccountDeps.service.ts
// 在线账户 controller 的默认装配：登录的 auth 转给 omni 的同名方法（外加不再给登录请求计时的那一个）；provider
// 列表与当前平台读 useOnlineProviderAccountStore + omni（mod 源增删经 omni.subscribeProviders）；读账号走
// omni.readAccount（services/onlineMusic/account/accountRead）；时钟用 window 定时器；诊断环境读 __APP_VERSION__、
// navigator 与构建来源。退出、退出前的那一问与播放器端口属于宿主（App），由调用方以函数形状传入。
// 单测给 createProviderAccountController 注入假端口，不经过这里。

/** 登录的 auth：omni 的同名方法（经 omni.xxx() 调用，this 仍是 omni）。 */
export const omniAccountAuthPort: LibraryAccountAuthPort = {
    resolveLoginMethods: providerId => omni.resolveLoginMethods(providerId),
    startLogin: (providerId, methodId) => omni.startLogin(providerId, methodId),
    checkLogin: (providerId, key) => omni.checkLogin(providerId, key),
    cancelLogin: (providerId, key) => omni.cancelLogin(providerId, key),
    confirmsLoginInBrowser: providerId => omni.confirmsLoginInBrowser(providerId),
    opensLoginPageItself: (providerId, key) => omni.opensLoginPageItself(providerId, key),
    openLoginPage: (providerId, key) => omni.openLoginPage(providerId, key),
    getLoginTtlMs: providerId => omni.getLoginTtlMs(providerId),
    getLoginTexts: providerId => omni.getLoginTexts(providerId),
    getLoginLocalService: providerId => omni.getLoginLocalService(providerId),
    getLoginDiagnostics: providerId => omni.getLoginDiagnostics(providerId),
    canRunLoginSelfCheck: providerId => omni.canRunLoginSelfCheck(providerId),
    runLoginSelfCheck: providerId => omni.runLoginSelfCheck(providerId),
    getProviderCapabilities: providerId => omni.getProviderCapabilities(providerId),
    dropRequestLimits: dropLoginRequestLimits,
};

/** provider 列表 × 账户 store；订阅同时听账户 store 与 provider 注册表。 */
export const accountStorePort: LibraryAccountStorePort = {
    listProviders: () => omni.getProviderSummaries(),
    getProviderLabel: providerId => omni.getProviderLabel(providerId),
    getStoredActiveProviderId: () => useOnlineProviderAccountStore.getState().activeProviderId,
    setActiveProviderId: providerId => useOnlineProviderAccountStore.getState().setActiveProviderId(providerId),
    invalidateActiveRequests: () => omni.invalidateActiveRequests(),
    subscribe: listener => {
        const unsubscribeStore = useOnlineProviderAccountStore.subscribe(() => listener());
        const unsubscribeRegistry = omni.subscribeProviders(listener);
        return () => {
            unsubscribeStore();
            unsubscribeRegistry();
        };
    },
};

/**
 * 读账号：登录确认之后读到了、或者读到了人却没读到歌单（登录本身成了）都算成；平台说没人登录、问不到是没读到。
 * 切过去之后只读，不判。readAccount 从不 reject。
 */
export const readProviderAccount: LibraryProviderAccountPort['refresh'] = async (providerId, reason) => {
    const outcome = await omni.readAccount(providerId, reason);
    return reason === 'switch' || outcome === 'read' || outcome === 'not read';
};

/** 提交表单式登录（FormLogin 渲染的字段）：转 omni.submitLoginForm，失败抛 OnlineProviderError。 */
export const submitProviderLoginForm: LibraryProviderAccountPort['submitLoginForm'] = async (providerId, values) => {
    await omni.submitLoginForm(providerId, values);
};

/** window 定时器（调用时才读 window，模块加载不依赖浏览器环境）。 */
export const windowAccountClock: LibraryAccountClock = {
    now: () => Date.now(),
    setTimeout: (callback, ms) => window.setTimeout(callback, ms),
    clearTimeout: handle => window.clearTimeout(handle as number),
};

// 网页版的站点 origin；桌面版页面是 file:// 等本地协议，返回 null。
const resolveWebOrigin = (): string | null => {
    if (typeof window === 'undefined' || window.electron) return null;
    const { protocol, origin } = window.location;
    return protocol === 'http:' || protocol === 'https:' ? origin : null;
};

/** 诊断报告的环境信息。 */
export const resolveLoginDiagnosticsEnvironment = (): LibraryLoginDiagnosticsEnvironment => ({
    appVersion: typeof __APP_VERSION__ === 'undefined' ? null : __APP_VERSION__,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    build: formatBuildProvenance(),
    origin: resolveWebOrigin(),
});

/**
 * 宿主提供的端口（可以用 ref 指向每次渲染的最新实现）：退出与退出前的那一问（App 的 useProviderSignOut），
 * 平台换了时的播放器端口（app/createLibraryAccountPort）。
 */
export type ProviderAccountHostPorts = {
    logout: LibraryProviderAccountPort['logout'];
    confirmLogout: LibraryProviderAccountPort['confirmLogout'];
    switchCleanup: LibraryProviderSwitchCleanupPort;
    log?: LibraryAccountLogger;
};

/** 组装 controller 的全部依赖：宿主端口 + 上面的默认端口。 */
export const createProviderAccountDeps = (host: ProviderAccountHostPorts): LibraryAccountControllerDeps => ({
    auth: omniAccountAuthPort,
    accounts: accountStorePort,
    providerAccounts: {
        refresh: readProviderAccount,
        submitLoginForm: submitProviderLoginForm,
        logout: host.logout,
        confirmLogout: host.confirmLogout,
    },
    switchCleanup: host.switchCleanup,
    clock: windowAccountClock,
    diagnostics: resolveLoginDiagnosticsEnvironment(),
    log: host.log,
});
