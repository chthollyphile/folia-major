import type { StatusMessage } from '../../types';
import type {
    PlaybackFailure,
    PlaybackFailureAction,
    PlaybackFailureContext,
    PlaybackFailureMessageKey,
    PlaybackFailurePolicy,
    PlaybackFailureReason,
} from '../../types/playbackFailure';

// src/services/playbackRecovery/playbackFailurePolicy.ts
// 播放失败的集中策略表：每个原因对应的文案、是否停播、是否倒计时跳歌、给哪些按钮、是否静默重试、是否冷却。
// 只有 taken-down 会倒计时跳歌并提供替代版本；其余原因一律保留队列，由用户决定重试或跳过。

const NO_RETRY: readonly number[] = [];

// 停播、只给“跳过”：账号、权限、试听、地区这类重试也不会变好的原因。
const stopWithSkip = (messageKey: PlaybackFailureMessageKey): PlaybackFailurePolicy => ({
    messageKey,
    stopPlayback: true,
    autoSkip: 'none',
    actions: ['skip'],
    autoRetryDelaysMs: NO_RETRY,
    cooldown: null,
    offerReplacement: false,
});

// 停播、给“重试 / 跳过”：可能是暂时的，或证据不足的原因。
const stopWithRetry = (
    messageKey: PlaybackFailureMessageKey,
    overrides: Partial<Pick<PlaybackFailurePolicy, 'autoRetryDelaysMs' | 'cooldown'>> = {},
): PlaybackFailurePolicy => ({
    messageKey,
    stopPlayback: true,
    autoSkip: 'none',
    actions: ['retry', 'skip'],
    autoRetryDelaysMs: NO_RETRY,
    cooldown: null,
    offerReplacement: false,
    ...overrides,
});

/** 每个原因的基础策略；用 Record 穷举，漏掉任何原因 tsc 都会报错。随 failure 变化的变体在 resolvePlaybackFailurePolicy 里解析。 */
export const PLAYBACK_FAILURE_POLICY: Readonly<Record<PlaybackFailureReason, PlaybackFailurePolicy>> = {
    'not-signed-in': stopWithSkip('status.songLoginRequired'),
    'session-expired': stopWithSkip('status.loginExpired'),
    'membership-required': stopWithSkip('status.songMembershipRequired'),
    'purchase-required': stopWithSkip('status.songPurchaseRequired'),
    'entitlement-required': stopWithSkip('status.songEntitlementRequired'),
    'preview-only': stopWithSkip('status.songPreviewOnly'),
    'region-restricted': stopWithSkip('status.songRegionRestricted'),
    // 保持现状：倒计时期间不暂停；倒计时自带“跳过 / 取消”，次数用尽后只留一条消息。
    'taken-down': {
        messageKey: 'status.songUnavailable',
        countdownKey: 'status.songUnavailablePrompt',
        stopPlayback: false,
        autoSkip: 'countdown',
        actions: [],
        autoRetryDelaysMs: NO_RETRY,
        cooldown: null,
        offerReplacement: true,
    },
    network: stopWithRetry('status.songNetworkFailed', { autoRetryDelaysMs: [1000, 3000] }),
    timeout: stopWithRetry('status.songRequestTimedOut', { autoRetryDelaysMs: [2000] }),
    'service-unavailable': stopWithRetry('status.songServiceUnavailable', { cooldown: 'retry-after' }),
    'rate-limited': stopWithRetry('status.songRateLimitedNoWait', { cooldown: 'retry-after' }),
    'invalid-response': stopWithRetry('status.songTemporarilyUnavailable'),
    unknown: stopWithRetry('status.songTemporarilyUnavailable'),
};

/** 文案及其变体：限流带等待秒数、服务未配置、证据不足但登录可能有用。 */
export const getPlaybackFailureMessage = (
    failure: PlaybackFailure,
): { key: PlaybackFailureMessageKey; params?: { seconds: number } } => {
    switch (failure.reason) {
        case 'rate-limited':
            if (typeof failure.retryAfterMs === 'number' && failure.retryAfterMs > 0) {
                return { key: 'status.songRateLimited', params: { seconds: Math.max(1, Math.ceil(failure.retryAfterMs / 1000)) } };
            }
            return { key: 'status.songRateLimitedNoWait' };
        case 'service-unavailable':
            return { key: failure.transient === false ? 'status.songServiceNotConfigured' : 'status.songServiceUnavailable' };
        case 'unknown':
            return { key: failure.hint ? 'status.songTemporarilyUnavailableSignInHint' : 'status.songTemporarilyUnavailable' };
        default:
            return { key: PLAYBACK_FAILURE_POLICY[failure.reason].messageKey };
    }
};

/**
 * 解析一次失败在给定上下文下的最终策略：先套变体（文案、未配置时去掉重试），再套上下文覆盖。
 * 'restore' 只显示一条消息，不倒计时也不给按钮；'mid-playback' 与 'play' 相同（停播时由 presenter 置 PAUSED）。
 */
export const resolvePlaybackFailurePolicy = (
    failure: PlaybackFailure,
    context: PlaybackFailureContext,
): PlaybackFailurePolicy => {
    const base = PLAYBACK_FAILURE_POLICY[failure.reason];
    const message = getPlaybackFailureMessage(failure);
    let policy: PlaybackFailurePolicy = {
        ...base,
        messageKey: message.key,
        ...(message.params ? { messageParams: message.params } : {}),
    };

    // 未配置 / 需要桌面版：重试不会变好，只留“跳过”。
    if (failure.reason === 'service-unavailable' && failure.transient === false) {
        policy = { ...policy, actions: ['skip'] };
    }

    if (context === 'restore') {
        policy = { ...policy, autoSkip: 'none', actions: [] };
        delete policy.countdownKey;
    }

    return policy;
};

export const PLAYBACK_RETRYING_MESSAGE_KEY = 'status.songRetrying';

// 用对象字面量登记全部文案 key：漏掉 PlaybackFailureMessageKey 的任何成员 tsc 都会报错。
const MESSAGE_KEY_REGISTRY: Record<PlaybackFailureMessageKey, true> = {
    'status.songLoginRequired': true,
    'status.loginExpired': true,
    'status.songMembershipRequired': true,
    'status.songPurchaseRequired': true,
    'status.songEntitlementRequired': true,
    'status.songPreviewOnly': true,
    'status.songRegionRestricted': true,
    'status.songUnavailable': true,
    'status.songNetworkFailed': true,
    'status.songRequestTimedOut': true,
    'status.songServiceUnavailable': true,
    'status.songServiceNotConfigured': true,
    'status.songRateLimited': true,
    'status.songRateLimitedNoWait': true,
    'status.songTemporarilyUnavailable': true,
    'status.songTemporarilyUnavailableSignInHint': true,
};

/** 全部 messageKey（含变体）、倒计时 key 和重试中提示；供文案覆盖测试使用。 */
export const PLAYBACK_FAILURE_MESSAGE_KEYS: readonly string[] = Array.from(new Set<string>([
    ...Object.keys(MESSAGE_KEY_REGISTRY),
    ...Object.values(PLAYBACK_FAILURE_POLICY).flatMap(policy => (policy.countdownKey ? [policy.countdownKey] : [])),
    PLAYBACK_RETRYING_MESSAGE_KEY,
]));

export const PLAYBACK_FAILURE_ACTION_LABEL_KEYS = ['ui.retry', 'status.skipUnavailableAction', 'status.cancel'] as const;

const ACTION_LABEL_KEY: Record<PlaybackFailureAction, string> = {
    retry: 'ui.retry',
    skip: 'status.skipUnavailableAction',
};

// 本模块发出的常驻失败消息。“重试 / 跳过”两个按钮占满了消息，没有单独的关闭按钮，
// transport 和 audio bridge 的 autoplay 在播放真正恢复时据此收起它；倒计时等其他常驻消息不在其中，不受影响。
const PLAYBACK_FAILURE_STATUSES = new WeakSet<StatusMessage>();

/** 这条消息是不是 buildPlaybackFailureStatus 发出的常驻失败消息。 */
export const isPlaybackFailureStatus = (message: StatusMessage | null | undefined): boolean => (
    Boolean(message && PLAYBACK_FAILURE_STATUSES.has(message))
);

/**
 * 把策略变成一条状态消息：先过滤掉没有 handler 的按钮；有按钮时第一个是主按钮，
 * 第二个是副按钮（没有就用“取消”关闭消息），消息常驻；没有按钮时是一条普通错误消息。
 */
export const buildPlaybackFailureStatus = (
    policy: PlaybackFailurePolicy,
    t: (key: string, options?: Record<string, unknown>) => string,
    handlers: { retry?: () => void; skip?: () => void; dismiss: () => void },
): StatusMessage => {
    const text = policy.messageParams ? t(policy.messageKey, policy.messageParams) : t(policy.messageKey);
    const actions = policy.actions.filter(action => Boolean(handlers[action]));
    if (actions.length === 0) return { type: 'error', text };

    const [primary, secondary] = actions;
    const status: StatusMessage = {
        type: 'error',
        text,
        persistent: true,
        actionLabel: t(ACTION_LABEL_KEY[primary]),
        onAction: handlers[primary],
        cancelLabel: secondary ? t(ACTION_LABEL_KEY[secondary]) : t('status.cancel'),
        onCancel: secondary ? handlers[secondary] : handlers.dismiss,
    };
    PLAYBACK_FAILURE_STATUSES.add(status);
    return status;
};

/** loader 自动重试之间的等待；用 globalThis.setTimeout，Node 测试环境和浏览器都能用。 */
export const sleepForPlaybackRetry = (ms: number): Promise<void> => new Promise(resolve => {
    globalThis.setTimeout(resolve, ms);
});
