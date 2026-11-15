import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Exercise Folia's actual asynchronous display mover against an export starting during handoff.
const require = createRequire(import.meta.url);
const source = fs.readFileSync(new URL('../../../electron/main.cjs', import.meta.url), 'utf8');
const start = source.indexOf('async function applyWallpaperDisplayChoice(');
const end = source.indexOf('\n// Stores the display', start);
const { isSameDisplay, shouldMoveWallpaper } = require('../../../electron/wallpaper/wallpaperDisplay.cjs');
const { createAutoDisplaySession } = require('../../../electron/wallpaper/autoDisplaySession.cjs');

afterEach(() => vi.useRealTimers());

function fixture() {
    const current = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
    const target = { id: 2, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };
    let finish!: (value: unknown) => void;
    const rebuild = vi.fn();
    const context = {
        process: { platform: 'win32' },
        isWindowsWallpaperMode: () => true,
        isX11WallpaperMode: () => false,
        windowsWallpaperTarget: { current: () => current, peek: () => target, rememberDisplay: vi.fn() },
        windowsWallpaper: { moveToRect: vi.fn(() => new Promise(resolve => { finish = resolve; })) },
        mainWindow: { isDestroyed: () => false },
        wallpaperDisplayPending: Promise.resolve(), wallpaperExportPreparing: false, videoExportWindowRestoreState: null,
        getWallpaperDisplayChoice: () => target,
        screen: { getAllDisplays: () => [current, target], dipToScreenRect: (_win: unknown, bounds: unknown) => bounds },
        isSameDisplay, shouldMoveWallpaper,
        wallpaperDisplayApplyGeneration: 0,
        requestWindowPlaybackHandoff: vi.fn(() => new Promise(resolve => { finish = resolve; })),
        recreateMainWindowWithTransparencyMode: rebuild,
        isTransparentPlayerBackgroundEnabled: () => true,
        console: { log: vi.fn() },
    };
    const apply = vm.runInNewContext(`${source.slice(start, end)}; applyWallpaperDisplayChoice`, context);
    return { apply, rebuild, finish: () => finish({}), context };
}

describe('automatic display in-place movement', () => {
    it('reapplies geometry on the same display through the resident queue', async () => {
        const f = fixture();
        const resized = { id: 1, bounds: { x: 0, y: 0, width: 1080, height: 1920 } };
        f.context.windowsWallpaperTarget.peek = () => resized;
        f.context.getWallpaperDisplayChoice = () => resized;
        expect(await f.apply({ choiceChanged: true })).toBe(false);
        const metrics = f.apply({ forceGeometry: true }); await Promise.resolve();
        f.finish(); expect(await metrics).toBe(true);
        expect(f.context.windowsWallpaper.moveToRect).toHaveBeenCalledWith(resized.bounds);
    });

    it('keeps topology reassertion behind an in-flight relocation', async () => {
        const f = fixture();
        const first = f.apply({ choiceChanged: true }); await Promise.resolve();
        const metrics = f.apply({ forceGeometry: true });
        expect(f.context.windowsWallpaper.moveToRect).toHaveBeenCalledTimes(1);
        f.finish(); await first; await Promise.resolve();
        expect(f.context.windowsWallpaper.moveToRect).toHaveBeenCalledTimes(2);
        f.finish(); expect(await metrics).toBe(true);
    });

    it('does not launch a one-shot helper for topology events, even when movement is skipped', async () => {
        const start = source.indexOf('const reassertWallpaperGeometry = async () => {');
        const end = source.indexOf('\n    const scheduleWallpaperGeometryReassert', start);
        const context = { isWindowsWallpaperMode: () => true, windowsWallpaper: { isAttached: () => true },
            applyWallpaperDisplayChoice: vi.fn(async () => false), spawn: vi.fn(),
            resolveWallpaperHelperPath: () => 'helper.exe', getMainWindowNativeHwnd: () => 1 };
        const reassert = vm.runInNewContext(`${source.slice(start, end)}; reassertWallpaperGeometry`, context);
        await reassert();
        expect(context.applyWallpaperDisplayChoice).toHaveBeenCalledWith({ forceGeometry: true });
        expect(context.spawn).not.toHaveBeenCalled();
    });

    it('skips topology geometry writes during export preparation', async () => {
        const f = fixture(); f.context.wallpaperExportPreparing = true;
        expect(await f.apply({ forceGeometry: true })).toBe(false);
        expect(f.context.windowsWallpaper.moveToRect).not.toHaveBeenCalled();
    });

    it('reasserts current wallpaper topology and manual choice after export restores the window', () => {
        const start = source.indexOf("ipcMain.handle('video-export-restore-window', (event) => {");
        const end = source.indexOf('\n\n// The export file', start);
        let restore!: (event: unknown) => boolean;
        const context = {
            ipcMain: { handle: (_name: string, callback: typeof restore) => { restore = callback; } },
            isTrustedMainWindowContents: () => true, isWindowsWallpaperMode: () => true,
            mainWindow: { isDestroyed: () => false, setBounds: vi.fn(), maximize: vi.fn() },
            videoExportWindowRestoreState: { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, isFullScreen: false, isMaximized: false },
            backgroundThrottling: { refresh: vi.fn() },
            applyWallpaperDisplayChoice: vi.fn(async () => true),
        };
        vm.runInNewContext(source.slice(start, end), context);
        expect(restore({})).toBe(true);
        expect(context.videoExportWindowRestoreState).toBeNull();
        expect(context.applyWallpaperDisplayChoice).toHaveBeenCalledWith({ forceGeometry: true });
    });
    it('retains a completed automatic move when a metrics request supersedes its generation', async () => {
        vi.useFakeTimers();
        const f = fixture();
        const primary = { ...f.context.windowsWallpaperTarget.current(), workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
        const secondary = f.context.windowsWallpaperTarget.peek();
        let actual = primary;
        const session = createAutoDisplaySession({
            platform: 'win32', store: { get: () => true },
            screen: { ...f.context.screen, getPrimaryDisplay: () => primary },
            canMove: () => true, getCurrentDisplay: () => actual, applyChoice: f.apply,
            readWindows: () => [{ ...primary.bounds, maximized: true }], onChange: vi.fn(),
        });
        f.context.windowsWallpaperTarget.current = () => actual;
        f.context.windowsWallpaperTarget.peek = () => session.getChoice();
        f.context.windowsWallpaperTarget.rememberDisplay = vi.fn(display => { actual = display; });
        f.context.getWallpaperDisplayChoice = () => session.getChoice();
        await session.tick(); vi.advanceTimersByTime(2000);
        const moving = session.tick(); await Promise.resolve();
        const metrics = f.apply(); f.finish(); await moving; await metrics;
        expect(actual.id).toBe(secondary.id);
        expect(session.getChoice().id).toBe(secondary.id);
        expect(await f.apply()).toBe(false);
        expect(f.context.windowsWallpaper.moveToRect).toHaveBeenCalledTimes(1);
    });
    it('honors a request to return while an earlier move is still in flight', async () => {
        const f=fixture(); const a={id:1,bounds:{x:0,y:0,width:1920,height:1080}};
        const b={id:2,bounds:{x:-1920,y:0,width:1920,height:1080}};
        let actual=a,choice=b;
        f.context.windowsWallpaperTarget.current=()=>actual;
        f.context.windowsWallpaperTarget.peek=()=>choice;
        f.context.windowsWallpaperTarget.rememberDisplay=vi.fn(display=>{actual=display});
        f.context.getWallpaperDisplayChoice=()=>choice;
        const first=f.apply({choiceChanged:true}); await Promise.resolve();
        choice=a; const back=f.apply({choiceChanged:true});
        f.finish(); await first; await Promise.resolve(); f.finish();
        expect(await back).toBe(true); expect(actual.id).toBe(1);
        expect(f.context.windowsWallpaper.moveToRect).toHaveBeenCalledTimes(2);
    });
    it('cancels queued moves if export preparation starts before native dispatch', async () => {
        const f=fixture();let unblock!:()=>void;
        f.context.wallpaperDisplayPending=new Promise<void>(resolve=>{unblock=resolve});
        const move=f.apply({choiceChanged:true});f.context.wallpaperExportPreparing=true;unblock();
        expect(await move).toBe(false);expect(f.context.windowsWallpaper.moveToRect).not.toHaveBeenCalled();
    });
    it('moves the existing window without a playback handoff or renderer rebuild', async () => {
        const f = fixture(); const switching = f.apply({ choiceChanged: true, canApply: () => true });
        await Promise.resolve();
        f.finish(); expect(await switching).toBe(true);
        expect(f.rebuild).not.toHaveBeenCalled();
        expect(f.context.requestWindowPlaybackHandoff).not.toHaveBeenCalled();
        expect(f.context.windowsWallpaper.moveToRect).toHaveBeenCalledWith({x:-1920,y:0,width:1920,height:1080});
    });
    it('does not move while an export is being prepared', async () => {
        const f = fixture(); f.context.wallpaperExportPreparing = true;
        expect(await f.apply({choiceChanged:true})).toBe(false);
        expect(f.context.windowsWallpaper.moveToRect).not.toHaveBeenCalled();
    });
    it('does not commit the target when the native move fails', async () => {
        const f = fixture(); f.context.windowsWallpaper.moveToRect.mockRejectedValueOnce(new Error('failed'));
        await expect(f.apply({choiceChanged:true})).rejects.toThrow('failed');
        expect(f.context.windowsWallpaperTarget.rememberDisplay).not.toHaveBeenCalled();
    });
    it('does not request a handoff after the automatic action is disabled', async () => {
        const f = fixture();
        expect(await f.apply({ choiceChanged: true, canApply: () => false })).toBe(false);
        expect(f.context.requestWindowPlaybackHandoff).not.toHaveBeenCalled();
    });
});
