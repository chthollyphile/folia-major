import type { UnifiedSong } from '../../../types';
import type { OnlineRecommendationProvider, ProviderCollection } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { normalizeQqCollection, normalizeQqSong } from './qqNormalize';
import { hasUsableQqSession, requestQq, type QqOperation } from './qqTransport';

// src/services/onlineMusic/qq/qqRecommendations.ts
// QQ 音乐的推荐：猜你喜欢（私人 FM）、每日 30 首、推荐歌单。猜你喜欢与推荐歌单是 qq-music-api 3.2.0 加的，每日 30 首是 3.3.0，
// 出错时用状态码加固定的 errorKey 说明原因：422 是「上游成功但没有数据」，不是网络错误；旧后端没有这些路由，回 404。

// 422（resource.not-found）是确实没有数据；404 是这个后端还没有这条路由。两者都当成空结果，不算失败。
const isEmptyAnswer = (error: unknown): boolean => error instanceof OnlineProviderError && (
    error.code === 'unsupported'
    || (error.code === 'network' && error.httpStatus === 422)
);

/** 读一条回 `{ songs }` 的推荐路由。这几条都要登录：没有会话、或会话这次停用（不带）时不发请求，免得白收一个 401。 */
const loadRecommendedSongs = async (operation: QqOperation): Promise<UnifiedSong[]> => {
    if (!hasUsableQqSession()) return [];
    try {
        const response = await requestQq<any>(operation);
        const songs = Array.isArray(response?.songs) ? response.songs : [];
        return songs.map(normalizeQqSong).filter((song: UnifiedSong) => Boolean(song.qqMid));
    } catch (error) {
        if (isEmptyAnswer(error)) return [];
        throw error;
    }
};

/**
 * 私人 FM 一批（猜你喜欢，每批几首）。批内去重；跨批的重复交给续歌的地方按队列去掉（utils/fmQueue）——
 * 这里分不清这一批是进了播放队列，还是只给首页电台卡当封面。
 * 失败只记日志、回空：FM 续歌和首页电台卡都按「这次没有歌」处理，不让一次上游拒绝（22006）拖垮整页。
 */
const getPersonalFm = async (): Promise<UnifiedSong[]> => {
    try {
        const batch = await loadRecommendedSongs('user_guess_you_like');
        return batch.filter((song, index) => batch.findIndex(other => other.qqMid === song.qqMid) === index);
    } catch (error) {
        console.warn('[QQProvider] personal-fm:failed', error);
        return [];
    }
};

// 后端没有 refresh 参数，同一天拿到的是同一批，所以忽略「换一批」。
const getDailySongs = (): Promise<UnifiedSong[]> => loadRecommendedSongs('user_daily_songs');

// `/recommend/playlists` 的 limit 默认 25、最多 60；有会话就带凭证读，没有就匿名读。
const RECOMMEND_PLAYLISTS_MAX = 60;

const getRecommendedCollections = async (limit: number): Promise<ProviderCollection[]> => {
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

export const qqRecommendations: OnlineRecommendationProvider = {
    getPersonalFm,
    getDailySongs,
    getRecommendedCollections,
};
