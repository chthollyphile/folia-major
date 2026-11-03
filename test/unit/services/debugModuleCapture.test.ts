import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/services/debugModuleCapture.test.ts
// The session-log switch lives in the renderer; the main process owns the log file and its own
// console lines. These cover the one thing that keeps the two in step: when the renderer tells it.

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** A fresh renderer: what its stored switch says, and what the main process holds (null = browser build). */
const start = async (stored: 'on' | 'off' | null, mainHolds: boolean | null,
    beforeInstall?: (buffer: typeof import('../../../src/utils/consoleLogBuffer')) => void) => {
    vi.resetModules();
    const state = {
        runtimeLogEnabled: true, runtimeLogMode: 'append', consoleCaptureEnabled: mainHolds, memoryMonitorEnabled: false,
        memoryLogEnabled: false, memoryLogMode: 'overwrite', memoryIntervalMs: 2000, logsRoot: 'logs', runtimeFile: null, memoryFile: null,
    };
    const debugSetState = vi.fn(async (patch: Record<string, unknown>) => ({ ...state, ...patch }));
    const debugWriteRuntimeLines = vi.fn();
    const electron = mainHolds === null ? undefined
        : { debugGetState: vi.fn(async () => state), debugSetState, debugWriteRuntimeLines, onDebugMainLines: vi.fn() };
    vi.stubGlobal('window', { electron, addEventListener: vi.fn() });
    vi.stubGlobal('localStorage', { getItem: () => stored, setItem: vi.fn() });
    const buffer = await import('../../../src/utils/consoleLogBuffer');
    const { installDebugModule } = await import('../../../src/services/debug/debugModule');
    beforeInstall?.(buffer);
    installDebugModule();
    await settle();
    return { buffer, debugSetState, debugWriteRuntimeLines };
};

describe('the session-log switch, as the main process hears it', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('is told at startup when what it remembers is not what the switch says', async () => {
        const { debugSetState } = await start('off', true);
        expect(debugSetState.mock.calls).toEqual([[{ consoleCaptureEnabled: false }]]);
    });

    it('is told before the lines held since startup are sent, so the file is open when they arrive', async () => {
        const silent = vi.spyOn(console, 'log').mockImplementation(() => {});
        const { debugSetState, debugWriteRuntimeLines } = await start('on', false, (buffer) => {
            buffer.installConsoleLogCapture();
            // Logged before the main process has answered: held, then sent once it has.
            queueMicrotask(() => console.log('[Page] a startup line'));
        });
        silent.mockRestore();
        expect(debugSetState.mock.calls).toEqual([[{ consoleCaptureEnabled: true }]]);
        expect(debugWriteRuntimeLines.mock.calls[0][0]).toMatchObject([{ tag: 'Page', text: '[Page] a startup line' }]);
        expect(debugSetState.mock.invocationCallOrder[0]).toBeLessThan(debugWriteRuntimeLines.mock.invocationCallOrder[0]);
    });

    it('is not told at startup when they agree, nor for the lines that pass', async () => {
        const { buffer, debugSetState } = await start(null, true);
        buffer.recordMainProcessLines([{ at: 1, level: 'log', text: '[Ytm] a' }]);
        buffer.clearConsoleLog();
        await settle();
        expect(debugSetState).not.toHaveBeenCalled();
    });

    it('is told once each time the switch is flipped', async () => {
        const { buffer, debugSetState } = await start('on', true);
        buffer.setConsoleCaptureEnabled(false);
        buffer.clearConsoleLog();
        await settle();
        expect(debugSetState.mock.calls).toEqual([[{ consoleCaptureEnabled: false }]]);
        buffer.setConsoleCaptureEnabled(true);
        buffer.recordMainProcessLines([{ at: 1, level: 'log', text: '[Ytm] a' }]);
        await settle();
        expect(debugSetState.mock.calls).toEqual([[{ consoleCaptureEnabled: false }], [{ consoleCaptureEnabled: true }]]);
    });

    it('has nobody to tell in the browser build', async () => {
        const { buffer, debugSetState } = await start('on', null);
        expect(() => buffer.setConsoleCaptureEnabled(false)).not.toThrow();
        await settle();
        expect(debugSetState).not.toHaveBeenCalled();
    });
});
