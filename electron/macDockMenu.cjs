'use strict';

// electron/macDockMenu.cjs
// The macOS Dock icon's menu: the current track, previous / play-pause / next and the repeat mode.
// It reads the same playback state the renderer reports for the Windows taskbar buttons
// (`thumbar-update-buttons`) and sends the same commands back (`thumbar-action` through main's
// `sendThumbarAction`, and the remote window's `cycle-loop-mode`), so there is one playback route for every platform's controls.

const LOOP_MODES = ['off', 'all', 'one'];
const TEXT_LIMIT = 100;

/** The state shown while nothing is known: no window, a page that is loading or has crashed. */
function createEmptyDockPlaybackState() {
    return {
        hasActiveTrack: false,
        canGoPrevious: false,
        canGoNext: false,
        isPlaying: false,
        title: '',
        artist: '',
        loopMode: 'off',
        canCycleLoop: false,
    };
}

const cleanText = (value) => (
    typeof value === 'string'
    // Control characters would break the menu line; the cap keeps a long title from widening it.
        ? Array.from(value.replace(/[\x00-\x1f\x7f]/g, ' ').trim()).slice(0, TEXT_LIMIT).join('')
        : ''
);

/** Reads the renderer's report into a plain state; anything malformed falls back to "off" or empty. */
function normalizeDockPlaybackState(state) {
    return {
        hasActiveTrack: Boolean(state?.hasActiveTrack),
        canGoPrevious: Boolean(state?.canGoPrevious),
        canGoNext: Boolean(state?.canGoNext),
        isPlaying: Boolean(state?.isPlaying),
        title: cleanText(state?.title),
        artist: cleanText(state?.artist),
        loopMode: LOOP_MODES.includes(state?.loopMode) ? state.loopMode : 'off',
        canCycleLoop: Boolean(state?.canCycleLoop),
    };
}

function isSameDockPlaybackState(a, b) {
    return Object.keys(a).every((key) => a[key] === b[key]);
}

/**
 * The menu template. `windowAvailable` is false while there is no main window to send to;
 * `onTransport(action)` and `onCycleLoop()` run the clicks.
 */
function buildDockPlaybackMenuTemplate({ state, locale, windowAvailable, onTransport, onCycleLoop }) {
    const available = Boolean(windowAvailable && state.hasActiveTrack);
    const trackLabel = state.title
        ? [state.title, state.artist].filter(Boolean).join(' — ')
        : locale.dockNotPlaying;
    const repeatLabel = { off: locale.dockRepeatOff, all: locale.dockRepeatAll, one: locale.dockRepeatOne }[state.loopMode];
    return [
        { label: trackLabel, enabled: false },
        { type: 'separator' },
        { label: locale.dockPrevious, enabled: available && state.canGoPrevious, click: () => onTransport('previous') },
        { label: state.isPlaying ? locale.dockPause : locale.dockPlay, enabled: available, click: () => onTransport('play-pause') },
        { label: locale.dockNext, enabled: available && state.canGoNext, click: () => onTransport('next') },
        { type: 'separator' },
        { label: locale.dockRepeat.replace('{mode}', repeatLabel), enabled: available && state.canCycleLoop, click: () => onCycleLoop() },
    ];
}

/** What the built menu shows, without the click handlers: equal signatures need no new menu. */
const templateSignature = (template) => JSON.stringify(template.map(({ type, label, enabled }) => [type, label, enabled]));

/**
 * The Dock menu's owner. `isSupported` is false off macOS, where every call does nothing and
 * `app.dock` is never touched. `getMainWindow()` returns the current main window (or null),
 * `getLocale()` the main-process text table, `sendTransport(action)` the taskbar buttons' route
 * (main's `sendThumbarAction`).
 */
function createMacDockMenu({ app, Menu, isSupported, getMainWindow, getLocale, sendTransport }) {
    let state = createEmptyDockPlaybackState();
    let shownSignature = null;

    const liveWindow = () => {
        const win = getMainWindow();
        return win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win : null;
    };

    const refresh = () => {
        if (!isSupported || !app.isReady() || !app.dock) {
            return;
        }
        const template = buildDockPlaybackMenuTemplate({
            state,
            locale: getLocale(),
            windowAvailable: Boolean(liveWindow()),
            onTransport: sendTransport,
            onCycleLoop: () => liveWindow()?.webContents.send('remote-control-command', { type: 'cycle-loop-mode' }),
        });
        const signature = templateSignature(template);
        if (signature === shownSignature) {
            return;
        }
        shownSignature = signature;
        app.dock.setMenu(Menu.buildFromTemplate(template));
    };

    /** The renderer's report; rebuilds only when something shown changed. */
    const setState = (nextState) => {
        if (!isSupported) {
            return;
        }
        const normalized = normalizeDockPlaybackState(nextState);
        if (isSameDockPlaybackState(normalized, state)) {
            return;
        }
        state = normalized;
        refresh();
    };

    const reset = () => {
        if (!isSupported) {
            return;
        }
        state = createEmptyDockPlaybackState();
        refresh();
    };

    /**
   * Forgets the state when `win`'s page goes away while it is the main window: it reloads or
   * navigates (an iframe loading inside it, such as a URL background, does not count), crashes or
   * closes. The new page reports again once it is up.
   */
    const attach = (win) => {
        if (!isSupported) {
            return;
        }
        const resetIfMain = () => {
            if (getMainWindow() === win) {
                reset();
            }
        };
        // did-navigate: the main frame committed a new document. Not did-start-navigation: a navigation
        // that will-navigate then blocks (a file dropped on the window) would clear a page that stays.
        win.webContents.on('did-navigate', resetIfMain);
        win.webContents.on('render-process-gone', resetIfMain);
    };

    return { refresh, setState, reset, attach };
}

module.exports = {
    createEmptyDockPlaybackState,
    normalizeDockPlaybackState,
    buildDockPlaybackMenuTemplate,
    createMacDockMenu,
};
