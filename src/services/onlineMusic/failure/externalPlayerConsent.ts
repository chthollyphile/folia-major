import type { OnlineFailure } from './onlineFailureCase';
import type { OnlinePlayerFailureCause } from '../../../types/onlineMusic';
import { omni } from '../omni';

// src/services/onlineMusic/failure/externalPlayerConsent.ts
// 本机播放器那条路上，用的人自己得决定的那几件事：他还没同意 Folia 关掉并重开他自己那个播放器时问一次，
// 找不到客户端或客户端里的播放器时说清是哪一个没找到、并给一条改回标准播放的路。三种情况由 provider 经
// OnlineFailureDetail.playerCause 点名（平台无关，见 types/onlineMusic.ts），这里只按名字分派，不认任何平台。

/** 一次失败要人做的那件事；都不是就不返回。 */
export type ExternalPlayerCauseAction = 'restart-consent' | 'change-way';

const ACTIONS: Partial<Record<OnlinePlayerFailureCause, ExternalPlayerCauseAction>> = {
    // 播放器开着，但没有 Folia 说话的那个调试端口，而人还没同意关掉它重开：问他一次。
    'player-restart-consent': 'restart-consent',
    // 客户端没装、或者装了却找不到里面那个播放器（版本改了，Folia 暂时控制不了）：换一种播放方式。
    'player-not-installed': 'change-way',
    'player-not-found': 'change-way',
};

export const playerCauseAction = (shown: OnlineFailure): ExternalPlayerCauseAction | null => (
    shown.facts.playerCause ? ACTIONS[shown.facts.playerCause] ?? null : null
);

/** 说这件事的两句话：标题和该做什么。`player-restart-consent` 自己弹出确认窗，不用这两句。 */
export const playerCauseTextKeys = (
    cause: OnlinePlayerFailureCause,
): { title: string; note?: string } | null => {
    if (cause === 'player-not-installed') {
        return { title: 'failure.externalPlayerNotInstalled', note: 'failure.noteExternalPlayerNotInstalled' };
    }
    if (cause === 'player-not-found') {
        return { title: 'failure.externalPlayerNotFound', note: 'failure.noteExternalPlayerNotFound' };
    }
    return null;
};

// 同意与否只经 preload 的那一个通道（electron/preload.cjs，IPC 在 electron/restartConsent.cjs）：
// 主进程只认一个 `true`，别的都当没同意过。

/** 人是不是已经同意过（一个不记得这件事的窗口答否，与主进程的默认一致）。 */
export const readExternalPlayerRestartConsent = async (): Promise<boolean> => {
    try {
        return await window.electron?.externalPlayerRestartConsent() === true;
    } catch (error) {
        console.warn('[OnlineMusic] The restart consent could not be read', error);
        return false;
    }
};

/** 记下这次同意：之后再遇到同一个播放器就不会再问。 */
export const grantExternalPlayerRestartConsent = async (): Promise<boolean> => {
    try {
        return await window.electron?.externalPlayerRestartConsent(true) === true;
    } catch (error) {
        console.warn('[OnlineMusic] The restart consent could not be granted', error);
        return false;
    }
};

/** 撤销同意：下次再遇到就重新问。 */
export const revokeExternalPlayerRestartConsent = async (): Promise<void> => {
    try {
        await window.electron?.externalPlayerRestartConsent(false);
    } catch (error) {
        console.warn('[OnlineMusic] The restart consent could not be revoked', error);
    }
};

/** 改回标准播放：由那个平台自己换（它知道自己的几种播放方式），共用层不认平台。 */
export const changeExternalPlaybackWay = async (shown: OnlineFailure): Promise<void> => {
    if (!shown.providerId) return;
    await omni.leaveExternalPlaybackForStandard(shown.providerId);
};
