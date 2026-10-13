import { create } from 'zustand';
import type { SongResult } from '../types';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

// src/stores/useRecentPlaysStore.ts
//
// 统一「最近播放」历史：跨音源（本地 / 在线 / Navidrome）记录用户真正播过的歌。
// 之前只有 Navidrome 有 recents 卡，本地与在线没有统一视图，播放历史也不入库。
//
// 为什么存整首 SongResult 而不是 id：最近播放要能直接重播，而在线歌的 id 换 provider 就取不到；
// sourceRef 认 mediaId，播放链路只认它，序列化往返不丢关键字段。
//
// 去重按 getPlaybackSongKey（跨源稳定身份，队列用的同一套）：同一首重复播只保留最新一条并提到最前。

export type RecentPlay = { song: SongResult; playedAt: number };

const STORAGE_KEY = 'folia.recent-plays';
const RECENT_PLAYS_LIMIT = 200;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// 读回来要逐条校验：手改过的 localStorage 或旧版本结构不能把整个列表带崩。
const loadEntries = (): RecentPlay[] => {
    if (typeof localStorage === 'undefined') return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((item): item is RecentPlay => isRecord(item) && isRecord(item.song))
            .map(item => ({ song: item.song as SongResult, playedAt: Number(item.playedAt) || 0 }))
            .filter(item => getPlaybackSongKey(item.song) !== '')
            .slice(0, RECENT_PLAYS_LIMIT);
    } catch {
        return [];
    }
};

const persistEntries = (entries: RecentPlay[]): void => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
        // 配额满或隐私模式：历史是加速不是正确性依赖，写失败静默。
    }
};

type RecentPlaysState = {
    entries: RecentPlay[];
    record: (song: SongResult) => void;
    clear: () => void;
};

export const useRecentPlaysStore = create<RecentPlaysState>((set, get) => ({
    entries: loadEntries(),
    record: (song) => {
        const key = getPlaybackSongKey(song);
        if (!key) return;
        const previous = get().entries;
        const next = [
            { song, playedAt: Date.now() },
            ...previous.filter(entry => getPlaybackSongKey(entry.song) !== key),
        ].slice(0, RECENT_PLAYS_LIMIT);
        persistEntries(next);
        set({ entries: next });
    },
    clear: () => {
        persistEntries([]);
        set({ entries: [] });
    },
}));
