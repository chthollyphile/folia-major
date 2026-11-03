import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANSWER_LIMIT_MS, CHECK_INTERVAL_MS, createAccountMoments, decideLikedRead } from '@/services/onlineMusic/account/readMoments';
import type { AccountMoment, LikedReadKnown } from '@/services/onlineMusic/account/readMoments';

// test/unit/onlineMusic/readMoments.test.ts
// When the liked songs of a signed-in account are read again: the decision, and the checks made
// at the moments (the window returned to, the home screen entered).

const known = (over: Partial<LikedReadKnown> = {}): LikedReadKnown => ({
    signedIn: true,
    underWay: false,
    sinceLastCheck: null,
    ...over,
});

describe('whether the liked songs are read again', () => {
    it('asks for the count first, at a moment with no check before it', () => {
        expect(decideLikedRead(known())).toBe('ask for the count');
    });

    it('reads whole only when the count the platform gives is not the one held', () => {
        expect(decideLikedRead(known({ count: { held: 12, read: 12 } }))).toBe('do nothing');
        expect(decideLikedRead(known({ count: { held: 12, read: 13 } }))).toBe('read whole');
        expect(decideLikedRead(known({ count: { held: 12, read: 11 } }))).toBe('read whole');
        expect(decideLikedRead(known({ count: { held: 0, read: 0 } }))).toBe('do nothing');
    });

    it('does nothing when the platform gives no count', () => {
        expect(decideLikedRead(known({ count: { held: 12, read: null } }))).toBe('do nothing');
    });

    it('does nothing when nobody is signed in, before the count and after it', () => {
        expect(decideLikedRead(known({ signedIn: false }))).toBe('do nothing');
        expect(decideLikedRead(known({ signedIn: false, count: { held: 0, read: 13 } }))).toBe('do nothing');
    });

    it('does not ask while a check or its read is under way', () => {
        expect(decideLikedRead(known({ underWay: true }))).toBe('do nothing');
    });

    it('takes a burst of moments for one: it asks again only once the interval has passed', () => {
        expect(decideLikedRead(known({ sinceLastCheck: 0 }))).toBe('do nothing');
        expect(decideLikedRead(known({ sinceLastCheck: CHECK_INTERVAL_MS - 1 }))).toBe('do nothing');
        expect(decideLikedRead(known({ sinceLastCheck: CHECK_INTERVAL_MS }))).toBe('ask for the count');
    });
});

// One platform's account as the checks see it: the test moves the clock, the platform's count
// and the liked ids Folia holds; a whole read brings what the platform holds.
const setUp = (over: { userId?: string | null; held?: number; onPlatform?: number; counts?: boolean } = {}) => {
    const state = {
        userId: over.userId === undefined ? 'user' : over.userId,
        held: over.held ?? 10,
        /** How many liked ids a whole read brings. */
        onPlatform: over.onPlatform ?? over.held ?? 10,
        /** By how much the platform's count is above the ids its list gives. */
        countsMore: 0,
        time: 1_000_000,
    };
    const likedCount = vi.fn(async (): Promise<number | null> => state.onPlatform + state.countsMore);
    const readLikedWhole = vi.fn(async (): Promise<boolean> => { state.held = state.onPlatform; return true; });
    const happened = createAccountMoments({
        account: () => (state.userId === null ? null : { userId: state.userId, likedHeld: state.held }),
        likedCount: over.counts === false ? () => undefined : likedCount,
        readLikedWhole,
        now: () => state.time,
    });
    // The next moment, far enough from the last check to be one of its own.
    const later = async (moment: AccountMoment = 'window-returned') => {
        state.time += CHECK_INTERVAL_MS;
        await happened(moment, 'platform');
    };
    return { state, likedCount, readLikedWhole, happened, later };
};

describe('the checks at the moments', () => {
    let log: ReturnType<typeof vi.spyOn>;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each(['window-returned', 'home-entered'] as const)('asks for the count at %s and reads nothing while it is the one held', async moment => {
        const { likedCount, readLikedWhole, happened } = setUp({ held: 10 });

        await happened(moment, 'platform');

        expect(likedCount).toHaveBeenCalledWith('platform', 'user');
        expect(readLikedWhole).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith(`[Like] platform: ${moment}: the liked list counts 10, 10 held: the liked songs are not read`);
    });

    it('reads the liked songs whole when the count differs, and not again while it stays', async () => {
        const { state, likedCount, readLikedWhole, happened, later } = setUp({ held: 10, onPlatform: 11 });

        await happened('home-entered', 'platform');

        expect(readLikedWhole).toHaveBeenCalledTimes(1);
        expect(readLikedWhole).toHaveBeenCalledWith('platform', 'user', false);
        expect(log).toHaveBeenCalledWith('[Like] platform: home-entered: the liked list counts 11, 10 held: the liked songs are read whole');

        await later();
        expect(likedCount).toHaveBeenCalledTimes(2);
        expect(readLikedWhole).toHaveBeenCalledTimes(1);

        // An unlike made in the platform's own app.
        state.onPlatform = 10;
        await later();
        expect(readLikedWhole).toHaveBeenCalledTimes(2);
    });

    it('reads once, not at every check, where the platform counts more songs than its list gives', async () => {
        const { state, readLikedWhole, happened, later } = setUp({ held: 10 });
        state.countsMore = 3;

        await happened('window-returned', 'platform');
        expect(readLikedWhole).toHaveBeenCalledTimes(1);

        await later();
        await later('home-entered');
        expect(readLikedWhole).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenLastCalledWith('[Like] platform: home-entered: the liked list counts 13, 10 held and 3 ahead at the last read: the liked songs are not read');

        // A like made in the platform's own app is still seen.
        state.onPlatform = 11;
        await later();
        expect(readLikedWhole).toHaveBeenCalledTimes(2);
    });

    // A song pressed in Folia whose request is not settled keeps what Folia holds, so the read
    // leaves Folia one short of the platform's list. That difference is the press, not a lasting one.
    it('writes no difference after a read that did not leave Folia holding the platform\'s list, and reads again', async () => {
        const { state, readLikedWhole, happened, later } = setUp({ held: 3, onPlatform: 4 });
        readLikedWhole.mockImplementationOnce(async () => false);

        await happened('home-entered', 'platform');
        expect(readLikedWhole).toHaveBeenCalledTimes(1);

        // The press settles, and one more song is liked in the platform's own app.
        state.held = 4;
        state.onPlatform = 5;
        await later();

        expect(readLikedWhole).toHaveBeenCalledTimes(2);
        expect(state.held).toBe(5);
    });

    it('reads again at the next moment after a read the rule refused', async () => {
        const { state, readLikedWhole, happened, later } = setUp({ held: 3, onPlatform: 2 });
        readLikedWhole.mockImplementationOnce(async () => false);

        await happened('window-returned', 'platform');
        await later();

        expect(readLikedWhole).toHaveBeenCalledTimes(2);
        expect(state.held).toBe(2);
    });

    it('tells the read that the platform counts its list as empty, and reads no more once the list is taken', async () => {
        const { state, readLikedWhole, happened, later } = setUp({ held: 3, onPlatform: 0 });

        await happened('window-returned', 'platform');
        expect(readLikedWhole).toHaveBeenCalledWith('platform', 'user', true);
        expect(state.held).toBe(0);

        await later();
        await later('home-entered');
        expect(readLikedWhole).toHaveBeenCalledTimes(1);
    });

    it('gives a count that never answers ' + ANSWER_LIMIT_MS / 1000 + ' s, then checks again at the next moment', async () => {
        vi.useFakeTimers();
        try {
            const { state, likedCount, happened, later } = setUp({ held: 10 });
            likedCount.mockImplementationOnce(() => new Promise<number | null>(() => {}));

            const check = happened('window-returned', 'platform');
            await vi.advanceTimersByTimeAsync(ANSWER_LIMIT_MS);
            await check;
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('the count of the liked list could not be asked for'));

            state.time += ANSWER_LIMIT_MS;
            await later();
            expect(likedCount).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('starts no read for a like made in Folia: the count and the ids held move alike', async () => {
        const { state, readLikedWhole, happened, later } = setUp({ held: 10 });
        await happened('window-returned', 'platform');

        state.held = 11;
        state.onPlatform = 11;
        await later();

        expect(readLikedWhole).not.toHaveBeenCalled();
    });

    it('asks nothing when nobody is signed in', async () => {
        const { likedCount, happened } = setUp({ userId: null });

        await happened('window-returned', 'platform');

        expect(likedCount).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });

    it('makes one check of a burst of moments, and the next once the interval has passed', async () => {
        const { state, likedCount, happened } = setUp();

        await happened('window-returned', 'platform');
        await happened('window-returned', 'platform');
        state.time += CHECK_INTERVAL_MS - 1;
        await happened('home-entered', 'platform');
        expect(likedCount).toHaveBeenCalledTimes(1);

        state.time += 1;
        await happened('home-entered', 'platform');
        expect(likedCount).toHaveBeenCalledTimes(2);
    });

    it('never runs two checks of a platform at once, however long the first takes', async () => {
        const { state, likedCount, readLikedWhole, happened } = setUp({ held: 10, onPlatform: 11 });
        let endRead!: () => void;
        const reading = new Promise<void>(begun => {
            readLikedWhole.mockImplementationOnce(() => {
                begun();
                return new Promise<boolean>(resolve => { endRead = () => resolve(true); });
            });
        });

        const first = happened('window-returned', 'platform');
        await reading;
        state.time += CHECK_INTERVAL_MS * 3;
        await happened('home-entered', 'platform');
        expect(likedCount).toHaveBeenCalledTimes(1);

        endRead();
        await first;
        await happened('home-entered', 'platform');
        expect(likedCount).toHaveBeenCalledTimes(2);
    });

    it('checks another platform while one is being checked', async () => {
        const { likedCount, happened } = setUp();
        likedCount.mockImplementationOnce(() => new Promise<number | null>(() => {}));

        void happened('window-returned', 'platform');
        await happened('window-returned', 'other');

        expect(likedCount.mock.calls).toEqual([['platform', 'user'], ['other', 'user']]);
    });

    it('asks nothing of a platform whose adapter has no count, reads nothing, and says so once a burst', async () => {
        const { readLikedWhole, happened } = setUp({ counts: false, held: 10, onPlatform: 11 });

        await happened('window-returned', 'platform');
        await happened('window-returned', 'platform');

        expect(readLikedWhole).not.toHaveBeenCalled();
        expect(log.mock.calls).toEqual([
            ['[Like] platform: window-returned: its adapter has no count of the liked list short of reading it: the liked songs are not read'],
        ]);
    });

    it('reads nothing when the platform gives no count', async () => {
        const { likedCount, readLikedWhole, happened } = setUp({ held: 10, onPlatform: 11 });
        likedCount.mockResolvedValueOnce(null);

        await happened('window-returned', 'platform');

        expect(readLikedWhole).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith('[Like] platform: window-returned: the platform gave no count of the liked list: the liked songs are not read');
    });

    it('reads nothing when the count cannot be asked for, and checks again at the next moment', async () => {
        const { likedCount, readLikedWhole, happened, later } = setUp({ held: 10, onPlatform: 11 });
        likedCount.mockRejectedValueOnce(new Error('offline'));

        await happened('window-returned', 'platform');
        expect(readLikedWhole).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith('[Like] platform: window-returned: the count of the liked list could not be asked for, they stay as they were: offline');

        await later();
        expect(readLikedWhole).toHaveBeenCalledTimes(1);
    });

    it('reads again at the next moment after a read that failed', async () => {
        const { readLikedWhole, happened, later } = setUp({ held: 10, onPlatform: 11 });
        readLikedWhole.mockRejectedValueOnce(new Error('offline'));

        await happened('window-returned', 'platform');
        expect(warn).toHaveBeenCalledWith('[Like] platform: window-returned: the liked songs could not be read, they stay as they were: offline');

        await later();
        expect(readLikedWhole).toHaveBeenCalledTimes(2);
    });

    it('reads nothing for an account that left while the count was asked for', async () => {
        const { state, likedCount, readLikedWhole, happened } = setUp({ held: 10, onPlatform: 11 });
        likedCount.mockImplementationOnce(async () => {
            state.userId = 'another';
            return 11;
        });

        await happened('window-returned', 'platform');

        expect(readLikedWhole).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledWith('[Like] platform: window-returned: its account left while the count was asked for: the liked songs are not read');
    });

    it('holds what one account\'s count was ahead by for that account alone', async () => {
        const { state, readLikedWhole, happened, later } = setUp({ held: 10 });
        state.countsMore = 3;
        await happened('window-returned', 'platform');
        expect(readLikedWhole).toHaveBeenCalledTimes(1);

        // Another account, whose count is the number of its ids.
        state.userId = 'another';
        state.countsMore = 0;
        await later();
        expect(readLikedWhole).toHaveBeenCalledTimes(1);
    });
});
