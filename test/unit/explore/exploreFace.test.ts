import { describe, expect, it } from 'vitest';
import type { UnifiedSong } from '@/types';
import type { OmniExploreItem } from '@/types/onlineMusic';
import { faceOf } from '@/components/app/home/explore/exploreFace';

// Recommendation artwork and copy use the first/current song without changing the collection action's name.
const first: UnifiedSong = {
    id: 'first', name: 'First song', artists: [{ id: 'a', name: 'Artist A' }, { id: 'b', name: 'Artist B' }],
    album: { id: 'first-album', name: 'First album', coverUrl: 'https://example.test/first.jpg' }, durationMs: 120000,
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'first' },
};
const item = (currentSong?: UnifiedSong): OmniExploreItem => ({
    kind: 'collection', subtitle: 'Nonstop radio',
    collection: { providerId: 'qq', id: 'personal_fm', type: 'radio', name: 'Recommended for You',
        coverUrl: 'https://example.test/fallback.jpg', songPreview: { firstSong: first, currentSong } },
});

describe('Explore recommendation faces', () => {
    it('keeps the entry name and displays the first song and every artist with its album cover', () => {
        expect(faceOf(item(), key => key)).toMatchObject({
            title: 'Recommended for You', subtitle: 'First song — Artist A, Artist B',
            pictureUrl: first.album.coverUrl, coverUrl: first.album.coverUrl, shape: 'square', durationMs: 0,
        });
    });

    it('prefers a source-validated current song and passes on the declared cover branding', () => {
        const current = { ...first, name: 'Current song', album: { id: 'current-album', name: 'Current album', coverUrl: 'https://example.test/current.jpg' } };
        const daily = item(current);
        if (daily.kind !== 'collection') throw new Error('Expected a collection fixture');
        daily.collection.coverOverlay = { label: 'Daily 30', logoUrl: '/daily-mark.svg' };
        expect(faceOf(daily, key => key)).toMatchObject({ subtitle: 'Current song — Artist A, Artist B',
            coverUrl: current.album.coverUrl, coverOverlay: daily.collection.coverOverlay });
    });

    it('falls back to collection artwork when the preview lacks a cover', () => {
        const noCover = { ...first, album: { id: 'no-cover', name: 'No cover' } };
        expect(faceOf(item(noCover), key => key).coverUrl).toBe('https://example.test/fallback.jpg');
    });

    it('preserves an ordinary collection\'s intentional empty subtitle', () => {
        const ordinary = item();
        if (ordinary.kind !== 'collection') throw new Error('Expected a collection fixture');
        ordinary.subtitle = '';
        delete ordinary.collection.songPreview;
        expect(faceOf(ordinary, key => key).subtitle).toBe('');
    });
});
