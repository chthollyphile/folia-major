import { create } from 'zustand';
import i18n from '../i18n/config';
import type { SongResult, UnifiedSong } from '../types';
import { getPlaybackSongKey, isStagePlaybackSong, normalizePlaybackSongSource } from '../utils/appPlaybackGuards';
import { getStoredString, setStoredString } from './storagePrimitives';
import { setStatusMessage } from './useStatusMessageStore';

// src/stores/useScratchpadStore.ts
// 速记簿（左侧抽屉）的内容与开合：一个本机的、跨来源的歌曲暂存区，和播放队列分开（放进来不动正在播的队列），
// 也和歌单分开（不在任何平台上建东西）。Bravais、命令面板、抽屉三处都要写它，所以放在这里。
// 设计稿见 plan/scratchpad-spec.md。条目按加入先后追加（记事本语义），按 getPlaybackSongKey 去重；
// 存进 localStorage（同步读，启动就有，不随「清除缓存」消失），本地歌只留 localRef，和上次队列的持久化一样。

export const SCRATCHPAD_STORAGE_KEY = 'folia_scratchpad_entries';
/** 满了拒收而不挤掉旧的：里面是用户自己攒的东西。 */
export const SCRATCHPAD_CAPACITY = 1000;

/** 条目是从哪收来的（抽屉里的一行小字）；没有就不写。 */
export type ScratchpadOrigin = { label: string };

export type ScratchpadEntry = {
    /** getPlaybackSongKey：去重与行的身份。 */
    key: string;
    song: SongResult;
    addedAt: number;
    origin?: ScratchpadOrigin;
};

type StoredScratchpad = { version: 1; entries: ScratchpadEntry[] };

export type ScratchpadAddResult = { added: number; duplicates: number; rejected: number };

/** 存下来的样子：本地歌只留 songId 引用（blob、文件句柄都不跨启动），舞台歌不收。 */
export const toScratchpadSong = (song: SongResult): SongResult => {
    const unified = normalizePlaybackSongSource(song) as UnifiedSong & { localData?: { id?: string } };
    const localSongId = unified.localRef?.songId || unified.localData?.id;
    if (!localSongId) return unified;
    const { localData: _legacyLocalData, ...snapshot } = unified;
    return { ...snapshot, isLocal: true, localRef: { songId: localSongId } } as UnifiedSong;
};

/** 把 songs 追加到 entries 后面：已在里面的、舞台歌、超出容量的都不收。纯函数，单测直接测它。 */
export const appendScratchpadEntries = (
    entries: readonly ScratchpadEntry[],
    songs: readonly SongResult[],
    options: { origin?: ScratchpadOrigin; now?: number; capacity?: number } = {},
): { entries: ScratchpadEntry[]; result: ScratchpadAddResult } => {
    const capacity = options.capacity ?? SCRATCHPAD_CAPACITY;
    const now = options.now ?? Date.now();
    const keys = new Set(entries.map(entry => entry.key));
    const next = [...entries];
    const result: ScratchpadAddResult = { added: 0, duplicates: 0, rejected: 0 };
    for (const song of songs) {
        if (isStagePlaybackSong(song)) {
            result.rejected += 1;
            continue;
        }
        const key = getPlaybackSongKey(song);
        if (keys.has(key)) {
            result.duplicates += 1;
            continue;
        }
        if (next.length >= capacity) {
            result.rejected += 1;
            continue;
        }
        keys.add(key);
        next.push({ key, song: toScratchpadSong(song), addedAt: now, ...(options.origin ? { origin: options.origin } : {}) });
        result.added += 1;
    }
    return { entries: next, result };
};

/** 读存档：坏的、版本不认识的当空；每条至少要有 key 与 song。 */
export const parseStoredScratchpad = (raw: string | null): ScratchpadEntry[] => {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as Partial<StoredScratchpad>;
        if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return [];
        return parsed.entries.filter((entry): entry is ScratchpadEntry => (
            Boolean(entry) && typeof entry.key === 'string' && Boolean(entry.song) && typeof entry.addedAt === 'number'
        ));
    } catch (error) {
        console.warn('[Scratchpad] stored entries are unreadable, starting empty', error);
        return [];
    }
};

const readEntries = () => parseStoredScratchpad(getStoredString(SCRATCHPAD_STORAGE_KEY, ''));

const writeEntries = (entries: ScratchpadEntry[]) => {
    try {
        const stored: StoredScratchpad = { version: 1, entries };
        setStoredString(SCRATCHPAD_STORAGE_KEY, JSON.stringify(stored));
    } catch (error) {
        console.warn('[Scratchpad] failed to save entries', error);
    }
};

type ScratchpadState = {
    entries: ScratchpadEntry[];
    isOpen: boolean;
    /** 每收进一批加一：把手据此闪一下，开着的抽屉据此滚到新行。 */
    addNonce: number;
    setOpen: (isOpen: boolean) => void;
    toggleOpen: () => void;
    add: (songs: readonly SongResult[], origin?: ScratchpadOrigin) => ScratchpadAddResult;
    remove: (keys: readonly string[]) => void;
    clear: () => void;
};

export const useScratchpadStore = create<ScratchpadState>((set, get) => ({
    entries: readEntries(),
    isOpen: false,
    addNonce: 0,
    setOpen: isOpen => set({ isOpen }),
    toggleOpen: () => set(state => ({ isOpen: !state.isOpen })),
    add: (songs, origin) => {
        const { entries, result } = appendScratchpadEntries(get().entries, songs, { origin });
        if (result.added > 0) {
            set(state => ({ entries, addNonce: state.addNonce + 1 }));
            writeEntries(entries);
        }
        return result;
    },
    remove: keys => {
        const drop = new Set(keys);
        const entries = get().entries.filter(entry => !drop.has(entry.key));
        set({ entries });
        writeEntries(entries);
    },
    clear: () => {
        set({ entries: [] });
        writeEntries([]);
    },
}));

/** 收进速记簿并报一句结果（入口们共用：命令、聚焦卡菜单、集合缝）。 */
export const collectToScratchpad = (songs: readonly SongResult[], origin?: ScratchpadOrigin): ScratchpadAddResult => {
    const result = useScratchpadStore.getState().add(songs, origin);
    console.info('[Scratchpad] collect', { requested: songs.length, ...result, origin: origin?.label });
    if (result.added > 0) {
        setStatusMessage({
            type: 'success',
            text: songs.length === 1
                ? i18n.t('scratchpad.addedOne')
                : i18n.t('scratchpad.addedMany', { count: result.added }),
            note: result.duplicates > 0 ? i18n.t('scratchpad.skippedDuplicates', { count: result.duplicates }) : undefined,
        });
    } else if (result.duplicates > 0) {
        setStatusMessage({ type: 'info', text: i18n.t(songs.length === 1 ? 'scratchpad.alreadyInOne' : 'scratchpad.alreadyInAll') });
    }
    if (result.rejected > 0 && useScratchpadStore.getState().entries.length >= SCRATCHPAD_CAPACITY) {
        setStatusMessage({ type: 'error', text: i18n.t('scratchpad.full', { count: SCRATCHPAD_CAPACITY }) });
    }
    return result;
};

export const toggleScratchpad = () => useScratchpadStore.getState().toggleOpen();
