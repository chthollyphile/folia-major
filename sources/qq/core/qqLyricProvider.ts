import type { FoliumSourceLyricsResult, FoliumSourceSong } from '@folia/folium';
import { qrcDecrypt } from './qrcDecrypt';
import { qqError } from './qqEnv';
import { normalizeQqSong, qqSongIdNumberOf, qqSongMidOf } from './qqNormalize';
import { sendQqMusicuPayload } from './qqTransport';

// sources/qq/core/qqLyricProvider.ts
// QQ 音乐的歌词与匿名搜歌：都发到 QQ 自己的 musicu（精简版客户端的那一套 comm），不经 qq-music-api 后端，不要账号。
// 桌面版由 main 入口发（`musicu`），网页版经歌词代理（qqTransport.ts 的 sendQqMusicuPayload）。
// 歌词交回原文（QRC 解密后），由宿主按格式解析、找副歌（迁之前这里自己调宿主的解析器和副歌标注）。

// 和迁之前一样没有时限的请求，给一个比 qq-music-api 慢的回答还长的上限：到点是 network 的错。
const QQ_LYRIC_REQUEST_LIMIT_MS = 30_000;

type Fields = Record<string, unknown>;
const fieldsOf = (value: unknown): Fields | undefined => (
    value && typeof value === 'object' && !Array.isArray(value) ? value as Fields : undefined
);
const hexOf = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Sends one request to musicu as the lite client. Before, the page also set a Cookie and a User-Agent header here; a
 * page cannot set either (fetch drops them), so neither was ever sent, and the main entry does not send them now.
 */
async function requestQQ(method: string, module: string, param: unknown): Promise<Fields | undefined> {
    const payload = {
        comm: {
            ct: 11,
            cv: '1003006',
            v: '1003006',
            os_ver: '15',
            phonetype: '24122RKC7C',
            rom: 'Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys',
            tmeAppID: 'qqmusiclight',
            nettype: 'NETWORK_WIFI',
            udid: '0',
            uid: '0',
        },
        request: {
            method,
            module,
            param,
        },
    };

    const response = await sendQqMusicuPayload(payload, QQ_LYRIC_REQUEST_LIMIT_MS);
    if (response.status < 200 || response.status > 299) {
        throw new Error(`QQ Music API request failed: ${response.status}`);
    }

    const data = fieldsOf(JSON.parse(response.text));
    const request = fieldsOf(data?.request);
    if (data?.code !== 0 || request?.code !== 0) {
        throw new Error(`QQ Music API error: code ${String(data?.code || request?.code)}`);
    }

    return fieldsOf(request.data);
}

/**
 * Encodes string to Base64 in UTF-8.
 */
function toBase64(str: string): string {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
}

/**
 * Detects if a lyric string is in QRC format.
 */
function detectIsQrc(content: string): boolean {
    return content.includes('(') && content.includes(')') && /\[\d+,\d+\]/.test(content);
}

// An LRC document (a line starting with a time tag) is read as LRC; anything else is left out: the host's sniffing of
// local files is not a source's to use (a source names its format).
const looksLikeLrc = (content: string): boolean => /^\s*\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/m.test(content);

/**
 * Searches songs on QQ Music anonymously and throws on upstream refusal (e.g. the frequent code 2001).
 */
export async function searchQQSongs(keyword: string, page = 1, pageSize = 20): Promise<FoliumSourceSong[]> {
    const safeKeyword = keyword.trim();
    if (!safeKeyword) return [];

    const param = {
        search_id: String(
            Math.floor(
                Math.random() * 100000000000000 + Date.now() % 86400000,
            ),
        ),
        remoteplace: 'search.android.keyboard',
        query: safeKeyword.length > 60 ? safeKeyword.slice(0, 60) : safeKeyword,
        // 7 = songs. 0 used to mean songs too, but QQ now answers 2001 with no items to every 0 search
        // while the same request with 7 is answered (checked 2026-10-17, #695): do not change it back.
        search_type: 7,
        num_per_page: pageSize,
        page_num: page,
        highlight: 0,
        nqc_flag: 0,
        page_id: 1,
        grp: 1,
    };

    const data = await requestQQ('DoSearchForQQMusicLite', 'music.search.SearchCgiService', param);
    const body = fieldsOf(data?.body);
    const songs: unknown[] = Array.isArray(body?.item_song) ? body.item_song : [];

    // The lite search's items are the upstream's own song entries (mid, id, title, singer, album, interval): the
    // normalizer reads them as it reads the backend's.
    return songs.map(normalizeQqSong);
}

/**
 * Fetches and decrypts a song's QQ Music lyrics: the raw QRC (word timing) or LRC, with the translation and the
 * romanization. Null where QQ has none, or the request failed (logged).
 */
export async function fetchQQLyrics(song: FoliumSourceSong): Promise<FoliumSourceLyricsResult | null> {
    const songId = qqSongIdNumberOf(song);
    if (!songId || !qqSongMidOf(song)) {
        throw qqError('invalid-response', 'Missing song ID or mid');
    }

    const artistsStr = song.artists.map(a => a.name).join(', ');

    const param = {
        albumName: toBase64(song.album?.name || ''),
        crypt: 1,
        ct: 19,
        cv: 2111,
        interval: Math.floor((song.durationMs ?? 0) / 1000),
        lrc_t: 0,
        qrc: 1,
        qrc_t: 0,
        roma: 1,
        roma_t: 0,
        singerName: toBase64(artistsStr),
        songID: songId,
        songName: toBase64(song.title),
        trans: 1,
        trans_t: 0,
        type: 0,
    };

    try {
        const data = await requestQQ('GetPlayLyricInfo', 'music.musichallSong.PlayLyricInfo', param);
        const encryptedLyricHex = hexOf(data?.lyric);
        const encryptedTransHex = hexOf(data?.trans);
        const encryptedRomanizationHex = hexOf(data?.roma);

        if (!encryptedLyricHex) {
            return null;
        }

        const decryptedLyric = await qrcDecrypt(encryptedLyricHex);
        const decryptedTrans = encryptedTransHex ? await qrcDecrypt(encryptedTransHex) : '';
        const decryptedRomanization = encryptedRomanizationHex ? await qrcDecrypt(encryptedRomanizationHex) : '';

        const isQrc = detectIsQrc(decryptedLyric);
        if (!isQrc && !looksLikeLrc(decryptedLyric)) return null;
        const track = {
            format: isQrc ? 'qrc' as const : 'lrc' as const,
            text: decryptedLyric,
            ...(decryptedTrans ? { translationText: decryptedTrans } : {}),
            ...(decryptedRomanization ? { romanizationText: decryptedRomanization } : {}),
        };
        return isQrc ? { wordByWord: track } : { main: track };
    } catch (error) {
        console.error('[QQMusic] Fetch lyrics failed:', error);
        return null;
    }
}
