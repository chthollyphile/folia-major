// mods/folium.d.ts
// 本文件由 `npm run folium:types` 从 src/mods/folium/contract.ts 和 mainContract.ts 生成，请勿手动修改。
//
// 给模组作者的编辑器提示：Folium 的全部公开类型，不引用任何别的文件。在模组的入口里用 JSDoc 指到它，
// 编辑器就有补全和每个成员的说明，不需要构建。client 入口：
//
//   /** @param {import('../folium').FoliumClientApi} folium */
//   export default function activate(folium) { ... }
//
// main 入口：
//
//   /** @param {import('../folium').FoliumMainApi} api */
//   module.exports = function activate(api) { ... };
//
// 模组不在本仓库的 mods/ 目录里时，把这个文件拷到模组文件夹的旁边（不要放进模组文件夹里面：
// 里面的每个文件都算模组的内容），路径改成拷过去的位置。这个文件只给编辑器看，宿主不读它。

/** The Folium version this host implements; mods read it at runtime as `folium.host.folium`. */
export declare const FOLIUM_VERSION: { readonly major: 1; readonly minor: 7 };

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
    /** Its position in the host queue; stale as soon as the queue's `version` changes (`playback.queueChanged`). */
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
    /**
     * Folium 1.7: the queue's version. Equal strings mean the same songs in the same order and the same
     * `kind`; it does not change when only the displayed song moves. Opaque and valid for this session:
     * pass it to `replaceQueue`, never store it. Pages read with the same version belong to the same queue.
     */
    readonly version: string;
}

/**
 * Folium 1.7: what a `playback.queueChanged` event carries. Frozen. Only the outline: read the songs with
 * `playback.getQueue()`.
 */
export interface FoliumQueueChange {
    /** Songs in the whole queue. */
    readonly length: number;
    /** Position of the displayed song in the queue (its first position); -1 when it is not in it. */
    readonly currentIndex: number;
    /**
     * Folium 1.7: the queue's version now, as `FoliumQueueSnapshot.version` gives it. The same as in the
     * event before when only the displayed song moved.
     */
    readonly version: string;
    /**
     * Folium 1.7: true only in the event the host fires for this mod's own `replaceQueue`, when nothing
     * else changed the queue in the same task; false for every other mod, for a change anyone else made
     * (the user's undo of it included), and when only the displayed song moved. A replacement made while
     * this mod was not listening is never reported as its own later.
     */
    readonly byThisMod: boolean;
}

/**
 * Folium 1.7: why `replaceQueue` left the queue as it was.
 * `stage`: external Stage playback holds the player; try again after a `playback.queueChanged` whose
 * snapshot `kind` is no longer `stage`.
 * `transition`: an automix blend is under way (a few seconds, rarely more than half a minute); try again
 * after a `playback.queueChanged`. One is also fired when the blend ends, and one that comes during the
 * blend (the arriving song landing in the queue, say) may be refused `transition` again: keep waiting.
 * `stale-version`: the queue is no longer the one `expectedVersion` names (the user, the host or a mod
 * changed it); read it again and decide anew rather than replacing blindly.
 * `stale-ref`: the song DTO at `index` has a `ref` that no longer resolves; read that song again.
 * `not-queueable`: the song at `index` cannot be in the play queue (a song of external Stage playback).
 * `rate-limited`: this mod replaced the queue a moment ago; try again after `retryAfterMs`.
 * Checked in this order: stage, transition, stale-version, then the songs from first to last (stale-ref or
 * not-queueable for the first song that fails, with its index), then rate-limited. Later minors may add
 * reasons: treat one you do not know like `transition`.
 */
export type FoliumQueueReplaceRefusal =
    | 'stage'
    | 'transition'
    | 'stale-version'
    | 'stale-ref'
    | 'not-queueable'
    | 'rate-limited';

/** Folium 1.7: `replaceQueue` replaced the queue, or found it already as asked. Frozen. */
export interface FoliumQueueReplaced {
    /** `replaced`. */
    readonly status: 'replaced';
    /** The queue's version now; the one you passed when nothing had to change. */
    readonly version: string;
    /** Songs in the queue now. */
    readonly length: number;
    /** Position of the displayed song in the new queue (its first position); -1 when it is not in it. */
    readonly currentIndex: number;
}

/** Folium 1.7: `replaceQueue` left the queue as it was. Frozen. */
export interface FoliumQueueReplaceRefused {
    /** `refused`. */
    readonly status: 'refused';
    /** Why. */
    readonly reason: FoliumQueueReplaceRefusal;
    /** The queue's version now, which this call did not change. */
    readonly version: string;
    /** For `stale-ref` and `not-queueable`, the position in `songs` of the first song refused; null otherwise. */
    readonly index: number | null;
    /** For `rate-limited`, milliseconds until this mod may replace the queue again; null otherwise. */
    readonly retryAfterMs: number | null;
}

/**
 * Folium 1.7: what `replaceQueue` resolves. `status` is `replaced` or `refused`; later minors may add
 * fields, not statuses.
 */
export type FoliumQueueReplaceResult = FoliumQueueReplaced | FoliumQueueReplaceRefused;

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

/** EXPERIMENTAL playback.backends: structurally mirrors the engine-independent host contract. */
export interface FoliumPlaybackBackendSource {
    /** Host-generated load identity; echo it in every event. */
    sourceId: string;
    /** HTTP(S) URL, only when the backend declares HTTP support. */
    url?: string;
    /** Host-staged local copy; valid until the session retires this load. */
    filePath?: string;
}

/** Requested output is not proof of the mode the device actually accepted. */
export interface FoliumPlaybackBackendStatus {
    /** The identity received by open. */
    sourceId: string;
    /** Current transport state, not the desired play intent. */
    state: 'loading' | 'playing' | 'paused' | 'stopped';
    /** Source position in seconds, without a lyric offset. */
    position: number;
    /** Source duration in seconds; zero if unknown. */
    duration: number;
    /** Device telemetry, never inferred from user settings alone. */
    output?: {
        /** The user requested exclusive access. */
        exclusiveRequested: boolean;
        /** True only after device initialization confirms exclusive access; null if unconfirmed. */
        exclusiveActive: boolean | null;
        /** Actual output sample rate in Hz. */
        sampleRate?: number;
        /** Actual device sample container; not a claim about effective DAC bits. */
        format?: string;
        /** The backend's DSP processing is active. */
        dspActive?: boolean;
    };
}

/** Events must carry the sourceId from open; late events from retired sources are ignored. */
export type FoliumPlaybackBackendEvent =
    | { type: 'status'; status: FoliumPlaybackBackendStatus }
    | { type: 'ended'; sourceId: string }
    | { type: 'error'; sourceId: string; message: string };

/** One engine session; open prepares paused audio, and dispose releases its device and listeners. */
export interface FoliumPlaybackBackendSession {
    /** Prepares a source paused; resolves only when output is ready. */
    open(source: FoliumPlaybackBackendSource): Promise<void>;
    /** Starts the prepared source. */
    play(): Promise<void>;
    /** Pauses the source; must also cancel pending play intent. */
    pause(): Promise<void>;
    /** Seeks to a nonnegative source position in seconds. */
    seek(seconds: number): Promise<void>;
    /** Sets linear host volume, including mute, in 0..1. */
    setVolume(volume: number): Promise<void>;
    /** Releases the device, source, child processes and event listeners. */
    dispose(): void | Promise<void>;
}

/** Registration alone never selects an output; users select it in playback settings. */
export interface FoliumPlaybackBackendDefinition {
    /** Local registration name; the host namespaces it with the mod id. */
    id: string;
    /** Display name in playback settings. */
    name: string;
    /** Supported host operations and whether an HTTP URL can be opened directly. */
    capabilities: { seek: boolean; volume: boolean; http: boolean };
    /** Creates one transport session; report status at a bounded rate (up to 4 Hz recommended). */
    create(report: (event: FoliumPlaybackBackendEvent) => void): FoliumPlaybackBackendSession;
}

/** EXPERIMENTAL playback.backends, main window only; requires playback.backend permission. */
export interface FoliumPlaybackBackends {
    /** Offers a backend without selecting it. Unregistering a selected backend stops playback, without fallback. */
    register(definition: FoliumPlaybackBackendDefinition): FoliumRegistryHandle;
}

/** Opt-in experimental services. A name may be absent on an older or unmodified host. */
export type FoliumExperimental = Readonly<Record<string, unknown> & {
    readonly 'playback.backends'?: FoliumPlaybackBackends;
}>;

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
    /**
     * Playback is paused, or the host holds the picture still while it plays (the background throttling
     * setting, while the window is minimised or hidden; the lyric clock and the line stand still too).
     * Either way, settle and stop animating.
     */
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
    /**
     * Playback is paused, or the host holds the picture still while it plays (the background throttling
     * setting, while the window is minimised or hidden). Either way, settle and stop animating.
     */
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
     * Folium 1.7: also fired when an automix blend ends, so a replaceQueue refused `transition` can try again.
     */
    'playback.queueChanged': FoliumQueueChange;
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
    /**
     * Folium 1.7: the equalizer changed: anything `folium.equalizer.getState()` reports (the switch, the
     * mode, the gains, `hostPlaysAudio`, `writable`). One event for all the changes of one task; its origin is
     * the last of them that was not `host`, or `host` when all of them were. Changes that end where they began
     * fire none. Not emitted in the export window.
     */
    'equalizer.changed': { readonly state: FoliumEqualizerState; readonly origin: FoliumEqualizerChangeOrigin };
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
 * need no permission; every other method needs the `playback.control` permission, except `replaceQueue`,
 * which needs `playback.queue`. All of it is unavailable in the export window.
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
    /**
     * Adds a song (by `ref`) to the queue the way the user's queue-add setting says (next or last), as the
     * host's own add does: a song already queued moves there; the song playing now, and a song its source
     * marks unavailable, are not added; the host shows its own notice. False when the ref is unknown; true
     * otherwise, also when the queue did not change. Needs `playback.control`.
     */
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
     * `offset` the page is centred on the displayed song. Song refs come from a pool of 5,000 shared with
     * every other song DTO, the least recently handed out dropped first: every ref of the page you just read
     * resolves, so read the pages you show rather than the whole queue. To read a long queue whole, page it
     * while `version` stays the same; a page with another version means the queue changed: start again.
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
    /**
     * Folium 1.7: replaces the whole play queue with `songs` (by `ref`) in one step, if the queue is still the
     * one you read: `expectedVersion` is the `version` of your last `getQueue` page or `playback.queueChanged`
     * event. Either the whole queue is replaced or nothing changes (see FoliumQueueReplaceRefusal).
     *
     * Nothing starts playing and the song playing now plays on; when it is not in `songs`, `currentIndex`
     * becomes -1 and the next track is the first of `songs`. Should that song be played again while it is
     * not in the queue (the user retries it after a failure, or the host reloads it), the host may put it
     * back at the front, which reaches you as a `playback.queueChanged` with `byThisMod` false. Songs stay
     * exactly as given, in order: a song listed twice stays twice (the host finds the current song at its
     * first position), and songs their source marks unavailable stay too (the host deals with those when it
     * comes to them, as in any queue). The user's queue-add setting plays no part. Personal FM ends, as when
     * a list is played: the queue becomes `kind: 'queue'`. An empty array empties the queue. A list with the
     * same songs in the same order, outside Personal FM, changes nothing and resolves `replaced` with the
     * same version.
     *
     * At most 5,000 songs, the size of the shared ref pool (see `getQueue`): every ref must still resolve,
     * so collect the songs just before you replace, and mirror a window around the current song rather than a
     * very long queue. A replacement is saved like the host's own edits. The host tells the user which mod
     * replaced the queue and lets them undo it until the queue changes again; an undo reaches you as a
     * `playback.queueChanged` with `byThisMod` false. Your own replacement reaches you once, with `byThisMod`
     * true, if you listen at the time.
     *
     * Rejects with a TypeError (`invalid-arguments: …`) for malformed arguments: `songs` not an array or longer
     * than 5,000, an entry that is not a song DTO from the host (no `ref`, or a DTO that is not a song's, such
     * as a `folium.omni` album), or no `expectedVersion` string. Needs `playback.queue`.
     */
    replaceQueue(songs: readonly FoliumSong[], options: { expectedVersion: string }): Promise<FoliumQueueReplaceResult>;
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

/** Folium 1.7: a song's portable identity, as `FoliumSong.source` and `FoliumSong.id` give it. */
export interface FoliumSongKey {
    /** An Omni provider id (`FoliumSong.source`). */
    readonly source: string;
    /** The song id within that source (`FoliumSong.id`), as a string. */
    readonly id: string;
}

/**
 * Folium 1.7: one online source of the host, as `folium.omni.listProviders()` lists it. Frozen.
 * More `supports` flags may come in later minors; a flag that is absent reads as false.
 */
export interface FoliumOmniProviderInfo {
    /** The Omni provider id, as `FoliumSong.source` and `FoliumAccountState.providerId` name it. */
    readonly providerId: string;
    /** Full name, as the host's source switcher shows it. */
    readonly displayName: string;
    /** Short name, as the search overlay's source chip shows it. */
    readonly shortName: string;
    /** `host`: built into Folia. `mod`: registered by a mod (`omni.providers`); gone while that mod is off. */
    readonly origin: 'host' | 'mod';
    /** Whether this is the source the host has selected now (what `searchSongs` uses without `providerId`). */
    readonly selected: boolean;
    /** False when the source is not set up in this host. True does not promise that a request succeeds. */
    readonly configured: boolean;
    /** What of `folium.omni` this source answers; a method on a source without its flag rejects `unsupported`. */
    readonly supports: {
        /** `searchSongs` can search it. */
        readonly search: boolean;
        /** `resolveSongs` can look its songs up by id. */
        readonly resolve: boolean;
        /** `getLyrics` can read its songs' lyrics. */
        readonly lyrics: boolean;
        /** `getAlbum`, and albums in `resolveCollection` / `getTracks`. */
        readonly albums: boolean;
        /** `getArtists`, and artists in `resolveCollection` / `getTracks` / `getArtistAlbums`. */
        readonly artists: boolean;
    };
}

/**
 * Folium 1.7: one page of a list `folium.omni` reads. Frozen. Ask for the next page with `nextCursor`;
 * sources page differently, so there is no offset to compute.
 */
export interface FoliumOmniPage<T> {
    /** The page, in the source's order; never more items than the `limit` asked for. */
    readonly items: readonly T[];
    /**
     * Pass it as `cursor` for the next page of the same list; null when the source has no more. Opaque, valid
     * for this session only, and a cursor not used for a while stops resolving (`stale-ref`): start again
     * without one. An album or an artist is the same list by its `source`, `kind` and `id`, whichever DTO of
     * it comes with the cursor (one read again by its key, say).
     */
    readonly nextCursor: string | null;
    /** The whole list's length when the source says it; null otherwise. */
    readonly total: number | null;
}

/**
 * Folium 1.7: what `resolveSongs` found for one key, in the order of the keys.
 * `found`: the song, with a `ref` for playSong and enqueue.
 * `not-found`: the source answered and has no such song.
 * `unsupported`: this host cannot look it up now: no source by that id (a mod's source while that mod is
 * off, a source of another Folia build), a source that is not online (`local`, `navidrome`, `stage`), or one
 * that cannot look songs up by id. This may change as sources come and go: keep the key.
 * `failed`: the lookup did not get an answer; `code` says why (never `unsupported`), and a later try may work.
 * Later minors may add statuses: treat one you do not know as `failed`.
 */
export type FoliumSongResolution =
    | { readonly status: 'found'; readonly song: FoliumSong }
    | { readonly status: 'not-found' }
    | { readonly status: 'unsupported' }
    | { readonly status: 'failed'; readonly code: FoliumOmniErrorCode };

/** Folium 1.7: what `describeSong` knows of an online song without asking its source. Frozen. */
export interface FoliumSongDetails {
    /** Duration in milliseconds; null when the source did not give it. */
    readonly durationMs: number | null;
    /** Cover image URL; null when there is none. */
    readonly coverUrl: string | null;
    /**
     * `playable`: the source marks nothing against it. `taken-down`: the source took it down. `restricted`:
     * the source marks it as limited (paying accounts, regions); whether it plays is found out when it is
     * played. `unknown`: the source says nothing either way. It is what the source told the account signed
     * in to it, so it may change with that account. Later minors may add values: treat one you do not know
     * as `unknown`.
     */
    readonly availability: 'playable' | 'taken-down' | 'restricted' | 'unknown';
    /** The song's public web page at its source; null when the source has none. */
    readonly pageUrl: string | null;
}

/**
 * Folium 1.7: an online song's lyrics, as `folium.omni.getLyrics` reads them. Frozen. `lines` and
 * `isWordByWord` mean what they mean for `folium.lyrics.parse`; a line's `isChorus` is the source's marking
 * or the host's detection from repeated lines.
 */
export interface FoliumOmniLyrics extends FoliumParsedLyrics {
    /** The source marks the song as instrumental. */
    readonly isPureMusic: boolean;
}

/** Folium 1.7: a portable key of an album or an artist, as `FoliumCollection` carries it. */
export interface FoliumCollectionKey {
    /** An Omni provider id (`FoliumCollection.source`). */
    readonly source: string;
    /** `album` or `artist`. */
    readonly kind: 'album' | 'artist';
    /** The id within that source and kind (`FoliumCollection.id`). */
    readonly id: string;
}

/**
 * Folium 1.7: an album or an artist at an online source. Frozen. Key data of your own on `source`, `kind`
 * and `id` together; `ref` is valid for this session only. Later minors may add kinds: treat a kind you do
 * not know as one you cannot read.
 */
export interface FoliumCollection {
    /** `album` or `artist`. */
    readonly kind: 'album' | 'artist';
    /** The Omni provider id. */
    readonly source: string;
    /** The id within the source and kind; `resolveCollection` takes it back. */
    readonly id: string;
    /** Its name. */
    readonly name: string;
    /** For an album, its artists joined with ` / `; '' for an artist or when unknown. */
    readonly artist: string;
    /** Cover or portrait URL; null when there is none. */
    readonly coverUrl: string | null;
    /** The source's description; null when it gives none. */
    readonly description: string | null;
    /** Songs on an album; null when unknown (a summary from a song or a list carries less). */
    readonly trackCount: number | null;
    /** An artist's albums; null when unknown. */
    readonly albumCount: number | null;
    /** An album's release time, milliseconds since the epoch; null when unknown. */
    readonly publishedAt: number | null;
    /** Opaque handle for getTracks / getArtistAlbums; valid for the session. */
    readonly ref: string;
}

/**
 * Folium 1.7: why a `folium.omni` call failed, as the rejection's `code` (and its message), or as a
 * `failed` resolution's `code`.
 * `unsupported`: the source does not answer this (its `supports` flag is false), or there is no such source.
 * `unavailable`: the source cannot take requests now (not set up, its service not running, or it refused).
 * `region-restricted`: the source does not answer from this region.
 * `not-signed-in` / `session-expired`: the source needs a signed-in account for this.
 * `vip-required`: only paying accounts may.
 * `rate-limited`: too many requests (see FoliumOmniService), or the source says so.
 * `network`: no answer in time, or a failure the source did not explain.
 * `account-changed`: the selected source or its account changed while the call was under way, so the
 * answer was dropped.
 * `stale-ref`: the DTO's `ref`, or the `cursor`, no longer resolves; read it again.
 * `aborted`: the call's `signal` aborted, or the mod stopped.
 * Later minors may add codes: treat one you do not know as `network`.
 */
export type FoliumOmniErrorCode =
    | 'unsupported'
    | 'unavailable'
    | 'region-restricted'
    | 'not-signed-in'
    | 'session-expired'
    | 'vip-required'
    | 'rate-limited'
    | 'network'
    | 'account-changed'
    | 'stale-ref'
    | 'aborted';

/**
 * Folium 1.7: `folium.omni`, the host's online music sources (Omni), read only: search, songs by id,
 * lyrics, albums and artists. Needs no permission. Requests are made as the account signed in to that
 * source in Folia. Songs come with a `ref`, so `folium.playback.playSong` and `enqueue` take them as they
 * are. Nothing here reads the signed-in account's own library, hands out audio URLs or changes anything at
 * a source.
 *
 * A song's `ref` is not its identity: the same song read twice (from the queue and from `resolveSongs`, say)
 * may come with different refs. Compare `source` and `id`.
 *
 * Each time the host has to ask a source for you counts once against this mod's allowance, shared with
 * `platform.raw`: currently 120 a minute (past it a call rejects `rate-limited`) and 8 at a time (past it a
 * call waits its turn). Looking up many songs may ask more than once; the host may answer from what it read
 * recently. The host may also limit requests per source across all mods, which rejects `rate-limited` too.
 * Requests to a source a mod provides (origin `mod`) count against the minute but never wait. A call that
 * gets no answer in a while rejects `network`. `aborted` (the call's `signal`, or the mod stopping) only
 * drops the answer: the request at the source may still run, and counts as under way until it ends.
 *
 * Main window only: in the export window the synchronous methods throw, and the others reject, an Error
 * whose message is `omni-unavailable-in-export-context` (it has no `code`). The main entry has no `omni`; ask
 * the client over `rpc`. An older host has no `folium.omni`: check `folium.host.folium.minor >= 7` first.
 * Async methods reject with an Error whose `code` is a FoliumOmniErrorCode, and with a TypeError
 * (`invalid-arguments: …`, no `code`) for malformed arguments, a song DTO without a `ref` included.
 */
export interface FoliumOmniService {
    /** The host's online sources, in the host's order. Synchronous; asks no source. */
    listProviders(): readonly FoliumOmniProviderInfo[];
    /**
     * Searches songs at `providerId`, or at the source the host has selected now. `query` is 1–200
     * characters after trimming. Without `cursor` it reads the first page; `limit` (default 30, at most 50)
     * is read only then, and later pages keep it. Song refs come from the host's shared pool (see
     * `playback.getQueue`): read the pages you show.
     */
    searchSongs(
        query: string,
        options?: { providerId?: string; cursor?: string; limit?: number; signal?: AbortSignal },
    ): Promise<FoliumOmniPage<FoliumSong>>;
    /**
     * Looks songs up by their portable identity (`FoliumSong.source` + `FoliumSong.id`), 1–50 keys a call;
     * resolves one FoliumSongResolution per key, in order. A key that fails does not fail the call; the
     * call rejects only for malformed arguments, the export window and `aborted`. A source without a way to
     * look many songs up at once is asked once per key: resolve the keys you are about to show. A song that
     * only existed on another device (a local file, a cloud upload, a source not installed here) may not
     * resolve, or may resolve to that source's public version. `not-found` comes only from the source's own
     * answer: a key whose request the source refused, or that this host cannot look up by that id yet, comes
     * back `failed`, so keep it. Nothing is played, and no audio address is fetched.
     */
    resolveSongs(keys: readonly FoliumSongKey[], options?: { signal?: AbortSignal }): Promise<readonly FoliumSongResolution[]>;
    /**
     * What the host knows of a song (by `ref`) without asking its source. Null for a song that is not
     * online, or whose `ref` no longer resolves. Synchronous.
     */
    describeSong(song: FoliumSong): FoliumSongDetails | null;
    /**
     * The lyrics of an online song (by `ref`), as its source gives them, parsed by the host. Mods'
     * `omni.lyricsResolved` hooks do not run for this read. Rejects `unsupported` for a song that is not
     * online or whose source has no lyrics.
     */
    getLyrics(song: FoliumSong, options?: { signal?: AbortSignal }): Promise<FoliumOmniLyrics>;
    /**
     * The album of an online song (by `ref`); null when its source has no album for it. May ask the source.
     * Rejects `unsupported` for a song that is not online or whose source has no albums.
     */
    getAlbum(song: FoliumSong, options?: { signal?: AbortSignal }): Promise<FoliumCollection | null>;
    /**
     * The artists of an online song (by `ref`) its source can open; empty when none. May ask the source.
     * Rejects `unsupported` for a song that is not online or whose source has no artists.
     */
    getArtists(song: FoliumSong, options?: { signal?: AbortSignal }): Promise<readonly FoliumCollection[]>;
    /**
     * An album or artist by its key, with the details its source gives; null when the source has none. A
     * source may also reject `unavailable` or `network` for an id it does not know.
     */
    resolveCollection(key: FoliumCollectionKey, options?: { signal?: AbortSignal }): Promise<FoliumCollection | null>;
    /**
     * A page of an album's songs, or of an artist's songs (in the source's order, most popular first for
     * most sources). Without `cursor` the first page; `limit` (default 50, at most 100) is read only then.
     */
    getTracks(
        collection: FoliumCollection,
        options?: { cursor?: string; limit?: number; signal?: AbortSignal },
    ): Promise<FoliumOmniPage<FoliumSong>>;
    /** A page of an artist's albums; paged as `getTracks`. */
    getArtistAlbums(
        artist: FoliumCollection,
        options?: { cursor?: string; limit?: number; signal?: AbortSignal },
    ): Promise<FoliumOmniPage<FoliumCollection>>;
}

/** Folium 1.7: one band of the host's graphic equalizer, as `FoliumEqualizerState.bands` lists it. Frozen. */
export interface FoliumEqualizerBand {
    /** The band's frequency in Hz: the centre of a peaking band, the corner of a shelf. */
    readonly frequency: number;
    /**
     * `lowshelf` (the first band) lifts or cuts everything below its frequency, `highshelf` (the last band)
     * everything above it, `peaking` (the others) the frequencies around it. Later minors may add shapes:
     * read one you do not know as `peaking`.
     */
    readonly shape: 'lowshelf' | 'peaking' | 'highshelf';
}

/**
 * Folium 1.7: a built-in sound of the host, as the audio effects window lists it: `flat` (Level), `lofi`,
 * `radio`, `hall`, `vocal` and `bass` (Bass boost). Each is an equalizer curve together with a set of effects.
 * `setMode` takes each of these ids for all of Folium 1.x; later minors may add more.
 */
export type FoliumEqualizerPresetId = 'flat' | 'lofi' | 'radio' | 'hall' | 'vocal' | 'bass';

/**
 * Folium 1.7: one of the user's own saved sounds in the audio effects window (Custom 1 and Custom 2), each a
 * curve and a set of effects. `setMode` takes each of these ids for all of Folium 1.x; later minors may add more.
 */
export type FoliumEqualizerCustomId = 'custom1' | 'custom2';

/** Folium 1.7: a sound `folium.equalizer.setMode` can switch to: a built-in one, or one of the user's own. */
export type FoliumEqualizerUserMode =
    | { readonly kind: 'preset'; readonly id: FoliumEqualizerPresetId }
    | { readonly kind: 'custom'; readonly id: FoliumEqualizerCustomId };

/**
 * Folium 1.7: what the equalizer plays now. `preset` / `custom`: a sound the user chose (or a mod switched
 * to with `setMode`). `mod`: a curve a mod put in place with `applyCurve`, over the user's own effects;
 * `modId` names the mod. While that mod is disabled or removed the user's own sound plays, and the state
 * shows it; the curve comes back when the mod is enabled again. Later minors may add kinds: a mode you do
 * not know is one the user chose, so leave it be.
 */
export type FoliumEqualizerMode =
    | FoliumEqualizerUserMode
    | { readonly kind: 'mod'; readonly modId: string };

/**
 * Folium 1.7: the host's graphic equalizer as it is heard, as `folium.equalizer.getState()` and
 * `equalizer.changed` give it. Frozen. The user's custom sounds are not part of it, except the curve of the
 * one playing.
 */
export interface FoliumEqualizerState {
    /**
     * The processing switch of the audio effects window. While false the gains are kept but not heard, and
     * the effects are off too; the switch is the user's, and no `folium.equalizer` write turns it on.
     */
    readonly enabled: boolean;
    /** What plays now. */
    readonly mode: FoliumEqualizerMode;
    /** The gain of each band in dB, in the order of `bands`, from `minGain` to `maxGain`. Heard only while `enabled`. */
    readonly gains: readonly number[];
    /** The bands, lowest first: ten in Folium 1.7. The same frozen array on every read. */
    readonly bands: readonly FoliumEqualizerBand[];
    /** The lowest gain of a band in dB: -12 in Folium 1.7. */
    readonly minGain: number;
    /** The highest gain of a band in dB: 12 in Folium 1.7. */
    readonly maxGain: number;
    /**
     * Whether what plays goes through the host's own audio, where the equalizer sits. False during external
     * Stage playback (another player's now-playing, a Stage source with lyrics and no audio): the equalizer
     * has nothing to act on then. Its settings still apply once the host plays again.
     */
    readonly hostPlaysAudio: boolean;
    /**
     * False while the audio effects window is open: a write that would change something is refused
     * `panel-open` then, and `equalizer.changed` fires when the window closes. Later minors may add other
     * times it is false. The permission and the rate limit are not part of it.
     */
    readonly writable: boolean;
}

/**
 * Folium 1.7: who changed the equalizer, as `equalizer.changed` reports it. `user`: the user, in the audio
 * effects window. `command`: a host command (the command palette's sound commands). `mod`: a mod, through
 * `folium.equalizer`; compare `modId` with your own `folium.modId`. `host`: the host itself, with nobody
 * changing the sound (the sound left the host's own audio or came back to it, the audio effects window opened
 * or closed, the mod of the curve in place was disabled, removed or enabled again). Later minors may add
 * kinds: read one you do not know as `user`.
 */
export interface FoliumEqualizerChangeOrigin {
    /** Who it was. */
    readonly kind: 'user' | 'command' | 'host' | 'mod';
    /** The mod, for `mod`; null for the others. */
    readonly modId: string | null;
}

/**
 * Folium 1.7: why the host did not take a `folium.equalizer` write. `stopped`: this mod has stopped.
 * `unknown-mode`: this host has no such sound (one a later minor added). `panel-open`: the audio effects
 * window is open, so the user is at it; wait for `equalizer.changed` with `state.writable` true.
 * `rate-limited`: too many writes (see FoliumEqualizerService). When several apply, the first of these in
 * this order is given. A write that would change nothing is never refused for `panel-open` or `rate-limited`.
 * Later minors may add reasons: treat one you do not know as `rate-limited`, and try again later rather than
 * in a loop.
 */
export type FoliumEqualizerRefusal = 'stopped' | 'unknown-mode' | 'panel-open' | 'rate-limited';

/** Folium 1.7: the outcome of a `folium.equalizer` write; `state` is the equalizer after it. */
export type FoliumEqualizerWriteResult =
    | { readonly ok: true; readonly state: FoliumEqualizerState }
    | { readonly ok: false; readonly reason: FoliumEqualizerRefusal };

/**
 * Folium 1.7: `folium.equalizer`, the host's graphic equalizer (the bands of the audio effects window).
 * Reading needs no permission; `setMode`, `applyCurve` and `releaseCurve` need `equalizer.control`. A mod
 * gets the equalizer's settings, never its audio nodes. A write lands where the user's own choices do, so the
 * audio effects window and the sound follow it, and it is kept across restarts.
 *
 * No write changes the user's custom sounds or turns the processing switch on: while `enabled` is false a
 * write is kept but not heard. The user comes first: any choice the user makes in the audio effects window
 * (a sound, keeping a mod's curve as one of their own, going back to their own) ends a mod's curve, and
 * while that window is open writes are refused `panel-open`. Follow `equalizer.changed`: once its `origin`
 * is the user, a host command or another mod (not `host`, and not your own mod), step back: putting your
 * curve back after that overrides the user. The host tells the user which mod changed the sound.
 *
 * Every write that changes something is saved: write what you settled on rather than animating through it.
 * Currently a mod may make one such write a second and 20 a minute; past that a write is refused
 * `rate-limited`. A write changes nothing when the user's settings it would leave and the curve in place
 * are the same as now; such a write is accepted, does not count, and is never refused `panel-open` or
 * `rate-limited`. During an automix blend the host holds a mod's change back from the sound until the blend
 * has ended (`getState` reports it at once), and it glides a mod's gains in rather than switching them.
 *
 * Main window only: in the export window every method throws an Error whose message is
 * `equalizer-unavailable-in-export-context`. The main entry has no `equalizer`; ask the client over `rpc`.
 * An older host has no `folium.equalizer`: check `folium.host.folium.minor >= 7` first. Malformed arguments
 * throw a TypeError (`invalid-arguments: …`); a write without the permission throws
 * `permission-denied:equalizer.control`.
 */
export interface FoliumEqualizerService {
    /** The equalizer now, as it is heard. Synchronous; follow changes with `equalizer.changed`. */
    getState(): FoliumEqualizerState;
    /**
     * Switches to a built-in sound or to one of the user's own, as the command palette's sound commands do:
     * its curve and its effects together, and a mod's curve in place ends. Writes no custom sound and leaves
     * the processing switch as it is. Refused `unknown-mode` for a sound this host does not have. Needs
     * `equalizer.control`.
     */
    setMode(mode: FoliumEqualizerUserMode): FoliumEqualizerWriteResult;
    /**
     * Puts this mod's own curve in place, as mode `{ kind: 'mod' }`: 1 to `bands.length` finite gains in dB,
     * one per band from the lowest. Bands left out read 0; each gain is clamped to `minGain`–`maxGain` and
     * rounded to 0.1 dB, as `state.gains` then shows. The effects and the switch stay as the user had them.
     * The curve stays, across restarts and while this mod reloads, until the user or a mod changes the sound;
     * while this mod is disabled or removed the user's own sound plays, and the curve comes back when it is
     * enabled again. The user can go back to their own sound, or keep the curve as one of their own, from the
     * audio effects window. Needs `equalizer.control`.
     */
    applyCurve(gains: readonly number[]): FoliumEqualizerWriteResult;
    /**
     * Takes this mod's curve off and goes back to the user's own sound. True when this mod's curve was in
     * place; false otherwise, and nothing changes. Never refused for the rate or the open window.
     * Needs `equalizer.control`.
     */
    releaseCurve(): boolean;
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
 * too many requests, from this mod (currently 120 a minute per mod, shared with `folium.omni`; past 8 at a
 * time a request waits for one of them to finish instead of failing) or as the platform says.
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
 * the developer log, and where `folium.omni` offers the same, use it. Answers are the platform's raw JSON
 * and follow the backend library the host pins (`describe`), so they can change with any Folia release;
 * nothing about them is promised.
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
    /** Folium 1.7: the host's online music sources, read only: search, songs by id, lyrics, albums, artists. */
    readonly omni: FoliumOmniService;
    /** Folium 1.7: the host's graphic equalizer: read it, switch the user's sound, put a curve of your own in place. */
    readonly equalizer: FoliumEqualizerService;
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
    readonly experimental: FoliumExperimental;
}

/** The shape of a client entry module. */
export interface FoliumClientModule {
    /** `activate(folium)`; may return a disposer, which runs before the host removes the mod's registrations. */
    default: (folium: FoliumClientApi) => void | FoliumDisposer | Promise<void | FoliumDisposer>;
}

/**
 * The shape of a main entry. The file `main` names exports the function itself:
 * `module.exports = function activate(api) { ... }`. It may return a function, which runs when the mod
 * stops, like one given to `api.onDispose`. It may be `async`; a throw, or a promise that rejects, marks
 * the mod as failed.
 */
export type FoliumMainModule = (api: FoliumMainApi) => void | FoliumDisposer | Promise<void | FoliumDisposer>;

/**
 * The object a main entry's `activate(api)` receives.
 *
 * The main entry runs in Node with full access: it can `require` any Node module, and `require('electron')`
 * too. But only `api` is the contract; anything else may change between Folia releases.
 *
 * A member that needs a permission says so. Called without that permission in mod.json `permissions`, a
 * synchronous member throws `permission-denied:<permission>`, and an asynchronous one returns a promise that
 * rejects with that error.
 */
export interface FoliumMainApi {
    /** This mod's mod.json as the host read it (missing fields filled in), frozen. */
    readonly manifest: FoliumManifest;
    /** Host versions; the same as the client entry's `folium.host`. */
    readonly host: FoliumHostInfo;
    /** Logging; `error` entries show in the mods panel under the mod. */
    readonly log: FoliumLogger;
    /**
     * This mod's data file: the same file the client entry's `folium.storage` reads and writes, so both sides
     * see one state. Needs the `filesystem.data` permission.
     */
    readonly storage: FoliumMainStorage;
    /**
     * Folium 1.7: the values of this mod's `secret` settings fields, the same store the client entry's
     * `folium.secrets` reads and writes. A listener given to `subscribe` stops when the mod stops.
     */
    readonly secrets: FoliumSecretAccess;
    /** Folders to write into: this mod's own folder and the user's folders. */
    readonly paths: FoliumMainPaths;
    /**
     * Runs `disposer` when the mod stops: it is turned off, reloaded, or the app quits. Release here what
     * `activate` started: timers, watchers, listeners, child processes. Cleanups run last registered first
     * (the function `activate` returned counts as registered when `activate` returned), and one that throws
     * does not stop the others. After the mod has stopped, `disposer` runs at once. Returns nothing.
     */
    onDispose(disposer: FoliumDisposer): void;
    /** What the app is playing. */
    readonly runtime: FoliumMainRuntime;
    /** Answers calls from this mod's client entry, and (Folium 1.7) sends it messages. */
    readonly rpc: FoliumMainRpc;
    /** Video export. */
    readonly render: FoliumMainRender;
}

/** A mod's mod.json as the main entry sees it in `api.manifest`: every field there, missing ones filled in. */
export interface FoliumManifest {
    /** The Folium major version the mod is written for. */
    readonly folium: number;
    /** The mod id. */
    readonly id: string;
    /** The mod's name. */
    readonly name: string;
    /** The mod's version, `MAJOR.MINOR.PATCH`. */
    readonly version: string;
    /** The author, or null. */
    readonly author: string | null;
    /** The description, or null. */
    readonly description: string | null;
    /** The main entry's file name, or null. */
    readonly main: string | null;
    /** The client entry's path in the mod folder, or null. */
    readonly client: string | null;
    /** The mods this one depends on (`id` or `id@^1.2.3`). */
    readonly depends: readonly string[];
    /** The permissions the mod declares. */
    readonly permissions: readonly string[];
    /** The experimental surfaces the mod opts into. */
    readonly experimental: readonly string[];
    /** The https origins `folium.ui.embed` may load. */
    readonly embedOrigins: readonly string[];
    /** The Folia versions the mod needs (e.g. `>=0.7.0 <0.8.0`), or null. */
    readonly folia: string | null;
    /** The introduction image's path in the mod folder, or null. */
    readonly preview: string | null;
}

/**
 * `api.storage`: the data file the client entry shares (FoliumStorage, capped at 1 MB), and the directories
 * for anything larger.
 */
export interface FoliumMainStorage extends FoliumStorage {
    /** The directories this mod writes its own files to. Always there, permission or not, so `'paths' in api.storage` finds it. */
    readonly paths: FoliumModPaths;
}

/**
 * `api.storage.paths`, the directories this mod writes its files to. Needs the `filesystem.data` permission; without
 * it, reading either path throws `permission-denied:filesystem.data`. Each read creates the directory when it is
 * missing, and throws the file system's error when it cannot (a file or a dead link standing where the
 * directory should be; for `cache`, clearing the cache in the mods panel removes that entry). Both getters
 * are non-enumerable, so serializing or spreading `api` never reads them. Clients get no paths: they have no
 * file system.
 */
export interface FoliumModPaths {
    /** Files to keep: `<userData>/mods-data/<id>/files`, beside (not holding) the data file. */
    readonly data: string;
    /**
     * Files the mod can rebuild: `<userData>/mods-cache/<id>`. The user can empty it from the mods panel at
     * any time, even while the mod runs, so expect files to vanish; the host sets no size limit, so cap it
     * yourself.
     */
    readonly cache: string;
}

/**
 * `api.paths`: where a main entry writes. Put what the user will look for (an export, a report) under one
 * of the user's folders; keep the mod's own files under `api.storage.paths`.
 */
export interface FoliumMainPaths {
    /** The user's Documents folder. Reading it throws when the system has no such folder; so do the other three. */
    readonly documents: string;
    /** The user's Downloads folder. */
    readonly downloads: string;
    /** The user's Music folder. */
    readonly music: string;
    /** The user's Videos folder. */
    readonly videos: string;
}

/** `api.runtime`. */
export interface FoliumMainRuntime {
    /**
     * The playback state the app last sent to the main process, or null before it sent one. While playing,
     * `position` is moved on by the time since. Needs the `playback.read` permission.
     */
    getPlaybackSnapshot(): FoliumPlaybackSnapshot | null;
}

/** `api.rpc`: the main half of `folium.rpc`. */
export interface FoliumMainRpc {
    /**
     * Answers the client entry's `folium.rpc.call(name, ...args)`: `handler` gets the call's arguments, and
     * what it returns (or what its promise resolves to) is the call's result; a throw rejects the call.
     * Arguments and results cross between processes, so both must be JSON-serializable. `name` must match
     * `/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/`, and a second handler for the same name throws.
     */
    handle(name: string, handler: (...args: any[]) => unknown): void;
    /**
     * Folium 1.7: sends `payload` to this mod's client entry in the main window, where
     * `folium.rpc.on(name, ...)` receives it; no other mod's client hears it, and the export window never
     * does. Fire-and-forget: nothing is queued, so a message sent while the client is not running (the
     * window rebuilt, the client not activated yet) or while there is no main window is dropped without an
     * error. `payload` must be JSON-serializable, at most 64 KB as JSON text; left out, the client gets
     * `null`. `name` follows the same rule as `handle`. A bad name or payload throws at the call
     * (`rpc-payload-too-large:65536` for one over the limit). Older 1.x hosts lack it: check
     * `api.host.folium.minor >= 7`.
     */
    send(name: string, payload?: unknown): void;
}

/** `api.render`. */
export interface FoliumMainRender {
    /**
     * Exports the current song as a video, drawn the way the app shows it now: the lyric animation mode, its
     * settings and tuning, the lyrics and the theme. `spec` holds only output choices. Needs the
     * `render.export` permission, and an ffmpeg Folia can find (the mods panel says whether it found one).
     * Folia shows the progress. The promise resolves when the export ends, whether or not the video was
     * written: read `ok`.
     */
    exportVideo(spec: FoliumExportSpec): Promise<FoliumExportResult>;
}

/** Output choices for `api.render.exportVideo`. Every field is optional; numbers are clamped to their range. */
export interface FoliumExportSpec {
    /** `vp9` (default): WebM, about a tenth of the size. `prores`: ProRes 4444 in a MOV, large, opens almost anywhere. */
    codec?: 'vp9' | 'prores';
    /** Width in pixels, 320 to 3840; default 1920. */
    width?: number;
    /** Height in pixels, 180 to 2160; default 1080. */
    height?: number;
    /** Frames per second, 10 to 60; default 30. */
    fps?: number;
    /** Start, seconds into the song; default 0. */
    startSec?: number;
    /**
     * End, seconds into the song. 0, or a time not after `startSec`, means 2 seconds after the lyrics end
     * (and at least 1 second after `startSec`). The video is at most 15 minutes long.
     */
    endSec?: number;
    /**
     * `transparent` (default): the lyrics on a transparent background; the alpha channel is kept on Windows,
     * and may come out black elsewhere. `theme`: on the song theme's background colour, on every system.
     */
    background?: 'transparent' | 'theme';
}

/** What `api.render.exportVideo` resolves to. */
export interface FoliumExportResult {
    /** True when the video was written. */
    ok: boolean;
    /**
     * Why not, when `ok` is false: `export-no-lyrics`, `export-invalid-duration`, `export-unsupported-platform`,
     * `export-already-running`, `export-ffmpeg-not-found`, `export-cancelled`, or another `export-…` code.
     */
    error?: string;
    /** The user cancelled the export. */
    cancelled?: boolean;
    /** The video file, in `Folia Exports` under the user's Videos folder. */
    outputPath?: string;
    /** Frames written. */
    frameCount?: number;
    /** The file's size, bytes. */
    sizeBytes?: number;
    /** The video's length, seconds. */
    durationSec?: number;
    /** `none` (a transparent background) or `theme`. */
    backgroundMode?: 'none' | 'theme';
    /** The video has a transparent background. */
    transparent?: boolean;
    /**
     * What may be off in a written video: `export-alpha-unavailable` (this machine captured no alpha channel),
     * `export-alpha-not-guaranteed` (not Windows: the alpha channel may be black).
     */
    warnings?: string[];
}
