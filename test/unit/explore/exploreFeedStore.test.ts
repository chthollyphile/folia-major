import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OmniExploreItem, OmniExploreSection } from '@/types/onlineMusic';

// test/unit/explore/exploreFeedStore.test.ts — the page behind the explore tab: what is kept,
// what an answer may still change, and what a failed read leaves on screen.

const omni = vi.hoisted(() => ({ getExploreFeed: vi.fn(), getExploreSectionItems: vi.fn() }));
vi.mock('@/services/onlineMusic/omni', () => ({ omni }));
import { exploreScroll, useExploreFeedStore } from '@/stores/useExploreFeedStore';
import { resetExploreMemory } from '@/components/app/home/explore/exploreFeedMemory';

const item = (id: string): OmniExploreItem => ({ kind: 'collection', collection: { providerId: 'ytm', id, name: id, type: 'playlist' } });
const section = (id: string, extra: Partial<OmniExploreSection> = {}): OmniExploreSection => ({ id, title: id, items: [item(`${id}-1`)], ...extra });
const feed = () => useExploreFeedStore.getState().feed!;
const store = () => useExploreFeedStore.getState();
const pending = <T,>() => {
    let settle!: { resolve: (value: T) => void; reject: (error: unknown) => void };
    const promise = new Promise<T>((resolve, reject) => { settle = { resolve, reject }; });
    return { promise, ...settle };
};
const overtaken = () => new DOMException('Active online provider changed', 'AbortError');

describe('explore feed store', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, 'log').mockImplementation(() => {});
        store().clear();
        resetExploreMemory();
    });

    it('reads a page once for a key and keeps it until asked to refresh', async () => {
        omni.getExploreFeed.mockResolvedValue({ sections: [section('a')], nextCursor: 'next' });
        store().show('ytm:me:en');
        expect(feed()).toMatchObject({ status: 'loading', sections: [] });
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        expect(feed()).toMatchObject({ sections: [{ id: 'a' }], nextCursor: 'next', loadingMore: false, loadingSectionIds: [] });
        store().show('ytm:me:en');
        expect(omni.getExploreFeed).toHaveBeenCalledExactlyOnceWith(undefined, undefined);

        // The one section has nothing further, so a refresh reads the page anew; the page stays on screen until it has.
        const firstRead = feed().read;
        const next = pending<{ sections: OmniExploreSection[] }>();
        omni.getExploreFeed.mockReturnValueOnce(next.promise);
        store().refresh();
        expect(feed()).toMatchObject({ read: firstRead, status: 'ready', refreshing: true, sections: [{ id: 'a' }], nextCursor: 'next' });
        // No section leaves the page for it: the one the new read does not have stays, and the one it has joins.
        next.resolve({ sections: [section('b')] });
        await vi.waitFor(() => expect(feed().sections.map(shown => shown.id)).toEqual(['a', 'b']));
        expect(feed()).toMatchObject({ status: 'ready', refreshing: false, refreshFailed: false });
        expect(feed().read).toBeGreaterThan(firstRead);
        // The list goes on from the page just read, which has no further one.
        expect(feed().nextCursor).toBeUndefined();
    });

    // A provider may make sections out of what the listener played (OnlineExploreProvider).
    it('hands the songs the listener played to every read of the page from its start, and to no further page', async () => {
        const played = [{ id: 's1', name: 'One' }] as UnifiedSong[];
        const playedSince = [{ id: 's2', name: 'Two' }] as UnifiedSong[];
        omni.getExploreFeed.mockResolvedValue({ sections: [section('a')], nextCursor: 'page-2' });
        store().show('ytm:me:en', played);
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        expect(omni.getExploreFeed).toHaveBeenLastCalledWith(undefined, played);
        await store().loadMore();
        expect(omni.getExploreFeed).toHaveBeenLastCalledWith('page-2');
        // The one section has nothing further, so a refresh reads the page anew, as far as it was read.
        store().refresh(playedSince);
        await vi.waitFor(() => expect(feed().refreshing).toBe(false));
        expect(omni.getExploreFeed.mock.calls.slice(2)).toEqual([[undefined, playedSince], ['page-2']]);
    });

    const titled =(title: string, ids: string[], extra: Partial<OmniExploreSection> = {}): OmniExploreSection => (
        { id: `${title}-${Math.random()}`, title, items: ids.map(item), ...extra }
    );
    const shownIn = (title: string) => feed().sections.find(shown => shown.title === title)!.items.map(entry => (entry.kind === 'collection' ? entry.collection.id : ''));
    const refreshed = async () => {
        store().refresh();
        await vi.waitFor(() => expect(feed().refreshing).toBe(false));
    };

    it('shows, on a refresh, the entries that follow the ones shown, and reads the page anew only once every section has shown its last', async () => {
        const page = () => ({ sections: [titled('picks', ['p1', 'p2'], { moreCursor: 'picks-3' }), titled('fixed', ['f1', 'f2'])] });
        omni.getExploreFeed.mockImplementation(async () => page());
        omni.getExploreSectionItems.mockImplementation(async (cursor: string) => ({
            'picks-3': { items: [item('p3'), item('p4')], moreCursor: 'picks-5' },
            'picks-5': { items: [item('p5'), item('p1')] },
        })[cursor]);
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const [picks, fixed] = feed().sections.map(shown => shown.id);
        expect(feed().kept[picks].batch).toBe(0);

        // The section with further entries shows those, and is the section it was. The page is not read for it.
        await refreshed();
        expect(shownIn('picks')).toEqual(['p3', 'p4']);
        expect(feed().sections.map(shown => shown.id)).toEqual([picks, fixed]);
        expect(feed().kept[picks].batch).toBe(1);
        expect(omni.getExploreSectionItems).toHaveBeenCalledExactlyOnceWith('picks-3');
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(1);
        // The one that has no others stays as it is: nothing is exchanged in it.
        expect(shownIn('fixed')).toEqual(['f1', 'f2']);
        expect(feed().kept[fixed].batch).toBe(0);

        // On from there, by the token the further items came with; an entry the section showed before is not shown again in the round.
        await refreshed();
        expect(shownIn('picks')).toEqual(['p5']);
        expect(feed().sections.find(shown => shown.id === picks)!.moreCursor).toBeUndefined();
        expect(omni.getExploreSectionItems).toHaveBeenLastCalledWith('picks-5');
        expect(feed().kept[picks].batch).toBe(2);
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(1);

        // No section has anything the listener was not shown: the page is read anew, and the section starts over with that read's entries and token.
        await refreshed();
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(2);
        expect(shownIn('picks')).toEqual(['p1', 'p2']);
        expect(feed().kept[picks]).toMatchObject({ batch: 3, cursor: 'picks-3', from: 0, wentRound: false });
        expect(omni.getExploreSectionItems).toHaveBeenCalledTimes(2);
        expect(feed().kept[fixed].batch).toBe(0);
    });

    // Such a section is known by no heading (ProviderExploreSection.changesWithRead): kept beside the new one, the page would grow with every read anew.
    it('gives the place of a section the provider makes up anew for every read to the one the page read anew has, and adds only those beyond', async () => {
        const madeAnew = (title: string, ids: string[]): OmniExploreSection => ({ ...titled(title, ids), changesWithRead: true });
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('fixed', ['f1']), madeAnew('like A', ['a1', 'a2']), titled('other', ['o1'])] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const ids = feed().sections.map(shown => shown.id);
        // No section has further entries, so a refresh reads the page anew.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('fixed', ['f1']), madeAnew('like B', ['b1', 'b2']), titled('other', ['o1']), madeAnew('like C', ['c1'])] });
        await refreshed();
        expect(feed().sections.map(shown => shown.title)).toEqual(['fixed', 'like B', 'other', 'like C']);
        expect(feed().sections.slice(0, 3).map(shown => shown.id)).toEqual(ids);
        expect(shownIn('like B')).toEqual(['b1', 'b2']);
        expect(feed().sections.map(shown => Boolean(shown.changesWithRead))).toEqual([false, true, false, true]);
        // The read after that has one fewer of them: the place it has none for keeps what it showed.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('fixed', ['f1']), madeAnew('like D', ['d1']), titled('other', ['o1'])] });
        await refreshed();
        expect(feed().sections.map(shown => shown.title)).toEqual(['fixed', 'like D', 'other', 'like C']);
        expect(shownIn('like D')).toEqual(['d1']);
    });

    it('reads the page anew on a refresh where no section has further entries, and shows what the provider has under each heading now', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('daily', ['d1', 'd2', 'd3']), titled('weekly', ['w1'])] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const [daily, weekly] = feed().sections.map(shown => shown.id);
        // A provider that makes its page up anew for every read: other entries under one heading, the same under the other.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('weekly', ['w1']), titled('daily', ['d4', 'd1', 'd5'], { moreCursor: 'daily-more-2' })] });
        await refreshed();
        expect(shownIn('daily')).toEqual(['d4', 'd1', 'd5']);
        expect(feed().sections.map(shown => shown.id)).toEqual([daily, weekly]);
        expect(feed().sections[0]).toMatchObject({ id: daily, moreCursor: 'daily-more-2' });
        expect(feed().kept[daily]).toMatchObject({ batch: 1, cursor: 'daily-more-2', from: 0 });
        expect(feed().kept[weekly].batch).toBe(0);
        expect(omni.getExploreSectionItems).not.toHaveBeenCalled();
        // Now a section has further entries: those are shown, and the page is not read.
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('d7')] });
        await refreshed();
        expect(shownIn('daily')).toEqual(['d7']);
        expect(omni.getExploreSectionItems).toHaveBeenCalledExactlyOnceWith('daily-more-2');
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(2);
    });

    // A provider whose page changes only by being read anew says so with the page (ProviderExplorePage.refreshReadsAnew).
    it('reads the page anew on every refresh where the provider said so with the page, although a section has a cursor, and leaves the cursor to "more"', async () => {
        let reads = 0;
        const page = (declared: boolean) => {
            reads += 1;
            return {
                sections: [
                    { id: 'picks', title: 'picks', items: [item(`p${reads}-1`), item(`p${reads}-2`)], moreCursor: `picks-${reads}` },
                    { id: 'fixed', title: 'fixed', items: [item('f1')] },
                ],
                ...(declared ? { refreshReadsAnew: true } : {}),
            };
        };
        omni.getExploreFeed.mockImplementation(async () => page(true));
        omni.getExploreSectionItems.mockImplementation(async (cursor: string) => ({ items: [item(`${cursor}-further`)] }));
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        expect(feed().refreshReadsAnew).toBe(true);

        // "More" goes through the section's cursor, as it does under any provider.
        await store().loadMoreOf('picks');
        expect(shownIn('picks')).toEqual(['p1-1', 'p1-2', 'picks-1-further']);
        expect(omni.getExploreSectionItems).toHaveBeenCalledExactlyOnceWith('picks-1');

        // A refresh asks no section to go on: the page is read anew, and each section takes that read's entries and cursor.
        await refreshed();
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(2);
        expect(shownIn('picks')).toEqual(['p2-1', 'p2-2']);
        expect(feed().kept.picks).toMatchObject({ batch: 1, cursor: 'picks-2', from: 0 });
        expect(feed().kept.fixed.batch).toBe(0);
        await refreshed();
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(3);
        expect(shownIn('picks')).toEqual(['p3-1', 'p3-2']);
        expect(omni.getExploreSectionItems).toHaveBeenCalledTimes(1);

        // It holds for as long as the last read from the start says it: after one that does not, a refresh goes on through the cursor first.
        omni.getExploreFeed.mockImplementation(async () => page(false));
        await refreshed();
        expect(feed().refreshReadsAnew).toBeUndefined();
        expect(shownIn('picks')).toEqual(['p4-1', 'p4-2']);
        await refreshed();
        expect(omni.getExploreSectionItems).toHaveBeenLastCalledWith('picks-4');
        expect(shownIn('picks')).toEqual(['picks-4-further']);
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(4);
    });

    it('does not take a section whose further items could not be read to have shown its last', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('picks', ['p1'], { moreCursor: 'picks-2' }), titled('other', ['o1'], { moreCursor: 'other-2' })] });
        let refusals = 1;
        omni.getExploreSectionItems.mockImplementation(async (cursor: string) => {
            if (cursor === 'picks-2' && refusals > 0) { refusals -= 1; throw new Error('offline'); }
            return ({ 'picks-2': { items: [item('p2')] }, 'other-2': { items: [item('o2')] } })[cursor];
        });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const [picks] = feed().sections.map(shown => shown.id);
        // It stays where it stands, with its cursor, while the other one goes on.
        await refreshed();
        expect([shownIn('picks'), shownIn('other')]).toEqual([['p1'], ['o2']]);
        expect(feed().kept[picks]).toMatchObject({ batch: 0, cursor: 'picks-2', wentRound: false });
        // The next time its further entry can be read. It is one the listener was not shown: the page is not read instead.
        await refreshed();
        expect(shownIn('picks')).toEqual(['p2']);
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('ends a section at a token that names itself, instead of asking with it for good', async () => {
        omni.getExploreFeed.mockImplementation(async () => ({ sections: [titled('picks', ['p1'], { moreCursor: 'loop' })] }));
        omni.getExploreSectionItems.mockResolvedValue({ items: [item('p1')], moreCursor: 'loop' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        // Nothing is ahead of it: the page is read anew.
        await refreshed();
        expect(omni.getExploreSectionItems).toHaveBeenCalledTimes(1);
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(2);
    });

    it('counts the pages a read of the page anew got to, where a further one could not be read', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('first', ['a1'])], nextCursor: 'page-2' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('second', ['b1'])], nextCursor: 'page-3' });
        await store().loadMore();
        expect(feed().pages).toBe(2);
        // Read anew: its first page arrives, its second cannot be read. The refresh did not fail, and the list goes on from that page.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('first', ['a2'])], nextCursor: 'new-page-2' }).mockRejectedValueOnce(new Error('refused'));
        await refreshed();
        expect(shownIn('first')).toEqual(['a2']);
        expect(feed()).toMatchObject({ refreshFailed: false, nextCursor: 'new-page-2', pages: 1 });
        expect(warn).toHaveBeenLastCalledWith('[Explore] Further sections could not be read: refused');
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('second', ['b1'])] });
        await store().loadMore();
        expect(omni.getExploreFeed).toHaveBeenLastCalledWith('new-page-2');
        expect(feed().sections.map(shown => shown.title)).toEqual(['first', 'second']);
        expect(feed().pages).toBe(2);
        warn.mockRestore();
    });

    it('leaves a section as it is when its further items cannot be read and the page it is read anew with has the same entries', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        // (Every read of the page names the section's further items with another token.)
        let pages = 0;
        omni.getExploreFeed.mockImplementation(async () => ({ sections: [titled('picks', ['p1'], { moreCursor: `picks-more-${pages += 1}` })] }));
        omni.getExploreSectionItems.mockRejectedValueOnce(new Error('offline'));
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const [picks] = feed().sections.map(shown => shown.id);
        await refreshed();
        expect(omni.getExploreSectionItems).toHaveBeenLastCalledWith('picks-more-1');
        // Nothing further could be shown, so the page was read anew. The entries shown are the ones it starts
        // over with: nothing was exchanged. What it asks with from now on is the token of that read: the one
        // that failed went with the read before.
        expect(shownIn('picks')).toEqual(['p1']);
        expect(feed()).toMatchObject({ refreshFailed: false, kept: { [picks]: { batch: 0, cursor: 'picks-more-2' } } });
        expect(warn).toHaveBeenLastCalledWith('[Explore] Further items of a section could not be read: offline');
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('p2')] });
        await refreshed();
        expect(omni.getExploreSectionItems).toHaveBeenLastCalledWith('picks-more-2');
        expect(shownIn('picks')).toEqual(['p2']);
    });

    it('asks at most three sections for their further items at a time', async () => {
        const names = ['a', 'b', 'c', 'd', 'e'];
        omni.getExploreFeed.mockImplementation(async () => ({ sections: names.map(name => titled(name, [`${name}1`], { moreCursor: `${name}-more` })) }));
        const asked: Array<ReturnType<typeof pending<{ items: OmniExploreItem[] }>>> = [];
        omni.getExploreSectionItems.mockImplementation(() => { asked.push(pending()); return asked.at(-1)!.promise; });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        store().refresh();
        await vi.waitFor(() => expect(asked).toHaveLength(3));
        await Promise.resolve();
        expect(asked).toHaveLength(3);
        asked[0].resolve({ items: [item('a2')] });
        await vi.waitFor(() => expect(asked).toHaveLength(4));
        asked.slice(1).forEach(answer => answer.resolve({ items: [] }));
        await vi.waitFor(() => expect(asked).toHaveLength(5));
        asked[4].resolve({ items: [item('e2')] });
        await vi.waitFor(() => expect(feed().refreshing).toBe(false));
        expect(names.map(name => shownIn(name))).toEqual([['a2'], ['b1'], ['c1'], ['d1'], ['e2']]);
    });

    it('leaves the further sections of the page where they are through a refresh, and goes on from where the list had got to', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('first', ['a1'])], nextCursor: 'page-2' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('second', ['b1', 'b2'], { moreCursor: 'second-more' })], nextCursor: 'page-3' });
        await store().loadMore();
        const ids = feed().sections.map(shown => shown.id);
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('b3')] });
        await refreshed();
        expect(feed().sections.map(shown => shown.id)).toEqual(ids);
        expect(shownIn('second')).toEqual(['b3']);
        // The page was not read for it, and its cursors stand.
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(2);
        expect(feed()).toMatchObject({ nextCursor: 'page-3', pages: 2 });
        // A section of a further page that the page shows already is not put on it twice; another one of its heading is.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('second', ['b2', 'b1']), titled('second', ['x1', 'x2']), titled('third', ['c1'])] });
        await store().loadMore();
        expect(feed().sections.map(shown => shown.title)).toEqual(['first', 'second', 'second', 'third']);
        expect(feed().sections[2].items).toEqual([item('x1'), item('x2')]);
        expect(feed().pages).toBe(3);
    });

    it('reads the page anew as far as it had been read, and keeps no cursor of the read before', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('first', ['a1'])], nextCursor: 'page-2' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        omni.getExploreFeed.mockResolvedValueOnce({
            sections: [titled('second', ['b1']), titled('third', ['c1', 'c2'], { moreCursor: 'third-more' }), titled('gone', ['g1'], { moreCursor: 'gone-more' })],
            nextCursor: 'page-3',
        });
        await store().loadMore();
        const ids = feed().sections.map(shown => shown.id);
        const [, , third, gone] = ids;
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        omni.getExploreSectionItems.mockImplementation(async (cursor: string) => {
            // (Its further items cannot be read: the section keeps the cursor to ask again with.)
            if (cursor === 'gone-more-2') throw new Error('refused');
            return ({ 'third-more': { items: [item('c3')] }, 'gone-more': { items: [item('g2')], moreCursor: 'gone-more-2' } })[cursor];
        });
        await refreshed();
        expect([shownIn('third'), shownIn('gone')]).toEqual([['c3'], ['g2']]);
        expect(feed().kept[gone].cursor).toBe('gone-more-2');
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(2);

        // No section has a further entry to show. The page is read from its start through its second page: as far as it had been read.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('first', ['a1'])], nextCursor: 'new-page-2' }).mockResolvedValueOnce({
            sections: [titled('third', ['c1', 'c2'], { moreCursor: 'third-more-new' }), titled('second', ['b9', 'b8'])],
            nextCursor: 'new-page-3',
        });
        await refreshed();
        expect(omni.getExploreFeed.mock.calls).toEqual([[undefined, undefined], ['page-2'], [undefined, undefined], ['new-page-2']]);
        expect(feed().sections.map(shown => shown.id)).toEqual(ids);
        // Each section that stands has what that read has under its heading, with that read's cursor.
        expect([shownIn('first'), shownIn('second'), shownIn('third')]).toEqual([['a1'], ['b9', 'b8'], ['c1', 'c2']]);
        expect(feed().kept[third]).toMatchObject({ cursor: 'third-more-new', from: 0, wentRound: false });
        // The one that read no longer has keeps the entries read for it, and asks for no more: its cursor went with the read before.
        expect(shownIn('gone')).toEqual(['g2']);
        expect(feed().kept[gone].cursor).toBeUndefined();
        expect(feed()).toMatchObject({ nextCursor: 'new-page-3', pages: 2 });
        // No cursor of the read before is asked with again.
        omni.getExploreSectionItems.mockClear();
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('c7')] });
        await refreshed();
        expect(omni.getExploreSectionItems.mock.calls).toEqual([['third-more-new']]);
        // (It goes round the two entries it has.)
        expect([shownIn('third'), shownIn('gone')]).toEqual([['c7'], ['g1']]);
        expect(feed().kept[gone]).toMatchObject({ from: 0, wentRound: true });
        warn.mockRestore();
    });

    it('does not let a section that went round hold the page back from being read anew', async () => {
        const page = () => ({ sections: [titled('short', ['s1'], { moreCursor: 'short-2' }), titled('long', ['l1'], { moreCursor: 'long-2' })] });
        omni.getExploreFeed.mockImplementation(async () => page());
        omni.getExploreSectionItems.mockImplementation(async (cursor: string) => ({
            'short-2': { items: [item('s2')] },
            'long-2': { items: [item('l2')], moreCursor: 'long-3' },
            'long-3': { items: [item('l3')] },
        })[cursor]);
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        await refreshed();
        expect([shownIn('short'), shownIn('long')]).toEqual([['s2'], ['l2']]);
        // The short one has shown its last and starts over, while the long one still has an entry not shown.
        await refreshed();
        expect([shownIn('short'), shownIn('long')]).toEqual([['s1'], ['l3']]);
        expect(feed().kept[feed().sections[0].id].wentRound).toBe(true);
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(1);
        // The short one could go on to its second entry again, which it has shown: nothing unseen is left, and the page is read.
        await refreshed();
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(2);
        expect([shownIn('short'), shownIn('long')]).toEqual([['s1'], ['l1']]);
        expect(feed().sections.map(shown => feed().kept[shown.id])).toMatchObject([{ wentRound: false, cursor: 'short-2' }, { wentRound: false, cursor: 'long-2' }]);
    });

    // Spotify's sections have ids that stay (their uris), and headings worded after the time of day.
    it('takes a section the page read anew hands back under its id for the one that stands, whatever heading it has now', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [{ id: 'uri:1', title: 'Good morning', items: [item('m1')] }, titled('other', ['o1'])] });
        store().show('spotify:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        // No section has further entries, so a refresh reads the page anew.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [{ id: 'uri:1', title: 'Good evening', items: [item('e1')] }, titled('other', ['o1'])] });
        await refreshed();
        expect(feed().sections.map(shown => shown.title)).toEqual(['Good evening', 'other']);
        expect(shownIn('Good evening')).toEqual(['e1']);
        expect(feed().sections[0].id).toBe('uri:1');
    });

    it('does not add a section of a further page that comes under an id that stands, whatever heading it has now', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [{ id: 'uri:1', title: 'Good morning', items: [item('m1')] }], nextCursor: 'page-2' });
        store().show('spotify:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [{ id: 'uri:1', title: 'Good evening', items: [item('e1')] }, titled('other', ['o1'])] });
        await store().loadMore();
        expect(feed().sections.map(shown => shown.title)).toEqual(['Good morning', 'other']);
    });

    it('tells sections of one heading apart, in a page read anew, by the entries they share with what was read for each', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('mix', ['a1', 'a2']), titled('mix', ['b1', 'b2']), titled('mix', ['c1'])] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        // The page hands them in another order, and one of them not at all.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('mix', ['b9', 'b1']), titled('mix', ['a9', 'a1'])] });
        await refreshed();
        expect(feed().sections.map(shown => shown.items.map(entry => (entry.kind === 'collection' ? entry.collection.id : '')))).toEqual([['a9', 'a1'], ['b9', 'b1'], ['c1']]);
    });

    it('leaves every section where it stands on a refresh, whatever order the page keeps, and puts a new one after the last', async () => {
        // An earlier read of the page left the order a, b, c.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('a', ['a1']), titled('b', ['b1']), titled('c', ['c1'])] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        store().clear();
        // This time b comes on a further page: the list reads a, c, b.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('a', ['a1']), titled('c', ['c1'])], nextCursor: 'page-2' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('b', ['b1'])] });
        await store().loadMore();
        const titles = () => feed().sections.map(shown => shown.title);
        expect(titles()).toEqual(['a', 'c', 'b']);
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('z', ['z1']), titled('c', ['c1']), titled('a', ['a1'])] });
        await refreshed();
        expect(titles()).toEqual(['a', 'c', 'b', 'z']);
    });

    it('asks no further section once the refresh was overtaken', async () => {
        const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        omni.getExploreFeed.mockImplementation(async () => ({ sections: names.map(name => titled(name, [`${name}1`], { moreCursor: `${name}-more` })) }));
        const asked: Array<ReturnType<typeof pending<{ items: OmniExploreItem[] }>>> = [];
        omni.getExploreSectionItems.mockImplementation(() => { asked.push(pending()); return asked.at(-1)!.promise; });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        // The listener switches provider while three sections are being asked: the page is given up, and nobody else asks.
        store().refresh();
        await vi.waitFor(() => expect(asked).toHaveLength(3));
        asked[0].reject(new DOMException('Active online provider changed', 'AbortError'));
        await vi.waitFor(() => expect(store().feed).toBeNull());
        asked.slice(1).forEach(answer => answer.resolve({ items: [] }));
        await new Promise(resolve => { setTimeout(resolve, 20); });
        expect(asked).toHaveLength(3);
        // The page is forgotten while three are being asked: the same.
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        store().refresh();
        await vi.waitFor(() => expect(asked).toHaveLength(6));
        store().clear();
        asked.slice(3).forEach(answer => answer.resolve({ items: [] }));
        await new Promise(resolve => { setTimeout(resolve, 20); });
        expect(asked).toHaveLength(6);
        expect(store().feed).toBeNull();
    });

    it('goes on, the next time, from the token a read gave that brought nothing new', async () => {
        const page = () => ({ sections: [titled('picks', ['p1', 'p2'], { moreCursor: 'picks-3' })] });
        omni.getExploreFeed.mockImplementation(async () => page());
        omni.getExploreSectionItems.mockImplementation(async (cursor: string) => ({
            'picks-3': { items: [item('p2'), item('p1')], moreCursor: 'picks-5' },
            'picks-5': { items: [item('p5')] },
        })[cursor]);
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const [picks] = feed().sections.map(shown => shown.id);
        await refreshed();
        expect(shownIn('picks')).toEqual(['p1', 'p2']);
        expect(feed().kept[picks]).toMatchObject({ batch: 0, cursor: 'picks-5' });
        await refreshed();
        expect(shownIn('picks')).toEqual(['p5']);
        expect(omni.getExploreSectionItems.mock.calls.map(([cursor]) => cursor)).toEqual(['picks-3', 'picks-5']);
    });

    it('folds a section the listener opened all of out with "more" back to a batch, and goes through it again', async () => {
        const page = () => ({ sections: [titled('picks', ['p1', 'p2'], { moreCursor: 'picks-3' }), titled('other', ['o1'], { moreCursor: 'other-2' })] });
        omni.getExploreFeed.mockImplementation(async () => page());
        omni.getExploreSectionItems.mockImplementation(async (cursor: string) => ({
            'picks-3': { items: [item('p3')] },
            'other-2': { items: [item('o2')], moreCursor: 'other-3' },
            'other-3': { items: [item('o3')], moreCursor: 'other-4' },
        })[cursor]);
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const [picks] = feed().sections.map(shown => shown.id);
        await store().loadMoreOf(picks);
        expect(shownIn('picks')).toEqual(['p1', 'p2', 'p3']);
        expect(feed().sections[0].moreCursor).toBeUndefined();
        // All it has is on screen. It starts over a batch at a time, and says it has more.
        await refreshed();
        expect(shownIn('picks')).toEqual(['p1', 'p2']);
        expect(feed().kept[picks]).toMatchObject({ batch: 1, wentRound: true });
        expect(feed().sections[0].moreCursor).toBeTruthy();
        await refreshed();
        expect(shownIn('picks')).toEqual(['p3']);
        // Nothing was asked for it again, and the page was not read: another section still had entries not shown.
        expect(omni.getExploreSectionItems.mock.calls.map(([cursor]) => cursor)).toEqual(['picks-3', 'other-2', 'other-3']);
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(1);
    });

    it('takes a batch to be as many entries as the section came with, also where some of them cannot be shown', async () => {
        // The whole first batch is of collections the listener took out of their library.
        store().noteSaved({ providerId: 'ytm', type: 'playlist', id: 'l1' }, false);
        store().noteSaved({ providerId: 'ytm', type: 'playlist', id: 'l2' }, false);
        const page = () => ({ sections: [titled('library', ['l1', 'l2'], { moreCursor: 'library-3' }), titled('other', ['o1'])] });
        omni.getExploreFeed.mockImplementation(async () => page());
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('l3'), item('l4'), item('l5')] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        expect(shownIn('library')).toEqual([]);
        expect(feed().kept[feed().sections[0].id]).toMatchObject({ size: 2, pool: [] });
        await refreshed();
        expect(shownIn('library')).toEqual(['l3', 'l4']);
        // The one entry behind the ones shown is taken out: the section no longer says it has more.
        expect(feed().sections[0].moreCursor).toBeTruthy();
        store().noteSaved({ providerId: 'ytm', type: 'playlist', id: 'l5' }, false);
        expect(feed().sections[0].moreCursor).toBeUndefined();
        for (const id of ['l1', 'l2', 'l5']) store().noteSaved({ providerId: 'ytm', type: 'playlist', id }, true);
    });

    it('does not add a section without a heading with every refresh: nothing tells it from the one that stands', async () => {
        const page = () => ({ sections: [titled('', ['u1']), titled('named', ['n1'])] });
        omni.getExploreFeed.mockImplementation(async () => page());
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        await refreshed();
        await refreshed();
        expect(feed().sections.map(shown => shown.title)).toEqual(['', 'named']);
    });

    it('shows, for "more", the entries a section has read already before asking for others', async () => {
        const page = () => ({ sections: [titled('picks', ['p1', 'p2'], { moreCursor: 'picks-3' })] });
        omni.getExploreFeed.mockImplementation(async () => page());
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('p3'), item('p4'), item('p5')] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const [picks] = feed().sections.map(shown => shown.id);
        await refreshed();
        // Three were read and a batch is two: the third is there to show, and the section says it has more.
        expect(shownIn('picks')).toEqual(['p3', 'p4']);
        expect(feed().sections[0].moreCursor).toBeTruthy();
        await store().loadMoreOf(picks);
        expect(shownIn('picks')).toEqual(['p3', 'p4', 'p5']);
        expect(feed().sections[0].moreCursor).toBeUndefined();
        expect(omni.getExploreSectionItems).toHaveBeenCalledTimes(1);
        // (All of it was shown: the page is read anew, and the section starts over.)
        await refreshed();
        expect(shownIn('picks')).toEqual(['p1', 'p2']);
        // A collection taken out of the library leaves what is kept to be shown later too, and the section stays where it stands in it.
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('p3'), item('p4'), item('p5')] });
        await refreshed();
        expect(shownIn('picks')).toEqual(['p3', 'p4']);
        store().noteSaved({ providerId: 'ytm', type: 'playlist', id: 'p1' }, false);
        store().noteSaved({ providerId: 'ytm', type: 'playlist', id: 'p5' }, false);
        expect(shownIn('picks')).toEqual(['p3', 'p4']);
        expect(feed().kept[picks]).toMatchObject({ from: 1, pool: [item('p2'), item('p3'), item('p4')] });
        store().noteSaved({ providerId: 'ytm', type: 'playlist', id: 'p1' }, true);
        store().noteSaved({ providerId: 'ytm', type: 'playlist', id: 'p5' }, true);
    });

    it('keeps the page shown when the next one cannot be read, and says so until one can', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a', { moreCursor: 'more-a' })], nextCursor: 'next' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        // Further reads of the page shown are under way when the refresh is asked for.
        omni.getExploreFeed.mockReturnValueOnce(pending<never>().promise);
        // (The second answer is to the refresh: the section has no further items, so the page is read anew.)
        omni.getExploreSectionItems.mockReturnValueOnce(pending<never>().promise).mockResolvedValueOnce({ items: [] });
        void store().loadMore();
        void store().loadMoreOf('a');
        expect(feed()).toMatchObject({ loadingMore: true, loadingSectionIds: ['a'] });

        const next = pending<{ sections: OmniExploreSection[] }>();
        omni.getExploreFeed.mockReturnValueOnce(next.promise);
        store().refresh();
        // The page no longer waits for reads the refresh has overtaken, and starts none.
        expect(feed()).toMatchObject({ refreshing: true, loadingMore: false, loadingSectionIds: [] });
        await store().loadMore();
        await store().loadMoreOf('a');
        await vi.waitFor(() => expect(omni.getExploreFeed).toHaveBeenCalledTimes(3));
        expect(omni.getExploreSectionItems).toHaveBeenCalledTimes(2);

        // A card taken off the page while the read was under way stays off when the read fails.
        store().noteSaved({ providerId: 'ytm', type: 'playlist', id: 'a-1' }, false);
        next.reject(new Error('YouTube Music could not be reached'));
        await vi.waitFor(() => expect(feed().refreshing).toBe(false));
        expect(feed()).toMatchObject({ status: 'ready', refreshFailed: true, sections: [{ id: 'a', moreCursor: 'more-a', items: [] }], nextCursor: 'next' });
        store().noteSaved({ providerId: 'ytm', type: 'playlist', id: 'a-1' }, true);
        expect(warn).toHaveBeenLastCalledWith('[Explore] The page could not be read: YouTube Music could not be reached');

        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('b')] });
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [] });
        store().refresh();
        expect(feed()).toMatchObject({ refreshing: true, refreshFailed: false });
        await vi.waitFor(() => expect(feed().sections.map(shown => shown.id)).toEqual(['a', 'b']));
        expect(feed().refreshFailed).toBe(false);
    });

    it('keeps the sections in the order the page first had them, whatever order a later read hands them in', async () => {
        const titled = (title: string) => section(`${title}-${Math.random()}`, { title });
        const shown = () => feed().sections.map(entry => entry.title);
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('recent'), titled('mixes'), titled('artists')], nextCursor: 'next' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(shown()).toEqual(['recent', 'mixes', 'artists']));
        // The same sections swapped, one not among them and one never seen: the ones that stand stay as they stand, and the new one follows them.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('new'), titled('mixes'), titled('recent')], nextCursor: 'next' });
        store().refresh();
        await vi.waitFor(() => expect(shown()).toEqual(['recent', 'mixes', 'artists', 'new']));
        // A page read from nothing later on stands in that order too, and its further sections follow the ones shown in it among themselves.
        store().clear();
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('mixes'), titled('recent')], nextCursor: 'next' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(shown()).toEqual(['recent', 'mixes']));
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('later'), titled('new'), titled('artists')] });
        await store().loadMore();
        expect(shown()).toEqual(['recent', 'mixes', 'artists', 'new', 'later']);
        // Another account's page keeps an order of its own.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [titled('mixes'), titled('recent')] });
        store().show('ytm:other:en');
        await vi.waitFor(() => expect(shown()).toEqual(['mixes', 'recent']));
    });

    it('takes a collection out of the page once the listener took it out of their library, until it is saved again', async () => {
        const withItems = (...ids: string[]) => section('a', { items: ids.map(item), moreCursor: 'more-a' });
        const shown = () => feed().sections[0].items.map(entry => (entry.kind === 'collection' ? entry.collection.id : ''));
        const taken = { providerId: 'ytm', type: 'playlist', id: 'x' } as const;
        omni.getExploreFeed.mockResolvedValue({ sections: [withItems('x', 'y')], nextCursor: 'next' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(shown()).toEqual(['x', 'y']));
        // Saving changes nothing on the page.
        store().noteSaved(taken, true);
        expect(shown()).toEqual(['x', 'y']);
        store().noteSaved(taken, false);
        expect(shown()).toEqual(['y']);

        // The provider goes on listing it: in the next page, in a section's further items, in the page's further sections.
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [] });
        store().refresh();
        await vi.waitFor(() => expect(feed().refreshing).toBe(false));
        expect(shown()).toEqual(['y']);
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('x'), item('z')] });
        await store().loadMoreOf('a');
        expect(shown()).toEqual(['y', 'z']);
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('b', { items: [item('x'), item('w')] })] });
        await store().loadMore();
        expect(feed().sections[1].items).toHaveLength(1);

        store().noteSaved(taken, true);
        store().refresh();
        await vi.waitFor(() => expect(shown()).toEqual(['x', 'y']));
    });

    it('reads another page for another account or language, and drops the answer for the one left', async () => {
        const first = pending<{ sections: OmniExploreSection[] }>();
        omni.getExploreFeed.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ sections: [section('for zh')] });
        store().show('ytm:me:en');
        store().show('ytm:me:zh-CN');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        first.resolve({ sections: [section('for en')] });
        await first.promise;
        expect(store().key).toBe('ytm:me:zh-CN');
        expect(feed().sections.map(shown => shown.id)).toEqual(['for zh']);
    });

    it('shows a failed read as an error, and one overtaken by a provider switch as nothing read yet', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        omni.getExploreFeed.mockRejectedValueOnce(new Error('YouTube Music could not be reached'));
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('error'));
        expect(warn).toHaveBeenCalledExactlyOnceWith('[Explore] The page could not be read: YouTube Music could not be reached');

        omni.getExploreFeed.mockRejectedValueOnce(overtaken());
        store().refresh();
        await vi.waitFor(() => expect(store().key).toBeNull());
        expect(store().feed).toBeNull();
        expect(warn).toHaveBeenCalledTimes(1);
        // The tab reads again the next time it is shown.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a')] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        warn.mockRestore();
    });

    it('appends the page\'s further sections, one request at a time', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a')], nextCursor: 'page-2' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const second = pending<{ sections: OmniExploreSection[]; nextCursor?: string }>();
        omni.getExploreFeed.mockReturnValueOnce(second.promise);
        const first = store().loadMore();
        const again = store().loadMore();
        expect(feed().loadingMore).toBe(true);
        second.resolve({ sections: [section('b')], nextCursor: 'page-3' });
        await Promise.all([first, again]);
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(2);
        expect(omni.getExploreFeed).toHaveBeenLastCalledWith('page-2');
        expect(feed()).toMatchObject({ sections: [{ id: 'a' }, { id: 'b' }], nextCursor: 'page-3', loadingMore: false });
    });

    it('marks further sections that could not be read as failed, and reads them when asked again', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a')], nextCursor: 'page-2' }).mockRejectedValueOnce(new Error('refused'));
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        await store().loadMore();
        expect(feed()).toMatchObject({ sections: [{ id: 'a' }], status: 'ready', nextCursor: 'page-2', loadingMore: false, moreFailed: true });
        expect(warn).toHaveBeenCalledExactlyOnceWith('[Explore] Further sections could not be read: refused');
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('b')] });
        await store().loadMore();
        expect(omni.getExploreFeed).toHaveBeenLastCalledWith('page-2');
        expect(feed()).toMatchObject({ sections: [{ id: 'a' }, { id: 'b' }], moreFailed: false });
        expect(feed().nextCursor).toBeUndefined();
        warn.mockRestore();
    });

    it('keeps the cursor of further sections whose read a provider switch overtook, and calls nothing failed', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a')], nextCursor: 'page-2' }).mockRejectedValueOnce(overtaken());
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        await store().loadMore();
        expect(feed()).toMatchObject({ sections: [{ id: 'a' }], nextCursor: 'page-2', loadingMore: false, moreFailed: false });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it('reads on past a page with nothing to show, and ends the list after three of them or at a cursor that names itself', async () => {
        const first = { sections: [section('a')], nextCursor: 'page-2' };
        omni.getExploreFeed.mockResolvedValueOnce(first)
            .mockResolvedValueOnce({ sections: [], nextCursor: 'page-3' })
            .mockResolvedValueOnce({ sections: [section('b')], nextCursor: 'page-4' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        await store().loadMore();
        expect(omni.getExploreFeed.mock.calls).toEqual([[undefined, undefined], ['page-2'], ['page-3']]);
        expect(feed()).toMatchObject({ sections: [{ id: 'a' }, { id: 'b' }], nextCursor: 'page-4', loadingMore: false });

        omni.getExploreFeed.mockReset()
            .mockResolvedValueOnce({ sections: [], nextCursor: 'page-5' })
            .mockResolvedValueOnce({ sections: [], nextCursor: 'page-6' })
            .mockResolvedValueOnce({ sections: [], nextCursor: 'page-7' })
            .mockResolvedValue({ sections: [section('never asked for')] });
        await store().loadMore();
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(3);
        expect(feed()).toMatchObject({ sections: [{ id: 'a' }, { id: 'b' }], loadingMore: false, moreFailed: false });
        expect(feed().nextCursor).toBeUndefined();

        omni.getExploreFeed.mockReset().mockResolvedValueOnce(first).mockResolvedValueOnce({ sections: [section('b')], nextCursor: 'page-2' });
        store().refresh();
        // (The page shown stays 'ready' through a refresh: the read is over when it no longer refreshes.)
        await vi.waitFor(() => expect(feed().refreshing).toBe(false));
        await store().loadMore();
        expect(feed().sections.map(shown => shown.id)).toEqual(['a', 'b']);
        expect(feed().nextCursor).toBeUndefined();
    });

    it('reads on past a first page with nothing to show, as it does past a further one', async () => {
        // Every section of the first page was one the provider's adapter leaves out: the page after it is the first to show.
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [], nextCursor: 'page-2' })
            .mockResolvedValueOnce({ sections: [section('a')], nextCursor: 'page-3' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        expect(omni.getExploreFeed.mock.calls).toEqual([[undefined, undefined], ['page-2']]);
        expect(feed()).toMatchObject({ sections: [{ id: 'a' }], nextCursor: 'page-3' });

        // Three such pages in a row end the list: the page is empty, and names no further one.
        omni.getExploreFeed.mockReset()
            .mockResolvedValueOnce({ sections: [], nextCursor: 'page-2' })
            .mockResolvedValueOnce({ sections: [], nextCursor: 'page-3' })
            .mockResolvedValueOnce({ sections: [], nextCursor: 'page-4' })
            .mockResolvedValue({ sections: [section('never asked for')] });
        store().show('ytm:other:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        expect(omni.getExploreFeed).toHaveBeenCalledTimes(3);
        expect(feed().sections).toEqual([]);
        expect(feed().nextCursor).toBeUndefined();

        // An empty first page that names no further one is read once.
        omni.getExploreFeed.mockReset().mockResolvedValue({ sections: [] });
        store().show('ytm:third:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        expect(omni.getExploreFeed).toHaveBeenCalledExactlyOnceWith(undefined, undefined);
    });

    it('does not put the further sections of a page that was refreshed meanwhile into the new one', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a')], nextCursor: 'page-2' });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const answer = pending<{ sections: OmniExploreSection[] }>();
        omni.getExploreFeed.mockReturnValueOnce(answer.promise);
        const more = store().loadMore();
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('new')], nextCursor: 'new-page-2' });
        await refreshed();
        answer.resolve({ sections: [section('stale')] });
        await more;
        // The page was read anew meanwhile (its one section had nothing further): the list goes on from that read.
        expect(feed()).toMatchObject({ sections: [{ id: 'a' }, { id: 'new' }], nextCursor: 'new-page-2', pages: 1, loadingMore: false });
        expect(feed().sections).toHaveLength(2);
    });

    it('keeps where the list was scrolled to when a page is read in the place of the one shown, and forgets it with the page', async () => {
        omni.getExploreFeed.mockResolvedValue({ sections: [section('a')] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        exploreScroll.top = 480;
        exploreScroll.rows.set('a', 120);
        // The same page shown again is where it was left.
        store().show('ytm:me:en');
        expect(exploreScroll).toMatchObject({ top: 480 });
        expect(exploreScroll.rows.get('a')).toBe(120);
        store().refresh();
        // The page shown stays where it is until the next one has arrived.
        expect(exploreScroll.top).toBe(480);
        expect(exploreScroll.rows.get('a')).toBe(120);
        await vi.waitFor(() => expect(feed().refreshing).toBe(false));
        // So does the next one: the listener asked for it from there. Its rows are other rows, and start from their starts.
        expect(exploreScroll.top).toBe(480);
        expect(exploreScroll.rows.size).toBe(0);
        // The same page read again after it could not be read leaves the listener where they stand: the app's
        // own sections were on screen meanwhile, and the listener may have scrolled in them.
        omni.getExploreFeed.mockRejectedValueOnce(new Error('offline'));
        store().clear();
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('error'));
        exploreScroll.top = 300;
        store().refresh();
        expect(exploreScroll.top).toBe(300);
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        expect(exploreScroll.top).toBe(300);
        // Another page starts from its top.
        store().show('ytm:other:en');
        expect(exploreScroll.top).toBe(0);
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        exploreScroll.top = 90;
        store().clear();
        expect(exploreScroll.top).toBe(0);
    });

    it('keeps what a section is when its further items arrive', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a', { moreCursor: 'more-a', title: 'A' })] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('a-2')] });
        await store().loadMoreOf('a');
        expect(feed().sections[0]).toEqual({ id: 'a', title: 'A', items: [item('a-1'), item('a-2')] });
    });

    it('appends the further items of one section and takes its cursor away when there are no more', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a', { moreCursor: 'more-a' }), section('b')] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const answer = pending<{ items: OmniExploreItem[]; moreCursor?: string }>();
        omni.getExploreSectionItems.mockReturnValueOnce(answer.promise);
        const first = store().loadMoreOf('a');
        const again = store().loadMoreOf('a');
        expect(feed().loadingSectionIds).toEqual(['a']);
        answer.resolve({ items: [item('a-2')], moreCursor: 'more-a-2' });
        await Promise.all([first, again]);
        expect(omni.getExploreSectionItems).toHaveBeenCalledExactlyOnceWith('more-a');
        expect(feed().sections[0]).toMatchObject({ items: [{ collection: { id: 'a-1' } }, { collection: { id: 'a-2' } }], moreCursor: 'more-a-2' });
        expect(feed().loadingSectionIds).toEqual([]);

        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('a-3')] });
        await store().loadMoreOf('a');
        expect(feed().sections[0].items).toHaveLength(3);
        expect(feed().sections[0]).not.toHaveProperty('moreCursor');
        // A section with no cursor is not asked about.
        await store().loadMoreOf('b');
        await store().loadMoreOf('a');
        expect(omni.getExploreSectionItems).toHaveBeenCalledTimes(2);
    });

    it('keeps a section as it is when its further items could not be read, cursor included, so that it can be asked again', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a', { moreCursor: 'more-a' })] });
        omni.getExploreSectionItems.mockRejectedValueOnce(new Error('refused')).mockRejectedValueOnce(overtaken());
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        await store().loadMoreOf('a');
        expect(feed().sections[0]).toEqual({ id: 'a', title: 'a', items: [item('a-1')], moreCursor: 'more-a' });
        expect(feed().loadingSectionIds).toEqual([]);
        expect(warn).toHaveBeenCalledExactlyOnceWith('[Explore] Further items of a section could not be read: refused');
        // Overtaken by a provider switch: the same, without a warning.
        await store().loadMoreOf('a');
        expect(feed().sections[0]).toMatchObject({ moreCursor: 'more-a' });
        expect(feed().loadingSectionIds).toEqual([]);
        expect(warn).toHaveBeenCalledTimes(1);
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [item('a-2')] });
        await store().loadMoreOf('a');
        expect(feed().sections[0].items).toHaveLength(2);
        warn.mockRestore();
    });

    it('settles two sections that were loading at once, whichever answers first', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a', { moreCursor: 'more-a' }), section('b', { moreCursor: 'more-b' })] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const ofA = pending<{ items: OmniExploreItem[] }>();
        const ofB = pending<{ items: OmniExploreItem[] }>();
        omni.getExploreSectionItems.mockReturnValueOnce(ofA.promise).mockReturnValueOnce(ofB.promise);
        const both = [store().loadMoreOf('a'), store().loadMoreOf('b')];
        expect(feed().loadingSectionIds).toEqual(['a', 'b']);
        ofB.resolve({ items: [item('b-2')] });
        await both[1];
        expect(feed().loadingSectionIds).toEqual(['a']);
        ofA.resolve({ items: [item('a-2')] });
        await both[0];
        expect(feed().sections.map(shown => shown.items.length)).toEqual([2, 2]);
        expect(feed().loadingSectionIds).toEqual([]);
    });

    it('does not put the further items of a page that was refreshed meanwhile into the new one', async () => {
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a', { moreCursor: 'more-a' })] });
        store().show('ytm:me:en');
        await vi.waitFor(() => expect(feed().status).toBe('ready'));
        const answer = pending<{ items: OmniExploreItem[] }>();
        omni.getExploreSectionItems.mockReturnValueOnce(answer.promise);
        const more = store().loadMoreOf('a');
        omni.getExploreFeed.mockResolvedValueOnce({ sections: [section('a', { moreCursor: 'new-more' })] });
        // (The refresh asks for the section's further items itself, and is told there are none.)
        omni.getExploreSectionItems.mockResolvedValueOnce({ items: [] });
        await refreshed();
        answer.resolve({ items: [item('stale')] });
        await more;
        expect(feed().sections[0]).toEqual({ id: 'a', title: 'a', items: [item('a-1')], moreCursor: 'new-more' });
    });
});
