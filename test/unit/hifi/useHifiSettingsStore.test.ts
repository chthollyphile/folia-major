import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/hifi/useHifiSettingsStore.test.ts
// HiFi 设置：默认值、写进各自的键并在下次启动读回、DSD 方式只认 'dop'、拼给主进程的 HifiEngineConfig。

let values: Map<string, string>;

const loadStore = async () => {
    vi.resetModules();
    return import('@/stores/useHifiSettingsStore');
};

beforeEach(() => {
    values = new Map();
    const storage = {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, String(value)); },
        removeItem: (key: string) => { values.delete(key); },
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('window', { localStorage: storage });
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('hifi settings store', () => {
    it('starts off, auto-detecting mpv, on the default device, exclusive, PCM, with Navidrome', async () => {
        const { useHifiSettingsStore } = await loadStore();
        const state = useHifiSettingsStore.getState();

        expect(state.enabled).toBe(false);
        expect(state.mpvPath).toBe('');
        expect(state.audioDevice).toBe('auto');
        expect(state.audioDeviceLabel).toBe('');
        expect(state.exclusive).toBe(true);
        expect(state.dsdMode).toBe('pcm');
        expect(state.navidrome).toBe(true);
        expect(state.softwareVolume).toBe(false);
        expect(state.volumeConfirmed).toBe(false);
    });

    it('keeps the published storage keys', async () => {
        const store = await loadStore();

        expect([
            store.HIFI_ENABLED_KEY,
            store.HIFI_MPV_PATH_KEY,
            store.HIFI_AUDIO_DEVICE_KEY,
            store.HIFI_AUDIO_DEVICE_LABEL_KEY,
            store.HIFI_EXCLUSIVE_KEY,
            store.HIFI_DSD_MODE_KEY,
            store.HIFI_NAVIDROME_KEY,
            store.HIFI_SOFTWARE_VOLUME_KEY,
            store.HIFI_VOLUME_CONFIRMED_KEY,
        ]).toEqual([
            'folia_hifi_enabled',
            'folia_hifi_mpv_path',
            'folia_hifi_audio_device',
            'folia_hifi_audio_device_label',
            'folia_hifi_exclusive',
            'folia_hifi_dsd_mode',
            'folia_hifi_navidrome',
            'folia_hifi_software_volume',
            'folia_hifi_volume_confirmed',
        ]);
    });

    it('persists every setting and reads it back on the next start', async () => {
        const { useHifiSettingsStore } = await loadStore();
        const state = useHifiSettingsStore.getState();
        state.setEnabled(true);
        state.setMpvPath('/opt/mpv/bin/mpv');
        state.setAudioDevice('alsa/hw:CARD=D10,DEV=0', 'Topping D10');
        state.setExclusive(false);
        state.setDsdMode('dop');
        state.setNavidrome(false);
        state.setSoftwareVolume(true);
        state.setVolumeConfirmed(true);

        expect(values.get('folia_hifi_enabled')).toBe('true');
        expect(values.get('folia_hifi_mpv_path')).toBe('/opt/mpv/bin/mpv');
        expect(values.get('folia_hifi_audio_device')).toBe('alsa/hw:CARD=D10,DEV=0');
        expect(values.get('folia_hifi_audio_device_label')).toBe('Topping D10');
        expect(values.get('folia_hifi_exclusive')).toBe('false');
        expect(values.get('folia_hifi_dsd_mode')).toBe('dop');
        expect(values.get('folia_hifi_navidrome')).toBe('false');
        expect(values.get('folia_hifi_software_volume')).toBe('true');
        expect(values.get('folia_hifi_volume_confirmed')).toBe('true');

        const restarted = (await loadStore()).useHifiSettingsStore.getState();
        expect(restarted.enabled).toBe(true);
        expect(restarted.mpvPath).toBe('/opt/mpv/bin/mpv');
        expect(restarted.audioDevice).toBe('alsa/hw:CARD=D10,DEV=0');
        expect(restarted.audioDeviceLabel).toBe('Topping D10');
        expect(restarted.exclusive).toBe(false);
        expect(restarted.dsdMode).toBe('dop');
        expect(restarted.navidrome).toBe(false);
        expect(restarted.softwareVolume).toBe(true);
        expect(restarted.volumeConfirmed).toBe(true);
    });

    it('goes back to auto-detection for an empty or null mpv path', async () => {
        const { useHifiSettingsStore } = await loadStore();
        useHifiSettingsStore.getState().setMpvPath('/usr/bin/mpv');

        useHifiSettingsStore.getState().setMpvPath('   ');
        expect(useHifiSettingsStore.getState().mpvPath).toBe('');
        expect(values.has('folia_hifi_mpv_path')).toBe(false);

        useHifiSettingsStore.getState().setMpvPath('/usr/bin/mpv');
        useHifiSettingsStore.getState().setMpvPath(null);
        expect(useHifiSettingsStore.getState().mpvPath).toBe('');
        expect(values.has('folia_hifi_mpv_path')).toBe(false);
    });

    it('goes back to the default device for an empty name and drops the label with it', async () => {
        const { useHifiSettingsStore } = await loadStore();
        useHifiSettingsStore.getState().setAudioDevice('wasapi/{abc}', 'Speakers');

        useHifiSettingsStore.getState().setAudioDevice('', 'ignored');

        expect(useHifiSettingsStore.getState().audioDevice).toBe('auto');
        expect(useHifiSettingsStore.getState().audioDeviceLabel).toBe('');
        expect(values.get('folia_hifi_audio_device')).toBe('auto');
        expect(values.has('folia_hifi_audio_device_label')).toBe(false);
    });

    it('reads DoP only from exactly "dop"', async () => {
        for (const stored of ['DOP', 'dop ', 'dsd', '', 'pcm']) {
            values.set('folia_hifi_dsd_mode', stored);
            expect((await loadStore()).useHifiSettingsStore.getState().dsdMode).toBe('pcm');
        }

        values.set('folia_hifi_dsd_mode', 'dop');
        expect((await loadStore()).useHifiSettingsStore.getState().dsdMode).toBe('dop');
    });

    it('writes PCM for anything that is not DoP', async () => {
        const { useHifiSettingsStore } = await loadStore();

        useHifiSettingsStore.getState().setDsdMode('native' as never);

        expect(useHifiSettingsStore.getState().dsdMode).toBe('pcm');
        expect(values.get('folia_hifi_dsd_mode')).toBe('pcm');
    });
});

describe('selectHifiEngineConfig', () => {
    const base = {
        mpvPath: '',
        audioDevice: 'auto',
        exclusive: true,
        dsdMode: 'pcm' as const,
        softwareVolume: false,
    };

    it('maps the settings onto the engine config, with no manual path as null and mute passed as it is', async () => {
        const { selectHifiEngineConfig } = await loadStore();

        expect(selectHifiEngineConfig(base, 1, false)).toEqual({
            mpvPath: null,
            audioDevice: 'auto',
            exclusive: true,
            dsdMode: 'pcm',
            softwareVolume: false,
            volume: 100,
            muted: false,
        });
        expect(selectHifiEngineConfig({
            ...base,
            mpvPath: 'C:\\mpv\\mpv.exe',
            audioDevice: 'wasapi/{abc}',
            exclusive: false,
            dsdMode: 'dop',
            softwareVolume: true,
        }, 0.125, true)).toEqual({
            mpvPath: 'C:\\mpv\\mpv.exe',
            audioDevice: 'wasapi/{abc}',
            exclusive: false,
            dsdMode: 'dop',
            softwareVolume: true,
            volume: 50,
            muted: true,
        });
    });

    it('treats a blank path as auto-detection', async () => {
        const { selectHifiEngineConfig } = await loadStore();

        expect(selectHifiEngineConfig({ ...base, mpvPath: '  ' }, 1, false).mpvPath).toBeNull();
    });

    it('sends mpv the cube root of the app volume, so its cubic curve gives the same gain as the Web engine', async () => {
        const { selectHifiEngineConfig } = await loadStore();
        const volumeOf = (appVolume: number) => selectHifiEngineConfig(base, appVolume, false).volume;
        // mpv's gain for a volume v is (v / 100)^3; the Web engine's gain is the app volume itself.
        const mpvGainOf = (appVolume: number) => (volumeOf(appVolume) / 100) ** 3;

        expect(volumeOf(1)).toBe(100);
        expect(volumeOf(0)).toBe(0);
        expect(mpvGainOf(0.5)).toBeCloseTo(0.5, 10);
        expect(mpvGainOf(0.2)).toBeCloseTo(0.2, 10);
        // Not rounded: 0.5 is 79.37…, which an integer would move off by a fraction of a dB.
        expect(volumeOf(0.5)).toBeCloseTo(79.3700526, 6);
        expect(Number.isInteger(volumeOf(0.5))).toBe(false);
    });

    it('clamps the app volume to 0–1, and reads anything not finite as silence', async () => {
        const { selectHifiEngineConfig } = await loadStore();
        const volumeOf = (appVolume: number) => selectHifiEngineConfig(base, appVolume, false).volume;

        expect(volumeOf(1.5)).toBe(100);
        expect(volumeOf(-0.05)).toBe(0);
        expect(volumeOf(Number.NaN)).toBe(0);
        expect(volumeOf(Number.POSITIVE_INFINITY)).toBe(0);
    });

    it('reads the live store state', async () => {
        const { selectHifiEngineConfig, useHifiSettingsStore } = await loadStore();
        useHifiSettingsStore.getState().setAudioDevice('coreaudio/BuiltInSpeakerDevice', 'MacBook Speakers');

        expect(selectHifiEngineConfig(useHifiSettingsStore.getState(), 1, false).audioDevice).toBe('coreaudio/BuiltInSpeakerDevice');
    });
});
