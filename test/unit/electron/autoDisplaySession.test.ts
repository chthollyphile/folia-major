import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Check the opt-in session policy without loading Electron or sampling the user's desktop.
const require = createRequire(import.meta.url);
const { createAutoDisplaySession } = require('../../../electron/wallpaper/autoDisplaySession.cjs');
const { AUTO_DISPLAY_KEY } = require('../../../electron/wallpaper/autoDisplay.cjs');
const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const secondary = { id: 2, bounds: { x: -1080, y: 0, width: 1080, height: 1920 } };

function fixture(platform = 'win32', enabled = true) {
    const values = new Map([[AUTO_DISPLAY_KEY, enabled]]);
    let current = primary;
    const options = {
        platform,
        screen: { getAllDisplays: () => [primary, secondary], getPrimaryDisplay: () => primary,
            dipToScreenRect: vi.fn((_window: unknown, bounds: unknown) => bounds) },
        store: { get: (key: string) => values.get(key), set: vi.fn((key: string, value: boolean) => values.set(key, value)) },
        canMove: vi.fn(() => true), getCurrentDisplay: () => current,
        applyChoice: vi.fn(async (options: { choiceChanged: boolean; canApply?: () => boolean }) => { void options; return true; }),
        onChange: vi.fn(), logError: vi.fn(),
        readWindows: vi.fn(() => [{ ...primary.workArea, maximized: true }]),
    };
    const session = createAutoDisplaySession(options);
    return { session, options, values, setCurrent: (display: typeof primary) => { current = display; } };
}

async function settle(session: { tick: () => Promise<void> }) {
    await session.tick();
    vi.advanceTimersByTime(2000);
    await session.tick();
}

afterEach(() => vi.useRealTimers());

describe('Windows automatic wallpaper session', () => {
    it('defaults off and never samples the desktop until enabled', async () => {
        vi.useFakeTimers();
        const f = fixture('win32', false);
        await settle(f.session);
        expect(f.session.isEnabled()).toBe(false);
        expect(f.options.readWindows).not.toHaveBeenCalled();
        expect(f.options.applyChoice).not.toHaveBeenCalled();
    });

    it('does not read or write Windows preferences on other platforms', async () => {
        const f = fixture('darwin');
        f.session.toggle(); f.session.selectManual();
        await f.session.tick();
        expect(f.options.store.set).not.toHaveBeenCalled();
        expect(f.options.readWindows).not.toHaveBeenCalled();
    });

    it('uses physical screen geometry and keeps the automatic target transient', async () => {
        vi.useFakeTimers();
        const f = fixture();
        await settle(f.session);
        expect(f.session.getChoice().id).toBe(secondary.id);
        expect(f.options.screen.dipToScreenRect).toHaveBeenCalledWith(null, primary.bounds);
        expect(f.options.screen.dipToScreenRect).toHaveBeenCalledWith(null, primary.workArea);
        expect(f.options.store.set).not.toHaveBeenCalled();
        expect(f.options.onChange).toHaveBeenCalledOnce();
    });

    it('rolls back a target when the native move is rejected', async () => {
        vi.useFakeTimers();
        const f = fixture();
        f.options.applyChoice.mockRejectedValueOnce(new Error('native move failed'));
        await settle(f.session);
        expect(f.session.getChoice()).toBeNull();
        expect(f.options.onChange).not.toHaveBeenCalled();
        expect(f.options.logError).toHaveBeenCalledOnce();
    });

    it('does not resurrect a stale automatic choice after manual selection', async () => {
        vi.useFakeTimers();
        const f = fixture();
        let finish!: (moved: boolean) => void;
        f.options.applyChoice.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
        await f.session.tick(); vi.advanceTimersByTime(2000);
        const moving = f.session.tick();
        f.session.selectManual(); finish(false); await moving;
        expect(f.session.isEnabled()).toBe(false);
        expect(f.session.getChoice()).toBeNull();
    });

    it('returns to the saved manual choice when automatic avoidance is disabled', async () => {
        vi.useFakeTimers();
        const f = fixture();
        await settle(f.session);
        f.session.toggle();
        expect(f.session.isEnabled()).toBe(false);
        expect(f.session.getChoice()).toBeNull();
        expect(f.options.applyChoice).toHaveBeenLastCalledWith({ choiceChanged: true });
    });

    it('forgets a disconnected automatic target once the actual primary display matches the policy', async () => {
        vi.useFakeTimers();
        const f = fixture();
        await settle(f.session);
        expect(f.session.getChoice().id).toBe(secondary.id);
        // Topology handling has already moved the wallpaper back to the only connected display.
        f.options.screen.getAllDisplays = () => [primary];
        f.options.readWindows.mockReturnValue([]);
        f.setCurrent(primary);
        await settle(f.session);
        expect(f.session.getChoice().id).toBe(primary.id);
        f.options.screen.getAllDisplays = () => [primary, secondary];
        expect(f.session.getChoice().id).toBe(primary.id);
    });
});
