import { createRequire } from 'module';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/macDesktopClickGuard.test.ts
// The macOS Stage Manager click guard's JavaScript side (issue #698): the region it hands the
// library, how start results map to failures, and stop. The Swift library itself needs a real
// macOS session.

const require = createRequire(import.meta.url);
const { createMacDesktopClickGuard } = require('../../../electron/wallpaper/macDesktopClickGuard.cjs');

const fakeLibrary = (startCode = 0) => {
    const calls: string[] = [];
    const lib = {
        start: vi.fn(() => { calls.push('start'); return startCode; }),
        setRegion: vi.fn((x: number, y: number, w: number, h: number) => { calls.push(`region ${x} ${y} ${w} ${h}`); }),
        clearRegion: vi.fn(() => { calls.push('clear'); }),
        stop: vi.fn(() => { calls.push('stop'); }),
        trusted: vi.fn(() => true),
        requestAccess: vi.fn(() => { calls.push('prompt'); }),
    };
    return { lib, calls };
};

const setup = (startCode = 0) => {
    const { lib, calls } = fakeLibrary(startCode);
    const loadLibrary = vi.fn(() => lib);
    const guard = createMacDesktopClickGuard({
        libraryPath: '/lib.dylib',
        loadLibrary,
        existsSync: () => true,
        logWarn: () => {},
    });
    return { guard, lib, calls, loadLibrary };
};

const frame = { x: 0, y: 0, width: 1440, height: 900 };

describe('createMacDesktopClickGuard', () => {
    it('sets the region before starting the tap, and starts it once', () => {
        const { guard, calls, loadLibrary } = setup();
        expect(guard.start(frame)).toBe(true);
        expect(guard.start({ ...frame, width: 1280 })).toBe(true);
        expect(calls).toEqual(['region 0 0 1440 900', 'start', 'region 0 0 1280 900']);
        expect(guard.isRunning()).toBe(true);
        expect(loadLibrary).toHaveBeenCalledTimes(1);
    });

    it('stops the tap and clears the region, and starts again afterwards', () => {
        const { guard, calls } = setup();
        guard.start(frame);
        guard.stop();
        expect(guard.isRunning()).toBe(false);
        expect(calls.slice(-2)).toEqual(['stop', 'clear']);
        expect(guard.start(frame)).toBe(true);
        expect(calls.slice(-2)).toEqual(['region 0 0 1440 900', 'start']);
    });

    it('reports a missing grant and a tap that could not be created', () => {
        const untrusted = setup(3);
        expect(untrusted.guard.start(frame)).toBe(false);
        expect(untrusted.guard.lastFailure()).toBe('untrusted');
        expect(untrusted.guard.isRunning()).toBe(false);
        expect(untrusted.calls.at(-1)).toBe('clear');

        const failed = setup(4);
        expect(failed.guard.start(frame)).toBe(false);
        expect(failed.guard.lastFailure()).toBe('tap-failed');
    });

    it('clears the region for an invalid rect', () => {
        const { guard, calls } = setup();
        guard.start(frame);
        guard.setRegion(null);
        expect(calls.at(-1)).toBe('clear');
    });

    it('stays off when the library is missing or fails to load', () => {
        const missing = createMacDesktopClickGuard({ libraryPath: '/missing', existsSync: () => false, loadLibrary: vi.fn() });
        expect(missing.start(frame)).toBe(false);
        expect(missing.lastFailure()).toBe('missing');
        expect(missing.requestAccess()).toBe(false);
        missing.stop();

        const loadLibrary = vi.fn(() => { throw new Error('bad image'); });
        const broken = createMacDesktopClickGuard({ libraryPath: '/lib.dylib', existsSync: () => true, loadLibrary, logWarn: () => {} });
        expect(broken.start(frame)).toBe(false);
        expect(broken.start(frame)).toBe(false);
        expect(broken.lastFailure()).toBe('load-failed');
        expect(loadLibrary).toHaveBeenCalledTimes(1);
    });

    it('asks macOS for the grant through the library', () => {
        const { guard, calls } = setup();
        expect(guard.requestAccess()).toBe(true);
        expect(calls).toEqual(['prompt']);
    });
});
