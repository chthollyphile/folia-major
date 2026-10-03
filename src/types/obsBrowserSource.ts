import type {
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
    MonetBackgroundTuning,
    MonetPortraitImage,
    PlayerState,
    SongResult,
    StageSource,
    SubtitleContentMode,
    Theme,
    UrlBackgroundItem,
    VisualizerBackgroundMode,
    VisualizerMode,
} from '../types';
import type { VisualizerTuningBundle } from '../components/visualizer/tuningRegistry';
import type { VisualizerBackgroundConfig } from '../components/visualizer/backgrounds/definition';

// src/types/obsBrowserSource.ts
// Shared contracts for the local OBS browser source renderer.

export interface ObsBrowserSourceStatus {
    enabled: boolean;
    port: number;
    token: string | null;
    url: string | null;
    clientCount: number;
    /**
     * True while anything is consuming the overlay server: a connected browser-source client, or
     * the Windows Spout output's offscreen client. Optional because a status from a build before
     * the Spout feature lacks it; readers treat missing as "no external consumer".
     */
    externallyConsumed?: boolean;
}

export interface ObsBrowserSourceConfig {
    activePlaybackContext: 'main' | 'stage';
    stageSource: StageSource | null;
    hasTrack: boolean;
    song: Pick<SongResult, 'id' | 'name'> | null;
    songArtist: string | null;
    songAlbum: string | null;
    coverUrl: string | null;
    lyrics: LyricData | null;
    theme: Theme;
    subtitleTheme?: Theme;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    visualizerTunings?: VisualizerTuningBundle;
    background?: VisualizerBackgroundConfig;
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    visualizerBackgroundMode?: VisualizerBackgroundMode | null;
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    backgroundOpacity?: number;
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    transparentBackground?: boolean;
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    useCoverColorBg?: boolean;
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    disableGeometricBackground?: boolean;
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    disableVignette?: boolean;
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    monetBackgroundTuning?: MonetBackgroundTuning;
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    monetBackgroundImage?: MonetBackgroundImage | null;
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    urlBackgroundList?: UrlBackgroundItem[];
    /** @deprecated Kept for OBS pages loaded before the background registry refactor. */
    urlBackgroundSelectedId?: string | null;
    lyricsFontScale: number;
    // Optional like the other late additions below: an OBS page kept open across a Folia update may
    // still be fed by (or feeding) a build that predates the field, so the renderer defaults instead
    // of rendering at scale 0. The publisher always sends it.
    subtitleFontScale?: number;
    visualizerOpacity: number;
    subtitleOverlayOpacity: number;
    subtitleOverlayBackground?: boolean;
    subtitleUpcomingLyricsBlur?: boolean;
    // Harmony (background-vocal) subtitles default to on in both the store and the overlay, so a
    // config that omits these must read as "on" rather than silently hiding a layer the main window
    // shows.
    showHarmonySubtitle?: boolean;
    harmonySubtitleBackground?: boolean;
    staticMode: boolean;
    hideTranslationSubtitle: boolean;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    seed: string | number;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    monetPortraitImage?: MonetPortraitImage | null;
    /**
     * Tempera's canvas image pool, inlined as data URLs. The overlay is served from the local
     * OBS server and is therefore a different origin from the main window, so it cannot read
     * the IndexedDB these files actually live in.
     */
    temperaLayerImageAssets?: { id: string; name: string; url: string }[];
    updatedAt: number;
}

export interface ObsBrowserSourceClock {
    currentTime: number;
    duration: number;
    playerState: PlayerState;
    sentAtMs: number;
    playbackRate: number;
    lyricOffsetMs?: number;
}

export interface ObsBrowserSourceAudio {
    audioPower: number;
    bands: {
        bass: number;
        lowMid: number;
        mid: number;
        vocal: number;
        treble: number;
    };
    spectrum: number[];
    sentAtMs: number;
}

export type ObsBrowserSourceEvent =
    | { type: 'config'; payload: ObsBrowserSourceConfig }
    | { type: 'clock'; payload: ObsBrowserSourceClock }
    | { type: 'audio'; payload: ObsBrowserSourceAudio };
