import { describe, expect, it } from 'vitest';
import type { OmniExploreSection } from '@/types/onlineMusic';
import { withOwnExploreSections } from '@/components/app/home/explore/exploreSectionOrder';
import { buildExploreTiles } from '@/components/app/lattice/exploreWall';
import { projectExploreShortcuts } from '@/library/suites/bravais/bravaisExploreProjection';

// Featured recommendation actions remain visible ahead of history and retain their own names.
const featured: OmniExploreSection = {
    id: 'featured', title: 'For you', placement: 'first', items: [{
        kind: 'collection', collection: {
            providerId: 'probe', id: 'personal_fm', type: 'radio', name: 'Recommended for You',
            coverUrl: '', personalFm: { mode: 'DEFAULT', scene: null },
        },
    }, {
        kind: 'collection', collection: {
            providerId: 'probe', id: 'daily_recommendations', type: 'daily_recommendations', name: 'Daily 30', coverUrl: '',
        },
    }],
};
const section = (id: string): OmniExploreSection => ({ id, title: id, items: [] });

describe('Explore section placement', () => {
    it('puts featured actions before history without changing ordinary section order', () => {
        const provided = [section('old-first'), featured, section('old-second')];
        const own = [section('recent'), section('again')];
        expect(withOwnExploreSections(provided, own).map(value => value.id))
            .toEqual(['featured', 'recent', 'again', 'old-first', 'old-second']);
        expect(provided.map(value => value.id)).toEqual(['old-first', 'featured', 'old-second']);
        expect(withOwnExploreSections([section('ordinary')], own).map(value => value.id))
            .toEqual(['recent', 'again', 'ordinary']);
    });

    it('uses the featured collection names for the visible Explore shortcuts', () => {
        const tiles = buildExploreTiles([featured], key => key);
        const shortcuts = projectExploreShortcuts(tiles, [featured]);
        expect(shortcuts).toMatchObject([
            { special: 'personal-fm', label: 'Recommended for You', shortLabel: 'Recommended for You', pinned: true, direct: true },
            { special: 'daily', label: 'Daily 30', shortLabel: 'Daily 30', pinned: true, direct: false },
        ]);
        expect(shortcuts.map(value => value.itemKey)).toEqual(tiles.map(tile => tile.id));
        expect(projectExploreShortcuts(tiles, [{ ...featured, placement: undefined }])).toEqual([]);
        const translated = { ...featured, items: featured.items.map((item, index) => item.kind === 'collection'
            ? { ...item, collection: { ...item.collection, name: index === 0 ? '猜你喜欢' : '每日30首' } }
            : item) };
        expect(projectExploreShortcuts(buildExploreTiles([translated], key => key), [translated]).map(value => value.shortLabel))
            .toEqual(['猜你喜欢', '每日30首']);
    });
});
