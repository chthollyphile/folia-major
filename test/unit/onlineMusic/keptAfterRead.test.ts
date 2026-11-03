import { describe, expect, it } from 'vitest';
import { keptAfterRead } from '@/services/onlineMusic/account/keptAfterRead';
import type { MediaId } from '@/types/onlineMusic';

// test/unit/onlineMusic/keptAfterRead.test.ts
// The one rule by which a read of an account's liked songs meets what the listener pressed.

const BEGAN = 1_000_000;
const read = { userId: 'user', beganAt: BEGAN, order: 1 };

// What was pressed: 'unsettled' for a press whose request is still out, else the time a request
// for the item was last taken. Answers as likePresses.touchedSince does.
const pressed = (touched: Record<string, number | 'unsettled'>) => (key: string, time: number): boolean => {
    const at = touched[key];
    return at === 'unsettled' || (at !== undefined && at >= time);
};

const settle = (over: {
    held?: MediaId[];
    ids?: MediaId[];
    notKept?: MediaId[];
    whole?: boolean;
    touched?: Record<string, number | 'unsettled'>;
    signedInUserId?: MediaId | null;
    newestApplied?: number;
}) => keptAfterRead({
    read,
    answer: { ids: over.ids ?? [], whole: over.whole ?? true },
    notKept: over.notKept,
    held: over.held ?? [],
    signedInUserId: over.signedInUserId === undefined ? 'user' : over.signedInUserId,
    newestApplied: over.newestApplied ?? 0,
    touchedSince: pressed(over.touched ?? {}),
});

describe('what an account keeps after a read', () => {
    it('takes the answer of a whole read for every item that was not pressed', () => {
        const kept = settle({ held: ['stays', 'left-elsewhere'], ids: ['stays', 'liked-elsewhere'] });

        expect(kept).toEqual({ ids: ['stays', 'liked-elsewhere'], added: 1, removed: 1, pressed: new Set() });
    });

    it('counts an id the same whether it is held as a number or read as text, and takes a repeated one once', () => {
        const kept = settle({ held: [7, 8], ids: ['7', '8', '8'] });

        expect(kept).toMatchObject({ ids: ['7', '8'], added: 0, removed: 0 });
    });

    it('keeps what is held for an item whose press is not settled, liked or not', () => {
        // An unlike on its way: the song stays held until its request settles.
        const kept = settle({
            held: ['stays', 'being-unliked'],
            ids: ['stays', 'being-unliked', 'elsewhere'],
            touched: { 'being-unliked': 'unsettled' },
        });
        expect(kept).toEqual({ ids: ['stays', 'elsewhere', 'being-unliked'], added: 1, removed: 0, pressed: new Set(['being-unliked']) });

        // A like on its way that the list shows already: the song is not held until its request settles.
        const liking = settle({ held: ['stays'], ids: ['stays', 'being-liked'], touched: { 'being-liked': 'unsettled' } });
        expect(liking).toEqual({ ids: ['stays'], added: 0, removed: 0, pressed: new Set(['being-liked']) });
    });

    it('keeps what a request that settled during the read left, both ways', () => {
        // The list as it was before both requests.
        const kept = settle({
            held: ['stays', 'liked-here'],
            ids: ['stays', 'unliked-here'],
            touched: { 'liked-here': BEGAN + 10, 'unliked-here': BEGAN + 20 },
        });

        expect(kept).toEqual({ ids: ['stays', 'liked-here'], added: 0, removed: 0, pressed: new Set(['unliked-here', 'liked-here']) });
    });

    it('keeps an item settled up to 5 seconds before the read began, and lets the read decide for an earlier one', () => {
        const justBefore = settle({ held: ['stays', 'just-liked'], ids: ['stays'], touched: { 'just-liked': BEGAN - 5_000 } });
        expect(justBefore).toMatchObject({ ids: ['stays', 'just-liked'], removed: 0 });

        const earlier = settle({ held: ['stays', 'liked-earlier'], ids: ['stays'], touched: { 'liked-earlier': BEGAN - 5_001 } });
        expect(earlier).toEqual({ ids: ['stays'], added: 0, removed: 1, pressed: new Set() });
    });

    it('only adds from a read that is not whole', () => {
        const kept = settle({ held: ['stays', 'past-the-cut'], ids: ['stays', 'liked-elsewhere'], whole: false });

        expect(kept).toEqual({ ids: ['stays', 'past-the-cut', 'liked-elsewhere'], added: 1, removed: 0, pressed: new Set() });
    });

    it('does not add a pressed item from a read that is not whole', () => {
        const kept = settle({
            held: ['stays', 'being-unliked'],
            ids: ['being-unliked', 'just-unliked'],
            whole: false,
            touched: { 'being-unliked': 'unsettled', 'just-unliked': BEGAN + 1 },
        });

        expect(kept).toEqual({ ids: ['stays', 'being-unliked'], added: 0, removed: 0, pressed: new Set(['being-unliked', 'just-unliked']) });
    });

    // A check of the songs in play (likedChecks.ts) names the ones it found not liked as well.
    it('takes away from a check what it names as not kept, but a pressed item', () => {
        const kept = settle({
            held: ['stays', 'unliked-elsewhere', 'being-liked', 'not-asked'],
            ids: ['liked-elsewhere'],
            notKept: ['unliked-elsewhere', 'being-liked', 'never-held'],
            whole: false,
            touched: { 'being-liked': 'unsettled' },
        });

        expect(kept).toEqual({ ids: ['stays', 'being-liked', 'not-asked', 'liked-elsewhere'], added: 1, removed: 1, pressed: new Set(['being-liked']) });
    });

    it('changes nothing for a whole read that is empty while items are held: a page that could not be made out reads the same', () => {
        expect(settle({ held: ['held'], ids: [] })).toEqual({ refused: 'it is empty while items are held' });
    });

    it('takes a whole read that is empty where the platform counted the list as empty just before it, and keeps what was pressed', () => {
        expect(keptAfterRead({
            read: { ...read, countedEmpty: true },
            answer: { ids: [], whole: true },
            held: ['unliked-elsewhere', 'being-liked'],
            signedInUserId: 'user',
            newestApplied: 0,
            touchedSince: pressed({ 'being-liked': 'unsettled' }),
        })).toEqual({ ids: ['being-liked'], added: 0, removed: 1, pressed: new Set(['being-liked']) });
    });

    it('takes an empty read where nothing is held, and changes nothing for an empty one that is not whole', () => {
        expect(settle({ held: [], ids: [] })).toMatchObject({ ids: [], added: 0, removed: 0 });
        expect(settle({ held: ['held'], ids: [], whole: false })).toMatchObject({ ids: ['held'], added: 0, removed: 0 });
    });

    it('drops the answer when a whole read begun after it was applied before it', () => {
        expect(settle({ held: ['held'], ids: ['read'], newestApplied: 2 })).toEqual({ refused: 'a whole read begun after it was applied before it' });
    });

    it('takes the answer when the newest read applied is this one, or an earlier one', () => {
        expect(settle({ held: [], ids: ['read'], newestApplied: 1 })).toMatchObject({ ids: ['read'] });
        expect(settle({ held: [], ids: ['read'], newestApplied: 0 })).toMatchObject({ ids: ['read'] });
    });

    it('drops the answer when the signed-in user is another one, or nobody', () => {
        expect(settle({ held: ['of-the-other'], ids: ['read'], signedInUserId: 'other-user' })).toEqual({ refused: 'its user is no longer the one signed in' });
        expect(settle({ held: [], ids: ['read'], signedInUserId: null })).toEqual({ refused: 'its user is no longer the one signed in' });
    });
});
