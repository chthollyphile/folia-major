import { describe, expect, it } from 'vitest';
import { computePlayerLayoutDemo } from '../../../dev/folium/player-layout-demo/client.mjs';

// test/unit/mod-system/playerLayoutDemo.test.ts
// Demo placement uses true 2D intersections, rather than reserving an obstacle's entire column.

const insets = { top: 56, right: 0, bottom: 0, left: 0 };
const bounds = { left: 0, top: 0, width: 1200, height: 800 };
const topObstacles = [
    { role: 'window', kind: 'reveal-area', rect: { left: 0, top: 0, width: 1200, height: 56 } },
    { role: 'navigation', kind: 'reveal-area', rect: { left: 0, top: 0, width: 120, height: 120 } },
];
describe('layout demo geometry', () => {
    it('does not move a top dialog away from a tall panel lower in the same column', () => {
        const panel = { left: 848, top: 272, width: 320, height: 488 };
        const layout = computePlayerLayoutDemo({ bounds, insets, obstacles: [...topObstacles, { role: 'panel', kind: 'control', rect: panel }] });
        expect(layout.dialog).toEqual({ left: 876, top: 80, width: 300, height: 96 });
        expect(layout.chat?.top).toBe(132);
    });
    it('moves away when the top dialog really overlaps the panel', () => {
        const panel = { left: 848, top: 96, width: 320, height: 640 };
        const layout = computePlayerLayoutDemo({ bounds, insets, obstacles: [...topObstacles, { role: 'panel', kind: 'control', rect: panel }] });
        expect(layout.dialog).toEqual({ left: 536, top: 80, width: 300, height: 96 });
    });
    it('honors all four safe insets even when no obstacle supplies the same reservation', () => {
        const safe = { top: 56, right: 40, bottom: 32, left: 20 };
        const layout = computePlayerLayoutDemo({ bounds, insets: safe, obstacles: [] });
        expect(layout.dialog).toEqual({ left: 836, top: 80, width: 300, height: 96 });
        expect(layout.chat).toEqual({ left: 44, top: 80, width: 300, height: 664 });
    });
    it('keeps compact chat and dialog from overlapping each other', () => {
        const compactBounds = { ...bounds, width: 600 };
        const layout = computePlayerLayoutDemo({ bounds: compactBounds, insets, obstacles: topObstacles });
        expect(layout.dialog).not.toBeNull();
        expect(layout.chat).not.toBeNull();
        expect(layout.chat!.top).toBeGreaterThanOrEqual(layout.dialog!.top + layout.dialog!.height + 12);
        expect(layout.chat!.top + layout.chat!.height).toBeLessThanOrEqual(776);
    });
});
