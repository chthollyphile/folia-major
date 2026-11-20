import type { FoliumSourceCollection, FoliumSourcePage, FoliumSourceSong, FoliumSourceUser } from '@folia/folium';
import { isQqError, qqError, qqText } from './qqEnv';
import { normalizeQqSong } from './qqNormalize';
import { requestQq } from './qqTransport';

// sources/qq/core/qqListeningRank.ts
// QQ 的听歌排行（qq-music-api 3.3.6 的 /user/listening-rank，只读本人）。共用的「最近一周」读 QQ 的周榜：
// 从周一算起，这一周没过完就只到今天；共用的「所有时间」QQ 没有，先拿年榜顶上，名字和说明都写明是年榜，
// 不冒充真正的历史总排行。名字用 QQ 自己的词条（模组的 listeningRank.*），不动其他平台的「最近一周／所有时间」。
// 旧后端没有这条路由，就没有排行条目。

type ListeningRankRange = 'week' | 'all';

const LISTENING_RANK_RANGES: readonly ListeningRankRange[] = ['week', 'all'];
const QQ_RANGE: Record<ListeningRankRange, 'week' | 'year'> = { week: 'week', all: 'year' };

/** QQ 给的播放次数，记在排行这一行上（row.listenCount）；别的值不动这首歌。 */
const withListenCount = (song: FoliumSourceSong, count: unknown): FoliumSourceSong => {
    const value = Number(count);
    return count !== null && count !== undefined && count !== '' && Number.isFinite(value) && value >= 0
        ? { ...song, row: { ...song.row, listenCount: Math.floor(value) } }
        : song;
};

/** 一个时段的排行，按 QQ 给的先后，每首带上播放次数。 */
const readQqListeningRank = async (range: ListeningRankRange): Promise<FoliumSourceSong[]> => {
    const answer = await requestQq<{ items?: unknown }>('user_listening_rank', { range: QQ_RANGE[range] });
    if (!Array.isArray(answer?.items)) {
        throw qqError('invalid-response', 'QQMusicApi user_listening_rank answered without items');
    }
    return answer.items.flatMap((item: any) => (item && typeof item === 'object' && item.track
        ? [withListenCount(normalizeQqSong(item.track), item.listenCount)]
        : []));
};

/**
 * 一个时段的条目。id 里有这个账号：一个账号的排行不会当成另一个的给人看、存下来。名字按应用的语言，
 * 和歌单排在一起。
 */
const listeningRankCollection = (user: FoliumSourceUser, range: ListeningRankRange, songs: readonly FoliumSourceSong[]): FoliumSourceCollection => {
    const coverUrl = songs.find(song => song.album?.coverUrl)?.album?.coverUrl || user.avatarUrl;
    return {
        id: `listening-rank-${range}-${user.id}`,
        type: 'listening_rank',
        listeningRank: range,
        name: qqText(range === 'week' ? 'listeningRank.week' : 'listeningRank.year'),
        description: qqText(range === 'week' ? 'listeningRank.weekDescription' : 'listeningRank.yearDescription'),
        ...(coverUrl ? { coverUrl } : {}),
        trackCount: songs.length,
        isOwned: false,
        creator: user,
    };
};

/** 两个时段各一个条目；没听过歌的时段没有条目，后端没有这条路由时一个都没有。 */
export const getQqListeningRankCollections = async (user: FoliumSourceUser): Promise<FoliumSourceCollection[]> => {
    let ranked: { range: ListeningRankRange; songs: FoliumSourceSong[] }[];
    try {
        ranked = await Promise.all(LISTENING_RANK_RANGES.map(async range => ({ range, songs: await readQqListeningRank(range) })));
    } catch (error) {
        if (isQqError(error, 'unsupported')) return [];
        throw error;
    }
    console.info(`[QQ] Listening rank: ${ranked.map(({ range, songs }) => `${range} ${songs.length}`).join(', ')}`);
    return ranked
        .filter(({ songs }) => songs.length > 0)
        .map(({ range, songs }) => listeningRankCollection(user, range, songs));
};

/** 排行是整份读回来的，一页就是其中一段。 */
export const getQqListeningRankTracks = async (range: ListeningRankRange, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>> => {
    const songs = await readQqListeningRank(range);
    const items = songs.slice(offset, offset + limit);
    return { items, total: songs.length, hasMore: offset + items.length < songs.length, nextOffset: offset + items.length };
};
