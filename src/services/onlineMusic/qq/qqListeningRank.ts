import i18n from '../../../i18n/config';
import type { UnifiedSong } from '../../../types';
import { OnlineProviderError, type ListeningRankRange, type ProviderCollection, type ProviderPage, type ProviderUser } from '../../../types/onlineMusic';
import { LISTENING_RANK_RANGES, listeningRankCollection, listeningRankPage, withListenCount } from '../listeningRank';
import { normalizeQqSong } from './qqNormalize';
import { requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqListeningRank.ts
// QQ 的听歌排行（qq-music-api 3.3.6 的 /user/listening-rank，只读本人）。共用的「最近一周」读 QQ 的周榜：
// 从周一算起，这一周没过完就只到今天；共用的「所有时间」QQ 没有，先拿年榜顶上，名字和说明都写明是年榜，
// 不冒充真正的历史总排行。名字用 QQ 自己的词条，不动其他平台的「最近一周／所有时间」。旧后端没有这条路由，
// 就没有排行条目。

const QQ_RANGE: Record<ListeningRankRange, 'week' | 'year'> = { week: 'week', all: 'year' };

/** 一个时段的排行，按 QQ 给的先后，每首带上播放次数。 */
const readQqListeningRank = async (range: ListeningRankRange): Promise<UnifiedSong[]> => {
    const answer = await requestQq<{ items?: unknown }>('user_listening_rank', { range: QQ_RANGE[range] });
    if (!Array.isArray(answer?.items)) {
        throw new OnlineProviderError('invalid-response', 'QQMusicApi user_listening_rank answered without items', 'qq');
    }
    return answer.items.flatMap((item: any) => (item && typeof item === 'object' && item.track
        ? [withListenCount(normalizeQqSong(item.track), item.listenCount)]
        : []));
};

const isMissingRoute = (error: unknown) => error instanceof OnlineProviderError && error.code === 'unsupported';

/** 两个时段各一个条目；没听过歌的时段没有条目，后端没有这条路由时一个都没有。 */
export const getQqListeningRankCollections = async (user: ProviderUser): Promise<ProviderCollection[]> => {
    let ranked: { range: ListeningRankRange; songs: UnifiedSong[] }[];
    try {
        ranked = await Promise.all(LISTENING_RANK_RANGES.map(async range => ({ range, songs: await readQqListeningRank(range) })));
    } catch (error) {
        if (isMissingRoute(error)) return [];
        throw error;
    }
    console.info(`[QQ] Listening rank: ${ranked.map(({ range, songs }) => `${range} ${songs.length}`).join(', ')}`);
    return ranked
        .filter(({ songs }) => songs.length > 0)
        .map(({ range, songs }) => ({
            ...listeningRankCollection('qq', user, range, songs),
            name: i18n.t(range === 'week' ? 'listeningRank.qqWeek' : 'listeningRank.qqYear'),
            description: i18n.t(range === 'week' ? 'listeningRank.qqWeekDescription' : 'listeningRank.qqYearDescription'),
        }));
};

/** 排行是整份读回来的，一页就是其中一段。 */
export const getQqListeningRankTracks = async (range: ListeningRankRange, limit: number, offset: number): Promise<ProviderPage<UnifiedSong>> => (
    listeningRankPage(await readQqListeningRank(range), limit, offset)
);
