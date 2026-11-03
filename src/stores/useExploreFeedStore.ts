import { create } from 'zustand';
import { omni } from '../services/onlineMusic/omni';
import { inKeptOrder, noteCollectionSaved, withoutTakenOut } from '../components/app/home/explore/exploreFeedMemory';
import type { UnifiedSong } from '../types';
import type { OmniCollection, OmniExploreItem, OmniExploreSection } from '../types/onlineMusic';
import { errorMessage } from '../utils/errorText';

// src/stores/useExploreFeedStore.ts
// The active provider's recommendation page behind the explore tab: its sections, the further
// sections of the page, and the further items of one section.
// "Refresh" shows other entries under the headings that stand. A section's further items are
// read through the section's own cursor, and a cursor stands for its section only until the page
// is next read from its start (see OnlineExploreProvider): once such a read has arrived, the
// page holds none of the read before. (After one that failed it still holds them, and the
// provider answers them as it sees fit: YouTube's adapter with nothing.)
// So a refresh does not read the page. Every section goes on to the entries that follow
// the ones shown (its further items, read as far as needed), and one that has shown its last
// starts over. Only a refresh that would show nothing the listener has not been shown reads the
// page anew, as far as it had been read: every section then takes what the provider has under
// its heading now, and sections it has not handed before join after the last one. (One the
// provider makes up anew for every read, `changesWithRead`, has no heading to be known by: it
// gives its place, heading and all, to one of those the read brought.) A section that
// has nothing but what it shows stays as it is. No section leaves the page for a refresh or
// changes its place: the list is never lower than it was, and stays where it was scrolled to.
// A provider may say, with the page it answers a read from the start with, that a refresh reads
// its page anew (`ProviderExplorePage.refreshReadsAnew`): then no section is asked to go on, the
// page is read anew at once, and a section's cursor serves its "more" alone.

// What the page keeps of a section beside what it shows of it. A provider may hand a section
// back with the entries it had (YouTube's page, measured 2026-10-07: of the 12 entries of a
// first page, 11 or 12 were the same from one read to the next, while a section had 16 to more
// than 30 entries behind its own cursor, 6 a request).
export interface KeptSection {
    /** Every entry read for the section since it was last taken anew, in the order they came; the ones shown are among them. */
    pool: OmniExploreItem[];
    /** Where the entries shown start in the pool. */
    from: number;
    /** How many entries a batch is: as many as the section came with. */
    size: number;
    /** The provider's token for what follows the pool. */
    cursor?: string;
    /** Counted up whenever other entries take the place of the ones shown. */
    batch: number;
    /** It has shown its last entry and started over since it was taken: what it shows from then on, it has shown before. */
    wentRound: boolean;
}

export interface ExploreFeed {
    /** Which read of the page this is. */
    read: number;
    /** The sections as they are shown. A section's `moreCursor` only says that it has further entries: the token is kept apart. */
    sections: OmniExploreSection[];
    /** What is kept of each section, by the section's id. */
    kept: Record<string, KeptSection>;
    nextCursor?: string;
    /** How many pages of the provider's list were read since it was last read from its start: read anew, the page is read that far. */
    pages: number;
    /** The provider said so with the page's last read from its start: a refresh reads the page anew, whatever its sections have further. */
    refreshReadsAnew?: boolean;
    status: 'loading' | 'ready' | 'error';
    /** Other entries are being read while this page stays on screen. */
    refreshing: boolean;
    /** That read failed, and this page stayed. */
    refreshFailed: boolean;
    loadingMore: boolean;
    /** The further sections could not be read; the end of the list offers to try again. */
    moreFailed: boolean;
    loadingSectionIds: string[];
}

/** The store's `key` of the explore page read for this provider, account ('' for none) and language. */
export const explorePageKey = (providerId: string, accountId: string, language: string): string => `${providerId}:${accountId}:${language}`;

interface ExploreFeedStore {
    // One page is kept: the one of `key`, which names the provider, the account and the language.
    // What was read stays until `refresh`; coming back to the tab shows the page that was left.
    // A refresh leaves the page on screen until the next entries have arrived.
    key: string | null;
    feed: ExploreFeed | null;
    // `listened`: the songs the listener played here, handed to the provider with a read of the
    // page from its start (see OnlineExploreProvider).
    show: (key: string, listened?: UnifiedSong[]) => void;
    refresh: (listened?: UnifiedSong[]) => void;
    loadMore: () => Promise<void>;
    loadMoreOf: (sectionId: string) => Promise<void>;
    /** The listener saved a collection to their library, or took it out; one taken out leaves the page. */
    noteSaved: (collection: Pick<OmniCollection, 'providerId' | 'type' | 'id'>, saved: boolean) => void;
    clear: () => void;
}

// A page may hold nothing this app can show and still name a further page. That many are read in
// a row before the list is taken to end there.
const MAX_EMPTY_PAGES = 3;
// The page at `cursor` (the first page when there is none), or the first page after it that has
// something to show: an empty page would leave the listener with nothing to ask again from (the
// first page shows as an empty tab, a further one as an end of the list that stays in view). A
// cursor that names itself ends the list. The sections are as they came: the collections the
// listener took out of their library are left out where a section is kept (`taken`).
// `listened` goes with a read from the start (see OnlineExploreProvider). `refreshReadsAnew` is
// there where the provider said it of its page (`ProviderExplorePage.refreshReadsAnew`).
const readPageWithSections = async (cursor?: string, listened?: UnifiedSong[]): Promise<{ sections: OmniExploreSection[]; nextCursor?: string; refreshReadsAnew?: boolean }> => {
    let sections: OmniExploreSection[] = [];
    let readsAnew = false;
    for (let pages = 0; pages < MAX_EMPTY_PAGES; pages += 1) {
        const page = await (cursor ? omni.getExploreFeed(cursor) : omni.getExploreFeed(undefined, listened));
        sections = page.sections;
        readsAnew ||= page.refreshReadsAnew === true;
        cursor = page.nextCursor === cursor ? undefined : page.nextCursor;
        if (sections.length > 0 || !cursor) break;
    }
    return { sections, nextCursor: sections.length > 0 ? cursor : undefined, ...(readsAnew ? { refreshReadsAnew: true } : {}) };
};

// Where the listener left the kept page: how far the list is scrolled, and each section's row.
// The home screen is taken down while the player covers it, and the tab comes back at this place.
// Not state: nothing renders from it, and it is written on every scroll.
export const exploreScroll = { top: 0, rows: new Map<string, number>() };
const forgetScroll = () => {
    exploreScroll.top = 0;
    exploreScroll.rows.clear();
};

const overtaken = () => new DOMException('The read was overtaken', 'AbortError');
const isOvertaken = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';
const wordsOf = (error: unknown) => errorMessage(error);
const blank = (status: ExploreFeed['status'], read: number): ExploreFeed => ({
    read, sections: [], kept: {}, pages: 0, status, refreshing: false, refreshFailed: false, loadingMore: false, moreFailed: false, loadingSectionIds: [],
});

const nameOf = (item: OmniExploreItem) => (item.kind === 'song' ? `song:${item.song.id}` : `${item.collection.type}:${item.collection.id}`);
const namesIn = (items: OmniExploreItem[]) => new Set(items.map(nameOf));
/** Whether more than half of a section's entries, as it came, are none of `known`: the provider has other entries, not the ones it had. */
const hasOthers = (section: OmniExploreSection, known: ReadonlySet<string>) => {
    const items = withoutTakenOut(section.items);
    return items.filter(item => !known.has(nameOf(item))).length * 2 > items.length;
};
/** Whether the two are the same entries, in whatever order. */
const areSame = (left: OmniExploreItem[], right: OmniExploreItem[]) => {
    const names = namesIn(right);
    return left.length === right.length && left.every(item => names.has(nameOf(item)));
};
// What a shown section's `moreCursor` is when all its further entries are read already.
const READ_ALREADY = 'read-already';

/** A section as it came, kept: it shows its first batch. (A batch is as many entries as it came with, whether or not each of them can be shown.) */
const taken = (section: OmniExploreSection, batch: number): KeptSection => ({
    pool: withoutTakenOut(section.items), from: 0, size: section.items.length, batch, wentRound: false, ...(section.moreCursor ? { cursor: section.moreCursor } : {}),
});
/** The section as shown: `count` entries of the pool, from where the kept one stands. */
const shownOf = (section: Pick<OmniExploreSection, 'id' | 'title' | 'changesWithRead'>, kept: KeptSection, count: number): OmniExploreSection => {
    const end = kept.from + count;
    return {
        id: section.id, title: section.title, items: kept.pool.slice(kept.from, end),
        ...(end < kept.pool.length || kept.cursor ? { moreCursor: kept.cursor ?? READ_ALREADY } : {}),
        ...(section.changesWithRead ? { changesWithRead: true } : {}),
    };
};
/** Sections as they came, as the page takes them in: each as it is first shown, and what is kept of each. */
const arrived = (sections: OmniExploreSection[]): Pick<ExploreFeed, 'sections' | 'kept'> => {
    const kept = Object.fromEntries(sections.map(section => [section.id, taken(section, 0)]));
    return { sections: sections.map(section => shownOf(section, kept[section.id], kept[section.id].size)), kept };
};
/** `pool` with the entries of `items` it does not hold yet after it. */
const joined = (pool: OmniExploreItem[], items: OmniExploreItem[]) => {
    const known = namesIn(pool);
    return [...pool, ...withoutTakenOut(items).filter(item => !known.has(nameOf(item)))];
};
// The page without the collections the listener took out of their library: what is shown, and what is kept to be shown later.
const withoutTakenOutOf = (feed: ExploreFeed): ExploreFeed => {
    const kept = Object.fromEntries(Object.entries(feed.kept).map(([id, section]) => [id, {
        ...section, pool: withoutTakenOut(section.pool), from: withoutTakenOut(section.pool.slice(0, section.from)).length,
    }]));
    return { ...feed, kept, sections: feed.sections.map(section => shownOf(section, kept[section.id], withoutTakenOut(section.items).length)) };
};

// What a section shows after a refresh: `count` entries of `kept`.
type Exchange = { kept: KeptSection; count: number };

// The entries that follow the ones `section` shows, read through its cursor where the pool ends
// before a batch is full. `further` says what came of it: 'shown', it shows them; 'ahead', the
// read brought none it had not, and a token for what follows, which it asks with the next time;
// 'failed', they could not be read, and it asks again the next time; 'none', its last entry is
// shown. Without further entries it is as it is shown, with what the read left of it.
const wentOn = async (section: OmniExploreSection, kept: KeptSection): Promise<Exchange & { further: 'shown' | 'ahead' | 'failed' | 'none' }> => {
    const start = kept.from + section.items.length;
    let { pool, cursor } = kept;
    let hasFailed = false;
    if (pool.length - start < kept.size && cursor) {
        try {
            const page = await omni.getExploreSectionItems(cursor);
            pool = joined(pool, page.items);
            // (A token that names itself ends the section: it would be asked with for good.)
            cursor = page.moreCursor === cursor ? undefined : page.moreCursor;
        } catch (error) {
            if (isOvertaken(error)) throw error;
            console.warn(`[Explore] Further items of a section could not be read: ${wordsOf(error)}`);
            hasFailed = true;
        }
    }
    if (pool.length <= start) return { kept: { ...kept, pool, cursor }, count: section.items.length, further: hasFailed ? 'failed' : cursor ? 'ahead' : 'none' };
    return { kept: { ...kept, pool, cursor, from: start, batch: kept.batch + 1 }, count: Math.min(kept.size, pool.length - start), further: 'shown' };
};

// `section` from its first entries again: the ones the provider has under its heading now
// (`fresh`, where the page was just read anew and has the section), else the ones read for it.
// Where those are the very entries it shows, nothing is exchanged.
const startedOver = (section: OmniExploreSection, kept: KeptSection, fresh?: OmniExploreSection): Exchange => {
    const again = fresh ? taken(fresh, kept.batch + 1) : { ...kept, from: 0, batch: kept.batch + 1, wentRound: true };
    if (!areSame(again.pool.slice(0, again.size), section.items)) return { kept: again, count: again.size };
    // (What the page just read has of it is kept in the order it is shown in: a provider hands the same entries back in another.)
    return { kept: fresh ? { ...again, pool: section.items, batch: kept.batch } : kept, count: section.items.length };
};

// At most this many sections ask the provider for their further items at a time. None asks once
// one of them was overtaken, or the refresh as a whole was (`goesOn`).
const AT_ONCE = 3;
const inTurn = async <T, R>(items: T[], run: (item: T) => Promise<R>, goesOn: () => boolean): Promise<R[]> => {
    const results: R[] = [];
    let next = 0;
    let isOver = false;
    const work = async () => {
        while (next < items.length && !isOver) {
            const index = next;
            next += 1;
            try {
                if (!goesOn()) throw overtaken();
                results[index] = await run(items[index]);
            } catch (error) {
                isOver = true;
                throw error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, work));
    return results;
};

// The page read from its start, as far as `pages` pages of it, and how many were read. A further
// page that cannot be read ends it there: the list goes on from that page when its end is next reached.
const readAnew = async (pages: number, goesOn: () => boolean, listened?: UnifiedSong[]): Promise<{ sections: OmniExploreSection[]; nextCursor?: string; pages: number; refreshReadsAnew?: boolean }> => {
    const first = await readPageWithSections(undefined, listened);
    let { sections, nextCursor } = first;
    let read = 1;
    for (; read < pages && nextCursor && goesOn(); read += 1) {
        try {
            const further = await readPageWithSections(nextCursor);
            sections = [...sections, ...further.sections];
            nextCursor = further.nextCursor;
        } catch (error) {
            if (isOvertaken(error)) throw error;
            console.warn(`[Explore] Further sections could not be read: ${wordsOf(error)}`);
            break;
        }
    }
    if (!goesOn()) throw overtaken();
    return { ...first, sections, nextCursor, pages: read };
};

// Which section of a page read anew each section that stands is now (`fresh`, in the order they
// stand), and the ones of the page that are none of them (`others`). A section is known by its
// id where the page hands one back under the id it had, else by its
// heading; where several stand under one heading, each is the one that shares the most entries
// with what was read for it. A section without a heading is no other read's (nothing would tell
// it from the one the next read brings, and each read would add one).
// A section the provider makes up anew for every read (`changesWithRead`) is known by no
// heading: the first of them that stands is now the first of them the page has, and so on.
const freshOf = (feed: ExploreFeed, page: OmniExploreSection[]): { fresh: Array<OmniExploreSection | undefined>; others: OmniExploreSection[] } => {
    const pairs = feed.sections.flatMap((section, at) => {
        const known = namesIn(feed.kept[section.id].pool);
        return section.title === '' || section.changesWithRead ? [] : page.filter(candidate => candidate.title === section.title && !candidate.changesWithRead)
            .map(candidate => ({ at, candidate, shared: candidate.items.filter(item => known.has(nameOf(item))).length }));
    }).sort((left, right) => right.shared - left.shared);
    const fresh: Array<OmniExploreSection | undefined> = feed.sections.map(() => undefined);
    const claimed = new Set<OmniExploreSection>();
    // A provider that names its sections hands one back under the id it had (Spotify: the
    // section's uri): that is the section, whatever heading it comes under now.
    feed.sections.forEach((section, at) => {
        const same = section.changesWithRead ? undefined : page.find(candidate => candidate.id === section.id && !candidate.changesWithRead);
        if (!same) return;
        fresh[at] = same;
        claimed.add(same);
    });
    for (const { at, candidate } of pairs) {
        if (fresh[at] || claimed.has(candidate)) continue;
        fresh[at] = candidate;
        claimed.add(candidate);
    }
    const madeAnew = page.filter(section => section.changesWithRead);
    feed.sections.forEach((section, at) => {
        const next = section.changesWithRead ? madeAnew.shift() : undefined;
        if (!next) return;
        fresh[at] = next;
        claimed.add(next);
    });
    return { fresh, others: page.filter(section => section.title !== '' && !claimed.has(section)) };
};

// The page after a refresh. Every section that stands goes on to its further entries, where it
// stands, and one that has none starts over. Where that would show nothing the listener has not
// been shown since the page was read, the page is read anew instead: every section takes what
// the provider has under its heading now, and after the ones that stand come the sections it has
// that the page shown has not, in the order the page keeps.
// A page whose provider said that a refresh reads it anew (`refreshReadsAnew`) is read anew at
// once: none of its sections is asked to go on, and each is taken as one that has shown its last.
const exchanged = async (key: string, feed: ExploreFeed, goesOn: () => boolean, listened?: UnifiedSong[]): Promise<Pick<ExploreFeed, 'sections' | 'kept' | 'nextCursor' | 'pages' | 'refreshReadsAnew'>> => {
    const went: Array<Awaited<ReturnType<typeof wentOn>>> = feed.refreshReadsAnew
        ? feed.sections.map(section => ({ kept: feed.kept[section.id], count: section.items.length, further: 'none' }))
        : await inTurn(feed.sections, section => wentOn(section, feed.kept[section.id]), goesOn);
    // (`headings`: the heading each section has now, where it is another than it stood under.)
    const settled = (exchanges: Exchange[], headings: Array<string | undefined> = []) => ({
        sections: exchanges.map(({ kept, count }, index) => shownOf({ ...feed.sections[index], title: headings[index] ?? feed.sections[index].title }, kept, count)),
        kept: Object.fromEntries(exchanges.map(({ kept }, index) => [feed.sections[index].id, kept])),
    });
    const round = (section: OmniExploreSection, { kept, count, further }: typeof went[number]) => (further === 'none' ? startedOver(section, kept) : { kept, count });
    // (A section that went round shows further entries too: ones it has shown before.)
    const hasUnseen = went.some(({ further }, index) => further === 'ahead' || (further === 'shown' && !feed.kept[feed.sections[index].id].wentRound));
    if (hasUnseen) return { ...settled(went.map((exchange, index) => round(feed.sections[index], exchange))), nextCursor: feed.nextCursor, pages: feed.pages };
    const page = await readAnew(feed.pages, goesOn, listened);
    const { fresh, others } = freshOf(feed, page.sections);
    // (The cursors of the read before went with it: a section the page no longer has goes on through the entries read for it.)
    const next = settled(went.map((exchange, index) => (fresh[index]
        ? startedOver(feed.sections[index], feed.kept[feed.sections[index].id], fresh[index])
        : round(feed.sections[index], { ...exchange, kept: { ...exchange.kept, cursor: undefined } }))), fresh.map(section => section?.title));
    // (All of them are handed over, so that every heading seen is noted as seen. Only the new ones are placed by the order.)
    const joining = arrived(inKeptOrder(key, [...feed.sections, ...others]).filter(section => others.includes(section)));
    return {
        sections: [...next.sections, ...joining.sections], kept: { ...next.kept, ...joining.kept }, nextCursor: page.nextCursor, pages: page.pages,
        ...(page.refreshReadsAnew ? { refreshReadsAnew: true } : {}),
    };
};

// Whether `section`, of a further page, is one the page shows already: a page read anew may list
// further down what it listed higher up before. One that comes under an id that stands is that section.
const standsOn = (feed: ExploreFeed, section: OmniExploreSection): boolean => feed.sections.some(other => other.id === section.id || (
    other.title !== '' && other.title === section.title && !hasOthers(section, namesIn(feed.kept[other.id].pool))
));

export const useExploreFeedStore = create<ExploreFeedStore>((set, get) => {
    // An answer is for the page that asked; it is dropped when another key, or a newer read of
    // the same key, has taken its place.
    let reads = 0;
    const load = async (key: string, listened?: UnifiedSong[]) => {
        const { key: keptKey, feed } = get();
        // A page with something on it stays while other entries are read. Its own further reads
        // are overtaken by this one, so it no longer waits for them.
        const shown = keptKey === key && feed?.status === 'ready' && feed.sections.length > 0
            ? { ...feed, refreshFailed: false, loadingMore: false, loadingSectionIds: [] } : null;
        const read = ++reads;
        if (shown) set({ feed: { ...shown, refreshing: true } });
        else {
            // Another page starts from its top. The same one, read again after it could not be read,
            // leaves the listener where they stand: the app's own sections are on screen meanwhile.
            if (keptKey !== key) forgetScroll();
            set({ key, feed: blank('loading', read) });
        }
        try {
            if (!shown) {
                const page = await readPageWithSections(undefined, listened);
                if (read !== reads) return;
                const first = arrived(inKeptOrder(key, page.sections));
                set({ feed: { ...blank('ready', read), ...first, nextCursor: page.nextCursor, pages: 1, ...(page.refreshReadsAnew ? { refreshReadsAnew: true } : {}) } });
                console.log(`[Explore] Page ${read}: ${first.sections.length} sections`);
                return;
            }
            const next = await exchanged(key, shown, () => read === reads, listened);
            if (read !== reads) return;
            // The listener stays where they stand; a row whose entries were exchanged starts from its start.
            exploreScroll.rows.clear();
            // (A card may have been taken off the page while the read was under way.)
            set({ feed: withoutTakenOutOf({ ...blank('ready', read), ...next }) });
            const others = next.sections.filter(section => next.kept[section.id].batch !== (shown.kept[section.id]?.batch ?? -1)).length;
            console.log(`[Explore] Refresh ${read}: ${next.sections.length} sections, ${others} with other entries`);
        } catch (error) {
            if (read !== reads) return;
            // The listener switched provider meanwhile: nothing failed, and a tab still showing this key asks again.
            if (isOvertaken(error)) { set({ key: null, feed: null }); return; }
            console.warn(`[Explore] The page could not be read: ${wordsOf(error)}`);
            // The page as it is now: a card may have been taken off it while the read was under way.
            const current = get().feed;
            set({ feed: shown && current ? { ...current, refreshing: false, refreshFailed: true } : blank('error', read) });
        }
    };
    const patch = (read: number, change: (feed: ExploreFeed) => ExploreFeed) => {
        const { feed } = get();
        if (read === reads && feed) set({ feed: change(feed) });
    };

    return {
        key: null,
        feed: null,
        show(key, listened) {
            if (get().key !== key) void load(key, listened);
        },
        refresh(listened) {
            const { key } = get();
            if (key) void load(key, listened);
        },
        // The further sections of the page. One request at a time: the end of the list can come
        // into view several times while an answer is on its way.
        async loadMore() {
            const { feed } = get();
            if (!feed?.nextCursor || feed.loadingMore || feed.status !== 'ready' || feed.refreshing) return;
            const read = reads;
            patch(read, current => ({ ...current, loadingMore: true, moreFailed: false }));
            try {
                const page = await readPageWithSections(feed.nextCursor);
                patch(read, current => {
                    const further = arrived(inKeptOrder(get().key!, page.sections.filter(section => !standsOn(current, section))));
                    return {
                        ...current,
                        sections: [...current.sections, ...further.sections],
                        kept: { ...current.kept, ...further.kept },
                        nextCursor: page.nextCursor,
                        pages: current.pages + 1,
                        loadingMore: false,
                    };
                });
            } catch (error) {
                // The cursor stays. Overtaken by a provider switch, nothing failed and the end of
                // the list asks again; after a failure it waits for the listener to ask.
                if (!isOvertaken(error)) console.warn(`[Explore] Further sections could not be read: ${wordsOf(error)}`);
                patch(read, current => ({ ...current, loadingMore: false, moreFailed: !isOvertaken(error) }));
            }
        },
        // The further items of one section, asked for by its "more": the ones read already for a
        // batch since exchanged, a batch of them at a time, and then the provider's.
        async loadMoreOf(sectionId) {
            const { feed } = get();
            const section = feed?.sections.find(candidate => candidate.id === sectionId);
            const kept = feed?.kept[sectionId];
            if (!feed || !section?.moreCursor || !kept || feed.refreshing || feed.loadingSectionIds.includes(sectionId)) return;
            const read = reads;
            const settle = (change: (kept: KeptSection, shown: number) => [KeptSection, number]) => patch(read, current => {
                const [next, count] = change(current.kept[sectionId], current.sections.find(candidate => candidate.id === sectionId)!.items.length);
                return {
                    ...current,
                    sections: current.sections.map(candidate => (candidate.id === sectionId ? shownOf(candidate, next, count) : candidate)),
                    kept: { ...current.kept, [sectionId]: next },
                    loadingSectionIds: current.loadingSectionIds.filter(id => id !== sectionId),
                };
            });
            if (kept.from + section.items.length < kept.pool.length || !kept.cursor) {
                settle((now, shown) => [now, Math.min(shown + now.size, now.pool.length - now.from)]);
                return;
            }
            patch(read, current => ({ ...current, loadingSectionIds: [...current.loadingSectionIds, sectionId] }));
            try {
                const page = await omni.getExploreSectionItems(kept.cursor);
                settle(now => {
                    const pool = joined(now.pool, page.items);
                    return [{ ...now, pool, cursor: page.moreCursor }, pool.length - now.from];
                });
            } catch (error) {
                if (!isOvertaken(error)) console.warn(`[Explore] Further items of a section could not be read: ${wordsOf(error)}`);
                // The section keeps its cursor, and with it what asks again.
                settle((now, shown) => [now, shown]);
            }
        },
        noteSaved(collection, saved) {
            noteCollectionSaved(collection, saved);
            const { feed } = get();
            if (!saved && feed) set({ feed: withoutTakenOutOf(feed) });
        },
        clear() {
            reads += 1;
            forgetScroll();
            set({ key: null, feed: null });
        },
    };
});
