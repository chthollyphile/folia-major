import { OnlineProviderError, type ProviderCollection } from '../../../types/onlineMusic';
import { normalizeQqCollection } from './qqNormalize';
import { qqProvider } from './qqProvider';
import { hasQqSession, requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqPlaylistDiagnostics.ts

/**
 * 只读探针：把 QQ 歌单这条链路上的原始标识字段暴露出来，用于定位「自建歌单全部为空」。
 *
 * 放在 adapter 层是因为它必须看原始响应；返回的是稳定的探针类型，页面不接触 provider 字段名。
 * 它不参与任何正常播放流程，UI 里也没有入口，只有 `/qq-diag.html` 手动打开时才会运行。
 */

/** 文档里作为示例的公开歌单，用作对照组：它能出歌就说明路由本身是通的。 */
export const PUBLIC_PLAYLIST_CONTROL_ID = '7011264340';

/** 正规化之后的集合本体，供探针把 provider 的真实入参一并带上。 */
export interface QqPlaylistProbeEntry {
    collection: ProviderCollection;
    /** 正规化之后的集合 id —— 也就是 `getPlaylistTracks` 实际收到的那个值。 */
    normalizedId: string;
    name: string;
    trackCount?: number;
    /** 上游条目里与身份有关的原始字段，原样透出。 */
    identity: Record<string, string | number | boolean | null>;
    /** 上游这条记录的全部键名，用来确认 `dissid` 到底存不存在。 */
    rawKeys: string[];
}

export interface QqPlaylistDetailProbe {
    disstid: string;
    /** 上游是否给出了歌单本体（`cdlist[0]`）。 */
    ok: boolean;
    code?: number;
    subcode?: number;
    message?: string;
    cdlistLength?: number;
    songlistLength?: number;
    totalSongNum?: number;
    dissName?: string;
    /** 上游的可见性标志（`dir_show`）：1 公开、2 不公开（实测值）。匿名 CGI 读不读得到取决于它。 */
    dirShow?: number;
    /** 上游自己回声的 `disstid`，用来确认请求 id 被当成了什么。 */
    echoedDisstid?: string;
    /** 请求整体失败（网络、鉴权、上游拒收）时的说明。 */
    error?: string;
    /** songlist 第一条的键名与截断样本，用来核对它和 normalizeQqSong 的期待是否对得上。 */
    sampleSongKeys?: string[];
    sampleSong?: Record<string, unknown>;
}

/** 走完整 provider 链路（含 normalizeQqSong）的结果，用来把 transport 与 provider 分开定位。 */
export interface QqPlaylistTracksProbe {
    requestedId: string;
    itemCount?: number;
    total?: number;
    hasMore?: boolean;
    nextOffset?: number;
    firstItem?: Record<string, unknown>;
    error?: string;
}

const IDENTITY_KEYS = ['tid', 'dissid', 'dirId', 'dirid', 'id', 'dirShow', 'dirType', 'type'];

const scalar = (value: unknown): string | number | boolean | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    return JSON.stringify(value).slice(0, 120);
};

export const probeQqPlaylists = async (): Promise<QqPlaylistProbeEntry[]> => {
    if (!hasQqSession()) throw new OnlineProviderError('auth-required', 'QQ 账号未登录', 'qq');

    const response = await requestQq<any>('user_playlist', {});
    const playlists = Array.isArray(response?.playlist) ? response.playlist : [];

    return playlists.map((raw: any) => {
        const item = raw && typeof raw === 'object' ? raw : {};
        const normalized = normalizeQqCollection(item);
        const identity: Record<string, string | number | boolean | null> = {};
        IDENTITY_KEYS.forEach(key => {
            if (item[key] !== undefined) identity[key] = scalar(item[key]);
        });
        return {
            collection: normalized,
            normalizedId: String(normalized.id ?? ''),
            name: normalized.name,
            ...(normalized.trackCount === undefined ? {} : { trackCount: normalized.trackCount }),
            identity,
            rawKeys: Object.keys(item).sort(),
        };
    });
};

/** songlist 首条的形状摘要。只取标识与显示字段，避免把整条上游响应搬进页面。 */
const songSample = (raw: unknown): Pick<QqPlaylistDetailProbe, 'sampleSongKeys' | 'sampleSong'> => {
    if (!raw || typeof raw !== 'object') return {};
    const item = raw as Record<string, unknown>;
    const sample: Record<string, unknown> = {};
    ['id', 'mid', 'songid', 'songmid', 'name', 'title', 'songname', 'interval', 'album', 'singer', 'file']
        .forEach(key => {
            if (item[key] === undefined) return;
            sample[key] = scalar(item[key]);
        });
    return { sampleSongKeys: Object.keys(item).sort(), sampleSong: sample };
};

/**
 * 打一次匿名的歌单详情路由，并把上游状态码原样带回来。
 *
 * 这里刻意吞掉 `OnlineProviderError` 而不是让它冒泡：探针的价值就在于展示被拒收时的
 * `code` / `subcode`，`cause` 里挂的正是被拒的那个节点。
 */
export const probeQqPlaylistDetail = async (disstid: string): Promise<QqPlaylistDetailProbe> => {
    const id = String(disstid).trim();
    try {
        const response = await requestQq<any>('song_list_detail', { disstid: id });
        const body = response?.response;
        const cdlist = Array.isArray(body?.cdlist) ? body.cdlist : [];
        const detail = cdlist[0];
        const songlist = Array.isArray(detail?.songlist) ? detail.songlist : undefined;
        const total = Number(detail?.total_song_num ?? detail?.songnum);
        return {
            disstid: id,
            ok: Boolean(detail && typeof detail === 'object'),
            code: Number(body?.code),
            subcode: Number(body?.subcode),
            ...(typeof body?.message === 'string' && body.message ? { message: body.message } : {}),
            cdlistLength: cdlist.length,
            ...(songlist === undefined ? {} : { songlistLength: songlist.length }),
            ...(Number.isFinite(total) ? { totalSongNum: total } : {}),
            ...(typeof detail?.dissname === 'string' ? { dissName: detail.dissname } : {}),
            ...(Number.isFinite(Number(detail?.dir_show)) ? { dirShow: Number(detail.dir_show) } : {}),
            ...(detail?.disstid === undefined ? {} : { echoedDisstid: String(detail.disstid) }),
            ...songSample(songlist?.[0]),
        };
    } catch (error) {
        const node = error instanceof OnlineProviderError ? error.cause as any : undefined;
        return {
            disstid: id,
            ok: false,
            ...(Number.isFinite(Number(node?.code)) ? { code: Number(node.code) } : {}),
            ...(Number.isFinite(Number(node?.subcode)) ? { subcode: Number(node.subcode) } : {}),
            ...(typeof node?.message === 'string' && node.message ? { message: node.message } : {}),
            error: error instanceof Error ? error.message : String(error),
        };
    }
};


/**
 * 走 `qqProvider.catalog.getPlaylistTracks`，也就是应用点开歌单时真正跑的那条路径。
 *
 * transport 能拿到 songlist 但界面是空的时候，答案只可能在这一段：要么 provider 自己返回了
 * 空页，要么它返回了条目而问题在更上层。探针把两者分开。
 */
export const probeQqPlaylistTracks = async (
    entry: QqPlaylistProbeEntry,
    limit = 150,
): Promise<QqPlaylistTracksProbe> => {
    const requestedId = entry.normalizedId;
    try {
        const page = await qqProvider.catalog!.getPlaylistTracks!(
            entry.collection.id,
            limit,
            0,
            entry.collection,
        );
        const first = page.items[0];
        return {
            requestedId,
            itemCount: page.items.length,
            ...(page.total === undefined ? {} : { total: page.total }),
            hasMore: page.hasMore,
            nextOffset: page.nextOffset,
            ...(first === undefined ? {} : {
                firstItem: {
                    id: first.id,
                    name: first.name,
                    qqMid: first.qqMid,
                    durationMs: first.durationMs,
                    artists: first.artists.map(artist => artist.name),
                    albumName: first.album?.name,
                    mediaId: first.sourceRef?.kind === 'online' ? first.sourceRef.mediaId : undefined,
                },
            }),
        };
    } catch (error) {
        return { requestedId, error: error instanceof Error ? error.message : String(error) };
    }
};
