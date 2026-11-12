import { describe, expect, it } from 'vitest';
import { SEAM_EDGE_MARGIN } from '@/components/wall/seamPlan';
import { getViewLineX } from '@/components/wall/wallView';
import { computeBravaisFrame, planPosterOpening, tiltEdgeRoom, type BravaisFrameInput } from '@/library/suites/bravais/bravaisFrame';
import { BRAVAIS_SEAM_FULL_WIDTH } from '@/library/suites/bravais/bravaisConstants';
import { tiltedScreenBox, resolveTiltedRevealCenter } from '@/library/suites/bravais/bravaisTiltReveal';

// test/unit/library/bravais/bravaisTiltReveal.test.ts
// 海报在场时的键盘让位：按倾斜后画出来的样子让磁贴完整可见（左右也挪，不再只上下）；能让海报整张张开时优先，往回走时
// 海报重新张开。倾斜的信息条（集合页、首页给了倾斜角时）走同一套算法，只是缝贴边要留边距。

const view = { width: 1600, height: 900, scale: 0.76 };
const POSTER = 680;
const PAD = 24;
const INSET = 96;
const plan = planPosterOpening({ center: { x: 0, y: 0 }, view, width: POSTER });

const frameAt = (center = plan.center, tiltDeg = -10): BravaisFrameInput => ({
    center,
    view,
    anchorX: plan.anchorX,
    openWidth: POSTER,
    contentWidth: POSTER,
    hidden: false,
    poster: true,
    tiltDeg,
});

const tile = (dx: number, dy: number) => ({ x: plan.anchorX + dx, y: plan.center.y + dy, width: 200, height: 200 });

const reveal = (rect: ReturnType<typeof tile>, frame = frameAt()) => resolveTiltedRevealCenter({
    rect,
    frame,
    seamWidth: POSTER,
    pad: PAD,
    bottomInset: INSET,
});

const expectOnScreen = (rect: ReturnType<typeof tile>, frame: BravaisFrameInput) => {
    const box = tiltedScreenBox(rect, frame);
    expect(box.left).toBeGreaterThanOrEqual(PAD - 1);
    expect(box.right).toBeLessThanOrEqual(view.width - PAD + 1);
    expect(box.top).toBeGreaterThanOrEqual(PAD - 1);
    expect(box.bottom).toBeLessThanOrEqual(view.height - INSET + 1);
};

describe('poster reveal', () => {
    it('stays put when the tile already shows beside the open poster', () => {
        const rect = tile(150, -100);
        expectOnScreen(rect, frameAt());
        expect(reveal(rect)).toEqual(plan.center);
    });

    it('pans right to a tile past the right edge, measured on the tilted wall', () => {
        const rect = tile(3000, -100);
        expect(tiltedScreenBox(rect, frameAt()).right).toBeGreaterThan(view.width);
        const next = reveal(rect);
        expect(next.x).toBeGreaterThan(plan.center.x);
        expectOnScreen(rect, frameAt(next));
    });

    it('follows a tile that the tilt lifts above the top edge', () => {
        // 倾斜 −10° 时右边的磁贴被抬高：没倾斜时看得见的，倾斜后可能出了上缘。
        const rect = tile(1100, -480);
        expect(tiltedScreenBox(rect, frameAt(plan.center, 0)).top).toBeGreaterThan(-1);
        expect(tiltedScreenBox(rect, frameAt()).top).toBeLessThan(PAD);
        const next = reveal(rect);
        expectOnScreen(rect, frameAt(next));
    });

    it('reopens the poster when coming back to a tile that fits beside it', () => {
        const far = reveal(tile(3000, -100));
        const rect = tile(150, -100);
        const back = reveal(rect, frameAt(far));
        expect(back.x).toBeCloseTo(plan.center.x, 3);
        expectOnScreen(rect, frameAt(back));
    });

    it('works without the tilt (reduced motion)', () => {
        const rect = tile(3000, 600);
        const next = reveal(rect, frameAt(plan.center, 0));
        expectOnScreen(rect, frameAt(next, 0));
    });
});

describe('tilted info strip reveal', () => {
    // 集合页的信息条开在视口中间的一条块边界上、整层倾斜 −6°（不是海报：贴着视口边会收窄）。
    const STRIP = BRAVAIS_SEAM_FULL_WIDTH;
    const anchorX = 0;
    const home = { x: 0, y: 0 };
    const stripFrame = (center = home, tiltDeg = -6): BravaisFrameInput => ({
        center,
        view,
        anchorX,
        openWidth: STRIP,
        contentWidth: STRIP,
        hidden: false,
        tiltDeg,
    });
    const stripReveal = (rect: ReturnType<typeof tile>, frame = stripFrame()) => resolveTiltedRevealCenter({
        rect,
        frame,
        seamWidth: STRIP,
        pad: PAD,
        bottomInset: INSET,
    });
    const tileAt = (dx: number, dy: number) => ({ x: anchorX + dx, y: dy, width: 200, height: 200 });

    it('stays put when the tile already shows on the tilted wall', () => {
        const rect = tileAt(300, -100);
        expectOnScreen(rect, stripFrame());
        expect(stripReveal(rect)).toEqual(home);
    });

    it('follows a tile that only the tilt pushes off the bottom edge', () => {
        // 缝左边的磁贴被倾斜压低：没倾斜时在安全区之上，倾斜后出了下缘。
        const rect = tileAt(-900, 240);
        expect(tiltedScreenBox(rect, stripFrame(home, 0)).bottom).toBeLessThanOrEqual(view.height - INSET);
        expect(tiltedScreenBox(rect, stripFrame()).bottom).toBeGreaterThan(view.height - INSET);
        const next = stripReveal(rect);
        expectOnScreen(rect, stripFrame(next));
    });

    it('reopens the strip, edge margin included, when coming back to a tile that fits beside it', () => {
        // 相机在右边：缝被视口左边挤窄了（中线在屏幕 x = 100，整条张开要 150 + 边距）。磁贴就在缝右边、本来就看得见，
        // 不用挪也行；能让缝整条张开时挪到那里——缝的左缘离视口左边正好留出 SEAM_EDGE_MARGIN 加倾斜要的那一段。
        const squeezed = { x: anchorX + (getViewLineX(view) - 100) / view.scale, y: 0 };
        expect(computeBravaisFrame(stripFrame(squeezed)).seam.width).toBeLessThan(STRIP - 1);
        const rect = tileAt(300, -100);
        expectOnScreen(rect, stripFrame(squeezed));
        const next = stripReveal(rect, stripFrame(squeezed));
        expect(next.x).toBeLessThan(squeezed.x);
        expectOnScreen(rect, stripFrame(next));
        const drawn = computeBravaisFrame(stripFrame(next));
        expect(drawn.seam.width).toBeCloseTo(STRIP);
        // 倾斜着多留一段：转过去的上端不横着出屏。
        expect(drawn.seam.x - drawn.seam.width / 2).toBeCloseTo(SEAM_EDGE_MARGIN + tiltEdgeRoom(view.height, -6), 0);
    });

    it('lets the strip go when the tile is too far to show beside it', () => {
        const rect = tileAt(4000, -100);
        const next = stripReveal(rect);
        expectOnScreen(rect, stripFrame(next));
        expect(computeBravaisFrame(stripFrame(next)).seam.width).toBeLessThan(STRIP);
    });
});
