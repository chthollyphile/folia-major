// src/components/modal/userGuideContent.ts

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac');

export type UserGuideShortcut = {
    id: string;
    titleKey: string;
    fallback: string;
    keys: string[];
    separator?: '+' | '/';
};

/** A touch gesture hint shown on the user guide page for touch devices. */
export type UserGuideTouchGesture = {
    id: string;
    /** i18n key for the action description (e.g. "播放 / 暂停"). */
    titleKey: string;
    /** Fallback text when the translation is unavailable. */
    fallback: string;
    /** i18n key for the gesture label shown as a badge (e.g. "双击屏幕"). */
    gestureKey: string;
    /** Fallback text for the gesture badge. */
    gestureFallback: string;
};

export type GuidePage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const USER_GUIDE_PAGE_COUNT = 7;
export const USER_GUIDE_AUTO_OPEN_VERSION: string | null = '0.6.2';

/** Touch gesture hints for the player page, shown when the device supports touch input. */
export const PLAYER_PAGE_TOUCH_GESTURES: UserGuideTouchGesture[] = [
    {
        id: 'touch-play-pause',
        titleKey: 'help.touchPlayPause',
        fallback: 'Play / Pause',
        gestureKey: 'help.touchGestureDoubleTap',
        gestureFallback: 'Double Tap',
    },
    {
        id: 'touch-prev-next',
        titleKey: 'help.touchPrevNext',
        fallback: 'Previous / Next Track',
        gestureKey: 'help.touchGestureSwipe',
        gestureFallback: 'Swipe \u2190 \u2192',
    },
    {
        id: 'touch-seek',
        titleKey: 'help.touchSeek',
        fallback: 'Seek Progress',
        gestureKey: 'help.touchGestureHoldDrag',
        gestureFallback: 'Hold + Drag \u2190 \u2192',
    },
];

export const PLAYER_PAGE_SHORTCUTS: UserGuideShortcut[] = [
    {
        id: 'open-command-palette',
        titleKey: 'help.openCommandPalette',
        fallback: 'Open command palette',
        keys: ['S'],
    },
    {
        id: 'play-pause',
        titleKey: 'help.playPause',
        fallback: 'Play / Pause',
        keys: ['Space'],
    },
    {
        id: 'previous-track',
        titleKey: 'help.previousTrack',
        fallback: 'Previous Track',
        keys: isMac ? ['Cmd', '←'] : ['Ctrl', '←'],
        separator: '+',
    },
    {
        id: 'next-track',
        titleKey: 'help.nextTrack',
        fallback: 'Next Track',
        keys: isMac ? ['Cmd', '→'] : ['Ctrl', '→'],
        separator: '+',
    },
    {
        id: 'seek-backward',
        titleKey: 'help.seekBackward',
        fallback: 'Seek Backward 5s',
        keys: ['←'],
    },
    {
        id: 'seek-forward',
        titleKey: 'help.seekForward',
        fallback: 'Seek Forward 5s',
        keys: ['→'],
    },
    {
        id: 'toggle-right-panel',
        titleKey: 'help.toggleRightPanel',
        fallback: 'Toggle right panel',
        keys: ['P'],
    },
    {
        id: 'hide-player-chrome',
        titleKey: 'help.hidePlayerChrome',
        fallback: 'Hide player controls',
        keys: ['H'],
    },
    {
        id: 'browser-fullscreen',
        titleKey: 'help.browserFullscreen',
        fallback: 'Fullscreen',
        keys: ['F11'],
    },
];
