import type {
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
    PlayerState,
    SongResult,
    StageSource,
    Theme,
    TiltTuning,
    UrlBackgroundItem,
    VisualizerBackgroundMode,
    VisualizerMode,
} from '../types';

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
    updatedAt: number;
}

export interface ObsBrowserSourceClock {
    currentTime: number;
    duration: number;
    playerState: PlayerState;
    sentAtMs: number;
    playbackRate: number;
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
