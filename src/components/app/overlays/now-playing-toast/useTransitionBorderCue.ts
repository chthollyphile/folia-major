import { useEffect, useState } from 'react';
import {
    getActiveTransitionCue,
    shouldDrawCue,
    subscribeToTransitionCue,
    type TransitionCue,
} from '../../../../services/automix/transitionCue';
import { useSettingsUiStore } from '../../../../stores/useSettingsUiStore';

// src/components/app/overlays/now-playing-toast/useTransitionBorderCue.ts

/** 描边要画的这一次混音；startAtMs 是已经走过的部分，接手在混音中途时不为 0。 */
export interface TransitionBorderCue {
    cue: TransitionCue;
    startAtMs: number;
}

/**
 * 下一刻描边该画什么，给的是上一刻的答案和描边自己那个开关。
 *
 * 问的是「现在正在跑的是哪一次」（transitionCue 里的 active），不是「刚刚广播的是哪一条」。
 * 差别就在这儿：是挂载晚了、还是开关刚拨上来，答案都一样对。
 */
const nextBorderCue = (
    prev: TransitionBorderCue | null,
    switchedOn: boolean,
): TransitionBorderCue | null => {
    const running = getActiveTransitionCue();

    // 写着圆环名字的那条演示不关这里的事：不画它，也不能因为它把自己正在画的这次收掉。
    // 模块里只记得住最后广播的那一条，而两个开关是可能在十秒内先后拨上的。
    if (running?.cue.preview && running.cue.preview !== 'card') return prev;

    if (!switchedOn || !running || !shouldDrawCue(running.cue, true, 'card')) return null;

    // 同一次混音重算不改起点：startAtMs 只在接手的那一刻定一次，否则每同步一次描边就被拨回去一点。
    return prev && prev.cue === running.cue
        ? prev
        : { cue: running.cue, startAtMs: running.elapsedMs };
};

export const useTransitionBorderCue = (): TransitionBorderCue | null => {
    // 开关是活的，不是 cue 到达那一刻拍下的快照。拍快照的写法下，混音跑到一半把开关关掉，
    // 描边会自顾自画完剩下的十几秒，卡片也被 holdOpen 一起按住不退场——而屏幕圆环那边关开关
    // 是直接卸载、立刻停。两个开关该是一样的手感。
    const switchedOn = useSettingsUiStore(
        state => state.transitionAnimationCard && state.transitionMode === 'automix',
    );

    const [active, setActive] = useState<TransitionBorderCue | null>(() => nextBorderCue(null, switchedOn));

    // 每次需要重新回答「现在该画什么」就重算一遍，而不是用收到的那条 cue：
    //   - 来了新广播（订阅）
    //   - 开关变了（进依赖，重新订阅前先同步一次）
    //   - 这一次自己跑完了（下面那个定时器）
    //
    // 靠收到的那条是不行的：设置页把开关拨上去和广播预览是同一个 click 里前后两行，React 要等
    // 这次事件结束才提交，所以那条预览到达时这里读到的开关还是旧的。问「正在跑的是哪一次」就
    // 没有这个问题——提交之后 switchedOn 变了，这个 effect 重跑，同步时那次混音还在跑。
    useEffect(() => {
        const sync = () => setActive(prev => nextBorderCue(prev, switchedOn));
        sync();
        return subscribeToTransitionCue(sync);
    }, [switchedOn]);

    // 自己跑完的那一下没有广播（设置页那条演示根本不会广播结束），按剩下的时间自己收场。
    useEffect(() => {
        if (!active) return;
        const remainingMs = Math.max(0, active.cue.seconds * 1000 - active.startAtMs);
        const timer = window.setTimeout(() => setActive(null), remainingMs);
        return () => window.clearTimeout(timer);
    }, [active]);

    return active;
};
