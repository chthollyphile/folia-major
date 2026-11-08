// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HifiDevice, HifiRuntimeStatus } from '../../../src/types/hifi';

// test/unit/settings/hifiSettingsPage.test.ts
// The playback engine settings of the 播放控制 page against a fake window.electron.hifi: the engine is
// a choice between Web Audio and mpv, with the scope and what mpv turns off spelled out; the first
// switch to mpv asks about full volume; everything about mpv shows only while mpv is chosen (and the
// search leaves it out the same way); the mpv line says what is in use (or why nothing is), Linux gets
// package-manager lines in place of a download, the saved device keeps its name before the list is
// read, DoP is drawn on Windows only, Linux has no exclusive switch and is told that a direct device
// skips the sound server (marked at the front of its name, so the mark survives a cut-off label),
// there is no known-limits group any more, and a build without the engine has nothing to switch.
// The groups read the platform when they load, so each case loads them afresh.

vi.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) => (options ? `${key}:${JSON.stringify(options)}` : key),
    }),
}));

// The real dialog is a portal sheet; the page only needs the question asked and answered.
vi.mock('../../../src/components/shared/ConfirmDialog', async () => {
    const { createElement } = await import('react');
    return {
        default: ({ isOpen, title, onConfirm, onClose }: { isOpen: boolean; title: string; onConfirm: () => void; onClose: () => void }) => (
            isOpen
                ? createElement('div', { 'data-confirm': title },
                    createElement('button', { type: 'button', onClick: onConfirm }, 'confirm'),
                    createElement('button', { type: 'button', onClick: onClose }, 'cancel'))
                : null
        ),
    };
});

const runtimeStatus = (patch: Partial<HifiRuntimeStatus> = {}): HifiRuntimeStatus => ({
    available: true,
    path: '/usr/bin/mpv',
    version: '0.41.0',
    source: 'system',
    errorCode: null,
    manualPathRejected: false,
    platform: 'win32',
    arch: 'x64',
    download: { supported: true, version: '0.41.0', installedVersion: null, updateAvailable: false, installing: false },
    dopCapable: false,
    ...patch,
});

const fakeHifiApi = (runtime: HifiRuntimeStatus, devices: HifiDevice[] = []) => ({
    getRuntimeStatus: vi.fn(async () => runtime),
    detectRuntime: vi.fn(async () => runtime),
    pickRuntimePath: vi.fn(async () => null),
    installRuntime: vi.fn(async () => ({ ok: true, errorCode: null, status: runtime })),
    cancelInstall: vi.fn(async () => {}),
    configure: vi.fn(async () => {}),
    listDevices: vi.fn(async () => devices),
    probeOutput: vi.fn(async () => null),
    onState: () => () => {},
    onClock: () => () => {},
    onError: () => () => {},
    onInstallProgress: () => () => {},
    onReadRequest: () => () => {},
});

let root: Root | null = null;
let host: HTMLDivElement;

/** Loads the page as the given desktop OS would and renders it once the runtime answer is in. */
const renderPage = async (
    platform: string,
    runtime: HifiRuntimeStatus,
    storage: Record<string, string> = {},
    { withEngine = true, devices = [] as HifiDevice[] } = {},
) => {
    vi.resetModules();
    window.localStorage.clear();
    Object.entries(storage).forEach(([key, value]) => window.localStorage.setItem(key, value));
    const api = fakeHifiApi(runtime, devices);
    (window as any).electron = withEngine ? { platform, hifi: api } : { platform };
    const { default: HifiSettings } = await import('../../../src/components/modal/settings/pages/hifi/HifiSettings');
    const { useHifiSettingsStore } = await import('../../../src/stores/useHifiSettingsStore');
    const { useHifiEngineStore } = await import('../../../src/services/hifi/hifiEngine');
    const { O } = await import('../../../src/components/modal/settings/pages/hifi/options');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(React.createElement(HifiSettings));
    });
    return { api, settings: useHifiSettingsStore, engine: useHifiEngineStore, options: O };
};

const rowOf = (rowId: string) => host.querySelector(`[data-settings-row="${rowId}"]`) as HTMLElement;
const click = async (element: Element) => {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    });
};
const buttonWithText = (text: string) => [...document.querySelectorAll('button')].find(item => item.textContent === text);
/** mpv is the chosen engine. */
const MPV = { folia_hifi_enabled: 'true' };
const unmount = async () => {
    await act(async () => {
        root?.unmount();
    });
    host.remove();
    root = null;
};
/** Opens the output device list with a pointer click (which reads the devices) and returns its option texts. */
const deviceOptionTexts = async () => {
    await click(rowOf('hifiAudioDevice').querySelector('[role="combobox"]')!);
    return [...document.querySelectorAll('[role="option"]')].map(item => item.textContent);
};

const linuxDevices: HifiDevice[] = [
    { name: 'auto', description: 'Autoselect device', driver: 'auto', direct: false },
    { name: 'pipewire', description: 'PipeWire', driver: 'pipewire', direct: false },
    { name: 'alsa/hw:CARD=NVidia,DEV=3', description: 'HDA NVidia, HDMI 0', driver: 'alsa', direct: true },
];

beforeAll(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    // The first transform of the groups and the stores they pull in is slow under a full parallel run;
    // paying it here keeps it out of the first case's 5 s (each case still loads them afresh).
    await import('../../../src/components/modal/settings/pages/hifi/HifiSettings');
}, 60_000);

afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    host?.remove();
    root = null;
    delete (window as any).electron;
});

describe('playback engine settings', () => {
    it('offers the engine as a choice between Web Audio and mpv, and says it only applies to local files and Navidrome', async () => {
        const { options } = await renderPage('win32', runtimeStatus());
        const row = rowOf('hifiEnabled');
        expect(row.textContent).toContain('hifi.settings.engine');
        expect(row.textContent).toContain('hifi.settings.engineDesc');
        expect(buttonWithText('hifi.settings.engineWeb')!.getAttribute('aria-pressed')).toBe('true');
        expect(buttonWithText('hifi.settings.engineMpv')!.getAttribute('aria-pressed')).toBe('false');
        // With Web Audio, nothing about mpv is drawn, and the search leaves it out the same way.
        for (const rowId of ['hifiRuntime', 'hifiMpvPath', 'hifiNavidrome', 'hifiAudioDevice', 'hifiExclusive', 'hifiSoftwareVolume', 'hifiDsdMode']) {
            expect(rowOf(rowId), rowId).toBeNull();
        }
        expect(host.querySelector('[data-settings-anchor="hifiOutput"]')).toBeNull();
        expect(host.textContent).not.toContain('hifi.settings.engineMpvNotice');
        expect(options.runtime.available?.()).toBe(false);
        expect(options.device.group.available?.()).toBe(false);
    });

    it('asks about full volume the first time mpv is chosen, and only switches once accepted', async () => {
        const { settings } = await renderPage('win32', runtimeStatus());

        await click(buttonWithText('hifi.settings.engineMpv')!);
        expect(document.querySelector('[data-confirm="hifi.settings.confirmTitle"]')).not.toBeNull();
        expect(settings.getState().enabled).toBe(false);

        await click(buttonWithText('cancel')!);
        expect(settings.getState()).toMatchObject({ enabled: false, volumeConfirmed: false });

        await click(buttonWithText('hifi.settings.engineMpv')!);
        await click(buttonWithText('confirm')!);
        expect(settings.getState()).toMatchObject({ enabled: true, volumeConfirmed: true });
        expect(document.querySelector('[data-confirm]')).toBeNull();

        await click(buttonWithText('hifi.settings.engineWeb')!);
        expect(settings.getState().enabled).toBe(false);
    });

    it('switches to mpv without asking once the warning was accepted, and then shows what mpv turns off and its settings', async () => {
        const { settings, options } = await renderPage('win32', runtimeStatus(), { folia_hifi_volume_confirmed: 'true' });

        await click(buttonWithText('hifi.settings.engineMpv')!);
        expect(document.querySelector('[data-confirm]')).toBeNull();
        expect(settings.getState().enabled).toBe(true);
        expect(host.textContent).toContain('hifi.settings.engineMpvNotice');
        for (const rowId of ['hifiRuntime', 'hifiMpvPath', 'hifiNavidrome', 'hifiAudioDevice', 'hifiExclusive', 'hifiSoftwareVolume', 'hifiDsdMode']) {
            expect(rowOf(rowId), rowId).not.toBeNull();
        }
        expect(options.runtime.available?.()).toBe(true);
        expect(options.device.group.available?.()).toBe(true);
    });

    it('says which mpv is in use and where it came from, without the file path', async () => {
        await renderPage('win32', runtimeStatus({ source: 'downloaded', download: { supported: true, version: '0.41.0', installedVersion: '0.41.0', updateAvailable: false, installing: false } }), MPV);

        const row = rowOf('hifiRuntime');
        expect(row.textContent).toContain('hifi.settings.runtimeFound:{"version":"0.41.0","source":"hifi.settings.sourceDownloaded"}');
        expect(row.textContent).not.toContain('/usr/bin/mpv');
        // Installed and current: nothing to download.
        expect(row.textContent).not.toContain('hifi.settings.download');
        expect(row.textContent).not.toContain('hifi.settings.update');
    });

    it('names an mpv that is too old, and offers the download where there is one', async () => {
        await renderPage('win32', runtimeStatus({ available: false, version: '0.36.0', errorCode: 'MPV_TOO_OLD' }), MPV);

        const row = rowOf('hifiRuntime');
        expect(row.textContent).toContain('hifi.settings.runtimeTooOld:{"version":"0.36.0"}');
        expect(row.textContent).toContain('hifi.settings.download:{"version":"0.41.0"}');
    });

    it('offers the cloud-drive copies while there is no mpv, with the file to pick on each OS', async () => {
        const missing = { available: false, path: null, version: null, source: null, errorCode: 'MPV_NOT_FOUND' as const };
        await renderPage('win32', runtimeStatus(missing), MPV);
        const openExternalUrl = vi.fn(async () => {});
        (window as any).electron.openExternalUrl = openExternalUrl;

        expect(host.textContent).toContain('hifi.settings.driveDownload');
        expect(host.textContent).toContain('hifi.settings.driveDownloadHint:{"version":"0.41.0"}');
        await click(buttonWithText('options.quarkDrive')!);
        await click(buttonWithText('options.baiduDrive')!);
        expect(openExternalUrl.mock.calls).toEqual([
            ['https://pan.quark.cn/s/c6c57fff6d32'],
            ['https://pan.baidu.com/s/1VyUD0pgXam3fgd0Xqug9yg?pwd=9zcw'],
        ]);
        await unmount();

        await renderPage('darwin', runtimeStatus({ ...missing, platform: 'darwin', arch: 'arm64' }), MPV);
        expect(host.textContent).toContain('hifi.settings.driveDownloadHintMac:{"version":"0.41.0"}');
        await unmount();

        // An mpv that works needs no cloud drive.
        await renderPage('win32', runtimeStatus(), MPV);
        expect(buttonWithText('options.quarkDrive')).toBeUndefined();
    });

    it('says so when the chosen file could not be used', async () => {
        await renderPage('win32', runtimeStatus({ available: false, path: null, version: null, source: null, errorCode: 'MPV_NOT_FOUND', manualPathRejected: true }), MPV);

        expect(rowOf('hifiRuntime').textContent).toContain('hifi.settings.runtimeNotFound');
        expect(host.textContent).toContain('hifi.settings.manualPathRejected');
    });

    it('gives Linux the package-manager lines and no download', async () => {
        await renderPage('linux', runtimeStatus({
            available: false, path: null, version: null, source: null, errorCode: 'MPV_NOT_FOUND', platform: 'linux',
            download: { supported: false, version: null, installedVersion: null, updateAvailable: false, installing: false },
        }), MPV);

        expect(rowOf('hifiRuntime').textContent).toContain('hifi.settings.linuxInstallHint');
        expect(host.textContent).not.toContain('hifi.settings.download');
        for (const command of ['sudo pacman -S mpv', 'sudo apt install mpv', 'sudo dnf install mpv']) {
            expect(host.textContent).toContain(command);
        }
    });

    it('keeps the saved device under its saved name before the list is read, and does not start mpv for it', async () => {
        const { api } = await renderPage('win32', runtimeStatus(), {
            ...MPV,
            folia_hifi_audio_device: 'wasapi/{dac}',
            folia_hifi_audio_device_label: 'My DAC',
        });

        expect(rowOf('hifiAudioDevice').querySelector('[role="combobox"]')?.textContent).toContain('My DAC');
        expect(api.listDevices).not.toHaveBeenCalled();
    });

    it('draws the DSD choice on Windows only, keeping the warning beside it, unless DoP was saved elsewhere', async () => {
        const { options } = await renderPage('linux', runtimeStatus({ platform: 'linux' }), MPV);
        expect(rowOf('hifiDsdMode')).toBeNull();
        expect(host.textContent).not.toContain('hifi.settings.dopWarning');
        expect(options.dsdMode.available?.()).toBe(false);
        await unmount();

        await renderPage('linux', runtimeStatus({ platform: 'linux' }), { ...MPV, folia_hifi_dsd_mode: 'dop' });
        expect((buttonWithText('hifi.settings.dsdDop') as HTMLButtonElement).disabled).toBe(false);
        expect((buttonWithText('hifi.settings.dsdPcm') as HTMLButtonElement).disabled).toBe(false);
        expect(host.textContent).toContain('hifi.settings.dopNotOnThisSystem');
        await unmount();

        await renderPage('win32', runtimeStatus({ dopCapable: true }), MPV);
        expect((buttonWithText('hifi.settings.dsdDop') as HTMLButtonElement).disabled).toBe(false);
        expect(host.textContent).toContain('hifi.settings.dopWarning');
        expect(host.textContent).toContain('hifi.settings.dopCapable');
    });

    it('has no exclusive switch on Linux, and leaves the saved value alone', async () => {
        // mpv always runs with --audio-exclusive=no on Linux, so the switch would do nothing there.
        const { settings, options } = await renderPage('linux', runtimeStatus({ platform: 'linux' }), { ...MPV, folia_hifi_exclusive: 'true' });
        expect(rowOf('hifiExclusive')).toBeNull();
        expect(host.textContent).not.toContain('hifi.settings.exclusiveDesc');
        // The search leaves the row out too.
        expect(options.exclusive.available?.()).toBe(false);
        expect(rowOf('hifiAudioDevice').textContent).toContain('hifi.settings.deviceLinuxHint');
        expect(settings.getState().exclusive).toBe(true);
        expect(window.localStorage.getItem('folia_hifi_exclusive')).toBe('true');
    });

    it('keeps the exclusive switch and its takeover wording for Windows and macOS', async () => {
        for (const platform of ['win32', 'darwin']) {
            const { options } = await renderPage(platform, runtimeStatus({ platform }), MPV);
            expect(rowOf('hifiExclusive').textContent).toContain('hifi.settings.exclusiveDesc');
            expect(rowOf('hifiExclusive').querySelector('[role="switch"]')).not.toBeNull();
            expect(options.exclusive.available?.()).toBe(true);
            expect(rowOf('hifiAudioDevice').textContent).not.toContain('hifi.settings.deviceLinuxHint');
            await unmount();
        }
    });

    it('puts the direct mark in front of a Linux device name, so a cut-off label still shows it', async () => {
        const { api } = await renderPage('linux', runtimeStatus({ platform: 'linux' }), MPV, { devices: linuxDevices });

        const texts = await deviceOptionTexts();
        expect(api.listDevices).toHaveBeenCalledTimes(1);
        // 'auto' is drawn once, first, under the app's name; a shared device keeps its plain name.
        expect(texts).toEqual([
            'hifi.settings.deviceAuto',
            'PipeWire',
            'hifi.settings.deviceDirect · HDA NVidia, HDMI 0',
        ]);
    });

    it('marks no device off Linux', async () => {
        await renderPage('win32', runtimeStatus(), MPV, {
            devices: [{ name: 'wasapi/{dac}', description: 'USB DAC', driver: 'wasapi', direct: true }],
        });

        expect(await deviceOptionTexts()).toEqual(['hifi.settings.deviceAuto', 'USB DAC']);
    });

    it('lists no known limits and no long notes any more', async () => {
        for (const platform of ['win32', 'linux']) {
            await renderPage(platform, runtimeStatus({ platform }), MPV);
            expect(host.textContent).not.toMatch(/hifi\.settings\.limit/);
            expect(host.textContent).not.toContain('hifi.settings.exclusiveLinuxNote');
            expect(host.textContent).not.toContain('hifi.settings.softwareVolumeNote');
            expect(host.textContent).not.toContain('hifi.settings.mpvPathDesc');
            expect(host.textContent).not.toContain('hifi.settings.scopeFoot');
            await unmount();
        }
    });

    it('asks for exclusive mode for DoP only on Windows, the one system with a switch that makes DoP work', async () => {
        const dopShared = { ...MPV, folia_hifi_dsd_mode: 'dop', folia_hifi_exclusive: 'false' };
        await renderPage('linux', runtimeStatus({ platform: 'linux' }), dopShared);
        expect(host.textContent).toContain('hifi.settings.dopNotOnThisSystem');
        expect(host.textContent).not.toContain('hifi.settings.dopNeedsExclusive');
        await unmount();

        await renderPage('win32', runtimeStatus({ dopCapable: true }), dopShared);
        expect(host.textContent).toContain('hifi.settings.dopNeedsExclusive');
    });

    it('says why a download it did not start failed (one started from the palette)', async () => {
        const { engine } = await renderPage('win32', runtimeStatus({ available: false, path: null, version: null, source: null, errorCode: 'MPV_NOT_FOUND' }), MPV);
        await act(async () => {
            engine.setState({ installProgress: { phase: 'error', version: '0.41.0', receivedBytes: 10, totalBytes: 10, errorCode: 'INSTALL_CHECKSUM_MISMATCH' } });
        });
        expect(host.textContent).toContain('hifi.errors.INSTALL_CHECKSUM_MISMATCH');
    });

    it('has nothing to switch in a build without the engine, where the palette offers no switch either', async () => {
        await renderPage('win32', runtimeStatus(), {}, { withEngine: false });
        expect(rowOf('hifiEnabled').querySelector('[inert]')).not.toBeNull();
        expect(rowOf('hifiEnabled').textContent).toContain('hifi.settings.unsupported');
        await unmount();
        // A saved mpv choice in such a build still cannot be switched anywhere.
        await renderPage('win32', runtimeStatus(), MPV, { withEngine: false });
        for (const rowId of ['hifiEnabled', 'hifiExclusive', 'hifiSoftwareVolume']) {
            expect(rowOf(rowId).querySelector('[inert]')).not.toBeNull();
        }
        expect(rowOf('hifiNavidrome')).toBeNull();
    });
});
