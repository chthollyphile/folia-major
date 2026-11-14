// mods/folium.d.ts
// 本文件由 `npm run folium:types` 从 src/mods/folium/contract.ts、sources/contract.ts 和 mainContract.ts 生成，请勿手动修改。
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
//
// 预览：Folium 2 的音源接口（folium.sources 与音源类模组 main 入口的 api）还是预览版，九个内置音源全部迁过去之前
// 可能变动；用它写的模组可能要随新版本更新。folium: 1 冻结在 Folium 1.9 的接口不受影响。

/** The Folium version this host implements; mods read it at runtime as `folium.host.folium`. */
export declare const FOLIUM_VERSION: { readonly major: 2; readonly minor: 0 };

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
     * playback commands under the mod's name. The user presses the combination there (modifiers of their
     * choice, within the host's rules against combinations other programs surely use, plus a letter, a digit, F1–F24, Space, Tab, Enter, Backspace, Delete or one of the navigation keys);
     * the mod never sees or chooses one.
     * Only for commands without `params`, since a key press cannot fill a form: the host ignores the flag on a
     * command that has any. A press runs `run` with an empty `values` object and shows no result, so use
     * `folium.ui.toast` when the press needs feedback; a throw is recorded against the mod like any failed
     * command. While the mod is stopped or disabled the binding is kept but its combination is not registered,
     * and it comes back when the command is registered again. Not offered on native Wayland, where the
     * desktop's shortcut portal takes a fixed list of the host's playback commands. Needs no permission:
     * binding a combination in Settings is the user's consent.
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
    /**
     * Folium 1.9: the tab's icon, a lucide icon name as `folium.ui.icon` takes it (e.g. "message-circle").
     * The panel draws it when the tab row is too narrow for every label: the tabs that are not open show
     * their icon alone. Left out, or a name the host's lucide version does not have, the tab keeps the
     * puzzle icon. An older host ignores it.
     */
    icon?: string;
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
    /**
     * The lyric animation mode changed, one event for each change. Folium 1.8: `origin` says who changed it
     * (a host before 1.8 sends no `origin`).
     */
    'visualizer.modeChanged': { readonly mode: string; readonly origin: FoliumVisualizerChangeOrigin };
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
    /**
     * Folium 1.8: the global lyric render quality changed (`folium.visualizer.getRenderQuality()`), whoever
     * changed it. One event for all the changes of one task; its origin is the last of them. Changes that end
     * where they began fire none, and neither does a change to one style's own override. Not emitted in the
     * export window.
     */
    'visualizer.renderQualityChanged': {
        readonly quality: FoliumLyricRenderQuality;
        readonly origin: FoliumRenderQualityChangeOrigin;
    };
    /**
     * Folium 1.8: the tuning of builtin mode `mode` changed (`folium.visualizer.getTuning(mode)`), whoever
     * changed it; only the keys mods may set count. One event per mode for all the changes of one task; its
     * origin is the last of them. Changes that end where they began fire none. Not emitted in the export window.
     */
    'visualizer.tuningChanged': {
        readonly mode: string;
        readonly tuning: FoliumVisualizerTuning;
        readonly origin: FoliumVisualizerChangeOrigin;
    };
    /**
     * Folium 1.8: a beat effect's setting or the 智能动感模式 switch changed (`folium.visualizer.getBeatEffects()`),
     * whoever changed it. One event for all the changes of one task; its origin is the last of them. Changes
     * that end where they began fire none. Not emitted in the export window.
     */
    'visualizer.beatEffectsChanged': {
        readonly state: FoliumBeatEffectsState;
        readonly origin: FoliumVisualizerChangeOrigin;
    };
    /**
     * Folium 1.9: the background type changed (`folium.visualizer.getBackground()`), whoever changed it. One
     * event for all the changes of one task; its origin is the last of them. Changes that end where they began
     * fire none. Not emitted in the export window.
     */
    'visualizer.backgroundChanged': {
        readonly background: string;
        readonly origin: FoliumVisualizerChangeOrigin;
    };
    /**
     * Folium 1.9: the animation intensity changed (`folium.visualizer.getAnimationIntensity()`), whoever changed
     * it. `theme.changed` fires for the same change, as the theme carries the intensity too. Not emitted in
     * the export window.
     */
    'visualizer.animationIntensityChanged': {
        readonly intensity: FoliumAnimationIntensity;
        readonly origin: FoliumVisualizerChangeOrigin;
    };
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
     * Folium 1.9: goes back one level, as one press of Escape does. The topmost thing that can step back
     * takes it: an open dialog, the command palette or the settings window closes; then what a page has
     * open over itself (a focused card, a list panel, a filter); then the page: the player panel closes,
     * the player and the wall return to where they were opened from, a collection page returns to the one
     * before it, the search page and a mod's home page close. Returns true when the host took it, false
     * when there was nothing to go back from (the home page with nothing open): a mod that binds a mouse
     * button to it lets the click through then. An open window always takes it, also one that stays open:
     * a dialog busy with work, or one that Escape does not close; nothing under it moves. Unlike the key
     * it never leaves fullscreen. One call is one level: never call it in a loop, and not from a handler
     * of the Escape key, which the host answers itself. Call it on the press of the button
     * (`pointerdown`), before the host's own "press outside closes" handling takes a level of its own.
     * An older host has no `back`: check `folium.host.folium.minor >= 9` first.
     */
    back(): boolean;
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
    /** Default 15000, at most 60000 (a source mod sets any). */
    timeoutMs?: number;
    /**
     * Folium 2, source mods only: `arrayBuffer` reads the body as bytes, for `arrayBuffer()` (an ordinary mod's
     * answers are text). Default `text`.
     */
    responseType?: 'text' | 'arrayBuffer';
    /** Folium 2, source mods only: the named partition the request goes through (as the main entry's `api.net.session`). */
    session?: string;
}

/**
 * A fully read response (body at most 5 MB, none for a source mod); `text` and `json` return synchronously.
 * Folium 2: a source mod's response also has `arrayBuffer()`.
 */
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
    /**
     * Folium 2, source mods only: the body as bytes (asked with `responseType: 'arrayBuffer'`; otherwise the
     * text's UTF-8). An ordinary mod's response has none.
     */
    arrayBuffer?(): ArrayBuffer;
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
    /** `host`: built into Folia. `mod`: registered by a mod (`omni.providers`, or Folium 2 `folium.sources`); gone while that mod is off. */
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
    /**
     * Folium 2 (a `folium: 1` mod has none): a custom capability (`x.<mod id>.<name>@<version>`) of a source,
     * the very object its mod registered, or null where the source has none by that id (or is not there).
     * The host does not call into it, check it or time it: what it does is between the two mods. Synchronous.
     */
    capability(sourceId: string, id: string): unknown;
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
     * Stage playback (another player's now-playing, a Stage source with lyrics and no audio), and while an
     * online platform sounds the song in a player of its own (a page or a program of the platform's): the
     * equalizer has nothing to act on then. Its settings still apply once the host plays again.
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

/**
 * Folium 1.8: how many pixels the host's canvas and WebGL lyric styles draw, as a multiple of each style's own
 * default pixel density (for most, the screen's, capped at 2): below 1 draws fewer pixels (lighter, softer),
 * above 1 supersamples (sharper, heavier on the GPU). `setRenderQuality` takes each of these for all of
 * Folium 1.x; later minors may add more: read one you do not know as the nearest one you do.
 */
export type FoliumLyricRenderScale = 0.5 | 0.75 | 1 | 1.5 | 2;

/**
 * Folium 1.8: the antialiasing of the canvas and WebGL lyric styles. `auto`: each style's own default (some
 * use multisampling, some smooth in post-processing); `on` and `off` force it. `setRenderQuality` takes each
 * of these for all of Folium 1.x; later minors may add modes: read one you do not know as `auto`.
 */
export type FoliumLyricAntialias = 'auto' | 'on' | 'off';

/**
 * Folium 1.8: the host's global lyric render quality, the one level in Settings → Performance & motion, as
 * `folium.visualizer.getRenderQuality()` and `visualizer.renderQualityChanged` give it. Frozen. The canvas and
 * WebGL lyric styles follow it unless the user set an override in a style's own settings; those overrides
 * are not part of it, and no mod reads or writes them. Styles drawn with HTML and CSS do not use it.
 */
export interface FoliumLyricRenderQuality {
    /** The resolution, as a multiple of each style's own default pixel density. */
    readonly scale: FoliumLyricRenderScale;
    /** The antialiasing. */
    readonly antialias: FoliumLyricAntialias;
}

/**
 * Folium 1.8: who changed the render quality, as `visualizer.renderQualityChanged` reports it, and who changed
 * the mode, a mode's tuning or the beat effects, as the other `visualizer.*` events report it
 * (FoliumVisualizerChangeOrigin). `user`: anyone but a mod (the user in the settings, the player panel or the
 * command palette, or the host on the user's behalf: a mode picked at random for the song, an imported or
 * synced config). `mod`: a mod, through one of the `folium.visualizer.set*` methods; compare `modId` with your
 * own `folium.modId`. Later minors may add kinds: read one you do not know as `user`.
 */
export interface FoliumRenderQualityChangeOrigin {
    /** Who it was. */
    readonly kind: 'user' | 'mod';
    /** The mod, for `mod`; null for `user`. */
    readonly modId: string | null;
}

/**
 * Folium 1.8: why the host did not take a `setRenderQuality`. `stopped`: this mod has stopped.
 * `rate-limited`: too many writes (see FoliumVisualizerService). A write that would change nothing is never
 * refused `rate-limited`. Later minors may add reasons: treat one you do not know as `rate-limited`, and try
 * again later rather than in a loop.
 */
export type FoliumRenderQualityRefusal = 'stopped' | 'rate-limited';

/** Folium 1.8: the outcome of a `setRenderQuality`; `quality` is the render quality after it. */
export type FoliumRenderQualityWriteResult =
    | { readonly ok: true; readonly quality: FoliumLyricRenderQuality }
    | { readonly ok: false; readonly reason: FoliumRenderQualityRefusal };

/** Folium 1.8: who changed the mode, a mode's tuning or the beat effects; see FoliumRenderQualityChangeOrigin. */
export type FoliumVisualizerChangeOrigin = FoliumRenderQualityChangeOrigin;

/**
 * Folium 1.8: why the host did not take a `setMode`, `setTuning` or `setBeatEffects` (and, Folium 1.9, a
 * `setBackground` or `setAnimationIntensity`), as for `setRenderQuality` (FoliumRenderQualityRefusal):
 * `stopped` or `rate-limited`. Each kind of write has its own allowance (see FoliumVisualizerService). Treat
 * a reason you do not know as `rate-limited`.
 */
export type FoliumVisualizerWriteRefusal = FoliumRenderQualityRefusal;

/**
 * Folium 1.8: one key of a builtin mode's tuning that mods may read and write, as `listModes()` describes it,
 * with the same range or choices as the control in the mode's own settings. `number`: from `min` to `max`, a
 * value outside is clamped; with a `step`, a value lands on the nearest whole step from `min` (a count, say),
 * with none any value in the range is kept. `boolean`: a switch. `choice`: one of `options`. `defaultValue`:
 * the value before the user changed anything. A value `getTuning` reads may be one the key does not offer
 * (a choice left to the user, such as cappella's `custom` avatar, which needs a picture the user uploaded):
 * writing back the value the key holds is always taken. Later minors may add types: leave a key whose type you
 * do not know alone.
 */
export type FoliumTuningKeyInfo =
    | { readonly type: 'number'; readonly min: number; readonly max: number; readonly step: number | null; readonly defaultValue: number }
    | { readonly type: 'boolean'; readonly defaultValue: boolean }
    | { readonly type: 'choice'; readonly options: readonly string[]; readonly defaultValue: string };

/** Folium 1.8: a value of a mode's tuning key. */
export type FoliumTuningValue = number | boolean | string;

/** Folium 1.8: a builtin mode's tuning as mods see it: its declared keys (FoliumTuningKeyInfo) and their values now. Frozen. */
export type FoliumVisualizerTuning = Readonly<Record<string, FoliumTuningValue>>;

/**
 * Folium 1.8: what a beat effect of 智能动感模式 plays on. `beats`: the beat list of the track (Beat This!);
 * `drums`: the drum hits (the drum stem); `stems`: the drum hits and the vocal together. Later minors may add
 * sources: read one you do not know as `beats`.
 */
export type FoliumBeatEffectSource = 'beats' | 'drums' | 'stems';

/** Folium 1.8: a part of a beat effect with its own strength in place of the one (`parts`). */
export interface FoliumBeatEffectPartInfo {
    /** Stable: the key in FoliumBeatEffectState `parts` and FoliumBeatEffectPatch `parts`. */
    readonly key: string;
    /** Its name in the user's language. */
    readonly label: string;
}

/** Folium 1.8: a beat effect a builtin mode draws under 智能动感模式, as `listModes()` describes it. */
export interface FoliumBeatEffectInfo {
    /** Stable, `<mode>.<name>`, e.g. `sonnet.lensTear`. */
    readonly id: string;
    /** The mode that draws it. */
    readonly mode: string;
    /** Its name in the user's language, as the mode's settings show it. */
    readonly label: string;
    /** What it plays on. */
    readonly source: FoliumBeatEffectSource;
    /** Its parts, each with its own strength; empty for an effect with one strength. */
    readonly parts: readonly FoliumBeatEffectPartInfo[];
}

/** Folium 1.8: a lyric animation mode, as `folium.visualizer.listModes()` gives it. Frozen. */
export interface FoliumVisualizerModeInfo {
    /** The mode id: a builtin's (`sonnet`, `machi`) or a mod's (`mod:<modid>:<id>`). What `setMode` takes. */
    readonly id: string;
    /** Its name in the mode picker, in the user's language. */
    readonly label: string;
    /** `builtin` or `mod`. */
    readonly kind: 'builtin' | 'mod';
    /** The keys of its tuning mods may set with `setTuning`, by key; empty for a mode with none (every mod mode). */
    readonly tuning: Readonly<Record<string, FoliumTuningKeyInfo>>;
    /** The beat effects it draws under 智能动感模式; empty for a mode with none. */
    readonly beatEffects: readonly FoliumBeatEffectInfo[];
}

/** Folium 1.8: one beat effect's own setting, as `getBeatEffects()` gives it. */
export interface FoliumBeatEffectState {
    /** The effect, as FoliumBeatEffectInfo `id`. */
    readonly id: string;
    /** The mode that draws it. */
    readonly mode: string;
    /** Whether it plays (while 智能动感模式 is not `off`). */
    readonly on: boolean;
    /** Its strength, 0..2; 1 is the look it was made for. Unused for an effect with parts. */
    readonly strength: number;
    /** The strength of each of its parts, 0..2, by part key; empty for an effect with none. */
    readonly parts: Readonly<Record<string, number>>;
}

/**
 * Folium 1.8: the user's 智能动感模式 switch. `off`: no beat effect plays. `cached`: they play on tracks
 * already analysed, and nothing new is analysed. `on`: they play, and a track not yet analysed is analysed now
 * on the GPU, for the effects switched on in the mode on screen: an effect on `beats` runs the beat model, one
 * on `drums` or `stems` separates the drums, so switching such an effect on under `on` can start that work for
 * every new track. Read only: it is the user's (see FoliumVisualizerService). Later minors may add modes: read
 * one you do not know as `cached`.
 */
export type FoliumSmartBeatMode = 'off' | 'cached' | 'on';

/** Folium 1.8: the beat effects of every builtin mode, as `getBeatEffects()` and `visualizer.beatEffectsChanged` give them. Frozen. */
export interface FoliumBeatEffectsState {
    /** The user's 智能动感模式 switch; the effects play only while it is not `off`. */
    readonly smartBeat: FoliumSmartBeatMode;
    /** Every effect, in the order of the mode picker. */
    readonly effects: readonly FoliumBeatEffectState[];
}

/** Folium 1.8: a change to one beat effect: the fields given, the others as they are. */
export interface FoliumBeatEffectPatch {
    /** Whether it plays. */
    readonly on?: boolean;
    /** 0..2; a value outside is clamped. */
    readonly strength?: number;
    /** Strengths by part key, 0..2, each clamped; keys the effect has no part for are ignored. */
    readonly parts?: Readonly<Record<string, number>>;
}

/** Folium 1.8: the outcome of a `setMode`; `mode` is the mode after it. */
export type FoliumModeWriteResult =
    | { readonly ok: true; readonly mode: string }
    | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal };

/**
 * Folium 1.8: the outcome of a `setTuning`: `tuning` is the mode's tuning after it (the values as they were
 * kept: clamped, rounded to a step, or changed with a key the mode's settings change together, as 云阶's
 * stagger moved past the other end takes that end along); `ignored` the keys of the patch
 * the mode does not let mods set.
 */
export type FoliumTuningWriteResult =
    | { readonly ok: true; readonly tuning: FoliumVisualizerTuning; readonly ignored: readonly string[] }
    | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal };

/**
 * Folium 1.8: the outcome of a `setBeatEffects`: `state` is the beat effects after it; `ignored` the effect ids
 * of the patch no mode offers, and `<id>:<part>` for part keys the effect does not have.
 */
export type FoliumBeatEffectsWriteResult =
    | { readonly ok: true; readonly state: FoliumBeatEffectsState; readonly ignored: readonly string[] }
    | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal };

/** Folium 1.9: a background type, as `folium.visualizer.listBackgrounds()` gives it. Frozen. */
export interface FoliumBackgroundInfo {
    /** The background id: a builtin's (`latent`, `monet`) or a mod's (`mod:<modid>:<id>`). What `setBackground` takes. */
    readonly id: string;
    /** Its name in the background picker, in the user's language. */
    readonly label: string;
    /** `builtin` or `mod`. */
    readonly kind: 'builtin' | 'mod';
}

/**
 * Folium 1.9: the animation intensity, the chip in the player panel: how lively the lyric styles and the
 * backgrounds move. `setAnimationIntensity` takes each of these for all of Folium 1.x; later minors may add
 * levels: read one you do not know as `normal`.
 */
export type FoliumAnimationIntensity = 'calm' | 'normal' | 'chaotic';

/** Folium 1.9: the outcome of a `setBackground`; `background` is the background type after it. */
export type FoliumBackgroundWriteResult =
    | { readonly ok: true; readonly background: string }
    | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal };

/** Folium 1.9: the outcome of a `setAnimationIntensity`; `intensity` is the animation intensity after it. */
export type FoliumAnimationIntensityWriteResult =
    | { readonly ok: true; readonly intensity: FoliumAnimationIntensity }
    | { readonly ok: false; readonly reason: FoliumVisualizerWriteRefusal };

/**
 * Folium 1.8: `folium.visualizer`, the host's settings of the lyric display that mods may share: the global
 * lyric render quality (FoliumLyricRenderQuality), the lyric animation mode, the tuning of the builtin modes
 * (the keys each declares, FoliumTuningKeyInfo) and the beat effects of 智能动感模式; Folium 1.9 adds the
 * background type and the animation intensity. Reading needs no permission; each kind of write needs its
 * own: `setRenderQuality` `visualizer.renderQuality`, `setMode` `visualizer.mode`, `setTuning`
 * `visualizer.tuning`, `setBeatEffects` `visualizer.beatEffects`, `setBackground` `visualizer.background`,
 * `setAnimationIntensity` `visualizer.animationIntensity`. A write is the
 * same as the user making the change in the settings or the player panel: what shows the setting changes with
 * it, the styles follow it (a style may rebuild its renderer for it), and it is kept across restarts. A style's
 * own render override, its picture-cost settings (resolution, render quality) and the 智能动感模式 switch
 * (`off` / `cached` / `on`, which decides whether tracks may be analysed on the GPU at all) stay the user's: mods
 * read them at most, and never write them. Under `on`, though, the effects a mod switches on decide which
 * analysis runs (FoliumSmartBeatMode): switch on only the effects you mean the picture to have.
 *
 * The settings are the user's: follow the `visualizer.*Changed` events, and once an `origin` is the user (or
 * another mod), step back rather than writing yours again. Every write that changes something is saved and
 * can make the styles rebuild: write what you settled on, never animate through it. Each kind of write has
 * its own allowance per mod: currently one counted write a second and 20 a minute; past that a write is
 * refused `rate-limited`. A write that changes nothing is accepted, does not count and is never refused
 * `rate-limited`.
 *
 * Main window only: in the export window every method throws an Error whose message is
 * `visualizer-unavailable-in-export-context` (a visualizer of yours that also renders there checks
 * `folium.env.context` first). The main entry has no `visualizer`; ask the client over `rpc`. An older host
 * has no `folium.visualizer`: check `folium.host.folium.minor >= 8` first (`>= 9` for the background and the
 * animation intensity). Malformed arguments throw a
 * TypeError (`invalid-arguments: …`); a write without its permission throws `permission-denied:<permission>`.
 */
export interface FoliumVisualizerService {
    /** The global lyric render quality now. Synchronous; follow changes with `visualizer.renderQualityChanged`. */
    getRenderQuality(): FoliumLyricRenderQuality;
    /**
     * Changes the global lyric render quality: the fields `patch` has, the others as they are. A `scale` or an
     * `antialias` this contract does not list throws a TypeError, and so does a `patch` that is no object;
     * other keys are ignored, and `{}` changes nothing. Needs `visualizer.renderQuality`.
     */
    setRenderQuality(patch: Partial<FoliumLyricRenderQuality>): FoliumRenderQualityWriteResult;
    /**
     * The lyric animation modes there are now, builtin and from mods, in the order of the mode picker, each with
     * the tuning keys and the beat effects it offers. Frozen; a mod mode comes and goes with its mod.
     */
    listModes(): readonly FoliumVisualizerModeInfo[];
    /** The mode on screen now. Synchronous; follow changes with `visualizer.modeChanged`. */
    getMode(): string;
    /**
     * Switches to the mode `id` (one of `listModes()`), as the user does in the player panel, without the
     * "switched" notice: like the player panel it also switches off "a random mode for every song". An `id` that
     * is not a mode now throws a TypeError. Switching to the mode on screen changes nothing, unless "a random
     * mode for every song" is on: then it switches that off, as the player panel does. While that setting is on,
     * the host picks a mode for each new song itself, and `visualizer.modeChanged` reports the pick as `user`.
     * Needs `visualizer.mode`.
     */
    setMode(id: string): FoliumModeWriteResult;
    /**
     * The tuning of builtin mode `mode` now: the keys `listModes()` lists for it, frozen. A mode that is none now
     * throws a TypeError; a mode with no such keys (every mod mode) gives `{}`. Follow changes with
     * `visualizer.tuningChanged`.
     */
    getTuning(mode: string): FoliumVisualizerTuning;
    /**
     * Changes the tuning of builtin mode `mode`, as its settings do: the keys `patch` has, the others as they
     * are, whether or not the mode is on screen. A key the mode does not offer is ignored (`ignored`); a value
     * of the wrong type, a number that is not finite, a choice not listed, or a `patch` that is no object throws
     * a TypeError, and nothing is written. A number outside its range is clamped; the value a key holds now is
     * taken as it is, so a tuning `getTuning` read writes back unchanged. `{}` changes nothing. Needs
     * `visualizer.tuning`.
     */
    setTuning(mode: string, patch: Readonly<Record<string, FoliumTuningValue>>): FoliumTuningWriteResult;
    /** The beat effects of every builtin mode now, and the user's 智能动感模式 switch. Follow changes with `visualizer.beatEffectsChanged`. */
    getBeatEffects(): FoliumBeatEffectsState;
    /**
     * Changes beat effects, as each mode's settings do: `patch` is FoliumBeatEffectPatch by effect id, the
     * fields given, the others as they are. An id no mode offers is ignored (`ignored`), and so is a part key the
     * effect has no part for; an `on` that is no boolean, a strength that is no finite number, or a patch that
     * is no object throws a TypeError, and nothing is written. Never changes the 智能动感模式 switch. `{}`
     * changes nothing. Needs `visualizer.beatEffects`.
     */
    setBeatEffects(patch: Readonly<Record<string, FoliumBeatEffectPatch>>): FoliumBeatEffectsWriteResult;
    /**
     * Folium 1.9: the background types there are now, builtin and from mods, in the order of the background
     * picker. Frozen; a mod background comes and goes with its mod.
     */
    listBackgrounds(): readonly FoliumBackgroundInfo[];
    /**
     * Folium 1.9: the background type the user has picked. Synchronous; follow changes with
     * `visualizer.backgroundChanged`. A mod's background can stay picked after its mod stopped (the host draws
     * its default one meanwhile), so the id may be none of `listBackgrounds()` for that time.
     */
    getBackground(): string;
    /**
     * Folium 1.9: switches to the background type `id` (one of `listBackgrounds()`), as the user does in the
     * background picker. An `id` that is not a background now throws a TypeError. The type only: what a type
     * draws from (the picture of `monet`, the list of `url`, each type's own options) stays as the user set
     * it, so a type the user never set up draws its empty state. Needs `visualizer.background`.
     */
    setBackground(id: string): FoliumBackgroundWriteResult;
    /** Folium 1.9: the animation intensity now. Synchronous; follow changes with `visualizer.animationIntensityChanged`. */
    getAnimationIntensity(): FoliumAnimationIntensity;
    /**
     * Folium 1.9: sets the animation intensity, as the chip in the player panel does. A value this contract
     * does not list throws a TypeError. While the app is still starting (no theme on screen yet) it throws
     * an Error whose message is `visualizer-unavailable-in-main-context`, as `folium.ui` does then: write
     * from an event or a user action rather than straight from `activate`. Needs
     * `visualizer.animationIntensity`.
     */
    setAnimationIntensity(value: FoliumAnimationIntensity): FoliumAnimationIntensityWriteResult;
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
    /**
     * Folium 2: whether a lyric text is only the "instrumental, please enjoy" notice, by the host's own rule (the
     * one its lyric display and its platforms use). For a source's `lyrics@1` answer (`isPureMusic`). Synchronous.
     */
    isPureMusicText(text: string | null | undefined): boolean;
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
 * Folium 1.7 on; an older 1.x host lacks some of them. Folium 2.0: a mod whose mod.json says `folium: 1`
 * reads 1.9 here, the version its interface stays at; a `folium: 2` mod reads the host's own. A host that
 * runs a `folium: 2` mod has every member a "check `folium.host.folium.minor >= …`" below speaks of: such a
 * check is for `folium: 1` mods (in a `folium: 2` mod, check `major >= 2` or nothing).
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
    /** Folium 1.8: the host's settings of the lyric display: the global lyric render quality. */
    readonly visualizer: FoliumVisualizerService;
    /**
     * Folium 2 (a `folium: 1` mod has none): a source mod's sources (`sources` in mod.json). Any `folium: 2`
     * mod may ask `supports`; only a source mod registers.
     */
    readonly sources: FoliumSourcesService;
    /** Folium 2 (a `folium: 1` mod has none): texts from the mod's own locale files (`locales` in mod.json). */
    readonly i18n: FoliumI18nService;
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

// ---------------------------------------------------------------- Sources
// 预览：Folium 2 的音源接口（folium.sources 与音源类模组 main 入口的 api）还是预览版，九个内置音源全部迁过去之前
// 可能变动；用它写的模组可能要随新版本更新。folium: 1 冻结在 Folium 1.9 的接口不受影响。

/**
 * Folium 2: a text a source hands the host: written out (shown as it is in every language), one string per
 * language (a FoliumLabel), or a key of the mod's own locale files (`folium.i18n.key`). The host turns each
 * into a key of its own translations, so the text follows the UI language like the host's.
 */
export type FoliumText = string | FoliumLabel | FoliumTextKey;

/**
 * Folium 2: a key of the mod's own locale files (manifest `locales`: one `<language>.json` each, e.g.
 * `zh-CN.json`, `en.json`), as `folium.i18n.key` makes it. Frozen. `{{name}}` in the text takes `params`.
 */
export interface FoliumTextKey {
    /** The key in the mod's locale files; dots go into nested objects (`login.title`). */
    readonly i18nKey: string;
    /** Values for the text's `{{name}}` places. */
    readonly params?: Readonly<Record<string, string | number>>;
}

/** Folium 2: `folium.i18n`, the mod's own locale files. */
export interface FoliumI18nService {
    /** A FoliumText that names `key` of the mod's locale files, with `params` for its `{{name}}` places. */
    key(key: string, params?: Record<string, string | number>): FoliumTextKey;
}

/**
 * Folium 2: a standard capability id with its version, as a source's `capabilities` names it. The host may
 * know more in later minors; `folium.sources.supports(id, version)` says what this host implements.
 */
export type FoliumSourceCapabilityId =
    | 'search@1'
    | 'songs@1'
    | 'playback.audio@1'
    | 'playback.external@1'
    | 'playback.surface@1'
    | 'reports@1'
    | 'lyrics@1'
    | 'auth@1'
    | 'library@1'
    | 'catalog@1'
    | 'recommendations@1'
    | 'explore@1'
    | 'mutations@1'
    | 'covers@1'
    | 'raw@1';

/**
 * Folium 2: what a source implements, by capability id. A standard capability the host does not know is
 * warned of once in the mod's row and left out; one it knows the id of but not at this version is left
 * out too. A custom capability is named `x.<mod id>.<name>@<version>`: the host does not read it, other
 * mods take it through `folium.omni.capability(sourceId, id)`. A capability (or a member of one) may be a
 * getter whose answer changes with the account or the system: call `handle.changed()` after it changed.
 */
export interface FoliumSourceCapabilities {
    /** Searching the source. */
    'search@1'?: FoliumSourceSearch;
    /** Songs by id, and what is known of one song. */
    'songs@1'?: FoliumSourceSongs;
    /** Audio the host plays itself, from an address. */
    'playback.audio@1'?: FoliumSourceAudioPlayback;
    /** A player of the source's own, outside the app, that the host drives and follows. */
    'playback.external@1'?: FoliumSourceExternalPlayback;
    /**
     * A picture of the source's own (a `<video>`, an embedded page) on the player page. Reserved: this
     * host does not implement it yet (`folium.sources.supports('playback.surface', 1)` is false).
     */
    'playback.surface@1'?: FoliumSourceSurfacePlayback;
    /** Telling the source what the listener played. */
    'reports@1'?: FoliumSourceReports;
    /** Lyrics of its songs, and of other songs where it can match them. */
    'lyrics@1'?: FoliumSourceLyrics;
    /** Signing in and out. */
    'auth@1'?: FoliumSourceAuth;
    /** The signed-in account's own lists. */
    'library@1'?: FoliumSourceLibrary;
    /** Albums, artists, playlists and their songs. */
    'catalog@1'?: FoliumSourceCatalog;
    /** What the source recommends to the account. */
    'recommendations@1'?: FoliumSourceRecommendations;
    /** The source's own recommendation page. */
    'explore@1'?: FoliumSourceExplore;
    /** Changes to the account: likes, playlists, saved albums. */
    'mutations@1'?: FoliumSourceMutations;
    /** How the source's cover pictures are asked for a size. */
    'covers@1'?: FoliumSourceCovers;
    /** The source's own backend endpoints, for `platform.raw`. */
    'raw@1'?: FoliumSourceRaw;
    /** A custom capability: `x.<mod id>.<name>@<version>`. */
    [custom: `x.${string}`]: unknown;
}

/** Folium 2: the letter and colour the host draws for a source (switcher, sign-in, the account avatar's corner). */
export interface FoliumSourceMark {
    /** One character. */
    letter: string;
    /** A CSS colour. */
    color: string;
}

/**
 * Folium 2: whether a source can be used now. `not-configured`: it needs something the user has to set up
 * first. `runtime-unavailable`: this system or build cannot run it.
 */
export interface FoliumSourceAvailability {
    /** False when it cannot be used now. */
    configured: boolean;
    /** Why not. */
    reason?: 'not-configured' | 'runtime-unavailable';
    /** A line on why, shown on its row. */
    message?: FoliumText;
}

/** Folium 2: what `folium.sources.register` takes. */
export interface FoliumSourceDef {
    /** The source's id in mod.json `sources[].id`; the host knows it as `FoliumSourceHandle.id`. */
    id: string;
    /** The full name: the switcher row's second line, the sign-in window. */
    displayName: FoliumText;
    /** The short name: the switcher row, the search chip. Defaults to `displayName`. */
    shortName?: FoliumText;
    /** Defaults to the short name's first character on a neutral colour. */
    mark?: FoliumSourceMark;
    /** Synchronous; asked whenever the host draws the source's rows. Without it the source is always available. */
    getAvailability?(): FoliumSourceAvailability;
    /**
     * After a request for a song's audio or a collection's songs failed: the source's own reading of `error`,
     * or null to leave it to the host's rules. Never throws.
     */
    describeFailure?(operation: 'audio' | 'collection', error: unknown): FoliumSourceFailureDetail | null;
    /** What the source implements. */
    capabilities: FoliumSourceCapabilities;
    /**
     * Item kinds besides songs (a video, say), each with its traits. Reserved for `playback.surface`: this
     * host reads none yet.
     */
    itemKinds?: Record<string, FoliumSourceItemKind>;
    /**
     * For a source with more than one way to play: which one plays `song`. Reserved for `playback.surface`:
     * this host does not ask it yet, and a source with both `playback.audio` and `playback.external` plays
     * through the external player.
     */
    routeOf?(song: FoliumSourceSong): 'audio' | 'external' | 'surface';
}

/** Folium 2: the traits of an item kind (`FoliumSourceDef.itemKinds`). Reserved: this host reads none yet. */
export interface FoliumSourceItemKind {
    /** `none`: never lyrics; `own`: only the source's own; `match`: matched like a song's. */
    lyrics?: 'none' | 'own' | 'match';
    /** It can be liked. */
    likable?: boolean;
    /** A play of it is reported to the source. */
    reported?: boolean;
}

/** Folium 2: what `folium.sources.register` returns. Frozen. */
export interface FoliumSourceHandle {
    /**
     * The id the host knows the source by, as `FoliumSong.source` names its songs: a built-in source's short
     * id, or `folium.<mod id>.<source id>`.
     */
    readonly id: string;
    /** Removes the source. Safe to call more than once; the host removes it when the mod stops anyway. */
    unregister(): void;
    /**
     * Tells the host that something it reads synchronously changed (a getter of `capabilities`, of a
     * capability, `access`, `audioQualityLevels`): it reads the source again.
     */
    changed(): void;
    /**
     * Tells the listener something unasked (a local service of the source's own that stopped, say), as the
     * app's status line. Two notices with the same `nonce` are one.
     */
    notify(notice: FoliumSourceNotice): void;
}

/** Folium 2: a notice of a source (`FoliumSourceHandle.notify`). */
export interface FoliumSourceNotice {
    /** How it is drawn. */
    type: 'error' | 'success' | 'info';
    /** What it says. */
    text: FoliumText;
    /** Two notices with the same nonce are the same notice. */
    nonce?: number;
    /** How long it stays, in milliseconds. */
    durationMs?: number;
}

/**
 * Folium 2: the codes of `folium.sources.error`, the host's own reading of a failure.
 * `auth-required`: it needs a signed-in account (or the sign-in ran out). `unsupported`: the source does not
 * do this. `not-public`: the list is private. `unavailable`: the source's service did not take the request
 * (not set up, not running, refused); never "taken down". `not-playable`: it answered without audio for the
 * song and cannot say why. `preview-only`: only a clip may play. `subscription-required`: only paying
 * accounts may. `region-restricted`: not from this region. `network`: no answer. `invalid-response`: an
 * answer the source could not read.
 */
export type FoliumSourceErrorCode =
    | 'auth-required'
    | 'unsupported'
    | 'not-public'
    | 'unavailable'
    | 'not-playable'
    | 'preview-only'
    | 'subscription-required'
    | 'region-restricted'
    | 'network'
    | 'invalid-response';

/** Folium 2: what goes with a source error (`folium.sources.error`). */
export interface FoliumSourceErrorDetails {
    /** The HTTP status of the answer that failed, apart from any code in its body. */
    httpStatus?: number;
    /** How long the source asks to wait before the next try (a 429), in milliseconds. */
    retryAfterMs?: number;
    /** What failed underneath. */
    cause?: unknown;
}

/** Folium 2: an Error made by `folium.sources.error`. */
export interface FoliumSourceError extends Error {
    /** The code it was made with. */
    readonly code: FoliumSourceErrorCode;
    /** As it was given. */
    readonly httpStatus?: number;
    /** As it was given. */
    readonly retryAfterMs?: number;
}

/**
 * Folium 2: a synchronous store of short strings in this window, for what a source reads while the host
 * draws (a session token, a device id). Kept per source id; read and written at once.
 */
export interface FoliumSourcePageStore {
    /** The value, or null. */
    get(key: string): string | null;
    /** Stores `value`; null removes it. */
    set(key: string, value: string | null): void;
    /** The keys stored. */
    keys(): string[];
}

/**
 * Folium 2: `folium.sources`, how a source mod (one with `sources` in mod.json) gives the host its sources.
 * Main window only: in the export window `register` and `pageStore` throw `sources-unavailable-in-export-context`.
 * A mod without `sources` in mod.json gets `not-a-source-mod` from them.
 */
export interface FoliumSourcesService {
    /**
     * Registers a source the manifest declares (`sources[].id`). Register before the first `await` of
     * `activate`, so that the first screen finds it. Throws for an id the manifest does not declare, a
     * second registration of one id, or a definition without capabilities. A source the user turned off
     * is not registered: the handle's `unregister` does nothing then.
     */
    register(def: FoliumSourceDef): FoliumSourceHandle;
    /** Whether this host implements capability `id` at `version` (`supports('search', 1)`). Synchronous. */
    supports(id: string, version: number): boolean;
    /** An Error with a code the host reads: throw it from a capability member. */
    error(code: FoliumSourceErrorCode, message: string, details?: FoliumSourceErrorDetails): FoliumSourceError;
    /** The synchronous store of one of this mod's sources (by the id the manifest declares, or the handle's). */
    pageStore(sourceId: string): FoliumSourcePageStore;
}

/** Folium 2: one page of a list, read by offset. */
export interface FoliumSourcePage<T> {
    /** The page, in the source's order. */
    items: T[];
    /** The whole list's length, where the source says it. */
    total?: number;
    /** There are more after this page. */
    hasMore: boolean;
    /** Where the next page starts; defaults to the offset asked plus the items given. */
    nextOffset?: number;
}

/** Folium 2: an artist or an album a song names, with where it opens in the source's catalog. */
export interface FoliumSourceNamedRef {
    /** The source's own id of the artist or album. */
    id: string;
    /** Its name. */
    name: string;
    /** It opens in `catalog@1` (an album by `getAlbumTracks`, an artist by `getArtistDetail`). Default true. */
    ref?: boolean;
}

/** Folium 2: a song's album (`FoliumSourceSong.album`). */
export interface FoliumSourceAlbumRef extends FoliumSourceNamedRef {
    /** The album's cover. */
    coverUrl?: string;
}

/** ReplayGain values of a song, in decibels and linear peaks. */
export interface FoliumSourceReplayGain {
    /** Track gain, dB. */
    trackGain?: number;
    /** Album gain, dB. */
    albumGain?: number;
    /** Track peak, a positive linear ratio. */
    trackPeak?: number;
    /** Album peak, a positive linear ratio. */
    albumPeak?: number;
}

/**
 * Folium 2: a song as a source describes it (plan §4.3). The host keeps it with its queue, history and
 * playlists, so `data` must be JSON and small; what else is stored with a song is the host's.
 */
export interface FoliumSourceSong {
    /** The song's id at the source. */
    id: string;
    /** The title. */
    title: string;
    /** The artists, in order. */
    artists: FoliumSourceNamedRef[];
    /** The album. */
    album?: FoliumSourceAlbumRef;
    /** Milliseconds. */
    durationMs?: number;
    /** The song's own cover; the album's when left out. */
    coverUrl?: string;
    /** Other titles of the song (a subtitle, a known-as). */
    aliases?: string[];
    /** The title in other languages. */
    translatedTitles?: string[];
    /** An item kind of `FoliumSourceDef.itemKinds`; a song when left out. Reserved: this host reads none yet. */
    kind?: string;
    /** Which version of the song this is (a cloud upload, a live take), where the source tells them apart. */
    variant?: string;
    /** The source marks it as instrumental. */
    pureMusic?: boolean;
    /** Its audio is a music video's. */
    video?: boolean;
    /** The ids other sources know the song by, for their lyrics: `{ '<source id>': '<the song's id there>' }`. */
    lyricIds?: Record<string, string>;
    /** What goes with the row it was read from, not with the song. */
    row?: { id?: string; listenCount?: number };
    /** Loudness values of the song. */
    replayGain?: FoliumSourceReplayGain;
    /**
     * The source's own data of the song, handed back with it. Plain JSON of at most 16 KB as JSON text: the host keeps
     * it with the song (queue, history). Data that is not JSON, or larger, is not kept at all (one warning a source in
     * the log), and the song comes back without it. Functions in it are left out, as JSON does.
     */
    data?: Record<string, FoliumJsonValue>;
}

/** Folium 2: an account at a source. */
export interface FoliumSourceUser {
    /** The source's id of the account. */
    id: string;
    /** Its name. */
    nickname: string;
    /** Its picture. */
    avatarUrl?: string;
    /** Its banner. */
    backgroundUrl?: string;
    /** The source's own membership level, where it has one. */
    vipType?: number;
}

/** Folium 2: what a radio card starts (`FoliumSourceCollection.personalFm`). */
export interface FoliumSourceFmLaunch {
    /** A mode of `getPersonalFmCatalog`. */
    mode: 'DEFAULT' | 'FAMILIAR' | 'EXPLORE' | 'SCENE_RCMD' | 'PUZZLE_MODE_RCMD';
    /** A scene, for `SCENE_RCMD` only. */
    scene: string | null;
    /** One of the source's extra radios; the personal FM when left out. */
    station?: string | null;
}

/**
 * Folium 2: a playlist, an album, an artist, or a list the source makes (`radio`, `cloud`,
 * `listening_rank`, `artist_songs`).
 */
export interface FoliumSourceCollection {
    /** The source's own id. */
    id: string;
    /** What it is. */
    type: 'playlist' | 'album' | 'artist' | 'radio' | 'cloud' | 'listening_rank' | 'artist_songs' | (string & {});
    /** Its name. */
    name: string;
    /** Its cover. */
    coverUrl?: string;
    /** The source's description. */
    description?: string;
    /** Songs in it. */
    trackCount?: number;
    /** An artist's albums. */
    albumCount?: number;
    /** The account made it. */
    isOwned?: boolean;
    /** Who made it. */
    creator?: FoliumSourceUser;
    /** An album's artists. */
    artists?: FoliumSourceNamedRef[];
    /** Other names. */
    aliases?: string[];
    /** Release time, milliseconds since the epoch. */
    publishedAt?: number;
    /** The label or publisher. */
    publisher?: string;
    /** Plays the source counts. */
    playCount?: number;
    /** Last change, milliseconds since the epoch. */
    updatedAt?: number;
    /** Last change of its songs, milliseconds since the epoch. */
    tracksUpdatedAt?: number;
    /** The account saved or liked it. */
    isLiked?: boolean;
    /** For `listening_rank`: the span it counts. */
    listeningRank?: 'week' | 'all';
    /** For `radio`: what selecting it starts. */
    personalFm?: FoliumSourceFmLaunch;
    /** The source's own data, handed back with it: plain JSON of at most 16 KB, as a song's `data` (not kept otherwise). */
    data?: Record<string, FoliumJsonValue>;
}

/** Folium 2: who is searching. Paging of one `session` does not disturb another's. */
export interface FoliumSourceSearchContext {
    /** Absent for the host's own search page. */
    session?: string;
}

/** Folium 2: whether a capability works with no one signed in (`anonymous`, the default) or only with an account. */
export type FoliumSourceAccess = 'anonymous' | 'account';

/** Folium 2: `search@1`. */
export interface FoliumSourceSearch {
    /** Whether searching needs an account; read when the host builds its search sources. May be a getter. */
    readonly access?: FoliumSourceAccess;
    /** Songs for `query`, `limit` from `offset`. */
    searchSongs(query: string, limit: number, offset: number, context?: FoliumSourceSearchContext): Promise<FoliumSourcePage<FoliumSourceSong>>;
    /** Albums (`type: 'album'`); left out where the source has no album search. */
    searchAlbums?(query: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>;
    /** Playlists (`type: 'playlist'`); left out where the source has no playlist search. */
    searchPlaylists?(query: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>;
}

/**
 * Folium 2: what a source marks against a song. `unavailable` goes with `taken-down` only; limits of
 * accounts, payment or region are `unknown` with `restricted`, found out when it is played.
 */
export interface FoliumSourceSongAvailability {
    /** What the source says. */
    state: 'playable' | 'unavailable' | 'unknown';
    /** A short tag on its row. */
    label?: FoliumText;
    /** Why. */
    reason?: 'taken-down' | 'restricted';
}

/** Folium 2: `songs@1`. */
export interface FoliumSourceSongs {
    /** Whether looking songs up needs an account. May be a getter. */
    readonly access?: FoliumSourceAccess;
    /**
     * The source can give local songs online details (the metadata match): it is searched by title and
     * artist for them, in the order the sources registered. It needs `search@1`.
     */
    readonly metadataMatch?: boolean;
    /** The song by id; null where the source has none by it. */
    getSong(id: string): Promise<FoliumSourceSong | null>;
    /** Many at once, in the order of `ids`, null for an id it has none by. A refused request rejects. */
    getSongs?(ids: string[]): Promise<(FoliumSourceSong | null)[]>;
    /** How many ids one `getSongs` takes at most; all of them when left out. */
    readonly songsPerRequest?: number;
    /** What the source marks against a song. Synchronous; asked while rows are drawn. */
    getAvailability?(song: FoliumSourceSong): FoliumSourceSongAvailability;
    /** Another version of a song that cannot play, to play in its place; null where there is none. */
    getReplacement?(song: FoliumSourceSong): Promise<{ song: FoliumSourceSong; label?: FoliumText } | null>;
    /** The song that plays in this one's place (a video's song version); null where it plays as itself. */
    getPlayedSong?(song: FoliumSourceSong): Promise<FoliumSourceSong | null>;
    /** The song's public web page; null where there is none. Synchronous. */
    getPageUrl?(song: FoliumSourceSong): string | null;
}

/** Folium 2: the quality levels, lowest first. `ultra` only for a source that lists it. */
export type FoliumSourceAudioQuality = 'standard' | 'high' | 'ultra' | 'lossless' | 'hires';

/** Folium 2: a song's audio address (`playback.audio@1`). */
export interface FoliumSourceAudio {
    /** An http(s) address the host plays. */
    url: string;
    /** When the address stops working, milliseconds since the epoch. */
    expiresAt?: number;
    /** The level it really is, where that is not the one asked for. */
    quality?: FoliumSourceAudioQuality;
    /** Loudness values that go with this file. */
    replayGain?: FoliumSourceReplayGain;
    /** It is a clip, not the whole song: it plays with a notice and is never kept. */
    preview?: boolean;
    /** Where the clip starts in the song, milliseconds. */
    clipStartMs?: number;
}

/** Folium 2: `playback.audio@1`. */
export interface FoliumSourceAudioPlayback {
    /** The address of `song` at `quality` (one of `audioQualityLevels`); null when there is none and nothing to say. */
    getAudioSource(song: FoliumSourceSong, quality: FoliumSourceAudioQuality): Promise<FoliumSourceAudio | null>;
    /** The levels the source tells apart, lowest first; all but `ultra` when left out. May be a getter. */
    readonly audioQualityLevels?: readonly FoliumSourceAudioQuality[];
    /** What the notice says while a clip of this source plays; the host's own words when left out. */
    readonly previewNotice?: FoliumText;
    /** For a source that keeps audio in a cache of its own: keep the file `url` plays; resolves to whether it is kept. */
    keepAudio?(url: string): Promise<boolean>;
    /** Whether that cache holds the file `url` plays. */
    hasKeptAudio?(url: string): Promise<boolean>;
}

/** Folium 2: what an external player has loaded (`playback.external@1`). */
export interface FoliumSourceExternalStatus {
    /** The id the source gave the player. */
    mediaId: string;
    /** It is playing. */
    isPlaying: boolean;
    /** Milliseconds. */
    positionMs: number;
    /** Milliseconds. */
    durationMs: number;
    /** The player says the track ran out. */
    ended: boolean;
    /** A live broadcast: no timeline, no end. */
    live?: boolean;
    /** A seek the player made itself. */
    seeking?: boolean;
    /** It accepted a start and is still buffering. */
    starting?: boolean;
}

/** Folium 2: `playback.external@1`, a player of the source's own that the host drives and follows. */
export interface FoliumSourceExternalPlayback {
    /** False for a song it knows it cannot start. Synchronous, no request. */
    canPlay?(song: FoliumSourceSong): boolean;
    /** Prepares what follows without interrupting the song now. */
    prepareNext?(song: FoliumSourceSong, upcoming: FoliumSourceSong[]): Promise<void>;
    /** Whether a prepared successor is there for `song`. Synchronous. */
    isPrepared?(song: FoliumSourceSong): boolean;
    /** Starts `song` at `startSec`; resolves once started. */
    play(song: FoliumSourceSong, startSec: number): Promise<void>;
    /** The player already has `song` (from a window that is gone): take it as the current one. Synchronous. */
    adopt?(song: FoliumSourceSong): void;
    /** Pauses. */
    pause(): Promise<void>;
    /** Resumes. */
    resume(): Promise<void>;
    /** Seeks, seconds. */
    seek(seconds: number): Promise<void>;
    /** The player's own level, 0 to 1. */
    setVolume?(volume: number): Promise<void>;
    /** The player's own single-track repeat. */
    setRepeatOne?(enabled: boolean): Promise<void>;
    /** The player's state now, from no cache. */
    getStatus(song: FoliumSourceSong): Promise<FoliumSourceExternalStatus>;
    /** Whether the player's loaded track is `song`. Synchronous; asked twice a second. */
    isStatusForSong(song: FoliumSourceSong, status: FoliumSourceExternalStatus): boolean;
}

/**
 * Folium 2: `playback.surface@1`. Reserved: the host does not implement it yet. It will be the external
 * player's members plus `mount`, which puts the source's picture into a container on the player page.
 */
export interface FoliumSourceSurfacePlayback extends FoliumSourceExternalPlayback {
    /** Puts the picture into `container`; returns what takes it out. */
    mount(container: HTMLElement, context: { readonly song: FoliumSourceSong }): FoliumDisposer;
}

/** Folium 2: one finished listening report. `playedSeconds` is time really played, never a position. */
export interface FoliumSourcePlaybackReport {
    /** Seconds played, at most `totalSeconds`. */
    playedSeconds: number;
    /** The track's length. */
    totalSeconds?: number;
    /** The level it played at. */
    quality?: FoliumSourceAudioQuality;
}

/** Folium 2: `reports@1`. */
export interface FoliumSourceReports {
    /** Whether a play of `song` can be reported at all. Synchronous. */
    canReport?(song: FoliumSourceSong): boolean;
    /** Reports a play. */
    report(song: FoliumSourceSong, report: FoliumSourcePlaybackReport): Promise<void>;
}

/**
 * Folium 2: the lyric formats of a source's tracks: those of `folium.lyrics.parse` (FoliumLyricFormat), and
 * `folia`, a Folia lyric document (`.fia`).
 */
export type FoliumSourceLyricFormat = 'lrc' | 'enhanced-lrc' | 'yrc' | 'qrc' | 'krc' | 'ttml' | 'vtt' | 'awlrc' | 'folia';

/**
 * Folium 2: one lyric track in its raw text. The host parses it as its format says, as a platform's lyrics
 * (no local-file sniffing, no combined timelines). Each text is at most 1,048,576 characters.
 */
export interface FoliumSourceLyricsTrack {
    /** How to read `text`. */
    format: FoliumSourceLyricFormat;
    /** The raw document. */
    text: string;
    /** Translation lines, matched to the lines by start time. Ignored for `ttml` and `folia`. */
    translationText?: string;
    /** The format of `translationText`: `lrc` when left out, or `krc`. */
    translationFormat?: 'lrc' | 'krc';
    /** Romanization lines, matched like the translation. */
    romanizationText?: string;
    /** The format of `romanizationText`: `lrc` when left out, or `krc`. */
    romanizationFormat?: 'lrc' | 'krc';
}

/**
 * Folium 2: a song's lyrics as a source gives them. With both tracks the host shows `wordByWord` and falls
 * back to `main`; a `wordByWord` track without its own translation or romanization borrows `main`'s.
 * `isPureMusic` may come with tracks: the host keeps both.
 */
export interface FoliumSourceLyricsResult {
    /** Line-timed lyrics. */
    main?: FoliumSourceLyricsTrack;
    /** Word-timed lyrics. */
    wordByWord?: FoliumSourceLyricsTrack;
    /** The source marks the song as instrumental. */
    isPureMusic?: boolean;
    /** Chorus spans in seconds; without them the host finds choruses itself. At most 64. */
    chorusRanges?: Array<{ startTime: number; endTime: number }>;
}

/** Folium 2: another title and artist of the same song, for matching lyrics elsewhere. */
export interface FoliumSourceLyricAlias {
    /** The title. */
    title: string;
    /** The artist. */
    artist: string;
    /** The album. */
    album?: string;
}

/** Folium 2: `lyrics@1`. */
export interface FoliumSourceLyrics {
    /** Whether lyrics need an account. May be a getter. */
    readonly access?: FoliumSourceAccess;
    /**
     * The source can give lyrics to other sources' songs and to local songs: it is a lyric source of the
     * match windows and the automatic pick (searched through `search@1`). `linesOnly`: its lyrics are
     * timed by line only and carry no chorus.
     */
    readonly crossSource?: { readonly linesOnly?: boolean };
    /** The lyrics of one of its songs; `context.userId` is the signed-in account's id, where there is one. */
    getLyrics(song: FoliumSourceSong, context?: { userId?: string | null }): Promise<FoliumSourceLyricsResult | null>;
    /** Its own word timing is the one to keep over another source's. */
    readonly prefersOwnWordByWord?: boolean;
    /** The chorus spans of a song by id, seconds. */
    getChorusRanges?(songId: string): Promise<Array<{ startTime: number; endTime: number }>>;
    /** Another title and artist of the same song; null where there are none. */
    getSearchAlias?(song: FoliumSourceSong): Promise<FoliumSourceLyricAlias | null>;
    /** Another name the song's artist goes by elsewhere; null where there is none. */
    getAlternateArtistName?(song: FoliumSourceSong): Promise<string | null>;
}

/** Folium 2: the cases a failed sign-in can be (the host's own table says what each shows). */
export type FoliumSourceLoginCase =
    | 'code-expired' | 'expired-after-scan' | 'browser-unfinished' | 'not-authorized'
    | 'unreachable' | 'no-answer'
    | 'refused' | 'retry-later' | 'device-limit' | 'wrong-scan-app'
    | 'local-service-stopped' | 'local-service-unavailable' | 'cannot-listen'
    | 'no-browser' | 'browser-still-open' | 'browser-closed-early' | 'browser-unread' | 'browser-not-opened'
    | 'account-not-read'
    | 'unknown';

/** Folium 2: what a source knows of a failed sign-in step. Nothing private: no cookie, token, IP or account. */
export interface FoliumSourceLoginFailure {
    /** The case, where the source can name it; the host's rules sort the rest. */
    case?: FoliumSourceLoginCase;
    /** The platform's own code. */
    code?: string;
    /** The platform's own words. */
    message?: string;
    /** HTTP status. */
    httpStatus?: number;
    /** A code the platform passes on. */
    upstreamCode?: string;
    /** How long to wait before trying again. */
    retryAfterMs?: number;
}

/** Folium 2: the cases a failed audio or collection request can be. */
export type FoliumSourceFailureCase =
    | 'unreachable' | 'local-service-stopped' | 'retry-later'
    | 'sign-in-needed' | 'account-refused' | 'subscription-required' | 'purchase-required' | 'entitlement-required'
    | 'preview-only' | 'region-restricted' | 'not-configured'
    | 'taken-down' | 'no-audio' | 'audio-unplayable' | 'not-public'
    | 'refused' | 'unknown';

/** Folium 2: what a source knows of a failed audio or collection request (`describeFailure`). Nothing private. */
export interface FoliumSourceFailureDetail {
    /** The case, where the source can name it. */
    case?: FoliumSourceFailureCase;
    /** The platform's own code. */
    code?: string;
    /** The platform's own words. */
    message?: string;
    /** HTTP status. */
    httpStatus?: number;
    /** A code the platform passes on. */
    upstreamCode?: string;
    /** How long to wait. */
    retryAfterMs?: number;
    /** What may be behind it, where the answer hints. */
    likelyCause?: 'sign-in' | 'subscription' | 'region';
    /** No account was signed in when it was asked. */
    signedOut?: boolean;
}

/** Folium 2: where a sign-in is (`auth@1.checkLogin`). */
export type FoliumSourceLoginState =
    | { state: 'waiting' }
    | { state: 'scanned' }
    | { state: 'confirmed' }
    | { state: 'expired'; failure?: FoliumSourceLoginFailure }
    | { state: 'error'; message?: string; failure?: FoliumSourceLoginFailure; transient?: boolean };

/** Folium 2: a step of a sign-in, as `describeLoginFailure` is told it. */
export type FoliumSourceLoginStep = 'start' | 'open' | 'wait' | 'check' | 'account' | 'form';

/** Folium 2: one way to sign in (`auth@1.getLoginMethods`). */
export interface FoliumSourceLoginMethod {
    /** Handed back to `startLogin`. */
    id: string;
    /** Its name. */
    label: FoliumText;
    /** A picture in the mod's folder (`assets/login.svg`) or an https or data URL. */
    icon?: string;
    /** A line on what it is. */
    note?: FoliumText;
    /** The one chosen at first. */
    preferred?: boolean;
}

/** Folium 2: the sign-in window's own words for a source. */
export interface FoliumSourceLoginTexts {
    /** The title. */
    title: FoliumText;
    /** The line under it. */
    note: FoliumText;
    /** A line a failure case has on this source only. */
    caseNotes?: Partial<Record<FoliumSourceLoginCase, FoliumText>>;
}

/** Folium 2: a form to sign in with (accounts with a password). */
export interface FoliumSourceLoginForm {
    /** The fields, in order. */
    fields: Array<{ key: string; type: 'text' | 'password' | 'url'; label?: FoliumText; placeholder?: FoliumText; required?: boolean }>;
    /** The button. */
    submitLabel?: FoliumText;
    /** A line under the form. */
    note?: FoliumText;
    /** What a failure shows, by error code (`network`, `auth-required`, …). */
    errors?: Record<string, FoliumText>;
}

/** Folium 2: a local service the sign-in needs, which the sign-in window can restart. */
export interface FoliumSourceLocalService {
    /** Calls `listener` on every change; returns what stops it. */
    subscribe(listener: () => void): FoliumDisposer;
    /** Its state; the same object between two changes. */
    getStatus(): { failed: boolean; error: string | null; restarting: boolean };
    /** Restarts it; resolves true when it runs again. */
    restart(): Promise<boolean>;
}

/** Folium 2: a step of a source's setup list (`auth@1.getSetup`). */
export interface FoliumSourceSetupStep {
    /** Its id. */
    id: string;
    /** What it is. */
    title: FoliumText;
    /** A line on it. */
    note?: FoliumText;
    /** Where it stands. */
    state: 'done' | 'todo' | 'warn' | 'error';
    /** A fact shown as it is (a path, a version). */
    detail?: string;
    /** A password box; `saved`: one is stored. */
    secret?: { label: FoliumText; saved: boolean };
    /** What can be done. */
    actions?: Array<{ id: string; label: FoliumText; kind: 'link' | 'run' | 'pick-file' | 'submit-secret'; primary?: boolean }>;
}

/** Folium 2: what a user has to do before a source works (a program to install, a key to fill in). */
export interface FoliumSourceSetupView {
    /** The title. */
    title: FoliumText;
    /** A line under it. */
    note?: FoliumText;
    /** The steps. */
    steps: FoliumSourceSetupStep[];
    /** Every step is done. */
    complete: boolean;
    /** What the source says to the action just done. */
    message?: { text: FoliumText; tone: 'ok' | 'warn' | 'error' };
}

/** Folium 2: a line of a sign-in diagnostic report. The host cleans it; nothing private. */
export interface FoliumSourceDiagnosticLine {
    /** What it is. */
    label: string;
    /** Its value. */
    value: string | number | boolean | null;
}

/** Folium 2: what a source's self-check found (`auth@1.runLoginSelfCheck`), as JSON the host reports. */
export interface FoliumSourceSelfCheck {
    /** `electron` or `web`. */
    runtime: 'electron' | 'web';
    /** When it started, milliseconds since the epoch. */
    startedAt: number;
    /** How long it took. */
    durationMs: number;
    /** The source's backend, where it has one. */
    backend: FoliumJsonValue;
    /** The proxy it found. */
    proxy: FoliumJsonValue;
    /** The hosts it checked. */
    hosts: FoliumJsonValue[];
    /** The credential store, where its sign-in needs one. */
    credentialStore?: FoliumJsonValue;
    /** The sign-in is kept encrypted. */
    keepsSignInEncrypted?: boolean;
}

/** Folium 2: what an older build kept of the account (`auth@1.oldKeptAccount`). */
export interface FoliumSourceKeptAccount {
    /** The account. */
    user: FoliumSourceUser;
    /** Its lists. */
    collections: FoliumSourceCollection[];
    /** Its liked songs. */
    likedSongIds: string[];
}

/** Folium 2: `auth@1`. Every member but the first two is optional. */
export interface FoliumSourceAuth {
    /** Who is signed in; null for nobody. */
    getLoginStatus(): Promise<FoliumSourceUser | null>;
    /** Signs out. The host stops showing the account as soon as this is called. */
    logout(): Promise<void>;
    /** The source names nobody, or refuses the sign-in: drop what is kept of it. */
    signInRanOut?(): void | Promise<void>;
    /** The kept account shows at once at start while the source is asked. */
    readonly showsKeptAccountAtStart?: boolean;
    /** What an older build kept of the account, where no snapshot is there; null for nothing. */
    oldKeptAccount?(): Promise<FoliumSourceKeptAccount | null>;
    /** That has been saved as the snapshot: remove the old copies. Never rejects. */
    forgetOldKeptAccount?(): Promise<void>;
    /** The sign-in window's words. Synchronous. */
    getLoginTexts?(): FoliumSourceLoginTexts;
    /** A local service the sign-in needs. */
    readonly localService?: FoliumSourceLocalService;
    /** The ways to sign in, where there are several. Synchronous. */
    getLoginMethods?(): FoliumSourceLoginMethod[];
    /** The same, where finding them out takes a request. */
    resolveLoginMethods?(): Promise<FoliumSourceLoginMethod[]>;
    /** Starts a sign-in; resolves to its key. */
    startLogin?(methodId?: string): Promise<string>;
    /** A form to sign in with, instead of a code. Synchronous. */
    getLoginForm?(): FoliumSourceLoginForm;
    /** Signs in with the form's values. */
    submitLoginForm?(values: Record<string, string>): Promise<unknown>;
    /** The source's reading of a failed step; null to leave it to the host. Never throws. */
    describeLoginFailure?(step: FoliumSourceLoginStep, error: unknown): FoliumSourceLoginFailure | null;
    /** The picture of a sign-in code (a URL or a data URL). */
    createQr?(key: string): Promise<string>;
    /** Opens the sign-in page in the browser, instead of a code. */
    openLoginPage?(key: string): Promise<void>;
    /** The source opened that page itself and cannot open it again. Synchronous. */
    opensLoginPageItself?(key: string): boolean;
    /** Where the sign-in stands. */
    checkLogin?(key: string): Promise<FoliumSourceLoginState>;
    /** Drops the sign-in of `key`; any key, known or not. */
    cancelLogin?(key: string): Promise<void>;
    /** How long a sign-in stays open, milliseconds. Synchronous. */
    getLoginTtlMs?(): number;
    /** Lines for the diagnostic report of a failed sign-in. */
    getLoginDiagnostics?(): Promise<FoliumSourceDiagnosticLine[]>;
    /** Whether a self-check can run now. Synchronous. */
    canRunLoginSelfCheck?(): boolean;
    /** Checks the source's network path. */
    runLoginSelfCheck?(): Promise<FoliumSourceSelfCheck | null>;
    /** After the sign-in: whether the account can be used, as a setup list; null for nothing to do. */
    checkAfterLogin?(methodId: string | null): Promise<FoliumSourceSetupView | null>;
    /** The source's setup list now; null for nothing to set up. */
    getSetup?(): Promise<FoliumSourceSetupView | null>;
    /** Does one action of the list; resolves to the list after it. Failures go in the list, not a rejection. */
    runSetupAction?(stepId: string, actionId: string, value?: string): Promise<FoliumSourceSetupView>;
}

/** Folium 2: `library@1`, the signed-in account's lists. `userId` is the signed-in account's. */
export interface FoliumSourceLibrary {
    /** One id a song is liked under, where the source's ids of one song differ. Synchronous. */
    getSongLikeId?(song: FoliumSourceSong): string;
    /** The account's playlists. */
    getUserPlaylists(userId: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>;
    /** Every liked song's id; `whole` false where it cannot be sure it read to the end. */
    getLikedSongIds?(userId: string): Promise<{ ids: string[]; whole: boolean }>;
    /** How many songs the liked list holds, as the source counts; null where it does not say. */
    getLikedSongCount?(userId: string): Promise<number | null>;
    /** Whether each song is liked, by id; one the source says nothing of is left out. */
    areSongsLiked?(ids: string[]): Promise<Record<string, boolean>>;
    /** The account's saved albums. */
    getUserAlbums?(userId: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>;
    /** The entry of the account's cloud songs (`type: 'cloud'`); null where it has none. */
    getCloudCollection?(user?: FoliumSourceUser): Promise<FoliumSourceCollection | null>;
    /** The entries of the account's listening ranking (`type: 'listening_rank'`), one a span. */
    getListeningRankCollections?(user: FoliumSourceUser): Promise<FoliumSourceCollection[]>;
}

/** Folium 2: `catalog@1`. `collection` is the entry as the host has it, where it has one. */
export interface FoliumSourceCatalog {
    /** Whether `resolveSongCatalogRefs` can fill in where `song`'s album and artists open. Synchronous. */
    canResolveSongCatalogRefs?(song: FoliumSourceSong): boolean;
    /** `song` with its album's and artists' ids filled in. */
    resolveSongCatalogRefs?(song: FoliumSourceSong): Promise<FoliumSourceSong>;
    /** A playlist's songs. */
    getPlaylistTracks?(id: string, limit: number, offset: number, collection?: FoliumSourceCollection): Promise<FoliumSourcePage<FoliumSourceSong>>;
    /** A playlist's details. */
    getPlaylistDetail?(id: string, collection?: FoliumSourceCollection): Promise<FoliumSourceCollection | null>;
    /** The cloud songs. */
    getCloudTracks?(limit: number, offset: number, collection?: FoliumSourceCollection): Promise<FoliumSourcePage<FoliumSourceSong>>;
    /** The ranking's songs, each with `row.listenCount` where the source gives one. */
    getListeningRankTracks?(range: 'week' | 'all', limit: number, offset: number, collection?: FoliumSourceCollection): Promise<FoliumSourcePage<FoliumSourceSong>>;
    /** An album's songs. */
    getAlbumTracks?(id: string, limit?: number, offset?: number, collection?: FoliumSourceCollection): Promise<FoliumSourcePage<FoliumSourceSong>>;
    /** An album's details. */
    getAlbumDetail?(id: string, collection?: FoliumSourceCollection): Promise<FoliumSourceCollection | null>;
    /** An artist's songs. */
    getArtistSongs?(id: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>>;
    /** An artist's albums. */
    getArtistAlbums?(id: string, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceCollection>>;
    /** An artist's details. */
    getArtistDetail?(id: string): Promise<FoliumSourceCollection | null>;
    /** Whether the account saved this playlist or album. */
    getSubscriptionStatus?(type: 'playlist' | 'album', id: string, collection?: FoliumSourceCollection): Promise<boolean>;
}

/** Folium 2: the modes and scenes a personal FM offers (`recommendations@1.getPersonalFmCatalog`). */
export interface FoliumSourceFmCatalog {
    /** The radio's own name, for an extra radio. */
    name?: FoliumText;
    /** The modes. */
    modes: Array<{ id: FoliumSourceFmLaunch['mode']; label: FoliumText; keywords?: string[] }>;
    /** The scenes of `SCENE_RCMD`. */
    scenes: Array<{ id: string; category: string; label: FoliumText; keywords?: string[] }>;
    /** The scene categories. */
    categories: Array<{ id: string; label: FoliumText }>;
}

/** Folium 2: one recommendation preference: a choice among options, or a number on a scale. */
export type FoliumSourcePreference =
    | { kind: 'choice'; key: string; label: FoliumText; options: Array<{ value: string; label: FoliumText }>; value: string; defaultValue: string }
    | { kind: 'ratio'; key: string; label: FoliumText; min: number; max: number; defaultValue: number; snapWithin?: number; value: number };

/** Folium 2: the account's recommendation preferences. */
export interface FoliumSourcePreferences {
    /** The preferences; a kind the host does not know is passed over. */
    items: FoliumSourcePreference[];
    /** A line on what they reach. */
    note?: FoliumText;
}

/** Folium 2: `recommendations@1`. */
export interface FoliumSourceRecommendations {
    /** The personal FM takes a mode and a scene (`getPersonalFm`'s options). */
    readonly personalFmModes?: boolean;
    /** The modes of the personal FM, or of the extra radio `station`. */
    getPersonalFmCatalog?(station?: string): Promise<FoliumSourceFmCatalog>;
    /** Today's songs. */
    getDailySongs?(refresh?: boolean): Promise<FoliumSourceSong[]>;
    /** The next songs of the personal FM. */
    getPersonalFm?(options?: { mode?: string; submode?: string | null; station?: string | null }): Promise<FoliumSourceSong[]>;
    /** Lists it recommends. */
    getRecommendedCollections?(limit: number): Promise<FoliumSourceCollection[]>;
    /** The days of earlier recommendations, as entries. */
    getHistoryEntries?(): Promise<Array<{ id: string; label: string; data?: Record<string, FoliumJsonValue> }>>;
    /** The days of earlier recommendations. */
    getHistoryDates?(): Promise<string[]>;
    /** The songs of one earlier day. */
    getHistorySongs?(entry: { id: string; label: string; data?: Record<string, FoliumJsonValue> } | string): Promise<FoliumSourceSong[]>;
    /** Takes a song out of the recommendations; `removed`: with no replacement. */
    dislikeSong?(id: string): Promise<{ replacement?: FoliumSourceSong; limitReached?: boolean; removed?: boolean }>;
    /** The style groups today's songs can be narrowed to. */
    getDailyStyleGroups?(): Promise<Array<{ id: string; name: string; tags: Array<{ id: string; name: string }> }>>;
    /** Today's songs of the picked styles. */
    getDailyStyleSongs?(): Promise<{ songs: FoliumSourceSong[]; selection: { groupId: string; tagIds: string[] } | null }>;
    /** Picks styles. */
    setDailyStyle?(selection: { groupId: string; tagIds: string[] }): Promise<void>;
    /** Where the host offers the preferences. */
    readonly preferenceEntries?: readonly ('explore' | 'personal-fm' | 'daily')[];
    /** The preferences. */
    getRecommendationPreferences?(): Promise<FoliumSourcePreferences>;
    /** Saves what changed; `confirmed` false when it read back something else. */
    saveRecommendationPreferences?(changes: Record<string, string | number>): Promise<{ confirmed: boolean }>;
}

/** Folium 2: one entry of a recommendation page. */
export type FoliumSourceExploreItem =
    | { kind: 'song'; song: FoliumSourceSong; wideCoverUrl?: string; subtitle?: string }
    | { kind: 'collection'; collection: FoliumSourceCollection; wideCoverUrl?: string; isMix?: boolean; subtitle?: string };

/** Folium 2: a section of a recommendation page. */
export interface FoliumSourceExploreSection {
    /** Its id. */
    id: string;
    /** Its heading, in the source's language. */
    title: string;
    /** Its entries. */
    items: FoliumSourceExploreItem[];
    /** Where its further entries are (`getSectionItems`). */
    moreCursor?: string;
    /** Made up anew for every read. */
    changesWithRead?: boolean;
}

/** Folium 2: a recommendation page. */
export interface FoliumSourceExplorePage {
    /** The sections. */
    sections: FoliumSourceExploreSection[];
    /** Where its further sections are. */
    nextCursor?: string;
    /** "Refresh" reads the page anew. */
    refreshReadsAnew?: boolean;
}

/** Folium 2: `explore@1`, the source's own recommendation page. */
export interface FoliumSourceExplore {
    /** The page, or its further sections from `cursor`; `listened` are songs of the source played here. */
    getFeed(cursor?: string, listened?: FoliumSourceSong[]): Promise<FoliumSourceExplorePage>;
    /** A section's further entries. */
    getSectionItems?(cursor: string): Promise<{ items: FoliumSourceExploreItem[]; moreCursor?: string }>;
    /** Of songs played here, which song the source shows each as, by id; null for itself. */
    songsShownAs?(songs: FoliumSourceSong[]): Promise<Record<string, FoliumSourceSong | null>>;
}

/** Folium 2: `mutations@1`. A song or a list is given as the DTO, or as its id alone. */
export interface FoliumSourceMutations {
    /** Whether songs can be added to `playlist`. Synchronous. */
    canAddToPlaylist?(playlist: FoliumSourceCollection): boolean;
    /** Whether `playlist`'s songs can be edited. Synchronous. */
    canEditPlaylistTracks?(playlist: FoliumSourceCollection): boolean;
    /** Likes or unlikes a song. */
    likeSong?(song: string | FoliumSourceSong, liked: boolean): Promise<void>;
    /** Adds songs to a playlist, or removes them. */
    updatePlaylistTracks?(operation: 'add' | 'del', playlist: string | FoliumSourceCollection, tracks: Array<string | FoliumSourceSong>): Promise<void>;
    /** Makes an empty playlist. */
    createPlaylist?(name: string): Promise<FoliumSourceCollection>;
    /** Whether `collection` can be saved. Synchronous. */
    canSubscribe?(collection: FoliumSourceCollection): boolean;
    /** Saves or drops a playlist. */
    subscribePlaylist?(playlist: string | FoliumSourceCollection, subscribed: boolean): Promise<void>;
    /** Saves or drops an album. */
    subscribeAlbum?(id: string, subscribed: boolean): Promise<void>;
}

/**
 * Folium 2: `covers@1`, how a source's cover pictures are asked for a size. Each member is synchronous and
 * runs while covers are drawn: answer null at once for a URL that is not the source's. `url` is shared
 * with the other rules: change it only when you answer.
 */
export interface FoliumSourceCovers {
    /**
     * The hosts of the picture URLs this source knows: a host name (`img1.example.com`), or `*.` before a domain
     * for every host under it (`*.example.com`; not `example.com` itself). The host asks the members below only about
     * URLs on these hosts, and hands each call a URL of its own to change. A rule asked about every picture (another
     * source's, a media server's, a local one) is the host's alone.
     */
    readonly hosts: readonly string[];
    /** The `size`-pixel variant of `url`. */
    sized(url: URL, size: number): string | null;
    /** What names the picture apart from how it is fetched; two URLs of one picture give one value. */
    identity(url: URL): string | null;
    /** The original picture. */
    original?(url: URL): string | null;
    /** The size `url` asks for; null where it asks for none, undefined where it is not the source's. */
    requestedSize?(url: URL): number | null | undefined;
}

/** Folium 2: a row of a source's endpoint table (`raw@1`). */
export interface FoliumSourceRawEndpoint {
    /** `read`, `write` (changes the account), or `denied`. */
    access: 'read' | 'write' | 'denied';
    /** The omni method that already does it. */
    omni?: string;
    /** The parameter that names the signed-in user; the host fills it in. */
    selfParam?: string;
}

/**
 * Folium 2: `raw@1`, the source's own backend endpoints for `platform.raw`. The host checks the caller's
 * permissions against the table and strips credentials from the answer; the source adds its session.
 */
export interface FoliumSourceRaw {
    /** The backend library, name and version. */
    readonly backend: { name: string; version: string };
    /** Parameters the host sets and callers cannot. */
    readonly reservedParams: readonly string[];
    /** The source's own credential field names, stripped from answers. */
    readonly credentialFields?: readonly string[];
    /** The row of `endpoint`; null for one not in the table. */
    describeEndpoint(endpoint: string): FoliumSourceRawEndpoint | null;
    /** A problem with the values; null for none. */
    checkParams?(endpoint: string, params: Record<string, FoliumJsonValue>): string | null;
    /** The raw answer. Stops when `signal` aborts. */
    request(endpoint: string, params: Record<string, FoliumJsonValue>, signal: AbortSignal): Promise<unknown>;
}

// ---------------------------------------------------------------- Main API

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
    /** Folium 2: the sources a source mod provides (`id`, `name`, `requires`, …), or null for an ordinary mod. */
    readonly sources?: readonly Readonly<Record<string, unknown>>[] | null;
    /** Folium 2: the folder of the mod's locale files, or null. */
    readonly locales?: string | null;
    /** Folium 2: the folder of the mod's pictures and other assets, or null. */
    readonly assets?: string | null;
    /** Folium 2: the secret slots a source mod keeps outside settings fields, or null. */
    readonly secrets?: readonly string[] | null;
    /** Folium 2: where the client runs (`main`, `export`), or null for everywhere. */
    readonly contexts?: readonly string[] | null;
    /** Folium 2: native files of the app a built-in source uses, or null. */
    readonly native?: readonly string[] | null;
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

// ---------------------------------------------------------------- Source main API
// 预览：Folium 2 的音源接口（folium.sources 与音源类模组 main 入口的 api）还是预览版，九个内置音源全部迁过去之前
// 可能变动；用它写的模组可能要随新版本更新。folium: 1 冻结在 Folium 1.9 的接口不受影响。

/**
 * Folium 2: the main entry's `api` of a source mod (one with `sources` in mod.json, plan §5.5): FoliumMainApi and
 * the members below, which an ordinary mod's `api` does not have. A source mod also needs no `filesystem.data` for
 * `api.storage` (16 MB instead of 1 MB) and keeps the secret slots its manifest's `secrets` names (64 KB each).
 * Everything it registers here goes when the mod stops.
 */
export interface FoliumSourceMainApi extends FoliumMainApi {
    /** Electron `net`: binary, streamed, no answer cap and no time limit of the host's. */
    readonly net: FoliumSourceNet;
    /**
     * A built-in source's old data, by the names its row of the host's trusted table (or its manifest `claims`,
     * when it takes over a source the installation does not carry) lists. Any other key throws
     * `legacy-key-not-claimed:<key>`.
     */
    readonly legacy: { readonly store: FoliumSourceLegacyStore };
    /** The paths of FoliumMainApi, and the userData folder a source's row or claims name. */
    readonly paths: FoliumSourceMainPaths;
    /** Sealing with the system's credential store (Electron safeStorage). */
    readonly seal: FoliumSourceSeal;
    /** The source's cache folder, counted in the host's cache budget. */
    readonly cache: FoliumSourceCache;
    /** Cross-origin rules and streams for the source's media. */
    readonly media: FoliumSourceMedia;
    /** Hidden windows, and whether the main window is there. */
    readonly windows: FoliumSourceWindows;
    /** Opens an http(s) address in the system's browser. */
    readonly shell: { openExternal(url: string): Promise<void> };
    /** A file the user picks, or null. */
    readonly dialog: { pickFile(options?: { filters?: Array<{ name: string; extensions: string[] }>; defaultPath?: string }): Promise<string | null> };
    /** The host's versions, and its UI language now (`zh-CN`, `en`, …). */
    readonly host: FoliumSourceHostInfo;
    /** Waited for (3 seconds at most) before the source is unloaded; its songs' playback has stopped by then. */
    onBeforeUnload(handler: () => void | Promise<void>): FoliumDisposer;
    /** Waited for (3 seconds at most) when the app quits. */
    onBeforeQuit(handler: () => void | Promise<void>): FoliumDisposer;
    /** The main window went and no window takes its playback over: pause what plays outside the app. */
    onPlayersOrphaned(handler: () => void): FoliumDisposer;
    /** The sign-in diagnostics and self-check of one of the mod's own sources. */
    readonly diagnostics: FoliumSourceDiagnostics;
    /** Native files the app ships for a built-in source, by the names its manifest `native` and its row both list. */
    readonly native: FoliumSourceNative;
    /** An error the source could not handle: into the host's crash report, without telling the user. */
    reportError(error: unknown, where?: string): void;
}

/** Folium 2: `api.host` of a source mod. */
export interface FoliumSourceHostInfo extends FoliumHostInfo {
    /** The host's UI language now. */
    readonly locale: string;
}

/** Folium 2: `api.paths` of a source mod. */
export interface FoliumSourceMainPaths extends FoliumMainPaths {
    /** `<userData>/<name>`, for a folder the source's row or claims name; any other throws `legacy-folder-not-claimed:<name>`. */
    legacy(name: string): string;
}

/** Folium 2: `api.diagnostics` of a source mod. */
export interface FoliumSourceDiagnostics {
    /**
     * `backend` has `getDiagnostics()`, and may have `getStatus()` and `selfCheckHosts`; `sourceId` is one of the
     * mod's sources, as the host knows it. Returns what takes it out.
     */
    register(sourceId: string, backend: { getDiagnostics(): unknown; getStatus?(): unknown; selfCheckHosts?: readonly string[] }): FoliumDisposer;
}

/** Folium 2: `api.native` of a source mod. */
export interface FoliumSourceNative {
    /** The file's path; throws `native-not-granted:<name>` or `native-unavailable:<name>`. */
    path(name: string): string;
    /** `require` of that path. */
    load(name: string): unknown;
}

/** Folium 2: `api.net` of a source mod. */
export interface FoliumSourceNet {
    /** A web `fetch` through Electron `net`; `init.session` names a partition (see `session`). Answers a web Response. */
    fetch(url: string, init?: Record<string, unknown>): Promise<Response>;
    /**
     * Electron's `net.request` (a ClientRequest), for a request a web `fetch` cannot make: a GET with a body.
     * `options` is Electron's (`url`, `method`, `redirect`, …); `options.session` names a partition (see `session`).
     */
    request(options: FoliumSourceRequestOptions): FoliumSourceClientRequest;
    /**
     * A partition of the source's own (`persist:folium.<mod id>.<name>`), or one its row or claims name: lower case
     * letters, digits and `-`.
     */
    session(name: string): FoliumSourceNetSession;
    /** The system proxy for `url`, as Chromium resolves it. */
    resolveProxy(url: string): Promise<string>;
}

/** Folium 2: one partition of a source mod (`api.net.session`). */
export interface FoliumSourceNetSession {
    /** The partition's name. */
    readonly partition: string;
    /** `fetch` in this partition. */
    fetch(url: string, init?: Record<string, unknown>): Promise<Response>;
    /** `request` in this partition. */
    request(options: FoliumSourceRequestOptions): FoliumSourceClientRequest;
    /** The proxy for `url` in this partition. */
    resolveProxy(url: string): Promise<string>;
    /** Electron's `session.setProxy`. */
    setProxy(config: Record<string, unknown>): Promise<void>;
    /** Electron's `session.clearStorageData`. */
    clearStorageData(options?: Record<string, unknown>): Promise<void>;
}

/** Folium 2: what `api.net.request` takes: Electron's `net.request` options. */
export interface FoliumSourceRequestOptions {
    /** An http(s) address. */
    url: string;
    /** `GET` when left out. */
    method?: string;
    /** `follow` (the default), `error` or `manual`. */
    redirect?: 'follow' | 'error' | 'manual';
    /** A partition, named as for `api.net.session`; the default session when left out. */
    session?: string;
    /** Electron's other options. */
    [option: string]: unknown;
}

/** Folium 2: the answer of `api.net.request`, Electron's IncomingMessage (the members a source reads). */
export interface FoliumSourceIncomingMessage {
    /** The HTTP status. */
    readonly statusCode: number;
    /** The headers, by lower-case name. */
    readonly headers: Record<string, string | string[]>;
    /** `data` gives the body piece by piece. */
    on(event: 'data', listener: (chunk: Uint8Array) => void): this;
    /** `end` comes after the last piece. */
    on(event: 'end', listener: () => void): this;
    /** `error` or `aborted` when the body broke off. */
    on(event: 'error' | 'aborted', listener: (error?: Error) => void): this;
}

/** Folium 2: `api.net.request`'s request, Electron's ClientRequest (the members a source uses). */
export interface FoliumSourceClientRequest {
    /** Sets a header before the body is written. */
    setHeader(name: string, value: string): void;
    /** Writes part of the body. */
    write(chunk: string | Uint8Array): void;
    /** Sends the request, with the last part of the body. */
    end(chunk?: string | Uint8Array): void;
    /** Stops it. */
    abort(): void;
    /** `response` with the answer. */
    on(event: 'response', listener: (response: FoliumSourceIncomingMessage) => void): this;
    /** `error` when the request failed. */
    on(event: 'error', listener: (error: Error) => void): this;
    /** Electron's other events: `redirect`, `login`, `finish`, `abort`, `close`. */
    on(event: string, listener: (...args: unknown[]) => void): this;
}

/** Folium 2: what a media rule's `test` is asked: one read of a resource, with the answer's headers. Frozen. */
export interface FoliumSourceMediaRequest {
    /** The address. */
    readonly url: string;
    /** `GET`, `HEAD` or `OPTIONS` (other methods never get the headers). */
    readonly method: string;
    /** Electron's resource type (`media`, `xhr`, `image`, …). */
    readonly resourceType: string;
    /** The answer's headers, a frozen copy of what Electron hands. */
    readonly responseHeaders: Readonly<Record<string, readonly string[]>>;
}

/** Folium 2: `api.legacy.store`, the main process's store keys a built-in source keeps its sign-in under. */
export interface FoliumSourceLegacyStore {
    /** The value, or undefined. */
    get(key: string): unknown;
    /** Stores `value`. */
    set(key: string, value: unknown): void;
    /** Whether the key has a value. */
    has(key: string): boolean;
    /** Removes the key. */
    delete(key: string): void;
}

/** Folium 2: `api.seal`. `available()` is false where the system keeps no encrypted store (Linux's basic_text). */
export interface FoliumSourceSeal {
    /** Whether sealing works here. */
    available(): boolean;
    /** `text` sealed, as base64; throws where sealing does not work. */
    seal(text: string): string;
    /** The text of a sealed base64 string. */
    open(sealed: string): string;
}

/** Folium 2: `api.cache` of a source mod. */
export interface FoliumSourceCache {
    /** `<userData>/mods-cache/<id>`, made when missing. */
    dir(): string;
    /** Asks the host to trim the media cache to its budget (or to `limitBytes`). */
    requestPrune(limitBytes?: number): void;
    /** Hands the host the source's cache entries, so its cache view lists, removes and clears them. */
    provideEntries(provider: FoliumSourceCacheEntries): FoliumDisposer;
}

/** Folium 2: what `api.cache.provideEntries` takes. */
export interface FoliumSourceCacheEntries {
    /** The entries. */
    list(): unknown[] | Promise<unknown[]>;
    /** Removes one. */
    remove?(id: string): void | Promise<void>;
    /** Removes all. */
    clear?(): void | Promise<void>;
}

/** Folium 2: a rule of `api.media.allow`: which addresses get cross-origin headers, for how long. */
export interface FoliumSourceMediaRule {
    /** Host names; a request to one of them is the source's. */
    hosts?: string[];
    /** Whole addresses. */
    urls?: string[];
    /** How long an address added stays the rule's, milliseconds. */
    ttlMs?: number;
    /**
     * What `hosts` cannot say (a path that ends in an audio extension, an answer's content type). It narrows the
     * rule's `hosts`, which it needs: it is asked only for reads on them (never for another source's), and there the
     * host alone lets nothing through. Synchronous; true lets the read through, one that throws counts as false. It
     * runs for every answer from those hosts: keep it quick. `urls` of the same rule pass without it.
     */
    test?(request: FoliumSourceMediaRequest): boolean;
    /**
     * An address a redirect leads to becomes the rule's too: from one of its `urls`, until that address's own
     * expiry; from one its `test` let through, for `ttlMs` from the redirect. A read let through by `hosts` alone
     * is not followed.
     */
    followRedirects?: boolean;
    /** Electron's resource types the rule applies to (`media`, `xhr` and `image` by default). */
    resourceTypes?: string[];
}

/** Folium 2: what `api.media.allow` returns: it removes the rule, and its `add(url)` makes an address issued later the rule's. */
export type FoliumSourceMediaAllowed = FoliumDisposer & { add(url: string): void };

/** Folium 2: `api.media` of a source mod. */
export interface FoliumSourceMedia {
    /** Registers `rule`. */
    allow(rule: FoliumSourceMediaRule): FoliumSourceMediaAllowed;
    /** One Range header against a size: `{ start, end }`, `'unsatisfiable'`, or null. */
    parseRange(header: string | null | undefined, size: number): { start: number; end: number } | 'unsatisfiable' | null;
    /**
     * Answers `folia-mod://<mod id>/_media/<name>/…`: `handler` gets the request and answers a web Response, or
     * `{ file }` for the host to serve with Range. `name` is lower case letters, digits and `-`. Returns what stops it.
     */
    serve(name: string, handler: (request: Request, rest: string) => unknown): FoliumDisposer;
    /** `folia-mod://<mod id>/_media/<name>/<rest>`. */
    url(name: string, rest?: string): string;
}

/** Folium 2: `api.windows` of a source mod. */
export interface FoliumSourceWindows {
    /**
     * A hidden, sandboxed window without the app's preload (a sign-in, a signature sandbox), destroyed when the mod
     * stops; `options.session` names its partition as `api.net.session` does. An Electron BrowserWindow.
     */
    hidden(options?: Record<string, unknown>): unknown;
    /** Whether the main window is there. */
    mainWindowPresent(): boolean;
    /** Calls `listener` when the main window comes or goes. */
    onMainWindowChanged(listener: (present: boolean) => void): FoliumDisposer;
}
