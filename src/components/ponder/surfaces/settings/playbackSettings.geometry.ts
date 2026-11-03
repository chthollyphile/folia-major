import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/settings/playbackSettings.geometry.ts
// playbackSettings.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 播放与交互那几组设置的几何，坐标系都是各自那块面板。
 *
 * 分开量而不是共用一套：这几组行数不同，套同一组坐标会让高亮框落在别的行上 ——
 * 而「指着说这一行」正是这些教程唯一在做的事。
 */
export const TRANSITION_SETTINGS_GEOMETRY = {
    heading: { left: 0.04, top: 0.02, width: 0.30, height: 0.07 },
    card: { left: 0.03, right: 0.03, top: 0.12, bottom: 0.02 },
    enable: { left: 0.06, right: 0.06, top: 0.16, height: 0.11 },
    /** 「过渡模式」那一行：左边名字，右端先是一枚状态徽章，再是两段。 */
    modeLabel: { left: 0.06, top: 0.462, width: 0.18, height: 0.016 },
    badge: { left: 0.33, top: 0.435, width: 0.15, height: 0.07 },
    modeTrack: { right: 0.06, top: 0.41, width: 0.44, height: 0.12 },
    modeCrossfade: { right: 0.284, top: 0.42, width: 0.21, height: 0.10 },
    modeAutomix: { right: 0.066, top: 0.42, width: 0.21, height: 0.10 },
    detail: { left: 0.06, right: 0.06, top: 0.64, height: 0.14 },
    notice: { left: 0.06, right: 0.06, top: 0.82, height: 0.13 },
} satisfies Record<string, PonderRelativeRect>;

export const LIBRARY_WATCH_GEOMETRY = {
    heading: { left: 0.04, top: 0.02, width: 0.34, height: 0.08 },
    card: { left: 0.03, right: 0.03, top: 0.14, bottom: 0.02 },
    enable: { left: 0.06, right: 0.06, top: 0.19, height: 0.14 },
    roots: { left: 0.06, right: 0.06, top: 0.40, height: 0.32 },
    status: { left: 0.06, right: 0.35, top: 0.78, height: 0.08 },
    recheck: { right: 0.06, top: 0.76, width: 0.24, height: 0.12 },
} satisfies Record<string, PonderRelativeRect>;

/** 「加入队列」的默认行为：一句说明加两张并排的选项。 */
export const QUEUE_SETTINGS_GEOMETRY = {
    heading: { left: 0.04, top: 0.04, width: 0.30, height: 0.13 },
    card: { left: 0.03, right: 0.03, top: 0.25, bottom: 0.04 },
    /** 一行：左边名字，右端两段。 */
    copy: { left: 0.06, top: 0.59, width: 0.3, height: 0.03 },
    options: { right: 0.06, top: 0.455, width: 0.46, height: 0.30 },
    optionAppend: { right: 0.292, top: 0.485, width: 0.22, height: 0.24 },
    optionNext: { right: 0.068, top: 0.485, width: 0.22, height: 0.24 },
} satisfies Record<string, PonderRelativeRect>;

/** 歌词来源那一组：自动择优开关、本地/在线优先、以及全局时间轴偏移。 */
export const LYRICS_SOURCE_GEOMETRY = {
    heading: { left: 0.04, top: 0.02, width: 0.28, height: 0.07 },
    card: { left: 0.03, right: 0.03, top: 0.12, bottom: 0.02 },
    autoBest: { left: 0.06, right: 0.06, top: 0.16, height: 0.13 },
    /** 「本地歌曲歌词优先级」那一行：左边名字，右端两段。 */
    priorityLabel: { left: 0.06, top: 0.492, width: 0.28, height: 0.016 },
    priority: { right: 0.06, top: 0.43, width: 0.40, height: 0.14 },
    priorityLocal: { right: 0.262, top: 0.445, width: 0.19, height: 0.11 },
    priorityOnline: { right: 0.068, top: 0.445, width: 0.19, height: 0.11 },
    globalOffset: { left: 0.06, right: 0.06, top: 0.70, height: 0.15 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 设置 · 快捷操作里「海报墙」那一组：向左滑动打开（两段），海报墙上用 S 键打开命令窗口（开关）。
 * 教程讲的是第二行。
 */
export const GRID_HOTKEY_GEOMETRY = {
    heading: { left: 0.04, top: 0.04, width: 0.14, height: 0.12 },
    card: { left: 0.03, right: 0.03, top: 0.19, bottom: 0.05 },
    slideRow: { left: 0.06, right: 0.06, top: 0.22, height: 0.32 },
    toggle: { left: 0.06, right: 0.06, top: 0.58, height: 0.34 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 设置 · 播放控制 · 声音与设备里 ReplayGain 那一行，坐标系是那块面板。
 *
 * 结果层画的是控制面板来源页上那一小块同名控件：同一个值的另一处开关。两处并排画出来
 * 才看得出「改一处两处都变」，分别画在两张图上就又成了两个设置。
 */
export const REPLAY_GAIN_GEOMETRY = {
    heading: { left: 0.04, top: 0.03, width: 0.32, height: 0.10 },
    card: { left: 0.03, right: 0.03, top: 0.22, bottom: 0.04 },
    /** 一行：左边名字，右端关闭、单曲、专辑三段。 */
    copy: { left: 0.06, top: 0.585, width: 0.32, height: 0.03 },
    modes: { right: 0.06, top: 0.48, width: 0.46, height: 0.24 },
    modeOff: { right: 0.37, top: 0.51, width: 0.145, height: 0.18 },
    modeTrack: { right: 0.2175, top: 0.51, width: 0.145, height: 0.18 },
    modeAlbum: { right: 0.065, top: 0.51, width: 0.145, height: 0.18 },
    /** 以下属于结果层：来源页上那一小块。标题行右端那串就是这首歌的 T/A 分贝。 */
    panelTab: { left: 0.18, right: 0.18, top: 0.22, height: 0.44 },
    /** 相对 panelTab。 */
    panelSummary: { right: 0.05, top: 0.12, width: 0.42, height: 0.16 },
    panelModes: { left: 0.05, right: 0.05, bottom: 0.14, height: 0.26 },
} satisfies Record<string, PonderRelativeRect>;
