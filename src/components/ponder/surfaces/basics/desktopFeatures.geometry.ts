import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/basics/desktopFeatures.geometry.ts
// desktopFeatures.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 桌面端那三样东西的示意图，坐标系是 page。
 *
 * 画的是一整块桌面：主窗口摆在中间，任务栏贴底、托盘图标在它右端，遥控窗口是一张
 * 浮在上面的小卡。三样东西的关系（壁纸沉到最底、托盘在系统那一侧、遥控是另一个窗口）
 * 只有摆在同一张桌面上才看得出来。
 */
export const DESKTOP_FEATURES_GEOMETRY = {
    /** 桌面本身要一直铺到任务栏底下：只铺到窗口下沿的话，任务栏会飘在桌面外面。 */
    desktop: { left: 0.03, right: 0.03, top: 0.04, bottom: 0.03 },
    /** 相对 page：主窗口。壁纸模式下它沉到桌面最底层。 */
    mainWindow: { left: 0.12, top: 0.12, width: 0.5, height: 0.56 },
    /** 相对 page：遥控窗口，浮在主窗口之上的一张小卡。 */
    remoteWindow: { right: 0.08, top: 0.22, width: 0.22, height: 0.26 },
    /** 相对 page：系统任务栏，贴底。 */
    taskbar: { left: 0.03, right: 0.03, bottom: 0.05, height: 0.09 },
    /** 相对 page：托盘图标，在任务栏右端。 */
    trayIcon: { right: 0.06, bottom: 0.062, width: 0.032, square: true },
    /** 相对 page：托盘菜单，从托盘图标上方弹出。 */
    trayMenu: { right: 0.04, bottom: 0.16, width: 0.26, height: 0.42 },
} satisfies Record<string, PonderRelativeRect>;
