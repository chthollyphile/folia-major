import type { PonderTargetCategory } from '../../types/ponder';

// src/utils/ponder/ponderIndexFilter.ts
// What the index of lessons lists: everything, only what has not been watched, or one category;
// and inside that, what the search field's text is found in.

export type PonderIndexFilter = 'all' | 'unseen' | PonderTargetCategory;

type PonderIndexGroup<T> = { category: PonderTargetCategory; targets: T[] };

/**
 * The groups left by a filter and a search text, in their order; a group without a lesson left is
 * dropped. `textOf` gives what the search looks through for one lesson (its title and its line, as
 * they are shown); the match ignores case.
 */
export const filterPonderIndex = <T extends { id: string }>(
    groups: PonderIndexGroup<T>[],
    { filter, query, seen, textOf }: {
        filter: PonderIndexFilter;
        query: string;
        seen: ReadonlySet<string>;
        textOf: (target: T) => string;
    },
): PonderIndexGroup<T>[] => {
    const needle = query.trim().toLowerCase();
    return groups
        .filter(group => filter === 'all' || filter === 'unseen' || group.category === filter)
        .map(group => ({
            category: group.category,
            targets: group.targets.filter(target => (
                (filter !== 'unseen' || !seen.has(target.id))
                && (needle === '' || textOf(target).toLowerCase().includes(needle))
            )),
        }))
        .filter(group => group.targets.length > 0);
};
