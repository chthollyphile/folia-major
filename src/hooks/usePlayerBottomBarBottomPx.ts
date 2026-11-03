import { useEffect } from 'react';
import { useSpring, useTransform, type MotionValue } from 'framer-motion';
import { playerBottomBarLiveOffset } from '../stores/motionSignals';
import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';
import { useIsPlayerBottomBarHost, usePreviewBottomBarOffset } from '../components/floating-player/PlayerBottomBarLayoutContext';
import { useMediaQuery } from './useMediaQuery';
import {
    PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
    resolvePlayerBottomComponentBottomPx,
    resolvePlayerSubtitleBottomFromPresence,
} from '../utils/playerBottomBarLayout';

// src/hooks/usePlayerBottomBarBottomPx.ts
// 所有贴在底部基线上的组件从这里取自己的 bottom：把全局抬升量叠加到各自原有的底距上。

/**
 * 返回可直接绑定到 motion 元素 bottom 样式的值。
 * 传入组件原来的底距后，默认设置保持原布局，用户调整只增加同一段抬升量。
 */
export const usePlayerBottomBarBottomPx = (
    componentBaseBottomPx = PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
): MotionValue<number> => (
    useTransform(
        playerBottomBarLiveOffset,
        value => resolvePlayerBottomComponentBottomPx(value, componentBaseBottomPx),
    )
);

/** 原来的 `bottom-28 sm:bottom-6`，即 sm 断点上下各自的底距。 */
const SIDE_PANEL_BASE_BOTTOM_PX = { wide: 24, narrow: 112 } as const;

/**
 * 左右两侧切入面板共用的底距。
 *
 * GridView / GridMap / ArtistGrid / SidePanelList 原本各写一遍 `bottom-28 sm:bottom-6`，
 * 断点值散在四个文件里就会各自漂移，所以收在这里。
 */
export const useSidePanelBottomPx = (): MotionValue<number> => {
    const isWideLayout = useMediaQuery('(min-width: 640px)');
    return usePlayerBottomBarBottomPx(
        isWideLayout ? SIDE_PANEL_BASE_BOTTOM_PX.wide : SIDE_PANEL_BASE_BOTTOM_PX.narrow,
    );
};

/** 控制条出现/消失时字幕让位的过渡，沿用它原本挂在 animate.bottom 上的那组参数。 */
const SUBTITLE_PRESENCE_SPRING = { stiffness: 280, damping: 28 } as const;

/**
 * 字幕层的 `bottom`：在基线之上再留出胶囊净空。
 *
 * 只有播放页那棵树接入底栏布局。VisPlayground 和 Theme Park 预览渲染的是同一个字幕组件，
 * 但它们没有底栏，读全局偏移量只会让预览莫名其妙地抬高；它们走
 * PlayerBottomBarLayoutContext 的默认值，维持基线 + 净空的固定位置
 * （缩放舞台上由 PreviewBottomBarOffsetContext 换算成框里该有的距离）。
 *
 * 在播放页内，两种位置变化的手感刻意不同：
 * - 控制条出现/消失是离散切换，走 spring，保留原来 animate.bottom 的过渡；
 * - 跟随基线抬高要跟手，直接读共享信号，不经过 spring，否则会落后于其他组件。
 */
export const usePlayerSubtitleBottomPx = (isPlayerChromeHidden: boolean): MotionValue<number> => {
    const isBottomBarHost = useIsPlayerBottomBarHost();
    const previewOffset = usePreviewBottomBarOffset();
    const isControlBarHidden = usePlayerChromeSettingsStore(state => state.hidePlayerProgressBar);
    // 底栏被整条关掉只对播放页成立；预览里那个全局开关和它无关。
    const isControlBarAbsent = isPlayerChromeHidden || (isBottomBarHost && isControlBarHidden);
    const controlBarPresence = useSpring(isControlBarAbsent ? 0 : 1, SUBTITLE_PRESENCE_SPRING);

    useEffect(() => {
        // useSpring 的 set 是「动画到」，不是跳变，所以这里就是那段过渡本身。
        controlBarPresence.set(isControlBarAbsent ? 0 : 1);
    }, [controlBarPresence, isControlBarAbsent]);

    return useTransform(
        [controlBarPresence, playerBottomBarLiveOffset],
        ([presence, offset]: number[]) => resolvePlayerSubtitleBottomFromPresence(
            isBottomBarHost ? offset : previewOffset,
            presence,
        ),
    );
};
