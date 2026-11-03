import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OmniCollection } from '@/types/onlineMusic';
import {
    askCollectionSaved,
    collectionSaveKey,
    collectionSaveMark,
    collectionSaveReadIsCurrent,
    collectionSaveUnderWay,
    watchCollectionSaves,
} from '@/library/core/collection/mutations/collectionSaves.service';

// test/unit/library/core/collectionSaves.test.ts — the requests behind an album's or a
// playlist's star: what is sent when it is pressed again before the platform has answered,
// and what a request that fails leaves behind. (Moved here with the requests themselves from
// test/unit/gridView/useCollectionSaveToggle.test.ts; the platform is now the `send` each
// request is given, and the press that started a request is told how it ended.)

const subscribe = vi.fn();
const sendFor = (collection: OmniCollection) => (next: boolean) => subscribe(collection, next);
const album: OmniCollection = { providerId: 'ytm', id: 'OLAK5uy_album', name: 'An album', type: 'album' };
const KEY = collectionSaveKey(album);
const ask = (wanted: boolean, onChanged: (saved: boolean) => void, collection = album) => (
    askCollectionSaved(collectionSaveKey(collection), wanted, { send: sendFor(collection), onChanged })
);
const pending = () => {
    let settle!: { resolve: () => void; reject: (error: unknown) => void };
    const promise = new Promise<void>((resolve, reject) => { settle = { resolve, reject }; });
    return { promise, ...settle };
};

describe('collection save requests', () => {
    const settled = vi.fn();
    const changed = vi.fn();
    let stop = () => {};

    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        stop();
        stop = watchCollectionSaves(settled);
    });

    it('sends the change behind the star and reports once the platform has made it', async () => {
        const request = pending();
        subscribe.mockReturnValueOnce(request.promise);
        const outcome = ask(true, changed);
        // Under way: the star's state is known here, and nothing has been reported.
        expect(collectionSaveUnderWay(KEY)).toBe(true);
        expect(subscribe.mock.calls).toEqual([[album, true]]);
        expect(changed).not.toHaveBeenCalled();
        request.resolve();
        await expect(outcome).resolves.toEqual({ failed: false });
        expect(settled.mock.calls).toEqual([[KEY, true]]);
        expect(changed.mock.calls).toEqual([[true]]);
        expect(collectionSaveUnderWay(KEY)).toBeUndefined();
    });

    it('follows a star pressed again before the answer with a second request, one at a time', async () => {
        const first = pending();
        const second = pending();
        subscribe.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        const later = vi.fn();
        const outcome = ask(true, changed);
        // A press that joins a request under way is answered at once.
        await expect(ask(false, later)).resolves.toEqual({ failed: false });
        expect(collectionSaveUnderWay(KEY)).toBe(false);
        // The second change waits for the first to be answered.
        expect(subscribe).toHaveBeenCalledTimes(1);
        first.resolve();
        await vi.waitFor(() => expect(subscribe.mock.calls).toEqual([[album, true], [album, false]]));
        expect(settled).not.toHaveBeenCalled();
        second.resolve();
        await expect(outcome).resolves.toEqual({ failed: false });
        expect(settled.mock.calls).toEqual([[KEY, false]]);
        // Each change made is told to whoever pressed last.
        expect(changed).not.toHaveBeenCalled();
        expect(later.mock.calls).toEqual([[true], [false]]);
    });

    it('sends nothing more for a star pressed back to what is being asked for', async () => {
        const request = pending();
        subscribe.mockReturnValueOnce(request.promise);
        const outcome = ask(true, changed);
        void ask(false, changed);
        void ask(true, changed);
        request.resolve();
        await outcome;
        expect(settled.mock.calls).toEqual([[KEY, true]]);
        expect(subscribe).toHaveBeenCalledTimes(1);
    });

    it.each([[true, false], [false, true]])(
        'puts the star back and tells the press when the platform refuses (wanted saved: %s)', async (wanted, left) => {
            subscribe.mockRejectedValueOnce(new Error('YouTube Music did not change the list'));
            await expect(ask(wanted, changed)).resolves.toEqual({ failed: true, saved: left });
            expect(settled.mock.calls).toEqual([[KEY, left]]);
            expect(changed).not.toHaveBeenCalled();
            expect(collectionSaveUnderWay(KEY)).toBeUndefined();
            // The next press starts afresh.
            subscribe.mockResolvedValueOnce(undefined);
            await ask(wanted, changed);
            expect(settled.mock.calls).toEqual([[KEY, left], [KEY, wanted]]);
        },
    );

    it('keeps the change that was made when the one after it is refused', async () => {
        const first = pending();
        subscribe.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('refused'));
        const outcome = ask(true, changed);
        void ask(false, changed);
        first.resolve();
        await expect(outcome).resolves.toEqual({ failed: true, saved: true });
        expect(settled.mock.calls).toEqual([[KEY, true]]);
        expect(changed.mock.calls).toEqual([[true]]);
    });

    it('says nothing of a request that failed when the star was pressed back meanwhile', async () => {
        const first = pending();
        subscribe.mockReturnValueOnce(first.promise);
        const outcome = ask(true, changed);
        void ask(false, changed);
        first.reject(new Error('refused'));
        // Not saved is what the platform holds and what was last asked for.
        await expect(outcome).resolves.toEqual({ failed: false });
        expect(settled.mock.calls).toEqual([[KEY, false]]);
        expect(subscribe).toHaveBeenCalledTimes(1);
        expect(changed).not.toHaveBeenCalled();
    });

    it('takes an answer to "is it saved" only when no request has run since it was asked', async () => {
        const other = collectionSaveKey({ ...album, id: 'OLAK5uy_other' });
        const [before, otherBefore] = [collectionSaveMark(KEY), collectionSaveMark(other)];
        expect(collectionSaveReadIsCurrent(KEY, before)).toBe(true);
        const request = pending();
        subscribe.mockReturnValueOnce(request.promise);
        const outcome = ask(true, changed);
        // Asked before the request, or in the middle of it: left aside while it runs, and after it.
        const during = collectionSaveMark(KEY);
        expect(collectionSaveReadIsCurrent(KEY, before)).toBe(false);
        request.resolve();
        await outcome;
        expect(collectionSaveReadIsCurrent(KEY, before)).toBe(false);
        expect(collectionSaveReadIsCurrent(KEY, during)).toBe(false);
        // Asked after it: taken. Another collection's answers were never touched.
        expect(collectionSaveReadIsCurrent(KEY, collectionSaveMark(KEY))).toBe(true);
        expect(collectionSaveReadIsCurrent(other, otherBefore)).toBe(true);
    });

    it('keeps the requests of two collections apart', async () => {
        const playlist: OmniCollection = { providerId: 'ytm', id: 'OLAK5uy_album', name: 'A playlist', type: 'playlist' };
        const first = pending();
        subscribe.mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined);
        const outcome = ask(true, changed);
        // The second collection's request does not wait for the first's.
        await ask(false, changed, playlist);
        expect(subscribe.mock.calls).toEqual([[album, true], [playlist, false]]);
        expect(settled.mock.calls).toEqual([[collectionSaveKey(playlist), false]]);
        expect(collectionSaveUnderWay(KEY)).toBe(true);
        first.resolve();
        await outcome;
        expect(settled).toHaveBeenCalledTimes(2);
    });
});
