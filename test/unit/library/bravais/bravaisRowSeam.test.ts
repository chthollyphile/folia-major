import { describe, expect, it } from 'vitest';
import {
    blockSeamPlanY,
    getSeamBoundaryY,
    getSeamCameraSpanY,
    getSeamGeometryY,
    getSeamSplitOffsets,
    nearestSeamBoundaryY,
} from '@/components/wall/seamPlan';
import { getFiniteCameraRange } from '@/components/wall/finiteWall';
import { resolveRevealCenter } from '@/components/wall/revealRect';
import { getViewWorldBounds } from '@/components/wall/wallView';
import { getBlockSize } from '@/components/wall/wallSlots';
import { planFlip } from '@/components/wall/flipPlan';
import { computeBravaisFrame, wallHintRowSpan, wallHintSpan } from '@/library/suites/bravais/bravaisFrame';
import { getPlateFrame, isAboveAnchor } from '@/library/suites/bravais/bravaisBlockPlate';
import { canReuseFinitePlan, planBravaisFinite } from '@/library/suites/bravais/bravaisFiniteWall';
import { anchorAxis, anchorOf, seamBoundsOf, seamPointOf } from '@/library/suites/bravais/bravaisAnchor';
import { resolveSeamAxis, resolveSeamTarget, resolveVariantWidth } from '@/library/suites/bravais/bravaisSeamTarget';
import { resolveSeamOpenWidth } from '@/library/suites/bravais/bravaisSeamLevel';
import {
    BRAVAIS_SEAM_FULL_WIDTH,
    BRAVAIS_SEAM_ROW_FULL_HEIGHT,
    BRAVAIS_SEAM_ROW_HOME_HEIGHT,
    BRAVAIS_SEAM_ROW_SPINE_HEIGHT,
} from '@/library/suites/bravais/bravaisConstants';
import { fitBravaisLayoutToShape, parseBravaisLayoutRecord } from '@/library/suites/bravais/bravaisLayoutMemory';
import { BRAVAIS_BLOCK_SHAPE } from '@/library/suites/bravais/bravaisWallShape';
import { resolveSeamRowFit } from '@/library/suites/bravais/useBravaisSeamRowFit';

// test/unit/library/bravais/bravaisRowSeam.test.ts
// 信息条横向：缝开在块行边界上（锚点是世界 y），墙上下分开。钉住 wall 引擎的 y 轴版本（块行边界、相机最小让位、贴边挤窄、
// 相机范围、露出矩形、从缝的上下沿翻牌）、bravais 的帧几何与底板、有限拼贴的复用、布局记忆，以及哪几套内容走横向。

const metrics = { cellSize: 128, gap: 8 };
const view = { width: 1200, height: 800, scale: 0.5 };
const block = getBlockSize(metrics);

describe('row seam geometry (wall engine)', () => {
    it('puts the boundary in the middle of the gap above a block row', () => {
        expect(getSeamBoundaryY(0, metrics)).toBe(-metrics.gap / 2);
        expect(getSeamBoundaryY(2, metrics)).toBe(2 * block.height - metrics.gap / 2);
        expect(nearestSeamBoundaryY(block.height * 0.6, metrics)).toBe(getSeamBoundaryY(1, metrics));
    });

    it('opens on the nearest row boundary and yields the camera vertically only as far as needed', () => {
        const boundary = getSeamBoundaryY(1, metrics);
        // The boundary already sits on the base line: no shift.
        const still = blockSeamPlanY({ cameraY: boundary, openWidth: 200, view, metrics });
        expect(still).toEqual({ y: boundary, cameraY: boundary, shift: 0 });
        // A boundary near the top edge: the camera moves just enough for the whole opening to fit.
        const cameraY = boundary + (400 - 50) / view.scale;
        const near = blockSeamPlanY({ cameraY, openWidth: 200, view, metrics, preferY: boundary });
        const screenY = 400 + (near.y - near.cameraY) * view.scale;
        expect(screenY).toBeCloseTo(100 + 14);
        expect(near.shift).toBeCloseTo(64);
    });

    it('squeezes the row near the top and bottom edges and collapses it off screen', () => {
        expect(getSeamGeometryY({ anchorY: 0, cameraY: 0, openWidth: 200, view })).toEqual({ screenY: 400, width: 200, collapsed: false, side: 'bottom' });
        const near = getSeamGeometryY({ anchorY: 0, cameraY: 600, openWidth: 200, view });
        expect(near.screenY).toBe(100);
        expect(near.width).toBe(2 * (100 - 14));
        expect(near.side).toBe('top');
        expect(getSeamGeometryY({ anchorY: 0, cameraY: 2000, openWidth: 200, view }).collapsed).toBe(true);
    });

    it('widens the culled bounds and the finite camera range on the vertical axis', () => {
        const plain = getViewWorldBounds({ x: 0, y: 0 }, view);
        const row = getViewWorldBounds({ x: 0, y: 0 }, view, { seamHeight: 200 });
        expect(row.left).toBe(plain.left);
        expect(row.top).toBe(plain.top - 200 / view.scale);
        expect(row.bottom).toBe(plain.bottom + 200 / view.scale);

        const span = getSeamCameraSpanY({ anchorY: 0, openWidth: 200, view });
        const range = getFiniteCameraRange({ contentBounds: null, anchor: { x: 10, y: 0 }, view, seamWidth: 200, seamAxis: 'y' });
        expect(range.minX).toBe(10);
        expect(range.maxX).toBe(10);
        expect(range.minY).toBeLessThanOrEqual(span.min);
        expect(range.maxY).toBeGreaterThanOrEqual(span.max);
    });

    it('reveals a rect below a row seam past the pushed-down half', () => {
        // Rect right under the seam line: the bottom half is pushed down by half the opening plus half a gap.
        const rect = { x: -40, y: 10, width: 80, height: 80 };
        const center = resolveRevealCenter({ rect, center: { x: 0, y: 0 }, view, metrics, anchorX: null, anchorY: 0, seamWidth: 200, bottomInset: 120 });
        const offset = getSeamSplitOffsets(200, view.scale, metrics).right;
        const bottomOnScreen = 400 + offset + (rect.y + rect.height - center.y) * view.scale;
        expect(bottomOnScreen).toBeLessThanOrEqual(800 - 120 + 1e-6);
        expect(center.x).toBe(0);
    });

    it('flips filter results outward from both edges of a row seam', () => {
        const slot = (key: string, centerY: number) => ({
            key, column: 0, row: 0, slotIndex: 0, x: 0, y: centerY - 10, width: 20, height: 20, centerX: 10, centerY, area: 1,
        });
        const plan = planFlip({
            changes: [{ slot: slot('far', 600), from: 'a', to: 'b' }, { slot: slot('near', -50), from: 'a', to: 'b' }],
            origin: { kind: 'seam-edges', y: 0 },
            visible: { left: -1000, right: 1000, top: -1000, bottom: 1000 },
            metrics,
        });
        expect(plan.flips.map(step => step.key)).toEqual(['near', 'far']);
        expect(plan.flips.every(step => step.direction === 1)).toBe(true);
    });
});

describe('row seam frame (bravais)', () => {
    it('pushes the top and bottom halves apart and draws the strip across the screen', () => {
        const frame = computeBravaisFrame({ center: { x: 0, y: 0 }, view, anchorX: null, anchorY: 0, openWidth: 200, contentWidth: 200, hidden: false });
        const offsets = getSeamSplitOffsets(200, view.scale, metrics);
        expect(frame.left).toEqual({ x: 600, y: 400 + offsets.left });
        expect(frame.right).toEqual({ x: 600, y: 400 + offsets.right });
        expect(frame.seam).toEqual({ axis: 'y', x: 600, y: 400, width: 200, visible: true });
        expect(frame.contentOpacity).toBe(1);
        expect(frame.tilt.deg).toBe(0);
    });

    it('keeps the edge tab on the left side when the row is folded or pushed off screen', () => {
        const folded = computeBravaisFrame({ center: { x: 0, y: 0 }, view, anchorX: null, anchorY: 0, openWidth: 0, contentWidth: 200, hidden: true });
        expect(folded.tab).toEqual({ visible: true, side: 'left' });
        const gone = computeBravaisFrame({ center: { x: 0, y: 3000 }, view, anchorX: null, anchorY: 0, openWidth: 200, contentWidth: 200, hidden: false });
        expect(gone.seam.visible).toBe(false);
        expect(gone.tab).toEqual({ visible: true, side: 'left' });
    });

    it('lays the empty-wall hint out in the taller of the two bands', () => {
        const frame = computeBravaisFrame({ center: { x: 0, y: 100 }, view, anchorX: null, anchorY: 0, openWidth: 200, contentWidth: 200, hidden: false });
        // The strip sits at 350 (centre), 250–450: the band below is taller.
        expect(wallHintRowSpan(frame, view.height)).toEqual({ top: 450, height: 350 });
        expect(wallHintSpan(frame, view.width)).toEqual({ left: 0, width: 1200 });
    });

    it('splits block plates by row and stops them at the strip edges', () => {
        const anchorY = getSeamBoundaryY(1, metrics);
        expect(isAboveAnchor(0, anchorY)).toBe(true);
        expect(isAboveAnchor(1, anchorY)).toBe(false);
        const above = getPlateFrame(0, 0, null, block, anchorY);
        expect(above.y + above.height).toBe(anchorY + metrics.gap / 2);
        const below = getPlateFrame(0, 1, null, block, anchorY);
        expect(below.y).toBe(anchorY - metrics.gap / 2);
    });

    it('reuses a finite plan only while the row anchor stays put', () => {
        const finite = planBravaisFinite({ count: 40, anchorX: null, anchorY: 0, center: { x: 300, y: 0 }, view });
        expect(finite.axis).toBe('y');
        expect(finite.origin).toEqual({ x: 300, y: 0 });
        expect(canReuseFinitePlan(finite, { anchorX: null, anchorY: 0, count: 40 })).toBe(true);
        expect(canReuseFinitePlan(finite, { anchorX: null, anchorY: 500, count: 40 })).toBe(false);
        // A column seam at the same coordinate is another plan.
        expect(canReuseFinitePlan(finite, { anchorX: 0, count: 40 })).toBe(false);
    });

    it('reads and fits a remembered row anchor', () => {
        const record = parseBravaisLayoutRecord(JSON.stringify({ center: { x: 0, y: 0 }, anchorX: null, anchorY: 13, startSlotKey: null, focusSlotKey: null }));
        expect(record?.anchorY).toBe(13);
        const fitted = fitBravaisLayoutToShape(record!, BRAVAIS_BLOCK_SHAPE);
        expect(fitted.anchorY).toBe(nearestSeamBoundaryY(13, metrics));
        expect(anchorAxis(anchorOf(fitted))).toBe('y');
    });

    it('measures the seam point and the culled bounds along the anchor axis', () => {
        expect(seamPointOf({ anchorX: null, anchorY: 40, center: { x: 5, y: 9 } })).toEqual({ x: 5, y: 40 });
        expect(seamPointOf({ anchorX: 70, anchorY: null, center: { x: 5, y: 9 } })).toEqual({ x: 70, y: 9 });
        expect(seamBoundsOf({ anchorY: 40, openWidth: 200 })).toEqual({ seamHeight: 200 });
        expect(seamBoundsOf({ anchorY: null, openWidth: 200 })).toEqual({ seamWidth: 200 });
    });
});

describe('which seams turn horizontal', () => {
    const base = { surface: 'collection' as const, level: 'full' as const, viewportWidth: 1440, horizontal: true };

    it('turns the info strips, spines and the home search into rows; panels, forms and posters stay columns', () => {
        expect(['home', 'home-spine', 'full', 'spine', 'search'].map(variant => resolveSeamAxis(variant as never, true))).toEqual(['y', 'y', 'y', 'y', 'y']);
        expect(['panel', 'form', 'poster'].map(variant => resolveSeamAxis(variant as never, true))).toEqual(['x', 'x', 'x']);
        expect(resolveSeamAxis('full', false)).toBe('x');
        expect(resolveSeamAxis('none', true)).toBeNull();
    });

    it('opens rows to the row heights', () => {
        expect(resolveSeamTarget(base)).toEqual({ width: BRAVAIS_SEAM_ROW_FULL_HEIGHT, variant: 'full' });
        expect(resolveSeamTarget({ ...base, level: 'spine' })).toEqual({ width: BRAVAIS_SEAM_ROW_SPINE_HEIGHT, variant: 'spine' });
        expect(resolveSeamTarget({ ...base, surface: 'home' })).toEqual({ width: BRAVAIS_SEAM_ROW_HOME_HEIGHT, variant: 'home' });
        expect(resolveSeamTarget({ ...base, surface: 'home', searchOpen: true })).toEqual({ width: BRAVAIS_SEAM_ROW_FULL_HEIGHT, variant: 'search' });
        expect(resolveSeamTarget({ ...base, formOpen: true })).toEqual({ width: BRAVAIS_SEAM_FULL_WIDTH, variant: 'form' });
        expect(resolveSeamOpenWidth('home', 'spine', 'y')).toBe(BRAVAIS_SEAM_ROW_SPINE_HEIGHT);
        expect(resolveVariantWidth('full', 1440, 'y')).toBe(BRAVAIS_SEAM_ROW_FULL_HEIGHT);
        expect(resolveVariantWidth('full', 1440, 'x')).toBe(BRAVAIS_SEAM_FULL_WIDTH);
    });
});

describe('home row fit (horizontal home strip)', () => {
    const nav = { titled: 700, untitled: 620, noShortcuts: 450, short: 200 };
    const account = { full: 150, compact: 34 };
    const fit = (available: number, extras = 0) => resolveSeamRowFit({ available, extras, nav, account });

    it('gives way in the same order as the vertical strip, the account name before the tab names', () => {
        expect(fit(900)).toEqual({ level: 'titled', shortcuts: true, accountCompact: false, overflowing: false });
        expect(fit(800)).toEqual({ level: 'untitled', shortcuts: true, accountCompact: false, overflowing: false });
        expect(fit(650)).toEqual({ level: 'untitled', shortcuts: false, accountCompact: false, overflowing: false });
        expect(fit(500)).toEqual({ level: 'untitled', shortcuts: false, accountCompact: true, overflowing: false });
        expect(fit(300)).toEqual({ level: 'short', shortcuts: false, accountCompact: true, overflowing: false });
    });

    it('scrolls the nav only when even single-character tabs do not fit', () => {
        expect(fit(200).overflowing).toBe(true);
        expect(fit(300, 80).overflowing).toBe(true);
    });

    it('counts nothing for a missing account', () => {
        expect(resolveSeamRowFit({ available: 700, extras: 0, nav, account: { full: 0, compact: 0 } }).level).toBe('titled');
    });
});
