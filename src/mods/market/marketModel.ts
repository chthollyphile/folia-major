import type { ModAwesomeEntry, ModMarketCatalog, ModMarketCategory, ModMarketEntry, ModRuntimeInfo } from '../types';
import { isEmptyModsQuery, type ModsQuery } from './modsQuery';

// src/mods/market/marketModel.ts
// One list of everything the mods view shows: the installed mods, the market catalog's mods and the
// Awesome-Folia entries, merged by id. Pure functions; the view and its tests share them.

export type ModViewItem = {
    /** `mod:<id>` or `awesome:<id>` (an awesome entry may share an id with a mod). */
    key: string;
    id: string;
    kind: 'mod' | 'awesome';
    name: string;
    description: string | null;
    author: string | null;
    /** The installed version, else the catalog's. */
    version: string | null;
    installed: ModRuntimeInfo | null;
    market: ModMarketEntry | null;
    awesome: ModAwesomeEntry | null;
    category: string | null;
    tags: string[];
    /** Installed in the user folder, and the catalog has a newer version. */
    hasUpdate: boolean;
    /** Installed, held back because its `folia` range ran out above (it may be let through). */
    rangeExpired: boolean;
    beta: boolean;
    builtin: boolean;
    source: boolean;
    updatedAt: string | null;
    /** Lower-cased words of the item, for the search box. */
    searchText: string;
};

/**
 * Whether the mod runs as far as its switches go: its own switch, and for a source mod not every one of its sources
 * switched off in Settings → Sources. The mods window shows this, so the two places agree (modSwitch.ts).
 */
export const isModOn = (mod: ModRuntimeInfo): boolean => mod.enabled && !mod.sourcesOff;

export type ModsSort = 'updated' | 'name';

export type ModsSection = {
    id: 'updates' | 'expired' | 'installed' | 'awesome' | `category:${string}`;
    /** The category of a market section. */
    category?: ModMarketCategory | null;
    items: ModViewItem[];
};

const VERSION_PARTS = /^(\d+)\.(\d+)\.(\d+)/;

/** Orders two `x.y.z` versions; one that does not parse sorts below any that does. */
export const compareModVersions = (left: string | null | undefined, right: string | null | undefined): number => {
    const a = VERSION_PARTS.exec(left ?? '');
    const b = VERSION_PARTS.exec(right ?? '');
    if (!a || !b) return (a ? 1 : 0) - (b ? 1 : 0);
    for (let index = 1; index <= 3; index += 1) {
        const diff = Number(a[index]) - Number(b[index]);
        if (diff !== 0) return diff;
    }
    return 0;
};

const UPDATABLE_TIERS = new Set(['user', 'override']);

const words = (...values: Array<string | null | undefined | string[]>): string => values
    .flat()
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

/** Merges the installed mods, the catalog's mods and its awesome entries into one list (installed ones first). */
export const buildModViewItems = (
    installed: readonly ModRuntimeInfo[],
    catalog: ModMarketCatalog | null,
    categoryLabel: (id: string) => string = (id) => id,
): ModViewItem[] => {
    const marketById = new Map((catalog?.mods ?? []).map((entry) => [entry.id, entry]));
    const items: ModViewItem[] = [];
    const seen = new Set<string>();
    for (const mod of installed) {
        const market = marketById.get(mod.id) ?? null;
        const builtin = mod.tier === 'builtin' || mod.signature.status === 'builtin';
        const category = market?.category ?? null;
        const tags = market?.tags ?? [];
        seen.add(mod.id);
        items.push({
            key: `mod:${mod.id}`,
            id: mod.id,
            kind: 'mod',
            name: mod.name,
            description: mod.description ?? market?.description ?? null,
            author: mod.author ?? market?.author ?? null,
            version: mod.version,
            installed: mod,
            market,
            awesome: null,
            category,
            tags,
            // A newer version this Folia is too old for is not offered.
            hasUpdate: Boolean(market && UPDATABLE_TIERS.has(mod.tier ?? 'user') && compareModVersions(market.version, mod.version) > 0
                && market.hostRange !== 'too-old' && market.hostRange !== 'invalid'),
            rangeExpired: mod.error === 'host-range-expired',
            beta: mod.signature.status === 'beta' || market?.channel === 'beta',
            builtin,
            source: mod.kind === 'source',
            updatedAt: market?.updatedAt ?? null,
            searchText: words(mod.name, mod.id, mod.author, mod.description, market?.description, category, category ? categoryLabel(category) : null, tags),
        });
    }
    for (const market of catalog?.mods ?? []) {
        if (seen.has(market.id)) continue;
        items.push({
            key: `mod:${market.id}`,
            id: market.id,
            kind: 'mod',
            name: market.name,
            description: market.description,
            author: market.author,
            version: market.version,
            installed: null,
            market,
            awesome: null,
            category: market.category,
            tags: market.tags,
            hasUpdate: false,
            rangeExpired: false,
            beta: market.channel === 'beta',
            builtin: false,
            source: market.kind === 'source',
            updatedAt: market.updatedAt,
            searchText: words(market.name, market.id, market.author, market.description, market.category,
                market.category ? categoryLabel(market.category) : null, market.tags, market.owners.map((owner) => owner.login)),
        });
    }
    for (const awesome of catalog?.awesome ?? []) {
        items.push({
            key: `awesome:${awesome.id}`,
            id: awesome.id,
            kind: 'awesome',
            name: awesome.name,
            description: awesome.description,
            author: awesome.owners.map((owner) => owner.login).join(', ') || null,
            version: null,
            installed: null,
            market: null,
            awesome,
            category: awesome.category,
            tags: awesome.tags,
            hasUpdate: false,
            rangeExpired: false,
            beta: false,
            builtin: false,
            source: awesome.kind === 'source',
            updatedAt: awesome.updatedAt,
            searchText: words(awesome.name, awesome.id, awesome.description, awesome.kind, awesome.category,
                awesome.category ? categoryLabel(awesome.category) : null, awesome.tags, awesome.owners.map((owner) => owner.login)),
        });
    }
    return items;
};

/** Whether an item passes every filter and word of the query. */
export const matchesModsQuery = (item: ModViewItem, query: ModsQuery): boolean => {
    for (const filter of query.filters) {
        switch (filter) {
            case 'installed': if (!item.installed) return false; break;
            case 'updates': if (!item.hasUpdate) return false; break;
            case 'enabled': if (!item.installed || !isModOn(item.installed)) return false; break;
            case 'disabled': if (!item.installed || isModOn(item.installed)) return false; break;
            case 'builtin': if (!item.builtin) return false; break;
            case 'source': if (!item.source) return false; break;
            case 'beta': if (!item.beta) return false; break;
            case 'awesome': if (item.kind !== 'awesome') return false; break;
            case 'expired': if (!item.rangeExpired) return false; break;
        }
    }
    if (query.category && (item.category ?? 'other') !== query.category) return false;
    return query.words.every((word) => item.searchText.includes(word));
};

const byName = (a: ModViewItem, b: ModViewItem) => a.name.localeCompare(b.name);
const byUpdated = (a: ModViewItem, b: ModViewItem) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || byName(a, b);

export const sortModViewItems = (items: readonly ModViewItem[], sort: ModsSort): ModViewItem[] => (
    [...items].sort(sort === 'name' ? byName : byUpdated)
);

/*
 * The search results: one list, the installed ones first, then by the chosen order. A word that is the start
 * of the name ranks above one found elsewhere.
 */
export const searchModViewItems = (items: readonly ModViewItem[], query: ModsQuery, sort: ModsSort): ModViewItem[] => {
    const matched = items.filter((item) => matchesModsQuery(item, query));
    const first = query.words[0];
    const rank = (item: ModViewItem) => (item.installed ? 0 : 2) + (first && item.name.toLowerCase().startsWith(first) ? 0 : 1);
    const order = sort === 'name' ? byName : byUpdated;
    return matched.sort((a, b) => rank(a) - rank(b) || order(a, b));
};

/*
 * The list without a search: updates, mods held back by an expired range, everything installed, then the market's
 * mods not installed by category (in the catalog's order of categories, unknown ones under `other`), then awesome.
 * Empty sections are left out.
 */
export const sectionModViewItems = (
    items: readonly ModViewItem[],
    categories: readonly ModMarketCategory[],
    sort: ModsSort,
): ModsSection[] => {
    const sections: ModsSection[] = [];
    const mods = items.filter((item) => item.kind === 'mod');
    const installed = mods.filter((item) => item.installed);
    const updates = installed.filter((item) => item.hasUpdate);
    const expired = installed.filter((item) => item.rangeExpired);
    if (updates.length > 0) sections.push({ id: 'updates', items: sortModViewItems(updates, 'name') });
    if (expired.length > 0) sections.push({ id: 'expired', items: sortModViewItems(expired, 'name') });
    if (installed.length > 0) sections.push({ id: 'installed', items: sortModViewItems(installed, 'name') });
    const known = new Set(categories.map((category) => category.id));
    const byCategory = new Map<string, ModViewItem[]>();
    for (const item of mods) {
        if (item.installed) continue;
        const id = item.category && known.has(item.category) ? item.category : 'other';
        byCategory.set(id, [...(byCategory.get(id) ?? []), item]);
    }
    const order = [...categories.map((category) => category.id).filter((id) => id !== 'other'), 'other'];
    for (const id of order) {
        const list = byCategory.get(id);
        if (!list || list.length === 0) continue;
        sections.push({
            id: `category:${id}`,
            category: categories.find((category) => category.id === id) ?? null,
            items: sortModViewItems(list, sort),
        });
    }
    const awesome = items.filter((item) => item.kind === 'awesome');
    if (awesome.length > 0) sections.push({ id: 'awesome', items: sortModViewItems(awesome, sort) });
    return sections;
};

export { isEmptyModsQuery };
