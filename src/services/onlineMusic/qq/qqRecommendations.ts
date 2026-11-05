import type { UnifiedSong } from '../../../types';
import type { MediaId, OnlineRecommendationProvider, PersonalFmRequestOptions, ProviderCollection, ProviderHistoryEntry } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { DEFAULT_PERSONAL_FM_CATALOG } from '../fmModes';
import { normalizeQqCollection, normalizeQqSong } from './qqNormalize';
import { getQqRecommendationPreferences, saveQqRecommendationPreferences } from './qqPreferences';
import { hasUsableQqSession, requestQq, type QqOperation } from './qqTransport';
import { getQqGuessYouLikeBatch, getQqGuessYouLikeCard, getQqGuessYouLikeCatalog, QQ_GUESS_YOU_LIKE_STATION } from './qqGuessYouLike';

// src/services/onlineMusic/qq/qqRecommendations.ts
// QQ 音乐的推荐：私人 FM、每日 30 首与它的历史、推荐歌单，以及歌曲不喜欢。猜你喜欢与推荐歌单是 qq-music-api 3.2.0 加的，每日 30 首是 3.3.0，私人 FM、历史日推与不喜欢是 3.3.6，
// 出错时用状态码加固定的 errorKey 说明原因：422 是「上游成功但没有数据」，不是网络错误；旧后端没有这些路由，回 404。

// 422（resource.not-found）是确实没有数据；404 是这个后端还没有这条路由。两者都当成空结果，不算失败。
const isEmptyAnswer = (error: unknown): boolean => error instanceof OnlineProviderError && (
    error.code === 'unsupported'
    || (error.code === 'network' && error.httpStatus === 422)
);

const songsOf = (response: any): UnifiedSong[] => (Array.isArray(response?.songs) ? response.songs : [])
    .map(normalizeQqSong)
    .filter((song: UnifiedSong) => Boolean(song.qqMid));

/** 读一条回 `{ songs }` 的推荐路由。这几条都要登录：没有会话、或会话这次停用（不带）时不发请求，免得白收一个 401。 */
const loadRecommendedSongs = async (operation: QqOperation): Promise<UnifiedSong[]> => {
    if (!hasUsableQqSession()) return [];
    try {
        return songsOf(await requestQq<any>(operation));
    } catch (error) {
        if (isEmptyAnswer(error)) return [];
        throw error;
    }
};

/**
 * 私人 FM 的一批。每次都要第 1 页：这里分不清这一批是进了播放队列，还是只给首页电台卡当封面，
 * 不记页码去推进，免得一张封面就吃掉一批。旧后端没有这条路由（404）时照旧读猜你喜欢。
 */
const loadPersonalFmBatch = async (): Promise<UnifiedSong[]> => {
    if (!hasUsableQqSession()) return [];
    try {
        return songsOf(await requestQq<any>('user_personal_fm', { page: 1 }));
    } catch (error) {
        if (error instanceof OnlineProviderError && error.code === 'unsupported') return loadRecommendedSongs('user_guess_you_like');
        if (isEmptyAnswer(error)) return [];
        throw error;
    }
};

/**
 * 私人 FM 一批（每批几首）；带着猜你喜欢电台（station）时是那个电台按所选模式的一批。私人 FM 没有模式，
 * 不看 mode。批内去重；跨批的重复交给续歌的地方按队列去掉（utils/fmQueue）。
 * 失败只记日志、回空：FM 续歌和首页电台卡都按「这次没有歌」处理，不让一次上游拒绝（22006）拖垮整页。
 */
const getPersonalFm = async (options?: PersonalFmRequestOptions): Promise<UnifiedSong[]> => {
    try {
        const batch = options?.station === QQ_GUESS_YOU_LIKE_STATION
            ? await getQqGuessYouLikeBatch(options)
            : await loadPersonalFmBatch();
        return batch.filter((song, index) => batch.findIndex(other => other.qqMid === song.qqMid) === index);
    } catch (error) {
        console.warn('[QQProvider] personal-fm:failed', error);
        return [];
    }
};

// 后端没有 refresh 参数，同一天拿到的是同一批，所以忽略「换一批」。
const getDailySongs = (): Promise<UnifiedSong[]> => loadRecommendedSongs('user_daily_songs');

/** 每日 30 首有历史的日期（`YYYY-MM-DD`），照后端的顺序；可能不连续，不在这里补日子。 */
const getHistoryDates = async (): Promise<string[]> => {
    if (!hasUsableQqSession()) return [];
    try {
        const response = await requestQq<any>('user_daily_history_dates');
        const dates: unknown[] = Array.isArray(response?.dates) ? response.dates : [];
        return dates.filter((date): date is string => typeof date === 'string' && date !== '');
    } catch (error) {
        if (isEmptyAnswer(error)) return [];
        throw error;
    }
};

// 某一天的每日 30 首；后端给几首就是几首，不补到 30。
const getHistorySongs = async (entry: ProviderHistoryEntry | string): Promise<UnifiedSong[]> => {
    if (!hasUsableQqSession()) return [];
    try {
        return songsOf(await requestQq<any>('user_daily_history', { date: typeof entry === 'string' ? entry : entry.id }));
    } catch (error) {
        if (isEmptyAnswer(error)) return [];
        throw error;
    }
};

/** 上游已经收下这次写入（accepted）：读回失败时它带在非 2xx 的错误体里。 */
const writeAccepted = (body: any): boolean => body?.writeAttempted === true && body?.accepted === true;

/**
 * 不喜欢这首歌：拉进账号的歌曲黑名单。手机上私人 FM、各个电台和每日 30 首的「不喜欢」都是这一下，
 * 不带电台或歌单的上下文。后端只认数字 songid。上游收下写入（accepted）就算成功：它只读黑名单首屏核对，
 * 首屏没看到（verified false）或核对那一读失败，都不说明没写进去；这时报失败只会让人再点一次、再写一次。
 * 只记日志里核对了没有。上游没收下才报错，都不重送。QQ 不给替换的歌，所以回 removed。
 */
const dislikeSong = async (id: MediaId): Promise<{ removed: true }> => {
    const songId = String(id ?? '').trim();
    if (!/^[1-9]\d*$/.test(songId)) {
        throw new OnlineProviderError('invalid-response', 'QQ song has no numeric song id for a dislike', 'qq');
    }
    try {
        const response = await requestQq<any>('user_blacklist_add', {}, { songs: [songId] });
        if (response?.verified !== true && response?.accepted !== true) {
            throw new OnlineProviderError('invalid-response', 'QQMusicApi user_blacklist_add returned no acknowledgement', 'qq', response);
        }
        console.info('[QQProvider] dislike:accepted', { verified: response?.verified === true });
        // QQ 没有替换曲：回 removed，日推视图据此把这一行去掉。
        return { removed: true };
    } catch (error) {
        if (error instanceof OnlineProviderError && writeAccepted(error.cause)) {
            console.warn('[QQProvider] dislike:accepted, read-back failed', error);
            return { removed: true };
        }
        console.warn('[QQProvider] dislike:failed', error);
        throw error;
    }
};

// `/recommend/playlists` 的 limit 默认 25、最多 60；有会话就带凭证读，没有就匿名读。
const RECOMMEND_PLAYLISTS_MAX = 60;

const getRecommendedPlaylists = async (limit: number): Promise<ProviderCollection[]> => {
    const safeLimit = Math.min(RECOMMEND_PLAYLISTS_MAX, Math.max(1, Math.floor(limit) || 1));
    try {
        const response = await requestQq<any>('recommend_playlists', { limit: safeLimit });
        const playlists = Array.isArray(response?.playlists) ? response.playlists : [];
        return playlists
            .map((item: unknown) => normalizeQqCollection(item))
            .filter((collection: ProviderCollection) => collection.id !== '' && Boolean(collection.name))
            .slice(0, safeLimit);
    } catch (error) {
        // 首页三块推荐一起取，推荐歌单失败不该连 FM 和日推一起拖下去。
        if (!isEmptyAnswer(error)) console.warn('[QQProvider] recommended-playlists:failed', error);
        return [];
    }
};

/** 电台页：猜你喜欢电台的卡片排在推荐歌单前面；它读不到不影响推荐歌单。 */
const getRecommendedCollections = async (limit: number): Promise<ProviderCollection[]> => {
    const [card, playlists] = await Promise.all([
        getQqGuessYouLikeCard().catch(error => {
            console.warn('[QQProvider] guess-you-like-card:failed', error);
            return null;
        }),
        getRecommendedPlaylists(limit),
    ]);
    return card ? [card, ...playlists].slice(0, Math.max(1, Math.floor(limit) || 1)) : playlists;
};

/**
 * 猜你喜欢电台的模式目录。私人 FM 没有模式（不宣告 personalFmModes），照旧给默认目录，和没有这个成员时一样；
 * 别的电台 id 不认。
 */
const getPersonalFmCatalog = async (station?: string) => {
    if (station === QQ_GUESS_YOU_LIKE_STATION) return getQqGuessYouLikeCatalog();
    if (!station) return DEFAULT_PERSONAL_FM_CATALOG;
    throw new OnlineProviderError('unsupported', 'QQ has no such station', 'qq');
};

export const qqRecommendations: OnlineRecommendationProvider = {
    getPersonalFm,
    getPersonalFmCatalog,
    getDailySongs,
    getRecommendedCollections,
    getHistoryDates,
    getHistorySongs,
    dislikeSong,
    // 账号的音乐偏好同时影响私人 FM 和每日 30 首，所以三处都开入口。
    preferenceEntries: ['explore', 'personal-fm', 'daily'],
    getRecommendationPreferences: getQqRecommendationPreferences,
    saveRecommendationPreferences: saveQqRecommendationPreferences,
};
