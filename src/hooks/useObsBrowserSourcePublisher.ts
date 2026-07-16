import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import type {
    AudioBands,
    CappellaAvatarImage,
    CappellaEmojiImage,
    CappellaTuning,
    CadenzaTuning,
    ClassicTuning,
    CladdaghTuning,
    DioramaTuning,
    FumeTuning,
    LyricData,
    MonetBackgroundImage,
    MonetPortraitImage,
    MonetTuning,
    PartitaTuning,
    PlaybackContext,
    PlayerState,
    SongResult,
    StageSource,
    Theme,
    TiltTuning,
    VisualizerMode,
} from '../types';
import type {
    ObsBrowserSourceAudio,
    ObsBrowserSourceClock,
    ObsBrowserSourceConfig,
    ObsBrowserSourceStatus,
} from '../types/obsBrowserSource';
import {
    buildLegacyObsBrowserSourceBackgroundConfig,
    downsampleObsSpectrum,
    isObsBrowserSourceBlobCoverUrl,
    resolveObsBrowserSourceClockTime,
    resolveObsBrowserSourceCoverUrl,
    resolveObsBrowserSourceImageAsset,
    resolveObsBrowserSourceImageAssets,
} from '../utils/obsBrowserSource';
import type { VisualizerTuningBundle } from '../components/visualizer/tuningRegistry';
import type { VisualizerBackgroundConfig } from '../components/visualizer/backgrounds/definition';

// src/hooks/useObsBrowserSourcePublisher.ts
// Publishes the single playback surface to the local OBS browser source.

const OBS_CLOCK_INTERVAL_MS = 250;
const OBS_AUDIO_INTERVAL_MS = 50;
const OBS_CLOCK_JUMP_THRESHOLD_SEC = 0.35;
const OBS_CLOCK_JUMP_MIN_INTERVAL_MS = 80;
type UseObsBrowserSourcePublisherOptions = {
    isElectronWindow: boolean;
    activePlaybackContext: PlaybackContext;
    stageSource: StageSource | null;
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    coverUrl: string | null;
    currentTime: MotionValue<number>;
    offsetMs: number;
    duration: number;
    playerState: PlayerState;
    theme: Theme;
    subtitleTheme?: Theme;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    visualizerTunings?: VisualizerTuningBundle;
    background?: VisualizerBackgroundConfig;
    lyricsFontScale: number;
    visualizerOpacity: number;
    subtitleOverlayOpacity: number;
    subtitleOverlayBackground: boolean;
    staticMode: boolean;
    hideTranslationSubtitle: boolean;
    showSubtitleTranslation: boolean;
    seed: string | number;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    monetPortraitImage?: MonetPortraitImage | null;
};

const emptyObsStatus = (): ObsBrowserSourceStatus => ({
    enabled: false,
    port: 0,
    token: null,
    url: null,
    clientCount: 0,
});

const getSongArtist = (song: SongResult | null) =>
    song?.artists?.map(artist => artist.name).join(', ')
    || song?.ar?.map(artist => artist.name).join(', ')
    || null;

const getSongAlbum = (song: SongResult | null) =>
    song?.album?.name || song?.al?.name || null;

export const useObsBrowserSourcePublisher = ({
    isElectronWindow,
    activePlaybackContext,
    stageSource,
    currentSong,
    lyrics,
    coverUrl,
    currentTime,
    offsetMs,
    duration,
    playerState,
    theme,
    subtitleTheme,
    isDaylight,
    visualizerMode,
    visualizerTunings,
    background,
    lyricsFontScale,
    visualizerOpacity,
    subtitleOverlayOpacity,
    subtitleOverlayBackground,
    staticMode,
    hideTranslationSubtitle,
    showSubtitleTranslation,
    seed,
    audioPower,
    audioBands,
    cappellaCustomEmojiImages,
    cappellaCustomAvatarImages,
    monetPortraitImage,
}: UseObsBrowserSourcePublisherOptions) => {
    const [status, setStatus] = useState<ObsBrowserSourceStatus>(() => emptyObsStatus());
    const [obsCoverUrl, setObsCoverUrl] = useState<string | null>(coverUrl);
    const [obsCustomImages, setObsCustomImages] = useState<{
        cappellaEmoji: CappellaEmojiImage[];
        cappellaAvatar: CappellaAvatarImage[];
        monetBackground: MonetBackgroundImage | null;
        monetPortrait: MonetPortraitImage | null;
    }>({ cappellaEmoji: [], cappellaAvatar: [], monetBackground: null, monetPortrait: null });
    const isExternallyRendering = status.enabled && status.clientCount > 0;
    const lastPublishedClockRef = useRef<ObsBrowserSourceClock | null>(null);
    const lastClockPublishMsRef = useRef(0);

    const refreshStatus = useCallback(async () => {
        if (!isElectronWindow || !window.electron?.getObsBrowserSourceStatus) {
            setStatus(emptyObsStatus());
            return emptyObsStatus();
        }

        const nextStatus = await window.electron.getObsBrowserSourceStatus();
        setStatus(nextStatus);
        return nextStatus;
    }, [isElectronWindow]);

    useEffect(() => {
        void refreshStatus();
        return window.electron?.onObsBrowserSourceStatusChanged?.(nextStatus => {
            setStatus(nextStatus);
        });
    }, [refreshStatus]);

    useEffect(() => {
        let cancelled = false;

        if (!isObsBrowserSourceBlobCoverUrl(coverUrl)) {
            setObsCoverUrl(coverUrl);
            return () => {
                cancelled = true;
            };
        }

        setObsCoverUrl(null);
        void resolveObsBrowserSourceCoverUrl(coverUrl).then(nextCoverUrl => {
            if (!cancelled) {
                setObsCoverUrl(nextCoverUrl);
            }
        }).catch(error => {
            console.warn('[OBS] Failed to resolve blob cover for browser source', error);
            if (!cancelled) {
                setObsCoverUrl(null);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [coverUrl]);

    useEffect(() => {
        let cancelled = false;

        void Promise.all([
            resolveObsBrowserSourceImageAssets(cappellaCustomEmojiImages),
            resolveObsBrowserSourceImageAssets(cappellaCustomAvatarImages),
            background?.customImage ? resolveObsBrowserSourceImageAsset(background.customImage) : null,
            monetPortraitImage ? resolveObsBrowserSourceImageAsset(monetPortraitImage) : null,
        ]).then(([cappellaEmoji, cappellaAvatar, monetBackground, monetPortrait]) => {
            if (!cancelled) {
                setObsCustomImages({ cappellaEmoji, cappellaAvatar, monetBackground, monetPortrait });
            }
        }).catch(error => {
            console.warn('[OBS] Failed to resolve custom images for browser source', error);
            if (!cancelled) {
                setObsCustomImages({ cappellaEmoji: [], cappellaAvatar: [], monetBackground: null, monetPortrait: null });
            }
        });

        return () => {
            cancelled = true;
        };
    }, [background?.customImage, cappellaCustomAvatarImages, cappellaCustomEmojiImages, monetPortraitImage]);

    const config = useMemo<ObsBrowserSourceConfig>(() => {
        const resolvedBackground = {
            ...background,
            customImage: obsCustomImages.monetBackground,
        };

        return {
            activePlaybackContext,
            stageSource,
            hasTrack: Boolean(currentSong || lyrics),
            song: currentSong ? { id: currentSong.id, name: currentSong.name } : null,
            songArtist: getSongArtist(currentSong),
            songAlbum: getSongAlbum(currentSong),
            coverUrl: obsCoverUrl,
            lyrics,
            theme,
            subtitleTheme,
            isDaylight,
            visualizerMode,
            visualizerTunings,
            background: resolvedBackground,
            ...buildLegacyObsBrowserSourceBackgroundConfig(resolvedBackground),
            lyricsFontScale,
            visualizerOpacity,
            subtitleOverlayOpacity,
            subtitleOverlayBackground,
            staticMode,
            hideTranslationSubtitle,
            showSubtitleTranslation,
            seed,
            cappellaCustomEmojiImages: obsCustomImages.cappellaEmoji,
            cappellaCustomAvatarImages: obsCustomImages.cappellaAvatar,
            monetPortraitImage: obsCustomImages.monetPortrait,
            updatedAt: Date.now(),
        };
    }, [
        activePlaybackContext,
        background,
        currentSong,
        hideTranslationSubtitle,
        showSubtitleTranslation,
        isDaylight,
        lyrics,
        lyricsFontScale,
        obsCustomImages,
        obsCoverUrl,
        seed,
        stageSource,
        staticMode,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        theme,
        subtitleTheme,
        visualizerMode,
        visualizerTunings,
        visualizerOpacity,
    ]);

    const buildClock = useCallback((): ObsBrowserSourceClock => ({
        currentTime: currentTime.get(),
        duration,
        playerState,
        sentAtMs: Date.now(),
        playbackRate: 1,
        lyricOffsetMs: offsetMs,
    }), [currentTime, duration, playerState, offsetMs]);

    const buildAudio = useCallback((): ObsBrowserSourceAudio => ({
        audioPower: audioPower.get(),
        bands: {
            bass: audioBands.bass.get(),
            lowMid: audioBands.lowMid.get(),
            mid: audioBands.mid.get(),
            vocal: audioBands.vocal.get(),
            treble: audioBands.treble.get(),
        },
        spectrum: downsampleObsSpectrum(audioBands.spectrum?.get()),
        sentAtMs: Date.now(),
    }), [audioBands, audioPower]);

    const publishClock = useCallback(() => {
        if (!window.electron?.publishObsBrowserSourceClock) {
            return;
        }

        const nextClock = buildClock();
        lastPublishedClockRef.current = nextClock;
        lastClockPublishMsRef.current = nextClock.sentAtMs;
        void window.electron.publishObsBrowserSourceClock(nextClock).catch(error => {
            console.warn('[OBS] Failed to publish browser source clock', error);
        });
    }, [buildClock]);

    useEffect(() => {
        if (!status.enabled || !window.electron?.publishObsBrowserSourceConfig) {
            return;
        }

        void window.electron.publishObsBrowserSourceConfig(config).catch(error => {
            console.warn('[OBS] Failed to publish browser source config', error);
        });
    }, [config, status.enabled]);

    useEffect(() => {
        if (!isExternallyRendering || !window.electron?.publishObsBrowserSourceClock) {
            return;
        }

        publishClock();
        const intervalId = window.setInterval(publishClock, OBS_CLOCK_INTERVAL_MS);
        return () => window.clearInterval(intervalId);
    }, [isExternallyRendering, publishClock]);

    useEffect(() => {
        if (!isExternallyRendering) {
            return;
        }

        // Detect seek-like jumps without turning the playback clock into per-frame IPC traffic.
        return currentTime.on('change', (nextTime) => {
            const lastClock = lastPublishedClockRef.current;
            if (!lastClock) {
                return;
            }

            const nowMs = Date.now();
            if (nowMs - lastClockPublishMsRef.current < OBS_CLOCK_JUMP_MIN_INTERVAL_MS) {
                return;
            }

            const expectedTime = resolveObsBrowserSourceClockTime(lastClock, nowMs);
            if (Math.abs(nextTime - expectedTime) >= OBS_CLOCK_JUMP_THRESHOLD_SEC) {
                publishClock();
            }
        });
    }, [currentTime, isExternallyRendering, publishClock]);

    useEffect(() => {
        if (!isExternallyRendering || !window.electron?.publishObsBrowserSourceAudio) {
            return;
        }

        const publishAudio = () => {
            void window.electron?.publishObsBrowserSourceAudio(buildAudio()).catch(error => {
                console.warn('[OBS] Failed to publish browser source audio', error);
            });
        };

        publishAudio();
        const intervalId = window.setInterval(publishAudio, OBS_AUDIO_INTERVAL_MS);
        return () => window.clearInterval(intervalId);
    }, [buildAudio, isExternallyRendering]);

    return {
        obsBrowserSourceStatus: status,
        isObsBrowserSourceRendering: isExternallyRendering,
        refreshObsBrowserSourceStatus: refreshStatus,
    };
};
