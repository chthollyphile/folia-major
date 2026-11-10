import { describe, expect, it, vi } from 'vitest';
import { hifiCommands } from '../../../src/components/command-palette/commands/hifiCommands';
import type { CommandPaletteContext } from '../../../src/components/command-palette/types';
import type { HifiInstallResult, HifiRuntimeStatus } from '../../../src/types/hifi';
import { getAvailableSettingsSectionIds, sectionForSettingsSubview } from '../../../src/components/modal/settings/navigation/settingsLastSection';

// test/unit/command-palette/hifiCommands.test.ts
// The HiFi commands: the switch never skips the full-volume warning (it opens the settings page
// instead), the settings command lands on the HiFi page, the page's other switches and its mpv
// actions are offered on the page's own conditions, DoP has no command, and the signal path is
// offered only for a song on the HiFi route.

type HifiState = {
    supported?: boolean;
    enabled?: boolean;
    confirmed?: boolean;
    route?: boolean;
    canRedetect?: boolean;
    canInstall?: boolean;
    detected?: HifiRuntimeStatus | null;
    installed?: HifiInstallResult | null;
};

const runtime = (patch: Partial<HifiRuntimeStatus> = {}): HifiRuntimeStatus => ({
    available: true,
    path: 'C:\\mpv\\mpv.exe',
    version: '0.41.0',
    source: 'downloaded',
    errorCode: null,
    manualPathRejected: false,
    platform: 'win32',
    arch: 'x64',
    download: { supported: true, version: '0.41.0', installedVersion: '0.41.0', updateAvailable: false, installing: false },
    dopCapable: false,
    ...patch,
});

/** The palette's t: the text of a key with its {{places}} left as they are, as i18next gives them without values. */
const TEXT: Record<string, string> = {
    'hifi.settings.runtimeFound': 'mpv {{version}} · {{source}}',
    'hifi.settings.runtimeNotFound': 'mpv not found',
    'hifi.settings.sourceDownloaded': 'downloaded by Folia',
};

const contextFor = ({
    supported = true,
    enabled = false,
    confirmed = false,
    route = false,
    canRedetect = true,
    canInstall = false,
    detected = runtime(),
    installed = { ok: true, errorCode: null, status: runtime() },
}: HifiState = {}) => {
    const settings = {
        openSettings: vi.fn(),
        isHifiSupported: () => supported,
        isHifiEnabled: () => enabled,
        isHifiVolumeConfirmed: () => confirmed,
        setHifiEnabled: vi.fn(),
        toggleHifiExclusive: vi.fn(),
        toggleHifiNavidrome: vi.fn(),
        toggleHifiSoftwareVolume: vi.fn(),
        canRedetectHifiRuntime: () => canRedetect,
        redetectHifiRuntime: vi.fn(async () => detected),
        canInstallHifiRuntime: () => canInstall,
        installHifiRuntime: vi.fn(async () => installed),
    };
    const playback = {
        isHifiRoute: () => route,
        openHifiSignalPath: vi.fn(),
    };
    const shared = {
        t: (key: string) => TEXT[key] ?? key,
        setStatusMsg: vi.fn(),
    };
    return { settings, playback, shared, context: { settings, playback, shared } as unknown as CommandPaletteContext };
};

/** Lets the promise a command started but did not wait for settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

const command = (id: string) => hifiCommands.find(item => item.id === id)!;

describe('hifi commands', () => {
    it('are desktop-only, and exclusive mode only where mpv can ask for it (not Linux)', () => {
        expect(hifiCommands.map(item => [item.id, item.platform])).toEqual([
            ['hifi-toggle', ['electron']],
            ['hifi-settings', ['electron']],
            ['hifi-exclusive-toggle', ['win', 'mac']],
            ['hifi-navidrome-toggle', ['electron']],
            ['hifi-software-volume-toggle', ['electron']],
            ['hifi-redetect-mpv', ['electron']],
            ['hifi-download-mpv', ['electron']],
            ['hifi-signal-path', ['electron']],
        ]);
    });

    it('turns HiFi off directly', async () => {
        const { context, settings } = contextFor({ enabled: true, confirmed: true });
        await command('hifi-toggle').execute('', context);
        expect(settings.setHifiEnabled).toHaveBeenCalledExactlyOnceWith(false);
        expect(settings.openSettings).not.toHaveBeenCalled();
    });

    it('opens the playback engine settings instead of switching on while the full-volume warning is unanswered', async () => {
        const { context, settings } = contextFor({ enabled: false, confirmed: false });
        await command('hifi-toggle').execute('', context);
        expect(settings.setHifiEnabled).not.toHaveBeenCalled();
        expect(settings.openSettings).toHaveBeenCalledExactlyOnceWith('options', 'playback', null, 'hifiEngine');
    });

    it('switches on once the warning was accepted', async () => {
        const { context, settings } = contextFor({ enabled: false, confirmed: true });
        await command('hifi-toggle').execute('', context);
        expect(settings.setHifiEnabled).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('offers the switch only where the build has the engine', () => {
        expect(command('hifi-toggle').isAvailable?.(contextFor({ supported: false }).context)).toBe(false);
        expect(command('hifi-toggle').isAvailable?.(contextFor({ supported: true }).context)).toBe(true);
        expect(command('hifi-toggle').isAvailable?.()).toBe(true);
    });

    it('lands the settings command on the playback engine group of the 播放控制 page', async () => {
        const { context, settings } = contextFor();
        expect(command('hifi-settings').settingsTarget).toEqual({ subview: 'playback', anchorId: 'hifiEngine' });
        await command('hifi-settings').execute('', context);
        expect(settings.openSettings).toHaveBeenCalledExactlyOnceWith('options', 'playback', null, 'hifiEngine');
        expect(sectionForSettingsSubview('playback')).toBe('playback');
        // The page is on the web too; only the engine group is the desktop app's.
        expect(getAvailableSettingsSectionIds({ isElectron: false })).toContain('playback');
    });

    it('offers the signal path only on the HiFi route, and opens the panel', async () => {
        const signalPath = command('hifi-signal-path');
        expect(signalPath.isAvailable?.(contextFor({ route: false }).context)).toBe(false);
        expect(signalPath.isAvailable?.()).toBe(false);

        const { context, playback } = contextFor({ route: true });
        expect(signalPath.isAvailable?.(context)).toBe(true);
        expect(await signalPath.execute('', context)).toBe(true);
        expect(playback.openHifiSignalPath).toHaveBeenCalledOnce();
    });

    it.each([
        ['hifi-exclusive-toggle', 'toggleHifiExclusive'],
        ['hifi-navidrome-toggle', 'toggleHifiNavidrome'],
        ['hifi-software-volume-toggle', 'toggleHifiSoftwareVolume'],
    ] as const)('flips a switch of the playback engine settings with %s, where the build has the engine', async (id, toggle) => {
        const { context, settings } = contextFor();
        expect(await command(id).execute('', context)).toBe(true);
        expect(settings[toggle]).toHaveBeenCalledOnce();
        expect(command(id).isAvailable?.(contextFor({ supported: false }).context)).toBe(false);
        expect(command(id).isAvailable?.(context)).toBe(true);
        expect(command(id).isAvailable?.()).toBe(true);
    });

    it('detects mpv again where the page offers it, and says what it found', async () => {
        const redetect = command('hifi-redetect-mpv');
        expect(redetect.isAvailable?.(contextFor({ canRedetect: false }).context)).toBe(false);
        expect(redetect.isAvailable?.(contextFor({ canRedetect: true }).context)).toBe(true);

        const found = contextFor();
        expect(await redetect.execute('', found.context)).toBe(true);
        expect(found.settings.redetectHifiRuntime).toHaveBeenCalledOnce();
        expect(found.shared.setStatusMsg).toHaveBeenCalledExactlyOnceWith({ type: 'success', text: 'mpv 0.41.0 · downloaded by Folia' });

        const missing = contextFor({ detected: runtime({ available: false, path: null, version: null, source: null, errorCode: 'MPV_NOT_FOUND' }) });
        await redetect.execute('', missing.context);
        expect(missing.shared.setStatusMsg).toHaveBeenCalledExactlyOnceWith({ type: 'error', text: 'mpv not found' });
    });

    it('offers the mpv download only where the page offers it, and shows its progress on the page', async () => {
        const download = command('hifi-download-mpv');
        expect(download.isAvailable?.()).toBe(false);
        expect(download.isAvailable?.(contextFor({ canInstall: false }).context)).toBe(false);
        expect(download.isAvailable?.(contextFor({ canInstall: true }).context)).toBe(true);

        const done = contextFor({ canInstall: true });
        expect(await download.execute('', done.context)).toBe(true);
        expect(done.settings.installHifiRuntime).toHaveBeenCalledOnce();
        expect(done.settings.openSettings).toHaveBeenCalledExactlyOnceWith('options', 'playback', null, 'hifiEngine');
        await settle();
        expect(done.shared.setStatusMsg).toHaveBeenCalledExactlyOnceWith({ type: 'success', text: 'mpv 0.41.0 · downloaded by Folia' });
    });

    it('says why a download from the palette failed, and nothing for a cancel', async () => {
        const failed = contextFor({ canInstall: true, installed: { ok: false, errorCode: 'INSTALL_CHECKSUM_MISMATCH', status: runtime() } });
        await command('hifi-download-mpv').execute('', failed.context);
        await settle();
        expect(failed.shared.setStatusMsg).toHaveBeenCalledExactlyOnceWith({ type: 'error', text: 'hifi.errors.INSTALL_CHECKSUM_MISMATCH' });

        const cancelled = contextFor({ canInstall: true, installed: { ok: false, errorCode: 'INSTALL_CANCELLED', status: runtime() } });
        await command('hifi-download-mpv').execute('', cancelled.context);
        await settle();
        expect(cancelled.shared.setStatusMsg).not.toHaveBeenCalled();
    });

    it('has no command for DoP: a DAC without DoP would play a hiss', () => {
        expect(hifiCommands.filter(item => /dop|dsd/i.test(item.id))).toEqual([]);
    });

    it('carries no execute shortcut', () => {
        expect(hifiCommands.filter(item => item.executeShortcut)).toEqual([]);
    });
});
