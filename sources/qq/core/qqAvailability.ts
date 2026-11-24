import type { FoliumSourceSong, FoliumSourceSongAvailability } from '@folia/folium';
import { isQqError } from './qqEnv';
import { normalizeQqSong, qqSongMidOf } from './qqNormalize';
import { hasUsableQqSession, requestQq } from './qqTransport';

// sources/qq/core/qqAvailability.ts
// QQ 歌曲的静态可用性（songs@1.getAvailability）与下架歌的替代版本（songs@1.getReplacement）。会员、地区这些限制
// 照旧在播放时才知道，这里一律 unknown；一次播放失败也不回写到这里。

const fieldOf = (value: unknown, key: string): unknown => (
    value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
);

/**
 * songs@1.getAvailability。下架只认 QQ 歌曲条目的 `action.switch` bit 27（`0x8000000`，qqNormalize 记成 data.takenDown）：
 * 官方各端都放不了（下架，多数只剩 MV）的歌才有，可播的歌都没有。每次交回同样的对象：宿主画行时就问（热路径），每个对象只转一次形状。
 */
function qqSongAvailabilityOf(): (song: FoliumSourceSong) => FoliumSourceSongAvailability {
    const takenDown = Object.freeze({ state: 'unavailable', reason: 'taken-down' } as const);
    const unknown = Object.freeze({ state: 'unknown' } as const);
    return song => (song.data?.takenDown === true ? takenDown : unknown);
}

export const qqSongAvailability = qqSongAvailabilityOf();

const MID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/**
 * 下架的歌找一个能放的其他版本（后端 `/song/replacement`，3.3.6 起有，要会话；3.3.9 起下架的歌也会找）。后端以真拿到
 * 链接为准，回包不带链接，播放照常走 getAudioSource。没会话、旧后端（404）、没有能放的版本都回 null；其他失败照抛，
 * 宿主据此说「查不到替代」，而不是「没有替代」。
 */
export const getQqSongReplacement = async (
    song: FoliumSourceSong,
): Promise<{ song: FoliumSourceSong; label?: string } | null> => {
    const mid = qqSongMidOf(song);
    if (!MID_PATTERN.test(mid) || !hasUsableQqSession()) return null;
    let response: unknown;
    try {
        response = await requestQq('song_replacement', { mid });
    } catch (error) {
        if (isQqError(error, 'unsupported')) return null;
        throw error;
    }
    const replacement = fieldOf(response, 'song');
    if (!replacement || typeof replacement !== 'object') {
        const reason = fieldOf(response, 'reason');
        console.info('[QQProvider] replacement:none', { reason: typeof reason === 'string' ? reason : undefined });
        return null;
    }
    const found = normalizeQqSong(replacement);
    // 后端跳过了原曲；回来的还是同一首就当没有。
    if (!qqSongMidOf(found) || qqSongMidOf(found) === mid) return null;
    const rawLabel = fieldOf(response, 'label');
    const label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel.trim() : undefined;
    console.info('[QQProvider] replacement:found', { labeled: Boolean(label) });
    return { song: found, ...(label ? { label } : {}) };
};
