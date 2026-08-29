import { useEffect, useRef, useState } from 'react';
import {
    getActiveTransitionCue,
    subscribeToTransitionCue,
    type TransitionCue,
} from '../../../../services/automix/transitionCue';
import { useSettingsUiStore } from '../../../../stores/useSettingsUiStore';

// src/components/app/overlays/now-playing-toast/useTransitionBorderCue.ts

/** 值得画的最短混音时长，和 AutomixTransitionAnimation 取同一个门槛：
 *  更短的（beat cut、splice）本来就是要让人察觉不到的，画出来只剩一次闪光。 */
const MIN_DRAWN_SECONDS = 5;

/** 描边要画的这一次混音；startAtMs 是已经走过的部分，挂载在混音中途时不为 0。 */
export interface TransitionBorderCue {
    cue: TransitionCue;
    startAtMs: number;
}

/** 两个开关都开着、而且这次混音长到值得画。cue 到达时从 store 读，理由见下面订阅处。 */
const shouldDraw = (cue: TransitionCue): boolean => {
    const settings = useSettingsUiStore.getState();
    return settings.transitionAnimation
        && settings.transitionMode === 'automix'
        && cue.seconds >= MIN_DRAWN_SECONDS;
};

export const useTransitionBorderCue = (): TransitionBorderCue | null => {
    // 初值从「正在进行的那次混音」来：卡片会在混音中途挂载（在首页和歌词页之间来回、或者中途
    // 打开卡片开关），而 cue 是广播出来的，只等下一条广播就意味着这次混音剩下的时间里什么都不
    // 画。getActiveTransitionCue 自己会把已经跑完的那次滤掉，所以不会捡到一个过期的。
    const [active, setActive] = useState<TransitionBorderCue | null>(() => {
        const running = getActiveTransitionCue();
        return running && shouldDraw(running.cue)
            ? { cue: running.cue, startAtMs: running.elapsedMs }
            : null;
    });
    const endsAtRef = useRef(active ? performance.now() + active.cue.seconds * 1000 - active.startAtMs : 0);

    // 无条件订阅，两个开关在 cue 到达的那一刻从 store 里读：设置页把开关拨上去时，同一个 click
    // 处理函数里下一行就广播预览 cue，而 React 要等这次事件结束才提交。订阅或者开关判断只要挂在
    // prop 上，那条预览就永远收不到。zustand 的 set 是同步写进 store 的，所以这里读到的是新值。
    useEffect(() => subscribeToTransitionCue(next => {
        if (next === null) {
            // 混音结束了。是自己跑完的还是被打断的，问的是时钟而不是 cue。
            if (performance.now() < endsAtRef.current) setActive(null);
            return;
        }
        if (!shouldDraw(next)) return;
        endsAtRef.current = performance.now() + next.seconds * 1000;
        setActive({ cue: next, startAtMs: 0 });
    }), []);

    // 兜底收场：settle 的那条 null 会正常到，但它走的是音频那条链，被打断的路径上不一定每次都
    // 到得了。按剩下的时间算，中途接手时不能再等一整段。
    useEffect(() => {
        if (!active) return;
        const remainingMs = active.cue.seconds * 1000 - active.startAtMs;
        const timer = window.setTimeout(() => setActive(null), Math.max(0, remainingMs));
        return () => window.clearTimeout(timer);
    }, [active]);

    return active;
};
