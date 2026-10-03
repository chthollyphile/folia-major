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
    SubtitleContentMode,
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
    ObsBrowserSourceConfigPublicationTracker,
    downsampleObsSpectrum,
    isObsBrowserSourceBlobCoverUrl,
    resolveObsBrowserSourceClockTime,
    resolveObsBrowserSourceCoverUrl,
    resolveObsBrowserSourceImageAsset,
    resolveObsBrowserSourceImageAssets,
} from '../utils/obsBrowserSource';
import type { TemperaLayerImage } from '../types';
import { loadTemperaLayerImageBlobs } from '../services/temperaLayerImages';
import type { VisualizerTuningBundle } from '../components/visualizer/tuningRegistry';
import type { VisualizerBackgroundConfig } from '../components/visualizer/backgrounds/definition';
import { getSongAlbumLabel, getSongArtistLabel } from '../services/onlineMusic/songMetadata';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { useVisualizerSettingsStore } from '../stores/useVisualizerSettingsStore';
import { useTypographySettingsStore } from '../stores/useTypographySettingsStore';
import { useVisualizerAssetStore } from '../stores/useVisualizerAssetStore';
import { audioBands, audioPower, currentTime } from '../stores/motionSignals';
import { useVisualizerTunings } from '../components/visualizer/useVisualizerTunings';
import { useVisualizerBackgroundConfig } from '../components/visualizer/useVisualizerBackgroundConfig';
import { usePlayerChromeSettingsStore } from '../stores/usePlayerChromeSettingsStore';

// src/hooks/useObsBrowserSourcePublisher.ts
// Publishes the single playback surface to the local OBS browser source.

const OBS_CLOCK_INTERVAL_MS = 250;
const OBS_AUDIO_INTERVAL_MS = 50;
const OBS_CLOCK_JUMP_THRESHOLD_SEC = 0.35;
const OBS_CLOCK_JUMP_MIN_INTERVAL_MS = 80;
type UseObsBrowserSourcePublisherOptions = {


    isElectronWindow: boolean;
    stageSource: StageSource | null;
    coverUrl: string | null;
    offsetMs: number;
    theme: Theme;
    subtitleTheme?: Theme;
    hideTranslationSubtitle: boolean;
    seed: string | number;
};

const emptyObsStatus = (): ObsBrowserSourceStatus => ({
    enabled: false,
    port: 0,
    token: null,
    url: null,
    clientCount: 0,
    externallyConsumed: false,
});

const getSongArtist = (song: SongResult | null) => getSongArtistLabel(song) || null;

const getSongAlbum = (song: SongResult | null) => getSongAlbumLabel(song) || null;

/**
 * Loads the Tempera pool out of IndexedDB and inlines it as data URLs. The overlay is served
 * from the local OBS server, a different origin from the main window, so it has no copy of the
 * store those files live in - the blob has to travel inside the published config.
 */
const resolveTemperaLayerAssets = async (
    pool: TemperaLayerImage[] | undefined,
): Promise<{ id: string; name: string; url: string }[]> => {
    if (!pool || pool.length === 0) return [];
    const blobs = await loadTemperaLayerImageBlobs(pool);
    const assets = await Promise.all(pool.map(async image => {
        const blob = blobs.get(image.id);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        try {
            return { id: image.id, name: image.name, url: await resolveObsBrowserSourceCoverUrl(url) ?? url };
        } finally {
            URL.revokeObjectURL(url);
        }
    }));
    return assets.filter((asset): asset is { id: string; name: string; url: string } => asset !== null);
};

export const useObsBrowserSourcePublisher = ({
    isElectronWindow,
    stageSource,
    coverUrl,
    offsetMs,
    theme,
    subtitleTheme,
    hideTranslationSubtitle,
    seed,
}: UseObsBrowserSourcePublisherOptions) => {
    const visualizerTunings = useVisualizerTunings();
    const backgroundConfig = useVisualizerBackgroundConfig();
    const transparentPlayerBackground = usePlayerChromeSettingsStore(state => state.transparentPlayerBackground);
    const enablePlayerPageNativeBlur = usePlayerChromeSettingsStore(state => state.enablePlayerPageNativeBlur);
    // The overlay is composited by OBS, so it always publishes the transparent variant when the
    // player page itself is transparent - there is no window chrome behind it to show through.
    const background = useMemo(() => ({
        ...backgroundConfig,
        transparent: transparentPlayerBackground || enablePlayerPageNativeBlur,
    }), [backgroundConfig, transparentPlayerBackground, enablePlayerPageNativeBlur]);

    // Read here rather than passed in. Every one of these is a store field or a module-level motion
    // signal, and App.tsx was naming 22 of them purely to forward them to this hook.
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const lyrics = usePlaybackStore(state => state.lyrics);
    const duration = usePlaybackStore(state => state.duration);
    const playerState = usePlaybackStore(state => state.playerState);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const staticMode = useThemeSettingsStore(state => state.staticMode);
    const visualizerMode = useVisualizerSettingsStore(state => state.visualizerMode);
    const visualizerOpacity = useVisualizerSettingsStore(state => state.visualizerOpacity);
    const lyricsFontScale = useTypographySettingsStore(state => state.lyricsFontScale);
    const subtitleFontScale = useTypographySettingsStore(state => state.subtitleFontScale);
    const subtitleOverlayOpacity = useTypographySettingsStore(state => state.subtitleOverlayOpacity);
    const subtitleOverlayBackground = useTypographySettingsStore(state => state.subtitleOverlayBackground);
    const subtitleUpcomingLyricsBlur = useTypographySettingsStore(state => state.subtitleUpcomingLyricsBlur);
    const showHarmonySubtitle = useTypographySettingsStore(state => state.showHarmonySubtitle);
    const harmonySubtitleBackground = useTypographySettingsStore(state => state.harmonySubtitleBackground);
    const showSubtitleTranslation = useTypographySettingsStore(state => state.showSubtitleTranslation);
    const subtitleContentMode = useTypographySettingsStore(state => state.subtitleContentMode);
    const cappellaCustomEmojiImages = useVisualizerAssetStore(state => state.cappellaCustomEmojiImages);
    const cappellaCustomAvatarImages = useVisualizerAssetStore(state => state.cappellaCustomAvatarImages);
    const monetPortraitImage = useVisualizerAssetStore(state => state.monetPortraitImage);

    // The pool rides in the tuning bundle that is already published; only the files are missing
    // on the overlay side, and those are resolved below.
    const temperaLayerImages = visualizerTunings?.tempera?.layerImages;
    const [status, setStatus] = useState<ObsBrowserSourceStatus>(() => emptyObsStatus());
    const [obsCoverUrl, setObsCoverUrl] = useState<string | null>(coverUrl);
    const [obsCustomImages, setObsCustomImages] = useState<{
        cappellaEmoji: CappellaEmojiImage[];
        cappellaAvatar: CappellaAvatarImage[];
        monetBackground: MonetBackgroundImage | null;
        monetPortrait: MonetPortraitImage | null;
        temperaLayer: { id: string; name: string; url: string }[];
    }>({ cappellaEmoji: [], cappellaAvatar: [], monetBackground: null, monetPortrait: null, temperaLayer: [] });
    // External rendering means someone is actually compositing the overlay right now: an SSE
    // browser-source client, or the Spout output's offscreen client. `enabled` (either the browser
    // source or Spout) only means the data should be *published*; `isExternallyRendering` also
    // drives the main window's visualizer downgrade, which must NOT trigger for a Spout output
    // running with zero browser-source clients — the heavy animation is the whole point of the
    // Spout sender, and downgrading it would degrade the stream OBS captures.
    const isExternallyRendering = status.enabled && status.clientCount > 0;
    // The Spout offscreen client consumes the same overlay page, so config must be published while
    // either output is enabled even before any SSE client connects.
    const shouldPublishOverlayData = status.enabled || Boolean(status.externallyConsumed);
    // Clock/audio stream at a high rate, so they only flow while something actually renders the
    // overlay: a connected browser source client or the Spout output (not merely "OBS enabled").
    const hasOverlayConsumer = isExternallyRendering || Boolean(status.externallyConsumed);
    const lastPublishedClockRef = useRef<ObsBrowserSourceClock | null>(null);
    const lastClockPublishMsRef = useRef(0);
    const configPublicationTrackerRef = useRef(new ObsBrowserSourceConfigPublicationTracker());

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
            // Tempera keeps its pool in IndexedDB rather than in the store, so it is read here
            // and inlined; the overlay's origin has no copy of it.
            resolveTemperaLayerAssets(temperaLayerImages),
        ]).then(([cappellaEmoji, cappellaAvatar, monetBackground, monetPortrait, temperaLayer]) => {
            if (!cancelled) {
                setObsCustomImages({ cappellaEmoji, cappellaAvatar, monetBackground, monetPortrait, temperaLayer });
            }
        }).catch(error => {
            console.warn('[OBS] Failed to resolve custom images for browser source', error);
            if (!cancelled) {
                setObsCustomImages({
                    cappellaEmoji: [], cappellaAvatar: [], monetBackground: null, monetPortrait: null, temperaLayer: [],
                });
            }
        });

        return () => {
            cancelled = true;
        };
    }, [background?.customImage, cappellaCustomAvatarImages, cappellaCustomEmojiImages, monetPortraitImage, temperaLayerImages]);

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
            subtitleFontScale,
            visualizerOpacity,
            subtitleOverlayOpacity,
            subtitleOverlayBackground,
            subtitleUpcomingLyricsBlur,
            showHarmonySubtitle,
            harmonySubtitleBackground,
            staticMode,
            hideTranslationSubtitle,
            showSubtitleTranslation,
            subtitleContentMode,
            seed,
            cappellaCustomEmojiImages: obsCustomImages.cappellaEmoji,
            cappellaCustomAvatarImages: obsCustomImages.cappellaAvatar,
            monetPortraitImage: obsCustomImages.monetPortrait,
            temperaLayerImageAssets: obsCustomImages.temperaLayer,
            updatedAt: Date.now(),
        };
    }, [
        activePlaybackContext,
        background,
        currentSong,
        hideTranslationSubtitle,
        showSubtitleTranslation,
        subtitleContentMode,
        isDaylight,
        lyrics,
        lyricsFontScale,
        subtitleFontScale,
        obsCustomImages,
        obsCoverUrl,
        seed,
        stageSource,
        staticMode,
        subtitleOverlayOpacity,
        subtitleOverlayBackground,
        subtitleUpcomingLyricsBlur,
        showHarmonySubtitle,
        harmonySubtitleBackground,
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
        const tracker = configPublicationTrackerRef.current;
        const publishConfig = window.electron?.publishObsBrowserSourceConfig;
        if (!shouldPublishOverlayData || !publishConfig) {
            tracker.reset();
            return;
        }

        const publication = tracker.prepare(true, config);
        if (!publication) {
            return;
        }

        void publishConfig(publication.config)
            .then(() => tracker.markPublished(publication.signature))
            .catch(error => {
                tracker.markFailed(publication.signature);
                console.warn('[OBS] Failed to publish browser source config', error);
            });
    }, [config, shouldPublishOverlayData]);

    useEffect(() => {
        if (!hasOverlayConsumer || !window.electron?.publishObsBrowserSourceClock) {
            return;
        }

        publishClock();
        const intervalId = window.setInterval(publishClock, OBS_CLOCK_INTERVAL_MS);
        return () => window.clearInterval(intervalId);
    }, [hasOverlayConsumer, publishClock]);

    useEffect(() => {
        if (!hasOverlayConsumer) {
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
    }, [currentTime, hasOverlayConsumer, publishClock]);

    useEffect(() => {
        if (!hasOverlayConsumer || !window.electron?.publishObsBrowserSourceAudio) {
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
    }, [buildAudio, hasOverlayConsumer]);

    return {
        obsBrowserSourceStatus: status,
        isObsBrowserSourceRendering: isExternallyRendering,
        refreshObsBrowserSourceStatus: refreshStatus,
    };
};
