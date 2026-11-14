// src/mods/folium/sources/contract.ts
// The public contract of Folium 2.0 sources (`folium.sources`, plan §4): what a source mod registers and
// what each standard capability holds. Types only, like contract.ts; its one import is of types from
// contract.ts, which the generated type file holds itself, so the generators drop that line. It depends on
// nothing of the host (no React, store, DOM or Electron); the host's internal provider contract
// (src/types/onlineMusic.ts) is reached only through the adapter (registries/sources.ts).
//
// Stability rule (mods/README.md): inside folium 2.x this file only grows. A capability that has to change
// gets a new version (`search@2`) next to the old one; the old one keeps working.

import type { FoliumDisposer, FoliumJsonValue, FoliumLabel } from '../contract';

// ---------------------------------------------------------------- Sources

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
