import { PlayerState, type StatusMessage } from '../../../types';
import type { SkipPromptMessageKey } from '../../../types/appPlayback';
import type { PlaybackFailure, PlaybackFailureContext } from '../../../types/playbackFailure';
import type { StatusSetter } from '../../../stores/useStatusMessageStore';
import { buildPlaybackFailureStatus, resolvePlaybackFailurePolicy } from '../../../services/playbackRecovery/playbackFailurePolicy';

// src/components/app/playback/presentPlaybackFailure.ts
// 播放失败的展示层：按策略表决定倒计时跳歌、停播，还是给出带“重试 / 跳过”的常驻消息。
// 只负责展示和停播，不决定原因；队列控制器在点歌失败和播放中失败时都交给这里。

export interface PlaybackFailurePresentation {
    failure: PlaybackFailure;
    context: PlaybackFailureContext;      // 'play' | 'mid-playback'
    isCurrent: () => boolean;
    skipCount: number;
    retry?: () => void;
    skip?: () => void;                    // 没有下一首可播歌曲时为 undefined
}

export interface PlaybackFailurePresenterDeps {
    t: (key: string, options?: Record<string, unknown>) => string;
    setStatusMsg: StatusSetter;
    setPlayerState: (state: PlayerState) => void;
    audioRef: { current: { pause(): void } | null };
    shouldAutoPlayRef: { current: boolean };
    setIsLyricsLoading: (value: boolean) => void;
    showTimedSkipPrompt: (key: SkipPromptMessageKey, onSkip: () => void) => void;
    maxAutoSkipCount: number;
}

/** 按策略表展示一次失败：倒计时跳歌、停播提示或带按钮的持久消息。陈旧请求直接忽略。 */
export const presentPlaybackFailure = (input: PlaybackFailurePresentation, deps: PlaybackFailurePresenterDeps): void => {
    const { failure, context, isCurrent, skipCount, retry, skip } = input;
    if (!isCurrent()) return;

    const policy = resolvePlaybackFailurePolicy(failure, context);
    deps.setIsLyricsLoading(false);

    // 只有 taken-down 会走到倒计时；次数用尽或没有下一首时落到下面的普通消息。
    if (policy.autoSkip === 'countdown' && policy.countdownKey && skip && skipCount < deps.maxAutoSkipCount) {
        deps.showTimedSkipPrompt(policy.countdownKey, () => {
            if (isCurrent()) skip();
        });
        return;
    }

    if (policy.stopPlayback) {
        deps.shouldAutoPlayRef.current = false;
        deps.audioRef.current?.pause();
        deps.setPlayerState(context === 'mid-playback' ? PlayerState.PAUSED : PlayerState.IDLE);
    }

    // 按钮可能在用户切歌之后才被点：先确认仍是这次请求，再清掉消息、执行动作。
    // 陈旧时不执行动作，但仍收起这条常驻消息（只收起自己那条，期间换上的新消息不动），否则它关不掉。
    let built: StatusMessage | null = null;
    const wrap = (action?: () => void) => action && (() => {
        if (!isCurrent()) {
            deps.setStatusMsg(current => (current === built ? null : current));
            return;
        }
        deps.setStatusMsg(null);
        action();
    });

    built = buildPlaybackFailureStatus(policy, deps.t, {
        retry: wrap(retry),
        skip: wrap(skip),
        dismiss: () => deps.setStatusMsg(null),
    });
    deps.setStatusMsg(built);
};
