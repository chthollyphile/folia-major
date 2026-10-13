// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/stores/useRecentPlaysStore.test.ts

const STORAGE_KEY = 'folia.recent-plays';

const onlineSong = (mediaId: string, name = 'song'): SongResult => ({
    id: mediaId,
    name,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 1000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId },
} as SongResult);

const localSong = (songId: string, name = 'local'): SongResult => ({
    id: songId,
    name,
    artists: [],
    album: { id: '', name: '' },
    durationMs: 1000,
    isLocal: true,
    localRef: { songId },
} as unknown as SongResult);

describe('useRecentPlaysStore', () => {
    let useRecentPlaysStore: typeof import('@/stores/useRecentPlaysStore').useRecentPlaysStore;

    beforeEach(async () => {
        localStorage.clear();
        vi.resetModules();
        ({ useRecentPlaysStore } = await import('@/stores/useRecentPlaysStore'));
        useRecentPlaysStore.setState({ entries: [] });
    });

    it('records a played song to the front and persists it', () => {
        useRecentPlaysStore.getState().record(onlineSong('111', 'A'));
        const state = useRecentPlaysStore.getState();
        expect(state.entries).toHaveLength(1);
        expect(state.entries[0].song.name).toBe('A');
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')).toHaveLength(1);
    });

    it('dedupes by playback key and moves the replayed song to the front', () => {
        const record = useRecentPlaysStore.getState().record;
        record(onlineSong('111', 'A'));
        record(onlineSong('222', 'B'));
        record(onlineSong('111', 'A again'));
        const entries = useRecentPlaysStore.getState().entries;
        expect(entries.map(e => e.song.sourceRef?.mediaId)).toEqual(['111', '222']);
        expect(entries[0].song.name).toBe('A again');
    });

    it('keeps local and online songs with the same id as separate entries', () => {
        const record = useRecentPlaysStore.getState().record;
        record(onlineSong('111', 'online'));
        record(localSong('111', 'local'));
        expect(useRecentPlaysStore.getState().entries).toHaveLength(2);
    });

    it('caps history at 200 entries', () => {
        const record = useRecentPlaysStore.getState().record;
        for (let i = 0; i < 250; i++) record(onlineSong(String(i)));
        expect(useRecentPlaysStore.getState().entries).toHaveLength(200);
    });

    it('ignores a corrupted or hand-edited payload on load', () => {
        localStorage.setItem(STORAGE_KEY, '{not json');
        vi.resetModules();
        // 重新 import 会跑一次 loadEntries；不抛异常即为通过。
        return import('@/stores/useRecentPlaysStore').then(({ useRecentPlaysStore: store }) => {
            expect(store.getState().entries).toEqual([]);
        });
    });

    it('clear empties both state and storage', () => {
        useRecentPlaysStore.getState().record(onlineSong('111'));
        useRecentPlaysStore.getState().clear();
        expect(useRecentPlaysStore.getState().entries).toEqual([]);
        expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
    });
});
