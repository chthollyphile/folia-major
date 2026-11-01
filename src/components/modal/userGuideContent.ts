// src/components/modal/userGuideContent.ts

import { isMacPlatform as isMac } from '../../utils/platform';

export type UserGuideShortcut = {
    id: string;
    titleKey: string;
    fallback: string;
    keys: string[];
    separator?: '+' | '/';
};

export type GuidePage = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const USER_GUIDE_PAGE_COUNT = 7;
export const USER_GUIDE_AUTO_OPEN_VERSION: string | null = '0.7.25';

export type HelpTabShortcut = {
    id: string;
    titleKey: string;
    fallback: string;
    /** Rendered after the primary modifier, which the Help tab prints per platform. */
    key: string;
};

// The primary-modifier entry points, shown at the top of the settings Help tab. Every one of
// these is claimed in the command palette registry, so the two must be changed together.
export const HELP_TAB_PRIMARY_SHORTCUTS: HelpTabShortcut[] = [
    { id: 'quick-actions', titleKey: 'help.quickActions', fallback: 'Quick actions', key: 'K' },
    { id: 'queue-collage', titleKey: 'help.queueCollage', fallback: 'Queue collage', key: 'B' },
    { id: 'play-queue', titleKey: 'help.playQueue', fallback: 'Play queue', key: 'P' },
    { id: 'scratchpad', titleKey: 'help.scratchpad', fallback: 'Scratchpad', key: 'J' },
];

export type HelpTabPlayerControl = {
    id: string;
    /** One action, or the two a row pairs: the Help tab joins their names with a slash. */
    titleKeys: string[];
    /** Held with the primary modifier, which the Help tab prints per platform. */
    withPrimaryModifier?: boolean;
    /** One key for each action. */
    keys: string[];
};

// What the keyboard does on the player page, shown beside the entry points above.
export const HELP_TAB_PLAYER_CONTROLS: HelpTabPlayerControl[] = [
    { id: 'play-pause', titleKeys: ['help.playPause'], keys: ['Space'] },
    { id: 'previous-next-track', titleKeys: ['help.previousTrack', 'help.nextTrack'], withPrimaryModifier: true, keys: ['←', '→'] },
    { id: 'seek', titleKeys: ['help.seekBackward', 'help.seekForward'], keys: ['←', '→'] },
    { id: 'control-panel', titleKeys: ['help.openControlPanel'], keys: ['P'] },
];

export const PLAYER_PAGE_SHORTCUTS: UserGuideShortcut[] = [
    {
        id: 'open-command-palette',
        titleKey: 'help.openCommandPalette',
        fallback: 'Open command palette',
        keys: ['S'],
    },
    {
        id: 'open-command-palette-queue',
        titleKey: 'help.openCommandPaletteQueue',
        fallback: 'Open queue in command palette',
        keys: isMac ? ['Cmd', 'P'] : ['Ctrl', 'P'],
        separator: '+',
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
        id: 'cycle-right-panel-tabs',
        titleKey: 'help.cycleRightPanelTabs',
        fallback: 'Cycle open right panel tabs',
        keys: ['Tab'],
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
