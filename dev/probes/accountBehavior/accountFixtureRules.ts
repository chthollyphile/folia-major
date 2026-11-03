// dev/probes/accountBehavior/accountFixtureRules.ts
// 账户行为探针的固定规则：假 provider 的 id、名字和登录方式。纯常量，component 用例可以直接 import，
// 不会把探针运行时带进 Node。
//
// 七个 provider 各管一类语义：
// - netease：顶替真实网易注册的假 provider，单一登录方式；只有它会读网易本地后端的健康状态（Grid3D 按 id 判定）。
// - alpha：探针挂载时已登录、是当前平台。
// - beta：已登录、不是当前平台——「切换到已登录平台」。
// - gamma：未登录、单一登录方式——「选未登录平台 → 扫码」。
// - quill：未登录、两种登录方式（QQ 那样的两步式）。
// - modo：没有账户（capabilities.auth = false，requiresAccount = false），等同 Folium mod 源。
// - qq：顶替真实 QQ 注册的假 provider，未登录、单步流程；名字用 Tencent，免得按文字找菜单项时与 Quill 撞上。
//   用来验证 QQ 的失败与别的平台走同一套规则（诊断入口、自检，见 core/account/accountRules 的 canShowLoginDiagnostics）。

export const ACCOUNT_NETEASE = 'netease';
export const ACCOUNT_ALPHA = 'acct-alpha';
export const ACCOUNT_BETA = 'acct-beta';
export const ACCOUNT_GAMMA = 'acct-gamma';
export const ACCOUNT_QUILL = 'acct-quill';
export const ACCOUNT_MODO = 'acct-modo';
export const ACCOUNT_QQ = 'qq';

export type AccountProviderRule = {
    id: string;
    shortName: string;
    displayName: string;
    /** false：没有账户的源（mod），不注册 auth、不给刷新器 / 登出器。 */
    auth: boolean;
    /** 挂载时的账户状态（auth 为 false 的源没有账户条目）。 */
    initial: 'authenticated' | 'anonymous' | null;
    /** 声明的扫码登录方式；不声明即单步流程。 */
    methods?: { id: string; labelKey: string; iconKey: string }[];
};

export const ACCOUNT_PROVIDERS: AccountProviderRule[] = [
    { id: ACCOUNT_NETEASE, shortName: 'NetEase', displayName: 'Probe NetEase', auth: true, initial: 'anonymous' },
    { id: ACCOUNT_ALPHA, shortName: 'Alpha', displayName: 'Probe Alpha', auth: true, initial: 'authenticated' },
    { id: ACCOUNT_BETA, shortName: 'Beta', displayName: 'Probe Beta', auth: true, initial: 'authenticated' },
    { id: ACCOUNT_GAMMA, shortName: 'Gamma', displayName: 'Probe Gamma', auth: true, initial: 'anonymous' },
    {
        id: ACCOUNT_QUILL,
        shortName: 'Quill',
        displayName: 'Probe Quill',
        auth: true,
        initial: 'anonymous',
        methods: [
            { id: 'qq', labelKey: 'home.qqLoginMethodMobile', iconKey: 'qq' },
            { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
        ],
    },
    { id: ACCOUNT_MODO, shortName: 'Modo', displayName: 'Probe Modo', auth: false, initial: null },
    { id: ACCOUNT_QQ, shortName: 'Tencent', displayName: 'Probe Tencent', auth: true, initial: 'anonymous' },
];

/** 探针挂载时的当前平台。 */
export const ACCOUNT_INITIAL_ACTIVE = ACCOUNT_ALPHA;

export const accountRule = (providerId: string): AccountProviderRule | undefined => (
    ACCOUNT_PROVIDERS.find(rule => rule.id === providerId)
);

/** 账户刷新成功后写进 store 的用户。 */
export const accountUser = (providerId: string) => ({
    id: `${providerId}-user`,
    nickname: `${accountRule(providerId)?.shortName ?? providerId} User`,
});

/**
 * 二维码会话的 key：`<providerId>#<methodId|default>#<序号>`。序号在整页内递增，用例据此分辨新旧会话；
 * 二维码图片里带着同一个 key，看得出弹窗显示的是哪一个会话。
 */
export const qrKeyOf = (providerId: string, methodId: string | undefined, serial: number): string => (
    `${providerId}#${methodId ?? 'default'}#${serial}`
);

/** 手机上取消之后的后端冷却（探针缩短到 3 秒，真实后端是 30 秒）。 */
export const ACCOUNT_CANCEL_COOLDOWN_MS = 3_000;
