import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OmniExploreItem, OmniExploreSection } from '@/types/onlineMusic';
import { inKeptOrder, noteCollectionSaved, resetExploreMemory, withoutTakenOut } from '@/components/app/home/explore/exploreFeedMemory';

// test/unit/explore/exploreFeedMemory.test.ts — what the explore tab remembers between sessions:
// the order of a page's sections, and the collections taken out of the library.

const DAY_MS = 24 * 60 * 60 * 1000;
const titled = (...titles: string[]): OmniExploreSection[] => titles.map((title, index) => ({ id: `${title}#${index}`, title, items: [] }));
const titlesOf = (sections: OmniExploreSection[]) => sections.map(section => section.title);
const card = (id: string, type = 'album', providerId = 'ytm'): OmniExploreItem => ({ kind: 'collection', collection: { providerId, id, type, name: id } });
const idsOf = (items: OmniExploreItem[]) => items.map(item => (item.kind === 'collection' ? item.collection.id : 'song'));

// A storage that lasts for one test, as the browser's lasts from session to session.
const fakeStorage = () => {
    const kept = new Map<string, string>();
    const storage = { getItem: vi.fn((key: string) => kept.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { kept.set(key, value); }) };
    vi.stubGlobal('localStorage', storage);
    return storage;
};

describe('explore feed memory', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-07T00:00:00Z'));
        resetExploreMemory();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('hands the sections of a page back in the order they were first met, new headings after the known', () => {
        expect(titlesOf(inKeptOrder('ytm:me', titled('recent', 'mixes', 'artists')))).toEqual(['recent', 'mixes', 'artists']);
        expect(titlesOf(inKeptOrder('ytm:me', titled('mixes', 'recent')))).toEqual(['recent', 'mixes']);
        expect(titlesOf(inKeptOrder('ytm:me', titled('new', 'artists', 'newer', 'recent')))).toEqual(['recent', 'artists', 'new', 'newer']);
        // The new ones are known from then on, in the order they came.
        expect(titlesOf(inKeptOrder('ytm:me', titled('newer', 'new', 'mixes')))).toEqual(['mixes', 'new', 'newer']);
        // Sections of one heading keep the order they came in; another page has an order of its own.
        expect(inKeptOrder('ytm:me', titled('mixes', 'recent', 'mixes')).map(section => section.id)).toEqual(['recent#1', 'mixes#0', 'mixes#2']);
        expect(titlesOf(inKeptOrder('ytm:other', titled('mixes', 'recent')))).toEqual(['mixes', 'recent']);
    });

    it('remembers the order from one session to the next, and for the session where nothing can be stored', () => {
        const storage = fakeStorage();
        inKeptOrder('ytm:me', titled('recent', 'mixes'));
        resetExploreMemory();
        expect(titlesOf(inKeptOrder('ytm:me', titled('mixes', 'recent')))).toEqual(['recent', 'mixes']);

        // A storage that refuses, and one that holds something else, cost only what was stored.
        storage.setItem.mockImplementation(() => { throw new Error('QuotaExceededError'); });
        expect(titlesOf(inKeptOrder('ytm:me', titled('late', 'mixes')))).toEqual(['mixes', 'late']);
        expect(titlesOf(inKeptOrder('ytm:me', titled('late', 'recent')))).toEqual(['recent', 'late']);
        for (const stored of ['not json', '[1]', '{"orders":{"ytm:me":"recent"},"takenOut":[1]}', '{"orders":{"ytm:me":[null,["recent"],[7,7]]}}']) {
            storage.getItem.mockReturnValue(stored);
            resetExploreMemory();
            expect(titlesOf(inKeptOrder('ytm:me', titled('mixes', 'recent')))).toEqual(['mixes', 'recent']);
        }
        // What has the shape is used, beside what has not.
        storage.getItem.mockReturnValue('{"orders":{"ytm:me":[null,["recent",1]]},"takenOut":{"ytm:album:a":"x","ytm:album:b":' + Date.now() + ',"ytm:album:c":9e15}}');
        resetExploreMemory();
        expect(titlesOf(inKeptOrder('ytm:me', titled('mixes', 'recent')))).toEqual(['recent', 'mixes']);
        // A time in the future is of a clock that was wrong, and holds nothing.
        expect(idsOf(withoutTakenOut([card('a'), card('b'), card('c')]))).toEqual(['a', 'c']);
    });

    it('forgets the heading seen longest ago once a page has more than two hundred', () => {
        inKeptOrder('ytm:me', titled('recent', 'once'));
        vi.advanceTimersByTime(DAY_MS);
        const passing = Array.from({ length: 199 }, (_, index) => `passing ${index}`);
        // `recent` is seen again with them; `once` is not, and is the one that goes.
        inKeptOrder('ytm:me', titled('recent', ...passing));
        vi.advanceTimersByTime(DAY_MS);
        // It comes back as a heading never met: after the known ones, not second as it was.
        expect(titlesOf(inKeptOrder('ytm:me', titled('once', 'passing 0', 'recent')))).toEqual(['recent', 'passing 0', 'once']);
        // That made one too many again. The rest were all seen at the same time: of those the
        // one furthest down went, and the ones before it kept their places.
        expect(titlesOf(inKeptOrder('ytm:me', titled('passing 198', 'once')))).toEqual(['once', 'passing 198']);
        expect(titlesOf(inKeptOrder('ytm:me', titled('passing 2', 'passing 1')))).toEqual(['passing 1', 'passing 2']);
    });

    it('leaves out a collection taken out of the library for a week, or until it is saved again', () => {
        const items = [card('a'), card('b'), card('a', 'playlist'), card('a', 'album', 'netease'), { kind: 'song', song: { id: 'a' } } as OmniExploreItem];
        expect(withoutTakenOut(items)).toHaveLength(5);
        noteCollectionSaved({ providerId: 'ytm', type: 'album', id: 'a' }, false);
        // Only that collection: not one of another type or provider with its id, and no song.
        expect(idsOf(withoutTakenOut(items))).toEqual(['b', 'a', 'a', 'song']);
        vi.advanceTimersByTime(7 * DAY_MS - 1);
        expect(withoutTakenOut(items)).toHaveLength(4);
        vi.advanceTimersByTime(1);
        expect(withoutTakenOut(items)).toHaveLength(5);

        noteCollectionSaved({ providerId: 'ytm', type: 'album', id: 'b' }, false);
        expect(idsOf(withoutTakenOut(items))).toEqual(['a', 'a', 'a', 'song']);
        noteCollectionSaved({ providerId: 'ytm', type: 'album', id: 'b' }, true);
        expect(withoutTakenOut(items)).toHaveLength(5);
    });

    it('remembers what was taken out from one session to the next, without the ones whose week is over', () => {
        const storage = fakeStorage();
        noteCollectionSaved({ providerId: 'ytm', type: 'album', id: 'old' }, false);
        vi.advanceTimersByTime(7 * DAY_MS);
        noteCollectionSaved({ providerId: 'ytm', type: 'album', id: 'a' }, false);
        resetExploreMemory();
        expect(idsOf(withoutTakenOut([card('a'), card('old')]))).toEqual(['old']);
        expect(JSON.parse(storage.setItem.mock.calls.at(-1)![1]).takenOut).toEqual({ 'ytm:album:a': Date.now() });
    });
});
