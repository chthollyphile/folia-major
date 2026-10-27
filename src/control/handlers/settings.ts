import type { SettingsSubviewId } from '../../stores/useSettingsModalStore';
import { useSettingsModalStore } from '../../stores/useSettingsModalStore';
import { useAudioSettingsStore } from '../../stores/useAudioSettingsStore';
import { useLyricSettingsStore } from '../../stores/useLyricSettingsStore';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useSleepTimerStore } from '../../stores/useSleepTimerStore';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../../stores/useVisualizerSettingsStore';
import { useAppViewStore } from '../../stores/useAppViewStore';
import { SETTINGS_ANCHOR_DEFINITIONS } from '../../components/modal/settings/navigation/settingsAnchorModel';
import { hasVisualizerMode } from '../../components/visualizer/registry';
import { hasVisualizerBackgroundMode } from '../../components/visualizer/backgrounds/registry';
import type { AudioQualityPreference } from '../../types/onlineMusic';
import type { ReplayGainMode } from '../../types';
import { ControlError, requireString } from '../errors';
import { readMainProcessSettings } from '../helpers';
import type { ControlHandler } from '../types';

// src/control/handlers/settings.ts
// Curated settings read/write through the owning store actions, plus opening the settings dialog.
// Only the whitelisted dotted paths are writable; everything else is a command (folia_palette_run).

const SETTINGS_STORE_NAMES = [
    'audio', 'visualizer', 'theme', 'lyrics', 'playback', 'sleepTimer', 'view', 'appearance', 'main',
] as const;

type SettingsStoreName = (typeof SETTINGS_STORE_NAMES)[number];

const SETTINGS_SUBVIEWS: readonly SettingsSubviewId[] = [
    'appearance', 'player', 'home', 'playback', 'lyrics', 'general', 'interaction', 'integration',
    'storage', 'desktop', 'graphics', 'mods', 'visualizer', 'themePark', 'lyricFilter', 'globalLyricOffset',
];

const AUDIO_QUALITIES: readonly AudioQualityPreference[] = ['standard', 'high', 'ultra', 'lossless', 'hires'];
const LOOP_MODES = ['off', 'all', 'one'] as const;
const REPLAY_GAIN_MODES: readonly ReplayGainMode[] = ['off', 'track', 'album', 'auto'];

type SettingsSection = Record<string, unknown>;

const readAudioSettings = (): SettingsSection => {
    const state = useAudioSettingsStore.getState();
    return {
        audioQuality: state.audioQuality,
        enableMediaCache: state.enableMediaCache,
        mediaCacheLimitGb: state.mediaCacheLimitGb,
        queueAddBehavior: state.queueAddBehavior,
        autoPlayOnLaunch: state.autoPlayOnLaunch,
        enableTranscodeFallback: state.enableTranscodeFallback,
        // 平台命名的偏好字段按「以 ScrobbleEnabled 结尾」通用读取：平台规则不写在平台目录外
        // （omniArchitecture.test.ts 会统计平台名），控制层只按字段形状收编。
        ...Object.fromEntries(
            Object.entries(state).filter(([key]) => key.endsWith('ScrobbleEnabled')),
        ),
        playbackFadeEnabled: state.playbackFadeEnabled,
        autoSkipUnplayable: state.autoSkipUnplayable,
        audioOutputDeviceId: state.audioOutputDeviceId,
        audioEqualizerEnabled: state.audioEqualizerSettings.enabled,
        audioEqualizerPreset: state.audioEqualizerSettings.preset,
        volume: state.volume,
        isMuted: state.isMuted,
        loopMode: state.loopMode,
    };
};

const readVisualizerSettings = (): SettingsSection => {
    const state = useVisualizerSettingsStore.getState();
    return {
        mode: state.visualizerMode,
        background: state.visualizerBackgroundMode,
        randomPerSong: state.randomVisualizerModePerSong,
        glowBlurQuantize: state.glowBlurQuantize,
        visualizerOpacity: state.visualizerOpacity,
        backgroundOpacity: state.backgroundOpacity,
        frameRate: state.visualizerFrameRate,
        disableVignette: state.disableVisualizerVignette,
        disableGeometricBackground: state.disableVisualizerGeometricBackground,
        smartBeat: { enabled: state.smartBeat.mode !== 'off', mode: state.smartBeat.mode },
        monetBackgroundTuning: state.monetBackgroundTuning,
        latentBackgroundTuning: state.latentBackgroundTuning,
    };
};

const readThemeSettings = (): SettingsSection => {
    const state = useThemeSettingsStore.getState();
    return {
        daylight: state.isDaylight,
        followSystemTheme: state.followSystemTheme,
        coverColorBg: state.useCoverColorBg,
        staticMode: state.staticMode,
        disableHomeDynamicBackground: state.disableHomeDynamicBackground,
    };
};

const readLyricSettings = (): SettingsSection => {
    const state = useLyricSettingsStore.getState();
    return {
        autoUseBest: state.autoUseBestLyric,
        preferredAlternativeLyricSource: state.preferredAlternativeLyricSource,
        localLyricsPriority: state.localLyricsPriority,
        globalOffsetMs: state.globalLyricTimelineOffsetMs,
        filterRuleCount: state.lyricLineRules.length,
        staffPolicy: state.lyricStaffPolicy,
        staffMinDwellSeconds: state.lyricStaffMinDwellSeconds,
        staffAbsorbMode: state.lyricStaffAbsorbMode,
    };
};

const readPlaybackSettings = (): SettingsSection => {
    const state = usePlaybackStore.getState();
    return {
        replayGainMode: state.replayGainMode,
        lyricOffsetMs: state.lyricTimelineOffsetMs,
        isFmMode: state.isFmMode,
    };
};

const readSleepTimerSettings = (): SettingsSection => {
    const state = useSleepTimerStore.getState();
    return {
        enabled: state.sleepTimerEnabled,
        hours: state.sleepTimerHours,
        minutes: state.sleepTimerMinutes,
        deadlineMs: state.sleepTimerDeadlineMs,
    };
};

const readViewSettings = (): SettingsSection => {
    const view = useAppViewStore.getState();
    return {
        view: view.view,
        panelOpen: view.isPanelOpen,
        panelTab: view.panelTab,
        settingsOpen: useSettingsModalStore.getState().settingsModalState.isOpen,
    };
};

const readSettingsSection = async (store: SettingsStoreName): Promise<SettingsSection> => {
    switch (store) {
        case 'audio':
            return readAudioSettings();
        case 'visualizer':
            return readVisualizerSettings();
        case 'theme':
            return readThemeSettings();
        case 'lyrics':
            return readLyricSettings();
        case 'playback':
            return readPlaybackSettings();
        case 'sleepTimer':
            return readSleepTimerSettings();
        case 'view':
            return readViewSettings();
        case 'appearance':
            return readThemeSettings();
        case 'main':
            return readMainProcessSettings();
        default: {
            const exhaustive: never = store;
            throw new ControlError('bad_request', `Unknown settings store "${String(exhaustive)}"`);
        }
    }
};

const requireBooleanValue = (value: unknown, key: string): boolean => {
    if (typeof value !== 'boolean') {
        throw new ControlError('bad_request', `"${key}" needs a boolean value`);
    }
    return value;
};

const requireNumberValue = (value: unknown, key: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ControlError('bad_request', `"${key}" needs a number value`);
    }
    return value;
};

const requireIntegerValue = (value: unknown, key: string): number => {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new ControlError('bad_request', `"${key}" needs an integer value`);
    }
    return value;
};

const requireProviderChoice = <T extends string>(value: unknown, key: string, allowed: readonly T[]): T => {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
        throw new ControlError('bad_request', `"${key}" must be one of: ${allowed.join(', ')}`);
    }
    return value as T;
};

const SUPPORTED_SETTING_PATHS = [
    'audio.volume', 'audio.muted', 'audio.loopMode', 'audio.audioQuality', 'audio.playbackFade',
    'visualizer.mode', 'visualizer.background', 'visualizer.opacity', 'visualizer.randomPerSong',
    'visualizer.glowBlurQuantize',
    'theme.daylight', 'theme.followSystemTheme', 'theme.coverColorBg', 'theme.staticMode',
    'theme.disableHomeDynamicBackground',
    'lyrics.globalOffsetMs', 'lyrics.autoUseBest',
    'playback.replayGainMode',
    'sleepTimer.hours', 'sleepTimer.minutes',
] as const;

type SupportedSettingPath = (typeof SUPPORTED_SETTING_PATHS)[number];

const isSupportedSettingPath = (value: string): value is SupportedSettingPath => (
    (SUPPORTED_SETTING_PATHS as readonly string[]).includes(value)
);

const writeSetting = (key: SupportedSettingPath, value: unknown, deps: Parameters<ControlHandler>[1]): void => {
    switch (key) {
        case 'audio.volume': {
            const level = requireNumberValue(value, key);
            const normalized = level > 1 ? level / 100 : level;
            useAudioSettingsStore.getState().handleSetVolume(Math.min(1, Math.max(0, normalized)));
            return;
        }
        case 'audio.muted':
            useAudioSettingsStore.getState().handleSetMuted(requireBooleanValue(value, key));
            return;
        case 'audio.loopMode':
            useAudioSettingsStore.getState().handleSetLoopMode(requireProviderChoice(value, key, LOOP_MODES));
            return;
        case 'audio.audioQuality':
            useAudioSettingsStore.getState().setAudioQuality(requireProviderChoice(value, key, AUDIO_QUALITIES));
            return;
        case 'audio.playbackFade':
            useAudioSettingsStore.getState().handleTogglePlaybackFade(requireBooleanValue(value, key));
            return;
        case 'visualizer.mode': {
            const mode = requireString(value, key);
            if (!hasVisualizerMode(mode)) {
                throw new ControlError('bad_request', `Unknown visualizer mode "${mode}"`);
            }
            useVisualizerSettingsStore.getState().handleSetVisualizerMode(mode);
            return;
        }
        case 'visualizer.background': {
            if (value === null) {
                useVisualizerSettingsStore.getState().handleResetVisualizerBackgroundMode();
                return;
            }
            const mode = requireString(value, key);
            if (!hasVisualizerBackgroundMode(mode)) {
                throw new ControlError('bad_request', `Unknown background mode "${mode}"`);
            }
            useVisualizerSettingsStore.getState().handleSetVisualizerBackgroundMode(mode);
            return;
        }
        case 'visualizer.opacity':
            useVisualizerSettingsStore.getState().handleSetVisualizerOpacity(requireNumberValue(value, key));
            return;
        case 'visualizer.randomPerSong':
            useVisualizerSettingsStore.getState().handleToggleRandomVisualizerModePerSong(requireBooleanValue(value, key));
            return;
        case 'visualizer.glowBlurQuantize':
            useVisualizerSettingsStore.getState().handleToggleGlowBlurQuantize(requireBooleanValue(value, key));
            return;
        case 'theme.daylight':
            useThemeSettingsStore.getState().setDaylightPreference(requireBooleanValue(value, key));
            return;
        case 'theme.followSystemTheme':
            useThemeSettingsStore.getState().setFollowSystemTheme(requireBooleanValue(value, key));
            return;
        case 'theme.coverColorBg':
            useThemeSettingsStore.getState().handleToggleCoverColorBg(requireBooleanValue(value, key));
            return;
        case 'theme.staticMode':
            useThemeSettingsStore.getState().handleToggleStaticMode(requireBooleanValue(value, key));
            return;
        case 'theme.disableHomeDynamicBackground':
            useThemeSettingsStore.getState().handleToggleDisableHomeDynamicBackground(requireBooleanValue(value, key));
            return;
        case 'lyrics.globalOffsetMs':
            useLyricSettingsStore.getState().handleSetGlobalLyricTimelineOffsetMs(requireNumberValue(value, key));
            return;
        case 'lyrics.autoUseBest':
            useLyricSettingsStore.getState().handleToggleAutoUseBestLyric(requireBooleanValue(value, key));
            return;
        case 'playback.replayGainMode':
            deps.context.playback.setReplayGainMode(requireProviderChoice(value, key, REPLAY_GAIN_MODES));
            return;
        case 'sleepTimer.hours':
            useSleepTimerStore.getState().handleSetSleepTimerHours(requireIntegerValue(value, key));
            return;
        case 'sleepTimer.minutes':
            useSleepTimerStore.getState().handleSetSleepTimerMinutes(requireIntegerValue(value, key));
            return;
        default: {
            const exhaustive: never = key;
            throw new ControlError('bad_request', `Unsupported setting "${String(exhaustive)}"`);
        }
    }
};

const readSettingValue = (key: SupportedSettingPath): unknown => {
    switch (key) {
        case 'audio.volume':
            return useAudioSettingsStore.getState().volume;
        case 'audio.muted':
            return useAudioSettingsStore.getState().isMuted;
        case 'audio.loopMode':
            return useAudioSettingsStore.getState().loopMode;
        case 'audio.audioQuality':
            return useAudioSettingsStore.getState().audioQuality;
        case 'audio.playbackFade':
            return useAudioSettingsStore.getState().playbackFadeEnabled;
        case 'visualizer.mode':
            return useVisualizerSettingsStore.getState().visualizerMode;
        case 'visualizer.background':
            return useVisualizerSettingsStore.getState().visualizerBackgroundMode;
        case 'visualizer.opacity':
            return useVisualizerSettingsStore.getState().visualizerOpacity;
        case 'visualizer.randomPerSong':
            return useVisualizerSettingsStore.getState().randomVisualizerModePerSong;
        case 'visualizer.glowBlurQuantize':
            return useVisualizerSettingsStore.getState().glowBlurQuantize;
        case 'theme.daylight':
            return useThemeSettingsStore.getState().isDaylight;
        case 'theme.followSystemTheme':
            return useThemeSettingsStore.getState().followSystemTheme;
        case 'theme.coverColorBg':
            return useThemeSettingsStore.getState().useCoverColorBg;
        case 'theme.staticMode':
            return useThemeSettingsStore.getState().staticMode;
        case 'theme.disableHomeDynamicBackground':
            return useThemeSettingsStore.getState().disableHomeDynamicBackground;
        case 'lyrics.globalOffsetMs':
            return useLyricSettingsStore.getState().globalLyricTimelineOffsetMs;
        case 'lyrics.autoUseBest':
            return useLyricSettingsStore.getState().autoUseBestLyric;
        case 'playback.replayGainMode':
            return usePlaybackStore.getState().replayGainMode;
        case 'sleepTimer.hours':
            return useSleepTimerStore.getState().sleepTimerHours;
        case 'sleepTimer.minutes':
            return useSleepTimerStore.getState().sleepTimerMinutes;
        default: {
            const exhaustive: never = key;
            return exhaustive;
        }
    }
};

export const settingsHandlers: Record<string, ControlHandler> = {
    folia_settings_read: async (args) => {
        const store = typeof args.store === 'string' ? args.store : undefined;
        const key = typeof args.key === 'string' ? args.key : undefined;
        if (store !== undefined && !(SETTINGS_STORE_NAMES as readonly string[]).includes(store)) {
            throw new ControlError('bad_request', `Unknown settings store "${store}"`, {
                stores: SETTINGS_STORE_NAMES,
            });
        }
        if (key !== undefined && store === undefined) {
            throw new ControlError('bad_request', '"store" is required together with "key"');
        }
        if (store === undefined) {
            const sections: Record<string, unknown> = {};
            for (const name of SETTINGS_STORE_NAMES) {
                sections[name] = await readSettingsSection(name);
            }
            return { settings: sections };
        }
        const section = await readSettingsSection(store as SettingsStoreName);
        if (key === undefined) {
            return { store, settings: section };
        }
        if (!(key in section)) {
            throw new ControlError('bad_request', `Unknown settings key "${key}" in store "${store}"`, {
                keys: Object.keys(section),
            });
        }
        return { store, key, value: section[key] };
    },

    folia_settings_write: (args, deps) => {
        const key = requireString(args.key, 'key');
        if (!('value' in args)) {
            throw new ControlError('bad_request', '"value" is required');
        }
        if (!isSupportedSettingPath(key)) {
            throw new ControlError('bad_request', `Setting "${key}" is not writable`, {
                supported: SUPPORTED_SETTING_PATHS,
            });
        }
        writeSetting(key, args.value, deps);
        return { key, value: readSettingValue(key), written: true };
    },

    folia_settings_open: (args) => {
        const tab = args.tab === 'help' ? 'help' : 'options';
        const subview = args.subview === undefined
            ? undefined
            : requireString(args.subview, 'subview');
        if (subview !== undefined && !SETTINGS_SUBVIEWS.includes(subview as SettingsSubviewId)) {
            throw new ControlError('bad_request', `Unknown settings subview "${subview}"`, {
                subviews: SETTINGS_SUBVIEWS,
            });
        }
        const anchor = args.anchor === undefined ? undefined : requireString(args.anchor, 'anchor');
        if (anchor !== undefined && !(anchor in SETTINGS_ANCHOR_DEFINITIONS)) {
            throw new ControlError('bad_request', `Unknown settings anchor "${anchor}"`, {
                anchors: Object.keys(SETTINGS_ANCHOR_DEFINITIONS),
            });
        }
        useSettingsModalStore.getState().openSettings(
            tab,
            (subview ?? null) as SettingsSubviewId | null,
            null,
            (anchor ?? null) as keyof typeof SETTINGS_ANCHOR_DEFINITIONS | null,
        );
        return { open: true, tab, subview: subview ?? null, anchor: anchor ?? null };
    },
};

