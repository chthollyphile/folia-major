import { EventEmitter } from 'events';
import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/macDockMenu.test.ts
// The macOS Dock menu: what it shows for a playback report, which items it enables, where its clicks
// go, when it rebuilds, and that it forgets a page that reloads, crashes or closes but not an iframe.
const require = createRequire(import.meta.url);

type DockState = {
    hasActiveTrack: boolean;
    canGoPrevious: boolean;
    canGoNext: boolean;
    isPlaying: boolean;
    title: string;
    artist: string;
    loopMode: 'off' | 'all' | 'one';
    canCycleLoop: boolean;
};
type TemplateItem = { type?: string; label?: string; enabled?: boolean; click?: () => void };

const {
    normalizeDockPlaybackState,
    buildDockPlaybackMenuTemplate,
    createMacDockMenu,
} = require('../../../electron/macDockMenu.cjs') as {
    normalizeDockPlaybackState: (state: unknown) => DockState;
    buildDockPlaybackMenuTemplate: (options: {
        state: DockState;
        locale: Record<string, string>;
        windowAvailable: boolean;
        onTransport: (action: string) => void;
        onCycleLoop: () => void;
    }) => TemplateItem[];
    createMacDockMenu: (options: {
        app: unknown;
        Menu: unknown;
        isSupported: boolean;
        getMainWindow: () => unknown;
        getLocale: () => Record<string, string>;
        sendTransport: (action: string) => void;
    }) => {
        refresh: () => void;
        setState: (state: unknown) => void;
        reset: () => void;
        attach: (win: unknown) => void;
    };
};

const locale = {
    dockNotPlaying: 'Not Playing',
    dockRepeat: 'Repeat: {mode}',
    dockRepeatOff: 'Off',
    dockRepeatAll: 'All',
    dockRepeatOne: 'One',
    dockPrevious: 'Previous Track',
    dockPlay: 'Play',
    dockPause: 'Pause',
    dockNext: 'Next Track',
};

const playing = {
    hasActiveTrack: true,
    canGoPrevious: true,
    canGoNext: false,
    isPlaying: true,
    title: 'Song',
    artist: 'Singer',
    loopMode: 'one',
    canCycleLoop: true,
};

const makeWindow = () => {
    const webContents = Object.assign(new EventEmitter(), {
        send: vi.fn(),
        isDestroyed: () => false,
    });
    return { webContents, isDestroyed: () => false };
};

const makeDock = ({ isSupported = true, ready = true } = {}) => {
    let mainWindow: ReturnType<typeof makeWindow> | null = makeWindow();
    const menus: TemplateItem[][] = [];
    const app = {
        isReady: () => ready,
        dock: { setMenu: vi.fn() },
    };
    const Menu = {
        buildFromTemplate: (template: TemplateItem[]) => {
            menus.push(template);
            return template;
        },
    };
    const dock = createMacDockMenu({
        app,
        Menu,
        isSupported,
        getMainWindow: () => mainWindow,
        getLocale: () => locale,
        sendTransport: (action: string) => mainWindow?.webContents.send('thumbar-action', action),
    });
    return {
        dock,
        app,
        menus,
        getWindow: () => mainWindow,
        setWindow: (win: ReturnType<typeof makeWindow> | null) => { mainWindow = win; },
    };
};

const labels = (template: TemplateItem[]) => template.filter((item) => item.type !== 'separator').map((item) => [item.label, item.enabled]);

describe('macDockMenu', () => {
    it('cleans the report: control characters, long text and unknown loop modes', () => {
        const state = normalizeDockPlaybackState({
            hasActiveTrack: 1,
            title: '  A\nB\u0007  ',
            artist: 'x'.repeat(150),
            loopMode: 'shuffle',
        });
        expect(state.hasActiveTrack).toBe(true);
        expect(state.title).toBe('A B');
        expect(state.artist).toHaveLength(100);
        // Cut by character, so an emoji at the limit is kept whole or dropped, never halved.
        expect(normalizeDockPlaybackState({ title: `${'a'.repeat(99)}🎵🎵` }).title).toBe(`${'a'.repeat(99)}🎵`);
        expect(state.loopMode).toBe('off');
        expect(normalizeDockPlaybackState(null)).toMatchObject({ title: '', loopMode: 'off', isPlaying: false });
    });

    it('shows the track and enables only what the report allows', () => {
        const template = buildDockPlaybackMenuTemplate({
            state: normalizeDockPlaybackState(playing),
            locale,
            windowAvailable: true,
            onTransport: () => {},
            onCycleLoop: () => {},
        });
        expect(labels(template)).toEqual([
            ['Song — Singer', false],
            ['Previous Track', true],
            ['Pause', true],
            ['Next Track', false],
            ['Repeat: One', true],
        ]);
    });

    it('disables every control without a window or a track, and says nothing plays without a title', () => {
        const noWindow = buildDockPlaybackMenuTemplate({
            state: normalizeDockPlaybackState(playing),
            locale,
            windowAvailable: false,
            onTransport: () => {},
            onCycleLoop: () => {},
        });
        expect(labels(noWindow).slice(1).every(([, enabled]) => enabled === false)).toBe(true);

        const empty = buildDockPlaybackMenuTemplate({
            state: normalizeDockPlaybackState({}),
            locale,
            windowAvailable: true,
            onTransport: () => {},
            onCycleLoop: () => {},
        });
        expect(labels(empty)).toEqual([
            ['Not Playing', false],
            ['Previous Track', false],
            ['Play', false],
            ['Next Track', false],
            ['Repeat: Off', false],
        ]);
    });

    it('sends clicks down the existing taskbar and remote-control routes', () => {
        const { dock, menus, getWindow } = makeDock();
        dock.setState(playing);
        const template = menus.at(-1)!;
        const click = (label: string) => template.find((item) => item.label === label)!.click!();
        click('Previous Track');
        click('Pause');
        click('Repeat: One');
        const send = getWindow()!.webContents.send;
        expect(send).toHaveBeenNthCalledWith(1, 'thumbar-action', 'previous');
        expect(send).toHaveBeenNthCalledWith(2, 'thumbar-action', 'play-pause');
        expect(send).toHaveBeenNthCalledWith(3, 'remote-control-command', { type: 'cycle-loop-mode' });
    });

    it('rebuilds only when what it shows changes', () => {
        const { dock, app } = makeDock();
        dock.setState(playing);
        dock.setState({ ...playing });
        dock.refresh();
        expect(app.dock.setMenu).toHaveBeenCalledTimes(1);
        dock.setState({ ...playing, isPlaying: false });
        expect(app.dock.setMenu).toHaveBeenCalledTimes(2);
    });

    it('never touches the Dock off macOS or before the app is ready', () => {
        const off = makeDock({ isSupported: false });
        off.dock.setState(playing);
        off.dock.refresh();
        off.dock.reset();
        off.dock.attach(makeWindow());
        expect(off.app.dock.setMenu).not.toHaveBeenCalled();

        const early = makeDock({ ready: false });
        early.dock.refresh();
        expect(early.app.dock.setMenu).not.toHaveBeenCalled();
    });

    it('forgets the main page once a new document commits or it crashes, not for a blocked navigation or another window', () => {
        const { dock, menus, getWindow } = makeDock();
        const win = getWindow()!;
        const other = makeWindow();
        dock.attach(win);
        dock.attach(other);
        dock.setState(playing);

        // A navigation will-navigate then blocks (a file dropped on the window) only ever starts.
        win.webContents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
        win.webContents.emit('did-navigate-in-page', {}, 'http://localhost:3000/#x', true);
        other.webContents.emit('render-process-gone', {}, {});
        other.webContents.emit('did-navigate', {}, 'http://localhost:3000/');
        expect(menus.at(-1)![0].label).toBe('Song — Singer');

        win.webContents.emit('did-navigate', {}, 'http://localhost:3000/');
        expect(menus.at(-1)![0].label).toBe('Not Playing');

        dock.setState(playing);
        win.webContents.emit('render-process-gone', {}, {});
        expect(menus.at(-1)![0].label).toBe('Not Playing');
    });

    it('greys the controls out once the main window is gone', () => {
        const { dock, menus, setWindow } = makeDock();
        dock.setState(playing);
        setWindow(null);
        dock.reset();
        expect(labels(menus.at(-1)!).every(([, enabled]) => enabled === false)).toBe(true);
    });
});
