import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLikedChecks, LIKED_CHECK_SLICE } from '@/services/onlineMusic/account/likedChecks';
import type { SongInPlay } from '@/services/onlineMusic/account/likedChecks';
import type { MediaId } from '@/types/onlineMusic';

// test/unit/onlineMusic/likedChecks.test.ts
// When the hearts of the songs in play are asked of a platform, and how many a request.

const inPlay = (count: number, from = 0, providerId = 'p'): SongInPlay[] => (
    Array.from({ length: count }, (_, at) => ({ providerId, mediaId: `s${from + at}` }))
);
// Lets every request that is answered at once, and what follows it, run.
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

const setup = () => {
    const asked: string[][] = [];
    const applied: Array<{ order: number; liked: MediaId[]; notLiked: MediaId[] }> = [];
    let user: MediaId | null = 'user';
    // The platform's answer: s7, s17, … are liked; s3 it says nothing of.
    let answer = async (ids: MediaId[]): Promise<Record<string, boolean>> => Object.fromEntries(
        ids.filter(id => id !== 's3').map(id => [String(id), String(id).endsWith('7')]),
    );
    let reads = 0;
    const checks = createLikedChecks({
        signedIn: () => user,
        asker: providerId => (providerId === 'p' ? ids => { asked.push(ids.map(String)); return answer(ids); } : null),
        beginLikedRead: (_providerId, _userId) => ({ order: ++reads }),
        applyLikedCheck: (read, liked, notLiked) => { applied.push({ order: read.order, liked, notLiked }); },
    });
    return {
        checks, asked, applied,
        signIn: (id: MediaId | null) => { user = id; },
        answerWith: (next: typeof answer) => { answer = next; },
    };
};

afterEach(() => vi.restoreAllMocks());

describe('the hearts of the songs in play', () => {
    it('asks nothing until a read of the liked ids was not whole, then asks the songs a slice a request, in their order', async () => {
        const { checks, asked } = setup();
        checks.songsInPlay(inPlay(120));
        checks.likedRead('p', 'user', true);
        await settled();
        expect(asked).toEqual([]);

        checks.likedRead('p', 'user', false);
        await settled();
        expect(LIKED_CHECK_SLICE).toBe(50);
        expect(asked.map(slice => slice.length)).toEqual([50, 50, 20]);
        expect(asked[0][0]).toBe('s0');
        expect(asked[2].at(-1)).toBe('s119');

        // A whole read after it: nothing is asked any more.
        checks.likedRead('p', 'user', true);
        checks.songsInPlay(inPlay(5, 500));
        await settled();
        expect(asked).toHaveLength(3);
    });

    it('settles each answer as it comes: the liked, the not liked, and leaves out what the platform said nothing of', async () => {
        const { checks, applied } = setup();
        checks.likedRead('p', 'user', false);
        checks.songsInPlay(inPlay(60));
        await settled();
        expect(applied).toHaveLength(2);
        expect(applied[0].liked).toEqual(['s7', 's17', 's27', 's37', 's47']);
        expect(applied[0].notLiked).toHaveLength(49 - 5);
        expect(applied[0].notLiked).not.toContain('s3');
        expect(applied[1]).toMatchObject({ liked: ['s57'] });
        // Each request is a read of its own, begun when it is sent.
        expect(applied.map(check => check.order)).toEqual([1, 2]);
    });

    it('asks each song once until the next read of the liked ids, a repeated one once, and a new one alone', async () => {
        const { checks, asked } = setup();
        checks.likedRead('p', 'user', false);
        checks.songsInPlay([...inPlay(3), ...inPlay(3)]);
        await settled();
        expect(asked).toEqual([['s0', 's1', 's2']]);

        // The song playing moves on and songs are queued: only the new ones are asked.
        checks.songsInPlay([...inPlay(4, 1), ...inPlay(1, 9)]);
        await settled();
        expect(asked).toEqual([['s0', 's1', 's2'], ['s3', 's4', 's9']]);
        // s3, which the platform said nothing of, is not asked again either.
        checks.songsInPlay([...inPlay(5), ...inPlay(1, 9)]);
        await settled();
        expect(asked).toHaveLength(2);

        // The next read of the liked ids: what is in play is asked again.
        checks.likedRead('p', 'user', false);
        await settled();
        expect(asked[2]).toEqual(['s0', 's1', 's2', 's3', 's4', 's9']);
    });

    it('asks only for the account the read was for, and only a platform whose adapter can be asked', async () => {
        const { checks, asked, signIn } = setup();
        checks.likedRead('p', 'user', false);
        checks.likedRead('q', 'user', false);
        signIn('someone else');
        checks.songsInPlay([...inPlay(2), ...inPlay(2, 0, 'q')]);
        await settled();
        expect(asked).toEqual([]);

        signIn('user');
        checks.songsInPlay([...inPlay(2), ...inPlay(2, 0, 'q')]);
        await settled();
        expect(asked).toEqual([['s0', 's1']]);
    });

    it('stops at a request that fails, and asks nothing more until the next read of the liked ids', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { checks, asked, applied, answerWith } = setup();
        let requests = 0;
        answerWith(async ids => {
            requests += 1;
            if (requests === 2) throw new Error('offline');
            return Object.fromEntries(ids.map(id => [String(id), false]));
        });
        checks.likedRead('p', 'user', false);
        checks.songsInPlay(inPlay(120));
        await settled();
        expect(asked.map(slice => slice.length)).toEqual([50, 50]);
        expect(applied).toHaveLength(1);
        expect(warn).toHaveBeenCalledWith('[Like] p: the hearts of 70 songs in play could not be checked, they stay as they were until the next read of the liked songs: offline');

        // The songs in play are replaced, by the same ones and then with new ones: nothing is asked.
        checks.songsInPlay(inPlay(120));
        checks.songsInPlay(inPlay(125));
        await settled();
        expect(asked).toHaveLength(2);

        // The next read of the liked ids: every song in play is asked again.
        checks.likedRead('p', 'user', false);
        await settled();
        expect(asked.slice(2).map(slice => [slice[0], slice.length])).toEqual([['s0', 50], ['s50', 50], ['s100', 25]]);
    });

    it('sends one request at a time for a platform, and the song playing now goes first', async () => {
        const { checks, asked, answerWith } = setup();
        const waiting: Array<() => void> = [];
        answerWith(ids => new Promise(resolve => {
            waiting.push(() => resolve(Object.fromEntries(ids.map(id => [String(id), false]))));
        }));
        checks.likedRead('p', 'user', false);
        checks.songsInPlay(inPlay(120));
        // While the first request is out, another song starts playing and one more is queued.
        const playing: SongInPlay = { providerId: 'p', mediaId: 's500' };
        checks.songsInPlay([playing, ...inPlay(120)]);
        checks.songsInPlay([playing, ...inPlay(120), ...inPlay(1, 600)]);
        expect(asked).toHaveLength(1);

        waiting.shift()!();
        await settled();
        expect(asked).toHaveLength(2);
        expect(asked[1]).toEqual(['s500', ...inPlay(49, 50).map(song => String(song.mediaId))]);
        expect(waiting).toHaveLength(1);

        waiting.shift()!();
        await settled();
        expect(asked[2]).toEqual([...inPlay(21, 99).map(song => String(song.mediaId)), 's600']);
        waiting.shift()!();
        await settled();
        expect(asked).toHaveLength(3);
    });

    it.each([
        // A whole read: nothing is left to ask.
        [true, [50]],
        // A read that was not whole: the songs are asked again from it, once the request out is answered.
        [false, [50, 50, 50, 20]],
    ])('drops the answer of a request out when a read of the liked ids is applied before it comes (whole: %s)', async (whole, slices) => {
        const { checks, asked, applied, answerWith } = setup();
        let answerFirst!: () => void;
        answerWith(ids => new Promise(resolve => {
            const answer = Object.fromEntries(ids.map(id => [String(id), false]));
            if (asked.length === 1) answerFirst = () => resolve(answer);
            else resolve(answer);
        }));
        checks.likedRead('p', 'user', false);
        checks.songsInPlay(inPlay(120));
        expect(asked).toHaveLength(1);

        checks.likedRead('p', 'user', whole);
        answerFirst();
        await settled();
        expect(asked.map(slice => slice.length)).toEqual(slices);
        // The first request (read order 1) was answered after the read: its answer is not applied.
        expect(applied.map(check => check.order)).not.toContain(1);
        expect(applied).toHaveLength(slices.length - 1);
    });
});
