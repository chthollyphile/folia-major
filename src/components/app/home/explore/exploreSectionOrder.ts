import type { OmniExploreSection } from '../../../../types/onlineMusic';

// Keep featured provider actions ahead of listening history on every Explore surface.
export const withOwnExploreSections = (
    provided: readonly OmniExploreSection[],
    own: readonly OmniExploreSection[],
): OmniExploreSection[] => [
    ...provided.filter(section => section.placement === 'first'),
    ...own,
    ...provided.filter(section => section.placement !== 'first'),
];
