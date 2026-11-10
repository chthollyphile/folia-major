import { describe, expect, it } from 'vitest';
import { MAX_KEPT, createHandedOut, cursorWords, stampCursor } from '@/services/onlineMusic/exploreReads';

// test/unit/explore/exploreReads.test.ts
// What the explore adapters share: the memory of what the reads before used (its order, its
// scopes, its limit), and the number of a read in a cursor.

const same = (key: string) => key;

describe('what the reads before used', () => {
    it('puts the candidates never used first as they came, then the others, the one used longest ago first', () => {
        const handedOut = createHandedOut();
        expect(handedOut.inTurn('shelf', ['a', 'b', 'c', 'd'], same)).toEqual(['a', 'b', 'c', 'd']);
        handedOut.note('shelf', ['c', 'b']);
        handedOut.note('shelf', ['a']);
        // Never used: d. Then c and b in the order they were noted in, whatever order they come in; then a.
        expect(handedOut.inTurn('shelf', ['a', 'b', 'c', 'd'], same)).toEqual(['d', 'c', 'b', 'a']);
        expect(handedOut.inTurn('shelf', ['b', 'a', 'd', 'c'], same)).toEqual(['d', 'c', 'b', 'a']);
        // Used again, a thing goes behind the others.
        handedOut.note('shelf', ['c']);
        expect(handedOut.inTurn('shelf', ['a', 'b', 'c', 'd'], same)).toEqual(['d', 'b', 'a', 'c']);
        // The candidates are read by the key the caller says, and are not put in another order themselves.
        const candidates = [{ id: 'a' }, { id: 'd' }];
        expect(handedOut.inTurn('shelf', candidates, candidate => candidate.id)).toEqual([{ id: 'd' }, { id: 'a' }]);
        expect(candidates).toEqual([{ id: 'a' }, { id: 'd' }]);
    });

    it('goes through a list a batch at a time to its end before its first entries come again, with nothing that starts it over', () => {
        const handedOut = createHandedOut();
        const list = ['a', 'b', 'c', 'd', 'e'];
        const batches: string[][] = [];
        for (let read = 1; read <= 5; read += 1) {
            const batch = handedOut.inTurn('shelf', list, same).slice(0, 2);
            handedOut.note('shelf', batch);
            batches.push(batch);
        }
        expect(batches).toEqual([['a', 'b'], ['c', 'd'], ['e', 'a'], ['b', 'c'], ['d', 'e']]);
    });

    it('uses every entry of a list as often as the others, whatever its length against the batch', () => {
        // (11 songs, 9 asked with a read in three pages of 3: the first seven were once asked with in every read, the last four in every second.)
        const handedOut = createHandedOut();
        const list = Array.from({ length: 11 }, (_, index) => `s${index}`);
        const times = new Map(list.map(key => [key, 0]));
        for (let read = 1; read <= 22; read += 1) {
            let left = list;
            for (let page = 0; page < 3; page += 1) {
                const taken = handedOut.inTurn('seeds', left, same).slice(0, 3);
                left = left.filter(key => !taken.includes(key));
                handedOut.note('seeds', taken);
                taken.forEach(key => times.set(key, times.get(key)! + 1));
            }
        }
        expect([...times.values()]).toEqual(list.map(() => 18));
    });

    it('keeps each scope, and each memory, to itself', () => {
        const handedOut = createHandedOut();
        handedOut.note('seeds', ['a']);
        expect(handedOut.has('seeds', 'a')).toBe(true);
        expect(handedOut.has('shelf', 'a')).toBe(false);
        expect(handedOut.inTurn('seeds', ['a', 'b'], same)).toEqual(['b', 'a']);
        expect(handedOut.inTurn('shelf', ['a', 'b'], same)).toEqual(['a', 'b']);
        const other = createHandedOut();
        expect(other.has('seeds', 'a')).toBe(false);
        expect(other.inTurn('seeds', ['a', 'b'], same)).toEqual(['a', 'b']);
    });

    it('forgets, past its limit, the keys of a scope used longest ago, which then count as never used', () => {
        const handedOut = createHandedOut();
        handedOut.note('shelf', ['first', 'second']);
        handedOut.note('shelf', Array.from({ length: MAX_KEPT - 2 }, (_, index) => `key ${index}`));
        // At the limit: nothing is forgotten.
        expect(handedOut.has('shelf', 'first')).toBe(true);
        // A key used again is not the one used longest ago any more: `second` goes before it.
        handedOut.note('shelf', ['first', 'new']);
        expect(['first', 'second', 'key 0', `key ${MAX_KEPT - 3}`, 'new'].map(key => handedOut.has('shelf', key))).toEqual([true, false, true, true, true]);
        expect(handedOut.inTurn('shelf', ['new', 'key 0', 'second', 'first'], same)).toEqual(['second', 'key 0', 'first', 'new']);
        // The limit is a scope's own: another scope is not counted with it.
        handedOut.note('seeds', ['a']);
        handedOut.note('shelf', ['newest']);
        expect(handedOut.has('seeds', 'a')).toBe(true);
        expect(handedOut.has('shelf', 'key 0')).toBe(false);
    });
});

describe('the number of a read in a cursor', () => {
    it('gives back what a cursor of the read says, and null for a cursor of another read or of none', () => {
        const cursor = stampCursor(3, 'held 12 shelf: one');
        expect(cursor).toBe('3:held 12 shelf: one');
        expect(cursorWords(cursor, 3)).toBe('held 12 shelf: one');
        expect(cursorWords(cursor, 4)).toBeNull();
        expect(cursorWords('no number', 3)).toBeNull();
        expect(cursorWords(':words', 0)).toBeNull();
        expect(cursorWords('x:words', 3)).toBeNull();
    });
});
