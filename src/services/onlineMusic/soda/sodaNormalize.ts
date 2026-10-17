import type { UnifiedSong } from '../../../types';
import type { ProviderCollection, ProviderLyricsResult, ProviderPage } from '../../../types/onlineMusic';
import { parseLyricsByFormat } from '../../../utils/lyrics/parserCore';

// src/services/onlineMusic/soda/sodaNormalize.ts
//
// 汽水的原始字段 → 应用的形状。汽水这边一首歌叫 track、一个歌单叫 playlist，封面统一是
// `url_cover: { uri, urls: [域名前缀] }`，要拼成 `前缀 + uri + ~c5_500x500.jpg`。

const pad2 = (n: number) => `${n}`.padStart(2, '0');

const clampMs = (ms: number) => Math.min(Math.max(Math.round(ms), 0), 99 * 60 * 1000 + 59999);

/** 行首 `[mm:ss.xx]`。 */
const lineTag = (ms: number) => {
    const t = clampMs(ms);
    return `[${pad2(Math.floor(t / 60000))}:${pad2(Math.floor((t % 60000) / 1000))}.${pad2(Math.floor((t % 1000) / 10))}]`;
};

/** 逐字 `<mm:ss.xxx>`，增强型 LRC 用的那种。 */
const wordTag = (ms: number) => {
    const t = clampMs(ms);
    return `<${pad2(Math.floor(t / 60000))}:${pad2(Math.floor((t % 60000) / 1000))}.${`${t % 1000}`.padStart(3, '0')}>`;
};

interface SodaCover {
    uri?: string;
    urls?: string[];
    template_prefix?: string;
}

/**
 * 封面 = 域名前缀 + uri + 尺寸模板。模板必须用 `template_prefix` 拼出来的裁剪模板：
 * `tos-cn-i-*` 桶（大量歌单封面在这个桶里）不认 `~c5_500x500.jpg`，只答 403；
 * `~tplv-<prefix>-crop-center:500:500.jpg` 对三种桶（tos-cn-i / tos-cn-v / ies-music）都答 200。
 * 没有 template_prefix 时退回旧模板。
 */
export const sodaCoverUrl = (cover?: SodaCover | null): string | undefined => {
    if (!cover?.uri || !Array.isArray(cover.urls) || !cover.urls[0]) return undefined;
    const template = cover.template_prefix ? `${cover.template_prefix}-crop-center:500:500.jpg` : 'c5_500x500.jpg';
    return `${cover.urls[0]}${cover.uri}~${template}`;
};

/** 搜索答复里的一条（`entity.track`）→ UnifiedSong。 */
export const normalizeSodaSong = (track: any): UnifiedSong => {
    const id = String(track?.id ?? '');
    const albumId = track?.album?.id ? String(track.album.id) : `${id}#album`;
    return {
        id,
        name: String(track?.name ?? ''),
        artists: (Array.isArray(track?.artists) ? track.artists : []).map((artist: any, index: number) => ({
            id: artist?.id ? String(artist.id) : `${id}#artist${index}`,
            name: String(artist?.name ?? ''),
        })).filter((artist: { name: string }) => artist.name),
        album: {
            id: albumId,
            name: String(track?.album?.name ?? ''),
            ...(sodaCoverUrl(track?.album?.url_cover) ? { coverUrl: sodaCoverUrl(track?.album?.url_cover)! } : {}),
        },
        durationMs: Number(track?.duration) > 0 ? Number(track.duration) : 0,
        sourceRef: { kind: 'online', providerId: 'soda', mediaId: id },
    } as UnifiedSong;
};

/** 一个歌单（`playlist`）→ ProviderCollection。 */
export const normalizeSodaCollection = (playlist: any): ProviderCollection => ({
    providerId: 'soda',
    id: String(playlist?.id ?? ''),
    type: 'playlist',
    name: String(playlist?.title ?? ''),
    ...(sodaCoverUrl(playlist?.url_cover) ? { coverUrl: sodaCoverUrl(playlist?.url_cover)! } : {}),
    ...(playlist?.desc ? { description: String(playlist.desc) } : {}),
    ...(Number(playlist?.count_tracks) > 0 ? { trackCount: Number(playlist.count_tracks) } : {}),
});

/** 汽水的 offset 分页：`nextCursor` 实际是歌单的总数，不是下一页的位置。 */
export const sodaPage = (
    items: UnifiedSong[],
    total: number | null,
    offset: number,
): ProviderPage<UnifiedSong> => {
    const boundary = total && total > offset ? total : offset + items.length;
    return {
        items,
        ...(total ? { total } : {}),
        hasMore: offset + items.length < boundary,
        nextOffset: offset + items.length,
    };
};

/**
 * 分享页的一条 → 逐行歌词 + 逐字歌词。`lyrics.sentences[]` 每条是
 * `{ startMs, endMs, text, words: [{ text, startMs, endMs }] }`。
 */
export function sodaLyricsOf(track: any): ProviderLyricsResult {
    const sentences = Array.isArray(track?.lyrics?.sentences) ? track.lyrics.sentences : [];
    const main: string[] = [];
    const wordLines: string[] = [];
    let wordTimed = false;

    for (const sentence of sentences) {
        const text = String(sentence?.text ?? '').trim();
        if (!text) continue;
        const startMs = Number(sentence.startMs) || 0;
        main.push(`${lineTag(startMs)}${text}`);

        const words = (Array.isArray(sentence.words) ? sentence.words : [])
            .map((word: any) => ({ text: String(word?.text ?? ''), startMs: Number(word?.startMs) || 0 }))
            .filter((word: { text: string }) => word.text);
        if (words.length < 2) {
            wordLines.push(`${lineTag(startMs)}${text}`);
            continue;
        }
        wordTimed = true;
        const body = words.map((word: { text: string; startMs: number }) => `${wordTag(word.startMs)}${word.text}`).join('');
        wordLines.push(`${lineTag(startMs)}${body}${wordTag(Math.max(Number(sentence.endMs) || startMs, startMs))}`);
    }

    if (main.length === 0) return { lyrics: null, isPureMusic: false };

    // 只有真的逐字时轴才解析逐字轨，否则解析器会把均分出来的假时轴当成逐字显示。
    const lyrics = wordTimed
        ? parseLyricsByFormat('enhanced-lrc', `${wordLines.join('\n')}\n`)
        : parseLyricsByFormat('lrc', `${main.join('\n')}\n`);

    return {
        lyrics,
        mainText: `${main.join('\n')}\n`,
        ...(wordTimed ? { wordByWordText: `${wordLines.join('\n')}\n` } : {}),
        isPureMusic: false,
    };
}

/** 分享页给的播放地址能播多久：窗口比整首短就是试听片段。 */
export function sodaPreview(track: any): boolean {
    const start = Number(track?.previewStart) || 0;
    const end = Number(track?.previewEnd) || 0;
    const duration = Number(track?.duration) || 0;
    return duration > 0 && (start > 0.5 || end + 0.5 < duration);
}

export const sodaTrackList = (rows: unknown[]): UnifiedSong[] => (
    rows.map((row: any) => row?.entity?.track ?? row?.entity?.track_wrapper?.track).filter(Boolean).map(normalizeSodaSong)
);
