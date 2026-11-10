import { option, type SettingsGroupDef } from '../../kit';
import { useHifiSettingsStore } from '../../../../../stores/useHifiSettingsStore';

// src/components/modal/settings/pages/hifi/options.ts
// The groups and options of the playback engine settings on the 播放控制 page (desktop app only:
// mpv runs under its main process), declared apart from the groups so each group's file names the
// same ones. The group ids are the anchors other code opens the settings on (settingsAnchorModel).
// Everything about mpv is drawn only while mpv is the chosen engine, and the search leaves it out
// the same way.

/** The desktop build's OS, from the preload; null on the web. */
export const HIFI_PLATFORM: string | null = typeof window !== 'undefined' ? window.electron?.platform ?? null : null;

/** mpv is the chosen engine: the page draws the mpv rows and the output group only then. */
const usesMpv = () => useHifiSettingsStore.getState().enabled;

export const ENGINE: SettingsGroupDef = { id: 'hifiEngine', titleKey: 'hifi.settings.groupEngine', electronOnly: true };
export const OUTPUT: SettingsGroupDef = { id: 'hifiOutput', titleKey: 'hifi.settings.groupOutput', electronOnly: true, available: usesMpv };

export const O = {
    engine: option(ENGINE, 'hifiEnabled', 'hifi.settings.engine'),
    runtime: option(ENGINE, 'hifiRuntime', 'hifi.settings.runtime', { available: usesMpv }),
    mpvPath: option(ENGINE, 'hifiMpvPath', 'hifi.settings.mpvPath', { available: usesMpv }),
    navidrome: option(ENGINE, 'hifiNavidrome', 'hifi.settings.navidrome', { available: usesMpv }),
    device: option(OUTPUT, 'hifiAudioDevice', 'hifi.settings.device'),
    // Linux has no exclusive mode: mpv's PipeWire and PulseAudio outputs always mix, so mpv is started
    // with --audio-exclusive=no there and the page does not draw the switch (the saved value stays).
    exclusive: option(OUTPUT, 'hifiExclusive', 'hifi.settings.exclusive', { available: () => HIFI_PLATFORM !== 'linux' }),
    softwareVolume: option(OUTPUT, 'hifiSoftwareVolume', 'hifi.settings.softwareVolume'),
    // DoP only works on Windows; elsewhere DSD is always converted to PCM and there is nothing to
    // choose, unless a DoP choice was saved there, which stays visible so it can be switched back.
    dsdMode: option(OUTPUT, 'hifiDsdMode', 'hifi.settings.dsdMode', {
        available: () => HIFI_PLATFORM === 'win32' || useHifiSettingsStore.getState().dsdMode === 'dop',
    }),
};
