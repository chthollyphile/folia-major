// src/stores/useAudioSettingsStore.ts
// Audio output and the media cache: stream quality, output device, the equalizer, how queued
// songs are added, and the cache ceiling.
//
// volume / isMuted / loopMode live here too. They are playback state rather than settings, but
// they are audio-output state, and this is their nearest owner until the Phase B transport store
// exists — at which point they may move once more.

import { create } from 'zustand';
import type { AudioQualityPreference } from '../types/onlineMusic';
import { type QueueAddBehavior } from '../types';
import { areAudioEqualizerSettingsEqual, planAudioSoundPreset, readStoredAudioEqualizerSettings, resolveAudioEqualizerSettings, writeStoredAudioEqualizerSettings, type AudioEqualizerCustomSlotId, type AudioEqualizerModeId, type AudioEqualizerSettings } from '../utils/audioEqualizer';
import {
    areAudioEqualizerModCurvesEqual,
    isSameOwnSound,
    normalizeAudioEqualizerModCurveGains,
    parseStoredAudioEqualizerModCurve,
    saveAudioEqualizerModCurveToSlot,
    serializeAudioEqualizerModCurve,
    type AudioEqualizerChangeOrigin,
    type AudioEqualizerModCurve,
} from '../utils/audioEqualizerModCurve';
import { getStoredBoolean, getStoredString, removeStoredKey, setStoredBoolean, setStoredString } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';
import i18n from '../i18n/config';

export const CACHE_SIZE_KEY = 'folia_cache_size';

export const ENABLE_MEDIA_CACHE_KEY = 'folia_enable_media_cache';

/** What the toggle used to write to, before it was corrected to the prefixed key above. */
export const LEGACY_ENABLE_MEDIA_CACHE_KEY = 'enable_media_cache';

export const MEDIA_CACHE_LIMIT_GB_KEY = 'folia_media_cache_limit_gb';

/** Lab switch: start the restored last session playing instead of waiting for a press. */
export const AUTO_PLAY_ON_LAUNCH_KEY = 'folia_auto_play_on_launch';

export const ENABLE_TRANSCODE_FALLBACK_KEY = 'folia_enable_transcode_fallback';

/** Whether finished plays of online NetEase tracks are reported to the signed-in account. */
export const NETEASE_SCROBBLE_KEY = 'folia_netease_scrobble';

/** Whether pause fades out and resume fades in (services/playbackFade). On unless switched off. */
export const PLAYBACK_FADE_KEY = 'folia_playback_fade_enabled';

/**
 * Whether a song that cannot be played for an account restriction or an unknown reason counts down to
 * a skip, like a taken-down one (services/onlineMusic/failure/onlineFailureCase). Off unless asked for.
 */
export const AUTO_SKIP_UNPLAYABLE_KEY = 'folia_auto_skip_unplayable';

/**
 * Folium 1.7: the equalizer curve a mod put in place over the listener's own sound (utils/audioEqualizerModCurve.ts),
 * removed when the listener's own sound plays again. audio_equalizer_settings never holds it.
 */
export const AUDIO_EQUALIZER_MOD_CURVE_KEY = 'folia_audio_equalizer_mod_curve';

/** Gigabytes of cached audio to keep. Zero is the listener asking for no ceiling at all. */
export const DEFAULT_MEDIA_CACHE_LIMIT_GB = 5;

export type AudioQuality = AudioQualityPreference;

export const resolveStoredAudioQuality = (saved: string | null): AudioQuality => (
    saved === 'standard' || saved === 'ultra' || saved === 'lossless' || saved === 'hires' ? saved : 'high'
);

/**
 * Reads the media cache toggle, honouring the key its own setter used to write to.
 *
 * The setter wrote a bare 'enable_media_cache' while startup read the folia-prefixed key, so the
 * setting silently reverted to off on every restart. Anyone who switched it on has their real
 * preference sitting under the legacy key, and simply correcting the setter would throw that
 * away once more - so read it as a fallback and promote it to the canonical key.
 */
export const readStoredEnableMediaCache = (): boolean => {
    if (typeof window === 'undefined') {
        return false;
    }

    const canonical = localStorage.getItem(ENABLE_MEDIA_CACHE_KEY);
    if (canonical !== null) {
        return canonical === 'true';
    }

    const legacy = localStorage.getItem(LEGACY_ENABLE_MEDIA_CACHE_KEY);
    if (legacy === null) {
        return false;
    }

    localStorage.setItem(ENABLE_MEDIA_CACHE_KEY, legacy);
    return legacy === 'true';
};

export const readStoredMediaCacheLimitGb = (): number => {
    if (typeof window === 'undefined') {
        return DEFAULT_MEDIA_CACHE_LIMIT_GB;
    }

    const saved = localStorage.getItem(MEDIA_CACHE_LIMIT_GB_KEY);
    const parsed = saved === null ? NaN : Number(saved);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MEDIA_CACHE_LIMIT_GB;
};

const readStoredAudioQuality = (): AudioQuality => {
    if (typeof window === 'undefined') {
        return 'high';
    }

    const saved = localStorage.getItem('default_audio_quality');
    const quality = resolveStoredAudioQuality(saved);
    if (saved === 'exhigh') {
        localStorage.setItem('default_audio_quality', 'high');
    }
    return quality;
};

const readStoredQueueAddBehavior = (): QueueAddBehavior => {
    if (typeof window === 'undefined') {
        return 'append';
    }

    const saved = localStorage.getItem('queue_add_behavior');
    return saved === 'next' ? 'next' : 'append';
};

const readStoredAudioOutputDeviceId = (): string => {
    if (typeof window === 'undefined') {
        return '';
    }

    return localStorage.getItem('audio_output_device_id') ?? '';
};

const readStoredLoopMode = (): 'off' | 'all' | 'one' => {
    if (typeof window === 'undefined') {
        return 'off';
    }

    const saved = localStorage.getItem('player_loop_mode');
    return saved === 'all' || saved === 'one' ? saved : 'off';
};

/**
 * The mod curve kept from the last run, checked against the listener's own sound: one saved by a later
 * version is left in place unused (going back to that version finds it again), a broken one is removed, and
 * so is one whose base the listener's sound no longer matches (it was changed where nothing ended the curve,
 * an older version for one: the listener has chosen since).
 */
const readStoredAudioEqualizerModCurve = (settings: AudioEqualizerSettings): AudioEqualizerModCurve | null => {
    const raw = getStoredString(AUDIO_EQUALIZER_MOD_CURVE_KEY, '');
    if (!raw) {
        return null;
    }

    const stored = parseStoredAudioEqualizerModCurve(raw);
    if ('ignore' in stored) {
        console.info(`[AudioEqualizer] kept a mod curve saved by a later version (v=${String(stored.version)}); not used here`);
        return null;
    }
    if ('drop' in stored) {
        console.info('[AudioEqualizer] dropped a stored mod curve that could not be read');
        removeStoredKey(AUDIO_EQUALIZER_MOD_CURVE_KEY);
        return null;
    }
    if (!isSameOwnSound(stored.curve.base, settings)) {
        console.info(`[AudioEqualizer] dropped the curve of ${stored.curve.modId}: your own sound changed since it was applied`);
        removeStoredKey(AUDIO_EQUALIZER_MOD_CURVE_KEY);
        return null;
    }
    return stored.curve;
};

const writeStoredAudioEqualizerModCurve = (curve: AudioEqualizerModCurve | null) => {
    if (curve) {
        setStoredString(AUDIO_EQUALIZER_MOD_CURVE_KEY, serializeAudioEqualizerModCurve(curve));
    } else {
        removeStoredKey(AUDIO_EQUALIZER_MOD_CURVE_KEY);
    }
};

const USER_ORIGIN: AudioEqualizerChangeOrigin = { kind: 'user' };
const COMMAND_ORIGIN: AudioEqualizerChangeOrigin = { kind: 'command' };
const HOST_ORIGIN: AudioEqualizerChangeOrigin = { kind: 'host' };

const readStoredVolume = () => {
    if (typeof window === 'undefined') {
        return 1;
    }

    const saved = localStorage.getItem('player_volume');
    const parsed = saved !== null ? parseFloat(saved) : 1;
    return Number.isFinite(parsed) ? parsed : 1;
};

export type AudioSettingsState = {
    audioQuality: AudioQuality;
    enableMediaCache: boolean;
    /** Gigabytes of cached audio to keep before the oldest is dropped. Zero means no ceiling. */
    mediaCacheLimitGb: number;
    queueAddBehavior: QueueAddBehavior;
    /** Whether entering the app starts the restored session by itself. Off unless asked for. */
    autoPlayOnLaunch: boolean;
    /** Electron-only recovery for local and Navidrome formats Chromium cannot decode. */
    enableTranscodeFallback: boolean;
    /** Report finished plays of online NetEase tracks to the signed-in account. Off by default. */
    neteaseScrobbleEnabled: boolean;
    /** Short fade when pausing and resuming instead of cutting the sound. On by default. */
    playbackFadeEnabled: boolean;
    /** Count down to a skip when a song is restricted or fails for an unknown reason. Off by default. */
    autoSkipUnplayable: boolean;
    audioOutputDeviceId: string;
    /** The listener's own sound, always: a mod's curve is never written into it. */
    audioEqualizerSettings: AudioEqualizerSettings;
    /** A curve a mod put in place over the listener's own sound; null while the listener's own sound plays. Persisted. */
    audioEqualizerModCurve: AudioEqualizerModCurve | null;
    /**
     * True while the mod of that curve is disabled or removed: the curve is kept but not heard. Not persisted; the
     * Folium host layer sets it from the mod list (runtime/equalizer/hostEqualizer.ts). False whenever there is no curve.
     */
    audioEqualizerModCurveSuspended: boolean;
    /** Who made the last equalizer change; not persisted. Read by the Folium host layer and the audio bridge. */
    audioEqualizerChangeOrigin: AudioEqualizerChangeOrigin;
    isAudioEqualizerOpen: boolean;
    volume: number;
    isMuted: boolean;
    loopMode: 'off' | 'all' | 'one';
    setAudioQuality: (quality: AudioQuality) => void;
    handleToggleMediaCache: (enable: boolean) => void;
    handleSetMediaCacheLimitGb: (gigabytes: number) => void;
    handleSetQueueAddBehavior: (behavior: QueueAddBehavior) => void;
    handleToggleAutoPlayOnLaunch: (enable: boolean) => void;
    handleToggleTranscodeFallback: (enable: boolean) => void;
    handleToggleNeteaseScrobble: (enable: boolean) => void;
    handleTogglePlaybackFade: (enable: boolean) => void;
    handleToggleAutoSkipUnplayable: (enable: boolean) => void;
    handleSetAudioOutputDeviceId: (deviceId: string) => void;
    /*
     * The equalizer actions below return whether anything changed: the listener's settings they leave
     * (compared field by field) or the mod curve record. When nothing did they neither set nor save.
     * Each change is one set, with the origin beside the settings.
     */
    /** Writes the listener's whole sound (the window: a preset, the reset, an edit); ends a mod's curve. */
    handleSetAudioEqualizerSettings: (settings: AudioEqualizerSettings, origin?: AudioEqualizerChangeOrigin) => boolean;
    /** Flips only the processing switch; a mod's curve stays. */
    handleSetAudioEqualizerEnabled: (enabled: boolean, origin?: AudioEqualizerChangeOrigin) => boolean;
    /**
     * Applies a built-in sound or a saved custom slot and ends a mod's curve. Turns processing on unless
     * `keepEnabled` (a mod's write never touches the switch). The origin is `command` unless given.
     */
    handleApplyAudioSoundPreset: (
        modeId: AudioEqualizerModeId,
        options?: { origin?: AudioEqualizerChangeOrigin; keepEnabled?: boolean },
    ) => boolean;
    /** Folium 1.7: puts a mod's curve in place over the listener's own sound, which stays as it is. */
    handleApplyModEqualizerCurve: (curve: { modId: string; modName: string; gains: readonly number[] }) => boolean;
    /** Takes the mod curve off, back to the listener's own sound; false when there is none. */
    handleReleaseModEqualizerCurve: (origin: AudioEqualizerChangeOrigin) => boolean;
    /** The window's "save to custom N": that slot becomes the curve with the listener's effects, and is chosen. */
    handleSaveModEqualizerCurveToSlot: (slotId: AudioEqualizerCustomSlotId) => boolean;
    /** For the Folium host layer only: holds the curve back while its mod is disabled or removed. No-op without a curve. */
    handleSetAudioEqualizerModCurveSuspended: (suspended: boolean) => boolean;
    openAudioEqualizer: () => void;
    closeAudioEqualizer: () => void;
    handleSetVolume: (val: number) => void;
    /** Sets the mute switch; the same value is a no-op. */
    handleSetMuted: (muted: boolean) => void;
    handleToggleMute: () => void;
    /** Sets the repeat mode and toasts it like the repeat button; the mode already in effect is a no-op. */
    handleSetLoopMode: (mode: 'off' | 'all' | 'one') => void;
    handleToggleLoopMode: () => void;
};

/*
 * One equalizer change: the listener's settings it leaves and the mod curve record after it. Nothing
 * changes when both are the same as now: then no set and nothing saved, and false. Otherwise what changed
 * is saved and set at once, with the origin. A curve that changes is heard (the mod putting it there runs,
 * and with none there is nothing to hold back), so the suspension goes with it.
 */
const commitAudioEqualizerChange = (
    get: () => AudioSettingsState,
    set: (partial: Partial<AudioSettingsState>) => void,
    settings: AudioEqualizerSettings,
    curve: AudioEqualizerModCurve | null,
    origin: AudioEqualizerChangeOrigin,
): boolean => {
    const current = get();
    const settingsChanged = !areAudioEqualizerSettingsEqual(settings, current.audioEqualizerSettings);
    const curveChanged = !areAudioEqualizerModCurvesEqual(curve, current.audioEqualizerModCurve);
    if (!settingsChanged && !curveChanged) {
        return false;
    }

    if (settingsChanged) {
        writeStoredAudioEqualizerSettings(settings);
    }
    if (curveChanged) {
        writeStoredAudioEqualizerModCurve(curve);
    }
    set({
        ...(settingsChanged ? { audioEqualizerSettings: settings } : {}),
        ...(curveChanged ? { audioEqualizerModCurve: curve, audioEqualizerModCurveSuspended: false } : {}),
        audioEqualizerChangeOrigin: origin,
    });
    return true;
};

const initialAudioEqualizerSettings = readStoredAudioEqualizerSettings();

export const useAudioSettingsStore = create<AudioSettingsState>((set, get) => ({
    audioQuality: readStoredAudioQuality(),
    enableMediaCache: readStoredEnableMediaCache(),
    mediaCacheLimitGb: readStoredMediaCacheLimitGb(),
    queueAddBehavior: readStoredQueueAddBehavior(),
    autoPlayOnLaunch: getStoredBoolean(AUTO_PLAY_ON_LAUNCH_KEY, false),
    enableTranscodeFallback: getStoredBoolean(
        ENABLE_TRANSCODE_FALLBACK_KEY,
        typeof window !== 'undefined' && Boolean(window.electron?.requestTranscodeFallback),
    ),
    // Off unless asked for: it writes to the listener's music account, so it is never a default.
    neteaseScrobbleEnabled: getStoredBoolean(NETEASE_SCROBBLE_KEY, false),
    playbackFadeEnabled: getStoredBoolean(PLAYBACK_FADE_KEY, true),
    // Off unless asked for: skipping a song the listener picked is not something to do by default.
    autoSkipUnplayable: getStoredBoolean(AUTO_SKIP_UNPLAYABLE_KEY, false),
    audioOutputDeviceId: readStoredAudioOutputDeviceId(),
    audioEqualizerSettings: initialAudioEqualizerSettings,
    audioEqualizerModCurve: readStoredAudioEqualizerModCurve(initialAudioEqualizerSettings),
    audioEqualizerModCurveSuspended: false,
    audioEqualizerChangeOrigin: HOST_ORIGIN,
    isAudioEqualizerOpen: false,
    volume: readStoredVolume(),
    isMuted: getStoredBoolean('player_is_muted', false),
    loopMode: readStoredLoopMode(),
    setAudioQuality: (quality) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('default_audio_quality', quality);
        }
        set({ audioQuality: quality });
    },
    handleToggleMediaCache: (enable) => {
        setStoredBoolean(ENABLE_MEDIA_CACHE_KEY, enable);
        set({ enableMediaCache: enable });
    },
    handleSetMediaCacheLimitGb: (gigabytes) => {
        const next = Number.isFinite(gigabytes) && gigabytes >= 0 ? gigabytes : DEFAULT_MEDIA_CACHE_LIMIT_GB;
        if (typeof window !== 'undefined') {
            localStorage.setItem(MEDIA_CACHE_LIMIT_GB_KEY, String(next));
        }
        set({ mediaCacheLimitGb: next });
    },
    handleSetQueueAddBehavior: (behavior) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('queue_add_behavior', behavior);
        }
        set({ queueAddBehavior: behavior });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (behavior === 'next' ? 'queueInsertNext' : 'queueAppend')),
        });
    },
    handleToggleAutoPlayOnLaunch: (enable) => {
        setStoredBoolean(AUTO_PLAY_ON_LAUNCH_KEY, enable);
        set({ autoPlayOnLaunch: enable });
        setStatusMessage({
            type: 'info',
            text: i18n.t('notifications.' + (enable ? 'autoPlayOnLaunchOn' : 'autoPlayOnLaunchOff')),
        });
    },
    handleToggleTranscodeFallback: (enable) => {
        setStoredBoolean(ENABLE_TRANSCODE_FALLBACK_KEY, enable);
        set({ enableTranscodeFallback: enable });
    },
    handleToggleNeteaseScrobble: (enable) => {
        setStoredBoolean(NETEASE_SCROBBLE_KEY, enable);
        set({ neteaseScrobbleEnabled: enable });
    },
    handleTogglePlaybackFade: (enable) => {
        setStoredBoolean(PLAYBACK_FADE_KEY, enable);
        set({ playbackFadeEnabled: enable });
    },
    handleToggleAutoSkipUnplayable: (enable) => {
        setStoredBoolean(AUTO_SKIP_UNPLAYABLE_KEY, enable);
        set({ autoSkipUnplayable: enable });
    },
    handleSetAudioOutputDeviceId: (deviceId) => {
        set({ audioOutputDeviceId: deviceId });
        if (typeof window === 'undefined') {
            return;
        }

        if (deviceId) {
            localStorage.setItem('audio_output_device_id', deviceId);
        } else {
            localStorage.removeItem('audio_output_device_id');
        }
    },
    handleSetAudioEqualizerSettings: (settings, origin = USER_ORIGIN) => (
        commitAudioEqualizerChange(get, set, resolveAudioEqualizerSettings(settings), null, origin)
    ),
    // The switch stops the processing and keeps every value, a mod's curve included.
    handleSetAudioEqualizerEnabled: (enabled, origin = USER_ORIGIN) => {
        const current = get();
        return commitAudioEqualizerChange(
            get,
            set,
            { ...current.audioEqualizerSettings, enabled },
            current.audioEqualizerModCurve,
            origin,
        );
    },
    // Applies a built-in sound preset or a saved custom slot, and turns processing on.
    handleApplyAudioSoundPreset: (modeId, options = {}) => {
        const next = planAudioSoundPreset(get().audioEqualizerSettings, modeId, { keepEnabled: options.keepEnabled });
        if (!next) {
            return false;
        }
        return commitAudioEqualizerChange(get, set, next, null, options.origin ?? COMMAND_ORIGIN);
    },
    // The listener's own settings stay as they are: the curve lies over them and is taken off again whole.
    handleApplyModEqualizerCurve: ({ modId, modName, gains }) => {
        const settings = get().audioEqualizerSettings;
        const curve: AudioEqualizerModCurve = {
            modId,
            modName,
            gains: normalizeAudioEqualizerModCurveGains(gains),
            base: { preset: settings.preset, gains: [...settings.gains], effects: { ...settings.effects } },
        };
        return commitAudioEqualizerChange(get, set, settings, curve, { kind: 'mod', modId });
    },
    handleReleaseModEqualizerCurve: (origin) => {
        const current = get();
        if (!current.audioEqualizerModCurve) {
            return false;
        }
        return commitAudioEqualizerChange(get, set, current.audioEqualizerSettings, null, origin);
    },
    handleSaveModEqualizerCurveToSlot: (slotId) => {
        const current = get();
        if (!current.audioEqualizerModCurve) {
            return false;
        }
        return commitAudioEqualizerChange(
            get,
            set,
            saveAudioEqualizerModCurveToSlot(current.audioEqualizerSettings, current.audioEqualizerModCurve, slotId),
            null,
            USER_ORIGIN,
        );
    },
    // Not saved: the host layer works it out again from the mod list at every start.
    handleSetAudioEqualizerModCurveSuspended: (suspended) => {
        const current = get();
        const next = current.audioEqualizerModCurve ? suspended : false;
        if (next === current.audioEqualizerModCurveSuspended) {
            return false;
        }
        set({ audioEqualizerModCurveSuspended: next, audioEqualizerChangeOrigin: HOST_ORIGIN });
        return true;
    },
    openAudioEqualizer: () => set({ isAudioEqualizerOpen: true }),
    closeAudioEqualizer: () => set({ isAudioEqualizerOpen: false }),
    handleSetVolume: (val) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('player_volume', String(val));
        }
        set({ volume: val });
    },
    // The toggles below delegate to these setters, so persistence and the toast live in one place
    // (Folium's playback.setMuted / setLoopMode call the setters directly).
    handleSetMuted: (muted) => {
        if (muted === get().isMuted) {
            return;
        }
        setStoredBoolean('player_is_muted', muted);
        set({ isMuted: muted });
    },
    handleToggleMute: () => {
        get().handleSetMuted(!get().isMuted);
    },
    handleSetLoopMode: (mode) => {
        if (mode === get().loopMode) {
            return;
        }
        if (typeof window !== 'undefined') {
            localStorage.setItem('player_loop_mode', mode);
        }
        set({ loopMode: mode });
        const loopModeKey = mode === 'off' ? 'loopOff' : mode === 'one' ? 'loopOne' : 'loopAll';
        setStatusMessage({
            type: 'success',
            text: i18n.t(`player.${loopModeKey}`),
            nonce: Date.now(),
        });
    },
    handleToggleLoopMode: () => {
        const prev = get().loopMode;
        const next = prev === 'off'
            ? 'all'
            : prev === 'all'
                ? 'one'
                : 'off';
        get().handleSetLoopMode(next);
    },
}));

/**
 * The AudioSettings half of the former settings snapshot, for the surfaces that
 * legitimately edit this whole domain at once. Ordinary consumers select one field instead.
 */
export const selectAudioSettingsSnapshot = (state: AudioSettingsState) => ({
    audioQuality: state.audioQuality,
    enableMediaCache: state.enableMediaCache,
    mediaCacheLimitGb: state.mediaCacheLimitGb,
    queueAddBehavior: state.queueAddBehavior,
    autoPlayOnLaunch: state.autoPlayOnLaunch,
    enableTranscodeFallback: state.enableTranscodeFallback,
    neteaseScrobbleEnabled: state.neteaseScrobbleEnabled,
    playbackFadeEnabled: state.playbackFadeEnabled,
    autoSkipUnplayable: state.autoSkipUnplayable,
    audioOutputDeviceId: state.audioOutputDeviceId,
    audioEqualizerSettings: state.audioEqualizerSettings,
    isAudioEqualizerOpen: state.isAudioEqualizerOpen,
    volume: state.volume,
    isMuted: state.isMuted,
    loopMode: state.loopMode,
    setAudioQuality: state.setAudioQuality,
    handleToggleMediaCache: state.handleToggleMediaCache,
    handleSetMediaCacheLimitGb: state.handleSetMediaCacheLimitGb,
    handleSetQueueAddBehavior: state.handleSetQueueAddBehavior,
    handleToggleAutoPlayOnLaunch: state.handleToggleAutoPlayOnLaunch,
    handleToggleTranscodeFallback: state.handleToggleTranscodeFallback,
    handleToggleNeteaseScrobble: state.handleToggleNeteaseScrobble,
    handleTogglePlaybackFade: state.handleTogglePlaybackFade,
    handleToggleAutoSkipUnplayable: state.handleToggleAutoSkipUnplayable,
    handleSetAudioOutputDeviceId: state.handleSetAudioOutputDeviceId,
    handleSetAudioEqualizerSettings: state.handleSetAudioEqualizerSettings,
    handleApplyAudioSoundPreset: state.handleApplyAudioSoundPreset,
    openAudioEqualizer: state.openAudioEqualizer,
    closeAudioEqualizer: state.closeAudioEqualizer,
    handleSetVolume: state.handleSetVolume,
    handleToggleMute: state.handleToggleMute,
    handleToggleLoopMode: state.handleToggleLoopMode,
});

// Module-level handles for the assembly layer; actions need no subscription, so importing them
// where they are used keeps App.tsx out of the chain (see setStatusMessage).
export const handleSetVolume = (val: number) => useAudioSettingsStore.getState().handleSetVolume(val);
export const handleToggleMute = () => useAudioSettingsStore.getState().handleToggleMute();
export const setAudioQuality = (quality: AudioQuality) => useAudioSettingsStore.getState().setAudioQuality(quality);
