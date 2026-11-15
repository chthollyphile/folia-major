import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

// Tests the display policy and scheduling without opening or moving real desktop windows.
const require = createRequire(import.meta.url);
const { chooseAutoDisplay, createAutoDisplayController } = require('../../../electron/wallpaper/autoDisplay.cjs');
const main = { id: 1, bounds: { x: 0, y: 0, width: 2560, height: 1440 } };
const left = { id: 2, bounds: { x: -1280, y: 0, width: 1280, height: 2048 } };
const work = { ...main.bounds };

describe('automatic wallpaper display', () => {
    it('supports secondary displays to the right or above the primary display', () => {
        const right = { id: 3, bounds: { x: 2560, y: 0, width: 1280, height: 2048 } };
        const above = { id: 4, bounds: { x: 0, y: -1080, width: 1920, height: 1080 } };
        expect(chooseAutoDisplay([main, right], main, [work], main.bounds)).toBe(right);
        expect(chooseAutoDisplay([main, above], main, [work], main.bounds)).toBe(above);
    });
    it('chooses the nearest secondary display independent of enumeration order', () => {
        const far = { id: 3, bounds: { x: 6000, y: 0, width: 1920, height: 1080 } };
        expect(chooseAutoDisplay([main, far, left], main, [work], main.bounds)).toBe(left);
    });
    it('returns to the main display for a clear desktop', () => {
        expect(chooseAutoDisplay([main, left], main, [], main.bounds)).toBe(main);
    });
    it('uses the left display when a work window covers the main display', () => {
        expect(chooseAutoDisplay([main, left], main, [work], main.bounds)).toBe(left);
    });
    it('ignores small popups, marked overlays and windows on the other monitor', () => {
        for (const window of [{ ...work, width: 100 }, { ...work, ignored: true }, { ...work, x: -1000 },
            {x:100,y:100,width:900,height:600}, {x:0,y:0,width:2500,height:1400}]) {
            expect(chooseAutoDisplay([main, left], main, [window], main.bounds)).toBe(main);
        }
    });
    it('keeps the main display when no secondary display is connected', () => {
        expect(chooseAutoDisplay([main], main, [work], main.bounds)).toBe(main);
    });
    it('leaves same-display geometry updates to the existing metrics handler', async () => {
        let time = 0;
        const move = vi.fn();
        const controller = createAutoDisplayController({
            isActive: () => true, now: () => time,
            getSnapshot: () => ({ displays: [main, left], primary: main, windows: [],
                primaryScreenBounds: main.bounds, current: { ...main, bounds: { ...main.bounds, width: 1920 } } }), move,
        });
        await controller.tick(); time = 2000;
        await controller.tick(); await controller.tick(); await controller.tick();
        expect(move).not.toHaveBeenCalled();
    });
    it('compares native rectangles to physical main-display bounds for mixed DPI', () => {
        const dipMain = { ...main, bounds: { x: 100, y: 0, width: 1280, height: 720 } };
        const physical = { x: 200, y: 0, width: 2560, height: 1440 };
        expect(chooseAutoDisplay([dipMain, left], dipMain, [{ ...physical }], physical)).toBe(left);
        expect(chooseAutoDisplay([dipMain, left], dipMain, [{ ...dipMain.bounds }], physical)).toBe(dipMain);
    });
    it('recognizes maximized work-area bounds without counting an ordinary window', () => {
        const workspace = {...main.bounds,height:1400};
        expect(chooseAutoDisplay([main,left], main, [{x:-8,y:-8,width:2576,height:1416,maximized:true}], main.bounds, workspace)).toBe(left);
        expect(chooseAutoDisplay([main,left], main, [{x:8,y:8,width:2544,height:1384}], main.bounds, workspace)).toBe(main);
        expect(chooseAutoDisplay([main,left], main, [workspace], main.bounds, workspace)).toBe(main);
    });
    it('requires a stable target and does not repeatedly move the current display', async () => {
        let time = 0;
        let occupied = false;
        let current = main;
        const move = vi.fn(async target => { current = target; });
        const controller = createAutoDisplayController({
            isActive: () => true, now: () => time,
            getSnapshot: () => ({ displays: [main, left], primary: main, windows: occupied ? [work] : [], primaryScreenBounds: main.bounds, current }),
            move,
        });
        await controller.tick(); time = 2000; await controller.tick();
        expect(move).not.toHaveBeenCalled();
        occupied = true; await controller.tick(); time = 2500; await controller.tick();
        expect(move).not.toHaveBeenCalled();
        time = 3600; await controller.tick(); await controller.tick();
        expect(move).toHaveBeenCalledTimes(1);
        expect(current).toBe(left);
        occupied = false; await controller.tick(); time = 5200; await controller.tick();
        expect(current).toBe(main);
    });
    it('does no native work while disabled and cleans up its timer', async () => {
        const getSnapshot = vi.fn();
        const clear = vi.fn();
        const set = vi.fn(() => 12);
        const controller = createAutoDisplayController({ isActive: () => false, getSnapshot, move: vi.fn(), setIntervalFn: set, clearIntervalFn: clear });
        controller.start(); controller.start(); await controller.tick(); controller.stop(); controller.stop();
        expect(set).toHaveBeenCalledTimes(1);
        expect(clear).toHaveBeenCalledWith(12);
        expect(getSnapshot).not.toHaveBeenCalled();
    });
    it('serializes asynchronous moves and samples the new state afterwards', async () => {
        let time = 0;
        let finish!: () => void;
        const move = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
        const controller = createAutoDisplayController({
            isActive: () => true, now: () => time,
            getSnapshot: () => ({ displays: [main, left], primary: main, windows: [work], primaryScreenBounds: main.bounds, current: main }), move,
        });
        await controller.tick(); time = 2000;
        const moving = controller.tick(); await controller.tick();
        expect(move).toHaveBeenCalledTimes(1);
        finish(); await moving;
    });
    it('does not interpret a failed enumeration as an empty desktop', async () => {
        const onError = vi.fn(); const move = vi.fn();
        const controller = createAutoDisplayController({ isActive: () => true, getSnapshot: () => { throw new Error('unavailable'); }, move, onError });
        await controller.tick(); await controller.tick();
        expect(move).not.toHaveBeenCalled(); expect(onError).toHaveBeenCalledTimes(1);
    });
});
