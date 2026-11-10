import type { PersonalFmCatalog, PersonalFmLaunch } from './personalFm';
import type { LyricData, ReplayGainInfo, SongResult, UnifiedSong } from '../types';

// src/types/onlineMusic.ts

export type MediaId = string | number;
export type OnlineProviderId = 'netease' | (string & {});
// The provider that is active where none was chosen, or where the one chosen is not there.
export const DEFAULT_ONLINE_PROVIDER_ID: OnlineProviderId = 'netease';
// Lowest first as `omni` orders them: standard, high, ultra, lossless, hires. 'ultra' is a level
// only for a provider that lists it (YouTube Music, for a Premium member); everywhere else a stored
// 'ultra' stands for 'high'.
export type AudioQualityPreference = 'standard' | 'high' | 'ultra' | 'lossless' | 'hires';
export type ProviderCatalogEntityKind = 'album' | 'artist' | 'playlist';

export interface ProviderCatalogRef {
    providerId: OnlineProviderId;
    kind: ProviderCatalogEntityKind;
    id: MediaId;
}

/** A catalog ref of a song's album or artist, with the name the song gives that album or artist. */
export interface ProviderNamedCatalogRef extends ProviderCatalogRef {
    name: string;
}

/**
 * What a song's album and artists open as at its provider (`omni.getSongCatalogRefs`): null, and
 * left out of `artists`, for one the provider cannot open.
 */
export interface ProviderSongCatalogRefs {
    album: ProviderNamedCatalogRef | null;
    artists: ProviderNamedCatalogRef[];
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PlaybackSourceRef =
    | {
        kind: 'online';
        providerId: OnlineProviderId;
        mediaId: string;
        variant?: string;
        providerData?: Record<string, JsonValue>;
    }
    | { kind: 'local'; mediaId: string }
    | { kind: 'navidrome'; mediaId: string }
    | { kind: 'stage'; mediaId: string };

export interface ProviderCapabilities {
    search: boolean;
    playback: boolean;
    lyrics: boolean;
    auth: boolean;
    userLibrary: boolean;
    playlists: boolean;
    albums: boolean;
    artists: boolean;
    recommendations: boolean;
    mutations: boolean;
    /** Personal FM can be steered by mode/scene, i.e. `getPersonalFm` honours PersonalFmRequestOptions. */
    personalFmModes?: boolean;
    wordByWordLyrics: boolean;
    userCloud?: boolean;
    /**
     * The account's listening ranking as the platform counts it (`library.getListeningRankCollections`,
     * `catalog.getListeningRankTracks`): not the plays Folia keeps of its own.
     */
    listeningRank?: boolean;
    historyRecommendations?: boolean;
    /** Daily recommendations can be narrowed to styles the account picks (`recommendations.getDailyStyle*`). */
    dailyStyleRecommendations?: boolean;
    /**
     * The account keeps preferences that steer what the provider recommends, read and saved through
     * `recommendations.getRecommendationPreferences` / `saveRecommendationPreferences`; where the app
     * offers them is `recommendations.preferenceEntries`.
     */
    recommendationPreferences?: boolean;
    playlistSubscription?: boolean;
    playlistTrackMutations?: boolean;
    likes?: boolean;
    userAlbums?: boolean;
    /** The provider accepts a listening report for a track the user actually played. */
    playbackReports?: boolean;
    /** The provider has a recommendation page of its own, read through `explore`. */
    explore?: boolean;
    /**
     * The provider sounds its songs in a player of its own outside this app. `externalPlayback`
     * steers that player; `playback.getAudioSource` is not used.
     */
    externalPlayback?: boolean;
    /**
     * The provider can look a song up by id with `playback.getSongDetail`; absent reads as true
     * wherever `playback` is there.
     */
    songDetail?: boolean;
}

export interface ProviderAvailability {
    configured: boolean;
    reason?: 'not-configured' | 'runtime-unavailable';
    /** Optional i18n key explaining a disabled platform row; kept provider-owned. */
    messageKey?: string;
}

export interface ProviderAccountSummary {
    providerId: OnlineProviderId;
    displayName: string;
    shortName: string;
    /** 短名的 i18n key（OnlineMusicProvider.shortNameKey）；界面按它取当前语言的名字。没有就显示 shortName。 */
    shortNameKey?: string;
    availability: ProviderAvailability;
    /** False for a provider with no account at all (a Folium mod source): it is used without signing in. Absent means true. */
    requiresAccount?: boolean;
    status: 'unknown' | 'authenticated' | 'anonymous' | 'error';
    user: ProviderUser | null;
    collections: ProviderCollection[];
    error?: string;
    hydration?: 'loading' | 'ready';
    freshness?: 'stale' | 'refreshing' | 'fresh' | 'error';
    lastUpdatedAt?: number;
}

export interface ProviderPage<T> {
    items: T[];
    total?: number;
    hasMore: boolean;
    nextOffset: number;
}

export interface ProviderAudioSource {
    url: string;
    fetchedAt: number;
    expiresAt?: number;
    quality: AudioQualityPreference;
    replayGain?: ReplayGainInfo;
    /**
     * The URL plays a preview clip of the song, not the whole of it: what a platform gives an account
     * that may not play the whole song. The clip plays with a notice and is never stored as the song. Omni notes it with the URL (`omni.isPreviewAudioSource`), which is where
     * playback and the media cache ask.
     */
    preview?: boolean;
    /**
     * Where the preview clip starts inside the song, in milliseconds. Only meaningful with `preview`;
     * absent means the clip starts at the song's start. Playback reads it with the URL
     * (`omni.previewClipStartMsOfAudioSource`) to line the lyrics up with the clip.
     */
    clipStartMs?: number;
}

export type ProviderSongAvailabilityState = 'playable' | 'unavailable' | 'unknown';

export type ProviderSongUnavailableReason = 'taken-down' | 'restricted';

export interface ProviderSongAvailability {
    state: ProviderSongAvailabilityState;
    label?: string;
    /**
     * state 'unavailable' 只能搭配 'taken-down'；不带 reason 的 'unavailable'（mod provider）也按 taken-down 处理。
     * 权限 / 付费 / 地区这类限制只能是 state 'unknown' + reason 'restricted'，交给运行时判定。
     * 运行时失败永不回写这里。
     */
    reason?: ProviderSongUnavailableReason;
}

export interface ProviderSongReplacement {
    song: UnifiedSong;
    label?: string;
}

export interface ChorusRange {
    startTime: number;
    endTime: number;
}

export interface ProviderLyricsResult {
    lyrics: LyricData | null;
    mainText?: string | null;
    wordByWordText?: string | null;
    translationText?: string | null;
    romanizationText?: string | null;
    isPureMusic: boolean;
    chorusRanges?: ChorusRange[];
}

export interface ProviderAlbumSummary {
    id: MediaId;
    name: string;
    coverUrl?: string;
    entityId?: string;
    catalogRef?: ProviderCatalogRef;
}

export interface ProviderSongMetadata {
    artists: ProviderArtistSummary[];
    album: ProviderAlbumSummary;
    durationMs: number;
    coverUrl?: string;
    aliases: string[];
    translatedNames: string[];
}

export interface ProviderUser {
    id: MediaId;
    nickname: string;
    avatarUrl?: string;
    backgroundUrl?: string;
    vipType?: number;
}

export interface ProviderArtistSummary {
    id: MediaId;
    name: string;
    entityId?: string;
    catalogRef?: ProviderCatalogRef;
}

export interface ProviderHistoryEntry {
    id: string;
    label: string;
    providerData?: Record<string, JsonValue>;
}

/** The span a listening ranking counts plays over: the last week, or all the account's time. */
export type ListeningRankRange = 'week' | 'all';

export interface ProviderCollection {
    /** A provider's named radio stream: selecting the card starts FM with this mode. */
    personalFm?: PersonalFmLaunch;
    /** The account's listening ranking over this span (type `listening_rank`): read-only, made by the platform. */
    listeningRank?: ListeningRankRange;
    providerId: OnlineProviderId;
    id: MediaId;
    name: string;
    /**
     * `artist_songs` is every song of the artist whose id this is (the artist page's "all songs", #918):
     * a read-only list the app makes, read through `catalog.getArtistSongs`.
     */
    type: 'playlist' | 'album' | 'artist' | 'radio' | 'cloud' | 'listening_rank' | 'artist_songs' | string;
    coverUrl?: string;
    description?: string;
    trackCount?: number;
    albumCount?: number;
    isOwned?: boolean;
    creator?: ProviderUser;
    artists?: ProviderArtistSummary[];
    aliases?: string[];
    publishedAt?: number;
    publisher?: string;
    playCount?: number;
    updatedAt?: number;
    tracksUpdatedAt?: number;
    isLiked?: boolean;
    providerData?: Record<string, JsonValue>;
}

export type LoginState =
    | { state: 'waiting' }
    | { state: 'scanned' }
    | { state: 'confirmed' }
    // `failure`：provider 对这次过期还知道的事实（比如过多久才能再要一个码）；是哪一种情况照旧按扫没扫过码分。
    | { state: 'expired'; failure?: LoginFailureDetail }
    // `failure`：provider 对这次失败知道的事实，登录窗口据此分出是哪一种情况。
    // `transient`：这一次检查在网络这一层没有成功（没拿到平台的回答，比如连接被重置），码在平台那边还有效：
    // 登录接着检查，连着几次都这样才算失败。
    | { state: 'error'; message?: string; failure?: LoginFailureDetail; transient?: boolean };

// 扫码登录失败的几种形态，写在诊断报告的 `failure:` 那一行。登录窗口画什么看的是 LoginCaseId。
// 没扫码就过期属于正常情况，不算失败；扫过码却过期，多半是手机端确认被拒。
export type LoginFailureKind =
    | 'start-error'
    | 'check-error'
    | 'expired-after-scan'
    | 'account-refresh-failed';

// 一次登录停在哪一步：'start' 建二维码或开始浏览器登录，'open' 打开登录的页面，'wait' 等待期间过期，
// 'check' 检查扫码或浏览器的结果，'account' 确认之后读账号。
export type LoginStep = 'start' | 'open' | 'wait' | 'check' | 'account' | 'form';

// 登录没有成功时能分出的情况。每一种的类别、给出的操作、有没有详情，见 services/onlineMusic/login/loginFailureCase.ts 的表。
export type LoginCaseId =
    | 'code-expired' | 'expired-after-scan' | 'browser-unfinished' | 'not-authorized'
    | 'unreachable' | 'no-answer'
    | 'refused' | 'retry-later' | 'device-limit' | 'wrong-scan-app'
    | 'local-service-stopped' | 'local-service-unavailable' | 'cannot-listen'
    | 'no-browser' | 'browser-still-open' | 'browser-closed-early' | 'browser-unread' | 'browser-not-opened'
    | 'account-not-read'
    | 'unknown';

// provider 对一次登录失败知道的事实。只放可以公开贴出来的内容：不含 cookie、token、IP 或账号信息。
export interface LoginFailureDetail {
    // 只有 provider 认得出是哪一种情况时，由它直接点名；不点名就由共用的规则按下面的事实去分。
    case?: LoginCaseId;
    // 平台自己的状态码和原话，平台说了才有。
    code?: string;
    message?: string;
    httpStatus?: number;
    // 平台转述的上游状态码，和它要求等多久再试。
    upstreamCode?: string;
    retryAfterMs?: number;
    // 桌面端主进程给这次失败起的代号（在浏览器里确认的登录）。
    mainCode?: string;
}

// 一首在线歌要播放地址、一个集合读歌曲没有成功时能分出的情况。每一种停不停播放、给不给重试，
// 见 services/onlineMusic/failure/onlineFailureCase.ts 的表。
export type OnlineFailureCaseId =
    | 'unreachable' | 'local-service-stopped' | 'retry-later'
    | 'sign-in-needed' | 'account-refused' | 'subscription-required' | 'purchase-required' | 'entitlement-required'
    | 'preview-only' | 'region-restricted' | 'not-configured'
    | 'taken-down' | 'no-audio' | 'audio-unplayable' | 'not-public'
    | 'refused' | 'unknown';

// 没有成功的是哪一种请求：一首歌的播放地址，或者一个集合（歌单、专辑）的歌曲。
export type OnlineFailureOperation = 'audio' | 'collection';

// 本机播放器这条路自己的失败原因，和平台无关：播放器没装、装了却找不到它内部那个播放器，或者
// 用户还没同意为了让 Folia 接上而关掉并重开他自己的播放器。平台报这一句，界面按它分开说。
export type OnlinePlayerFailureCause = 'player-not-installed' | 'player-not-found' | 'player-restart-consent';

// provider 对一次没有成功的请求知道的事实。只放可以公开贴出来的内容：不含 cookie、token、IP 或账号信息。
export interface OnlineFailureDetail {
    // 只有 provider 认得出是哪一种情况时，由它直接点名；不点名就由共用的规则按下面的事实去分。
    case?: OnlineFailureCaseId;
    // 平台自己的状态码和原话，平台说了才有。
    code?: string;
    message?: string;
    httpStatus?: number;
    // 平台转述的上游状态码，和它要求等多久再试。
    upstreamCode?: string;
    retryAfterMs?: number;
    // 平台没给地址、原因说不准时，它的回答透出来的「可能」的原因：登录后可能能放，可能要会员，可能限地区。
    // 只是可能，情况不变，界面只多说一句。
    likelyCause?: 'sign-in' | 'subscription' | 'region';
    // 发出请求时这个平台没有登录的账号：要登录的失败说「登录后才能播放」，不说「登录已失效」。
    signedOut?: boolean;
    // 再试多少次也是这个结果，平台亲口这么说的（下架、只给会员放）。开了「自动跳过不能播放的歌」
    // 时，这种失败不等倒计时结束。
    skipAtOnce?: boolean;
    // 本机播放器这条路失败的那一种情况，平台无关（OnlinePlayerFailureCause）。
    playerCause?: OnlinePlayerFailureCause;
}

export type ProviderErrorCode =
    | 'auth-required'
    | 'unsupported'
    // 集合设为不公开，当前这条读取路径没资格读它。与 `unsupported`（这个后端或 provider 没有这项能力）
    // 分开，界面才能只在这种情况下给出「不是公开歌单」的解释。
    | 'not-public'
    // 平台或它的服务没能接下这次请求（没有配置、没有在跑、拒绝了）；从不表示歌曲下架。
    | 'unavailable'
    // 平台答了，却没给这首歌的音频，为什么不知道。
    | 'not-playable'
    | 'preview-only'
    // The platform plays for paying accounts only, and this account does not pay.
    | 'subscription-required'
    | 'region-restricted'
    | 'network'
    | 'invalid-response';

export class OnlineProviderError extends Error {
    constructor(
        public readonly code: ProviderErrorCode,
        message: string,
        public readonly providerId?: OnlineProviderId,
        public readonly cause?: unknown,
        /** 非 2xx 响应的 HTTP 状态，与响应体里的 code 分开；只有按 HTTP 状态分流的 transport 会传。 */
        public readonly httpStatus?: number,
        /** 后端要求的冷却时长（429 退避）；只有能读出它的 transport 会传。 */
        public readonly retryAfterMs?: number,
    ) {
        super(message);
        this.name = 'OnlineProviderError';
    }
}

/**
 * Who is searching. `session` tells apart callers whose paging must not disturb each other; absent
 * is the host's own UI.
 */
export interface ProviderSearchContext {
    session?: string;
}

/** What a search looks for: songs, albums or playlists (`omni.getProviderSearchKinds`). */
export type ProviderSearchKind = 'song' | 'album' | 'playlist';

export interface OnlineSearchProvider {
    /**
     * A provider that keeps what it read of a search between its pages keeps it apart for each
     * `context.session`; one that keeps nothing between pages ignores the context.
     */
    searchSongs(query: string, limit: number, offset: number, context?: ProviderSearchContext): Promise<ProviderPage<UnifiedSong>>;
    /**
     * Albums found by the query, as collections of type 'album' that `catalog.getAlbumTracks` opens.
     * Left out where the platform has no album search: the search page then offers no album tab.
     */
    searchAlbums?(query: string, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    /**
     * Playlists found by the query, as collections of type 'playlist' that `catalog.getPlaylistTracks`
     * opens. Left out where the platform has no playlist search.
     */
    searchPlaylists?(query: string, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
}

export interface OnlinePlaybackProvider {
    /**
     * The song by id, or null where the platform has no song by it. Takes the song's `UnifiedSong.id`
     * and also its `sourceRef.mediaId`; a platform whose two differ accepts both, in its own folder.
     */
    getSongDetail(id: MediaId): Promise<UnifiedSong | null>;
    /**
     * Songs by id, many at once, in the order of `ids`: null for an id the platform has no song
     * by. An id is either kind `getSongDetail` takes. Left out where the platform looks songs up
     * one at a time; `omni.getSongDetails` then asks `getSongDetail` for each. An answer that
     * refuses the request rejects: it is not a row of nulls.
     */
    getSongDetails?(ids: MediaId[]): Promise<(UnifiedSong | null)[]>;
    /**
     * How many ids one request of `getSongDetails` carries, for a platform whose request takes no
     * more. `omni.getSongDetails` hands it groups of at most this many, one after another, each
     * through the caller's runner, so that each request is counted. Left out: all the ids in one
     * call. A positive integer; any other value counts as left out.
     */
    songDetailsPerRequest?: number;
    // 拿不到地址而知道为什么的抛错（provider 的 `describeFailure` 说它的意思）；null 是没有地址、也没有可说的。
    getAudioSource(song: SongResult, quality: AudioQualityPreference): Promise<ProviderAudioSource | null>;
    /**
     * The quality levels the provider really tells apart, for one whose audio does not differ at
     * all four. Without it, all four (standard, high, lossless, hires). The quality option shows these levels only, and
     * `getAudioSource` is asked for one of them: under a stored preference the provider does not
     * list, the nearest level it lists at or below it (`omni.resolveAudioQuality`).
     * The list may change with the account (YouTube Music lists 'ultra' for a member only), so
     * it is read when it is needed. A provider that lists its levels and serves a song at another
     * one of them than it was asked for says so in the source's `quality`.
     */
    audioQualityLevels?: readonly AudioQualityPreference[];
    /**
     * The i18n key of the notice shown when a preview clip of this provider's song plays
     * (`ProviderAudioSource.preview`), for a provider whose clips mean something else than
     * "this account may only preview it". Without it, `status.songPreviewOnly`.
     */
    previewNoticeKey?: string;
    getAvailability?(song: SongResult): ProviderSongAvailability;
    getReplacement?(song: SongResult): Promise<ProviderSongReplacement | null>;
    /**
     * The song `song` is played as in its place, or null where it plays as itself: a music video
     * that a list showed as itself, played as its song version.
     */
    getPlayedSong?(song: SongResult): Promise<UnifiedSong | null>;
    /**
     * For a provider that keeps its audio in a cache of its own instead of the media cache: puts the
     * file that `url` (one of its audio URLs) plays into that cache, and resolves to whether it is
     * there. Reading the URL of a kept file reads the kept copy.
     */
    keepAudio?(url: string): Promise<boolean>;
    /** Whether the file `url` plays is in that cache already. */
    hasKeptAudio?(url: string): Promise<boolean>;
}

/**
 * One finished listening report, in the only two units a provider can be told the truth in:
 * how many seconds of this track were really rendered, and how long the track is.
 *
 * `playedSeconds` is never a position on the progress bar - a listener who drags to the end has
 * not listened to the song. Callers must hand over accumulated playback and must already have
 * capped it at `totalSeconds`; nothing downstream can tell an inflated number from a real one.
 */
export interface ProviderPlaybackReport {
    playedSeconds: number;
    totalSeconds?: number;
    quality?: AudioQualityPreference;
}

export interface OnlinePlaybackReportProvider {
    /**
     * Whether a play of this song can be reported at all: one whose id may not name a track in the
     * platform's catalogue cannot. Without it, any song of the platform can.
     */
    canReport?(song: SongResult): boolean;
    reportPlayback(song: SongResult, report: ProviderPlaybackReport): Promise<void>;
}

/**
 * What an external player outside this app has loaded, as its provider says it.
 * `mediaId` is the id the provider gave the player (not necessarily the song's `UnifiedSong.id`);
 * `isStatusForSong` tells whether it is a given song.
 */
export interface ProviderExternalPlaybackStatus {
    /** Live broadcasts have no seekable song timeline or natural track ending. */
    live?: boolean;
    mediaId: string;
    isPlaying: boolean;
    positionMs: number;
    durationMs: number;
    /** The player's own state says the track ran out. */
    ended: boolean;
    /**
     * With `ended`: the player was moved off the track by its own controls rather than by running
     * out, and the app's queue takes the step in this direction instead of its usual advance.
     */
    skipped?: 'next' | 'previous';
    /** An intentional player-side seek, so small backward jumps must not be smoothed away. */
    seeking?: boolean;
    /** The player accepted a start/resume and is still buffering; this is not a user pause. */
    starting?: boolean;
    /**
     * The player is sounding an advertisement between songs (a free account has some). Folia only
     * recognises it, so that it is never taken for the song's end or for a track it did not ask
     * for: nothing about the advertisement is shown, muted or otherwise changed.
     */
    advertisement?: boolean;
    /**
     * The answer came from the player's fallback channel (Windows' media session) rather than the
     * one that can be steered precisely: the app still follows it, coarsely. Told once per episode.
     */
    degraded?: boolean;
}

/**
 * Who asked for a song to be started in a player outside Folia.
 */
export interface ExternalPlaybackStartOptions {
    /**
     * false only for an advance Folia made by itself at the end of a song, never for a press. A
     * player that would have to be started or restarted for it is not woken, and reports that it
     * cannot take the song instead.
     */
    userAction?: boolean;
    /**
     * The listener played a whole list in Folia, so the queue behind this song is replaced rather
     * than followed: a player that keeps a queue of its own may empty it whole, the songs the
     * listener queued in it included. Every other start takes back only the songs Folia wrote there.
     */
    replaceQueue?: boolean;
}

/**
 * What a prepared queue is asked for besides the songs themselves.
 */
export interface PrepareNextOptions {
    /**
     * The songs that follow go on to nothing (repeat one): what an earlier write left in the player's
     * own queue is taken back where the player can be emptied, so the player does not go on to a song
     * Folia is no longer stepping to.
     */
    retract?: boolean;
}

/**
 * A player outside Folia that a provider steers: the provider's song plays there (inside a page
 * this app cannot route as audio), and the app drives the transport and follows its clock.
 * Only the song's own provider can answer these calls.
 */
export interface OnlineExternalPlaybackProvider {
    /**
     * Starts the player itself, for a player that has to be running before anything can sound in
     * it. Absent where the player needs no start. Called once, at launch, and only where the
     * listener asked for it (omni.warmUpExternalPlayers).
     */
    warmUp?(): Promise<void>;
    /**
     * Whether an advance the app made by itself (the track ended, the queue moved on) that this
     * player cannot take stops the playback where it is with one line said, instead of failing the
     * song. True for a player that would have to be started again for it; absent or false elsewhere.
     */
    stopsAutoAdvanceWhenUnreachable?(): boolean;
    /**
     * Whether `error` means the player itself could not be reached, as opposed to a song it will not
     * play or a setting that is missing. Read only where `stopsAutoAdvanceWhenUnreachable` is true:
     * the failures that are not this one take the ordinary path of a song that did not play.
     */
    isUnreachableFailure?(error: unknown): boolean;
    /**
     * The player sounds the song outside every page of the app, so nothing here can measure it: a
     * real spectrum of the song needs the machine's own sound, captured as a whole. True where the
     * audio never passes through the app; absent or false where it does, and nothing is captured.
     */
    capturesSystemAudio?: boolean;
    /**
     * The interface may show the song as playing as soon as the start is asked for, without waiting
     * for the player to confirm it took the song. True for a player whose start is an instruction
     * with no dependable answer; absent or false where the confirmation arrives with the start.
     */
    startsWithoutWaiting?: boolean;
    /**
     * The status polls space themselves out while this player is the one sounding the song: its
     * answers arrive slowly or cost it something. True where that is so; absent or false keeps the
     * polls at the app's own cadence.
     */
    backsOffStatusPolls?: boolean;
    /**
     * The system media keys belong to Folia while a song this route started sounds here, even where
     * the player registers no media session of its own: a key the app let go would reach nothing.
     * True where the keys are held for the song alone; absent or false leaves them to the rules
     * above.
     */
    holdsMediaKeysWhilePlaying?: boolean;
    /** False only for songs this external route already knows it cannot start; no network reads. */
    canPlay?(song: SongResult): boolean;
    /** Prepare a bounded successor queue without interrupting the current song. */
    prepareNext?(song: SongResult, upcoming: SongResult[], options?: PrepareNextOptions): Promise<void>;
    /** Whether a handoff can reuse an already prepared successor (not a guarantee of buffered audio). */
    isPrepared?(song: SongResult): boolean;
    /** Starts `song` in the player at `startSec`, replacing whatever it played; resolves once started. */
    play(song: SongResult, startSec: number, options?: ExternalPlaybackStartOptions): Promise<void>;
    /**
     * The player already has `song` loaded (started by a window of this app that is gone): take it
     * as this provider's current playback without starting it, so successors can be prepared for it.
     */
    adopt?(song: SongResult): void;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(seconds: number): Promise<void>;
    /** Sets the player's own output level (0 to 1, linear, 0 when muted): its audio never passes through the app's gain. */
    setVolume?(volume: number): Promise<void>;
    /**
     * Where the player is on `song` right now, in milliseconds, or null where it is not running that
     * song (another track, nothing loaded, a read that failed). For a song restored while the player
     * kept sounding it through a restart. A read only: nothing is started, resumed or paused for it.
     * Absent where the player cannot be asked without being steered.
     */
    runningPositionMs?(song: SongResult): Promise<number | null>;
    /**
     * What the player has for `song` when the session restored at launch asks: one read, nothing
     * cached. Absent where the player cannot be asked without steering it. The read may look for the
     * way this app steers the player, because a player of its own outlives the app and need not run
     * the way this run started, so a provider that may be playing a song nobody here started overrides
     * it. A read only: nothing is started, resumed or paused for it. Where the player cannot be
     * reached, the answer names no track. An answer from a coarse channel may still name `song` where
     * the track it shows is that song, by the title and the artist it shows; that answer is `degraded`.
     */
    runningStatus?(song: SongResult): Promise<ProviderExternalPlaybackStatus | null>;
    /** The player's state now, from no cache. */
    getStatus(song: SongResult): Promise<ProviderExternalPlaybackStatus>;
    /** Whether the player's loaded track is `song` (the id in `status` may be a playback id). */
    isStatusForSong(song: SongResult, status: ProviderExternalPlaybackStatus): boolean;
    /**
     * Puts this provider's songs back on its standard way of playing (the way that gives this app an
     * audio address), for a listener whose external player cannot be steered any more - not
     * installed, a build this app no longer finds its player in. The provider changes its own way and
     * nothing else; absent where a provider has no other way to go back to.
     */
    useStandardPlayback?(): Promise<void>;
}

/**
 * What an external player declared about how it plays, each answer false where the provider
 * declared nothing (see OnlineExternalPlaybackProvider). Read for the app's own decisions only;
 * nothing here starts, pauses or asks the player anything.
 */
export interface ExternalPlaybackTraits {
    /** A real spectrum of the song has to be taken from the machine's own sound. */
    capturesSystemAudio: boolean;
    /** The interface may move on before the player confirms it took the song. */
    startsWithoutWaiting: boolean;
    /** The status polls space themselves out while this player sounds the song. */
    backsOffStatusPolls: boolean;
    /** The keys are held for as long as a song this route started sounds in it. */
    holdsMediaKeysWhilePlaying: boolean;
}

/** An alternate title and artist that belong to the same song. */
export interface ProviderLyricSearchAlias { song: SongResult; title: string; artist: string; album?: string }

export interface OnlineLyricsProvider {
    getSearchAlias?(song: SongResult): Promise<ProviderLyricSearchAlias | null>;
    getLyrics(song: SongResult, context?: { userId?: MediaId | null }): Promise<ProviderLyricsResult>;
    /**
     * Where its own lyrics are word-level, the automatic pick asks only the listener's preferred
     * source before them, and takes that source's words alone over them: another source may have
     * words too, but not this platform's own timing. The listener can turn this off (lyric
     * settings), and the platform's lyrics are then matched like any other source's.
     * Off where the platform leaves the choice to the automatic pick.
     */
    prefersOwnWordByWord?: boolean;
    getChorusRanges?(songId: MediaId): Promise<ChorusRange[]>;
    // 这首歌的歌手在别的平台上可能用的另一个名字；没有就返回 null。
    getAlternateArtistName?(song: SongResult): Promise<string | null>;
}

export interface OnlineSongMetadataProvider {
    getSongMetadata(song: SongResult): ProviderSongMetadata;
}

// provider 自行声明它支持哪几种扫码登录方式；不声明即代表只有单一方式，UI 维持单步流程。
export interface LoginMethod {
    id: string;          // 传给后端的识别值（QQ: 'qq' | 'wechat'）
    labelKey: string;    // i18n key，由 UI 层翻译
    iconKey: string;     // 图标的名字：UI 层按它取 src/assets/providers/ 里同名的 .svg
    // 选中这种方式时那一行说明（i18n key）：浏览器登录的几种方式靠它说清楚彼此差在哪。不给就用平台的登录说明。
    noteKey?: string;
    // 在浏览器里确认的几种方式里，开始时先替用的人选上的那一种（例如此刻在用的那一种）；都不标就是第一种。
    preferred?: boolean;
}

// —— 平台的配置清单 ——
// 登录之外、要用的人一步步做完的事（例如装一个本机程序、填一把密钥），登录窗口按平台给的清单逐步画出来。
// 清单只有数据：每一步的状态、说明和操作都由平台决定，窗口不认识任何平台。

/** 清单里一步的一个操作。 */
export interface ProviderSetupAction {
    id: string;
    labelKey: string;
    /**
     * link：打开平台说的页面；run：做一件事；pick-file：选一个本机文件（平台自己弹系统的选择框）；
     * submit-secret：交出这一步密码框里填的内容。
     */
    kind: 'link' | 'run' | 'pick-file' | 'submit-secret';
    primary?: boolean;
}

/** 清单里的一步。 */
export interface ProviderSetupStep {
    id: string;
    titleKey: string;
    noteKey?: string;
    /** titleKey 与 noteKey 的插值。 */
    params?: Record<string, string | number>;
    state: 'done' | 'todo' | 'warn' | 'error';
    /** 原样显示的一行事实（路径、版本）；不翻译。 */
    detail?: string;
    /** 这一步有一个密码框。saved：已经存过一份（框里只画掩码，要换才清空）。 */
    secret?: { labelKey: string; saved: boolean };
    /**
     * 一段收起的详细说明：清单里只放一句短的，按「更多」才展开这一段。放不下的长说明用它，
     * 别把清单撑出窗口。
     */
    more?: { labelKey: string; noteKey: string };
    actions?: ProviderSetupAction[];
}

/** 平台此刻的配置清单。 */
export interface ProviderSetupView {
    titleKey: string;
    noteKey?: string;
    params?: Record<string, string | number>;
    steps: ProviderSetupStep[];
    /** 每一步都做完了：可以结束。 */
    complete: boolean;
    /** 平台对刚做的那一个操作说的话（i18n key）；没有可说的就不给。 */
    message?: { key: string; tone: 'ok' | 'warn' | 'error' };
}

// —— 表单式登录（账号密码类平台）——
// provider 声明登录窗口要渲染的字段，登录窗口按声明画表单；提交后由 provider 自己完成登录。
// 这样新平台接入不需要改登录界面本身（omni 通用能力）。
export interface ProviderLoginFormField {
    key: string;                    // 提交时 values 里的字段名
    type: 'text' | 'password' | 'url';
    labelKey?: string;              // i18n key，由 UI 层翻译；缺省用 label
    label?: string;
    placeholderKey?: string;
    placeholder?: string;
    required?: boolean;
}

export interface ProviderLoginForm {
    fields: ProviderLoginFormField[];
    submitLabelKey?: string;
    submitLabel?: string;
    noteKey?: string;               // 表单下方的提示文字（i18n key）
    note?: string;
    /**
     * 提交失败时按错误 code 显示的 i18n key（键是 OnlineProviderError.code，如 'network' / 'auth-required'）。
     * 没有对应项的 code 由界面显示通用失败文案；provider 错误信息只进日志，不直接上屏。
     */
    errorKeys?: Record<string, string>;
}

// 平台的记号：一个字和一种颜色，画在登录窗口、切换器和账号头像的角上。平台自己声明；没有声明的
// （mod 加进来的平台）由界面从它的短名取第一个字、配一个中性的颜色。
export interface ProviderMark {
    letter: string;
    color: string;
}

// 登录窗口里这个平台自己的文字，都是 i18n key，由 UI 层翻译。
export interface LoginTexts {
    title: string;
    note: string;
    // 某一种失败在这个平台上才说得通的那一句（标题下面的第二行），按情况的名字给。
    caseNotes?: Partial<Record<LoginCaseId, string>>;
}

// 登录要靠的、可以在登录窗口里重启的本地服务（桌面端内嵌的后端）此刻的样子。
export interface LoginLocalServiceStatus {
    // 服务没能起来。
    failed: boolean;
    // 服务自己的错误原话；没有就是 null。
    error: string | null;
    restarting: boolean;
}

export interface LoginLocalService {
    subscribe(listener: () => void): () => void;
    // 两次变化之间回同一个对象。
    getStatus(): LoginLocalServiceStatus;
    // 重启它；回 true 表示它又在跑了。
    restart(): Promise<boolean>;
}

/** 自检里一项失败的原因：Node 错误码（没有时为 null）、原文、断在哪一步。 */
export type LoginSelfCheckError = {
    code: string | null;
    message: string;
    phase?: 'dns' | 'tcp' | 'tls' | 'http';
};

export type LoginSelfCheckAddress = { address: string; family: 4 | 6 };

/** 对一个上游域名的检查：DNS → 分协议族的 TCP + TLS 握手 → 一次真实的 HTTPS 请求。 */
export type LoginSelfCheckHost = {
    host: string;
    dns: {
        addresses: LoginSelfCheckAddress[];
        durationMs: number;
        error: LoginSelfCheckError | null;
        /** DNS 返回了 198.18.0.0/15（TUN 模式代理的 fake-ip）。 */
        fakeIp: boolean;
    };
    connections: Array<LoginSelfCheckAddress & {
        tcpMs: number | null;
        tlsMs: number | null;
        error: LoginSelfCheckError | null;
        protocol?: string | null;
    }>;
    https: {
        httpStatus: number | null;
        durationMs: number;
        remote: LoginSelfCheckAddress | null;
        error: LoginSelfCheckError | null;
        /** 本机时间减服务器 Date 头的时间（毫秒）；拿不到时为 null。 */
        clockSkewMs: number | null;
    } | null;
};

/**
 * 扫码登录失败后的主动自检结果。桌面版由主进程检查本地后端、代理、DNS、TCP / TLS 与 HTTPS；
 * 网页版只能检查配置的远端 API 能不能连上（hosts 为空、proxy 为 null）。
 */
export type LoginSelfCheckResult = {
    providerId: OnlineProviderId;
    runtime: 'electron' | 'web';
    startedAt: number;
    durationMs: number;
    backend: {
        /** 桌面版是内嵌后端的状态（running / starting / error / unavailable）；网页版固定为 remote。 */
        status: string;
        port: number | null;
        error: string | null;
        /** 对后端发的一次 HTTP 请求；后端不在运行时为 null。 */
        probe: { ok: boolean; httpStatus: number | null; durationMs: number; error: LoginSelfCheckError | null } | null;
        /** 网页版检查的远端 API 地址。 */
        url?: string;
    } | null;
    proxy: { env: Record<string, string>; system: string | null } | null;
    hosts: LoginSelfCheckHost[];
    /** 桌面版的凭据加密后端（safeStorage）；Linux 上为 basic_text 时，要它加密的登录态无法保存。网页版没有。 */
    credentialStore?: { encryptionAvailable?: boolean; backend?: string | null; error?: string } | null;
    /** 这个 provider 的登录态要 credentialStore 加密才能保存：自检才查它。provider 在自己的 runLoginSelfCheck 里标上。 */
    keepsSignInEncrypted?: boolean;
};

export interface OnlineAuthProvider {
    getLoginStatus(): Promise<ProviderUser | null>;
    /**
     * The listener signs out. The account leaves the screen as soon as this is called, and what
     * shows the account asks the adapter again then: whatever the adapter answers such questions
     * from is dropped before the first wait in here (account/accountRead.ts).
     */
    logout(): Promise<void>;
    /**
     * The platform names nobody, or refuses the sign-in, and the account is about to leave the
     * screen: the adapter drops what it keeps of that sign-in and account. Called before the
     * account store changes; what it returns is waited for after. Left out where the adapter
     * keeps nothing.
     */
    signInRanOut?(): void | Promise<void>;
    /**
     * True where the sign-in goes with what this page keeps of the account: the account kept on
     * disk is shown at once at app start, while the platform is asked who is signed in, and while
     * nobody is shown the account shows as being found out. Without it nothing kept is shown
     * until the platform has named the same user (account/accountRead.ts).
     */
    showsKeptAccountAtStart?: boolean;
    /**
     * What a build from before the account snapshot kept of the signed-in account, asked for where
     * no snapshot is found; null where there is nothing. Only for an adapter that had such caches.
     */
    oldKeptAccount?(): Promise<{ user: ProviderUser; collections: ProviderCollection[]; likedSongIds: MediaId[] } | null>;
    /**
     * What `oldKeptAccount` answered has been saved as the snapshot: the adapter removes those caches,
     * so that they are not made a snapshot again over a newer one. Not called where the save failed:
     * the caches are then asked for again at the next start. Never rejects.
     */
    forgetOldKeptAccount?(): Promise<void>;
    // 登录窗口里这个平台自己的标题和说明。
    getLoginTexts?(): LoginTexts;
    // 登录要靠的本地服务：它没起来时登录窗口显示它的错误原话和重启的按钮。
    localService?: LoginLocalService;
    getLoginMethods?(): LoginMethod[];
    // 需要远端能力发现的 provider 在这里等待结果；UI 用同一份返回值决定单步或多步流程。
    resolveLoginMethods?(): Promise<LoginMethod[]>;
    startLogin?(methodId?: string): Promise<string>;
    // —— 表单式登录（账号密码类平台）——
    // 声明后登录窗口按此渲染表单（替代扫码/浏览器确认流程）；提交后 provider 完成登录。
    getLoginForm?(): ProviderLoginForm;
    submitLoginForm?(values: Record<string, string>): Promise<unknown>;
    // 登录的某一步抛了错时，provider 把自己的错误翻成共用的事实，或者直接点名是哪一种情况；没有可说的
    // 就回 null，由共用的规则去分（services/onlineMusic/login/loginFailureCase.ts）。在失败之后才被问到，自己不抛错。
    describeLoginFailure?(step: LoginStep, error: unknown): LoginFailureDetail | null;
    createQr?(key: string): Promise<string>;
    // 不靠扫码、而是在浏览器里确认的登录：provider 实现 createQr 或这一个其中之一；轮询、取消、
    // 过期仍走同一套 key 流程。它在系统浏览器里打开登录的页面，地址由 provider 自己决定，调用方
    // 不传 URL。没有图片可看，UI 开始登录时就打开这个页面（Spotify）。
    openLoginPage?(key: string): Promise<void>;
    // 这一次登录的页面是不是 provider 在开始登录时自己打开的、之后也不能再打开一次（YouTube Music
    // 的浏览器登录：那个窗口关掉就是登录结束）。是的话 UI 不在开始时打开它，也不留“重新打开”的按钮。
    opensLoginPageItself?(key: string): boolean;
    checkLogin?(key: string): Promise<LoginState>;
    // 只释放这一把 key 的会话，实现必须是幂等的：调用方在关窗时 fire-and-forget，
    // 未知或已过期的 key 也算成功。没有会话概念的 provider 不必实现。
    cancelLogin?(key: string): Promise<void>;
    // 这一次登录的有效期。声明了它，UI 才会自己计时并在到点时停止轮询、给出重试；
    // 不声明就沿用原本的做法——只认后端报出的过期状态。
    getLoginTtlMs?(): number;
    // 登录失败后附进诊断报告的 provider 专属信息，每项一行。
    // 只能返回可以公开贴出来的内容：不含 cookie、token、IP 或账号信息。
    getLoginDiagnostics?(): Promise<LoginDiagnosticLine[]>;
    // 主动自检：登录失败后由登录调用一次，结果进诊断报告，结论显示在登录窗口上。
    // canRunLoginSelfCheck 同步回答此刻能不能检查（界面据此决定要不要显示「正在检查」）。
    canRunLoginSelfCheck?(): boolean;
    runLoginSelfCheck?(): Promise<LoginSelfCheckResult | null>;
    // 登录确认、账号读到之后多走的一步：查这个账号此刻能不能用（例如能不能播放）。回一份配置清单，
    // 登录窗口就停在清单上让用的人做完；回 null 是没有要做的。methodId 是这一次选的登录方式。
    // 有时限，超时或抛错都当作 null：这一步挡不住登录。
    checkAfterLogin?(methodId: string | null): Promise<ProviderSetupView | null>;
    // 平台此刻的配置清单（登录之后也能从账号那一幅打开）；此刻没有要配置的回 null。窗口开着清单时会反复问它。
    getSetup?(): Promise<ProviderSetupView | null>;
    // 做清单上的一个操作，回做完之后的清单。value 是 submit-secret 交出的内容。操作失败写在回的清单里，不抛错。
    runSetupAction?(stepId: string, actionId: string, value?: string): Promise<ProviderSetupView>;
}

declare const builtDiagnosticLine: unique symbol;

// 诊断报告里 provider 自己的一行。写它只有一条路：services/onlineMusic/login/loginDiagnosticReport.ts 的
// diagnosticLine。不是它写出来的行（一个 mod 交来的字符串，或者随便什么），报告整行转成字符串再印。
export interface LoginDiagnosticLine {
    readonly text: string;
    readonly [builtDiagnosticLine]: true;
}

/** What a read of an account's liked songs brought. */
export interface ProviderLikedSongIds {
    ids: MediaId[];
    /**
     * False whenever the adapter cannot be sure it reached the end of the list: it stopped at a
     * limit of its own, the list is short of the count the platform gives, a page token came
     * twice, or a full page named no next one. Songs past that point may be liked too.
     */
    whole: boolean;
}

export interface OnlineLibraryProvider {
    /** One favorite identity across catalog/library aliases; omitted when playback IDs already match. */
    getSongLikeId?(song: SongResult): MediaId;
    getUserPlaylists(userId: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    /**
     * The id of every liked song. A page the adapter knows it could not read throws. An adapter
     * cannot always know: on some platforms such a page reads as an empty list, so an empty
     * answer does not prove that the account likes nothing (account/keptAfterRead.ts).
     */
    getLikedSongIds?(userId: MediaId): Promise<ProviderLikedSongIds>;
    /**
     * How many songs the platform says the account's liked list holds, in one request; null where
     * its answer names no count. An adapter with no way to ask short of reading the list leaves
     * this out. The count need not be the number of ids `getLikedSongIds` brings (a platform may
     * count songs its list no longer shows): it is only compared with the count of another time
     * (account/readMoments.ts). The answer is the platform's present one, from no cache.
     */
    getLikedSongCount?(userId: MediaId): Promise<number | null>;
    /**
     * Whether each of these songs is liked, by song id, in one request (at most
     * `LIKED_CHECK_SLICE` ids); a song the platform says nothing of is left out. Asked for the
     * songs played and queued where the newest read of the liked ids (`getLikedSongIds`, or the
     * liked list's own read) was not whole (account/likedChecks.ts). An adapter whose
     * `getLikedSongIds` reads the list whole every time leaves this out.
     */
    areSongsLiked?(ids: MediaId[]): Promise<Record<string, boolean>>;
    getUserAlbums?(userId: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    /** The entry that stands for the account's cloud songs among its collections; null where it has none to show. */
    getCloudCollection?(user?: ProviderUser): Promise<ProviderCollection | null>;
    /**
     * The entries that stand for the account's listening ranking among its collections, one a span
     * (type `listening_rank`, `listeningRank` set), with ids that name the user. A span the platform
     * answers with nothing for (no plays, or a ranking the account keeps hidden) has no entry. Throws
     * where the platform could not be read.
     */
    getListeningRankCollections?(user: ProviderUser): Promise<ProviderCollection[]>;
}

export interface OnlineCatalogProvider {
    canResolveSongCatalogRefs?(song: UnifiedSong): boolean;
    resolveSongCatalogRefs?(song: UnifiedSong): Promise<UnifiedSong>;
    getPlaylistTracks?(id: MediaId, limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    getPlaylistDetail?(id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null>;
    getCloudTracks?(limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    /** The ranking's songs in the platform's order, each with the `listenCount` it gives where it gives one. */
    getListeningRankTracks?(range: ListeningRankRange, limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    getAlbumTracks?(id: MediaId, limit?: number, offset?: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    getAlbumDetail?(id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null>;
    getArtistSongs?(id: MediaId, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>>;
    getArtistAlbums?(id: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    getArtistDetail?(id: MediaId): Promise<ProviderCollection | null>;
    getSubscriptionStatus?(type: 'playlist' | 'album', id: MediaId, collection?: ProviderCollection): Promise<boolean>;
}

/**
 * Personal FM tuning, provider-neutral on purpose: only NetEase's `/personal/fm/mode` understands
 * these, and a provider without the concept ignores them rather than failing the call.
 */
export interface PersonalFmRequestOptions {
    mode?: string;
    submode?: string | null;
    /** One of the provider's extra radios; absent for its Personal FM. A provider without stations ignores it. */
    station?: string | null;
}

/**
 * The styles daily recommendations can be narrowed to, in the provider's own groups (genre, mood,
 * scene, language…) and words. Ids are the provider's, written as strings.
 */
export interface DailyStyleGroup {
    id: string;
    name: string;
    tags: { id: string; name: string }[];
}

/** The styles an account has picked: some tags of one group (a provider takes tags of a single group only). */
export interface DailyStyleSelection {
    groupId: string;
    tagIds: string[];
}

/** The daily songs of the picked styles, and the pick they were made for (null where the provider does not say). */
export interface DailyStyleSongs {
    songs: UnifiedSong[];
    selection: DailyStyleSelection | null;
}

/**
 * Words a provider shows with its recommendation preferences: `labelKey` is an i18n key for the
 * user's language, `labelFallback` the provider's own words, shown when the key has no text.
 */
export interface RecommendationPreferenceLabel {
    labelKey?: string;
    labelFallback: string;
}

/** A preference picked from a few options (any number of them), each with the provider's own value. */
export interface RecommendationPreferenceChoice {
    kind: 'choice';
    key: string;
    label: RecommendationPreferenceLabel;
    options: { value: string; label: RecommendationPreferenceLabel }[];
    value: string;
    defaultValue: string;
}

/**
 * A preference on a scale from less to more, the default somewhere between. The numbers are the
 * provider's; the app shows "less … default … more" and no number. `snapWithin`: a value this
 * close to the default is taken for the default.
 */
export interface RecommendationPreferenceRatio {
    kind: 'ratio';
    key: string;
    label: RecommendationPreferenceLabel;
    min: number;
    max: number;
    defaultValue: number;
    snapWithin?: number;
    value: number;
}

/**
 * One recommendation preference. Further kinds may come; the app passes over a kind it does not
 * know, neither showing it nor sending it back.
 */
export type RecommendationPreferenceItem = RecommendationPreferenceChoice | RecommendationPreferenceRatio;

/** The account's recommendation preferences, and a line on what they reach (the provider's words). */
export interface RecommendationPreferences {
    items: RecommendationPreferenceItem[];
    note?: RecommendationPreferenceLabel;
}

/** What changed, by preference key: the option's value for a choice, the number for a ratio. */
export type RecommendationPreferenceChanges = Record<string, string | number>;

/** `confirmed` is false when the provider saved but read back something else, or could not read back. */
export interface RecommendationPreferencesSaveResult {
    confirmed: boolean;
}

/** Where the app offers the account's recommendation preferences. */
export type RecommendationPreferenceEntry = 'explore' | 'personal-fm' | 'daily';

export interface OnlineRecommendationProvider {
    /** The mode choices of the Personal FM, or of the extra radio `station` when one is asked for. */
    getPersonalFmCatalog?(station?: string): Promise<PersonalFmCatalog>;
    getDailySongs?(refresh?: boolean): Promise<UnifiedSong[]>;
    getPersonalFm?(options?: PersonalFmRequestOptions): Promise<UnifiedSong[]>;
    getRecommendedCollections?(limit: number): Promise<ProviderCollection[]>;
    getHistoryEntries?(): Promise<ProviderHistoryEntry[]>;
    getHistoryDates?(): Promise<string[]>;
    getHistorySongs?(entry: ProviderHistoryEntry | string): Promise<UnifiedSong[]>;
    /** `removed`: the song was blacklisted with no replacement; the daily view drops the row. */
    dislikeSong?(id: MediaId): Promise<{ replacement?: UnifiedSong; limitReached?: boolean; removed?: boolean }>;
    /** The style groups to pick from (capability `dailyStyleRecommendations`). */
    getDailyStyleGroups?(): Promise<DailyStyleGroup[]>;
    getDailyStyleSongs?(): Promise<DailyStyleSongs>;
    /** Saves the pick on the account; the next `getDailyStyleSongs` answers for it. */
    setDailyStyle?(selection: DailyStyleSelection): Promise<void>;
    /**
     * Where the app offers the account's recommendation preferences (capability
     * `recommendationPreferences`); the command palette offers them wherever they are supported.
     */
    preferenceEntries?: readonly RecommendationPreferenceEntry[];
    getRecommendationPreferences?(): Promise<RecommendationPreferences>;
    /**
     * Saves what changed and nothing else; the provider writes it the way its platform takes it
     * (the whole set, or the changed fields alone).
     */
    saveRecommendationPreferences?(changes: RecommendationPreferenceChanges): Promise<RecommendationPreferencesSaveResult>;
}

/**
 * One entry of a recommendation page: a song to play, or a card that opens a collection.
 * `wideCoverUrl` is the address of the entry's wide picture (a video still), where it has
 * one: the picture's content is its central 16:9, and what lies outside may be padding.
 * Without it the entry's own cover is its picture, and is taken for a square.
 * `isMix` marks a list the provider makes up anew every time it is opened. No library keeps
 * one, so a card names it as something else than a playlist.
 * `subtitle` is the entry's second line where the provider words it itself (Spotify's adapter
 * does). Without it the line is the artists' names or the list's maker, else what the entry is.
 */
export type ProviderExploreItem =
    | { kind: 'song'; song: UnifiedSong; wideCoverUrl?: string; subtitle?: string }
    | { kind: 'collection'; collection: ProviderCollection; wideCoverUrl?: string; isMix?: boolean; subtitle?: string };

export interface ProviderExploreSection {
    id: string;
    /** The provider's own heading, in the language its pages are read in. May be empty. */
    title: string;
    items: ProviderExploreItem[];
    /** Present when the section has further items; handed back to `getSectionItems`. */
    moreCursor?: string;
    /**
     * Set on a section the provider makes up anew for every read of the page, under another
     * heading. Read anew, the page gives the place of such a section to one of these that the
     * new read brought, in the order they stand and came; it does not keep the one and add the other.
     */
    changesWithRead?: boolean;
}

export interface ProviderExplorePage {
    sections: ProviderExploreSection[];
    /** Present when the page has further sections; handed back to `getFeed`. */
    nextCursor?: string;
    /**
     * Set on the answer to a read from the start by a provider whose page changes only by being
     * read anew: "refresh" then reads the page anew at once, and asks no section to go on through
     * its `moreCursor`, which serves the section's "more" alone. Without it "refresh" is as
     * `OnlineExploreProvider` says.
     */
    refreshReadsAnew?: boolean;
}

export interface ProviderExploreItemsPage {
    items: ProviderExploreItem[];
    moreCursor?: string;
}

/**
 * The provider's own recommendation page (its "home" or "discover"): sections it picks for the
 * account, each a heading over songs and collections of any type. A provider decides what the
 * sections are; the cursors are opaque to callers.
 * Not part of it: the provider's record of what the account itself played ("recently played",
 * "listen again"). The explore page has those sections from the app's own record of plays, the
 * same under every provider; a provider whose page brings such sections leaves them out.
 * A provider need not make the page up anew for every read. "Refresh" therefore shows a
 * section's further items first (`getSectionItems`): a section that has more than it first hands
 * out names them with `moreCursor`, or it has nothing to change to until the page is read anew.
 * A provider whose sections change only with such a read says so with the page it answers
 * (`ProviderExplorePage.refreshReadsAnew`, NetEase's adapter does): every "refresh" is then a
 * read anew, and a `moreCursor` only opens further items of its section ("more").
 * A cursor, of a section or of the page, stands only until the page is next read from its start
 * (`getFeed()` without one). A provider whose cursors name places on the page rather than
 * sections (YouTube's do) must answer one of an earlier read with nothing, never with what
 * stands at that place now. The explore page asks with none of an earlier read once a later one
 * has arrived; after one that failed it may still ask with those it holds.
 * `listened` comes with a read from the start: songs of this provider the listener played in
 * the app, the ones they come back to first. A provider may make sections of its own out of
 * them (YouTube's and Spotify's adapters: the songs like one of them).
 */
export interface OnlineExploreProvider {
    getFeed(cursor?: string, listened?: UnifiedSong[]): Promise<ProviderExplorePage>;
    getSectionItems?(cursor: string): Promise<ProviderExploreItemsPage>;
    /**
     * Of the songs played here, as the app recorded them, which song the platform shows each as, by
     * the id of each: another song (a music video as its song version), or null for the song itself.
     * One the platform could not be asked about is left out. The app's own record of the songs
     * played is set right with them, once a run (ownSections.ts).
     */
    songsShownAs?(songs: UnifiedSong[]): Promise<Map<string, UnifiedSong | null>>;
}

export interface OnlineMutationProvider {
    canAddToPlaylist?(playlist: ProviderCollection): boolean;
    /** 这个歌单能不能进编辑模式加删歌（「我喜欢」另走 likeSong）；不实现视为能。给自建却不收写入的歌单（不是普通目录的）用。 */
    canEditPlaylistTracks?(playlist: ProviderCollection): boolean;
    likeSong?(song: MediaId | SongResult, liked: boolean): Promise<void>;
    updatePlaylistTracks?(
        operation: 'add' | 'del',
        playlist: MediaId | ProviderCollection,
        tracks: Array<MediaId | SongResult>,
    ): Promise<void>;
    /** Makes an empty playlist of the account's own; without it, the app offers none to make. */
    createPlaylist?(name: string): Promise<ProviderCollection>;
    /** Whether this album or playlist can be saved to the account's library; without it, any can. */
    canSubscribe?(collection: ProviderCollection): boolean;
    subscribePlaylist?(playlist: MediaId | ProviderCollection, subscribed: boolean): Promise<void>;
    subscribeAlbum?(id: MediaId, subscribed: boolean): Promise<void>;
}

// Something a provider has to tell the listener unasked. The text is an i18n key, translated by the UI.
export interface ProviderNotice {
    type: 'error' | 'success' | 'info';
    textKey: string;
    params?: Record<string, string>;
    // Two notices with the same nonce are the same notice.
    nonce?: number;
    durationMs?: number;
}

// 平台后端原始接口的一类：read 只读，write 会改动账号里的数据，denied 永远拒绝（登录、会话、凭据，
// 以及把任意请求转发出去的透传接口）。
export type ProviderRawEndpointAccess = 'read' | 'write' | 'denied';

// 分类表里的一行。
export interface ProviderRawEndpoint {
    access: ProviderRawEndpointAccess;
    // 已经有对应能力的 omni 方法名（例如 'getLyrics'）：调用方应改用它。
    omni?: string;
    // 指明「当前登录用户」的参数名（例如 'uid'）：调用方没给时由 omni 填上当前账号的用户 id。
    selfParam?: string;
}

/**
 * 平台后端的原始接口：调用平台还没有做进 omni 的专有能力的后备通道（Folium 实验接口 `platform.raw`）。
 * 只有 omni 调它；回答是平台原始的 JSON，跟随宿主钉住的后端库版本，不承诺稳定。会话由 provider 自己
 * 补上，调用方碰不到凭据；接口分类表由平台自己维护，表外的接口按拒绝处理。
 */
export interface OnlineRawRequestProvider {
    // 宿主钉住的后端库：名字和版本，取自包的元数据。
    backend: { name: string; version: string };
    // 由宿主自己设置、调用方不能给的参数名（会话、代理、来源 IP 这类）。
    reservedParams: readonly string[];
    // 这个平台自己的凭据字段名（例如它的会话 cookie 的名字）：回答里这些字段和共用的那几种
    // （cookie、token 等，见 rawResponse.ts）一起剥掉。
    credentialFields?: readonly string[];
    // 一个接口属于哪一类；不在表里回 null。
    describeEndpoint(endpoint: string): ProviderRawEndpoint | null;
    // 检查参数的取值，名字之外的那一层：后端会把一些参数原样拼进上游请求的路径（例如 id），这些参数只收
    // 平台认得的格式，免得 `../` 之类的取值把带着会话的请求引到表外的接口。有问题回一句说明，没有回 null。
    checkParams?(endpoint: string, params: Record<string, JsonValue>): string | null;
    // 发出请求，回平台原始的回答。参数已经过 omni 校验；`signal` 中止时请求跟着中止。时限由 provider
    // 自己定（照它别的在线请求）。登录失效抛 auth-required，被限流抛带 HTTP 429 的 OnlineProviderError。
    request(endpoint: string, params: Record<string, JsonValue>, signal: AbortSignal): Promise<unknown>;
}

export interface OnlineMusicProvider {
    id: OnlineProviderId;
    displayName: string;
    shortName?: string;
    /** 界面上显示的平台名（i18n key）；不给就用 shortName / displayName。名字由界面翻译。 */
    shortNameKey?: string;
    mark?: ProviderMark;
    getAvailability?(): ProviderAvailability;
    /**
     * What the provider watches for as long as the app is open (a local service of its own that
     * may fail to start), telling the listener through `tell`. Started once the app is up;
     * answers with the way to stop it. Left out where there is nothing to watch.
     */
    watch?(tell: (notice: ProviderNotice) => void): () => void;
    /**
     * 要一首歌的播放地址、或者读一个集合的歌曲抛了错时，provider 把自己的错误翻成共用的事实，或者直接点名
     * 是哪一种情况；没有可说的就回 null，由共用的规则去分（services/onlineMusic/failure/onlineFailureCase.ts）。
     * 在失败之后才被问到，自己不抛错。
     */
    describeFailure?(operation: OnlineFailureOperation, error: unknown): OnlineFailureDetail | null;
    capabilities: ProviderCapabilities;
    normalizeSong(raw: unknown): UnifiedSong;
    normalizeUser?(raw: unknown): ProviderUser;
    normalizeCollection?(raw: unknown, type?: string): ProviderCollection;
    songMetadata?: OnlineSongMetadataProvider;
    getSongPageUrl?(song: SongResult): string | null;
    search?: OnlineSearchProvider;
    playback?: OnlinePlaybackProvider;
    /** A player outside this app that sounds this provider's songs (see the capability of the same name). */
    externalPlayback?: OnlineExternalPlaybackProvider;
    playbackReports?: OnlinePlaybackReportProvider;
    lyrics?: OnlineLyricsProvider;
    auth?: OnlineAuthProvider;
    library?: OnlineLibraryProvider;
    catalog?: OnlineCatalogProvider;
    recommendations?: OnlineRecommendationProvider;
    explore?: OnlineExploreProvider;
    mutations?: OnlineMutationProvider;
    /** 平台后端的原始接口（OnlineRawRequestProvider）；没有它的平台不能直通。 */
    raw?: OnlineRawRequestProvider;
}

// Public canonical contract consumed through the omni facade. Provider-prefixed
// names above remain internal adapter vocabulary while the migration completes.
export type OmniProviderId = OnlineProviderId;
export type OmniMediaId = MediaId;
export type OmniProviderCapabilities = ProviderCapabilities;
export type OmniProviderAvailability = ProviderAvailability;
export type OmniProviderSummary = ProviderAccountSummary;
export type OmniAccountState = ProviderAccountSummary;
export type OmniPage<T> = ProviderPage<T>;
export type OmniAudioSource = ProviderAudioSource;
export type OmniSongAvailability = ProviderSongAvailability;
export type OmniSongReplacement = ProviderSongReplacement;
export type OmniLyricsResult = ProviderLyricsResult;
export type OmniPlaybackReport = ProviderPlaybackReport;
export type OmniChorusRange = ChorusRange;
export type OmniAlbum = ProviderAlbumSummary;
export type OmniArtist = ProviderArtistSummary;
export type OmniUser = ProviderUser;
export type OmniCollection = ProviderCollection;
export type OmniHistoryEntry = ProviderHistoryEntry;
export type OmniSongUnavailableReason = ProviderSongUnavailableReason;
export type OmniExploreItem = ProviderExploreItem;
export type OmniExploreSection = ProviderExploreSection;
export type OmniExplorePage = ProviderExplorePage;
export type OmniExploreItemsPage = ProviderExploreItemsPage;
export type OmniSearchKind = ProviderSearchKind;
export { OnlineProviderError as OmniError };

/**
 * Runs one request omni makes to a provider for a caller that counts or limits them
 * (`omni.getSongDetails`). It may refuse a request by rejecting without running `work`, or stop
 * waiting for one that runs by rejecting before `work` settles.
 */
export type OmniRequestRunner = <T>(work: () => Promise<T>) => Promise<T>;

/**
 * What `omni.getSongDetails` found for one id.
 * `found`: the song. `missing`: the provider answered and has no song by that id.
 * `failed`: the request to the provider that was to answer it failed with `error` (a request for
 * many ids fails them all); the ids after it are still asked.
 * `skipped`: no answer for it came through the caller's `run`, which refused that request or an
 * earlier one, or stopped waiting for it; `error` is what `run` rejected with. Nothing after it was
 * asked.
 */
export type OmniSongDetail =
    | { status: 'found'; song: UnifiedSong }
    | { status: 'missing' }
    | { status: 'failed'; error: unknown }
    | { status: 'skipped'; error: unknown };
