import type { SongResult, UnifiedSong } from '../../../types';
import type {
    AudioQualityPreference,
    MediaId,
    OnlineMusicProvider,
    ProviderCollection,
    ProviderLikedSongIds,
    ProviderLyricsResult,
    ProviderPage,
    ProviderUser,
    LoginDiagnosticLine,
    LoginMethod,
    LoginState,
    OnlineFailureDetail,
} from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { toSafePlaybackUrl } from '../../../utils/appPlaybackHelpers';
import { fetchQQLyrics } from './qqLyricProvider';
import { writeProviderSessionValue } from '../providerStorage';
import { normalizeQqCollection, normalizeQqSong, normalizeQqUser } from './qqNormalize';
import { clearQqSession, getQqRemoteApiBase, getQqTransportAvailability, hasQqSession, hasUsableQqSession, isQqSessionParked, requestQq } from './qqTransport';
import { canRunLoginSelfCheck, runLoginSelfCheck } from '../loginSelfCheck';
import { diagnosticLine, formatDiagnosticClock } from '../login/loginDiagnosticReport';
import { collectQqLoginDiagnostics } from './qqLoginDiagnostics';
import { getQqSongDetailById, getQqSongDetails, QQ_SONG_DETAILS_PER_REQUEST, requestQqSongDetail } from './qqSongDetail';
import { qqRecommendations } from './qqRecommendations';
import { resetQqSearchFallbackMemory, searchQqSongs } from './qqSearch';
import { getQqSubscriptionStatus, qqMutations } from './qqMutations';
import { describeQqLoginFailure, qqAccountHintNote, qqCheckFailure, qqHintFailure } from './qqLoginFailure';
import { describeQqFailure } from './qqFailure';
import { getQqCloudCollection, getQqCloudTracks, getQqListTracks, qqListKindOf } from './qqLists';
import { qqExplore } from './qqExplore';
import { areQqSongsLiked, resetQqVipMemory, withQqVipType } from './qqAccount';
import { requestQqPreviewSource } from './qqPreview';
import { noteQqBackendDeclaration, qqBackendSessionMode, resetQqBackendDeclaration } from './qqBackendDeclaration';
import { keepQqSessionFresh, resetQqSessionRefresh, stopQqSessionRefresh } from './qqSessionRefresh';
import { OnlineRequestTimeout } from '../failure/onlineRequestLimit';
import { onlineFailureOf } from '../failure/onlineFailureCase';
import { errorFields, errorMessage } from '../../../utils/errorText';

// src/services/onlineMusic/qq/qqProvider.ts

const QQ_QUALITY_FALLBACKS: Record<
    AudioQualityPreference,
    Array<{ apiQuality: '128' | '320' | 'flac'; resolvedQuality: AudioQualityPreference }>
> = {
    standard: [{ apiQuality: '128', resolvedQuality: 'standard' }],
    high: [
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
    // For the type: QQ is never asked at 'ultra' (omni asks at 'high' in its place).
    ultra: [
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
    lossless: [
        { apiQuality: 'flac', resolvedQuality: 'lossless' },
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
    // The current backend protocol exposes FLAC but no distinct Hi-Res tier.
    hires: [
        { apiQuality: 'flac', resolvedQuality: 'lossless' },
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
};

const getQqSongMid = (song: SongResult): string => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    return String(song.qqMid || sourceRef?.providerData?.songMid || sourceRef?.mediaId || '').trim();
};

/**
 * 读一次歌单详情，并把「上游没读到这个歌单」和「歌单确实是空的」分开。
 *
 * 上游这条是匿名 CGI：歌单不公开时它**照样回 `code: 0`**，只是 `cdlist[0]` 退化成一个空壳 ——
 * 没有 `dissname`，songlist 为空数组。2026-09-11 用真实账号对一个 `dirShow: 2` 的自建歌单抓到的是
 * `{ code: 0, disstid: '9777066643', dissname: undefined, songlist: [] }`：`disstid` 照样回声，
 * 所以判据是 `dissname` 在不在，而不是 `disstid`，也不是 `cdlist` 或 songlist 的长度 —— 真的空歌单
 * 会带着完整的 `dissname` 回来。两者混成同一个空结果，就是用户看到的那个没有报错的「暂无内容」。
 */
const loadRawPlaylistTracks = async (
    id: MediaId,
    collection?: ProviderCollection,
): Promise<{ tracks: unknown[]; total?: number }> => {
    const response = await requestQq<any>('song_list_detail', { disstid: String(id) });
    const cdlist = response?.response?.cdlist;
    const detail = Array.isArray(cdlist) ? cdlist[0] : undefined;
    const dissname = String(detail?.dissname ?? '').trim();

    if (!detail || typeof detail !== 'object' || !dissname) {
        // 已知不公开时报 `not-public` 而不是 `invalid-response`：这不是协议坏了，是这条匿名
        // 路由没资格读它 —— 后端补上带凭据的歌单路由之后，自建歌单就不会再走到这里。调用方据此
        // 给用户一句能看懂的解释，而不是把协议细节甩到界面上。
        const dirShow = Number(collection?.providerData?.dirShow);
        const notPublic = Number.isFinite(dirShow) && dirShow !== 1;
        throw new OnlineProviderError(
            notPublic ? 'not-public' : 'invalid-response',
            `QQMusicApi song_list_detail could not read playlist ${String(id)}`
            + `${notPublic ? ' (not a public playlist; this anonymous endpoint cannot read it)' : ''}`,
            'qq',
            response?.response,
        );
    }

    const tracks = Array.isArray(detail.songlist) ? detail.songlist : [];
    const total = Number(detail.total_song_num ?? detail.songnum);
    return { tracks, ...(Number.isFinite(total) && total >= 0 ? { total } : {}) };
};

// 后端有没有 `/user/playlist-detail` 只取决于它的版本，一个会话里不会变，所以探到一次 404
// 就记下来，不再为每一页重试。刷新页面自然会重新探测。
let ownedPlaylistRouteMissing = false;

export const resetQqProviderRuntimeCache = (): void => {
    ownedPlaylistRouteMissing = false;
    lastLoginStatusCheck = null;
    playlistRound = null;
    resetQqVipMemory();
    resetQqSessionRefresh();
    resetQqSearchFallbackMemory();
};

/**
 * 带凭据地读用户自己的歌单，响应形状与 `/user/liked-songs` 一致。
 *
 * 返回 `null` 表示这个后端没有这条路由（旧版本），调用方据此回落到匿名路径 —— 与
 * `login_channels` 的处理方式相同：404 是「没有声明这个能力」，不是错误。其余失败照常抛出，
 * 否则一次网络抖动会被误判成「后端不支持」并在整个会话里粘住。
 */
const loadRawOwnedPlaylistTracks = async (
    tid: MediaId,
    dirId: number,
    limit: number,
    offset: number,
): Promise<{ tracks: unknown[]; total?: number; more: boolean } | null> => {
    if (ownedPlaylistRouteMissing) return null;
    try {
        const response = await requestQq<any>('user_playlist_detail', {
            tid: String(tid),
            dirid: dirId,
            offset,
            limit,
        });
        const tracks = Array.isArray(response?.songs) ? response.songs : [];
        const total = Number(response?.total);
        return {
            tracks,
            ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
            more: response?.more === true,
        };
    } catch (error) {
        if (error instanceof OnlineProviderError && error.code === 'unsupported') {
            ownedPlaylistRouteMissing = true;
            return null;
        }
        throw error;
    }
};

const loadRawLikedTracks = async (
    limit: number,
    offset: number,
): Promise<{ tracks: unknown[]; listed: boolean; total?: number; more: boolean }> => {
    const response = await requestQq<any>('user_liked_songs', { offset, limit });
    // `listed`: the answer carries a list of songs. Without one, `tracks` is empty.
    const listed = Array.isArray(response?.songs);
    const tracks = listed ? response.songs : [];
    const total = Number(response?.total);
    return {
        tracks,
        listed,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        more: response?.more === true,
    };
};

const getPlaylistTracks = async (
    id: MediaId,
    limit: number,
    offset: number,
    collection?: ProviderCollection,
): Promise<ProviderPage<ReturnType<typeof normalizeQqSong>>> => {
    // 排行榜和电台的卡片（探索页）不是歌单，改走它们自己的路由。
    if (collection && qqListKindOf(collection)) return getQqListTracks(collection, limit, offset);
    const safeLimit = Math.max(1, limit);
    const safeOffset = Math.max(0, offset);
    const dirId = Number(collection?.providerData?.dirId);
    const owned = collection?.providerData?.owned === true;

    // 我喜欢留在它自己那条早就可用的路由上：换到新路由只会让一个本来就正常的功能去承担
    // 新后端的风险，而它要解决的问题（读不到不公开的自建歌单）在这里根本不存在。
    if (dirId === 201) {
        const { tracks, total, more } = await loadRawLikedTracks(safeLimit, safeOffset);
        const items = tracks.map(normalizeQqSong);
        const nextOffset = offset + items.length;
        return {
            items,
            ...(total === undefined ? {} : { total }),
            hasMore: more || (total !== undefined && nextOffset < total),
            nextOffset,
        };
    }

    // 其余自建歌单优先走带凭据的路由：只有它读得到不公开的歌单，而且支持真正的分页，不必像匿名
    // 路径那样每翻一页重拉整张歌单。判据是 `owned` 而不是 dirId —— 收藏的歌单也带 dirId，而带凭据的
    // 路由读收藏歌单会少歌：实测一张 37 首的收藏歌单只回 36 首（缺一首付费歌），连 total 也跟着变成 36，
    // 界面上完全看不出来。收藏歌单留在匿名路由上是完整的。
    if (owned && Number.isFinite(dirId) && dirId > 0) {
        const page = await loadRawOwnedPlaylistTracks(id, dirId, safeLimit, safeOffset);
        if (page) {
            const items = page.tracks.map(normalizeQqSong);
            const nextOffset = safeOffset + items.length;
            return {
                items,
                ...(page.total === undefined ? {} : { total: page.total }),
                // 空页必须停：上游的 total 可能比实际能读到的多（被过滤的歌），只看 total 会一直翻空页。
                hasMore: items.length > 0 && (page.more || (page.total !== undefined && nextOffset < page.total)),
                nextOffset,
            };
        }
    }

    // 收藏的、分享链接进来的歌单本来就只能走匿名路由；后端太旧时也回落到这里。
    const { tracks, total } = await loadRawPlaylistTracks(id, collection);
    const items = tracks
        .slice(offset, offset + Math.max(0, limit))
        .map(normalizeQqSong);
    const nextOffset = offset + items.length;
    return {
        items,
        ...(total === undefined ? {} : { total }),
        hasMore: nextOffset < tracks.length,
        nextOffset,
    };
};

const QQ_LIKED_DIR_ID = 201;

const playCountOf = (value: unknown): number | undefined => {
    // `Number(null)`、`Number('')` 都是 0：上游没给数时不能显示成播放 0 次。
    if (value === null || value === undefined || value === '') return undefined;
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : undefined;
};

/**
 * 歌单页上方的资料（播放数）。自建歌单带 `playCount=1` 读一首歌，播放数和这次回包一起来；收藏的、推荐的歌单
 * 已经带着播放数就不再请求，没带才读一次匿名的歌单详情。「我喜欢」、排行榜和电台没有播放数可补。
 * 读不到时照原样交回集合：这只是补资料，不该挡住歌单本身。
 */
const getPlaylistDetail = async (id: MediaId, collection?: ProviderCollection): Promise<ProviderCollection | null> => {
    if (!collection) return null;
    const dirId = Number(collection.providerData?.dirId);
    const owned = collection.providerData?.owned === true;
    if (qqListKindOf(collection) || collection.isLiked || (owned && dirId === QQ_LIKED_DIR_ID)) return collection;
    const ownedRoute = owned && Number.isFinite(dirId) && dirId > 0;
    try {
        if (ownedRoute) {
            if (ownedPlaylistRouteMissing) return collection;
            const response = await requestQq<any>('user_playlist_detail', {
                tid: String(collection.providerData?.tid ?? id),
                dirid: dirId,
                offset: 0,
                limit: 1,
                playCount: 1,
            });
            const playCount = playCountOf(response?.play_cnt);
            return playCount === undefined ? collection : { ...collection, playCount };
        }
        if (collection.playCount !== undefined) return collection;
        const response = await requestQq<any>('song_list_detail', { disstid: String(id) });
        const detail = Array.isArray(response?.response?.cdlist) ? response.response.cdlist[0] : undefined;
        const playCount = playCountOf(detail?.visitnum);
        const description = typeof detail?.desc === 'string' ? detail.desc.trim() : '';
        return {
            ...collection,
            ...(playCount === undefined ? {} : { playCount }),
            ...(!collection.description && description ? { description } : {}),
        };
    } catch (error) {
        // 只有 `/user/playlist-detail` 的 404 说明后端没有这条路由；匿名歌单详情的 404 不能连带关掉自建歌单的读取。
        if (ownedRoute && error instanceof OnlineProviderError && error.code === 'unsupported') ownedPlaylistRouteMissing = true;
        console.warn('[QQProvider] playlist-detail:failed', error);
        return collection;
    }
};

const hasQqCatalogRefs = (song: UnifiedSong): boolean => Boolean(
    song.album?.catalogRef
    && song.artists.length > 0
    && song.artists.every(artist => Boolean(artist.catalogRef)),
);

// 搜索复用的是 `utils/lyrics` 里那条 `u.y.qq.com` 歌词搜索，它只把数字 `album.id` /
// `singer.id` 带出来，albummid 与 singermid 在那一层就被丢掉了。点专辑 / 歌手时补一次
// `/getSongInfo` 取回 mid —— 与 kugou 补 KRM 元数据是同一套契约，只在真的要导航时才发请求。
export const resolveQqSongCatalogRefs = async (song: UnifiedSong): Promise<UnifiedSong> => {
    if (hasQqCatalogRefs(song)) return song;

    const songmid = getQqSongMid(song);
    if (!songmid) return song;

    const detail = await requestQqSongDetail(songmid);
    if (!detail) return song;

    return {
        ...song,
        // 歌手整组替换：解析后的每一项都带 mid，混用两份会让 catalogRefs 的按名匹配对上没有 mid 的那个。
        artists: detail.artists.length > 0 ? detail.artists : song.artists,
        album: {
            ...song.album,
            ...(detail.album.catalogRef
                ? { id: detail.album.id, catalogRef: detail.album.catalogRef }
                : {}),
            name: song.album.name || detail.album.name,
            coverUrl: song.album.coverUrl || detail.album.coverUrl,
        },
    };
};

// 3.3.0 起拿不到链接的条目带 `restriction`：`codes` 是条目里的安全整数（含义未确认，只进诊断），
// `hint.key` 是后端给人看的原因。只有 maybe-* 两种是按受控实测特征认出的「可能」原因，其余一律按未确认处理。
const QQ_LIKELY_CAUSE_BY_HINT: Readonly<Record<string, 'subscription' | 'region'>> = {
    'playback.maybe-membership': 'subscription',
    'playback.maybe-region-restricted': 'region',
};

type QqPlayRestriction = { upstreamCode?: number; codes: string; hintKey?: string };

const readPlayRestriction = (entry: any): QqPlayRestriction | null => {
    const restriction = entry?.restriction;
    if (!restriction || typeof restriction !== 'object') return null;
    const codes = restriction.codes && typeof restriction.codes === 'object' ? restriction.codes : {};
    const pairs = Object.entries(codes).filter((pair): pair is [string, number] => Number.isSafeInteger(pair[1]));
    const primary = pairs.find(([key]) => key === 'result') ?? pairs[0];
    const hintKey = typeof restriction.hint?.key === 'string' ? restriction.hint.key : undefined;
    return {
        ...(primary ? { upstreamCode: primary[1] } : {}),
        codes: pairs.map(([key, value]) => `${key}=${value}`).join(' '),
        ...(hintKey ? { hintKey } : {}),
    };
};

// 和播放那边自动重来用的是同一条规则（failure/onlineFailureCase.ts）：只有「连不上」（断网、没带拒绝码的 5xx）才值得再要一次。
const isQqUnreachable = (error: unknown, said: OnlineFailureDetail | null): boolean => (
    onlineFailureOf({ operation: 'audio', providerId: 'qq' }, { error, ...(said ? { detail: said } : {}) }).case === 'unreachable'
);

/**
 * 按音质降档请求 music_play，任意一档拿到 URL 就返回。登录失效、到了时限、要求稍后再试，和后端没在跑或没配好的
 * 失败马上抛出：再要下一档只会得到同样的回答。network 和别的 5xx 继续降档。都没拿到时：标准音质回了空链接，
 * 才要试听片段；有档连不上、标准音质又没回空链接，抛连不上的错，由播放那边再要。
 */
const getAudioSource = async (song: SongResult, quality: AudioQualityPreference) => {
    const songmid = getQqSongMid(song);
    if (!songmid) {
        // 拼不出 music_play 的路径：这是歌曲数据不完整，不是「没有音源」，不发请求。
        throw new OnlineProviderError('invalid-response', 'QQ song has no songmid', 'qq');
    }
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    const mediaId = String(sourceRef?.providerData?.mediaMid || '').trim();

    // The backend answers HTTP 200 with an empty `url` plus an `error` string when the account may
    // not stream the song. The local package writes only a fixed sentence there ('暂无播放链接'), so
    // QQ's own reason (membership, region, takedown) never reaches us: the song has no audio, and
    // nothing finer. Without keeping that apart from a request failure, an unplayable song looks
    // exactly like a transient error worth retrying.
    // 3.3.0：条目多了 `restriction.hint`。后端只在带会话的 m4a / 128 上、特征完整吻合时才说「可能是会员 / 地区」，
    // 所以只认最后一档（标准音质）给的可能原因：情况仍是没有音频，界面只多说一句带「可能」的话。
    let sawEmptyPlayLink = false;
    let likelyCause: 'subscription' | 'region' | undefined;
    // The first request that failed: what is said when no level was answered at all.
    let firstFailure: unknown;
    const tiers = QQ_QUALITY_FALLBACKS[quality];
    const standardTier = tiers[tiers.length - 1];
    // 标准音质（最后一档）回了空链接：这个账号拿不到整首，更高的档连不上也一样。后端 3.3.3 在原因没确认时
    // 已经替这一档再要过一次（qq-music-api 的 services/auth/playback.js）。
    let standardTierEmpty = false;
    // 第一个连不上的档（断网、没带拒绝码的 5xx）的错。
    let firstUnreachable: unknown;

    for (const candidate of tiers) {
        try {
            const response = await requestQq<any>('music_play', {
                songmid,
                ...(mediaId ? { mediaId } : {}),
                quality: candidate.apiQuality,
            });
            const playUrl = response?.data?.playUrl;
            const playUrlMap = playUrl && typeof playUrl === 'object' ? playUrl : {};
            const direct = playUrlMap[songmid];
            const fallback = Object.values(playUrlMap)[0] as any;
            const entry = direct ?? fallback;
            const url = toSafePlaybackUrl(String(direct?.url || fallback?.url || ''));
            if (url) {
                return {
                    url,
                    fetchedAt: Date.now(),
                    quality: candidate.resolvedQuality,
                };
            }
            if (entry && typeof entry === 'object') {
                sawEmptyPlayLink = true;
                if (candidate === standardTier) standardTierEmpty = true;
                const restriction = readPlayRestriction(entry);
                likelyCause = restriction?.hintKey ? QQ_LIKELY_CAUSE_BY_HINT[restriction.hintKey] : undefined;
                console.warn('[QQProvider] playback:no-play-link', {
                    candidateQuality: candidate.resolvedQuality,
                    upstreamCode: restriction?.upstreamCode,
                    codes: restriction?.codes || undefined,
                    hint: restriction?.hintKey,
                });
            } else {
                likelyCause = undefined;
            }
        } catch (error) {
            likelyCause = undefined;
            if (error instanceof OnlineProviderError && error.code === 'auth-required') throw error;
            // Not answered in time: the next level would wait as long again, on the same network.
            if (error instanceof OnlineRequestTimeout) throw error;
            firstFailure ??= error;
            const said = describeQqFailure('audio', error);
            const unreachable = isQqUnreachable(error, said);
            console.warn('[QQProvider] playback:quality-failed', {
                requestedQuality: quality,
                candidateQuality: candidate.resolvedQuality,
                unreachable,
                ...errorFields(error),
            });
            if (said?.case === 'local-service-stopped' || said?.case === 'not-configured' || said?.httpStatus === 429
                || (error instanceof OnlineProviderError && error.retryAfterMs !== undefined)) throw error;
            if (unreachable) firstUnreachable ??= error;
        }
    }

    console.warn('[QQProvider] playback:no-source', {
        requestedQuality: quality,
        hasMediaMid: Boolean(mediaId),
        // `true` means the upstream answered normally but issued no stream for this account.
        upstreamRefusedPlayLink: sawEmptyPlayLink,
        standardTierEmpty,
        unreachable: firstUnreachable !== undefined,
    });
    // 有档连不上、标准音质又没回空链接：说不准这个账号能不能放整首，不拿试听顶上。试听一交出去，播放那边就当成功、
    // 不再要了，预取还会把它存下来照放；会员碰上一次网络抖动就只听到一分钟。抛连不上的错，播放那边按
    // autoRetryDelaysMs 隔一会儿再要（failure/onlineFailureCase.ts），再要之前还会看这首歌是不是仍要放。
    // 先碰到平台拒绝、后面的档连不上时，也报连不上的那个错。
    if (firstUnreachable !== undefined && !standardTierEmpty) throw firstUnreachable;
    // 没有一档回过空链接：照第一次的失败报，和以前一样。
    if (firstFailure !== undefined && !sawEmptyPlayLink) throw firstFailure;
    // 有会话、所有音质都没给链接：这个账号可能只能听试听片段，不限后端说的可能原因。没会话时后端不给试听，停用的会话也不带
    // （hasUsableQqSession）。
    if (sawEmptyPlayLink && hasUsableQqSession()) {
        const preview = await requestQqPreviewSource(songmid, mediaId);
        if (preview) return preview;
    }
    // 没有会话、而后端只是没给链接：登录后可能能放（只是可能，不能当成登录失效）。形态坏掉的回答不是没给链接。
    throw new OnlineProviderError('not-playable', 'QQMusicApi gave no play link for this song', 'qq', {
        likelyCause: likelyCause ?? (sawEmptyPlayLink && !hasUsableQqSession() ? 'sign-in' : undefined),
    });
};

// Delegates to the existing QRC pipeline, which owns decryption, translation and romanization.
const getLyrics = async (song: SongResult): Promise<ProviderLyricsResult> => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    const songMid = song.qqMid || sourceRef?.mediaId || '';
    const songId = sourceRef?.providerData?.songId ?? song.id;
    if (!songMid || !songId) {
        console.warn('[QQProvider] lyrics:missing-identity', { hasSongMid: Boolean(songMid), hasSongId: Boolean(songId) });
        return { lyrics: null, isPureMusic: false };
    }

    const lyrics = await fetchQQLyrics({ ...song, id: songId as MediaId, qqMid: songMid });
    return { lyrics: lyrics ?? null, isPureMusic: false };
};

// 最近一次登录态检查的结论。扫码确认后账户没加载出来（account-refresh-failed）时，报告靠它说明卡在哪：
// 没存下 session、后端不认这个 session、还是请求本身失败。
// 结论是这里写死的话，记下时就写成一行。
let lastLoginStatusCheck: LoginDiagnosticLine | null = null;
const noteLoginStatusCheck = (summary: LoginDiagnosticLine): void => {
    lastLoginStatusCheck = diagnosticLine`${formatDiagnosticClock(Date.now())} ${summary}`;
};

// 后端不认这个 session 就是登录没了，只有一种例外：主进程这次启动没能读出加密的登录仓库，这次运行里也还没有新登录替掉它，
// 存着的 session 就是停用的（isQqSessionParked），请求没带它。那时是「查不到」：报 unavailable，accountRead 只记这次读失败、留着
// session；回 null 会让它删掉 session，下次能读出仓库时也找不回来。这次运行里扫码登录过，后端不认了就照常是登录没了。
const signedOutUnlessStoreUnreadable = async (): Promise<null> => {
    if (!await isQqSessionParked()) return null;
    noteLoginStatusCheck(diagnosticLine`login_status: the sign-in store could not be read at this start`);
    console.warn('[QQProvider] login-status:store-unreadable');
    throw new OnlineProviderError('unavailable', 'QQ sign-in store could not be read at this start', 'qq');
};

const getLoginStatus = async (): Promise<ProviderUser | null> => {
    // No opaque backend session means the account cannot be authenticated, so the startup request is skipped.
    if (!hasQqSession()) {
        noteLoginStatusCheck(diagnosticLine`no backend session stored`);
        return null;
    }

    try {
        const response = await requestQq<any>('login_status');
        const profile = response?.data?.profile;
        if (!profile) {
            noteLoginStatusCheck(diagnosticLine`login_status: the backend does not recognize the stored session`);
            console.info('[QQProvider] login-status:anonymous');
            return signedOutUnlessStoreUnreadable();
        }
        const user = await withQqVipType(normalizeQqUser(profile));
        // 登录还在：会话要在到期前续（qqSessionRefresh.ts）；续期的请求排在通道探测之后。
        void refreshDeclaredChannels().then(keepQqSessionFresh);
        // The acceptance test account returned a profile without a display name, so the profile itself is the signal.
        noteLoginStatusCheck(diagnosticLine`signed in (user id ${user.id ? 'present' : 'missing'}, nickname ${user.nickname ? 'present' : 'missing'})`);
        console.info('[QQProvider] login-status:profile', {
            hasUserId: Boolean(user.id),
            hasNickname: Boolean(user.nickname),
        });
        return user;
    } catch (error) {
        noteLoginStatusCheck(diagnosticLine`login_status failed: ${errorMessage(error)}`);
        // Missing, expired, rejected, or non-persisted backend sessions all arrive as 401.
        if (error instanceof OnlineProviderError && error.code === 'auth-required') {
            console.info('[QQProvider] login-status:auth-required');
            return signedOutUnlessStoreUnreadable();
        }
        console.warn('[QQProvider] login-status:error', error);
        throw error;
    }
};

// The request takes the session as it is when it is made (`requestQq`); the session leaves the
// page at once, before the first wait and whatever the backend answers.
const logout = async (): Promise<void> => {
    stopQqSessionRefresh();
    const told = hasQqSession()
        ? requestQq('logout').catch(error => {
            console.warn('[QQProvider] logout:error', error);
        })
        : undefined;
    clearQqSession();
    await told;
};

// 扫码登录方式：`id` 就是后端 `?channel=` 的取值，UI 层只认 labelKey 与 iconKey。
// services 层不 import 任何 .svg：iconKey 是图标的名字，UI 层按它取 src/assets/providers/ 里同名的文件。
// `qq` 是 QQ 扫码登录通道的 canonical 名字（旧名 `mobile`，后端仍在入口归一，
// 所以新版 Folia 配旧后端也不会断）。协议本身没变：仍送 tmeLoginType 6、收回 loginType 2。
// `qqmusic` 是用 QQ 音乐 App 扫码（App 登的是 QQ 还是微信账号都行），后端在 /login/channels 里说有才显示：
// Serverless 没配中继时就没有它。
const QQ_LOGIN_METHODS: LoginMethod[] = [
    { id: 'qq', labelKey: 'home.qqLoginMethodMobile', iconKey: 'qq' },
    { id: 'wechat', labelKey: 'home.qqLoginMethodWechat', iconKey: 'wechat' },
    { id: 'qqmusic', labelKey: 'home.qqLoginMethodQqMusic', iconKey: 'qqmusic' },
];

// 还没问到后端（或旧后端没有 /login/channels）时显示的方式：和以前一样只有这两种，没宣告的通道不显示。
const QQ_UNDECLARED_LOGIN_METHOD_IDS: readonly string[] = ['qq', 'wechat'];

const DEFAULT_QQ_LOGIN_METHOD_ID = QQ_LOGIN_METHODS[0].id;

// 后端声明的通道集合。初值 null 表示「还没问到」，此时沿用上面的硬编码数组，
// 所以没有 /login/channels 的旧后端行为完全不变。
let declaredChannels: string[] | null = null;
let channelProbe: Promise<void> | null = null;
let channelProbeRetryAt = 0;

const CHANNEL_PROBE_RETRY_DELAY_MS = 30_000;

/**
 * 后台探测成功后缓存结果；失败或 404 都先保留硬编码数组，普通渲染按冷却时间重试，登录动作可立即重试。
 * 包一层 `Promise.resolve()` 是因为调用方 `getAvailability` 是同步的、渲染期就会被读到 ——
 * 探测无论如何都不该把异常抛回渲染路径。
 */
const refreshDeclaredChannels = (forceRetry = false): Promise<void> => {
    if (channelProbe) return channelProbe;
    if (!forceRetry && Date.now() < channelProbeRetryAt) return Promise.resolve();
    channelProbe = Promise.resolve()
        .then(() => requestQq<any>('login_channels'))
        .then(response => {
            const channels = response?.data?.channels;
            if (!Array.isArray(channels) || channels.length === 0) throw new Error('Invalid QQ login channels');
            declaredChannels = channels.map(String);
            noteQqBackendDeclaration(response?.data);
            channelProbeRetryAt = 0;
        })
        .catch(() => {
            // 旧后端或暂时性网络错误都先回落到硬编码数组；清掉 Promise 才能在稍后或打开登录时重试。
            channelProbe = null;
            channelProbeRetryAt = Date.now() + CHANNEL_PROBE_RETRY_DELAY_MS;
        });
    return channelProbe;
};

// 桌面版、Docker、Node 的后端（会话存在后端，sessionMode 不是 sealed）宣告了 `qqmusic` 时只给这一种：
// 手机 QQ、微信、QQ 音乐 App 都能扫它的码，用的人不用先选。Serverless（sealed）照旧按宣告给选项。
const scansWithAppOnly = (): boolean => (
    Boolean(declaredChannels?.includes('qqmusic')) && qqBackendSessionMode() !== 'sealed'
);

// 前端只显示该 runtime 真正支持的通道：serverless 只有微信，不该显示点进去必定失败的 QQ。
// 后端只宣告一个通道、或者只给 QQ 音乐 App 扫码时回空数组 —— 登录窗口不显示选择器，直接取二维码，
// 比多一次无意义的点击更好。
const getLoginMethods = (): LoginMethod[] => {
    void refreshDeclaredChannels();
    if (!declaredChannels) return QQ_LOGIN_METHODS.filter(method => QQ_UNDECLARED_LOGIN_METHOD_IDS.includes(method.id));
    if (scansWithAppOnly()) return [];
    const supported = QQ_LOGIN_METHODS.filter(method => declaredChannels?.includes(method.id));
    return supported.length > 1 ? supported : [];
};

// 登录窗口此刻给的方式（诊断报告用）：没有选择器时就是直接取码的那一种。
const shownLoginMethodIds = (): string[] => {
    if (!declaredChannels) return [...QQ_UNDECLARED_LOGIN_METHOD_IDS];
    if (scansWithAppOnly()) return ['qqmusic'];
    return QQ_LOGIN_METHODS.filter(method => declaredChannels?.includes(method.id)).map(method => method.id);
};

// 登录窗口的标题、说明和扫错 App 那一句要照的样子：是不是只给 QQ 音乐 App 扫码、选择器里有没有它。
type QqLoginShape = { appOnly: boolean; offersQqMusic: boolean };

const currentLoginShape = (): QqLoginShape => ({
    appOnly: scansWithAppOnly(),
    offersQqMusic: Boolean(declaredChannels?.includes('qqmusic')),
});

// 这一次登录解析出方式时（resolveLoginMethods）记下的样子：之后后台再探测改了通道，窗口上的码和选择器
// 还是这一次的，文字也照它说。还没解析完时是 null，照此刻的通道说。
let resolvedLoginShape: QqLoginShape | null = null;

const loginShape = (): QqLoginShape => resolvedLoginShape ?? currentLoginShape();

/** 登录动作必须等能力发现完成，避免启动的二维码通道与弹窗显示的选项来自两个时刻。 */
const resolveLoginMethods = async (): Promise<LoginMethod[]> => {
    resolvedLoginShape = null;
    await refreshDeclaredChannels(true);
    resolvedLoginShape = currentLoginShape();
    return getLoginMethods();
};

const resolveQrLoginMethodId = (methodId?: string): string => {
    if (methodId) return methodId;
    if (scansWithAppOnly()) return 'qqmusic';
    const supported = declaredChannels
        ? QQ_LOGIN_METHODS.filter(method => declaredChannels?.includes(method.id))
        : [];
    return supported.length === 1 ? supported[0].id : DEFAULT_QQ_LOGIN_METHOD_ID;
};

/** 测试用：通道缓存是模块级单例，跨用例必须能清掉。 */
export const resetQqLoginChannelCache = (): void => {
    declaredChannels = null;
    channelProbe = null;
    channelProbeRetryAt = 0;
    lastQrLogin = null;
    lastAccountHintKey = null;
    resolvedLoginShape = null;
    resetQqBackendDeclaration();
};

// provider 摘要在应用启动时就会被读到，把探测挂在这里，等用户真的打开登录弹窗时结果早已落地，
// UI 不会先显示两个通道再缩成一个。
const getAvailability = (): ReturnType<typeof getQqTransportAvailability> => {
    const availability = getQqTransportAvailability();
    if (availability.configured) void refreshDeclaredChannels();
    return availability;
};

// 后端的会话寿命是 180 秒（qq-music-api 的 `QR_TTL_MS`），前端早 5 秒收手：
// 二维码失效时用户看到的是可重试的「已过期」，而不是一个还在轮询的死码。
const QQ_QR_TTL_MS = 175_000;

// QQ 音乐账号的登录设备数已达上限时凭据交换返回的上游码（与 .github/triage/login-playbook.json 的 qq-device-limit 同一条判定）。
const QQ_DEVICE_LIMIT_UPSTREAM_CODE = 20279;
// 3.3.0 给同一种失败登记的错误键；上游码与通道、步骤都对得上时才给。
const QQ_DEVICE_LIMIT_ERROR_KEY = 'auth.device-limit';

// 3.3.3 起后端另给 `failureHint.key`，设备已满是 `login.device-limit`（从同样的码推出来，多认一处只为保险）。
const QQ_DEVICE_LIMIT_HINT_KEY = 'login.device-limit';

const reportsDeviceLimit = (failure: any): boolean => (
    Number(failure?.upstreamCode) === QQ_DEVICE_LIMIT_UPSTREAM_CODE
    || failure?.upstreamErrorKey === QQ_DEVICE_LIMIT_ERROR_KEY
    || failure?.failureHint?.key === QQ_DEVICE_LIMIT_HINT_KEY
);

// 最近一次要码的时刻：只认这之后的凭据交换记录，主进程环形记录里上一轮的结果不算。
let qrKeyRequestedAt = 0;

// 最近一次要到的码走的是哪个通道：后端认出的原因有的只在某个通道上说得通（qqLoginFailure.ts 的 qqHintFailure）。
let lastQrLogin: { key: string; channel: string } | null = null;

// 这一轮登录最后一次检查失败时后端给的 hint key：账号本身的问题（被封、受限、绑定）由 caseNotes 照它说。
// 要码时清掉，所以别的步骤的拒绝不会带上上一轮的话。
let lastAccountHintKey: string | null = null;

// 登录设备超限的判定。微信通道的凭据交换没有回退，20279 直接出现在响应的 upstreamCode 上。QQ 通道交换失败后
// 后端会拿 MQTT 凭据再验一次，验证也被拒（code 1000）才失败在 credential-validation，顶层只剩后一次的码；
// 3.3.0 起被盖掉的换凭证结果放在 primaryFailure 里，网页版也认得出来。更旧的后端没有这个字段，
// 20279 只在主进程钩子记下的 qq-auth.upstream-result 里，桌面版再去那里找本轮最后一次凭据交换。
const isQqDeviceLimit = async (response: any): Promise<boolean> => {
    if (reportsDeviceLimit(response) || reportsDeviceLimit(response?.primaryFailure)) return true;
    if (response?.failureStage !== 'credential-validation') return false;
    const getSnapshot = typeof window === 'undefined' ? undefined : window.electron?.getLoginDiagnostics;
    if (!getSnapshot) return false;
    try {
        const snapshot = await getSnapshot('qq');
        if (snapshot?.providerId !== 'qq') return false;
        const exchanges = snapshot.authEvents.filter(event => (
            event.at >= qrKeyRequestedAt
            && event.event === 'qq-auth.upstream-result'
            && (event.details as { phase?: unknown } | null)?.phase === 'credential-exchange'
        ));
        const last = exchanges[exchanges.length - 1]?.details as { upstreamCode?: unknown } | undefined;
        return Number(last?.upstreamCode) === QQ_DEVICE_LIMIT_UPSTREAM_CODE;
    } catch {
        // 取不到快照只是少了这条提示，失败照常交给登录。
        return false;
    }
};

// 日志里的那一行：后端的码和原话，带着失败停在哪一步、为什么（3.1.3 起的结构化字段）。
const describeCheckAnswer = (response: any): string => {
    const stage = typeof response?.failureStage === 'string'
        ? ` (stage ${response.failureStage}, reason ${typeof response?.failureReason === 'string' ? response.failureReason : 'unknown'})`
        : '';
    return `code ${response?.code ?? 'none'}: ${typeof response?.message === 'string' && response.message ? response.message : 'no message'}${stage}`;
};


// The key last answered 802: after a scan the backend's 'QR login failed' can also be the credential
// exchange failing, not the line (below).
let scannedKey: string | null = null;

// 后端把 QQ / 微信的原生扫码状态翻译成一套通用的码值：801 等待、802 已扫、803 确认（带 session）、800 过期或失败。
const checkLogin = async (key: string): Promise<LoginState> => {
    const response = await requestQq<any>('login_qr_check', { key });
    const code = Number(response?.code);
    if (code === 801) return { state: 'waiting' };
    if (code === 802) {
        scannedKey = key;
        return { state: 'scanned' };
    }
    if (code === 803) {
        // Idempotent with the transport, which already stored the opaque session string on this response.
        if (typeof response?.cookie === 'string' && response.cookie) {
            writeProviderSessionValue('qq', 'cookie', response.cookie);
        }
        return { state: 'confirmed' };
    }
    if (code === 800) {
        // 800 also carries an upstream rejection; `upstreamCode` is the upstream safety number, left unnamed.
        // 登录设备超限是账号侧的原因：登录窗口据此换成清理登录设备的步骤。
        if (await isQqDeviceLimit(response)) {
            return { state: 'error', message: describeCheckAnswer(response), failure: { ...qqCheckFailure(response), case: 'device-limit' } };
        }
        // 后端认得出的原因（failureHint）比下面按字段猜的准：太频繁是稍后再试，账号被拒是平台拒绝。
        const hinted = qqHintFailure(response, lastQrLogin?.key === key ? lastQrLogin.channel : undefined);
        if (hinted) {
            lastAccountHintKey = hinted.case === 'refused' ? response?.failureHint?.key ?? null : null;
            return { state: 'error', message: describeCheckAnswer(response), failure: hinted };
        }
        if (response?.upstreamCode !== undefined) {
            console.warn('[QQProvider] qr-check:upstream-rejected', {
                upstreamCode: response?.upstreamCode,
                retryAfterMs: response?.retryAfterMs,
            });
            return { state: 'error', message: describeCheckAnswer(response), failure: qqCheckFailure(response, true) };
        }
        // 用的人在手机上取消了（3.1.3 起后端用 failureReason 说）：照过期算，后端要等多久再给码一并交出。
        if (response?.failureReason === 'user-canceled') {
            return typeof response?.retryAfterMs === 'number'
                ? { state: 'expired', failure: { retryAfterMs: response.retryAfterMs } }
                : { state: 'expired' };
        }
        // A wait with no upstream code: the backend backs off after a give-up of its own kind, not a refusal
        // by QQ. 'QR code expired' is the listener's side ending the code (a cancel on the phone, a refusal
        // in WeChat). 'QR login failed' before a scan is its link to QQ breaking (the network going away);
        // after one it may as well be the credential exchange failing (qrLogin.js finalizeLogin), so it is
        // left unnamed and the wait makes it a retry later. The wait is kept so the refresh waits for the
        // backend's block instead of running into it.
        if (typeof response?.retryAfterMs === 'number') {
            if (response?.message === 'QR login failed') {
                const failure = qqCheckFailure(response);
                return { state: 'error', message: describeCheckAnswer(response), failure: scannedKey === key ? failure : { ...failure, case: 'unreachable' } };
            }
            return { state: 'expired', failure: { retryAfterMs: response.retryAfterMs } };
        }
        // 后端说了停在哪一步（3.1.3 起的结构化字段），又不是自然过期：这是一次失败，不是码过期了。
        if (typeof response?.failureStage === 'string' && response?.failureReason !== 'qr-timeout') {
            return { state: 'error', message: describeCheckAnswer(response), failure: qqCheckFailure(response) };
        }
        return { state: 'expired' };
    }
    return { state: 'error', message: describeCheckAnswer(response), failure: qqCheckFailure(response) };
};

// 这一轮读到的整份歌单。账号层每 50 张要一页（account/accountRead.ts），而后端一次就给整份：
// 只在第一页（offset 0）请求，后面的页从这份里切，不再每页重读一遍。
// 记下是为哪个账号读的：换了账号（或退出后换号登录）时，后面的页不会切到上一个账号的那份。
let playlistRound: { userId: MediaId; response: any; playlists: unknown[] } | null = null;

// `/user/playlist` returns the whole GetPlaylistByUin list and takes no upstream paging parameters,
// so the Omni page window is applied locally instead of being forwarded.
const getUserPlaylists = async (
    userId: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    if (offset === 0 || !playlistRound || String(playlistRound.userId) !== String(userId)) {
        // 不传 `uid`：会话账号是这条 route 唯一读得到的账号，而后端从凭据里挑出来的账号 ID 比前端
        // 手上这个展示用的可靠 —— 微信凭据的 `musicid` 是占位的 0，回传它只会让自建歌单整段消失。
        const response = await requestQq<any>('user_playlist', {});
        playlistRound = { userId, response, playlists: Array.isArray(response?.playlist) ? response.playlist : [] };
    }
    const { response, playlists } = playlistRound;
    const items = playlists
        .slice(offset, offset + Math.max(0, limit))
        .map((item: unknown) => normalizeQqCollection(item));
    const nextOffset = offset + items.length;
    const total = Number(response?.total);
    if (offset === 0) {
        // `more` reports an upstream continuation this endpoint cannot request, so it is only observable here.
        console.info('[QQProvider] playlists:loaded', {
            count: playlists.length,
            ...(Number.isFinite(total) ? { total } : {}),
            more: Boolean(response?.more),
        });
    }

    return {
        items,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        hasMore: nextOffset < playlists.length,
        nextOffset,
    };
};

const LIKED_SONG_PAGE_SIZE = 100;

// The id of every liked song, read a page at a time, for 10000 songs at most.
const getLikedSongIds = async (_userId: MediaId): Promise<ProviderLikedSongIds> => {
    const tracks: unknown[] = [];
    let offset = 0;
    let whole = false;
    while (offset < 10000) {
        const page = await loadRawLikedTracks(LIKED_SONG_PAGE_SIZE, offset);
        // An answer without the list is no empty list: the read fails.
        if (!page.listed) throw new OnlineProviderError('invalid-response', 'QQ liked songs are missing', 'qq');
        tracks.push(...page.tracks);
        const nextOffset = offset + page.tracks.length;
        const ended = !page.more && (page.total === undefined || nextOffset >= page.total);
        // Whole where the list ends by QQ's own count of it or, where QQ gives no count, on a page
        // that is not full: a full page without a count may have songs after it.
        whole = ended && (page.total !== undefined || page.tracks.length < LIKED_SONG_PAGE_SIZE);
        if (page.tracks.length === 0 || ended) break;
        offset = nextOffset;
    }
    return {
        ids: tracks
            .map(normalizeQqSong)
            .map(item => item.sourceRef?.kind === 'online' ? item.sourceRef.mediaId : item.id)
            .filter((id): id is MediaId => id !== undefined && id !== null && id !== ''),
        whole,
    };
};

// QQ's own count of the liked list, from the first request of the read above; null where QQ gives none.
const getLikedSongCount = async (_userId: MediaId): Promise<number | null> => (
    (await loadRawLikedTracks(LIKED_SONG_PAGE_SIZE, 0)).total ?? null
);

const getUserAlbums = async (
    _userId: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    // 这条 route 只读会话账号，没有 uid 参数 —— 与 `/user/playlist` 的 uid 兜底不同。
    // 分页也是后端做的，不像歌单那样一次全取回来再本地切片。
    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    const response = await requestQq<any>('user_albums', { offset: safeOffset, limit: safeLimit });
    const albums = Array.isArray(response?.albums) ? response.albums : [];
    const items = albums.map((item: unknown) => normalizeQqCollection(item, 'album'));
    const nextOffset = safeOffset + items.length;
    const total = Number(response?.total);

    return {
        items,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        // 空页一律终止翻页：后端说 more 但一条都没给的话，继续翻就是死循环。
        hasMore: Boolean(response?.more) && items.length > 0,
        nextOffset,
    };
};

// `/getAlbumInfo` 一次返回专辑详情与全部曲目，专辑详情与曲目两个方法共用同一份响应形状。
const loadRawAlbum = async (id: MediaId): Promise<{ album: any; tracks: unknown[] }> => {
    const response = await requestQq<any>('album_info', { albummid: String(id ?? '').trim() });
    const data = response?.response?.data;
    const album = data && typeof data === 'object' && !Array.isArray(data) ? data : undefined;
    return { album, tracks: Array.isArray(album?.list) ? album.list : [] };
};

const getAlbumDetail = async (
    id: MediaId,
    existingCollection?: ProviderCollection,
): Promise<ProviderCollection | null> => {
    const { album } = await loadRawAlbum(id);
    if (!album) return existingCollection || null;

    const normalized = normalizeQqCollection({ ...album, albummid: album.mid ?? String(id) }, 'album');
    return {
        ...normalized,
        name: normalized.name || existingCollection?.name || '',
        coverUrl: normalized.coverUrl || existingCollection?.coverUrl,
        description: normalized.description || existingCollection?.description,
        trackCount: normalized.trackCount !== undefined && normalized.trackCount > 0
            ? normalized.trackCount
            : existingCollection?.trackCount,
        artists: normalized.artists?.length ? normalized.artists : existingCollection?.artists,
        publishedAt: normalized.publishedAt ?? existingCollection?.publishedAt,
        publisher: normalized.publisher || existingCollection?.publisher,
    };
};

const getAlbumTracks = async (
    id: MediaId,
    limit = 50,
    offset = 0,
    collection?: ProviderCollection,
): Promise<ProviderPage<ReturnType<typeof normalizeQqSong>>> => {
    // 上游一次返回整张专辑且不接受分页参数，所以页窗在本地切片，与歌单曲目的处理方式一致。
    const { album, tracks } = await loadRawAlbum(id);
    // 专辑曲目条目只带 albumname 顶层字段，正规化后专辑名为空，用专辑本身的名字补齐。
    const albumName = String(collection?.name || album?.name || '');
    const items = tracks
        .slice(offset, offset + Math.max(0, limit))
        .map(raw => {
            const song = normalizeQqSong(raw);
            if (song.album.name || !albumName) return song;
            return { ...song, album: { ...song.album, name: albumName } };
        });
    const total = Number(album?.total_song_num ?? album?.total ?? tracks.length);
    const nextOffset = offset + items.length;
    return {
        items,
        ...(Number.isFinite(total) && total >= 0 ? { total } : {}),
        hasMore: nextOffset < tracks.length,
        nextOffset,
    };
};

const getArtistDetail = async (id: MediaId): Promise<ProviderCollection | null> => {
    const singermid = String(id ?? '').trim();
    if (!singermid) return null;

    // `get_singer_detail_info` 与歌手曲目共用一条路由，顺带返回 singer_info、singer_brief 与两个总数，
    // 所以详情不另开端点，只取一首歌把响应压到最小。简介与总数是 singer_info 的兄弟字段，需要摊平后再正规化。
    const response = await requestQq<any>('artist_songs', { singermid, limit: 1, page: 1 });
    const data = response?.response?.singer?.data;
    // 头像上游不给，由 mid 按 photo_new 规则补齐。
    return normalizeQqCollection({
        singermid,
        ...(data && typeof data === 'object' ? data.singer_info : undefined),
        singer_brief: data?.singer_brief,
        total_song: data?.total_song,
        total_album: data?.total_album,
    }, 'artist');
};

const getArtistSongs = async (
    id: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ReturnType<typeof normalizeQqSong>>> => {
    const pageSize = Math.max(1, limit);
    // `/getSingerHotsong` 的 page 是从 1 起算的页码，上游会换算成 sin = (page - 1) * num。
    const response = await requestQq<any>('artist_songs', {
        singermid: String(id ?? '').trim(),
        limit: pageSize,
        page: Math.floor(Math.max(0, offset) / pageSize) + 1,
    });
    const data = response?.response?.singer?.data;
    const songs = Array.isArray(data?.songlist) ? data.songlist : [];
    const items = songs.map(normalizeQqSong);
    const total = Number(data?.total_song);
    const nextOffset = offset + items.length;
    const hasTotal = Number.isFinite(total) && total >= 0;
    return {
        items,
        ...(hasTotal ? { total } : {}),
        hasMore: hasTotal ? nextOffset < total : items.length >= pageSize,
        nextOffset,
    };
};

const getArtistAlbums = async (
    id: MediaId,
    limit: number,
    offset: number,
): Promise<ProviderPage<ProviderCollection>> => {
    const pageSize = Math.max(1, limit);
    // 同名参数在两个端点语意相反：`/getSingerAlbum` 把 page 直接当 begin 偏移量用，所以原样传 offset。
    const response = await requestQq<any>('artist_albums', {
        singermid: String(id ?? '').trim(),
        limit: pageSize,
        page: Math.max(0, offset),
    });
    const data = response?.response?.singer?.data;
    const albums = Array.isArray(data?.albumList) ? data.albumList : [];
    const items = albums
        .map((item: unknown) => normalizeQqCollection(item, 'album'))
        .filter((collection: ProviderCollection) => collection.id !== '');
    const total = Number(data?.total);
    const nextOffset = offset + albums.length;
    const hasTotal = Number.isFinite(total) && total >= 0;
    return {
        items,
        ...(hasTotal ? { total } : {}),
        hasMore: hasTotal ? nextOffset < total : albums.length >= pageSize,
        nextOffset,
    };
};

export const qqProvider: OnlineMusicProvider = {
    id: 'qq',
    displayName: 'QQ Music',
    shortName: 'QQ音乐',
    mark: { letter: 'Q', color: '#FEDB00', icon: 'qq' },
    getAvailability,
    describeFailure: describeQqFailure,
    capabilities: {
        search: true,
        playback: true,
        lyrics: true,
        auth: true,
        userLibrary: true,
        playlists: true,
        albums: true,
        artists: true,
        // 推荐、歌单增删与收藏歌单是 qq-music-api 3.3.0 的路由，红心与收藏专辑是 3.3.1 的。
        recommendations: true,
        mutations: true,
        playlistTrackMutations: true,
        playlistSubscription: true,
        wordByWordLyrics: true,
        likes: true,
        userAlbums: true,
        // 音乐云盘与探索页是 qq-music-api 3.3.3 的路由。
        userCloud: true,
        explore: true,
    },
    normalizeSong: normalizeQqSong,
    normalizeUser: normalizeQqUser,
    normalizeCollection: normalizeQqCollection,
    songMetadata: {
        getSongMetadata(song) {
            return createProviderSongMetadata(song);
        },
    },
    // 网页版的单曲页按 songmid 定位。只认真的 songmid：没有 mid 的条目 mediaId 会退成数字 id，拿它拼出来的是错的页面。
    getSongPageUrl(song) {
        const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq' ? song.sourceRef : undefined;
        const songmid = String(song.qqMid || sourceRef?.providerData?.songMid || '').trim();
        return songmid ? `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(songmid)}` : null;
    },
    search: { searchSongs: searchQqSongs },
    playback: { getSongDetail: getQqSongDetailById, getSongDetails: getQqSongDetails, songDetailsPerRequest: QQ_SONG_DETAILS_PER_REQUEST, getAudioSource },
    lyrics: { getLyrics },
    auth: {
        getLoginTexts: () => ({
            // 和 caseNotes 一样，到窗口真的要显示时才看这一次登录解析出的方式：只给 QQ 音乐 App 扫码时说三种 App 都能扫，
            // 选择器里有三种方式时说明也说三种。
            get title() {
                return loginShape().appOnly ? 'home.loginTitleQqAppScan' : 'home.loginTitleQq';
            },
            get note() {
                const shape = loginShape();
                if (shape.appOnly) return 'home.loginNoteQqAppScan';
                return shape.offersQqMusic ? 'home.loginNoteQqWithApp' : 'home.loginNoteQq';
            },
            // 窗口每次画失败时都来读：扫错 App 那一句照这一次登录解析出的方式说，账号本身的问题照最后一次检查失败说。
            get caseNotes() {
                const accountNote = qqAccountHintNote(lastAccountHintKey);
                return {
                    'local-service-unavailable': 'home.loginCaseQqRestart',
                    // 登录设备满了要去哪里清：QQ 音乐 App 的设置最下面「设备管理」。共用那一句只说在手机上退出。
                    'device-limit': 'home.loginCaseQqDeviceLimit',
                    // 扫错 App 时说怎么改：后端提供 QQ 音乐 App 扫码就请用的人改选它，没有就只能用手机 QQ 扫。
                    // 文字在登录开始、通道还没问到时就拿走了，所以到窗口真的要显示时才看。
                    'wrong-scan-app': loginShape().offersQqMusic
                        ? 'home.loginCaseQqWrongScanApp'
                        : 'home.loginCaseQqWrongScanAppMobileOnly',
                    // 账号被封、受限、绑定有问题时说怎么回事、该做什么（qqLoginFailure.ts）；别的拒绝用共用那一句。
                    ...(accountNote ? { refused: accountNote } : {}),
                };
            },
        }),
        getLoginStatus,
        logout,
        // The session this page keeps for the backend goes the same way.
        signInRanOut: logout,
        showsKeptAccountAtStart: true,
        getLoginMethods,
        resolveLoginMethods,
        // 没拿到 key 或图片就在那一步失败：空 key 只会换来后端的 400，空图片会让登录窗口一直转圈。
        async startLogin(methodId) {
            qrKeyRequestedAt = Date.now();
            lastAccountHintKey = null;
            const channel = resolveQrLoginMethodId(methodId);
            const response = await requestQq<any>('login_qr_key', { channel });
            const key = String(response?.data?.unikey || '');
            if (key.trim()) {
                lastQrLogin = { key, channel };
                return key;
            }
            throw new OnlineProviderError('invalid-response', 'QQMusicApi login_qr_key returned no key', 'qq', response);
        },
        async createQr(key) {
            const response = await requestQq<any>('login_qr_create', { key });
            const image = String(response?.data?.qrimg || '');
            if (image.trim()) return image;
            throw new OnlineProviderError('invalid-response', 'QQMusicApi login_qr_create returned no image', 'qq', response);
        },
        checkLogin,
        describeLoginFailure: describeQqLoginFailure,
        getLoginDiagnostics: () => collectQqLoginDiagnostics({
            hasSession: hasQqSession(),
            channels: declaredChannels,
            shownMethods: shownLoginMethodIds(),
            lastAccountCheck: lastLoginStatusCheck,
        }),
        canRunLoginSelfCheck: () => canRunLoginSelfCheck(getQqRemoteApiBase()),
        // QQ 的登录态只经系统钥匙串加密保存（qqAuthSessionRepository）：自检要查凭据仓库。
        runLoginSelfCheck: async () => {
            const result = await runLoginSelfCheck('qq', getQqRemoteApiBase());
            return result && { ...result, keepsSignInEncrypted: true };
        },
        getLoginTtlMs: () => QQ_QR_TTL_MS,
        async cancelLogin(key) {
            // 后端对未知 key 也回 200，所以失败只可能是网络层。调用方在关窗时 fire-and-forget，
            // 抛出去只会让 UI 卡在一个用户无从处理的错误上，而残留会话最迟 3 分钟后自己过期。
            await requestQq('login_qr_cancel', { key }).catch(error => {
                console.warn('[QQProvider] qr-cancel:failed', error);
            });
        },
    },
    library: {
        getUserPlaylists,
        getUserAlbums,
        getLikedSongIds,
        getLikedSongCount,
        areSongsLiked: areQqSongsLiked,
        getCloudCollection: getQqCloudCollection,
    },
    catalog: {
        // 只要拿得到 songmid 就补得回 mid，所以能否导航等同于这首歌是不是 QQ 的歌。
        canResolveSongCatalogRefs: song => Boolean(getQqSongMid(song)),
        resolveSongCatalogRefs: resolveQqSongCatalogRefs,
        getPlaylistTracks,
        getPlaylistDetail,
        getCloudTracks: (limit, offset) => getQqCloudTracks(limit, offset),
        getAlbumDetail,
        getAlbumTracks,
        getArtistDetail,
        getArtistSongs,
        getArtistAlbums,
        getSubscriptionStatus: getQqSubscriptionStatus,
    },
    recommendations: qqRecommendations,
    explore: qqExplore,
    mutations: qqMutations,
};
