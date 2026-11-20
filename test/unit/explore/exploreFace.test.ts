import { describe, expect, it } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OmniExploreItem } from '@/types/onlineMusic';
import { exploreCollectionLabelKey, faceOf } from '@/components/app/home/explore/exploreFace';

// Recommendation cards show their first song while retaining the collection's name and action.
const first: UnifiedSong = {
    id: 'first', name: 'First song', artists: [{ id: 'a', name: 'Artist A' }, { id: 'b', name: 'Artist B' }],
    album: { id: 'first-album', name: 'First album', coverUrl: 'https://example.test/first.jpg' }, durationMs: 120000,
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'first' },
};
const item = (firstSong = first): Extract<OmniExploreItem, { kind: 'collection' }> => ({
    kind: 'collection', subtitle: 'Nonstop radio',
    collection: { providerId: 'qq', id: 'personal_fm', type: 'radio', name: 'Recommended for You',
        coverUrl: 'https://example.test/fallback.jpg', songPreview: { firstSong } },
});

describe('Explore recommendation faces', () => {
    it('keeps the entry name and displays the first song and every artist with its album cover', () => {
        expect(faceOf(item(), key => key)).toMatchObject({
            title: 'Recommended for You', subtitle: 'First song — Artist A, Artist B',
            pictureUrl: first.album.coverUrl, coverUrl: first.album.coverUrl, shape: 'square', durationMs: 0,
        });
    });

    it('falls back to collection artwork when the preview lacks a cover', () => {
        const noCover = { ...first, album: { id: 'no-cover', name: 'No cover' } };
        expect(faceOf(item(noCover), key => key).coverUrl).toBe('https://example.test/fallback.jpg');
    });

    it('preserves an ordinary collection\'s intentional empty subtitle', () => {
        const ordinary = item();
        ordinary.subtitle = '';
        delete ordinary.collection.songPreview;
        expect(faceOf(ordinary, key => key).subtitle).toBe('');
    });

    it('labels radio and daily collections by their own action in every Explore view', () => {
        expect(exploreCollectionLabelKey(item())).toBe('home.radio');
        const daily = item();
        daily.collection.type = 'daily_recommendations';
        expect(exploreCollectionLabelKey(daily)).toBe('home.dailyRecommendations');
    });
});
