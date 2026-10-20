// src/mods/folium/contract.ts
// The public Folium contract: every type a mod can observe lives here and
// nowhere else. Host-internal types (Line, Theme, SongResult, store shapes)
// never appear in this file; the host projects them into these DTOs.
//
// Stability rule (mods/README.md): inside folium 1.x what a mod can use only
// grows. The names Folium 2 removes still work in 1.x through deprecated/ (its
// header lists them); this file holds only the names that stay, and one shape
// that goes: FoliumLegacyLyricsResult, which getLyrics may still answer.

/** The Folium version this host implements; mods read it at runtime as `folium.host.folium`. */
export const FOLIUM_VERSION = Object.freeze({ major: 1, minor: 7 });

/** `modid:name`, like a Forge ResourceLocation. The mod id part is added by the host. */
export type FoliumId = string;

/** Localized text keyed by locale (`zh-CN`, `zh-TW`, `en`, `in`); the host falls back to `en`, then to any entry. */
export type FoliumLabel = Record<string, string | undefined>;

/** Undoes a registration, subscription or mount. Safe to call more than once. */
export type FoliumDisposer = () => void;

// ---------------------------------------------------------------- DTOs
//
// FoliumLine / FoliumTheme mirror the host's Line / Theme field for field:
// same names, same meanings, so code moves between a builtin visualizer and a
// mod without translation. They are still frozen projections (dto.ts), never
// the host objects themselves. The only Folium addition is FoliumTheme.isDaylight,
// which builtin modes receive as a separate prop.

/** Ruby (furigana) over part of a syllable. Times in seconds on the lyric clock. */
export interface FoliumLyricRuby {
    /** The ruby text. */
    text: string;
    /** Start, seconds. */
    startTime: number;
    /** End, seconds. */
    endTime: number;
}

/** One timed syllable of a word. Times in seconds on the lyric clock. */
export interface FoliumLyricSyllable {
    /** The syllable text. */
    text: string;
    /** Start, seconds. */
    startTime: number;
    /** End, seconds. */
    endTime: number;
    /** A space follows this syllable. */
    endsWithSpace?: boolean;
    /** Ruby over this syllable. */
    ruby?: FoliumLyricRuby[];
    /** Marked explicit by the lyric source. */
    obscene?: boolean;
    /** Beats of silence after the syllable, from the lyric source. */
    emptyBeat?: number;
}

/** Another rendering of a line or vocal: a translation, a romanization, or another role from the lyric source. */
export interface FoliumLyricAlternateText {
    /** 'translation', 'romanization' or another role from the lyric source. */
    role: string;
    /** BCP 47 language tag, when the source gives one. */
    language?: string;
    /** The full text. */
    text: string;
    /** Timed syllables, when the source has them. */
    syllables?: FoliumLyricSyllable[];
}

/** One timed word of a line. Times in seconds on the lyric clock. */
export interface FoliumWord {
    /** The word text, including a trailing space when there is one. */
    text: string;
    /** Start, seconds. */
    startTime: number;
    /** End, seconds. */
    endTime: number;
    /** Timed syllables, when the source has them. */
    syllables?: FoliumLyricSyllable[];
}

/** A background vocal (harmony) attached to a line, timed and structured like a line. */
export interface FoliumBackgroundVocal {
    /** The full text. */
    text: string;
    /** Start, seconds. */
    startTime: number;
    /** End, seconds. */
    endTime: number;
    /** Timed words. */
    words: FoliumWord[];
    /** The singer, when the source names one. */
    agentId?: string;
    /** Translation text. */
    translation?: string;
    /** Romanization text. */
    romanization?: string;
    /** All alternate texts from the source. */
    alternateTexts?: FoliumLyricAlternateText[];
}

/** How short a line is: `micro` and `short` lines get faster transitions. */
export type FoliumLineTimingClass = 'normal' | 'short' | 'micro';
/** How the host moves a line in and out: full, fast, or no transition. */
export type FoliumLineTransitionMode = 'normal' | 'fast' | 'none';
/** How the host reveals the words of a line: full, fast, or all at once. */
export type FoliumWordRevealMode = 'normal' | 'fast' | 'instant';

/** How the host times a line on screen; builtin modes read the same values. */
export interface FoliumLineRenderHints {
    /** `endTime - startTime`, seconds. */
    rawDuration: number;
    /** How short the line is. */
    timingClass: FoliumLineTimingClass;
    /** When the host stops showing the line (endTime plus hold/tail). */
    renderEndTime: number;
    /** How the line moves in and out. */
    lineTransitionMode: FoliumLineTransitionMode;
    /** How its words are revealed. */
    wordRevealMode: FoliumWordRevealMode;
}

/**
 * One lyric line, the same fields and meanings as the host `Line` builtin visualizers receive. Times in
 * seconds on the lyric clock.
 */
export interface FoliumLine {
    /** Timed words; a line without word timing has one word spanning the line. */
    words: FoliumWord[];
    /** Start, seconds. */
    startTime: number;
    /** The lyric's own end time. When the line leaves the screen is `renderHints.renderEndTime`. */
    endTime: number;
    /** The whole line. */
    fullText: string;
    /** Always present: the host fills in hints the lyric source did not carry. */
    renderHints: FoliumLineRenderHints;
    /** Translation text. */
    translation?: string;
    /** Romanization text. */
    romanization?: string;
    /** All alternate texts from the source, with language and role. */
    alternateTexts?: FoliumLyricAlternateText[];
    /** Line id from the source, when it has one. */
    id?: string;
    /** The singer, when the source names one. */
    agentId?: string;
    /** Song part name from the source, e.g. `Chorus`. */
    songPart?: string;
    /** Index of the song part this line belongs to. */
    blockIndex?: number;
    /** The line is part of a chorus. */
    isChorus?: boolean;
    /** The chorus effect builtin modes draw for it. */
    chorusEffect?: 'bars' | 'circles' | 'beams';
    /** Background vocals. */
    backgroundVocals?: FoliumBackgroundVocal[];
    /** The user's saved word split; `join('')` equals `fullText`. See `folium.lyrics.segmentWords`. */
    wordSegments?: string[];
}

/**
 * The current theme, the same fields and meanings as the host `Theme` builtin visualizers receive, plus
 * `isDaylight`.
 */
export interface FoliumTheme {
    /** Theme name. */
    name: string;
    /** CSS color. */
    backgroundColor: string;
    /** CSS color of lyric text. */
    primaryColor: string;
    /** CSS color for highlights. */
    accentColor: string;
    /** CSS color for secondary text. */
    secondaryColor: string;
    /** The builtin font family class. */
    fontStyle: 'sans' | 'serif' | 'mono';
    /** The user's chosen family, if any. For a CSS font-family value use `folium.theme.resolveFontStack(theme)`. */
    fontFamily?: string;
    /** The user's font fallback list. */
    fontFamilyStack?: string[];
    /** For a concrete weight use `folium.theme.resolveFontWeight(theme, fallback)`. */
    fontWeight?: number;
    /** How lively animations should be; builtin modes scale motion by it. */
    animationIntensity: 'calm' | 'normal' | 'chaotic';
    /** Keyword colors; match them with `folium.lyrics.buildWordColorRanges` / `resolveWordColor`. */
    wordColors?: { word: string; color: string }[];
    /** Decorative icon names the theme suggests. */
    lyricsIcons?: string[];
    /** Where the theme came from (e.g. an AI provider). */
    provider?: string;
    /** Theme description. */
    description?: string;
    /** Folium addition: builtin modes get this as a separate `isDaylight` prop. */
    isDaylight: boolean;
}

/**
 * A song as mods see it. Pass it back to the host (playSong, enqueue, beforePlay.replaceWith) only when it
 * carries a `ref`.
 *
 * To keep data of your own per song, key it on `source` and `id` together when `id` is not null (an id is
 * unique only within its source); for a song without an id, on `title` and `artist`. `ref` is no key: it
 * is valid for one session only.
 */
export interface FoliumSong {
    /** The song id at its source, as a string; unique only within `source`; null when unknown. */
    id: string | null;
    /** Song title. */
    title: string;
    /** Artists joined with ` / `, in the order the source gives them; '' when there are none. */
    artist: string;
    /** Album name. */
    album: string | null;
    /** Where the song comes from: an Omni provider id, 'local', 'navidrome', … */
    source: string | null;
    /**
     * Opaque handle the host can turn back into the real song (playSong,
     * enqueue, beforePlay.replaceWith). Valid for the session; null when the
     * DTO was not built from a host song.
     */
    ref: string | null;
}

/** The host player state. */
export type FoliumPlaybackState = 'playing' | 'paused' | 'stopped';

/** The repeat mode. `all` repeats the queue, `one` the current song. */
export type FoliumLoopMode = 'off' | 'all' | 'one';

/** One entry of the play queue, as `folium.playback.getQueue()` lists it. */
export interface FoliumQueueItem {
    /** The song; its `ref` works with playSong, enqueue and playQueueItem. */
    readonly song: FoliumSong;
    /** Its position in the host queue; stale as soon as the queue changes (`playback.queueChanged`). */
    readonly index: number;
}

/** A page of the play queue, from `folium.playback.getQueue()`. */
export interface FoliumQueueSnapshot {
    /** The requested page, in queue order; each item carries its absolute `index`. */
    readonly items: readonly FoliumQueueItem[];
    /** Songs in the whole queue, not just this page. */
    readonly length: number;
    /**
     * Position of the displayed song in the queue; -1 when it is not in it. The host finds the current
     * song by identity, so a song listed twice counts at its first position.
     */
    readonly currentIndex: number;
    /**
     * `queue`: the play queue. `fm`: Personal FM, whose queue is the current FM batch. `stage`: external
     * Stage playback; the queue has nothing to do with what is playing, and playQueueItem refuses.
     */
    readonly kind: 'queue' | 'fm' | 'stage';
}

/** The whole playback picture, as main entries read it with `api.runtime.getPlaybackSnapshot()`. */
export interface FoliumPlaybackSnapshot {
    /** The displayed song. */
    song: FoliumSong | null;
    /** The player state. */
    state: FoliumPlaybackState;
    /** Seconds. */
    position: number;
    /** Seconds; 0 when unknown. */
    duration: number;
    /** Lyrics of the displayed song. */
    lines: FoliumLine[];
    /** The current theme. */
    theme: FoliumTheme | null;
    /** The current lyric animation mode id. */
    visualizerMode: string | null;
    /** Output volume, 0–1. */
    volume: number;
    /** The mute switch, separate from `volume`. */
    muted: boolean;
    /** The repeat mode. */
    loopMode: FoliumLoopMode;
}

/**
 * Lyric formats the host parses, the same parsers as local lyric files. These and nothing
 * else: lyrics in any other form (a platform's JSON, SRT, ASS, a custom word-timing scheme) are the mod's
 * to convert into one of them first. QRC and KRC are the decrypted plain text; the host does not decrypt.
 *
 * The format is never sniffed, and the content is not checked against it: an `lrc` track that carries
 * `<mm:ss.xx>` word tags is read as plain LRC (name it `enhanced-lrc`), and mislabelled or malformed text
 * parses to no lines or to garbled ones. `folium.lyrics.parse` runs the same pipeline, to check a conversion.
 */
export type FoliumLyricFormat = 'lrc' | 'enhanced-lrc' | 'yrc' | 'qrc' | 'krc' | 'ttml' | 'vtt' | 'awlrc';

/**
 * One lyric document in its raw text, parsed by the host's local lyric file pipeline.
 * Each text is at most 1,048,576 characters.
 */
export interface FoliumLyricsTrack {
    /** How to read `text`. */
    format: FoliumLyricFormat;
    /** The raw lyric document. */
    text: string;
    /**
     * Translation lines, matched to `text` by start time like a local `.t.lrc` file (VTT cues for a
     * `vtt` track). Ignored for `ttml`, which carries its translations inline.
     */
    translationText?: string;
    /** Romanization lines, matched like `translationText`. Ignored for `ttml`. */
    romanizationText?: string;
}

/**
 * Lyrics a provider hands the host. With both tracks the host shows `wordByWord`, and falls
 * back to `main` when it is missing or parses to no lines; a `wordByWord` track without its own
 * translation or romanization borrows the ones on `main`.
 */
export interface FoliumLyricsResult {
    /** Line-timed lyrics, also the fallback for `wordByWord`. */
    main?: FoliumLyricsTrack;
    /** Word-timed lyrics, shown in preference to `main`. */
    wordByWord?: FoliumLyricsTrack;
    /** An instrumental: the host shows its pure-music view and ignores both tracks. */
    isPureMusic?: boolean;
    /**
     * Chorus spans in seconds on the lyric clock; lines inside one get the chorus effect. Without them
     * the host detects choruses from repeated lines, and TTML `songPart` markers take precedence over both.
     * At most 64 are kept; a span needs finite times with `0 <= startTime < endTime`.
     */
    chorusRanges?: Array<{ startTime: number; endTime: number }>;
}

/**
 * The Folium 1.3 `getLyrics` answer: plain LRC, parsed as plain LRC. Deprecated in favor of
 * FoliumLyricsResult; Folium 2 drops it. A mod that answers it is told so once in its row in Settings.
 * @deprecated Answer a FoliumLyricsResult: `{ main: { format: 'lrc', text, translationText } }`.
 */
export interface FoliumLegacyLyricsResult {
    /** LRC text. */
    lrc: string;
    /** Translation LRC. */
    translationLrc?: string;
}

/** What `folium.lyrics.parse` returns. */
export interface FoliumParsedLyrics {
    /** The parsed lines; empty when the text holds none. The host's lyric display filter is not applied. */
    lines: readonly FoliumLine[];
    /** Whether the lines carry real word timings rather than timings the host estimated. */
    isWordByWord: boolean;
}

// ---------------------------------------------------------------- Parameters

/**
 * Field kinds: a slider (a number), a text box (a string), a switch (a boolean), a choice among `options`
 * (the chosen option's `value`), or a colour, shown as the app's own colour picker (a `#rrggbb` string,
 * in lower case).
 *
 * Folium 1.7: `secret`, a key or token the user types in (an API key). Settings sections only. The form shows
 * a masked input that never shows a saved value, only whether one is set, and a button to clear it. The
 * value is not one of the section's values (`settings.get()` leaves it out, `settings.set` ignores it, a
 * `defaultValue` is ignored): the host keeps it in the main process, encrypted, and the mod reads it through
 * `folium.secrets` / `api.secrets` (FoliumSecretAccess). It never enters the stored
 * settings values (`folia_folium_params_v1`), the visual config export and import, the export window or the
 * logs. Anywhere else (visualizer and background settings, tunings, command params) a `secret` field is
 * dropped like a field of an unknown type, and the mod's row says so. A Folium 1.6 host drops it in
 * settings sections too (a section left with no field then fails to register), so check
 * `folium.host.folium.minor >= 7` before declaring one.
 */
export type FoliumSettingType = 'number' | 'text' | 'boolean' | 'select' | 'color' | 'secret';

/** One choice of a `select` field. */
export interface FoliumSettingOption {
    /** The stored value. */
    value: string;
    /** What the user sees. */
    label: FoliumLabel;
}

/**
 * One declarative field. The same schema drives settings sections, visualizer
 * settings, tunings of builtin modes and command parameters, and it is the only
 * source of keys, defaults and validation for the values it describes.
 *
 * A field the host cannot use (no key, a key used twice, an unknown type, a
 * default of the wrong kind, a select without options) is dropped, and the
 * mod's row in Settings > Mods says which and why (`settings <key>`).
 *
 * Values read back are typed `unknown` (FoliumSettingValues). The host has
 * already checked each against its field, so a read can be cast once to the
 * shape the schema declares: a JSDoc `@type` cast in plain JS, or
 * `as { speed: number; tint: string }` in TypeScript.
 */
export interface FoliumSetting {
    /** Value key, unique within the schema. */
    key: string;
    /** Field kind. */
    type: FoliumSettingType;
    /** Field label. */
    label: FoliumLabel;
    /** Help text. */
    description?: FoliumLabel;
    /** Fields sharing a group label render together under that heading. */
    group?: FoliumLabel;
    /**
     * Used until the user changes the field; also what `reset` restores. Its kind must match `type`; a
     * `color` default must be `#rrggbb`. Without one: `min` or 0, false, the first option, '' or `#ffffff`.
     */
    defaultValue?: string | number | boolean;
    /** `number`: lower bound (values are clamped). */
    min?: number;
    /** `number`: upper bound (values are clamped). */
    max?: number;
    /** `number`: slider step. Default 1 when both bounds are integers, else 0.01. */
    step?: number;
    /** `text` and `secret`: placeholder. */
    placeholder?: string;
    /** `select`: the choices; values outside them are rejected. */
    options?: FoliumSettingOption[];
}

/** Values keyed by field `key`, defaults merged. Read-only; write through `FoliumSettingAccess.set`. */
export type FoliumSettingValues = Readonly<Record<string, unknown>>;

/** Read/write access to one schema's persisted values (defaults already merged). */
export interface FoliumSettingAccess {
    /** The fields, as registered (invalid declarations dropped), `secret` fields included. */
    readonly schema: readonly FoliumSetting[];
    /**
     * Current values, defaults merged. The same object until a value changes. `secret` fields are not in
     * it; read them through `folium.secrets`.
     */
    get(): FoliumSettingValues;
    /** Validated against the schema: unknown keys are dropped, numbers clamped, selects checked. */
    set(patch: Record<string, unknown>): void;
    /** Restores every default. Stored `secret` values stay; clear them with `folium.secrets.set(key, null)`. */
    reset(): void;
    /** Calls `listener` after any value changes, whoever changed it (the user, `set`, `reset`, an import). */
    onChange(listener: () => void): FoliumDisposer;
}

// ---------------------------------------------------------------- Host containers

/**
 * Everything UI-shaped is mounted into a container the host owns. The host
 * creates it (inside a ShadowRoot for panels), passes theme colors as
 * `--folium-*` CSS custom properties, and calls the disposer when it removes the
 * container. Mods never query or mutate host DOM outside their container.
 *
 * `mount` may be `async` and return a promise of its disposer. A disposer that arrives after the host
 * removed the container runs at once.
 */
export type FoliumMount<Ctx> = (container: HTMLElement, ctx: Ctx) => void | FoliumDisposer | Promise<void | FoliumDisposer>;

/** The size of a mount's container, as `onResize` reports it. */
export interface FoliumSize {
    /** Width, CSS pixels. */
    readonly width: number;
    /** Height, CSS pixels. */
    readonly height: number;
}

/**
 * Helpers every mount context carries. Each one keeps calling the function it is given until the mount
 * ends, and the host stops it then, whether or not the mod kept the disposer it returned. A mount that
 * throws, or whose promise rejects, has ended.
 *
 * A listener belongs to the mount that subscribed it: the same function given by two mounts runs once for
 * each of them.
 */
export interface FoliumMountHelpers {
    /**
     * Calls `listener` when a value this context reads through a getter changes; each context says which.
     * Read the new values through the getters inside the listener.
     */
    onChange(listener: () => void): FoliumDisposer;
    /**
     * Calls `listener` once for every frame the app draws, with the time the app's frame loop began that frame
     * (milliseconds on the `performance.now()` clock; a little later than the number the browser passes to a
     * `requestAnimationFrame` callback). It runs on the app's own frame loop, shared by every mod. A listener
     * runs at most once a frame: one subscribed while a frame runs starts with the next frame.
     */
    onFrame(listener: (timestamp: number) => void): FoliumDisposer;
    /** Calls `listener` with the container's size once it is laid out, and again whenever the size changes. */
    onResize(listener: (size: FoliumSize) => void): FoliumDisposer;
    /**
     * Calls `listener` every `ms` milliseconds. `ms` is at least 16 and at most 2147483647 (the longest a
     * browser timer can wait); for work on every frame use `onFrame`.
     */
    every(ms: number, listener: () => void): FoliumDisposer;
    /**
     * Runs `disposer` when the mount ends, after the disposer `mount` returned; at once when the mount has
     * already ended. Returns nothing.
     */
    onDispose(disposer: FoliumDisposer): void;
}

/**
 * Context for panel-like containers (player panel tabs, settings panels). `onChange` fires when the theme
 * changes (a theme switch, day and night).
 */
export interface FoliumPanelContext extends FoliumMountHelpers {
    /** The UI locale, e.g. `zh-CN`. */
    readonly locale: string;
    /** The current theme. */
    getTheme(): FoliumTheme;
}

/**
 * Context for a custom settings panel (`settingsPanel`): the panel draws the form, the schema still owns the
 * values. `onChange` fires when the theme changes; `settings.onChange` when a value does.
 */
export interface FoliumSettingsPanelContext extends FoliumPanelContext {
    /** Read and write the values the schema describes. */
    readonly settings: FoliumSettingAccess;
}

/**
 * A clock in seconds. Read it with `get` when you need the time now; to be called on every change, use the
 * context's `onLyricTime` or `onPlaybackTime`.
 */
export interface FoliumClock {
    /** Current time, seconds. */
    get(): number;
}

/** What the host draws around the content. */
export interface FoliumSurface {
    /** The host renders onto a transparent surface (OBS source, alpha export). */
    transparent: boolean;
    /** The host is painting its configured background under this content. */
    hostBackground: boolean;
}

/** Analyser band energies, each 0..1. */
export interface FoliumAudioBands {
    /** 20–150 Hz */
    readonly bass: number;
    /** 150–400 Hz */
    readonly lowMid: number;
    /** 400–1200 Hz */
    readonly mid: number;
    /** 1000–3500 Hz */
    readonly vocal: number;
    /** 3500 Hz and up */
    readonly treble: number;
}

/**
 * The host's audio analyser, for audio-reactive content. Values
 * change every frame and nothing is announced: read them inside your own frame
 * loop. Previews feed a synthetic signal; silence (or no analyser) reads as 0.
 */
export interface FoliumAudio {
    /** Overall energy (bass + low mid, shaped), 0..1. */
    getPower(): number;
    /** The same object on every call, refreshed in place; copy it to keep a reading. */
    getBands(): FoliumAudioBands;
    /** Raw analyser FFT magnitudes (0–255), or null when there are none. The host reuses the array. */
    getSpectrum(): Uint8Array | null;
}

/**
 * The host's display settings for lyric content, named and valued
 * as builtin modes receive them. A mod that turns off `hostLayers.subtitles`
 * and draws its own reads the subtitle settings here.
 */
export interface FoliumDisplay {
    /**
     * False while lyrics should not be drawn (e.g. the settings modal covers the player, or the player page
     * is not shown): a mod draws no lyric text then, as builtin modes do. Everything else may keep drawing.
     */
    showText: boolean;
    /** The user's lyric size multiplier; builtin modes scale lyric text by it. */
    lyricsFontScale: number;
    /** Subtitle size multiplier. */
    subtitleFontScale: number;
    /** Subtitle opacity, 0..1. */
    subtitleOverlayOpacity: number;
    /** Subtitles get a backing plate. */
    subtitleOverlayBackground: boolean;
    /** Upcoming-line subtitles are blurred. */
    subtitleUpcomingLyricsBlur: boolean;
    /** Background vocals are shown as subtitles. */
    showHarmonySubtitle: boolean;
    /** Harmony subtitles get a backing plate. */
    harmonySubtitleBackground: boolean;
    /** Subtitles show a translation or romanization. */
    showSubtitleTranslation: boolean;
    /** The host hides translation subtitles here (e.g. the lyrics already carry them). */
    hideTranslationSubtitle: boolean;
    /** What subtitles show. */
    subtitleContentMode: 'translation' | 'romanization' | 'none';
    /** The player controls are hidden. */
    isPlayerChromeHidden: boolean;
    /** The player panel is open. */
    isPanelOpen: boolean;
    /**
     * Lyric layer opacity, 0..1. The host already applies it to the layer a visualizer and the
     * `player.stage.*` layers draw in: do not apply it again, or the content fades twice.
     */
    visualizerOpacity: number;
}

/**
 * Context for lyric-synced content (visualizers, stage layers). Snapshot fields are fixed for one mount; the
 * host remounts only when the lyric data, the song or `staticMode` changes (or the preview line in static
 * mode). Everything else is read through getters, and `onChange` fires when the line index, pause, theme,
 * subtitle theme, cover, display, settings, surface or duration change, including while paused, when the
 * lyric clock stands still. The time itself comes through `onLyricTime`.
 */
export interface FoliumStageContext extends FoliumMountHelpers {
    /** Lyrics of this song (fixed for the mount). */
    readonly lines: readonly FoliumLine[];
    /** This song (fixed for the mount). */
    readonly song: FoliumSong | null;
    /** A still preview: draw one frame of `staticLineIndex`, do not animate. */
    readonly staticMode: boolean;
    /** Only meaningful in static mode: the line the preview shows. */
    readonly staticLineIndex: number | null;
    /**
     * The geometry seed builtin modes get (the displayed song's id,
     * or a per-mode fallback). Stable per song, identical in previews, playback
     * and export, so seeded randomness matches everywhere.
     */
    readonly seed: string | null;
    /** Rendering inside a settings preview rather than the player page. */
    readonly isPreview: boolean;
    /**
     * The lyric clock: the time lyric lines are timed in (`line.startTime`), seconds. It can differ from
     * the playback position (the user's lyric offset, Stage sources); in previews it is the preview's own
     * clock.
     */
    readonly lyricTime: FoliumClock;
    /**
     * The song's length, seconds; 0 while unknown (`onChange` fires when it becomes known). In a settings
     * preview it is the preview's length, in the export window the exported song's. Progress through the
     * song is `lyricTime.get() / getDuration()` when the duration is above 0; it can be off by the user's
     * lyric offset, since the lyric clock is not the playback position.
     */
    getDuration(): number;
    /** Index into `lines` of the active line; -1 between lines. */
    getLineIndex(): number;
    /** Playback is paused. */
    isPaused(): boolean;
    /** The current theme. */
    getTheme(): FoliumTheme;
    /** The theme the host's subtitles use; equals getTheme() where there is none. */
    getSubtitleTheme(): FoliumTheme;
    /** Cover image URL of the displayed song, or null. */
    getCoverUrl(): string | null;
    /** The host's display settings. The same object until a value changes; `onChange` announces changes. */
    getDisplay(): FoliumDisplay;
    /** This entry's settings values (defaults merged); empty without a schema. */
    getSettings(): FoliumSettingValues;
    /** What the host draws around this content. */
    getSurface(): FoliumSurface;
    /**
     * EXPERIMENTAL (`player.layout`): frozen live-player geometry in viewport CSS pixels.
     * Null without the manifest opt-in, outside the live player (including previews, OBS and export),
     * or before a subscriber's first measurement. Reading never starts measurement; `onChange` also
     * fires when the opted-in layout changes.
     */
    getLayout(): FoliumPlayerLayout | null;
    /** The host's audio analyser. */
    readonly audio: FoliumAudio;
    /**
     * Calls `listener` with the lyric clock's time (`lyricTime`) on every change. The host stops it when
     * the mount ends.
     */
    onLyricTime(listener: (seconds: number) => void): FoliumDisposer;
}

// ---------------------------------------------------------------- Registry definitions

/** A lyric animation mode. Its mode id is `mod:<modid>:<id>`. */
export interface FoliumVisualizerDef {
    /** Local id; the mode id becomes `mod:<modid>:<id>`. */
    id: string;
    /** Name in the mode picker. */
    label: FoliumLabel;
    /** Position in the mode picker; default 500 (after builtin modes). */
    order?: number;
    /** Draws the visualizer into its container. */
    mount: FoliumMount<FoliumStageContext>;
    /**
     * Settings schema; the host renders the form under the mode picker, persists the values and includes them
     * in visual config import/export.
     */
    settings?: FoliumSetting[];
    /** Replaces the host-rendered form; values still follow `settings`. */
    settingsPanel?: FoliumMount<FoliumSettingsPanelContext>;
    /** Host-rendered layers around the visualizer. Both default to true. */
    hostLayers?: { background?: boolean; subtitles?: boolean };
}

/** Extra tuning knobs for a builtin visualizer mode that declares Folium tunables. */
export interface FoliumTuningDef {
    /** Local id. */
    id: string;
    /** A builtin visualizer mode that declares `foliumTunables`, e.g. "sonnet". */
    target: string;
    /** Card title. */
    label: FoliumLabel;
    /** Number fields only; keys and ranges are checked against the target's whitelist. */
    settings: FoliumSetting[];
}

/** What a command receives when it runs. */
export interface FoliumCommandContext {
    /** Validated parameter values (defaults merged). */
    readonly values: FoliumSettingValues;
}

/**
 * A command in the mods panel and the command palette. `run` executes in the renderer; hand Node work to the
 * main entry through `folium.rpc`.
 */
export interface FoliumCommandDef {
    /** Local id. */
    id: string;
    /** Command name. */
    label: FoliumLabel;
    /** Shown under the name. */
    description?: FoliumLabel;
    /** Extra search terms for the command palette (label texts are always included). */
    keywords?: string[];
    /**
     * The command's parameters, asked for in a form before it runs (the mods panel's card, or the command
     * palette, which opens the form for a command that has any).
     */
    params?: FoliumSetting[];
    /**
     * Folium 1.7: offer this command in Settings → Global shortcuts (desktop app), listed after the host's
     * playback commands under the mod's name. The user picks the key there (the host's fixed modifiers plus
     * a letter or digit); the mod never sees or chooses one. Only for commands without `params`, since a key
     * press cannot fill a form: the host ignores the flag on a command that has any. A press runs `run` with
     * an empty `values` object and shows no result, so use `folium.ui.toast` when the press needs feedback;
     * a throw is recorded against the mod like any failed command. While the mod is stopped or disabled the
     * binding is kept but its key is not registered, and it comes back when the command is registered
     * again. Not offered on native Wayland, where the desktop's shortcut portal takes a fixed list of the
     * host's playback commands. Needs no permission: binding a key in Settings is the user's consent.
     */
    globalShortcut?: boolean;
    /** Runs the command; the result is shown as a summary (a string, `{ outputPath }` or `{ message }`). */
    run(ctx: FoliumCommandContext): unknown | Promise<unknown>;
}

/**
 * Lyric-free context for background types: they paint behind every mode, previews included. `onChange` fires
 * when pause, theme, settings or cover change.
 */
export interface FoliumBackgroundContext extends FoliumMountHelpers {
    /** A still preview: draw one frame, do not animate. */
    readonly staticMode: boolean;
    /** Playback is paused. */
    isPaused(): boolean;
    /** The current theme. */
    getTheme(): FoliumTheme;
    /** This background's settings values (defaults merged). */
    getSettings(): FoliumSettingValues;
    /** Cover image URL of the displayed song. */
    getCoverUrl(): string | null;
    /** The host's audio analyser. */
    readonly audio: FoliumAudio;
}

/** A background type in the background picker; it paints behind every mode, previews and export included. */
export interface FoliumBackgroundDef {
    /** Local id. */
    id: string;
    /** Name in the background picker. */
    label: FoliumLabel;
    /** Position in the picker; default 500. */
    order?: number;
    /** Draws the background into its container. */
    mount: FoliumMount<FoliumBackgroundContext>;
    /** Settings schema, as for visualizers. */
    settings?: FoliumSetting[];
    /** Replaces the host-rendered form; values still follow `settings`. */
    settingsPanel?: FoliumMount<FoliumSettingsPanelContext>;
}

/**
 * Where a stage layer sits on the player page:
 *   - `player.stage.back`: above the background, under the lyrics;
 *   - `player.stage.front`: above the lyrics, under the player chrome;
 *   - `app.overlay`: above the whole app.
 */
export type FoliumStageSlot = 'player.stage.back' | 'player.stage.front' | 'app.overlay';

/**
 * A layer on the live player page (never in previews, OBS sources or the export window). Needs the `stageLayers`
 * permission.
 */
export interface FoliumStageLayerDef {
    /** Local id. */
    id: string;
    /** Where the layer sits. */
    slot: FoliumStageSlot;
    /** Stacking order within the slot; default 500. */
    order?: number;
    /**
     * When false (default) the layer is click-through, so it cannot block the
     * player; elements that should still take clicks set `pointer-events: auto`.
     * When true the whole layer captures the pointer.
     */
    interactive?: boolean;
    /** Draws the layer into its container. */
    mount: FoliumMount<FoliumStageContext>;
}

/**
 * The mod's own settings, shown in the mods panel when the mod's row is expanded. Values are readable in
 * every context.
 */
export interface FoliumSettingsSectionDef {
    /** Local id. */
    id: string;
    /** Section title. */
    label: FoliumLabel;
    /** Shown under the title. */
    description?: FoliumLabel;
    /** The fields. Folium 1.7: only here may a field be a `secret`. */
    settings: FoliumSetting[];
    /** Replaces the host-rendered form; values still follow `settings`. */
    settingsPanel?: FoliumMount<FoliumSettingsPanelContext>;
}

/** A tab in the player panel. `folium.ui.openPlayerPanel(id)` opens it. */
export interface FoliumPlayerPanelTabDef {
    /** Local id; pass it to `folium.ui.openPlayerPanel`. */
    id: string;
    /** Tab title. */
    label: FoliumLabel;
    /** Tab order; default 500. */
    order?: number;
    /** Draws the tab into its container. */
    mount: FoliumMount<FoliumPanelContext>;
}

/** An owned full-page tab appended to Grid and Bravais home navigation. */
export interface FoliumHomeTabDef {
    /** Local id; pass it to `folium.ui.openHomeTab`. */
    id: string;
    /** Localized navigation label. */
    label: FoliumLabel;
    /** Order among contributed home tabs; default 500. Native tabs retain their order. */
    order?: number;
    /** Mounts in an isolated, bounded full-page container. Returns cleanup on leaving the page. */
    mount: FoliumMount<FoliumPanelContext>;
}

/**
 * Progress-bar context shared by progress buttons and progress layers. `onChange` fires when the duration or
 * the colors change (a new track, a theme switch).
 */
export interface FoliumProgressContext extends FoliumMountHelpers {
    /** The playback clock: the position in the track's audio, seconds (what `seek` takes). */
    readonly playbackTime: FoliumClock;
    /**
     * Calls `listener` with the playback clock's time (`playbackTime`) on every change. The host stops it
     * when the mount ends.
     */
    onPlaybackTime(listener: (seconds: number) => void): FoliumDisposer;
    /** Track duration, seconds; 0 when unknown. */
    getDuration(): number;
    /** 0..1 position of a time on the track (0 when the duration is unknown). */
    timeToRatio(seconds: number): number;
    /** Seeks the host player; ignored while the host bar is disabled. */
    seek(seconds: number): void;
    /** The host bar's colors, so mod UI can match it. */
    getColors(): { fill: string; track: string; text: string };
}

/** The side of the progress bar a progress button sits on. */
export type FoliumProgressButtonSlot = 'progress.leading' | 'progress.trailing';

/**
 * A button next to the progress bar. All three host progress bars (floating controls x2, Lattice) show it.
 * A click inside the button stays in it: the host stops it from reaching the bar's surroundings (the
 * floating capsule opens the player on a click), so the button need not stop propagation itself.
 */
export interface FoliumProgressButtonDef {
    /** Local id. */
    id: string;
    /** Left or right of the bar. */
    slot: FoliumProgressButtonSlot;
    /** Order within the slot; default 500. */
    order?: number;
    /**
     * Leave the collapsed floating capsule alone. The button is not
     * mounted there, only on the expanded capsule and Lattice. Default false.
     */
    hideWhenCollapsed?: boolean;
    /** Draws the button into its container. */
    mount: FoliumMount<FoliumProgressContext>;
}

/**
 * A layer over the progress track. Its container is click-through so seeking
 * keeps working; elements that should take clicks set `pointer-events: auto`.
 * As for progress buttons, the host keeps such a click inside the layer.
 */
export interface FoliumProgressLayerDef {
    /** Local id. */
    id: string;
    /** Stacking order; default 500. */
    order?: number;
    /** Draws the layer into its container, which spans the track. */
    mount: FoliumMount<FoliumProgressContext>;
}

/**
 * Mod CSS, injected inside `@layer folium-mods` and removed with the mod. The
 * stable targets are the host's public parts: `[data-folium-part="progress.track"]` etc.
 * (see mods/README.md for the list). Anything else in the host DOM is not API.
 */
export interface FoliumStyleDef {
    /** Local id. */
    id: string;
    /** The stylesheet. */
    css: string;
}

/** What `register` returns. */
export interface FoliumRegistryHandle {
    /** Full namespaced id (`modid:name`). */
    readonly id: FoliumId;
    /** Removes the entry now (the host also removes it when the mod stops). */
    unregister(): void;
}

/** What `settingsSections.register` returns: the handle plus the section's values. */
export interface FoliumSettingsSectionHandle extends FoliumRegistryHandle {
    /** The section's values (defaults merged) and write access. */
    readonly settings: FoliumSettingAccess;
}

/** Every registry has this one method. */
export interface FoliumRegistry<Def, Handle extends FoliumRegistryHandle = FoliumRegistryHandle> {
    /** Adds an entry; throws on an invalid definition or a duplicate id. */
    register(def: Def): Handle;
}

/**
 * All registries, as `folium.registries`. Some only make sense where there is app UI: they accept
 * registrations and do nothing in the export window. The table of registries in docs/folium/api.md
 * says which, and which need a permission.
 */
export interface FoliumRegistries {
    /** Lyric animation modes. */
    visualizers: FoliumRegistry<FoliumVisualizerDef>;
    /** Tuning knobs for builtin modes. */
    tunings: FoliumRegistry<FoliumTuningDef>;
    /** Commands. */
    commands: FoliumRegistry<FoliumCommandDef>;
    /** Background types. */
    backgrounds: FoliumRegistry<FoliumBackgroundDef>;
    /** Player page layers (`stageLayers`). */
    stageLayers: FoliumRegistry<FoliumStageLayerDef>;
    /** The mod's own settings. */
    settingsSections: FoliumRegistry<FoliumSettingsSectionDef, FoliumSettingsSectionHandle>;
    /** Player panel tabs. */
    playerPanelTabs: FoliumRegistry<FoliumPlayerPanelTabDef>;
    /** Full pages in home navigation. */
    homeTabs: FoliumRegistry<FoliumHomeTabDef>;
    /** Buttons beside the progress bar. */
    progressButtons: FoliumRegistry<FoliumProgressButtonDef>;
    /** Layers over the progress track. */
    progressLayers: FoliumRegistry<FoliumProgressLayerDef>;
    /** Mod CSS for public parts. */
    styles: FoliumRegistry<FoliumStyleDef>;
}

// ---------------------------------------------------------------- Events

/** Handler order for one event type; handlers of the same priority run in registration order. */
export type FoliumEventPriority = 'highest' | 'high' | 'normal' | 'low' | 'lowest';

/**
 * Why a song failed to play, coarsely. `auth`: sign-in needed or expired. `restricted`:
 * membership, purchase, entitlement, preview-only or region. `taken-down`: no longer offered. `network`:
 * network, timeout, service unavailable or rate limited. `unknown`: anything else. The host's own reason
 * codes are not API.
 */
export type FoliumPlaybackFailureReason = 'auth' | 'restricted' | 'taken-down' | 'network' | 'unknown';

/** Read-only notifications, emitted after the fact. */
export interface FoliumNotificationEvents {
    /** The displayed song changed. */
    'playback.songChanged': { readonly song: FoliumSong | null };
    /** Playing, paused or stopped. */
    'playback.stateChanged': { readonly state: FoliumPlaybackState };
    /** The user or a mod seeked; `position` in seconds. */
    'playback.seeked': { readonly position: number };
    /** Lyrics for the displayed song are ready (after `lyrics.transform`). */
    'lyrics.loaded': { readonly song: FoliumSong | null; readonly lines: readonly FoliumLine[] };
    /** The app switched views (e.g. `home`, `player`). */
    'app.viewChanged': { readonly view: string };
    /** The lyric animation mode changed. */
    'visualizer.modeChanged': { readonly mode: string };
    /** The theme or daylight mode changed. */
    'theme.changed': { readonly theme: FoliumTheme };
    /** `playback.getState().liked` changed (a like or unlike, or a new song). */
    'playback.likeChanged': { readonly liked: boolean };
    /** The volume or the mute switch changed, whoever changed it. */
    'playback.volumeChanged': { readonly volume: number; readonly muted: boolean };
    /** The repeat mode changed. */
    'playback.loopModeChanged': { readonly mode: FoliumLoopMode };
    /**
     * The queue changed, or the displayed song moved within it. Only the outline: call
     * `playback.getQueue()` for the songs. Changes made in one task arrive as one event.
     */
    'playback.queueChanged': { readonly length: number; readonly currentIndex: number };
    /**
     * A song failed to play; reported once, after the host's own retries. `phase` says
     * where it failed: `play`, the host got no playable source for the song just picked (sign-in,
     * membership, taken down, the address lookup failed, a missing local file); `restore`, the same
     * while restoring the last session; `mid-playback`, the player failed on the media itself (it
     * would not load, decode or keep streaming). Every media error is `mid-playback`, so a song
     * just picked or restored that fails before any sound is reported as `mid-playback` too.
     * `willAutoSkip`: the host is counting down to skip it (its policy or the user's "skip unplayable
     * songs" setting), so do not call `next()` yourself. Not emitted in the export window.
     */
    'playback.failed': {
        readonly song: FoliumSong | null;
        readonly reason: FoliumPlaybackFailureReason;
        readonly phase: 'play' | 'restore' | 'mid-playback';
        readonly willAutoSkip: boolean;
    };
    /**
     * Folium 1.7: someone signed in to an online source, signed out, or another account took the place of
     * the one there (`accountKey` changed); the payload is the source's new state, as
     * `folium.account.getState(providerId)` reads it. One event per source for all the changes of one
     * task; a source whose status and key end where they began fires none, and a new nickname or avatar
     * alone fires none either. A status that settles from `unknown` (the host finished asking the
     * platform, usually soon after start) fires too, for the same account as before: compare
     * `accountKey` before dropping data. Not emitted in the export window.
     */
    'account.changed': FoliumAccountState;
}

/**
 * Synchronous hook: runs when new lyrics reach the player, before they are
 * shown. Assign `lines` to rewrite them; lines left untouched (same object)
 * keep all their host-side data, new or changed ones are built from the DTO.
 *
 * It also runs when the lyric load of the current song ended with none (no
 * lyrics found, an instrumental, a failed fetch), with `lines` empty: assign
 * lines to give the song lyrics. Left empty, the song stays without lyrics, so
 * a handler that only rewrites the lines it is given changes nothing there.
 *
 * Always runs on untransformed lyrics, never on its own output: when the host
 * rebuilds lyrics already on screen (a word-segmentation update,
 * `folium.lyrics.refresh()`) it starts again from the untransformed version,
 * so handlers need not be idempotent. A rebuild can come at any time, for
 * whatever song is current then: key what you supply on `event.song`, never
 * on "the last thing I parsed".
 */
export interface FoliumLyricsTransformEvent {
    /**
     * The song the lyrics belong to: the player's current song. During an automix blend that is the track
     * the blend goes to, while the one it leaves is still the displayed song (`playback.getState().song`).
     */
    readonly song: FoliumSong | null;
    /** Assign a new array to rewrite the lyrics. Empty when the song's lyric load ended with none. */
    lines: readonly FoliumLine[];
}

/**
 * Async hook: runs before a song starts. Handlers may cancel it or play
 * another song instead. Not run for the track an automix blend advances to:
 * the blend starts that track seconds early on a fixed schedule and cannot
 * wait for handlers.
 */
export interface FoliumBeforePlayEvent {
    /** The song about to play. */
    readonly song: FoliumSong;
    /** A handler already cancelled. */
    readonly cancelled: boolean;
    /** Stops the song from playing; later handlers are skipped. */
    cancel(): void;
    /** Plays this song instead; it must carry a `ref` from the host. */
    replaceWith(song: FoliumSong): void;
}

/**
 * EXPERIMENTAL (manifest `experimental: ["omni.hooks"]`): Omni answered with
 * lyrics for an online song. Same line rules as `lyrics.transform`.
 */
export interface FoliumOmniLyricsEvent {
    /** The online song. */
    readonly song: FoliumSong;
    /** Assign a new array to rewrite the lyrics. */
    lines: readonly FoliumLine[];
    /** Omni reported the song as instrumental. */
    readonly isPureMusic: boolean;
}

/** EXPERIMENTAL (`omni.hooks`): Omni resolved an audio URL; assign `url` to use another one. */
export interface FoliumOmniAudioEvent {
    /** The online song. */
    readonly song: FoliumSong;
    /** Assign another https URL to play that instead. */
    url: string | null;
}

/** Hooks: every handler receives the same event object, in priority order, and may change it. */
export interface FoliumHookEvents {
    /** Rewrite lyrics before they are shown (sync). */
    'lyrics.transform': FoliumLyricsTransformEvent;
    /** Cancel or replace a song before it plays (async, 1.5 s per handler). */
    'playback.beforePlay': FoliumBeforePlayEvent;
    /** Rewrite lyrics Omni fetched (experimental, `omni.hooks`). */
    'omni.lyricsResolved': FoliumOmniLyricsEvent;
    /** Replace the audio URL Omni resolved (experimental, `omni.hooks`). */
    'omni.audioSourceResolved': FoliumOmniAudioEvent;
}

/** Every event type and its payload. */
export type FoliumEventMap = FoliumNotificationEvents & FoliumHookEvents;

/** The event bus, as `folium.events`. */
export interface FoliumEvents {
    /**
     * Adds a handler; returns its disposer. Each handler runs in its own error boundary; a sync handler over
     * 16 ms logs a warning. The host removes the mod's handlers when the mod stops.
     *
     * Throws `unknown-event:<type>` for a name that is not an event type (the events table in
     * docs/folium/api.md lists them), and `experimental-not-declared:<name>` for an experimental event whose
     * opt-in the mod did not declare in mod.json `experimental`.
     */
    on<K extends keyof FoliumEventMap>(
        type: K,
        handler: (event: FoliumEventMap[K]) => void | Promise<void>,
        options?: { priority?: FoliumEventPriority },
    ): FoliumDisposer;
}

// ---------------------------------------------------------------- Services

/**
 * `folium.playback`. The readers (`getState`, `getVolume`, `getLoopMode` and `getQueue`)
 * need no permission; every other method needs the `playback.control` permission. All of it is unavailable
 * in the export window.
 */
export interface FoliumPlaybackService {
    /**
     * The displayed song, player state, position and duration (seconds), `liked` (the displayed song is
     * liked; false with no song) and `canLike` (toggleLike would act now; the host's own like button
     * greys out otherwise).
     */
    getState(): {
        song: FoliumSong | null;
        state: FoliumPlaybackState;
        position: number;
        duration: number;
        liked: boolean;
        canLike: boolean;
    };
    /** Resumes playback. Needs `playback.control`. */
    play(): void;
    /** Pauses. Needs `playback.control`. */
    pause(): void;
    /** Play/pause. Needs `playback.control`. */
    toggle(): void;
    /** Seeks to a playback position (audio time), seconds. Needs `playback.control`. */
    seek(seconds: number): void;
    /**
     * Seeks to a point on the lyric clock, e.g. `line.startTime`,
     * the way clicking a lyric line does in builtin modes. The host converts
     * lyric time to playback time (lyric offsets, lyrics-only stage sources);
     * `seek(line.startTime)` would land off by the offset. Ignored while the
     * host has now-playing controls disabled. Needs `playback.control`.
     */
    seekToLyricTime(lyricSeconds: number): void;
    /** Next track. Needs `playback.control`. */
    next(): void;
    /** Previous track. Needs `playback.control`. */
    previous(): void;
    /** Plays a song by its host `ref`. Resolves false when the ref is unknown. Needs `playback.control`. */
    playSong(song: FoliumSong): Promise<boolean>;
    /** Appends a song (by `ref`) to the queue. Needs `playback.control`. */
    enqueue(song: FoliumSong): boolean;
    /**
     * Shuffles the play queue, keeping the current song first.
     * False when there is nothing to shuffle (Personal FM, a queue of one,
     * external Stage playback). Needs `playback.control`.
     */
    shuffleQueue(): boolean;
    /**
     * Likes or unlikes the displayed song, like the host's like
     * button, which also reports the result. False when `canLike` is false.
     * Needs `playback.control`.
     */
    toggleLike(): boolean;
    /** Output volume (0–1) and the mute switch, which is separate from it. */
    getVolume(): { volume: number; muted: boolean };
    /**
     * Sets the volume, clamped to 0–1, the way the host's volume slider does; `muted` stays as
     * it is. Every call is saved, so set the value you settled on rather than animating through it.
     * Needs `playback.control`.
     */
    setVolume(volume: number): void;
    /**
     * Mutes or unmutes. A set rather than a toggle, so two windows acting at once cannot cancel
     * each other out. Needs `playback.control`.
     */
    setMuted(muted: boolean): void;
    /** The repeat mode. */
    getLoopMode(): FoliumLoopMode;
    /**
     * Sets the repeat mode; the host reports the change like its own repeat button does.
     * Setting the mode already in effect does nothing. Needs `playback.control`.
     */
    setLoopMode(mode: FoliumLoopMode): void;
    /**
     * A page of the play queue. `limit` defaults to 500, the most one call returns; without
     * `offset` the page is centred on the displayed song. Song refs come from a pool of 2,000 shared with
     * every other song DTO, the least recently handed out dropped first: every ref of the page you just read
     * resolves, so read the pages you show rather than the whole queue.
     */
    getQueue(options?: { offset?: number; limit?: number }): FoliumQueueSnapshot;
    /**
     * Plays queue entry `index`, with the same playback and navigation as clicking it in the
     * host's queue panel; if it fails to play, the retry and skip buttons follow the queue as it is when
     * pressed. In Personal FM, where the panel lists no queue, it plays the entry and FM stays on. With
     * `expectedRef`, resolves false without acting when that position no longer holds that song (the queue
     * changed between your calls). False for an index out of range and during external Stage playback.
     * Needs `playback.control`.
     */
    playQueueItem(index: number, expectedRef?: string): Promise<boolean>;
}

/** A local file the user picked for this mod. */
export interface FoliumFileHandle {
    /** folia-mod:// URL usable as a media/img src for this session. */
    url: string;
    /** File name. */
    name: string;
    /** Size in bytes. */
    size: number;
    /**
     * Opaque id of a persisted grant (pickFile with `persist`, or
     * restoreFile). Store it to get the file back after a restart.
     */
    grantId?: string;
}

/** Options for `folium.ui.icon`. */
export interface FoliumIconOptions {
    /** Width and height in px. Default 24. */
    size?: number;
    /** Stroke width in the icon's 24-unit grid. Default 2. */
    strokeWidth?: number;
    /** Any CSS color. Default `currentColor`, so the icon follows the surrounding text. */
    color?: string;
}

/** `folium.ui`. Unavailable in the export window, except `icon`. */
export interface FoliumUiService {
    /** Shows a status message. */
    toast(message: string, options?: { type?: 'info' | 'success' | 'error'; durationMs?: number }): void;
    /** Opens the player panel, optionally on one of this mod's panel tabs (local id). */
    openPlayerPanel(tabId?: string): void;
    /** Opens this mod's registered home tab (local id). Rejects unknown tabs. */
    openHomeTab(tabId: string): void;
    /** Switches to the home or player view. */
    navigate(view: 'home' | 'player'): void;
    /** Opens the host volume panel (the command palette's volume command). */
    openVolume(): void;
    /**
     * Lets the user pick a local file; null when cancelled. With `persist`
     * the pick is remembered for this mod and the handle carries
     * a `grantId` for restoreFile.
     */
    pickFile(options?: { accept?: 'video' | 'audio' | 'image' | 'any'; persist?: boolean }): Promise<FoliumFileHandle | null>;
    /**
     * A file this mod picked with `persist`, as a fresh session
     * handle. Null when the grant is unknown to this mod or the file is gone.
     */
    restoreFile(grantId: string): Promise<FoliumFileHandle | null>;
    /** Forgets a persisted grant. URLs already handed out keep working this session. */
    releaseFile(grantId: string): Promise<void>;
    /**
     * Embeds an external page in `container` as a sandboxed iframe. The URL's
     * origin must be listed in the manifest `embedOrigins` (needs `net.embed`).
     */
    embed(container: HTMLElement, url: string, options?: { title?: string; allow?: string[] }): FoliumDisposer;
    /**
     * One of the host's icons as a new <svg> element the mod owns, from the icon set of
     * lucide-react 1.48, the version Folia bundles, named as on lucide.dev (e.g. "play", "skip-forward").
     * Resolves to null for a name that version does not have, including icons added in later lucide
     * releases. Works in every context, the export window included.
     */
    icon(name: string, options?: FoliumIconOptions): Promise<SVGSVGElement | null>;
}

/** Request options for `folium.net.fetch`. */
export interface FoliumFetchInit {
    /** Default `GET`. */
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
    /** Request headers. */
    headers?: Record<string, string>;
    /** Request body (text). */
    body?: string;
    /** Default 15000, at most 60000. */
    timeoutMs?: number;
}

/** A fully read response (body at most 5 MB); `text` and `json` return synchronously. */
export interface FoliumFetchResponse {
    /** Status is 2xx. */
    readonly ok: boolean;
    /** HTTP status. */
    readonly status: number;
    /** HTTP status text. */
    readonly statusText: string;
    /** Response headers, lowercase names. */
    readonly headers: Readonly<Record<string, string>>;
    /** The body as text. */
    text(): string;
    /** The body parsed as JSON; throws on invalid JSON. */
    json<T = unknown>(): T;
}

/**
 * `folium.lyrics`: the shared lyric helpers (FoliumLyricsHelpers, in both contexts), plus two members that
 * reach the displayed song's lyrics. Those two are unavailable in the export window: they throw
 * `lyrics-unavailable-in-export-context`.
 */
export interface FoliumLyricsService extends FoliumLyricsHelpers {
    /**
     * The lines on screen now; empty when there are none. For a mod that starts after `lyrics.loaded` fired:
     * read them once, then follow `lyrics.loaded`.
     */
    getLines(): readonly FoliumLine[];
    /**
     * Runs `lyrics.transform` again, now, and shows the result: on the displayed song's lyrics as they were
     * before any transform (the way the host does when it rebuilds lyrics on screen), or, when the song's
     * lyric load ended with none, on empty `lines` again. Does nothing while the song's lyrics are still
     * loading. Takes no arguments: the handlers decide. This is the way to supply lyrics that take time to
     * get, since the hook itself is synchronous: fetch or `parse` them, keep them keyed on the song, then
     * call `refresh()`. The result is the same song's lyrics rebuilt, not a new load: it is not announced as
     * `lyrics.loaded`. `getLines()` returns the new lines, and lyric mounts (visualizers, stage layers) get
     * them as a new mount.
     */
    refresh(): void;
}

/** `folium.net`. */
export interface FoliumNetService {
    /** Fetch through the host (no CORS limits); needs the `net.fetch` permission. */
    fetch(url: string, init?: FoliumFetchInit): Promise<FoliumFetchResponse>;
}

/**
 * Folium 1.7: who is signed in to one online source, as `folium.account.getState()` and the
 * `account.changed` event give it. Frozen.
 */
export interface FoliumAccountState {
    /** The source: an Omni provider id, as `FoliumSong.source` names it. */
    readonly providerId: string;
    /**
     * `signed-in`: an account is signed in. `signed-out`: nobody is, or the source has no accounts at all
     * (a mod's own source). `unknown`: the host has not found out yet, e.g. at start while it asks the
     * platform, or the platform could not be asked.
     */
    readonly status: 'signed-in' | 'signed-out' | 'unknown';
    /** What the host shows of the account: its nickname and avatar, nothing else. Null unless signed in. */
    readonly user: { readonly nickname: string; readonly avatarUrl?: string } | null;
    /**
     * An opaque key of the signed-in account, null unless signed in. The same account always has the same
     * key on this installation, across restarts; another account has another key. Key data of your own on
     * it, and drop what was kept under another key. It is no user id: it cannot be turned back into one.
     */
    readonly accountKey: string | null;
}

/**
 * Folium 1.7: `folium.account`, the sign-in state of the online sources. Needs no permission; it carries
 * no user id, cookie or token. Unavailable in the export window: `getState` throws
 * `account-unavailable-in-export-context`. An older host has no `folium.account`: check
 * `folium.host.folium.minor >= 7` first.
 */
export interface FoliumAccountService {
    /**
     * The state of one source; without `providerId`, of the source the host has selected now. Null for a
     * provider id the host does not know. Follow changes with the `account.changed` event.
     */
    getState(providerId?: string): FoliumAccountState | null;
}

// ---------------------------------------------------------------- Experimental

/** EXPERIMENTAL (`player.layout`): a rectangle in viewport CSS pixels. */
export interface FoliumLayoutRect {
    /** Left edge. */
    readonly left: number;
    /** Top edge. */
    readonly top: number;
    /** Width. */
    readonly width: number;
    /** Height. */
    readonly height: number;
}

/** EXPERIMENTAL (`player.layout`): a native control or its interactive reveal region; no internal ids. */
export interface FoliumPlayerObstacle {
    /** Coarse purpose; future hosts may add roles. */
    readonly role: 'navigation' | 'window' | 'playback' | 'now-playing' | 'panel' | 'notification' | (string & {});
    /** Hidden controls still reserve the pointer region that reveals them. */
    readonly kind: 'control' | 'reveal-area';
    /** Occupied rectangle. */
    readonly rect: FoliumLayoutRect;
}

/** EXPERIMENTAL (`player.layout`): immutable snapshot; identity is stable until geometry changes. */
export interface FoliumPlayerLayout {
    /** Live-player bounds in viewport CSS pixels. */
    readonly bounds: FoliumLayoutRect;
    /** Four safe edge distances in CSS pixels, relative to bounds. */
    readonly insets: Readonly<{ top: number; right: number; bottom: number; left: number }>;
    /** Regions to avoid; not guaranteed complete. Count, order and roles are not compatibility promises; native ids stay private. */
    readonly obstacles: readonly FoliumPlayerObstacle[];
}

/** EXPERIMENTAL (`remote.actions`). Append-only buttons; native remote controls stay unchanged. */
export interface FoliumRemoteActionDef {
    /** Local action id; the host adds the owning mod and registration prefix. */
    id: string;
    /** Localized button label and accessible name. */
    label: FoliumLabel;
    /** Lucide icon name in kebab-case. */
    icon: string;
    /** Prevents invocation while true. */
    disabled?: boolean;
    /** Toggle state exposed through aria-pressed. */
    pressed?: boolean;
    /** Optional nonnegative finite count. */
    count?: number;
    /** Host-defined visual emphasis. */
    tone?: 'normal' | 'alert';
    /** `track` (default) expires when the displayed song changes; `session` survives a song change. */
    scope?: 'track' | 'session';
    /** Runs in the main window through the host's remote bridge. */
    run(): void | Promise<void>;
}

/** EXPERIMENTAL (`remote.actions`). Current playback context for additional buttons. */
export interface FoliumRemoteActionsContext {
    /** Currently displayed song, or null when no song is displayed. */
    readonly song: FoliumSong | null;
    /** Playback state of the displayed song. */
    readonly state: FoliumPlaybackState;
}

/** EXPERIMENTAL (`remote.actions`). A group of buttons appended after native remote controls. */
export interface FoliumRemoteActionsDef {
    /** Local registration id; the host adds the owning mod prefix. */
    id: string;
    /** Order among mod groups only; native buttons cannot be reordered. */
    order?: number;
    /** Buttons for the current context. The per-mod limit is not yet finalized. */
    actions(context: FoliumRemoteActionsContext): readonly FoliumRemoteActionDef[];
}

/** EXPERIMENTAL (`remote.actions`). Owns one additional remote-button registration. */
export interface FoliumRemoteActionsHandle extends FoliumRegistryHandle {
    /** Re-evaluates actions and refreshes the remote window without changing native buttons. */
    invalidate(): void;
}

/** EXPERIMENTAL (`omni.providers`): a song as a mod provider describes it. */
export interface FoliumProviderSong {
    /** Song id within this provider. */
    id: string;
    /** Song title. */
    title: string;
    /** Artist names. */
    artists: string[];
    /** Album name. */
    album?: string;
    /** Cover image URL. */
    coverUrl?: string;
    /** Duration in milliseconds. */
    durationMs?: number;
}

/** Audio quality levels an Omni provider may be asked for. */
export type FoliumAudioQuality = 'standard' | 'high' | 'lossless' | 'hires';

/**
 * EXPERIMENTAL (`omni.providers`): an online music source. The host adapts it
 * to its provider contract; songs from it play, queue and show lyrics like any
 * online song. Use folium.net.fetch for network access.
 */
export interface FoliumOmniProviderDef {
    /** Local provider id. */
    id: string;
    /** Full name: the second line of the source's row in the home provider switcher. */
    displayName: string;
    /**
     * Short name: the switcher row, the search overlay's source chip and the home placeholder title; its
     * first character is the avatar badge. Defaults to `displayName`.
     */
    shortName?: string;
    /** Search songs; `page` is offset-based. */
    search?(query: string, page: { limit: number; offset: number }): Promise<{ items: FoliumProviderSong[]; hasMore: boolean; total?: number }>;
    /** One song by id. */
    getSong?(id: string): Promise<FoliumProviderSong | null>;
    /** A playable URL for the song at a quality. */
    getAudioUrl?(song: FoliumProviderSong, quality: FoliumAudioQuality): Promise<{ url: string; expiresAt?: number } | null>;
    /**
     * Lyrics for a song, as raw text the host parses (FoliumLyricsResult), or the deprecated Folium 1.3
     * plain-LRC shape. Null when there are none.
     */
    getLyrics?(song: FoliumProviderSong): Promise<FoliumLyricsResult | FoliumLegacyLyricsResult | null>;
}

/** Folium 1.7: a JSON value, as `platform.raw` request parameters take them. */
export type FoliumJsonValue = string | number | boolean | null | FoliumJsonValue[] | { [key: string]: FoliumJsonValue };

/** Folium 1.7: EXPERIMENTAL (`platform.raw`): the backend library the host pins for a platform. */
export interface FoliumPlatformBackend {
    /** The library's package name. */
    readonly name: string;
    /** Its version, as the host pins it; raw answers follow it. */
    readonly version: string;
}

/** Folium 1.7: EXPERIMENTAL (`platform.raw`): what `describe` says of one platform. */
export interface FoliumPlatformDescription {
    /** Whether the platform's endpoints can be called through `request`. */
    readonly supported: boolean;
    /** The pinned backend library; only when supported. */
    readonly backend?: FoliumPlatformBackend;
}

/** Folium 1.7: EXPERIMENTAL (`platform.raw`): what `request` resolves to. */
export interface FoliumPlatformResponse {
    /** The platform's own JSON answer, credential fields (cookies, tokens) taken out at any depth. */
    readonly body: unknown;
    /** The `accountKey` of the account the request was made as (`folium.account`); null when nobody is signed in. */
    readonly accountKey: string | null;
}

/**
 * Folium 1.7: EXPERIMENTAL (`platform.raw`): why a `request` failed, as the rejection's `code` (and its
 * message). `permission-denied:<permission>`: mod.json lacks `platform.<id>.read` (or, for an endpoint
 * that changes the account, `platform.<id>.write`). `endpoint-denied`: the platform's table of endpoints
 * does not open this one (sign-in, session and credential endpoints never are, and neither is any endpoint
 * the table does not list). `unsupported`: the platform has no raw endpoints in this host.
 * `not-signed-in` / `session-expired`: the endpoint needs a signed-in account and there is none, or its
 * session ran out. `vip-required`: the platform answers that only paying accounts may. `rate-limited`:
 * too many requests, from this mod (the host allows 120 a minute; past 8 at a time a request waits for
 * one of them to finish instead of failing) or as the platform says.
 * `network`: the platform could not be reached or did not answer in time. `account-changed`: the account
 * signed out or changed while the request was under way, so the answer was dropped. `aborted`: the
 * request's `signal` aborted, or the mod stopped (a request still under way then is aborted by the host).
 */
export type FoliumPlatformErrorCode =
    | `permission-denied:${string}`
    | 'endpoint-denied'
    | 'unsupported'
    | 'not-signed-in'
    | 'session-expired'
    | 'vip-required'
    | 'rate-limited'
    | 'network'
    | 'account-changed'
    | 'aborted';

/**
 * Folium 1.7: EXPERIMENTAL (manifest `experimental: ["platform.raw"]`), as
 * `folium.experimental['platform.raw']`; main window only. A fallback for what Omni does not offer yet:
 * it calls a platform's own backend endpoints as the account signed in to Folia, for capabilities only
 * that platform has (listening records, say). Where Omni offers the same, use Omni: the host says so in
 * the developer log. Answers are the platform's raw JSON and follow the backend library the host pins
 * (`describe`), so they can change with any Folia release; nothing about them is promised.
 *
 * The host never hands out the session: the request goes through Omni and the platform's adapter, which
 * add it, and credential fields are taken out of the answer. Parameters the backend reads as options of the
 * request (the session, a proxy, the source IP and the like) are set by the host alone. Platform ids are
 * Omni provider ids; only a platform `describe` supports takes `platform.<id>.*` permissions.
 */
export interface FoliumPlatformService {
    /** Whether a platform can be called through `request`, with its backend library's name and version. */
    describe(providerId: string): FoliumPlatformDescription;
    /**
     * Calls one endpoint of the platform: `endpoint` is the pinned backend's own name for it (a module
     * name such as `user_record`). `params` are the endpoint's parameters; an endpoint
     * about the signed-in user gets that user's id when `params` leaves it out, so a mod never needs it.
     * Reading endpoints need the `platform.<id>.read` permission; endpoints that change the account need
     * `platform.<id>.write` as well. Rejects with an Error whose `code` is a FoliumPlatformErrorCode, and
     * with a TypeError for malformed arguments (`params` must be a plain object of JSON values, its names
     * letters, digits and `_`, at most 16 KB as JSON; a parameter the platform's backend writes into the
     * path of its own request, such as an id, takes only the format the platform's table gives it, digits
     * for ids).
     */
    request(
        providerId: string,
        endpoint: string,
        params?: Record<string, FoliumJsonValue>,
        options?: { signal?: AbortSignal },
    ): Promise<FoliumPlatformResponse>;
}

// ---------------------------------------------------------------- Shared helpers

/** One word from `folium.lyrics.segmentWords`. */
export interface FoliumWordSegment {
    /** The segment text. */
    segment: string;
    /** UTF-16 offset of the segment in the line's `fullText`. */
    index: number;
    /** False for whitespace and punctuation-only segments. */
    isWordLike: boolean;
}

/** A keyword-colored span of a line's `fullText` (UTF-16 offsets, end exclusive). */
export interface FoliumWordColorRange {
    /** Start offset in `fullText` (UTF-16). */
    startOffset: number;
    /** End offset, exclusive. */
    endOffset: number;
    /** CSS color from `wordColors`. */
    color: string;
    /** Longer and more specific matches rank higher. */
    priority: number;
}

/**
 * The pure lyric helpers builtin modes share, so a mod lays out,
 * times and colors lines exactly as they do. Available in both contexts.
 */
export interface FoliumLyricsHelpers {
    /** When the host stops showing the line: `renderHints.renderEndTime`. -Infinity for null. */
    getLineRenderEndTime(line: FoliumLine | null | undefined): number;
    /** The user's saved split when valid, otherwise Folia's default word segmentation (icu-folia: Intl.Segmenter with jieba for Chinese and BudouX for Japanese; plain Intl.Segmenter until it has loaded). */
    segmentWords(line: Pick<FoliumLine, 'fullText' | 'wordSegments'>): FoliumWordSegment[];
    /** With no active line (index -1): the last line already over, for subtitles in gaps. */
    getRecentCompletedLine(lines: readonly FoliumLine[], lineIndex: number, time: number): FoliumLine | null;
    /** The next line: after the active one, or the first still ahead when none is active. */
    getUpcomingLine(lines: readonly FoliumLine[], lineIndex: number, time: number): FoliumLine | null;
    /** Up to `count` (default 2) lines after the active one; empty when none is active. */
    getUpcomingLines(lines: readonly FoliumLine[], lineIndex: number, count?: number): FoliumLine[];
    /** Non-overlapping keyword color spans of `fullText` for `theme.wordColors`. */
    buildWordColorRanges(fullText: string, wordColors: FoliumTheme['wordColors']): FoliumWordColorRange[];
    /** The keyword color of one word, or `fallbackColor`. */
    resolveWordColor(
        wordText: string,
        wordColors: FoliumTheme['wordColors'],
        fallbackColor: string,
        options?: { cjkMatchMode?: 'target-contains-token' | 'bidirectional-contains' | 'exact' },
    ): string;
    /**
     * Parses a lyric document with the host's local lyric file pipeline, off the main thread.
     * Rejects with a TypeError (`invalid-lyrics-track`) when the track is malformed.
     */
    parse(track: FoliumLyricsTrack): Promise<FoliumParsedLyrics>;
}

/** Theme resolution builtin modes use. Available in both contexts. */
export interface FoliumThemeHelpers {
    /** CSS font-family value for lyric text. */
    resolveFontStack(theme: Pick<FoliumTheme, 'fontStyle' | 'fontFamily' | 'fontFamilyStack'>): string;
    /** CSS font-family value for translations and subtitles. */
    resolveTranslationFontStack(theme: Pick<FoliumTheme, 'fontStyle' | 'fontFamily' | 'fontFamilyStack'>): string;
    /** The theme's weight, normalized, or `fallback`. */
    resolveFontWeight(theme: Pick<FoliumTheme, 'fontWeight'> | null | undefined, fallback: number): number;
}

// ---------------------------------------------------------------- Client API

/** Where a client runs: the main window, or the transparent video export window. */
export type FoliumContextKind = 'main' | 'export';

/**
 * The host's versions (`folium.host`), for display and logs. Every member of this contract is there from
 * Folium 1.7 on; an older 1.x host lacks some of them.
 */
export interface FoliumHostInfo {
    /** The Folium version (`major`, `minor`). */
    folium: { major: number; minor: number };
    /** Folia app version, or null when the host cannot tell. */
    folia: string | null;
}

/**
 * `folium.storage`: this mod's data file (shared with its main entry, 1 MB). Needs the `filesystem.data`
 * permission; values must be JSON-serializable.
 */
export interface FoliumStorage {
    /** The stored value, or undefined. */
    get<T = unknown>(key: string): Promise<T | undefined>;
    /** Stores a JSON-serializable value. */
    set(key: string, value: unknown): Promise<void>;
    /** Whether the key exists. */
    has(key: string): Promise<boolean>;
    /** Removes the key. */
    delete(key: string): Promise<void>;
    /** All keys. */
    keys(): Promise<string[]>;
}

/**
 * Folium 1.7: `folium.secrets` (client) and `api.secrets` (main entry), the values of this mod's `secret`
 * settings fields. One store per mod, shared by both entries and the settings form, keyed by the field's
 * `key`; a mod reaches only its own. A key that no settings section of this mod declares as `secret` is
 * refused with `secret-undeclared:<key>`. The host learns the keys when the client registers the section,
 * and on every start of Folia the main entry runs before that: until the client has registered, `get` and
 * `has` of a key with no value give null and false (a key that holds a value works as usual), and `set` of
 * a key with no value is refused with `secret-undeclared:<key>`. Reloading the mod keeps what the host
 * learned in this run. A value is a string of at most 8 KB (UTF-8); a longer one is refused with
 * `secret-too-large:8192`.
 *
 * The host keeps the values in the main process, encrypted with the system's credential store (DPAPI on
 * Windows, Keychain on macOS, libsecret or kwallet on Linux), in a file of its own beside the mod's data
 * file, and never logs them. Where the system has no such store (Linux falling back to `basic_text`), it
 * keeps them in memory only, for this run, and the settings form says so. No permission is needed.
 *
 * In the export window `get`, `has` and `set` reject with `secrets-unavailable-in-export-context`, and
 * `subscribe` never fires.
 */
export interface FoliumSecretAccess {
    /** The stored value, or null when none is set (or the credential store cannot decrypt it right now). */
    get(key: string): Promise<string | null>;
    /** Whether a value is stored, without handing it over. */
    has(key: string): Promise<boolean>;
    /** Stores `value`; null or an empty string clears it. */
    set(key: string, value: string | null): Promise<void>;
    /**
     * Calls `listener` with the key, never the value, after a value is saved or cleared, whoever did it (the
     * settings form, the client or the main entry). The host stops it when the mod stops.
     */
    subscribe(listener: (key: string) => void): FoliumDisposer;
}

/** `folium.rpc`: calls into this mod's main entry, and (Folium 1.7) hears the messages it sends. */
export interface FoliumRpc {
    /**
     * Calls the function the main entry registered with `api.rpc.handle(name, fn)`; arguments and result must
     * be JSON-serializable.
     */
    call<T = unknown>(name: string, ...args: unknown[]): Promise<T>;
    /**
     * Folium 1.7: receives the main entry's `api.rpc.send(name, payload)`. Several listeners per name are fine;
     * each gets its own copy of the payload (`null` when the main entry sent none), and one that throws is
     * logged under the mod without stopping the others. Only messages from this mod's own main entry arrive,
     * and nothing sent before the listener was added is replayed: fetch the current state once with
     * `rpc.call` after adding it. `name` must match `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`, and `listener` must be
     * a function, or this throws. The listener is removed when the mod stops. In the export window nothing
     * is ever sent: the listener is accepted and never called. Older 1.x hosts lack it: check
     * `folium.host.folium.minor >= 7`.
     */
    on(name: string, listener: (payload: unknown) => void): FoliumDisposer;
}

/** `folium.log`. `error` entries show in the mods panel under the mod. */
export interface FoliumLogger {
    /** Informational log. */
    info(message: string, details?: unknown): void;
    /** Warning. */
    warn(message: string, details?: unknown): void;
    /** Error; shown in the mods panel. */
    error(message: string, details?: unknown): void;
}

/** The object a client entry's `activate(folium)` receives. */
/**
 * The host's 10-band graph equalizer, ordered 31.5/63/125/250/500/1k/2k/4k/8k/16k Hz.
 * Gains are dB, clamped to ±12. Writes go through the settings store, so the equalizer
 * dialog shows them and they survive a restart.
 */
export interface FoliumAudioMix {
    /** The gains the host is currently using, in dB. */
    getEqualizer(): number[];
    /**
     * Applies 10 gains (dB). Missing entries keep their current value, extra entries are
     * ignored, and processing is turned on. Pass `slot` to also save the curve into a
     * custom slot (0 = the first one).
     */
    setEqualizer(gains: readonly number[], options?: { slot?: number }): void;
}

export interface FoliumClientApi {
    /** This mod's id. */
    readonly modId: string;
    /** Host versions, for display and logs. */
    readonly host: FoliumHostInfo;
    /** Where this client runs. */
    readonly env: { readonly context: FoliumContextKind };
    /** Logging. */
    readonly log: FoliumLogger;
    /** Everything a mod can add to the host. */
    readonly registries: FoliumRegistries;
    /** The event bus. */
    readonly events: FoliumEvents;
    /** Playback state and control. */
    readonly playback: FoliumPlaybackService;
    /** The graph equalizer: read and write the 10 bands (dB). */
    readonly audioMix: FoliumAudioMix;
    /** Toasts, panels, files, embeds, icons. */
    readonly ui: FoliumUiService;
    /** Network access through the host. */
    readonly net: FoliumNetService;
    /** This mod's data file. */
    readonly storage: FoliumStorage;
    /** Folium 1.7: the values of this mod's `secret` settings fields. */
    readonly secrets: FoliumSecretAccess;
    /** Calls into this mod's main entry. */
    readonly rpc: FoliumRpc;
    /** The lyric helpers builtin modes use, and the displayed song's lyrics. */
    readonly lyrics: FoliumLyricsService;
    /** The theme helpers builtin modes use. */
    readonly theme: FoliumThemeHelpers;
    /** Folium 1.7: who is signed in to the online sources. */
    readonly account: FoliumAccountService;
    /**
     * Calls `listener` every `ms` milliseconds (at least 16) until the mod stops; the host stops
     * it then.
     */
    every(ms: number, listener: () => void): FoliumDisposer;
    /**
     * Runs `disposer` when the mod stops, after the disposer `activate` returned; at once when
     * the mod has already stopped.
     */
    onDispose(disposer: FoliumDisposer): void;
    /** Unfrozen surfaces; each requires the matching manifest `experimental` opt-in. */
    readonly experimental: Readonly<Record<string, unknown>>;
}

/** The shape of a client entry module. */
export interface FoliumClientModule {
    /** `activate(folium)`; may return a disposer, which runs before the host removes the mod's registrations. */
    default: (folium: FoliumClientApi) => void | FoliumDisposer | Promise<void | FoliumDisposer>;
}
