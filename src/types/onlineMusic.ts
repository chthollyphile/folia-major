import type { LyricData, ReplayGainInfo, SongResult, UnifiedSong } from '../types';

// src/types/onlineMusic.ts

export type MediaId = string | number;
export type OnlineProviderId = 'netease' | (string & {});
export type AudioQualityPreference = 'standard' | 'high' | 'lossless' | 'hires';
export type ProviderCatalogEntityKind = 'album' | 'artist' | 'playlist';

export interface ProviderCatalogRef {
    providerId: OnlineProviderId;
    kind: ProviderCatalogEntityKind;
    id: MediaId;
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
    historyRecommendations?: boolean;
    playlistSubscription?: boolean;
    playlistTrackMutations?: boolean;
    likes?: boolean;
    userAlbums?: boolean;
    /** The provider accepts a listening report for a track the user actually played. */
    playbackReports?: boolean;
    /** The provider exposes a read-only song comment list. */
    comments?: boolean;
}

export interface ProviderAvailability {
    configured: boolean;
    reason?: 'not-configured' | 'runtime-unavailable';
}

export interface ProviderAccountSummary {
    providerId: OnlineProviderId;
    displayName: string;
    shortName: string;
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

export interface ProviderCollection {
    providerId: OnlineProviderId;
    id: MediaId;
    name: string;
    type: 'playlist' | 'album' | 'artist' | 'radio' | 'cloud' | string;
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

export type QrLoginState =
    | { state: 'waiting' }
    | { state: 'scanned' }
    | { state: 'confirmed' }
    | { state: 'expired' }
    | {
        state: 'error';
        message?: string;
        /** 结构化的失败原因；provider 能确定时才给（例如用户在手机上取消了登录）。 */
        reason?: QrLoginErrorReason;
        /** 后端要求的冷却时长：这段时间内重新要码只会被拒（429），界面应先等它结束。 */
        retryAfterMs?: number;
        /**
         * 这次轮询在网络层失败（没拿到上游的回应，例如连接被重置）：二维码在服务端仍然有效，
         * 会话会接着轮询，连续失败超过上限才算登录失败。
         */
        transient?: boolean;
        /** 后端返回的原始字段（返回码、失败阶段与原因等），原样进诊断时间线。 */
        detail?: Record<string, unknown>;
    };

/**
 * 扫码失败的结构化原因：「在手机上取消」是用户自己的操作，不需要诊断入口；「连接被重置」是轮询请求被
 * 上游直接断开，同一网络出口和设备标识下反复重试多半无效，界面要提示换网络或重启应用；「登录设备超限」是
 * 账号侧的原因（QQ 音乐凭据交换返回 20279），重启和换网络都没用，界面要引导用户去清理登录设备。
 */
export type QrLoginErrorReason = 'canceled-on-device' | 'connection-reset' | 'device-limit';

// 扫码登录失败的几种形态，决定登录弹窗要不要给出「复制诊断信息」入口。
// 没扫码就过期属于正常情况，不算失败；扫过码却过期，多半是手机端确认被拒。
export type QrLoginFailureKind =
    | 'start-error'
    | 'check-error'
    | 'expired-after-scan'
    | 'account-refresh-failed'
    // 用户在手机上取消了这次登录：照常可以重试（可能要先等冷却），不给诊断入口。
    | 'canceled-on-device'
    // 轮询请求被上游断开（ECONNRESET）：照常给诊断入口，状态行提示换网络或重启应用。
    | 'connection-reset'
    // 账号的登录设备数已达上限：照常给诊断入口，简单办法换成清理登录设备的步骤。
    | 'device-limit';

export type ProviderErrorCode =
    | 'auth-required'
    | 'unsupported'
    // 集合设为不公开，当前这条读取路径没资格读它。与 `unsupported`（这个后端或 provider 没有这项能力）
    // 分开，界面才能只在这种情况下给出「不是公开歌单」的解释。
    | 'not-public'
    // 播放链路上表示「服务未配置 / 后端未运行 / 需要桌面版 / provider 未注册」，从不表示歌曲下架。
    | 'unavailable'
    // 上游有应答但没给可播放音源，原因无法证实；播放侧归为 unknown。
    | 'not-playable'
    | 'preview-only'
    | 'region-restricted'
    | 'network'
    | 'invalid-response'
    // —— 以下只在 adapter 掌握对应证据时抛出 ——
    | 'timeout'
    | 'rate-limited'
    | 'service-unavailable'
    | 'membership-required'
    | 'purchase-required'
    // 缺少播放权限，但平台没区分会员还是购买。
    | 'entitlement-required'
    // 上游在单次请求中明确表示已下架。当前内置 provider 都没有经核实的此类信号；新增产出点必须附真实响应样本测试。
    | 'taken-down';

/** auth-required 的细分：本地没有会话（signed-out），或持有的会话被上游拒绝（expired）。 */
export type ProviderAuthState = 'signed-out' | 'expired';

/** 一次音源请求尝试留下的诊断证据；UI 不得按 stage / upstreamCode 分支。 */
export interface ProviderPlaybackAttempt {
    /** 'song_url' | 'user_cloud_url' | 'legacy_play_info' | 'music_play' ... */
    stage: string;
    quality?: AudioQualityPreference;
    /** KuGou: 'metadata' | 'hash-only' | 'cloud' */
    variant?: string;
    /** empty = 服务有应答但没给 URL */
    outcome: 'empty' | 'error';
    code?: ProviderErrorCode;
    httpStatus?: number;
    /** 沿用 qq-music-api / bodian-music-api 的命名；不叫 code */
    upstreamCode?: number | string;
    retryAfterMs?: number;
    transient?: boolean;
    /** 后端原文，例如 QQ 的 '暂无播放链接' */
    detail?: string;
}

export interface OnlineProviderErrorDetails {
    /** 'config' | 'backend' | 'runtime' | 'ipc' | 'upstream' | 'local-api' | 'song-url' | 'audio-source' ... */
    stage?: string;
    upstreamCode?: number | string;
    /** 仅 adapter 能证明时写 */
    auth?: ProviderAuthState;
    /** false = 已证实持久（未配置 / 需桌面版）；true = 已证实暂时；缺省 = 未知 */
    transient?: boolean;
    /** 没有会话且上游只是没给链接：登录“可能”有用，不能断定为 auth-required */
    signInMayHelp?: boolean;
    attempts?: readonly ProviderPlaybackAttempt[];
}

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
        /** 诊断与归一化证据。追加在末尾，现有按位置传参的调用不用改。 */
        public readonly details?: OnlineProviderErrorDetails,
    ) {
        super(message);
        this.name = 'OnlineProviderError';
    }
}

/** 搜索框联想的单条建议：value 是选中后填进搜索框的文本，detail 是副行（如歌手名）。 */
export type OnlineSearchSuggestion = {
    kind: 'song' | 'singer';
    value: string;
    detail?: string;
    /** 单曲联想带一份正规化好的可播歌曲：点联想直接播，不经过结果页。 */
    song?: UnifiedSong;
};

export interface OnlineSearchProvider {
    searchSongs(query: string, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>>;
    /** 输入联想（QQ smartbox）。没实现就没有联想，调用方按空数组处理。 */
    getSmartboxSuggestions?(query: string): Promise<OnlineSearchSuggestion[]>;
    /** 专辑/歌单类型搜索，返回集合卡；点卡片走现有集合详情，不新做 UI。 */
    searchCollections?(query: string, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
}

export interface OnlinePlaybackProvider {
    getSongDetail(id: MediaId): Promise<UnifiedSong | null>;
    getAudioSource(song: SongResult, quality: AudioQualityPreference): Promise<ProviderAudioSource | null>;
    getAvailability?(song: SongResult): ProviderSongAvailability;
    getReplacement?(song: SongResult): Promise<ProviderSongReplacement | null>;
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
    reportPlayback(song: SongResult, report: ProviderPlaybackReport): Promise<void>;
}

export interface OnlineLyricsProvider {
    getLyrics(song: SongResult, context?: { userId?: MediaId | null }): Promise<ProviderLyricsResult>;
    getChorusRanges?(songId: MediaId): Promise<ChorusRange[]>;
}

export interface OnlineSongMetadataProvider {
    getSongMetadata(song: SongResult): ProviderSongMetadata;
}

// provider 自行声明它支持哪几种扫码登录方式；不声明即代表只有单一方式，UI 维持单步流程。
export interface QrLoginMethod {
    id: string;          // 传给后端的识别值（QQ: 'qq' | 'wechat'）
    labelKey: string;    // i18n key，由 UI 层翻译
    iconKey: string;     // 图标识别值，由 UI 层映射到静态资源
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
    /** 桌面版的凭据加密后端（safeStorage）；Linux 上为 basic_text 时 QQ 的登录态无法保存。网页版没有。 */
    credentialStore?: { encryptionAvailable?: boolean; backend?: string | null; error?: string } | null;
};

export interface OnlineAuthProvider {
    getLoginStatus(): Promise<ProviderUser | null>;
    logout(): Promise<void>;
    getQrLoginMethods?(): QrLoginMethod[];
    // 需要远端能力发现的 provider 在这里等待结果；UI 用同一份返回值决定单步或多步流程。
    resolveQrLoginMethods?(): Promise<QrLoginMethod[]>;
    getQrKey?(methodId?: string): Promise<string>;
    createQr?(key: string): Promise<string>;
    checkQr?(key: string): Promise<QrLoginState>;
    // 只释放这一把 key 的会话，实现必须是幂等的：调用方在关窗时 fire-and-forget，
    // 未知或已过期的 key 也算成功。没有会话概念的 provider 不必实现。
    cancelQr?(key: string): Promise<void>;
    // 二维码的有效期。声明了它，UI 才会自己计时并在到点时停止轮询、给出重试；
    // 不声明就沿用原本的做法——只认后端报出的过期状态。
    getQrTtlMs?(): number;
    // 扫码登录失败后附进诊断报告的 provider 专属信息，每项一行、已格式化好（后端状态、拉起步骤、请求与连接记录等）。
    // 报告会贴进公开的 issue，界面已告知用户其中包含哪些数据；登录凭据（cookie、token、session）的值不能出现。
    getQrLoginDiagnostics?(): Promise<string[]>;
    // 主动自检：扫码登录失败后由会话调用一次，结果进诊断报告，结论显示在登录界面上。
    // canRunQrLoginSelfCheck 同步回答此刻能不能检查（界面据此决定要不要显示「正在检查」）。
    canRunQrLoginSelfCheck?(): boolean;
    runQrLoginSelfCheck?(): Promise<LoginSelfCheckResult | null>;
}

export interface OnlineLibraryProvider {
    getUserPlaylists(userId: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    getLikedSongIds?(userId: MediaId): Promise<MediaId[]>;
    /** Full liked-track records, used when a provider needs more than the song id (e.g. KuGou fileId). */
    getLikedSongs?(userId: MediaId): Promise<UnifiedSong[]>;
    getUserAlbums?(userId: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    getCloudCollection?(user?: ProviderUser): Promise<ProviderCollection | null>;
}

/**
 * 歌单分类树（QQ 的「语种/流派/主题/心情/场景」分组）。
 *  与  均为上游原生 id（字符串，不拆解），
 * UI 只负责展示与选中，取数时原样交回 provider。
 */
export interface ProviderSongListCategoryGroup {
    id: string;
    label: string;
    items: ProviderSongListCategoryItem[];
}

export interface ProviderSongListCategoryItem {
    id: string;
    label: string;
}

export interface OnlineCatalogProvider {
    canResolveSongCatalogRefs?(song: UnifiedSong): boolean;
    resolveSongCatalogRefs?(song: UnifiedSong): Promise<UnifiedSong>;
    getPlaylistTracks?(id: MediaId, limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    getPlaylistDetail?(id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null>;
    getCloudTracks?(limit: number, offset: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    getAlbumTracks?(id: MediaId, limit?: number, offset?: number, collection?: ProviderCollection): Promise<ProviderPage<UnifiedSong>>;
    getAlbumDetail?(id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null>;
    getArtistSongs?(id: MediaId, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>>;
    getArtistAlbums?(id: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
    getArtistDetail?(id: MediaId): Promise<ProviderCollection | null>;
    getSubscriptionStatus?(type: 'playlist' | 'album', id: MediaId, collection?: ProviderCollection): Promise<boolean>;
    /** 歌单分类树；没实现就没有分类筛选入口。 */
    getSongListCategories?(): Promise<ProviderSongListCategoryGroup[]>;
    /** 按分类取歌单广场（排序固定最热）。 */
    getCategorySongLists?(categoryId: string, limit: number, offset: number): Promise<ProviderPage<ProviderCollection>>;
}

/**
 * Personal FM tuning, provider-neutral on purpose: only NetEase's `/personal/fm/mode` understands
 * these, and a provider without the concept ignores them rather than failing the call.
 */
export interface PersonalFmRequestOptions {
    mode?: string;
    submode?: string | null;
}

export interface OnlineRecommendationProvider {
    getDailySongs?(refresh?: boolean): Promise<UnifiedSong[]>;
    getPersonalFm?(options?: PersonalFmRequestOptions): Promise<UnifiedSong[]>;
    /**
     * `context.seedSongId` 让 provider 能补一段「与当前这首相关」的内容。没有种子就只给
     * 账号级的推荐 —— 传不传都必须能用，所以它是可选参数而不是另开一个方法。
     *
     * `context.scope` 选要哪一半：'personalized' 只要「跟这个账号有关」的（猜你喜欢/相似/雷达/新歌），
     * 'editorial' 只要编辑选出来的歌单广场，'all'（默认）都要。
     * 两个首页入口是两个语义不同的面：发现是「给你的」，电台是「大家都在听的」。
     * 不分开的话两个 tab 会长得一模一样，用户无从判断该点哪个。
     * `context.from` 是歌单广场的批次偏移（换一批用）；provider 不支持就当 0，不支持换批不算错。
     */
    getRecommendedCollections?(
        limit: number,
        context?: { seedSongId?: MediaId; from?: number; scope?: 'personalized' | 'editorial' | 'all' },
    ): Promise<ProviderCollection[]>;
    /**
     * 按一首种子歌推同类。与 getPersonalFm 的差别：前者按账号画像给，后者按「此刻在听什么」给，
     * 两者不能互相替代 —— 猜你喜欢换一百次也是那个口味，相似歌曲才会跟着当前这首走。
     */
    getSimilarSongs?(seed: MediaId, limit?: number): Promise<UnifiedSong[]>;
    /**
     * 取某一段推荐的具体歌曲，`section` 由 provider 自己定义（如 QQ 的 'radar' / 'new-songs'）。
     * 与 `getRecommendedCollections` 的虚拟行是同一批数据的两种视图：那边给的是「一列歌」的壳子，
     * 这边给的是壳子里的歌本身 —— 首页要平铺歌曲而不是让人点进去才看到，就要靠它。
     * 与酷狗的推荐 cardId 是同一个约定。
     */
    getRecommendationRowSongs?(
        section: string,
        options?: { seedSongId?: MediaId; limit?: number },
    ): Promise<UnifiedSong[]>;
    getHistoryEntries?(): Promise<ProviderHistoryEntry[]>;
    getHistoryDates?(): Promise<string[]>;
    getHistorySongs?(entry: ProviderHistoryEntry | string): Promise<UnifiedSong[]>;
    dislikeSong?(id: MediaId): Promise<{ replacement?: UnifiedSong; limitReached?: boolean }>;
}

export interface OnlineMutationProvider {
    canAddToPlaylist?(playlist: ProviderCollection): boolean;
    likeSong?(
        song: MediaId | SongResult,
        liked: boolean,
        context?: { likedFileId?: MediaId },
    ): Promise<void>;
    updatePlaylistTracks?(
        operation: 'add' | 'del',
        playlist: MediaId | ProviderCollection,
        tracks: Array<MediaId | SongResult>,
    ): Promise<void>;
    /** Create an owned playlist in the user's account and return it normalized. */
    createPlaylist?(dirName: string): Promise<ProviderCollection>;
    subscribePlaylist?(playlist: MediaId | ProviderCollection, subscribed: boolean): Promise<void>;
    subscribeAlbum?(id: MediaId, subscribed: boolean): Promise<void>;
}

/** 一条歌曲评论。三家字段拼法各异，正规化到这一份；缺的留空，UI 按存在与否渲染。 */
export type ProviderComment = {
    id: MediaId;
    content: string;
    userName: string;
    avatarUrl?: string;
    likedCount?: number;
    /** 我赞没赞（读态）。只有 provider 回得准才带；缺了就按未赞渲染，点赞能力位另判。 */
    liked?: boolean;
    /** 展示用的时间串，各平台自带（相对时间或日期），不再本地化以免口径打架。 */
    timeStr?: string;
    ipLocation?: string;
    /** 热评置顶标记。 */
    isHot?: boolean;
};

/**
 * 歌曲评论区。读取匿名即可；点赞是写操作（动用户账号），按 provider 能力位逐家声明——
 * 不给「看得到点不了」的假按钮。
 */
export interface OnlineCommentProvider {
    getSongComments?(song: SongResult, limit: number, offset: number): Promise<ProviderPage<ProviderComment>>;
    /**
     * 盖楼：拉一条主评论下的回复。各平台游标不同（QQ 按 pagenum 页翻、网易按 time 游标走），
     * 契约里统一 offset 语义对不齐的（网易）就只回首页并置 hasMore:false——宁可少翻一页，
     * 也不能让 UI 对着不存在的游标请求出重复数据。
     */
    getCommentReplies?(song: SongResult, commentId: MediaId, limit: number, offset: number): Promise<ProviderPage<ProviderComment>>;
    /** 点赞/取消点赞一条评论。失败抛错，由 UI 回滚乐观态。 */
    likeComment?(song: SongResult, commentId: MediaId, liked: boolean): Promise<void>;
}

export interface OnlineMusicProvider {
    id: OnlineProviderId;
    displayName: string;
    shortName?: string;
    getAvailability?(): ProviderAvailability;
    capabilities: ProviderCapabilities;
    normalizeSong(raw: unknown): UnifiedSong;
    normalizeUser?(raw: unknown): ProviderUser;
    normalizeCollection?(raw: unknown, type?: string): ProviderCollection;
    songMetadata?: OnlineSongMetadataProvider;
    getSongPageUrl?(song: SongResult): string | null;
    search?: OnlineSearchProvider;
    playback?: OnlinePlaybackProvider;
    playbackReports?: OnlinePlaybackReportProvider;
    lyrics?: OnlineLyricsProvider;
    auth?: OnlineAuthProvider;
    library?: OnlineLibraryProvider;
    catalog?: OnlineCatalogProvider;
    recommendations?: OnlineRecommendationProvider;
    mutations?: OnlineMutationProvider;
    comments?: OnlineCommentProvider;
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
export type OmniErrorDetails = OnlineProviderErrorDetails;
export type OmniPlaybackAttempt = ProviderPlaybackAttempt;
export type OmniSongUnavailableReason = ProviderSongUnavailableReason;
export { OnlineProviderError as OmniError };
