import { useEffect, useState } from 'react';
import type { StageTrackPillMode } from '../NowPlayingToast';

// src/components/app/overlays/now-playing-toast/useNowPlayingCardVisibility.ts
// 歌曲卡片什么时候在场：never 不在；always 常驻；auto 换歌后显示 timeoutSec 秒再退。预告下一首、混音、
// 拖位置的时候按住不退。宽屏的卡片（NowPlayingToast）和紧凑档里胶囊左端的那一份（progress-bar v3）共用这一个判断，
// 两处的计时和例外永远一样。

type CardVisibilityInput = {
    mode: StageTrackPillMode;
    timeoutSec: number;
    /** 当前曲目的稳定身份：换歌重新计时。 */
    trackKey: string;
    /** 自动切歌预览：挂起计时，翻回 false 后（即使 trackKey 没变）重新计时。 */
    isNextUp: boolean;
    /** 正在混音（卡片描边在画）：卡片必须留着，描边挂在它上面。 */
    isMixing: boolean;
    /** 正在拖卡片的位置：never 也要露出来让人拖。 */
    isPositioning?: boolean;
};

export const useNowPlayingCardVisibility = ({
    mode,
    timeoutSec,
    trackKey,
    isNextUp,
    isMixing,
    isPositioning = false,
}: CardVisibilityInput): boolean => {
    const [visible, setVisible] = useState(mode !== 'never');
    const holdOpen = isPositioning || mode === 'always' || isNextUp || isMixing;
    const hideDelayMs = Math.max(3, Math.min(60, Math.round(timeoutSec))) * 1000;
    useEffect(() => {
        if (mode === 'never' && !isPositioning) {
            setVisible(false);
            return;
        }
        setVisible(true);
        if (holdOpen) return;
        // 上一轮的 cleanup 一定在本轮之前跑完，所以不需要额外记 timeout id
        const timer = window.setTimeout(() => setVisible(false), hideDelayMs);
        return () => window.clearTimeout(timer);
    }, [mode, hideDelayMs, trackKey, holdOpen, isPositioning]);
    return visible;
};
