import { describe, expect, it } from 'vitest';
import { resolveLocateStep } from '@/components/app/playing-song-locator/resolveLocateStep';

// test/unit/playing-song-locator/resolveLocateStep.test.ts — the one rule by which a page asked
// "where is the song that is playing" answers (the grid's collection page, the Bravais wall).

const base = { isHere: false, isFiltered: false, waits: false, cardsStillArriving: false, hasReadFailed: false };

describe('resolveLocateStep', () => {
    it('answers yes when the song is among the cards, filter or not', () => {
        expect(resolveLocateStep({ ...base, isHere: true })).toEqual({ kind: 'answer', answer: true });
        expect(resolveLocateStep({ ...base, isHere: true, isFiltered: true, cardsStillArriving: true, waits: true })).toEqual({ kind: 'answer', answer: true });
    });

    it('clears a filter before it says no', () => {
        expect(resolveLocateStep({ ...base, isFiltered: true })).toEqual({ kind: 'unfilter' });
        expect(resolveLocateStep({ ...base, isFiltered: true, waits: true, cardsStillArriving: true })).toEqual({ kind: 'unfilter' });
    });

    it('says no where the list is whole', () => {
        expect(resolveLocateStep(base)).toEqual({ kind: 'answer', answer: false });
        expect(resolveLocateStep({ ...base, waits: true })).toEqual({ kind: 'answer', answer: false });
    });

    it('cannot tell where the list is not whole', () => {
        expect(resolveLocateStep({ ...base, cardsStillArriving: true })).toEqual({ kind: 'answer', answer: 'unread' });
        expect(resolveLocateStep({ ...base, hasReadFailed: true })).toEqual({ kind: 'answer', answer: 'unread' });
        expect(resolveLocateStep({ ...base, waits: true, hasReadFailed: true })).toEqual({ kind: 'answer', answer: 'unread' });
    });

    it('waits for cards still to come when the request waits', () => {
        expect(resolveLocateStep({ ...base, waits: true, cardsStillArriving: true })).toEqual({ kind: 'wait' });
        expect(resolveLocateStep({ ...base, waits: true, cardsStillArriving: true, hasReadFailed: true })).toEqual({ kind: 'wait' });
    });
});
