import { describe, expect, it } from 'vitest';
import { resolveRevealCenter } from '../../../src/components/wall/revealRect';
import { getSeamGeometry } from '../../../src/components/wall/seamPlan';
import type { WallView } from '../../../src/components/wall/wallView';

// test/unit/wall/revealRect.test.ts
// 聚焦卡 / 键盘焦点的「相机最小平移」（原型 revealRect 的移植）：矩形已在屏内时不动；只挪到刚好露出；
// 两者都放得下时缝留在屏内；底边避开播放条安全区；放不下时矩形优先。

const metrics = { cellSize: 128, gap: 8 };
const view: WallView = { width: 1200, height: 800, scale: 0.5 };
const screenX = (worldX: number, centerX: number) => view.width / 2 + (worldX - centerX) * view.scale;
const screenY = (worldY: number, centerY: number) => view.height / 2 + (worldY - centerY) * view.scale;

describe('resolveRevealCenter', () => {
    it('leaves the camera alone when the rect is already on screen', () => {
        const center = { x: 0, y: 0 };
        const rect = { x: -100, y: -100, width: 200, height: 200 };
        expect(resolveRevealCenter({ rect, center, view, metrics, anchorX: null, seamWidth: 0 })).toEqual(center);
    });

    it('moves just enough to bring an off-screen rect inside the padding', () => {
        const center = { x: 0, y: 0 };
        const rect = { x: 1500, y: -50, width: 400, height: 100 };
        const next = resolveRevealCenter({ rect, center, view, metrics, anchorX: null, seamWidth: 0, pad: 24 });
        // 右边缘正好落在视口右边距上，纵向不动。
        expect(screenX(rect.x + rect.width, next.x)).toBeCloseTo(view.width - 24);
        expect(next.y).toBe(0);
    });

    it('keeps the bottom edge above the player bar safe area', () => {
        const center = { x: 0, y: 0 };
        const rect = { x: -100, y: 500, width: 200, height: 200 };
        const next = resolveRevealCenter({ rect, center, view, metrics, anchorX: null, seamWidth: 0, pad: 24, bottomInset: 120 });
        expect(screenY(rect.y + rect.height, next.y)).toBeCloseTo(view.height - 120);
    });

    it('centres a rect that already shows when asked to: across, and between the top margin and the player bar', () => {
        const center = { x: 0, y: 0 };
        const rect = { x: 300, y: 100, width: 200, height: 200 };
        const next = resolveRevealCenter({ rect, center, view, metrics, anchorX: null, seamWidth: 0, pad: 24, bottomInset: 120, centered: true });
        expect(screenX(rect.x + rect.width / 2, next.x)).toBeCloseTo(view.width / 2);
        expect(screenY(rect.y + rect.height / 2, next.y)).toBeCloseTo((24 + view.height - 120) / 2);
    });

    it('keeps an open seam on screen when the rect allows it', () => {
        const center = { x: 0, y: 0 };
        const anchorX = 0;
        const rect = { x: 900, y: -50, width: 300, height: 100 };
        const next = resolveRevealCenter({ rect, center, view, metrics, anchorX, seamWidth: 300, pad: 24 });
        const seam = getSeamGeometry({ anchorX, cameraX: next.x, openWidth: 300, view });
        expect(seam.collapsed).toBe(false);
        expect(seam.width).toBe(300);
    });

    it('prefers the rect when rect and seam cannot both fit', () => {
        const center = { x: 0, y: 0 };
        const anchorX = -2000;
        const rect = { x: 1800, y: -50, width: 300, height: 100 };
        const next = resolveRevealCenter({ rect, center, view, metrics, anchorX, seamWidth: 300, pad: 24 });
        // 矩形在右半边：屏幕位置还要加上断开模式下右半边的让位。
        expect(screenX(rect.x + rect.width, next.x)).toBeLessThanOrEqual(view.width);
    });
});
