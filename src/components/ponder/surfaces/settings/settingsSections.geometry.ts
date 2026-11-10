import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/settings/settingsSections.geometry.ts
// settingsSections.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 设置 · 外观最上面那一组「歌词动画」，坐标系是那块面板。
 *
 * 这一组没有小标题，卡里只有一行：左边名字和一句说明，右端写着现在用的样式和一个箭头。
 * 点这一行打开歌词样式窗口。
 */
export const LYRICS_ANIMATION_SETTINGS_GEOMETRY = {
    entry: { left: 0.04, right: 0.04, top: 0.26, height: 0.48 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 设置 · 外观里「主题」和「歌曲主题」两组，坐标系是那块面板。
 *
 * 「主题」一张卡三行：明暗模式（浅色、深色、跟随系统三段）、配色主题预设（内置、自定义两段）、
 * 打开 Theme Park。「歌曲主题」一张卡四行：主题自动切换，它管着的自动生成（缩进一级），
 * 主题生成来源（AI 推断、封面取色两段），优先使用自定义主题。
 */
export const THEME_SETTINGS_GEOMETRY = {
    headingTheme: { left: 0.04, top: 0.025, width: 0.10, height: 0.02 },
    cardTheme: { left: 0.03, right: 0.03, top: 0.07, height: 0.36 },
    brightness: { left: 0.06, right: 0.06, top: 0.08, height: 0.11 },
    presetRow: { left: 0.06, right: 0.06, top: 0.195, height: 0.11 },
    /** 「配色主题预设」右端那两段，各自一个锚点。 */
    presetTrack: { right: 0.06, top: 0.212, width: 0.32, height: 0.076 },
    presetDefault: { right: 0.196, top: 0.218, width: 0.18, height: 0.064 },
    presetCustom: { right: 0.064, top: 0.218, width: 0.128, height: 0.064 },
    themePark: { left: 0.06, right: 0.06, top: 0.31, height: 0.11 },
    headingSong: { left: 0.04, top: 0.485, width: 0.14, height: 0.02 },
    cardSong: { left: 0.03, right: 0.03, top: 0.53, bottom: 0.02 },
    autoSwitch: { left: 0.06, right: 0.06, top: 0.54, height: 0.105 },
    autoGenerate: { left: 0.10, right: 0.06, top: 0.65, height: 0.105 },
    source: { left: 0.06, right: 0.06, top: 0.76, height: 0.105 },
    preferCustom: { left: 0.06, right: 0.06, top: 0.87, height: 0.105 },
} satisfies Record<string, PonderRelativeRect>;
