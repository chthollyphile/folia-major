'use strict';

// electron/windowsThumbar.cjs
// The Windows taskbar thumbnail toolbar (thumbar): the playback state the renderer reports becomes
// the taskbar buttons, and the cached buttons are written again whenever the window becomes visible.
// Hiding a window makes Windows drop its taskbar button, and Electron records the thumbar as not
// added when the window hides (SetThumbarButtonsAdded(false) in native_window_views.cc, #28390), so
// the next write re-adds the buttons; nothing writes on show, which is what this module is for.

const EMPTY_THUMBAR_STATE = {
    hasActiveTrack: false,
    canGoPrevious: false,
    canGoNext: false,
    isPlaying: false,
};

/** Reads the renderer's report into the four flags the buttons use. */
function normalizeThumbarState(state) {
    return {
        hasActiveTrack: Boolean(state?.hasActiveTrack),
        canGoPrevious: Boolean(state?.canGoPrevious),
        canGoNext: Boolean(state?.canGoNext),
        isPlaying: Boolean(state?.isPlaying),
    };
}

function isSameThumbarState(a, b) {
    return a.hasActiveTrack === b.hasActiveTrack
        && a.canGoPrevious === b.canGoPrevious
        && a.canGoNext === b.canGoNext
        && a.isPlaying === b.isPlaying;
}

/** The buttons shown while a track is loaded; an empty list removes them. */
function buildThumbarButtons({ state, icons, sendAction }) {
    if (!state.hasActiveTrack) {
        return [];
    }
    return [
        {
            tooltip: 'Previous Track',
            icon: icons.previous,
            flags: state.canGoPrevious ? [] : ['disabled'],
            click: () => sendAction('previous'),
        },
        {
            tooltip: state.isPlaying ? 'Pause' : 'Play',
            icon: state.isPlaying ? icons.pause : icons.play,
            click: () => sendAction('play-pause'),
        },
        {
            tooltip: 'Next Track',
            icon: icons.next,
            flags: state.canGoNext ? [] : ['disabled'],
            click: () => sendAction('next'),
        },
    ];
}

/**
 * The taskbar buttons' owner. `isSupported` is false off Windows, where every call does nothing;
 * `getWindow()` returns the live main window (or null), `sendAction(action)` the renderer route for
 * a click.
 */
function createWindowsThumbar({ isSupported, getWindow, icons, sendAction }) {
    let state = normalizeThumbarState(EMPTY_THUMBAR_STATE);
    // The window the buttons were last written to successfully. A rebuilt window has no buttons yet
    // even when the playback state it reports is the same as before, so the state alone cannot skip
    // a write; a failed write leaves this null so the next report tries again.
    let appliedWindow = null;

    const liveWindow = () => {
        if (!isSupported) {
            return null;
        }
        const win = getWindow();
        return win && !win.isDestroyed() ? win : null;
    };

    const applyButtons = (win, nextState) => {
        try {
            return Boolean(win.setThumbarButtons(buildThumbarButtons({ state: nextState, icons, sendAction })));
        } catch (error) {
            console.warn('[Electron] Failed to set Windows thumbar buttons', error);
            return false;
        }
    };

    /** The renderer's report; an unchanged report already on the same window is not written again. */
    const setState = (nextState) => {
        const normalized = normalizeThumbarState(nextState);
        const win = liveWindow();
        if (!win) {
            state = normalized;
            return false;
        }
        // A hidden window has no taskbar button to write to, and Electron records the thumbar as
        // added even when ThumbBarAddButtons fails on it, which would turn the replay on show into
        // an update of buttons that were never attached. Keep the report for the replay instead.
        if (!win.isVisible()) {
            state = normalized;
            appliedWindow = null;
            return false;
        }
        if (appliedWindow === win && isSameThumbarState(normalized, state)) {
            return true;
        }
        const applied = applyButtons(win, normalized);
        state = normalized;
        appliedWindow = applied ? win : null;
        return applied;
    };

    /**
     * Writes the cached buttons on a window that has just become visible again: Windows rebuilt its
     * taskbar button and Electron has already forgotten the old thumbar on hide, so this write is
     * what puts the buttons back. `taskbarButtonVisible` is false while the "hide taskbar icon"
     * setting is on, where there is no taskbar button to attach them to.
     */
    const replay = ({ taskbarButtonVisible }) => {
        const win = liveWindow();
        if (!win || !taskbarButtonVisible || !state.hasActiveTrack) {
            return false;
        }
        const applied = applyButtons(win, state);
        appliedWindow = applied ? win : null;
        return applied;
    };

    /** A new main window starts with no taskbar buttons until its page reports a track. */
    const reset = () => {
        state = normalizeThumbarState(EMPTY_THUMBAR_STATE);
        appliedWindow = null;
    };

    return { setState, replay, reset };
}

module.exports = {
    normalizeThumbarState,
    buildThumbarButtons,
    createWindowsThumbar,
};
