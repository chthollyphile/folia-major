import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/windowsThumbar.test.ts
// The Windows taskbar buttons: which flags a playback report turns into, when the report is not
// written again, the write that puts the buttons back on a window shown after being hidden, and
// that a failed write is retried.
const require = createRequire(import.meta.url);

type ThumbarState = {
    hasActiveTrack: boolean;
    canGoPrevious: boolean;
    canGoNext: boolean;
    isPlaying: boolean;
};
type ThumbarButton = {
    tooltip?: string;
    icon?: unknown;
    flags?: string[];
    click?: () => void;
};

const {
    normalizeThumbarState,
    buildThumbarButtons,
    createWindowsThumbar,
} = require('../../../electron/windowsThumbar.cjs') as {
    normalizeThumbarState: (state: unknown) => ThumbarState;
    buildThumbarButtons: (options: {
        state: ThumbarState;
        icons: Record<string, unknown>;
        sendAction: (action: string) => void;
    }) => ThumbarButton[];
    createWindowsThumbar: (options: {
        isSupported: boolean;
        getWindow: () => unknown;
        icons: Record<string, unknown>;
        sendAction: (action: string) => void;
    }) => {
        setState: (state: unknown) => boolean;
        replay: (options: { taskbarButtonVisible: boolean }) => boolean;
        noteHidden: () => void;
        reset: () => void;
    };
};

const icons = {
    previous: 'icon-previous',
    play: 'icon-play',
    pause: 'icon-pause',
    next: 'icon-next',
};

const playingState: ThumbarState = {
    hasActiveTrack: true,
    canGoPrevious: true,
    canGoNext: false,
    isPlaying: true,
};

type FakeWindow = {
    destroyed: boolean;
    visible: boolean;
    minimized: boolean;
    isDestroyed: () => boolean;
    isVisible: () => boolean;
    isMinimized: () => boolean;
    setThumbarButtons: ReturnType<typeof vi.fn>;
    setSkipTaskbar: ReturnType<typeof vi.fn>;
};

const createWindow = (): FakeWindow => {
    const win: FakeWindow = {
        destroyed: false,
        visible: true,
        minimized: false,
        isDestroyed: () => win.destroyed,
        // Electron on Windows reports a minimized window as not visible.
        isVisible: () => win.visible && !win.minimized,
        isMinimized: () => win.minimized,
        setThumbarButtons: vi.fn(() => true),
        setSkipTaskbar: vi.fn(),
    };
    return win;
};

describe('normalizeThumbarState', () => {
    it('turns a missing or malformed report into no track and disabled controls', () => {
        expect(normalizeThumbarState(undefined)).toEqual({
            hasActiveTrack: false,
            canGoPrevious: false,
            canGoNext: false,
            isPlaying: false,
        });
        expect(normalizeThumbarState({ hasActiveTrack: 1, canGoNext: 'yes' })).toEqual({
            hasActiveTrack: true,
            canGoPrevious: false,
            canGoNext: true,
            isPlaying: false,
        });
    });
});

describe('buildThumbarButtons', () => {
    it('shows nothing while no track is loaded', () => {
        expect(buildThumbarButtons({ state: normalizeThumbarState({}), icons, sendAction: vi.fn() })).toEqual([]);
    });

    it('builds previous, play-pause and next from the state', () => {
        const sendAction = vi.fn();
        const buttons = buildThumbarButtons({ state: playingState, icons, sendAction });

        expect(buttons).toHaveLength(3);
        expect(buttons[0]).toMatchObject({ tooltip: 'Previous Track', icon: 'icon-previous', flags: [] });
        expect(buttons[1]).toMatchObject({ tooltip: 'Pause', icon: 'icon-pause' });
        expect(buttons[2]).toMatchObject({ tooltip: 'Next Track', icon: 'icon-next', flags: ['disabled'] });

        buttons[0].click?.();
        buttons[1].click?.();
        buttons[2].click?.();
        expect(sendAction.mock.calls).toEqual([['previous'], ['play-pause'], ['next']]);
    });

    it('shows play while the track is paused', () => {
        const buttons = buildThumbarButtons({
            state: { ...playingState, isPlaying: false },
            icons,
            sendAction: vi.fn(),
        });

        expect(buttons[1]).toMatchObject({ tooltip: 'Play', icon: 'icon-play' });
    });
});

describe('createWindowsThumbar', () => {
    it('does nothing off Windows', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: false,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });

        expect(thumbar.setState(playingState)).toBe(false);
        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(false);
        expect(win.setThumbarButtons).not.toHaveBeenCalled();
    });

    it('writes the buttons from the report and skips an unchanged one', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });

        expect(thumbar.setState(playingState)).toBe(true);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(1);
        expect(win.setThumbarButtons.mock.calls[0][0]).toHaveLength(3);

        expect(thumbar.setState({ ...playingState })).toBe(true);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(1);

        thumbar.setState({ ...playingState, isPlaying: false });
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(2);
        expect(win.setThumbarButtons.mock.calls[1][0][1]).toMatchObject({ tooltip: 'Play' });
    });

    it('writes the same report again for a window that was rebuilt', () => {
        const first = createWindow();
        let current: FakeWindow | null = first;
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => current,
            icons,
            sendAction: vi.fn(),
        });

        thumbar.setState(playingState);
        expect(first.setThumbarButtons).toHaveBeenCalledTimes(1);

        const rebuilt = createWindow();
        current = rebuilt;
        thumbar.setState(playingState);
        expect(rebuilt.setThumbarButtons).toHaveBeenCalledTimes(1);
    });

    it('keeps a hidden window\'s report for the replay instead of writing unattached buttons', () => {
        const win = createWindow();
        win.visible = false;
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });

        expect(thumbar.setState(playingState)).toBe(false);
        expect(win.setThumbarButtons).not.toHaveBeenCalled();

        thumbar.setState({ ...playingState, isPlaying: false });
        expect(win.setThumbarButtons).not.toHaveBeenCalled();

        win.visible = true;
        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(true);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(1);
        expect(win.setThumbarButtons.mock.calls[0][0][1]).toMatchObject({ tooltip: 'Play' });
    });

    it('keeps writing to a minimized window, whose taskbar preview still shows the buttons', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });
        thumbar.setState(playingState);
        win.minimized = true;

        expect(thumbar.setState({ ...playingState, isPlaying: false })).toBe(true);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(2);
        expect(win.setThumbarButtons.mock.calls[1][0][1]).toMatchObject({ tooltip: 'Play' });
    });

    it('holds reports for a window hidden while minimized until the replay', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });
        thumbar.setState(playingState);
        win.minimized = true;
        win.visible = false;
        thumbar.noteHidden();

        expect(thumbar.setState({ ...playingState, isPlaying: false })).toBe(false);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(1);
        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(false);

        win.minimized = false;
        win.visible = true;
        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(true);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(2);
        expect(win.setThumbarButtons.mock.calls[1][0][1]).toMatchObject({ tooltip: 'Play' });
    });

    it('writes an unchanged report after a replay skipped for the hidden taskbar icon', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });
        thumbar.setState(playingState);
        thumbar.noteHidden();
        win.setThumbarButtons.mockClear();

        expect(thumbar.replay({ taskbarButtonVisible: false })).toBe(false);
        expect(win.setThumbarButtons).not.toHaveBeenCalled();

        // The "hide taskbar icon" setting is turned off: its replay puts the buttons back.
        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(true);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(1);
    });

    it('does not replay on a window that is not on screen', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });
        thumbar.setState(playingState);
        win.visible = false;
        thumbar.noteHidden();
        win.setThumbarButtons.mockClear();

        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(false);
        expect(win.setThumbarButtons).not.toHaveBeenCalled();
    });

    it('reports false without a live window', () => {
        const win = createWindow();
        win.destroyed = true;
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });

        expect(thumbar.setState(playingState)).toBe(false);
    });

    it('replays the cached buttons without touching the taskbar icon', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });
        thumbar.setState(playingState);
        win.setThumbarButtons.mockClear();

        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(true);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(1);
        expect(win.setThumbarButtons.mock.calls[0][0][0]).toMatchObject({ tooltip: 'Previous Track' });
        expect(win.setThumbarButtons.mock.calls[0][0][1]).toMatchObject({ tooltip: 'Pause' });
        expect(win.setSkipTaskbar).not.toHaveBeenCalled();
    });

    it('does not replay while the taskbar icon is meant to stay hidden', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });
        thumbar.setState(playingState);
        win.setThumbarButtons.mockClear();

        expect(thumbar.replay({ taskbarButtonVisible: false })).toBe(false);
        expect(win.setThumbarButtons).not.toHaveBeenCalled();
    });

    it('has nothing to replay before a track was reported', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });

        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(false);
        expect(win.setThumbarButtons).not.toHaveBeenCalled();
    });

    it('retries an unchanged report after the window refused the write', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const win = createWindow();
        win.setThumbarButtons.mockImplementation(() => false);
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });

        expect(thumbar.setState(playingState)).toBe(false);

        win.setThumbarButtons.mockImplementation(() => true);
        expect(thumbar.setState({ ...playingState })).toBe(true);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });

    it('retries an unchanged report after the write threw', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const win = createWindow();
        win.setThumbarButtons.mockImplementation(() => {
            throw new Error('thumbar unavailable');
        });
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });

        expect(thumbar.setState(playingState)).toBe(false);
        expect(warn).toHaveBeenCalled();

        win.setThumbarButtons.mockImplementation(() => true);
        expect(thumbar.setState({ ...playingState })).toBe(true);
        warn.mockRestore();
    });

    it('reports a failed replay instead of claiming the window has the buttons', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });
        thumbar.setState(playingState);
        win.setThumbarButtons.mockImplementation(() => false);
        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(false);

        win.setThumbarButtons.mockImplementation(() => true);
        expect(thumbar.setState({ ...playingState })).toBe(true);
        expect(win.setThumbarButtons).toHaveBeenCalledTimes(3);
        warn.mockRestore();
    });

    it('forgets the cached buttons on reset', () => {
        const win = createWindow();
        const thumbar = createWindowsThumbar({
            isSupported: true,
            getWindow: () => win,
            icons,
            sendAction: vi.fn(),
        });
        thumbar.setState(playingState);
        thumbar.reset();

        expect(thumbar.replay({ taskbarButtonVisible: true })).toBe(false);
    });
});
