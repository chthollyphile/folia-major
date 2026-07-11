// src/components/modal/userGuideContent.ts

const isMac = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('mac');

export type UserGuideShortcut = {
    id: string;
    titleKey: string;
    fallback: string;
    keys: string[];
    separator?: '+' | '/';
};

export type GuidePage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const USER_GUIDE_PAGE_COUNT = 7;
export const USER_GUIDE_AUTO_OPEN_VERSION: string | null = '0.5.26';

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
