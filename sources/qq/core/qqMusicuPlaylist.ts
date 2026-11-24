import type { FoliumSourcePage, FoliumSourceSong } from '@folia/folium';
import { qqError } from './qqEnv';
import { normalizeQqSong } from './qqNormalize';
import { requestQqMusicu } from './qqTransport';

// 旧歌单详情接口对部分公开歌单回 4000 时，用 QQ 的 musicu 读取当前页。

interface PlaylistData {
    code?: number;
    subcode?: number;
    dirinfo?: { id?: number | string };
    songlist?: unknown[];
    total_song_num?: number;
    hasmore?: number;
}

/** musicu 需要 JSON 数字形式的歌单 id；给字符串会回 10006。song_begin 是整张歌单中的偏移。 */
export const readQqMusicuPlaylistPage = async (id: number, limit: number, offset: number): Promise<FoliumSourcePage<FoliumSourceSong>> => {
    const { playlist } = await requestQqMusicu({
        playlist: {
            module: 'music.srfDissInfo.aiDissInfo',
            method: 'uniform_get_Dissinfo',
            param: {
                disstid: id,
                song_begin: offset,
                song_num: Math.min(1000, Math.max(1, limit)),
                userinfo: 1,
                tag: 1,
                orderlist: 1,
                onlysonglist: 0,
                enc_host_uin: '',
            },
        },
    });
    const data = playlist.data as PlaylistData | undefined;
    if (playlist.code !== 0 || data?.code !== 0 || data.subcode !== 0
        || String(data.dirinfo?.id) !== String(id) || !Array.isArray(data.songlist)) {
        throw qqError('invalid-response', `QQ musicu could not read playlist ${id}`, {
            code: playlist.code, dataCode: data?.code, subcode: data?.subcode,
        });
    }
    const items = data.songlist.map(normalizeQqSong);
    const nextOffset = offset + items.length;
    const count = data.total_song_num;
    const total = typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
    return {
        items,
        nextOffset,
        ...(total === undefined ? {} : { total }),
        hasMore: items.length > 0 && data.hasmore === 1 && (total === undefined || nextOffset < total),
    };
};
