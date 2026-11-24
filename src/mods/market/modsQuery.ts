// src/mods/market/modsQuery.ts
// The search box of the mods view, VS Code style: `@` filters and plain words, all of which must hold.
//   @installed @updates @enabled @disabled @builtin @source @beta @awesome @expired @category:<id>
// Anything else is a word, matched against the item's name, id, author, description, category and tags.

export const MODS_QUERY_FILTERS = [
    'installed', 'updates', 'enabled', 'disabled', 'builtin', 'source', 'beta', 'awesome', 'expired',
] as const;

export type ModsQueryFilter = typeof MODS_QUERY_FILTERS[number];

export type ModsQuery = {
    filters: ModsQueryFilter[];
    /** `@category:<id>`, lower-cased; the last one wins. */
    category: string | null;
    /** Lower-cased words. */
    words: string[];
};

const FILTERS = new Set<string>(MODS_QUERY_FILTERS);

export const parseModsQuery = (input: string): ModsQuery => {
    const filters: ModsQueryFilter[] = [];
    let category: string | null = null;
    const words: string[] = [];
    for (const raw of input.trim().split(/\s+/)) {
        const token = raw.toLowerCase();
        if (!token) continue;
        if (token.startsWith('@category:')) {
            const id = token.slice('@category:'.length);
            if (id) category = id;
            continue;
        }
        if (token.startsWith('@') && FILTERS.has(token.slice(1))) {
            const filter = token.slice(1) as ModsQueryFilter;
            if (!filters.includes(filter)) filters.push(filter);
            continue;
        }
        words.push(token);
    }
    return { filters, category, words };
};

export const isEmptyModsQuery = (query: ModsQuery): boolean => (
    query.filters.length === 0 && query.category === null && query.words.length === 0
);

/*
 * Puts a filter into the search text, or takes it out when it is already there (the filter menu's entries).
 * `@category:` replaces any category already in the text.
 */
export const toggleModsQueryToken = (input: string, token: string): string => {
    const parts = input.trim().split(/\s+/).filter(Boolean);
    const lower = token.toLowerCase();
    if (parts.some((part) => part.toLowerCase() === lower)) {
        return parts.filter((part) => part.toLowerCase() !== lower).join(' ');
    }
    const kept = lower.startsWith('@category:')
        ? parts.filter((part) => !part.toLowerCase().startsWith('@category:'))
        : parts;
    return [token, ...kept].join(' ');
};
