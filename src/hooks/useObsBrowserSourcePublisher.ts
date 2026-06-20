import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import type {
    AudioBands,
    CappellaAvatarImage,
    CappellaEmojiImage,
    CappellaTuning,
    CadenzaTuning,
    ClassicTuning,
    FumeTuning,
    LyricData,
    MonetBackgroundImage,
    MonetBackgroundTuning,
    MonetPortraitImage,
    MonetTuning,
    PartitaTuning,
    PlaybackContext,
    PlayerState,
    SongResult,
    StageSource,
    Theme,
    TiltTuning,
    UrlBackgroundItem,
    VisualizerBackgroundMode,
    VisualizerMode,
} from '../types';
import type {
    ObsBrowserSourceAudio,
    ObsBrowserSourceClock,
    ObsBrowserSourceConfig,
    ObsBrowserSourceStatus,
} from '../types/obsBrowserSource';
import { downsampleObsSpectrum } from '../utils/obsBrowserSource';

// src/hooks/useObsBrowserSourcePublisher.ts
// Publishes the single playback surface to the local OBS browser source.

const OBS_CLOCK_INTERVAL_MS = 250;
const OBS_AUDIO_INTERVAL_MS = 100;
type UseObsBrowserSourcePublisherOptions = {
    isElectronWindow: boolean;
    activePlaybackContext: PlaybackContext;
    stageSource: StageSource | null;
    currentSong: SongResult | null;
    lyrics: LyricData | null;
    coverUrl: string | null;
    currentTime: MotionValue<number>;
    duration: number;
    playerState: PlayerState;
    theme: Theme;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    visualizerBackgroundMode: VisualizerBackgroundMode | null;
    lyricsFontScale: number;
    backgroundOpacity: number;
    visualizerOpacity: number;
    subtitleOverlayOpacity: number;
    transparentBackground: boolean;
    useCoverColorBg: boolean;
    staticMode: boolean;
    disableGeometricBackground: boolean;
    disableVignette: boolean;
    hideTranslationSubtitle: boolean;
    seed: string | number;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    classicTuning?: ClassicTuning;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    tiltTuning?: TiltTuning;
    monetBackgroundTuning?: MonetBackgroundTuning;
    monetTuning?: MonetTuning;
    monetBackgroundImage?: MonetBackgroundImage | null;
    monetPortraitImage?: MonetPortraitImage | null;
    urlBackgroundList?: UrlBackgroundItem[];
    urlBackgroundSelectedId?: string | null;
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
    duration,
    playerState,
    theme,
    isDaylight,
    visualizerMode,
    visualizerBackgroundMode,
    lyricsFontScale,
    backgroundOpacity,
    visualizerOpacity,
    subtitleOverlayOpacity,
    transparentBackground,
    useCoverColorBg,
    staticMode,
    disableGeometricBackground,
    disableVignette,
    hideTranslationSubtitle,
    seed,
    audioPower,
    audioBands,
    classicTuning,
    cadenzaTuning,
    partitaTuning,
    fumeTuning,
    cappellaTuning,
    cappellaCustomEmojiImages,
    cappellaCustomAvatarImages,
    tiltTuning,
    monetBackgroundTuning,
    monetTuning,
    monetBackgroundImage,
    monetPortraitImage,
    urlBackgroundList,
    urlBackgroundSelectedId,
}: UseObsBrowserSourcePublisherOptions) => {
    const [status, setStatus] = useState<ObsBrowserSourceStatus>(() => emptyObsStatus());
    const isExternallyRendering = status.enabled && status.clientCount > 0;

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

    const config = useMemo<ObsBrowserSourceConfig>(() => ({
        activePlaybackContext,
        stageSource,
        hasTrack: Boolean(currentSong || lyrics),
        song: currentSong ? { id: currentSong.id, name: currentSong.name } : null,
        songArtist: getSongArtist(currentSong),
        songAlbum: getSongAlbum(currentSong),
        coverUrl,
        lyrics,
        theme,
        isDaylight,
        visualizerMode,
        visualizerBackgroundMode,
        lyricsFontScale,
        backgroundOpacity,
        visualizerOpacity,
        subtitleOverlayOpacity,
        transparentBackground,
        useCoverColorBg,
        staticMode,
        disableGeometricBackground,
        disableVignette,
        hideTranslationSubtitle,
        seed,
        classicTuning,
        cadenzaTuning,
        partitaTuning,
        fumeTuning,
        cappellaTuning,
        cappellaCustomEmojiImages,
        cappellaCustomAvatarImages,
        tiltTuning,
        monetBackgroundTuning,
        monetTuning,
        monetBackgroundImage,
        monetPortraitImage,
        urlBackgroundList,
        urlBackgroundSelectedId,
        updatedAt: Date.now(),
    }), [
        activePlaybackContext,
        backgroundOpacity,
        cappellaCustomAvatarImages,
        cappellaCustomEmojiImages,
        cappellaTuning,
        cadenzaTuning,
        classicTuning,
        coverUrl,
        currentSong,
        disableGeometricBackground,
        disableVignette,
        fumeTuning,
        hideTranslationSubtitle,
        isDaylight,
        lyrics,
        lyricsFontScale,
        monetBackgroundImage,
        monetBackgroundTuning,
        monetPortraitImage,
        monetTuning,
        partitaTuning,
        seed,
        stageSource,
        staticMode,
        subtitleOverlayOpacity,
        theme,
        tiltTuning,
        transparentBackground,
        urlBackgroundList,
        urlBackgroundSelectedId,
        useCoverColorBg,
        visualizerBackgroundMode,
        visualizerMode,
        visualizerOpacity,
    ]);

    const buildClock = useCallback((): ObsBrowserSourceClock => ({
        currentTime: currentTime.get(),
        duration,
        playerState,
        sentAtMs: Date.now(),
        playbackRate: 1,
    }), [currentTime, duration, playerState]);

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

    useEffect(() => {
        if (!status.enabled || !window.electron?.publishObsBrowserSourceConfig) {
            return;
        }

        void window.electron.publishObsBrowserSourceConfig(config).catch(error => {
            console.warn('[OBS] Failed to publish browser source config', error);
        });
    }, [config, status.enabled]);

    useEffect(() => {
        if (!status.enabled || !window.electron?.publishObsBrowserSourceClock) {
            return;
        }

        const publishClock = () => {
            void window.electron?.publishObsBrowserSourceClock(buildClock()).catch(error => {
                console.warn('[OBS] Failed to publish browser source clock', error);
            });
        };

        publishClock();
        const intervalId = window.setInterval(publishClock, OBS_CLOCK_INTERVAL_MS);
        return () => window.clearInterval(intervalId);
    }, [buildClock, status.enabled]);

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
