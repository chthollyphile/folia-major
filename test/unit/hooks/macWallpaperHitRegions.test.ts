import { describe, expect, it } from 'vitest';
import { wallpaperHitRects } from '../../../src/hooks/useMacWallpaperHitRegions';
import type { FoliumPlayerLayout } from '../../../src/mods/folium/contract';

// test/unit/hooks/macWallpaperHitRegions.test.ts
// Which parts of the player layout the macOS wallpaper click catchers cover (issue #698): the
// controls on screen, not the areas that only reveal hidden ones.

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

describe('wallpaperHitRects', () => {
    it('takes the controls and leaves the reveal areas', () => {
        const layout: FoliumPlayerLayout = {
            bounds: rect(0, 0, 1512, 982),
            insets: { top: 0, right: 0, bottom: 0, left: 0 },
            obstacles: [
                { role: 'playback', kind: 'control', rect: rect(500, 900, 512, 50) },
                { role: 'panel', kind: 'reveal-area', rect: rect(1300, 700, 212, 282) },
                { role: 'panel', kind: 'control', rect: rect(1432, 900, 80, 48) },
            ],
        };
        expect(wallpaperHitRects(layout)).toEqual([rect(500, 900, 512, 50), rect(1432, 900, 80, 48)]);
    });

    it('covers nothing outside the player view', () => {
        expect(wallpaperHitRects(null)).toEqual([]);
    });
});
