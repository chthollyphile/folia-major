import type { FoliumSourceForeignSong, FoliumSourceSong } from '@folia/folium';

// sources/lxmusic/client/lxCounterparts.ts
// 「对应歌曲」（songs@1.counterpartSources / getCounterparts）：别家音源的一首歌，在洛雪这边是哪一首。
// 洛雪的歌 id 是 `<平台键>:<平台自己的 id>`，所以三家可以只凭 id 换算，不联网、不搜索：
//   网易云（netease）→ `wy:<数字 id>`；QQ 音乐（qq）→ `tx:<songmid>`；酷狗（kugou）→ `kg:<小写的 hash>`。
// 只做这种精确的换算：id 的样子不对（QQ 的歌没有 songmid、酷狗的不是 hash）就答没有，不按歌名歌手去找。
// 只答当前脚本支持的平台：脚本取不了某家的地址，把歌换过去也播不了。
// 答出来的歌带上传进来的歌名、歌手、专辑名、封面、时长（界面要显示），不为此发请求。专辑、歌手都开不了页面。

/** 别家音源的 id → 洛雪的平台键。酷我没有对应的内置音源。 */
export const LX_PLATFORM_OF_SOURCE: Readonly<Record<string, string>> = Object.freeze({
    netease: 'wy',
    qq: 'tx',
    kugou: 'kg',
});

/** 当前脚本支持的平台里，能替哪些别家音源答。 */
export const counterpartSourcesOf = (platforms: readonly string[]): string[] => (
    Object.keys(LX_PLATFORM_OF_SOURCE).filter(sourceId => platforms.includes(LX_PLATFORM_OF_SOURCE[sourceId]))
);

const NETEASE_ID = /^[1-9]\d{0,19}$/;
const QQ_SONGMID = /^[0-9A-Za-z]{8,32}$/;
const QQ_NUMERIC_ID = /^[1-9]\d{0,19}$/;
const KUGOU_HASH = /^[0-9a-fA-F]{32}$/;

const clip = (value: unknown, max = 512): string => (typeof value === 'string' ? value.slice(0, max) : '');

/** 那首歌在它平台上、洛雪脚本认的 id；认不出来回 null。 */
const nativeIdOf = (platform: string, song: FoliumSourceForeignSong): string | null => {
    const id = typeof song.id === 'string' ? song.id : '';
    if (platform === 'wy') return NETEASE_ID.test(id) ? id : null;
    if (platform === 'kg') return KUGOU_HASH.test(id) ? id.toLowerCase() : null;
    if (platform === 'tx') {
        // QQ 的歌 id 是 songmid；上游没给 songmid 时那边拿数字 id 顶上，这种换不了（脚本认的是 songmid）。
        if (!QQ_SONGMID.test(id)) return null;
        const hasNumericPublicId = typeof song.publicId === 'string' && QQ_NUMERIC_ID.test(song.publicId);
        return hasNumericPublicId || /[A-Za-z]/.test(id) ? id : null;
    }
    return null;
};

/** 一首别家的歌在洛雪这边的那首；没有精确对应回 null。`platforms` 是当前脚本支持的平台键。 */
export const counterpartOf = (song: FoliumSourceForeignSong | null | undefined, platforms: readonly string[]): FoliumSourceSong | null => {
    if (!song || typeof song !== 'object' || typeof song.sourceId !== 'string') return null;
    if (!Object.hasOwn(LX_PLATFORM_OF_SOURCE, song.sourceId)) return null;
    const platform = LX_PLATFORM_OF_SOURCE[song.sourceId];
    if (!platforms.includes(platform)) return null;
    const nativeId = nativeIdOf(platform, song);
    const title = clip(song.title);
    if (!nativeId || !title) return null;

    const artists = (Array.isArray(song.artists) ? song.artists : []).map(name => clip(name)).filter(Boolean).slice(0, 32);
    const albumName = clip(song.album);
    const coverUrl = /^https?:\/\//i.test(clip(song.coverUrl, 2048)) ? clip(song.coverUrl, 2048) : '';
    const durationMs = typeof song.durationMs === 'number' && Number.isFinite(song.durationMs) && song.durationMs > 0 ? Math.round(song.durationMs) : 0;
    const numericId = platform === 'tx' && typeof song.publicId === 'string' && QQ_NUMERIC_ID.test(song.publicId) ? song.publicId : '';
    return {
        id: `${platform}:${nativeId}`,
        title,
        artists: artists.map(name => ({ id: '', name, ref: false })),
        ...(albumName || coverUrl ? { album: { id: '', name: albumName, ref: false, ...(coverUrl ? { coverUrl } : {}) } } : {}),
        ...(durationMs ? { durationMs } : {}),
        ...(coverUrl ? { coverUrl } : {}),
        // 和 main 入口自己读出来的歌同一个形状（catalog.ts 的 songOf）：QQ 的数字 id 有些脚本要用。
        data: { platform, ...(numericId ? { songId: numericId } : {}) },
    };
};

/** 一批；和传入的顺序一一对应。 */
export const counterpartsOf = (songs: readonly FoliumSourceForeignSong[], platforms: readonly string[]): (FoliumSourceSong | null)[] => (
    (Array.isArray(songs) ? songs as readonly FoliumSourceForeignSong[] : []).map(song => counterpartOf(song, platforms))
);
