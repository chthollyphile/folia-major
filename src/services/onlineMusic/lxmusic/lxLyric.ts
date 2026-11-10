// src/services/onlineMusic/lxmusic/lxLyric.ts
// 洛雪的歌词兜底：公开接口没交出来的平台，从各家的歌词接口直接要。
//
// 原来只有网易云（wy）和酷我（kw）两家有公开歌词，QQ 与酷狗的歌一进来就落空——而周杰伦这类
// 歌恰恰都在 QQ 上。所以这里补上 QQ 与酷狗的歌词，再留一层「按歌名+歌手去网易云搜同款」的兜底：
// 三成以上「没歌词」的歌其实是别家平台的同一首歌。
//
// 请求都走 lxmusicTransport 的同一个出口（桌面走 IPC，安卓走原生 OkHttp），不谈 host 白名单。

import { httpGetText, parseLooseJson } from './lxmusicTransport';

type Raw = Record<string, unknown>;

const REQUEST_TIMEOUT_MS = 12000;

const asRecord = (value: unknown): Raw | null => (value && typeof value === 'object' ? value as Raw : null);
const asArray = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter((item): item is Raw => Boolean(asRecord(item))) : []);
const toText = (value: unknown): string => (value == null ? '' : String(value)).trim();
const toNumber = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

/** 有的接口把 JSON 包成 `MusicJsonCallback({...})`，剥掉外壳再解析。 */
const unwrapCallback = (text: string): string => {
    const trimmed = text.trim().replace(/^\uFEFF/, '');
    const match = trimmed.match(/^[\w.$]+\(\s*([\s\S]*?)\s*\)\s*;?\s*$/);
    return match ? match[1] : trimmed;
};

/** QQ 与酷狗的歌词有时是 base64；当明文看不像 LRC 时再解一次。 */
const decodeMaybeBase64 = (text: string): string => {
    const trimmed = text.trim();
    if (!trimmed) return '';
    // LRC 一定有「[00:00.00]」这样的时间轴，有就直接用。
    if (/\[[0-9]{1,3}:[0-9]{2}/.test(trimmed)) return trimmed;
    if (!/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) return trimmed;
    try {
        const bytes = Uint8Array.from(atob(trimmed.replace(/\s+/g, '')), char => char.charCodeAt(0));
        const decoded = new TextDecoder('utf-8').decode(bytes);
        return /\[[0-9]{1,3}:[0-9]{2}/.test(decoded) ? decoded : trimmed;
    } catch {
        return trimmed;
    }
};

const LRC_TIME = (seconds: number): string => {
    const total = Math.max(0, seconds);
    const minutes = Math.floor(total / 60);
    const rest = total - minutes * 60;
    const whole = Math.floor(rest);
    const hundredths = Math.round((rest - whole) * 100);
    // 99.6 → 100 这种进位要还给秒。
    const carry = hundredths >= 100;
    return `[${String(minutes).padStart(2, '0')}:${String(carry ? whole + 1 : whole).padStart(2, '0')}.${String(carry ? 0 : hundredths).padStart(2, '0')}]`;
};

export type LxSideLyric = { main: string | null; translation: string | null };

/**
 * QQ 音乐歌词。`songmid` 就是洛雪 tx 歌的 id（`0039MnYb0qxYhV` 这种）。
 * 这个接口不要登录，但非要带 QQ 音乐的 Referer。
 */
export const lxLyricFromTx = async (songmid: string): Promise<LxSideLyric | null> => {
    const id = songmid.trim();
    if (!id) return null;
    const url = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(id)}&format=json&nobase64=1&g_tk=5381&loginUin=0&hostUin=0&platform=yqq&needNewCode=0`;
    const response = await httpGetText(url, REQUEST_TIMEOUT_MS, { Referer: 'https://y.qq.com/' });
    if (!response.ok) return null;
    const payload = asRecord(parseLooseJson(unwrapCallback(await response.text())));
    if (!payload) return null;
    const main = decodeMaybeBase64(toText(payload.lyric));
    if (!main) return null;
    const translation = decodeMaybeBase64(toText(payload.trans));
    return { main, translation: translation || null };
};

/**
 * 酷狗歌词。洛雪的 kg 歌 id 是 hash，酷狗歌词服务两跳：先按 hash 找候选拿 accesskey，再下载。
 */
export const lxLyricFromKg = async (hash: string, name?: string): Promise<LxSideLyric | null> => {
    const khash = hash.trim();
    if (!khash) return null;
    const searchUrl = `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=${encodeURIComponent(name ?? '')}&hash=${encodeURIComponent(khash)}&timelength=0&lrclib=1`;
    const searchResponse = await httpGetText(searchUrl, REQUEST_TIMEOUT_MS, {});
    if (!searchResponse.ok) return null;
    const candidate = asArray(asRecord(parseLooseJson(await searchResponse.text()))?.candidates)[0];
    if (!candidate) return null;
    const lyricId = toText(candidate.id);
    const accessKey = toText(candidate.accesskey);
    if (!lyricId || !accessKey) return null;

    const downloadUrl = `https://lyrics.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(lyricId)}&accesskey=${encodeURIComponent(accessKey)}&fmt=lrc&charset=utf8`;
    const downloadResponse = await httpGetText(downloadUrl, REQUEST_TIMEOUT_MS, {});
    if (!downloadResponse.ok) return null;
    const payload = asRecord(parseLooseJson(await downloadResponse.text()));
    const main = decodeMaybeBase64(toText(payload?.content));
    if (!main) return null;
    const translated = decodeMaybeBase64(toText(payload?.trans));
    return { main, translation: translated && translated !== main ? translated : null };
};

/**
 * 最后一层：按「歌名 + 歌手」在网易云搜同款，拿那一首的歌词。
 * 不同版本的时间轴可能差一两句，所以只在播放器还没有歌词时才用（用户能自己再换）。
 */
export const lxLyricBySearch = async (name: string, artist?: string): Promise<LxSideLyric | null> => {
    const keyword = [name.trim(), (artist ?? '').trim()].filter(Boolean).join(' ');
    if (!keyword) return null;
    const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&limit=5&offset=0`;
    const searchResponse = await httpGetText(searchUrl, REQUEST_TIMEOUT_MS, { Referer: 'https://music.163.com/' });
    if (!searchResponse.ok) return null;
    const songs = asArray(asRecord(asRecord(parseLooseJson(await searchResponse.text()))?.result)?.songs);
    if (songs.length === 0) return null;
    // 歌名完全对上的排前面，其余按接口的相关度跟在后面。
    //
    // 这里必须逐个试，不能只认第一条：同名条目里有一大半是翻唱 / 伴奏 / 纯音乐，它们的
    // 歌词接口照样回 200，但 lrc 是空的——只试一条就会在「明明有词」的歌上判成没词。
    //
    // 排序：歌名对上加两分，歌手对上加一分。不要求两边都对上——同一首歌在公开库里常被上传
    // 成「晴天 (原唱 周杰伦)」这种名字，严格匹配反而匹配不到。
    const bare = name.replace(/\s+/g, '');
    const artistBare = (artist ?? '').replace(/\s+/g, '');
    const scoreOf = (song: Raw): number => {
        const nameHit = toText(song.name).replace(/\s+/g, '') === bare;
        const artists = asArray(song.artists).map(item => toText(item.name)).join('/').replace(/\s+/g, '');
        const artistHit = Boolean(artistBare) && artists.includes(artistBare);
        return (nameHit ? 2 : 0) + (artistHit ? 1 : 0);
    };
    const ordered = [...songs].sort((left, right) => scoreOf(right) - scoreOf(left));

    for (const song of ordered) {
        const songId = toText(song.id);
        if (!songId) continue;

        const lyricUrl = `https://music.163.com/api/song/lyric?id=${encodeURIComponent(songId)}&lv=1&kv=1&tv=-1`;
        const lyricResponse = await httpGetText(lyricUrl, REQUEST_TIMEOUT_MS, { Referer: 'https://music.163.com/' });
        if (!lyricResponse.ok) continue;
        const payload = asRecord(parseLooseJson(await lyricResponse.text()));
        const main = toText(asRecord(payload?.lrc)?.lyric);
        if (!main) continue;
        const translation = toText(asRecord(payload?.tlyric)?.lyric);
        return { main, translation: translation || null };
    }

    return null;
};

/** 酷我那条接口是已有实现，这里只把「lrclist」拼 LRC 的活留着给调用方（见 lxApiLyric）。 */
export const lxLrcFromKuwoLines = (lines: Raw[]): string => lines
    .map(line => `${LRC_TIME(toNumber(line.time))}${toText(line.lineLyric)}`)
    .join('\n');
