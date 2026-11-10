// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/settings/externalSpectrumRow.test.ts
// 设置里那一行「真实频谱（采集系统声音）」：它只在 Windows 桌面版出现（照「Folia 退出时关闭 Spotify」
// 那几行的平台判断），开关写的是 useDesktopSettingsStore 里 A1 已经建好的那一项，命令面板里也有一条
// 同一开关的命令。真实频谱是采集整机声音，只在提供方声明、开关打开时才采集（B1），所以默认必须是关。

const loadWindow = (platform?: string) => {
    Object.defineProperty(window, 'electron', {
        value: platform === undefined ? undefined : { platform, saveSettings: vi.fn() },
        configurable: true,
        writable: true,
    });
};

const loadStore = async () => {
    vi.resetModules();
    const module = await import('@/stores/useDesktopSettingsStore');
    return module.useDesktopSettingsStore;
};

beforeEach(() => {
    window.localStorage.clear();
    loadWindow('win32');
});

describe('the row that asks for the machine’s own sound', () => {
    it('is declared on the connection page, marked as the desktop app’s and the Windows build’s', async () => {
        const { O } = await import('@/components/modal/settings/pages/integration/options');
        const row = O.externalSpectrum;
        expect(row).toBeDefined();
        expect(row.labelKey).toBe('options.externalSystemAudioSpectrum');
        expect(row.electronOnly).toBe(true);

        // Every other row of that group asks the same question of the machine it is drawn on.
        const elsewhere = (platform?: string) => {
            loadWindow(platform);
            return row.available?.();
        };
        expect(elsewhere('win32')).toBe(true);
        expect(elsewhere('darwin')).toBe(false);
        expect(elsewhere('linux')).toBe(false);
        // A browser has no window.electron at all: asking must not throw, and answers no.
        expect(elsewhere(undefined)).toBe(false);
        loadWindow('win32');
    });

    it('is left out of the settings search on a machine that does not draw it', async () => {
        const { SETTINGS_PAGE_OPTIONS } = await import('@/components/modal/settings/pages');
        const { buildSettingsNavGroups } = await import('@/components/modal/settings/navigation/settingsNavModel');
        const { buildSettingsSearchEntries } = await import('@/components/modal/settings/navigation/settingsNavSearch');
        const echo = (key: string) => key;
        const targets = (platform?: string) => {
            loadWindow(platform);
            return new Set(buildSettingsSearchEntries(
                buildSettingsNavGroups(echo, { isElectron: true }),
                SETTINGS_PAGE_OPTIONS,
                echo,
                { isElectron: true },
            ).map(entry => entry.targetId));
        };

        expect(targets('win32').has('externalSystemAudioSpectrum')).toBe(true);
        expect(targets('darwin').has('externalSystemAudioSpectrum')).toBe(false);
        loadWindow('win32');
    }, 30000);

    it('is off until the listener asks for it, and keeps the answer under its own key', async () => {
        const store = await loadStore();
        expect(store.getState().externalSystemAudioSpectrum).toBe(false);

        store.getState().handleToggleExternalSystemAudioSpectrum(true);
        expect(store.getState().externalSystemAudioSpectrum).toBe(true);
        expect(window.localStorage.getItem('external_system_audio_spectrum')).toBe('true');
    });

    it('offers the same switch in the command palette, on the Windows build only', async () => {
        const { settingsCommands } = await import('@/components/command-palette/commands/settingsCommands');
        const command = settingsCommands.find(item => item.id === 'external-player-system-audio-spectrum');
        expect(command).toBeDefined();
        expect(command?.platform).toEqual(['win']);

        const store = await loadStore();
        store.setState({ externalSystemAudioSpectrum: false });
        const context = { settings: { toggleExternalSystemAudioSpectrum: () => store.getState().handleToggleExternalSystemAudioSpectrum(!store.getState().externalSystemAudioSpectrum) } };
        void command?.execute('', context as unknown as Parameters<NonNullable<typeof command>['execute']>[1]);
        expect(store.getState().externalSystemAudioSpectrum).toBe(true);
    }, 30000);

    it('says what it captures, and that nothing is recorded or kept', async () => {
        const { default: zhCN } = await import('@/i18n/locales/zh-CN');
        const label = zhCN.options.externalSystemAudioSpectrum;
        const description = zhCN.options.externalSystemAudioSpectrumDesc;
        expect(label).toBeTruthy();
        // The row's label names the sound's source, so it is not mistaken for Folia's own deck.
        expect(label).toContain('系统声音');
        expect(description).toContain('不录制');
        expect(description).toContain('不保存');
        // And what a turned-off switch still gives: bars that follow the playing position, not the sound.
        expect(description).toContain('模拟');
    });
});
