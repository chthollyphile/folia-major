import { DESKTOP_FEATURES_GEOMETRY as D } from '../../surfaces/basics/desktopFeatures.geometry';
import type { PonderAnchorSource, PonderRelativeRect, PonderSceneScript, PonderTargetDefinition } from '../../../../types/ponder';

// src/components/ponder/targets/basics/foliaDesktop.target.ts
// 桌面端独有的三样：壁纸模式、系统托盘、遥控窗口。
//
// 这三样的共同点是它们都不在应用界面里 —— 一个把窗口沉到桌面最底层，一个住在系统托盘，
// 一个是另开的窗口。在应用里翻遍设置也看不到它们长什么样，所以这一章的示意图画的是
// 一整块桌面，而不是 Folia 自己的界面。
//
// 只在桌面版存在，所以整个目标挂 isAvailable：浏览器里讲一遍三个打不开的功能是纯噪声。

const page = {
    kind: 'synthetic',
    rect: { left: 0.5, top: 0.12, width: 0.6, height: 0.56, anchorX: 'center' },
    role: 'surface',
    surfaceKind: 'desktop-features',
    labelKey: 'ponder.anchors.desktop.page',
} satisfies PonderAnchorSource;

const region = (rect: PonderRelativeRect, labelKey: string): PonderAnchorSource => (
    { kind: 'relative', from: 'page', rect, role: 'region', labelKey }
);

const anchors = {
    page,
    mainWindow: region(D.mainWindow, 'ponder.anchors.desktop.mainWindow'),
    trayIcon: region(D.trayIcon, 'ponder.anchors.desktop.trayIcon'),
    trayMenu: region(D.trayMenu, 'ponder.anchors.desktop.trayMenu'),
    remoteWindow: region(D.remoteWindow, 'ponder.anchors.desktop.remoteWindow'),
} satisfies Record<string, PonderAnchorSource>;

/** 第一章：壁纸模式。窗口沉到桌面最底层，代价是键盘不再可用。 */
const wallpaper: PonderSceneScript = {
    id: 'folia-desktop-wallpaper',
    titleKey: 'ponder.scenes.foliaDesktopWallpaper',
    action: {
        kind: 'openSettings',
        anchorId: 'wallpaperMode',
        labelKey: 'ponder.actions.openWallpaperMode',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markWindow', anchor: 'mainWindow', intensity: [0, 0.6], durationMs: 480, keyframe: true },
        {
            kind: 'caption', id: 'normal',
            textKey: 'ponder.captions.desktop.windowNormal',
            pointTo: { anchor: 'mainWindow' }, durationMs: 5200, withPrevious: true,
        },
        { kind: 'pause', id: 'readNormal' },

        { kind: 'highlight', id: 'dimWindow', anchor: 'mainWindow', intensity: [0.6, 0], durationMs: 400, keyframe: true },
        { kind: 'surfaceState', id: 'sink', anchor: 'page', state: 'wallpaper-on', durationMs: 620, withPrevious: true },
        {
            kind: 'caption', id: 'wallpaper',
            textKey: 'ponder.captions.desktop.wallpaper',
            pointTo: { anchor: 'page' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readWallpaper' },

        {
            kind: 'caption', id: 'wallpaperExit',
            textKey: 'ponder.captions.desktop.wallpaperExit',
            pointTo: { anchor: 'trayIcon' }, durationMs: 6200, keyframe: true,
        },
        { kind: 'pause', id: 'readWallpaperExit' },
    ],
};

/** 第二章：系统托盘。窗口关掉之后 Folia 还在的那个地方。 */
const tray: PonderSceneScript = {
    id: 'folia-desktop-tray',
    titleKey: 'ponder.scenes.foliaDesktopTray',
    action: {
        kind: 'openSettings',
        anchorId: 'desktopTrayBehavior',
        labelKey: 'ponder.actions.openTraySettings',
    },
    anchors,
    steps: [
        { kind: 'highlight', id: 'markTray', anchor: 'trayIcon', intensity: [0, 0.9], durationMs: 460, keyframe: true },
        {
            kind: 'caption', id: 'trayIcon',
            textKey: 'ponder.captions.desktop.trayIcon',
            pointTo: { anchor: 'trayIcon' }, durationMs: 6000, withPrevious: true,
        },
        { kind: 'pause', id: 'readTrayIcon' },

        { kind: 'cursor', id: 'openMenu', to: { anchor: 'trayIcon' }, press: 'tap', durationMs: 640, keyframe: true },
        { kind: 'highlight', id: 'dimTray', anchor: 'trayIcon', intensity: [0.9, 0], durationMs: 400, withPrevious: true },
        { kind: 'surfaceState', id: 'showMenu', anchor: 'page', state: 'tray-menu', transition: 'slide-up', durationMs: 480 },
        {
            kind: 'caption', id: 'trayMenu',
            textKey: 'ponder.captions.desktop.trayMenu',
            pointTo: { anchor: 'trayMenu' }, durationMs: 6800, withPrevious: true,
        },
        { kind: 'pause', id: 'readTrayMenu' },
    ],
};

/** 第三章：遥控窗口。另开的一个小窗口，主窗口不在前台时也能控制播放。 */
const remote: PonderSceneScript = {
    id: 'folia-desktop-remote',
    titleKey: 'ponder.scenes.foliaDesktopRemote',
    anchors,
    steps: [
        { kind: 'keypress', id: 'openRemote', keys: ['Mod K'], at: { anchor: 'page', y: 1, offset: { y: 20 } }, durationMs: 1100, keyframe: true },
        { kind: 'surfaceState', id: 'showRemote', anchor: 'page', state: 'remote-open', transition: 'zoom', durationMs: 520 },
        {
            kind: 'caption', id: 'remote',
            textKey: 'ponder.captions.desktop.remote',
            pointTo: { anchor: 'remoteWindow' }, durationMs: 6400, withPrevious: true,
        },
        { kind: 'pause', id: 'readRemote' },

        { kind: 'highlight', id: 'markRemote', anchor: 'remoteWindow', intensity: [0, 0.85], durationMs: 440, keyframe: true },
        {
            kind: 'caption', id: 'remoteChrome',
            textKey: 'ponder.captions.desktop.remoteChrome',
            pointTo: { anchor: 'remoteWindow' }, durationMs: 6600, withPrevious: true,
        },
        { kind: 'pause', id: 'readRemoteChrome' },
    ],
};

export default {
    id: 'folia-desktop',
    titleKey: 'ponder.targets.foliaDesktop',
    category: 'desktop',
    summaryKey: 'ponder.summaries.folia_desktop',
    hoverSelector: null,
    // 浏览器里这三样一个都打不开，讲一遍纯属噪声。
    isAvailable: () => typeof window !== 'undefined' && Boolean(window.electron),
    scenes: [wallpaper, tray, remote],
} satisfies PonderTargetDefinition;
