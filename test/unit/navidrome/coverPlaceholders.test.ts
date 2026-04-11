import { describe, expect, it, vi } from 'vitest';
import {
    createCoverPlaceholder,
    pickRandomSongCoverUrl,
    resolveNavidromeArtistCoverUrl,
} from '@/utils/coverPlaceholders';

describe('coverPlaceholders', () => {
    it('creates a light-blue svg placeholder data url', () => {
        const placeholder = createCoverPlaceholder('Artist Name', 'artist');
        const decoded = decodeURIComponent(placeholder);

        expect(placeholder.startsWith('data:image/svg+xml')).toBe(true);
        expect(decoded).toContain('<svg');
        expect(decoded).toContain('linearGradient');
        expect(decoded).toContain('stop-color="#e0f2fe"');
    });

    it('prefers artistImageUrl over coverArt for navidrome artists', () => {
        const getCoverArtUrl = vi.fn((coverArtId: string, size?: number) => `cover:${coverArtId}:${size}`);

        const resolved = resolveNavidromeArtistCoverUrl({
            artistImageUrl: 'https://img.test/artist.jpg',
            coverArt: 'artist-cover',
        }, getCoverArtUrl, 512);

        expect(resolved).toBe('https://img.test/artist.jpg');
        expect(getCoverArtUrl).not.toHaveBeenCalled();
    });

    it('falls back to coverArt when artistImageUrl is unavailable', () => {
        const getCoverArtUrl = vi.fn((coverArtId: string, size?: number) => `cover:${coverArtId}:${size}`);

        const resolved = resolveNavidromeArtistCoverUrl({
            coverArt: 'artist-cover',
        }, getCoverArtUrl, 512);

        expect(resolved).toBe('cover:artist-cover:512');
        expect(getCoverArtUrl).toHaveBeenCalledWith('artist-cover', 512);
    });

    it('samples up to three songs and returns the first hit with coverArt', () => {
        const randomSpy = vi.spyOn(Math, 'random');
        randomSpy
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);

        const getCoverArtUrl = vi.fn((coverArtId: string, size?: number) => `cover:${coverArtId}:${size}`);
        const resolved = pickRandomSongCoverUrl([
            {},
            {},
            { coverArt: 'hit-cover' },
            { coverArt: 'unused-cover' },
        ], getCoverArtUrl, 600, 3);

        expect(resolved).toBe('cover:hit-cover:600');
        expect(getCoverArtUrl).toHaveBeenCalledTimes(1);

        randomSpy.mockRestore();
    });

    it('returns undefined when three attempts do not find any cover art', () => {
        const randomSpy = vi.spyOn(Math, 'random');
        randomSpy
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(0);

        const getCoverArtUrl = vi.fn();
        const resolved = pickRandomSongCoverUrl([
            {},
            {},
            {},
            { coverArt: 'fourth-cover' },
        ], getCoverArtUrl, 600, 3);

        expect(resolved).toBeUndefined();
        expect(getCoverArtUrl).not.toHaveBeenCalled();

        randomSpy.mockRestore();
    });
});
