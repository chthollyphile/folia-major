import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SoloistStatus } from '@/types/soloist';
import type { CommandPaletteContext } from '@/components/command-palette/types';
import commands from '@/components/command-palette/commands/spotify/setupCommand';
import { useSoloistSettingsStore, runSoloistAction, watchSoloistStatus } from '@/stores/useSoloistSettingsStore';

// Direct palette actions and login-page buttons must share prerequisites, metadata and a single action lock.
const status: SoloistStatus = {
    configured: true, keyState: 'available', running: true, connected: true,
    binary: { path: '/test/soloist', state: 'valid', version: 'test', daysRemaining: 80 },
};
let snapshot: SoloistStatus;
const restart = vi.fn(), version = vi.fn(), readStatus = vi.fn(), notice = vi.fn();
const context = { shared: { t: (key: string) => key, setStatusMsg: notice } } as unknown as CommandPaletteContext;
const reconnect = commands.find(command => command.id === 'spotify-soloist-reconnect')!;
const check = commands.find(command => command.id === 'spotify-soloist-check-lifetime')!;
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    snapshot = structuredClone(status);
    restart.mockResolvedValue({ ok: true }); version.mockImplementation(async () => snapshot.binary);
    readStatus.mockImplementation(async () => snapshot);
    vi.stubGlobal('window', { electron: { soloistStatus: readStatus, soloistRestart: restart, soloistCheckVersion: version } });
    useSoloistSettingsStore.setState({ status: snapshot, busy: false, error: '' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Soloist direct setup commands', () => {
    it('uses the same installed, usable and saved-key conditions as the setup buttons', () => {
        expect(reconnect.isAvailable!()).toBe(true); expect(check.isAvailable!()).toBe(true);
        useSoloistSettingsStore.setState({ status: { ...snapshot, configured: false } });
        expect(reconnect.isAvailable!()).toBe(false); expect(check.isAvailable!()).toBe(true);
        useSoloistSettingsStore.setState({ status: { ...snapshot, binary: { ...snapshot.binary, state: 'expired' } } });
        expect(reconnect.isAvailable!()).toBe(false); expect(check.isAvailable!()).toBe(true);
        useSoloistSettingsStore.setState({ status: { ...snapshot, binary: { ...snapshot.binary, state: 'missing' } } });
        expect(reconnect.isAvailable!()).toBe(false); expect(check.isAvailable!()).toBe(false);
        useSoloistSettingsStore.setState({ status: { error: 'untrusted' } as unknown as SoloistStatus });
        expect(reconnect.isAvailable!()).toBe(false); expect(check.isAvailable!()).toBe(false);
        useSoloistSettingsStore.setState({ status: snapshot, busy: true });
        expect(reconnect.isAvailable!()).toBe(false); expect(check.isAvailable!()).toBe(false);
    });
    it('restarts directly and reports failure without exposing credentials', async () => {
        restart.mockResolvedValue({ ok: false, message: 'locked' });
        await reconnect.execute('', context);
        expect(restart).toHaveBeenCalledTimes(1);
        expect(notice).toHaveBeenCalledWith({ type: 'error', text: 'soloist.errors.locked' });
        expect(readStatus).toHaveBeenCalledTimes(2);
        expect(useSoloistSettingsStore.getState().busy).toBe(false);
    });
    it('checks the build directly and reports an expired build as an error', async () => {
        snapshot = { ...snapshot, binary: { ...snapshot.binary, state: 'expired', daysRemaining: 0 } };
        await check.execute('', context);
        expect(version).toHaveBeenCalledTimes(1); expect(restart).not.toHaveBeenCalled();
        expect(notice).toHaveBeenCalledWith({ type: 'error', text: expect.stringContaining('soloist.expired') });
    });
    it('revalidates prerequisites before executing a previously available command', async () => {
        snapshot = { ...snapshot, binary: { ...snapshot.binary, state: 'missing' } };
        await reconnect.execute('', context); await check.execute('', context);
        expect(restart).not.toHaveBeenCalled(); expect(version).not.toHaveBeenCalled();
    });
    it('holds the same lock across UI and palette actions', async () => {
        let finish!: (result: { ok: boolean }) => void;
        restart.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const running = reconnect.execute('', context); await flush();
        expect(useSoloistSettingsStore.getState().busy).toBe(true);
        expect(check.isAvailable!()).toBe(false);
        await runSoloistAction(restart);
        expect(restart).toHaveBeenCalledTimes(1);
        finish({ ok: true }); await running;
        expect(useSoloistSettingsStore.getState().busy).toBe(false);
    });
    it('shares one polling loop and stops it when the last consumer leaves', async () => {
        const stopPage = watchSoloistStatus(), stopPalette = watchSoloistStatus();
        try {
            await flush(); expect(readStatus).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(4000); expect(readStatus).toHaveBeenCalledTimes(2);
            stopPage();
            await vi.advanceTimersByTimeAsync(4000); expect(readStatus).toHaveBeenCalledTimes(3);
        } finally { stopPalette(); }
        await vi.advanceTimersByTimeAsync(8000); expect(readStatus).toHaveBeenCalledTimes(3);
    });
});
