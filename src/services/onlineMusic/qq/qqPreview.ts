import { toSafePlaybackUrl } from '../../../utils/appPlaybackHelpers';
import { requestQq } from './qqTransport';

// src/services/onlineMusic/qq/qqPreview.ts
// QQ 音乐的试听片段：完整的歌拿不到链接时（有档连不上的话，要标准音质也回了空链接），qqProvider.getAudioSource 来这里多要一次试听文件。

/**
 * 所有音质都没给链接时，多要一次试听文件（`preview=1`，qq-music-api 3.3.0 起有）。拿到就交出试听片段，
 * 共用的播放器照播、给提示、不当成整首存下来；拿不到就当没要过。
 * 是不是试听看后端在这一条上标的 `preview: true`；没标的链接（不认 `preview=1` 的后端）是整首，照整首交出。
 */
export const requestQqPreviewSource = async (songmid: string, mediaId: string) => {
    try {
        const response = await requestQq<any>('music_play', { songmid, ...(mediaId ? { mediaId } : {}), preview: 1 });
        const playUrl = response?.data?.playUrl;
        const playUrlMap = playUrl && typeof playUrl === 'object' ? playUrl : {};
        const entry = (playUrlMap[songmid] ?? Object.values(playUrlMap)[0]) as any;
        const url = toSafePlaybackUrl(String(entry?.url || ''));
        const preview = entry?.preview === true;
        console.info('[QQProvider] playback:preview', { gotUrl: Boolean(url), preview });
        return url ? { url, fetchedAt: Date.now(), quality: 'standard' as const, ...(preview ? { preview: true } : {}) } : null;
    } catch (error) {
        console.warn('[QQProvider] playback:preview-failed', error);
        return null;
    }
};
