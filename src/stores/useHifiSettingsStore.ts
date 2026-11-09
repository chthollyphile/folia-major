import { create } from 'zustand';
import type { HifiDsdMode, HifiEngineConfig } from '../types/hifi';
import { getStoredBoolean, getStoredString, removeStoredKey, setStoredBoolean, setStoredString } from './storagePrimitives';

// src/stores/useHifiSettingsStore.ts
// HiFi（mpv）后端的设置：开关、mpv 路径、输出设备、独占、DSD 方式、Navidrome 是否走 HiFi、软件音量。
// 主进程不读这些键：渲染端用 selectHifiEngineConfig 拼出 HifiEngineConfig，经 window.electron.hifi.configure 下发。

export const HIFI_ENABLED_KEY = 'folia_hifi_enabled';

/** 手动指定的 mpv 可执行文件；空表示自动检测。 */
export const HIFI_MPV_PATH_KEY = 'folia_hifi_mpv_path';

/** mpv 的 audio-device 值，'auto' 跟随系统默认设备。 */
export const HIFI_AUDIO_DEVICE_KEY = 'folia_hifi_audio_device';

/** 选设备时的显示名，设备拔掉后设置页仍能说出之前选的是哪个。 */
export const HIFI_AUDIO_DEVICE_LABEL_KEY = 'folia_hifi_audio_device_label';

export const HIFI_EXCLUSIVE_KEY = 'folia_hifi_exclusive';

/** 'pcm' 或 'dop'。默认 pcm：不支持 DoP 的 DAC 收到 DoP 放出的是沙沙的噪声而不是音乐，MPD 也默认关。 */
export const HIFI_DSD_MODE_KEY = 'folia_hifi_dsd_mode';

/** Navidrome 歌曲是否也走 HiFi（以 format=raw 拉原始文件）。 */
export const HIFI_NAVIDROME_KEY = 'folia_hifi_navidrome';

/** 打开后 mpv 跟随应用音量，代价是这一路不再 bit-perfect。 */
export const HIFI_SOFTWARE_VOLUME_KEY = 'folia_hifi_software_volume';

/** “HiFi 下音量固定 100%” 的确认已经点过一次。 */
export const HIFI_VOLUME_CONFIRMED_KEY = 'folia_hifi_volume_confirmed';

const DEFAULT_AUDIO_DEVICE = 'auto';

const readStoredDsdMode = (): HifiDsdMode => (
    getStoredString(HIFI_DSD_MODE_KEY, 'pcm') === 'dop' ? 'dop' : 'pcm'
);

export type HifiSettingsState = {
    /** 关时所有歌都走 Web 引擎。 */
    enabled: boolean;
    /** 空串表示自动检测。 */
    mpvPath: string;
    audioDevice: string;
    audioDeviceLabel: string;
    exclusive: boolean;
    dsdMode: HifiDsdMode;
    navidrome: boolean;
    softwareVolume: boolean;
    volumeConfirmed: boolean;
    setEnabled: (enabled: boolean) => void;
    /** null 或空串回到自动检测。 */
    setMpvPath: (path: string | null) => void;
    /** 空的 name 回到 'auto'。 */
    setAudioDevice: (name: string, label: string) => void;
    setExclusive: (exclusive: boolean) => void;
    setDsdMode: (mode: HifiDsdMode) => void;
    setNavidrome: (enabled: boolean) => void;
    setSoftwareVolume: (enabled: boolean) => void;
    setVolumeConfirmed: (confirmed: boolean) => void;
};

export const useHifiSettingsStore = create<HifiSettingsState>((set) => ({
    enabled: getStoredBoolean(HIFI_ENABLED_KEY, false),
    mpvPath: getStoredString(HIFI_MPV_PATH_KEY, ''),
    audioDevice: getStoredString(HIFI_AUDIO_DEVICE_KEY, DEFAULT_AUDIO_DEVICE),
    audioDeviceLabel: getStoredString(HIFI_AUDIO_DEVICE_LABEL_KEY, ''),
    exclusive: getStoredBoolean(HIFI_EXCLUSIVE_KEY, true),
    dsdMode: readStoredDsdMode(),
    navidrome: getStoredBoolean(HIFI_NAVIDROME_KEY, true),
    softwareVolume: getStoredBoolean(HIFI_SOFTWARE_VOLUME_KEY, false),
    volumeConfirmed: getStoredBoolean(HIFI_VOLUME_CONFIRMED_KEY, false),

    setEnabled: (enabled) => {
        setStoredBoolean(HIFI_ENABLED_KEY, enabled);
        set({ enabled });
    },
    setMpvPath: (path) => {
        const mpvPath = path?.trim() ? path : '';
        if (mpvPath) {
            setStoredString(HIFI_MPV_PATH_KEY, mpvPath);
        } else {
            removeStoredKey(HIFI_MPV_PATH_KEY);
        }
        set({ mpvPath });
    },
    setAudioDevice: (name, label) => {
        const audioDevice = name || DEFAULT_AUDIO_DEVICE;
        const audioDeviceLabel = audioDevice === DEFAULT_AUDIO_DEVICE ? '' : label;
        setStoredString(HIFI_AUDIO_DEVICE_KEY, audioDevice);
        if (audioDeviceLabel) {
            setStoredString(HIFI_AUDIO_DEVICE_LABEL_KEY, audioDeviceLabel);
        } else {
            removeStoredKey(HIFI_AUDIO_DEVICE_LABEL_KEY);
        }
        set({ audioDevice, audioDeviceLabel });
    },
    setExclusive: (exclusive) => {
        setStoredBoolean(HIFI_EXCLUSIVE_KEY, exclusive);
        set({ exclusive });
    },
    setDsdMode: (mode) => {
        const dsdMode: HifiDsdMode = mode === 'dop' ? 'dop' : 'pcm';
        setStoredString(HIFI_DSD_MODE_KEY, dsdMode);
        set({ dsdMode });
    },
    setNavidrome: (enabled) => {
        setStoredBoolean(HIFI_NAVIDROME_KEY, enabled);
        set({ navidrome: enabled });
    },
    setSoftwareVolume: (enabled) => {
        setStoredBoolean(HIFI_SOFTWARE_VOLUME_KEY, enabled);
        set({ softwareVolume: enabled });
    },
    setVolumeConfirmed: (confirmed) => {
        setStoredBoolean(HIFI_VOLUME_CONFIRMED_KEY, confirmed);
        set({ volumeConfirmed: confirmed });
    },
}));

/** 0–1 之间；非有限数按 0 算：软件音量下宁可无声，也不要满音量。 */
const clampUnit = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * 把设置拼成下发给主进程的 HifiEngineConfig。
 *
 * appVolume 是应用音量（useAudioSettingsStore.volume），0–1，Web 引擎把它直接当线性增益用。mpv 的 volume 却按三次方
 * 曲线换成增益（50 → 0.125）：下发的是它的立方根乘 100、不取整，mpv 那边的增益就和 Web 引擎一样等于应用音量。
 * 超出 0–1 的夹回来。muted 是应用里的静音，单独下发，不折进音量：不开软件音量时它也要能让 mpv 静音。
 */
export const selectHifiEngineConfig = (
    state: Pick<HifiSettingsState, 'mpvPath' | 'audioDevice' | 'exclusive' | 'dsdMode' | 'softwareVolume'>,
    appVolume: number,
    muted: boolean,
): HifiEngineConfig => ({
    mpvPath: state.mpvPath.trim() ? state.mpvPath : null,
    audioDevice: state.audioDevice || DEFAULT_AUDIO_DEVICE,
    exclusive: state.exclusive,
    dsdMode: state.dsdMode === 'dop' ? 'dop' : 'pcm',
    softwareVolume: state.softwareVolume,
    volume: Math.cbrt(clampUnit(appVolume)) * 100,
    muted: muted === true,
});
