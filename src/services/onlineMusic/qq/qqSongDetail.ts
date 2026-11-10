import type { UnifiedSong } from '../../../types';
import type { MediaId } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { normalizeQqSong } from './qqNormalize';
import { requestQq, requestQqMusicu, type QqMusicuAnswer, type QqMusicuRequest } from './qqTransport';

// src/services/onlineMusic/qq/qqSongDetail.ts
// `/getSongInfo` 单曲详情：播放侧的 getSongDetail、搜索结果补 mid、歌单写入补数字 id 都用它。
// 按数字 songid 的查询和批量查询不经后端，经 `requestQqMusicu`。

export const getQqSongDetail = async (id: MediaId): Promise<UnifiedSong | null> => {
    const response = await requestQq<any>('song_info', { songmid: String(id) });
    const track = response?.response?.songinfo?.data?.track_info;
    if (!track || typeof track !== 'object') return null;
    const song = normalizeQqSong(track);
    return song.qqMid ? song : null;
};

// QQ 的数字 songid：没有前导 0 的正整数，不大于 int32（QQ 按 int32 读 song_id，更大的回 500，
// 实测见 test/manual/qq_musicu_song_detail_probe.mjs 的 e 条）。
// songmid 是 14 位、以 0 开头的字母数字串，不会被认成它。其余的一律当 songmid。
const QQ_SONG_ID_MAX = 2_147_483_647;

/** 一个 id 是数字 songid 时交回那个数，否则 null（当 songmid）。只给本目录和测试用。 */
export const qqSongIdOf = (id: MediaId): number | null => {
    const value = String(id).trim();
    if (!/^[1-9]\d*$/.test(value)) return null;
    const songId = Number(value);
    return songId <= QQ_SONG_ID_MAX ? songId : null;
};

// 一次 musicu 请求放几首：实测 30 个子请求还行、31 个起整次 500000（test/manual/qq_musicu_song_detail_probe.mjs 的 h、i 条），
// 留 5 个余量。25 让 folium.omni 的 50 个键正好两个请求。
export const QQ_SONG_DETAILS_PER_REQUEST = 25;

// 和后端 `/getSongInfo` 发的是同一个子请求，只是 song_id 是 JSON 数字：QQ 对字符串的 song_id 回 404 空壳，
// 上游 3.3.3 正是把 songid 当字符串交过去的。不是数字 songid 的按 song_mid 查。
const detailRequest = (id: MediaId): QqMusicuRequest => {
    const songId = qqSongIdOf(id);
    return {
        module: 'music.pf_song_detail_svr',
        method: 'get_song_detail_yqq',
        param: songId !== null ? { song_type: 0, song_id: songId } : { song_type: 0, song_mid: String(id).trim() },
    };
};

// 一个子请求的回答。code 0 是查到了，或答了没有（mid 为空的空壳）；404 是 QQ 对查不到的 songmid、字符串 song_id 的
// 回答，也是空壳。别的码（含缺失）是拒绝：抛错而不是答 null。后端路径（getQqSongDetail）对非 0 码一律读成 null，
// 这里更严，因为 null 是「QQ 没有这首」，调用方会把它记下来。
const songOfAnswer = (id: MediaId, answer: QqMusicuAnswer | undefined): UnifiedSong | null => {
    const code = answer?.code;
    if (code !== 0 && code !== 404) {
        throw new OnlineProviderError(
            'invalid-response',
            `QQ musicu song detail was refused for ${String(id).trim()} (code ${code ?? 'missing'})`,
            'qq',
            { id: String(id).trim(), code },
        );
    }
    const track = (answer?.data as { track_info?: unknown } | null | undefined)?.track_info;
    if (!track || typeof track !== 'object') return null;
    const song = normalizeQqSong(track);
    return song.qqMid ? song : null;
};

/**
 * 按 id 批量查歌：播放侧的 getSongDetails（omni.getSongDetails，folium.omni 的 resolveSongs 经它）。数字 songid 和 songmid
 * 都收，都直发 musicu：后端没有批量接口；songmid 在 QQ 的 `UnifiedSong.id` 里只出现在上游没给数字 id 的歌上，很少，
 * 两种口径又是同一个 QQ 请求，不必为它另发后端请求。
 * QQ_SONG_DETAILS_PER_REQUEST 个一组，一组一次请求，一组接一组发、不并发，按入参顺序交回。经 omni 时
 * （`songDetailsPerRequest`）一次只会收到一组，只发一个请求；切组只为没有经 omni 的调用者。任何一组被拒、任何一个
 * 子请求被拒，整次 reject，不回一串 null。不去重（folium.omni 那一层已经按来源分组去重）。
 */
export const getQqSongDetails = async (ids: MediaId[]): Promise<(UnifiedSong | null)[]> => {
    const songs: (UnifiedSong | null)[] = [];
    for (let start = 0; start < ids.length; start += QQ_SONG_DETAILS_PER_REQUEST) {
        const group = ids.slice(start, start + QQ_SONG_DETAILS_PER_REQUEST);
        const answers = await requestQqMusicu(Object.fromEntries(group.map((id, index) => [`q${index}`, detailRequest(id)])));
        group.forEach((id, index) => songs.push(songOfAnswer(id, answers[`q${index}`])));
    }
    return songs;
};

/**
 * 按 id 查一首歌：播放侧的 getSongDetail（omni.getSongDetail，歌词导出补元数据会用）。收到的可能是播放键 songmid，
 * 也可能是这首歌的 `UnifiedSong.id`，也就是数字 songid（qqNormalize.ts）。
 *
 * 数字 songid 直发 musicu（getQqSongDetails 的一个键），不走后端：上游 3.3.3 的 `/getSongInfo` 把 songid 当字符串
 * 交给 QQ，QQ 只认数字；serverless 的这条路由又是 songmid 必填。songmid 照旧走后端（getQqSongDetail），老调用者一点
 * 不变。所以单曲和批量对 songmid 的走法不同：批量 getQqSongDetails 里的 songmid 经 musicu 的 song_mid。
 */
export const getQqSongDetailById = async (id: MediaId): Promise<UnifiedSong | null> => {
    if (qqSongIdOf(id) !== null) return (await getQqSongDetails([id]))[0];
    return getQqSongDetail(id);
};

const qqSongDetailRequests = new Map<string, Promise<UnifiedSong | null>>();

// 同一首歌的专辑与歌手会各触发一次解析，两次落到同一个 songmid 上，去重掉重复请求。
export const requestQqSongDetail = (songmid: string): Promise<UnifiedSong | null> => {
    const cached = qqSongDetailRequests.get(songmid);
    if (cached) return cached;

    const request = getQqSongDetail(songmid).finally(() => {
        if (qqSongDetailRequests.get(songmid) === request) qqSongDetailRequests.delete(songmid);
    });
    qqSongDetailRequests.set(songmid, request);
    return request;
};
