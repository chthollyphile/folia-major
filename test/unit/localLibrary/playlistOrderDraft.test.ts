import { describe, expect, it } from 'vitest';
import {
    commitOrderDraft,
    insertStagedSongs,
    moveOrderSongs,
    redoOrderDraft,
    sortPlaylistByTitle,
    startOrderHistory,
    undoOrderDraft,
    type OrderDraft,
} from '../../../src/components/local-playlist-order/playlistOrderDraft';

// Covers moves across a gap in the original list and preserving staged songs across operations.
const song = (id: string, title = id) => ({ id, title, fileName: id });
const original: OrderDraft = { list: ['a', 'b', 'c', 'd', 'e'].map(id => song(id)), staged: [] };
const ids = (draft: OrderDraft) => draft.list.map(item => item.id);

describe('local playlist order draft', () => {
    it('inserts discontiguous picks in list order using the gap before removal', () => {
        const picked = new Set(['d', 'b']);
        expect(ids(moveOrderSongs(original, picked, 0))).toEqual(['b', 'd', 'a', 'c', 'e']);
        expect(ids(moveOrderSongs(original, picked, 3))).toEqual(['a', 'c', 'b', 'd', 'e']);
        expect(ids(moveOrderSongs(original, picked, 5))).toEqual(['a', 'c', 'e', 'b', 'd']);
        expect(ids(original)).toEqual(['a', 'b', 'c', 'd', 'e']);
    });

    it('appends successive selections to the staging area and inserts them together', () => {
        const first = moveOrderSongs(original, new Set(['e', 'a']), 'stage');
        const second = moveOrderSongs(first, new Set(['c']), 'stage');
        const moved = moveOrderSongs(second, new Set(['d']), 0);
        expect(ids(moved)).toEqual(['d', 'b']);
        const inserted = insertStagedSongs(moved, 1);
        expect(ids(inserted)).toEqual(['d', 'a', 'e', 'c', 'b']);
        expect(inserted.staged).toEqual([]);
    });

    it('restores the block into an empty list', () => {
        const staged = moveOrderSongs(original, new Set(ids(original)), 'stage');
        expect(staged.list).toEqual([]);
        expect(insertStagedSongs(staged, 0)).toEqual(original);
    });

    it('sorts the full draft naturally by title with a file name fallback and stable ties', () => {
        const draft = { list: [song('A', 'Track 10'), song('B', 'Track 2'), song('C', 'track 2')], staged: [song('Apple', ' ')] };
        expect(ids(sortPlaylistByTitle(draft, 'en'))).toEqual(['Apple', 'B', 'C', 'A']);
        expect(draft.staged).toHaveLength(1);
    });

    it('undoes and redoes steps, and a new step clears what could be redone', () => {
        const staged = moveOrderSongs(original, new Set(['b']), 'stage');
        const inserted = insertStagedSongs(staged, 0);
        let history = commitOrderDraft(commitOrderDraft(startOrderHistory(original), staged), inserted);
        expect(ids(history.present)).toEqual(['b', 'a', 'c', 'd', 'e']);

        history = undoOrderDraft(history);
        expect(history.present).toBe(staged);
        history = undoOrderDraft(history);
        expect(history.present).toBe(original);
        expect(undoOrderDraft(history)).toBe(history);

        history = redoOrderDraft(history);
        expect(history.present).toBe(staged);
        history = commitOrderDraft(history, moveOrderSongs(staged, new Set(['e']), 0));
        expect(history.future).toEqual([]);
        expect(redoOrderDraft(history)).toBe(history);
    });

    it('does not record a step that leaves the order as it was', () => {
        const history = startOrderHistory(original);
        expect(commitOrderDraft(history, moveOrderSongs(original, new Set(['c']), 2))).toBe(history);
    });
});
