import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// test/unit/electron/nowPlayingLauncher.test.ts
// Verifies when the Now Playing auto-launcher starts the program: only on Windows, only when the
// stage needs it, never twice while it is starting, and never with an unvalidated path.

const {
    NOW_PLAYING_RELAUNCH_GUARD_MS,
    resolveNowPlayingExecutablePath,
    createNowPlayingLauncher,
} = require('../../../electron/nowPlayingLauncher.cjs') as {
    NOW_PLAYING_RELAUNCH_GUARD_MS: number;
    resolveNowPlayingExecutablePath: (candidate: unknown, fs?: unknown, pathApi?: unknown) => string | null;
    createNowPlayingLauncher: (options: Record<string, unknown>) => {
        getStatus: () => { supported: boolean; enabled: boolean; executablePath: string | null; lastError: string | null };
        ensureRunning: () => Promise<string>;
        setEnabled: (enabled: boolean) => Promise<{ enabled: boolean; lastError: string | null }>;
        setExecutablePath: (candidate: string) => Promise<{ executablePath: string | null; lastError: string | null }>;
    };
};

// Windows path semantics on every CI runner: the launcher only runs on Windows.
const winPath = path.win32;
const EXE = 'C:\\Tools\\NowPlaying\\NowPlaying.exe';

const createMemoryStore = (initial: Record<string, unknown> = {}) => {
    const values = new Map(Object.entries(initial));
    return {
        get: (key: string) => values.get(key),
        set: (key: string, value: unknown) => {
            values.set(key, value);
        },
    };
};

// Only EXE exists, as a file.
const fakeFs = {
    statSync: (target: string) => {
        if (target.toLowerCase() !== EXE.toLowerCase()) throw new Error('ENOENT');
        return { isFile: () => true };
    },
};

const setup = (overrides: Record<string, unknown> = {}) => {
    const store = createMemoryStore({ AUTO: true, PATH: EXE });
    const child = { once: vi.fn(), unref: vi.fn() };
    const spawn = vi.fn(() => child);
    const probe = vi.fn(async () => false);
    let clock = 1_000_000;
    const launcher = createNowPlayingLauncher({
        store,
        enabledSettingKey: 'AUTO',
        executablePathSettingKey: 'PATH',
        shouldLaunch: () => true,
        platform: 'win32',
        spawn,
        fs: fakeFs,
        path: winPath,
        probe,
        now: () => clock,
        logger: { log: vi.fn(), error: vi.fn() },
        ...overrides,
    });
    return { store, spawn, probe, child, launcher, advance: (ms: number) => { clock += ms; } };
};

describe('resolveNowPlayingExecutablePath', () => {
    it('accepts an existing .exe and rejects everything else', () => {
        expect(resolveNowPlayingExecutablePath(EXE, fakeFs, winPath)).toBe(EXE);
        expect(resolveNowPlayingExecutablePath('C:\\Tools\\NowPlaying\\other.exe', fakeFs, winPath)).toBeNull();
        expect(resolveNowPlayingExecutablePath('C:\\Tools\\NowPlaying\\NowPlaying.bat', fakeFs, winPath)).toBeNull();
        expect(resolveNowPlayingExecutablePath('', fakeFs, winPath)).toBeNull();
        expect(resolveNowPlayingExecutablePath(null, fakeFs, winPath)).toBeNull();
    });
});

describe('createNowPlayingLauncher', () => {
    it('launches the program detached from its own folder when the port is closed', async () => {
        const { launcher, spawn, child } = setup();

        await expect(launcher.ensureRunning()).resolves.toBe('launched');
        expect(spawn).toHaveBeenCalledTimes(1);
        const [command, args, options] = spawn.mock.calls[0] as unknown as [string, string[], Record<string, unknown>];
        expect(command).toBe(EXE);
        expect(args).toEqual([]);
        expect(options).toMatchObject({ detached: true, stdio: 'ignore' });
        expect(options.cwd).toBe('C:\\Tools\\NowPlaying');
        expect(child.unref).toHaveBeenCalled();
    });

    it('does nothing when Now Playing is already listening', async () => {
        const { launcher, spawn } = setup({ probe: async () => true });

        await expect(launcher.ensureRunning()).resolves.toBe('already-running');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('skips when auto-launch is off or the stage does not use Now Playing', async () => {
        const off = setup();
        off.store.set('AUTO', false);
        await expect(off.launcher.ensureRunning()).resolves.toBe('skipped');

        const otherSource = setup({ shouldLaunch: () => false });
        await expect(otherSource.launcher.ensureRunning()).resolves.toBe('skipped');

        expect(off.spawn).not.toHaveBeenCalled();
        expect(otherSource.spawn).not.toHaveBeenCalled();
    });

    it('is unsupported outside Windows and never launches there', async () => {
        const { launcher, spawn } = setup({ platform: 'darwin' });

        expect(launcher.getStatus()).toMatchObject({ supported: false, enabled: false });
        await expect(launcher.ensureRunning()).resolves.toBe('skipped');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('does not start a second copy while the first one is still starting', async () => {
        const { launcher, spawn, advance } = setup();

        const [first, second] = await Promise.all([launcher.ensureRunning(), launcher.ensureRunning()]);
        expect([first, second]).toEqual(['launched', 'launched']);
        await expect(launcher.ensureRunning()).resolves.toBe('recently-launched');
        expect(spawn).toHaveBeenCalledTimes(1);

        advance(NOW_PLAYING_RELAUNCH_GUARD_MS);
        await expect(launcher.ensureRunning()).resolves.toBe('launched');
        expect(spawn).toHaveBeenCalledTimes(2);
    });

    it('reports a missing program instead of launching', async () => {
        const { launcher, store, spawn } = setup();
        store.set('PATH', undefined);

        await expect(launcher.ensureRunning()).resolves.toBe('missing-executable');
        expect(launcher.getStatus().lastError).toBe('missing-executable');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('stores only a validated program path', async () => {
        const { launcher, store } = setup({ shouldLaunch: () => false });
        store.set('PATH', undefined);

        const rejected = await launcher.setExecutablePath('C:\\Windows\\System32\\notepad.bat');
        expect(rejected).toMatchObject({ executablePath: null, lastError: 'invalid-executable' });

        const accepted = await launcher.setExecutablePath(EXE);
        expect(accepted).toMatchObject({ executablePath: EXE, lastError: null });
    });

    it('records a spawn failure', async () => {
        const { launcher } = setup({ spawn: () => { throw new Error('EACCES'); } });

        await expect(launcher.ensureRunning()).resolves.toBe('spawn-failed');
        expect(launcher.getStatus().lastError).toBe('spawn-failed');
    });
});
