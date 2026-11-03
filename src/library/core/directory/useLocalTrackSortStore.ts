import { create } from 'zustand';
import type { LocalSongFolderSortDirection, LocalSongFolderSortField } from '../../../utils/localSongSorting';

// src/library/core/directory/useLocalTrackSortStore.ts
// 本地文件夹 / 全部歌曲的排序选择。原先是 GridView 的组件状态；换 renderer 也必须是同一个顺序，
// 所以提到 store。两个 localStorage 键与取值校验原样保留，已有的选择不会丢。

const LOCAL_TRACK_SORT_FIELD_STORAGE_KEY = 'local_track_sort_field';
const LOCAL_TRACK_SORT_DIRECTION_STORAGE_KEY = 'local_track_sort_direction';

const readField = (): LocalSongFolderSortField => {
    if (typeof window === 'undefined') return 'fileName';
    const stored = localStorage.getItem(LOCAL_TRACK_SORT_FIELD_STORAGE_KEY);
    return stored === 'fileLastModified' || stored === 'albumTrack' ? stored : 'fileName';
};

const readDirection = (): LocalSongFolderSortDirection => {
    if (typeof window === 'undefined') return 'asc';
    return localStorage.getItem(LOCAL_TRACK_SORT_DIRECTION_STORAGE_KEY) === 'desc' ? 'desc' : 'asc';
};

type LocalTrackSortState = {
    field: LocalSongFolderSortField;
    direction: LocalSongFolderSortDirection;
    setField: (field: LocalSongFolderSortField) => void;
    setDirection: (direction: LocalSongFolderSortDirection) => void;
};

export const useLocalTrackSortStore = create<LocalTrackSortState>(set => ({
    field: readField(),
    direction: readDirection(),
    setField: (field) => {
        localStorage.setItem(LOCAL_TRACK_SORT_FIELD_STORAGE_KEY, field);
        set({ field });
    },
    setDirection: (direction) => {
        localStorage.setItem(LOCAL_TRACK_SORT_DIRECTION_STORAGE_KEY, direction);
        set({ direction });
    },
}));
