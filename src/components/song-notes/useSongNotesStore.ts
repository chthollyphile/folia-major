import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { SongResult } from '../../types';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { listenSongNotesBroadcast } from './songNotesBroadcast';
import {
    countSongNotes,
    emitSongNotesChange,
    getSongNote,
    listAllSongNotes,
    listRecentSongNotes,
    listSongNoteTags,
    subscribeSongNotes,
    type SongNoteDetail,
} from './songNotesService';
import type { SongNoteRow, SongNoteSort, SongNoteTag } from './songNotesModel';

// src/components/song-notes/useSongNotesStore.ts
// 评论在界面上的状态：数据在库里（songNotesService），这里只放
// - version：库里的东西变了就加一（本窗口写了、别的窗口写了），读数据的 hook 据此重读；
// - viewing：速记簿「评论」页在看哪一首（null 是正在播放的那首；从别处点进来的是那一首，顶上出「回到正在播放」）；
// - drafts：每首歌没发出去的草稿（换歌时草稿留在原来那首上，不存盘）；
// - sort：评论按写的时间还是按时间轴排（这次运行里记着）；
// - composeNonce / composeRequestedAt：命令「写评论」要输入框接焦点（输入框可能还没挂上，挂上时看要求还新不新鲜；
//   没有歌可写时输入框不出现，过了 COMPOSE_TTL_MS 的要求作废，不会很久以后突然抢焦点）；
// - tagFocus：展开整页要滚到哪个标签组（命令 #标签、首页的标签卡）；nonce 每次加一，同一个标签再点一次也重新滚过去。

type SongNotesState = {
    version: number;
    viewing: { key: string; song: SongResult } | null;
    drafts: Record<string, string>;
    sort: SongNoteSort;
    composeNonce: number;
    composeRequestedAt: number;
    tagFocus: { key: string; nonce: number } | null;
    bump: () => void;
    /** 看这一首（null：回到正在播放）。 */
    view: (song: SongResult | null) => void;
    setDraft: (key: string, text: string) => void;
    setSort: (sort: SongNoteSort) => void;
    requestCompose: () => void;
    /** 输入框接了焦点：这一次要求办完了。返回有没有待办的要求。 */
    takeCompose: () => boolean;
    /** 展开整页滚到这个标签组。 */
    focusTag: (key: string) => void;
    /** 整页接过了要求：清掉，以后再展开不再滚过去。 */
    clearTagFocus: () => void;
};

/** tagFocus 的 nonce 一直往上加（要求被清掉之后再来一次也是新的号，整页的画布据此重挂）。 */
let tagFocusNonce = 0;

/** 「写评论」要输入框接焦点的要求多久内有效：抽屉滑出来、输入框挂上用不了这么久。 */
const COMPOSE_TTL_MS = 2000;

export const useSongNotesStore = create<SongNotesState>((set, get) => ({
    version: 0,
    viewing: null,
    drafts: {},
    sort: 'written',
    composeNonce: 0,
    composeRequestedAt: 0,
    tagFocus: null,
    bump: () => set(state => ({ version: state.version + 1 })),
    view: song => set({ viewing: song ? { key: getPlaybackSongKey(song), song } : null }),
    setDraft: (key, text) => set(state => {
        if ((state.drafts[key] ?? '') === text) return state;
        const { [key]: _old, ...rest } = state.drafts;
        return { drafts: text ? { ...rest, [key]: text } : rest };
    }),
    setSort: sort => set({ sort }),
    requestCompose: () => set(state => ({ composeNonce: state.composeNonce + 1, composeRequestedAt: Date.now() })),
    takeCompose: () => {
        const requestedAt = get().composeRequestedAt;
        if (requestedAt === 0) return false;
        set({ composeRequestedAt: 0 });
        return Date.now() - requestedAt < COMPOSE_TTL_MS;
    },
    focusTag: key => set(() => {
        tagFocusNonce += 1;
        return { tagFocus: { key, nonce: tagFocusNonce } };
    }),
    clearTagFocus: () => set({ tagFocus: null }),
}));

// 本窗口写了、别的窗口写了，都让读数据的 hook 重读一遍（数据量小：一首歌的评论、最近的几十首）。
subscribeSongNotes(() => useSongNotesStore.getState().bump());
listenSongNotesBroadcast(change => emitSongNotesChange(change.all ? 'all' : change.songKeys));

/** 读一首歌的评论（key 为 null 时是空的）；库里变了就重读。loaded：这一首读完了没有。 */
export const useSongNote = (key: string | null): SongNoteDetail & { loaded: boolean } => {
    const version = useSongNotesStore(state => state.version);
    const [detail, setDetail] = useState<SongNoteDetail & { key: string | null }>({ key: null, row: null, comments: [] });
    useEffect(() => {
        if (!key) return;
        let alive = true;
        void getSongNote(key).then(next => {
            if (alive) setDetail({ key, ...next });
        });
        return () => {
            alive = false;
        };
    }, [key, version]);
    // 换了一首、新的还没读到：不拿上一首的评论充数。
    if (!key || detail.key !== key) return { row: null, comments: [], loaded: !key };
    return { row: detail.row, comments: detail.comments, loaded: true };
};

/** 最近评论过的几首（新的在前）与一共几首；库里变了就重读。 */
export const useRecentSongNotes = (limit: number, enabled = true): { rows: SongNoteRow[]; total: number } => {
    const version = useSongNotesStore(state => state.version);
    const [state, setState] = useState<{ rows: SongNoteRow[]; total: number }>({ rows: [], total: 0 });
    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        void Promise.all([listRecentSongNotes(limit), countSongNotes()]).then(([rows, total]) => {
            if (alive) setState({ rows, total });
        });
        return () => {
            alive = false;
        };
    }, [enabled, limit, version]);
    return state;
};

/** 全部标签（key → 标签），按先后；库里变了就重读。行上只存标签的 key，写法从这里取。 */
export const useSongNoteTags = (enabled = true): ReadonlyMap<string, SongNoteTag> => {
    const version = useSongNotesStore(state => state.version);
    const [tags, setTags] = useState<ReadonlyMap<string, SongNoteTag>>(() => new Map());
    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        void listSongNoteTags().then(list => {
            if (alive) setTags(new Map(list.map(tag => [tag.key, tag])));
        });
        return () => {
            alive = false;
        };
    }, [enabled, version]);
    return tags;
};

/** 一共有几首歌写过评论或打过标签（信息条、细纸带上的计数）；库里变了就重读。 */
export const useSongNotesCount = (): number => {
    const version = useSongNotesStore(state => state.version);
    const [count, setCount] = useState(0);
    useEffect(() => {
        let alive = true;
        void countSongNotes().then(next => {
            if (alive) setCount(next);
        });
        return () => {
            alive = false;
        };
    }, [version]);
    return count;
};

// 全部的歌与标签：几处同时要（展开整页、另外三页卡片上的标签小条、首页的标签页签），同一个 version 只读一次库。
type AllSongNotes = { rows: SongNoteRow[]; tags: SongNoteTag[] };
const EMPTY_ALL: AllSongNotes = { rows: [], tags: [] };
const EMPTY_LOADED = { ...EMPTY_ALL, loaded: true };
let allCache: { version: number; promise: Promise<AllSongNotes>; value?: AllSongNotes } | null = null;
const readAll = (version: number): Promise<AllSongNotes> => {
    if (allCache?.version !== version) {
        const entry: NonNullable<typeof allCache> = {
            version,
            promise: Promise.all([listAllSongNotes(), listSongNoteTags()]).then(([rows, tags]) => {
                entry.value = { rows, tags };
                return entry.value;
            }),
        };
        allCache = entry;
    }
    return allCache.promise;
};
/** 这个版本已经读到的（新挂上的组件先拿它画，不先画一帧空的）。 */
const readAllNow = (version: number): AllSongNotes | null => (allCache?.version === version ? allCache.value ?? null : null);

/**
 * 全部写过评论或打过标签的歌（新的在前）和全部标签（按先后）；库里变了就重读。enabled 为 false 时不读、给空的。
 * loaded：读到过了（冷启动第一次读库之前是 false，界面别先画「还没有」）。
 */
export const useAllSongNotes = (enabled = true): AllSongNotes & { loaded: boolean } => {
    const version = useSongNotesStore(state => state.version);
    const [state, setState] = useState<AllSongNotes & { version: number }>(() => {
        const ready = readAllNow(version);
        return ready ? { ...ready, version } : { ...EMPTY_ALL, version: -1 };
    });
    useEffect(() => {
        if (!enabled) return;
        let alive = true;
        void readAll(version).then(next => {
            if (alive) setState(current => (current.version === version && current.rows === next.rows ? current : { ...next, version }));
        });
        return () => {
            alive = false;
        };
    }, [enabled, version]);
    if (!enabled) return EMPTY_LOADED;
    return { rows: state.rows, tags: state.tags, loaded: state.version !== -1 };
};

/** 按歌的 key 查它的评论摘要（另外三页的卡片、行上画标签小条）。 */
export const useSongNoteIndex = (enabled = true): ReadonlyMap<string, SongNoteRow> => {
    const { rows } = useAllSongNotes(enabled);
    return useMemo(() => new Map(rows.map(row => [row.key, row])), [rows]);
};
