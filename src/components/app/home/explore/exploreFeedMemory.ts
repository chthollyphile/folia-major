import type { OmniCollection, OmniExploreItem, OmniExploreSection } from '../../../../types/onlineMusic';

// src/components/app/home/explore/exploreFeedMemory.ts
// What the explore tab remembers from one session to the next: the order its sections stand in,
// and the collections the listener took out of their library.

const STORAGE_KEY = 'folia_explore_memory';
// A provider words some headings after an artist, so new ones keep coming; past this many for
// one page the heading seen longest ago is forgotten.
const MAX_HEADINGS = 200;
// How long a collection taken out of the library stays off the page. YouTube went on listing an
// album on its "from your library" shelf after the album was taken out (2026-10-07, on a page
// read fresh; how long it goes on was not measured), and nothing on a shelf tells that card
// from a recommendation.
const TAKEN_OUT_MS = 7 * 24 * 60 * 60 * 1000;

interface Memory {
    /** Per page, its headings in the order they stand in, each with when it was last seen. */
    orders: Record<string, Array<[heading: string, seenAt: number]>>;
    /** The collections taken out, each with when. */
    takenOut: Record<string, number>;
}

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// What is stored, as far as it has the shape written here; anything else is left out.
const read = (): Memory => {
    const memory: Memory = { orders: {}, takenOut: {} };
    try {
        const kept: unknown = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null');
        if (!isRecord(kept)) return memory;
        for (const [page, order] of Object.entries(isRecord(kept.orders) ? kept.orders : {})) {
            if (Array.isArray(order)) {
                memory.orders[page] = order.filter((entry): entry is [string, number] => (
                    Array.isArray(entry) && typeof entry[0] === 'string' && Number.isFinite(entry[1])
                ));
            }
        }
        for (const [key, at] of Object.entries(isRecord(kept.takenOut) ? kept.takenOut : {})) {
            if (typeof at === 'number' && Number.isFinite(at)) memory.takenOut[key] = at;
        }
    } catch { /* nothing usable is stored */ }
    return memory;
};
// A profile that cannot store keeps the memory for the session.
let memory: Memory | null = null;
const recall = (): Memory => (memory ??= read());
const keep = () => {
    try { storage()?.setItem(STORAGE_KEY, JSON.stringify(recall())); } catch { /* kept for the session */ }
};

/** Forgets what was read from storage, so that the next call reads it again. */
export const resetExploreMemory = (): void => { memory = null; };

// The sections of one read in the order the page has kept: a provider hands the same sections
// back in another order from read to read, and the section that opens the page would change
// with it. A heading met for the first time goes after the ones known, in the order it came.
export const inKeptOrder = (pageKey: string, sections: OmniExploreSection[]): OmniExploreSection[] => {
    const now = Date.now();
    const known = recall().orders[pageKey] ?? [];
    const seen = new Set(sections.map(section => section.title));
    const fresh = [...seen].filter(heading => !known.some(([kept]) => kept === heading));
    let order = [...known.map(([heading, seenAt]): [string, number] => [heading, seen.has(heading) ? now : seenAt]), ...fresh.map((heading): [string, number] => [heading, now])];
    if (order.length > MAX_HEADINGS) {
        // Of headings seen at the same time, the ones further down go first.
        const forgotten = new Set(order.map(([heading, seenAt], index) => ({ heading, seenAt, index }))
            .sort((left, right) => (left.seenAt - right.seenAt) || right.index - left.index)
            .slice(0, order.length - MAX_HEADINGS).map(entry => entry.heading));
        order = order.filter(([heading]) => !forgotten.has(heading));
    }
    recall().orders[pageKey] = order;
    keep();
    const rank = new Map(order.map(([heading], index) => [heading, index]));
    const rankOf = (section: OmniExploreSection) => rank.get(section.title) ?? order.length;
    // Sections of one heading keep the order they came in.
    return sections
        .map((section, index) => ({ section, index }))
        .sort((left, right) => (rankOf(left.section) - rankOf(right.section)) || left.index - right.index)
        .map(entry => entry.section);
};

const keyOf = (collection: Pick<OmniCollection, 'providerId' | 'type' | 'id'>) => `${collection.providerId}:${collection.type}:${collection.id}`;

// A time later than now is of a clock that was wrong; it would otherwise hold for good.
const holds = (at: number | undefined, now: number): boolean => at !== undefined && at <= now && now - at < TAKEN_OUT_MS;

const isTakenOut = (item: OmniExploreItem, now: number): boolean => (
    item.kind === 'collection' && holds(recall().takenOut[keyOf(item.collection)], now)
);

/** The entries without the collections the listener took out of their library. */
export const withoutTakenOut = <T extends OmniExploreItem>(items: T[]): T[] => {
    const now = Date.now();
    return items.filter(item => !isTakenOut(item, now));
};

/** Records that a collection was saved to the library, or taken out of it, through this app. */
export const noteCollectionSaved = (collection: Pick<OmniCollection, 'providerId' | 'type' | 'id'>, saved: boolean): void => {
    const now = Date.now();
    const { takenOut } = recall();
    for (const [key, at] of Object.entries(takenOut)) if (!holds(at, now)) delete takenOut[key];
    if (saved) delete takenOut[keyOf(collection)];
    else takenOut[keyOf(collection)] = now;
    keep();
};
