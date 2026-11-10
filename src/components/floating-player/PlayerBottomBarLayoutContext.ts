import { createContext, useContext } from 'react';
import { PLAYER_BOTTOM_BAR_BASE_OFFSET_PX } from '../../utils/playerBottomBarLayout';

// src/components/floating-player/PlayerBottomBarLayoutContext.ts
// 标记「当前这棵子树是否处于播放页的底栏环境」。

/**
 * 默认 false，因为共享的字幕层不只长在播放页上：VisPlayground、Theme Park 预览和
 * OBS 浏览器源都会渲染同一个组件，它们没有底栏，也就不该被底栏的偏移量和隐藏状态牵动。
 * 只有 App 里播放页那棵树显式 Provider 成 true。
 */
export const PlayerBottomBarLayoutContext = createContext(false);

export const useIsPlayerBottomBarHost = (): boolean => useContext(PlayerBottomBarLayoutContext);

/**
 * 不在底栏环境里时，字幕层当作底栏停在哪个偏移量上，默认就是基线 32，字幕因此停在离底 112（32 加 80 的间距）。
 * 把整页缩小、放大裁切后画进框的预览（歌词样式窗口和 Theme Park）会改它，
 * 让字幕在框里停在该停的高度，见 VisPlaygroundSampleStage。
 */
export const PreviewBottomBarOffsetContext = createContext(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);

export const usePreviewBottomBarOffset = (): number => useContext(PreviewBottomBarOffsetContext);
