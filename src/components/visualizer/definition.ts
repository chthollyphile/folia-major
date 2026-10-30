import React from 'react';
import type { BeatEffectDef } from '../../services/beatFx/beatEffects';
import { type MotionValue } from 'framer-motion';
import {
    type AudioBands,
    type CappellaAvatarImage,
    type CappellaEmojiImage,
    type CappellaTuning,
    type CadenzaTuning,
    type ClassicTuning,
    type CladdaghTuning,
    type DioramaTuning,
    type FumeTuning,
    type Line,
    type LumiereTuning,
    type MonetPortraitImage,
    type MonetTuning,
    type PartitaTuning,
    type PendoloTuning,
    type SonnetTuning,
    type SubtitleContentMode,
    type SubtitleOverlayLayout,
    type TemperaTuning,
    type Theme,
    type TiltTuning,
    type VisualizerMode,
} from '../../types';
import type { VisualizerTuningSettings } from './tuningDefinition';
import type { VisualizerTuningBundle } from './tuningRegistry';
import type { VisualizerBackgroundConfig } from './backgrounds/definition';

// src/components/visualizer/definition.ts
// Shared contracts for discoverable visualizer modes.

/** The command-palette line that switches to a lyric style or a background. The command list builds its id from the mode. */
export interface VisualizerModeCommand {
    title: string;
    description: string;
    keywords: string[];
}

/**
 * An automix/crossfade blend handing the picture from the song on screen to the next one. The main
 * window only, and only for a style that says it draws one (`followsSongHandoff`): everywhere else
 * the song changes when the blend has settled, as it did.
 */
export interface VisualizerSongHandoff {
    /** How far the hand-off has come, 0..1: 0 until the blend is announced. */
    progress: MotionValue<number>;
    /** The incoming song as the props will name it once the blend settles. */
    seed: string | number;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    coverUrl?: string | null;
    /** The incoming song's theme, once it has come: the props keep the song on screen's until the blend settles. */
    theme: Theme;
    subtitleTheme?: Theme;
    /** The incoming song's lyrics (none until they load), its own lyric clock and line. */
    lines: Line[];
    currentTime: MotionValue<number>;
    currentLineIndex: number;
}

export interface VisualizerSharedProps {
    currentTime: MotionValue<number>;
    /** The song's length in seconds, 0 or absent while unknown; in a preview, the preview's length. Mod styles read it (getDuration). */
    duration?: number;
    currentLineIndex: number;
    lines: Line[];
    theme: Theme;
    subtitleTheme?: Theme;
    isDaylight?: boolean;
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    showText?: boolean;
    songTitle?: string | null;
    songArtist?: string | null;
    songAlbum?: string | null;
    coverUrl?: string | null;
    /**
     * Tempera canvas images shipped inline by the OBS overlay. That page is a separate browsing
     * context with no access to the app's IndexedDB, so when this is present the visualizer uses
     * it instead of reading the pool from storage.
     */
    temperaLayerImageAssets?: { id: string; name: string; url: string }[];
    seed?: string | number;
    /** A blend handing over to the next song, while it runs (see VisualizerSongHandoff). */
    songHandoff?: VisualizerSongHandoff | null;
    staticMode?: boolean;
    backgroundStaticMode?: boolean;
    visualizerOpacity?: number;
    background?: VisualizerBackgroundConfig;
    lyricsFontScale?: number;
    subtitleFontScale?: number;
    subtitleOverlayOpacity?: number;
    subtitleOverlayBackground?: boolean;
    subtitleUpcomingLyricsBlur?: boolean;
    showHarmonySubtitle?: boolean;
    harmonySubtitleBackground?: boolean;
    isPlayerChromeHidden?: boolean;
    hideTranslationSubtitle?: boolean;
    showSubtitleTranslation?: boolean;
    subtitleContentMode?: SubtitleContentMode;
    /** The shared bottom subtitle's rows (VisualizerSubtitleOverlay); it does not read subtitleContentMode. */
    subtitleOverlayLayout?: SubtitleOverlayLayout;
    paused?: boolean;
    onBack?: () => void;
    isPanelOpen?: boolean;
    alwaysShowBackButton?: boolean;
    onPlayerPanelGuideHotspotChange?: (isActive: boolean) => void;
    onLyricLineSeek?: (lyricTimeSec: number) => void;
    isPreviewMode?: boolean;
    visualizerTunings?: VisualizerTuningBundle;
    /** A change the style on screen makes to its own tuning (a part dragged on the stage): the host saves it. A tuning.ts puts it on the prop its renderer calls. */
    onVisualizerTuningChange?: (patch: object) => void;
    classicTuning?: ClassicTuning;
    cadenzaTuning?: CadenzaTuning;
    partitaTuning?: PartitaTuning;
    fumeTuning?: FumeTuning;
    claddaghTuning?: CladdaghTuning;
    cappellaTuning?: CappellaTuning;
    cappellaCustomEmojiImages?: CappellaEmojiImage[];
    cappellaCustomAvatarImages?: CappellaAvatarImage[];
    tiltTuning?: TiltTuning;
    dioramaTuning?: DioramaTuning;
    monetTuning?: MonetTuning;
    monetPortraitImage?: MonetPortraitImage | null;
    onMonetTuningChange?: (patch: Partial<MonetTuning>) => void;
    pendoloTuning?: PendoloTuning;
    sonnetTuning?: SonnetTuning;
    temperaTuning?: TemperaTuning;
    lumiereTuning?: LumiereTuning;
}

/**
 * What a lyric style's own options panel gets from the settings window: the same for every style,
 * a mod's too. A style whose settings are not a stored tuning (a mod's style keeps its own) gets
 * no tuning and a change that does nothing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface VisualizerSettingsPanelProps<T = any> {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    controlCardBg: string;
    rangeInputClass: string;
    /** The style's tuning as the window shows it: with a slider's value while the slider is held. */
    tuning: T;
    /** A change to the tuning: shown at once, and saved at once or, while a slider is held, when it is let go. */
    onTuningChange: (patch: Partial<T>) => void;
    /** The settings store's fields of the styles and the backgrounds: for a style's own further actions (a picture uploaded for it, cleared). */
    settings: VisualizerTuningSettings;
    /** Mark slider drag start so onChange only updates draft. */
    onSliderPointerDown?: () => void;
    /** Commit draft values to persistent store on slider release. */
    onSliderCommit?: () => void;
}

/**
 * What a lyric style's quick controls in the player panel get: the saved tuning and a change that
 * is saved at once (the panel has no sliders and no draft), with the store's fields for a style's
 * further actions, as its settings panel has them.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface VisualizerQuickControlsProps<T = any> {
    t: (key: string) => string;
    isDaylight: boolean;
    theme: Theme;
    tuning: T;
    onTuningChange: (patch: Partial<T>) => void;
    settings: VisualizerTuningSettings;
    /** Closes the player panel the controls sit in: for a control that opens something on the player page itself (Machi's viewfinder bar). */
    onClosePanel?: () => void;
}

export interface VisualizerRegistryEntry {
    mode: VisualizerMode;
    order: number;
    labelKey: string;
    labelFallback: string;
    previewSeed: string;
    previewStartOffset: number;
    /*
     * The small line icon shown beside the style's name: the children of the 24x24 stroked <svg>
     * that modeGlyphs.tsx draws. A style without one (a mod's, say) gets the generic icon.
     */
    glyph?: React.ReactNode;
    /** The command that switches to this style (id `visualizer-<mode>`). A style without one has no command. */
    command?: VisualizerModeCommand;
    /** True when the renderer reads a click on a lyric line and the song should jump there. */
    seeksOnLineClick?: boolean;
    /** True when the renderer draws a blend's song hand-off (`songHandoff`); the rest are not fed one. */
    followsSongHandoff?: boolean;
    /*
     * The background this style is drawn over. VisualizerRenderer draws one background for every
     * style and keeps it through a style switch, so a style that changes it says so here, not only
     * in its own shell: false for none at all (Still), or the config to draw it with (Fume hides the
     * geometric shapes). Left out: the background in the props, as it is.
     */
    background?: false | ((props: VisualizerSharedProps) => VisualizerBackgroundConfig | undefined);
    /*
     * 各模式的 entry.tsx 把真正的 renderer 包成 React.lazy —— registry 用 eager glob 发现
     * entry，如果 entry 静态 import renderer，任何碰 visualizer 设置的模块都会连带拉进 13 个
     * renderer（183 个模块，含 three.js，而 three 只有 diorama 用）。契约不变：这里仍然是
     * props => ReactElement，lazy 组件照样满足。代价是调用方必须提供 Suspense 边界。
     */
    render: (props: VisualizerSharedProps) => React.ReactElement;
    /** The style's own options in the settings window. A style that has them and a stored tuning can be put back to its defaults there. */
    renderSettingsPanel?: (props: VisualizerSettingsPanelProps) => React.ReactNode;
    /*
     * 播放面板歌词样式那一行下面的快捷参数：开关（QuickControlToggle）和在几项里轮换的胶囊
     * （QuickControlChip），只放常调的几项，其余留给设置窗口。没有就不出这一行。
     */
    renderQuickControls?: (props: VisualizerQuickControlsProps) => React.ReactNode;
    /** For a style that sizes its own lyrics: the notice (an i18n key) the settings window shows where it switches the font size off. */
    ownFontSizeNoticeKey?: string;
    /*
     * True when this mode's layout atoms come from whole-line word segmentation
     * (utils/lyrics/wordSegmentation), so the user's saved split for a song changes what it draws.
     * Declared here rather than as a list in the panel: the panel and the command both ask the
     * registry, so adding a mode does not mean remembering to edit a hardcoded set.
     * Grapheme-level modes leave it unset — a word split would not affect them.
     */
    usesWordSegmentation?: boolean;
    /*
     * Folium tunables: the multiplier keys this mode reads through
     * useFoliumTunings(mode), with the range a mod may set and the identity
     * value (the unmodified look). Declaring a key makes its name public API —
     * mods address it by name, so renaming it is a breaking Folium change.
     * Modes without this field cannot be targeted by `registries.tunings`.
     */
    foliumTunables?: Readonly<Record<string, FoliumTunable>>;
    /*
     * The beat effects this mode draws under 智能动感模式 (services/beatFx/beatEffects.ts), each named,
     * switched and scaled on its own in the mode's settings. An effect reading 'beats' turns the
     * shared `beatImpact` / `downbeatImpact` signals (services/beatFx) into its picture - Sonnet:
     * sonnet/sonnetBeatFx.ts, Diorama: diorama/dioramaBeatRipples.ts; one reading 'drums' plays the
     * track's drum hits off htdemucs' drum stem (services/analysis/drumHits.ts; 时计:
     * pendolo/usePendoloBeatFx.ts). Each model runs for the playing track only while a live effect on
     * screen reads it (beatClockTargets.ts).
     */
    beatEffects?: readonly BeatEffectDef[];
}

export interface FoliumTunable {
    min: number;
    max: number;
    identity: number;
}

export interface VisualizerEntryModule {
    default: VisualizerRegistryEntry;
}

export const defineVisualizer = (entry: VisualizerRegistryEntry) => entry;
