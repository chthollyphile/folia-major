import type { SongResult } from '../../types';
import { getSongResourceCacheKey } from '../onlineMusic/resourceKeys';

// src/services/playbackRecovery/mediaCacheGuard.ts
// 媒体缓存的写入守卫与会话内“不信任”标记：错误页、JSON 报错和截断的下载不能当成音频存进缓存；
// 缓存 blob 解码失败后，本会话内绕过它并允许重写。

export const MIN_CACHEABLE_AUDIO_BYTES = 16 * 1024;

// 用黑名单而不用白名单：部分 CDN 的 Content-Type 不规范（例如 binary/octet-stream）。
const NON_AUDIO_CONTENT_TYPE = /^(text\/|application\/(json|xml|xhtml))|html/i;

/** 下载结果是否像一段可以缓存的音频：HTTP 成功、不是文本 / JSON / HTML、且不小于 16 KiB。 */
export const isCacheableAudioResponse = (
    response: { ok: boolean; headers?: { get(name: string): string | null } },
    blob: { size: number; type?: string },
): boolean => {
    if (!response.ok) return false;
    const contentType = response.headers?.get('content-type') || blob.type || '';
    if (NON_AUDIO_CONTENT_TYPE.test(contentType)) return false;
    return blob.size >= MIN_CACHEABLE_AUDIO_BYTES;
};

const distrustedAudioKeys = new Set<string>();

/** 标记这首歌的缓存音频不可信（会话内有效）：之后的加载绕过缓存，缓存写入允许覆盖。 */
export const distrustCachedSongAudio = (song: SongResult): void => {
    distrustedAudioKeys.add(getSongResourceCacheKey('audio', song));
};

export const isCachedSongAudioDistrusted = (song: SongResult): boolean => (
    distrustedAudioKeys.has(getSongResourceCacheKey('audio', song))
);

/** 缓存被合格的新下载重写后清除标记。 */
export const clearCachedSongAudioDistrust = (song: SongResult): void => {
    distrustedAudioKeys.delete(getSongResourceCacheKey('audio', song));
};
