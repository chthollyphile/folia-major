import type { RemoteTrackTransition } from '../../../../types/remoteControl';
import { subscribeToTransitionCue } from '../../../../services/automix/transitionCue';

// src/components/app/playback/bridges/remoteTrackTransitionFeed.ts
// The cue as the remote window's snapshot carries it. The cue is event-shaped in the main renderer;
// this keeps only the current one, so the Remote's existing 500ms publisher can carry it without a
// React render loop.

export type RemoteTrackTransitionFeed = {
    /** The hand-off to publish now, or null: none running, or the remote is not told of one. */
    read: () => RemoteTrackTransition | null;
    dispose: () => void;
};

/**
 * `canPublish` is asked when a cue arrives and again at every publish: automix must be on and a deck
 * other than the active one still sounding, or the remote would align its faces to a blend nobody hears.
 */
export const createRemoteTrackTransitionFeed = (
    canPublish: () => boolean,
    now: () => number = Date.now,
): RemoteTrackTransitionFeed => {
    let latest: RemoteTrackTransition | null = null;
    const unsubscribe = subscribeToTransitionCue(cue => {
        // 设置面板的演示 cue 既不是交接的开始也不是结束：真实混音正跑到一半时把它当成
        // cue 结束会直接取消遥控窗口的交接，所以这里整条忽略。
        if (cue?.preview) {
            return;
        }
        latest = cue === null || !canPublish()
            ? null
            : { startedAtMs: now(), durationSec: cue.seconds, crossover: cue.crossover };
    });
    return {
        read: () => (canPublish() ? latest : null),
        dispose: unsubscribe,
    };
};
