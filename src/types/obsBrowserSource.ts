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
    MonetPortraitImage,
    PlayerState,
    SongResult,
    StageSource,
    Theme,
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
    lyricsFontScale: number;
    visualizerOpacity: number;
    subtitleOverlayOpacity: number;
    staticMode: boolean;
    hideTranslationSubtitle: boolean;
    showSubtitleTranslation?: boolean;
    seed: string | number;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    monetPortraitImage?: MonetPortraitImage | null;
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
