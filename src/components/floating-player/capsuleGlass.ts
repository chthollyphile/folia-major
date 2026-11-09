import type { CSSProperties } from 'react';
import { panelEdgeColor } from '../panelTab/shell/panelTheme';

// src/components/floating-player/capsuleGlass.ts
// 进度条胶囊周围那几样浮在歌词上的东西共用的一层玻璃：换按钮的浮层、上方的浮动命令、
// 「放到进度条上？」提议条。底色和模糊照展开的进度条胶囊（FloatingPlayerControls 的 glassBgExpanded），
// 边沿是播放页面板那条 1px 线，投影同一档；胶囊自己保留原来的描边。
// 形状（胶囊还是圆角块）各自定，这里只管表面。

/** 表面的底色和模糊，和展开的进度条胶囊同一档。 */
export const capsuleGlassClass = (isDaylight: boolean) => (
    `backdrop-blur-xl ${isDaylight ? 'bg-white/60' : 'bg-black/40'}`
);

/** 投影和边沿：边沿画在阴影里，和播放页面板一样不占布局。文字跟歌曲主题色。 */
export const capsuleGlassStyle = (isDaylight: boolean): CSSProperties => ({
    boxShadow: `0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px ${panelEdgeColor(isDaylight)}`,
    color: 'var(--text-primary)',
});
