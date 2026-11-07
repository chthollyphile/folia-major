// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runExternalPlayerWarmUp } from '@/components/app/playback/externalPlayerWake';

// The settings row 「Folia 退出时关闭 Spotify」. The renderer keeps the value the row reads, and writes
// it to the main process's store, which is where the quit reads it, because the renderer may only
// reach the main process through preload (electron/preload.cjs, `saveSettings`).
// The other setting, 「打开 Folia 时唤起外部播放器」, is run by externalPlayerWake.ts at launch: asked for
// or not, and a player that refuses to start (the last block).

// 渲染进程自己存的键已经发布，不能改名；主进程 electron-store 那个键没发布过，和同类开关一样用
// UPPER_SNAKE。
const STORAGE_KEY = 'close_external_player_on_quit';
const MAIN_PROCESS_KEY = 'CLOSE_EXTERNAL_PLAYER_ON_QUIT';

const loadStore = async (saveSettings: () => void) => {
    Object.defineProperty(window, 'electron', {
        value: { platform: 'win32', saveSettings },
        configurable: true,
        writable: true,
    });
    vi.resetModules();
    const module = await import('@/stores/useDesktopSettingsStore');
    return module.useDesktopSettingsStore;
};

beforeEach(() => {
    window.localStorage.clear();
});

describe('the quit switch', () => {
    it('is off until the listener asks for it', async () => {
        const store = await loadStore(vi.fn());
        expect(store.getState().closeExternalPlayerOnQuit).toBe(false);
    });

    it('writes the value the main process reads at the quit, and keeps it', async () => {
        const saveSettings = vi.fn();
        const store = await loadStore(saveSettings);

        store.getState().handleToggleCloseExternalPlayerOnQuit(true);
        expect(store.getState().closeExternalPlayerOnQuit).toBe(true);
        expect(saveSettings).toHaveBeenCalledWith(MAIN_PROCESS_KEY, true);
        // 渲染进程留着自己那份（已发布的键）：设置行读的是它。
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');

        store.getState().handleToggleCloseExternalPlayerOnQuit(false);
        expect(saveSettings).toHaveBeenLastCalledWith(MAIN_PROCESS_KEY, false);
    });
});

describe('the launch wake-up of external players', () => {
    it('wakes the players when the listener asked for it', async () => {
        const warmUp = vi.fn(async () => {});
        await runExternalPlayerWarmUp(true, warmUp);
        expect(warmUp).toHaveBeenCalledTimes(1);
    });

    it('wakes nothing while the setting is off', async () => {
        const warmUp = vi.fn(async () => {});
        await runExternalPlayerWarmUp(false, warmUp);
        expect(warmUp).not.toHaveBeenCalled();
    });

    it('does not stop the app when a player cannot be started', async () => {
        const warmUp = vi.fn(async () => { throw new Error('no player'); });
        await expect(runExternalPlayerWarmUp(true, warmUp)).resolves.toBeUndefined();
        expect(warmUp).toHaveBeenCalledTimes(1);
    });
});
