import type { LocalSong } from '../../types';

// The list and staging area together always hold every song from the original playlist.
// Edits go through a small history so each step can be undone and redone until the editor closes.
export type OrderSong = Pick<LocalSong, 'id' | 'title' | 'fileName'> & {
    /** Display only: the artists as the library shows them, joined. */
    artist?: string;
    album?: string;
    coverUrl?: string;
    durationMs?: number;
};
export type OrderDraft = { list: readonly OrderSong[]; staged: readonly OrderSong[] };
export type OrderHistory = { past: readonly OrderDraft[]; present: OrderDraft; future: readonly OrderDraft[] };

/** Steps kept for undo. Each one only holds references to the same song objects. */
const HISTORY_LIMIT = 200;

export const orderSongTitle = (song: OrderSong): string => song.title.trim() || song.fileName || song.id;

// A drop gap refers to the visible list before the picked songs are removed.
export const moveOrderSongs = (
    draft: OrderDraft,
    picked: ReadonlySet<string>,
    destination: number | 'stage',
): OrderDraft => {
    const block = draft.list.filter(song => picked.has(song.id));
    const keep = (song: OrderSong) => !picked.has(song.id);
    if (destination === 'stage') {
        return { list: draft.list.filter(keep), staged: [...draft.staged, ...block] };
    }
    return {
        list: [...draft.list.slice(0, destination).filter(keep), ...block, ...draft.list.slice(destination).filter(keep)],
        staged: draft.staged,
    };
};

export const insertStagedSongs = (draft: OrderDraft, gap: number): OrderDraft => ({
    list: [...draft.list.slice(0, gap), ...draft.staged, ...draft.list.slice(gap)],
    staged: [],
});

export const sortPlaylistByTitle = (draft: OrderDraft, language: string): OrderDraft => {
    const collator = new Intl.Collator(language, { sensitivity: 'base', numeric: true });
    return {
        list: [...draft.list, ...draft.staged].sort((left, right) => collator.compare(orderSongTitle(left), orderSongTitle(right))),
        staged: [],
    };
};

const sameDraft = (left: OrderDraft, right: OrderDraft): boolean => (
    left.list.length === right.list.length
    && left.staged.length === right.staged.length
    && left.list.every((song, index) => song.id === right.list[index].id)
    && left.staged.every((song, index) => song.id === right.staged[index].id)
);

export const startOrderHistory = (draft: OrderDraft): OrderHistory => ({ past: [], present: draft, future: [] });

/** Records a new draft. A step that changes nothing (a song dropped where it was) is not recorded. */
export const commitOrderDraft = (history: OrderHistory, next: OrderDraft): OrderHistory => (
    sameDraft(history.present, next)
        ? history
        : { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] }
);

export const undoOrderDraft = (history: OrderHistory): OrderHistory => {
    const previous = history.past.at(-1);
    return previous
        ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] }
        : history;
};

export const redoOrderDraft = (history: OrderHistory): OrderHistory => {
    if (history.future.length === 0) return history;
    const [next, ...rest] = history.future;
    return { past: [...history.past, history.present], present: next, future: rest };
};
