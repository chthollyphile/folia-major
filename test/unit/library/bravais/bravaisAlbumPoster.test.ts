import { describe, expect, it } from 'vitest';
import type { LibraryCollectionDescriptor } from '@/library/core/collection/collection.contract';
import { formatAlbumDuration, projectBravaisSeamAlbum } from '@/library/suites/bravais/bravaisAlbumModel';
import { resolveAlbumComposition } from '@/library/suites/bravais/bravaisPosterComposition';
import { albumPaletteVars, resolveBravaisAlbumPalette } from '@/library/suites/bravais/bravaisPosterPalette';
import { parseColorChannels } from '@/components/visualizer/colorMix';

// test/unit/library/bravais/bravaisAlbumPoster.test.ts
// 专辑海报：信息只有专辑类型的集合有（详情盖在描述上、年份可以从发行时间里取）；构图按专辑定死；颜色是浅纸底、深色块，
// 强调色挑封面上又饱和、又和色块差得开的那个。

const labels = { kind: '专辑', trackCount: (count: number) => `${count} 首` };
const collection = (patch: Partial<LibraryCollectionDescriptor>) => ({ id: 'c', name: 'Cedar', type: 'album', ...patch }) as unknown as LibraryCollectionDescriptor;

describe('album seam projection', () => {
    it('only exists for albums', () => {
        expect(projectBravaisSeamAlbum({ collection: collection({ type: 'playlist' }), detail: null, trackCount: 3, labels })).toBeUndefined();
        expect(projectBravaisSeamAlbum({ collection: collection({}), detail: null, trackCount: 0, labels })).toEqual({
            coverUrl: undefined, artists: [], kicker: '专辑', facts: [],
        });
    });

    it('lays the detail over the descriptor and reads the year from the release time', () => {
        const album = projectBravaisSeamAlbum({
            collection: collection({ coverUrl: 'a.jpg', artists: [{ id: '1', name: 'Old' }] } as Partial<LibraryCollectionDescriptor>),
            detail: { artists: [{ id: '2', name: 'Singer' }], publishedAt: Date.UTC(2021, 5, 1), albumDuration: 1830_000, albumGenre: 'Dream Pop' } as never,
            trackCount: 10,
            labels,
        });
        expect(album).toEqual({ coverUrl: 'a.jpg', artists: ['Singer'], kicker: '专辑 · 2021', facts: ['10 首', '30:30', 'Dream Pop'] });
    });

    it('formats durations in seconds or milliseconds', () => {
        expect(formatAlbumDuration(245)).toBe('4:05');
        expect(formatAlbumDuration(3_725_000)).toBe('1:02:05');
        expect(formatAlbumDuration(undefined)).toBe('');
    });
});

describe('album poster composition', () => {
    it('is fixed per album and keeps the divider in the middle band', () => {
        expect(resolveAlbumComposition('album:x')).toEqual(resolveAlbumComposition('album:x'));
        for (let index = 0; index < 40; index += 1) {
            const { divider, coverDeg } = resolveAlbumComposition(`album:${index}`);
            expect(Math.min(divider.left, divider.right)).toBeGreaterThanOrEqual(44);
            expect(Math.max(divider.left, divider.right)).toBeLessThanOrEqual(62);
            expect(Math.abs(coverDeg)).toBeGreaterThanOrEqual(2.5);
        }
    });
});

describe('album palette', () => {
    const luminance = (color: string) => {
        const { r, g, b } = parseColorChannels(color)!;
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };

    it('needs at least two colours', () => {
        expect(resolveBravaisAlbumPalette(['#223366'])).toBeNull();
        expect(albumPaletteVars(null)).toEqual({});
    });

    it('puts light paper over a dark block and picks a vivid accent away from the block', () => {
        const palette = resolveBravaisAlbumPalette(['#2a3a6e', '#1c2850', '#e8e2d2', '#e4572e'])!;
        expect(luminance(palette.paper)).toBeGreaterThan(200);
        expect(luminance(palette.block)).toBeLessThan(80);
        const { r, g, b } = parseColorChannels(palette.accent)!;
        expect(r).toBeGreaterThan(g + 40);
        expect(r).toBeGreaterThan(b + 40);
        expect(albumPaletteVars(palette)['--bravais-album-accent']).toBe(palette.accent);
    });
});
