import { describe, expect, it } from 'vitest';
import {
    PLAYER_BOTTOM_BAR_BASE_OFFSET_PX,
    PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX,
    clampPlayerBottomBarOffset,
    resolvePlayerBottomBarMaxOffset,
    resolvePlayerBottomComponentBottomPx,
    resolvePlayerSubtitleBottomFromPresence,
    resolveUnscaledSubtitleBarOffset,
} from '../../../src/utils/playerBottomBarLayout';
import { frameStage, stageBelowBox } from '../../../src/components/visualizer/preview/previewScale';

// test/unit/utils/playerBottomBarLayout.test.ts

describe('resolvePlayerBottomBarMaxOffset', () => {
    it('keeps the expanded capsule below half the viewport', () => {
        // 900 / 2 = 450，减去展开态胶囊的 132
        expect(resolvePlayerBottomBarMaxOffset(900)).toBe(318);
    });

    it('collapses to the base offset on viewports too short to lift anything', () => {
        // 半屏减去胶囊高度已经低于基线，range 退化成一个点
        expect(resolvePlayerBottomBarMaxOffset(200)).toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    });

    it('falls back to the base offset for a missing or nonsense viewport', () => {
        expect(resolvePlayerBottomBarMaxOffset(0)).toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
        expect(resolvePlayerBottomBarMaxOffset(Number.NaN)).toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    });
});

describe('clampPlayerBottomBarOffset', () => {
    it('passes an in-range offset through', () => {
        expect(clampPlayerBottomBarOffset(200, 900)).toBe(200);
    });

    it('never goes below the original bottom-8 baseline', () => {
        expect(clampPlayerBottomBarOffset(0, 900)).toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
        expect(clampPlayerBottomBarOffset(-500, 900)).toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    });

    it('never lifts the capsule past half the screen', () => {
        expect(clampPlayerBottomBarOffset(10_000, 900)).toBe(318);
    });

    it('pins to the baseline when the viewport leaves no room', () => {
        expect(clampPlayerBottomBarOffset(300, 200)).toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    });

    it('treats non-finite input as the baseline rather than NaN', () => {
        expect(clampPlayerBottomBarOffset(Number.NaN, 900)).toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    });
});

describe('resolvePlayerBottomComponentBottomPx', () => {
    it('preserves each component original bottom at the default baseline', () => {
        expect(resolvePlayerBottomComponentBottomPx(32, 16)).toBe(16);
        expect(resolvePlayerBottomComponentBottomPx(32, 24)).toBe(24);
        expect(resolvePlayerBottomComponentBottomPx(32, 112)).toBe(112);
    });

    it('adds the same lift to bottom components on every page', () => {
        expect(resolvePlayerBottomComponentBottomPx(152, 16)).toBe(136);
        expect(resolvePlayerBottomComponentBottomPx(152, 24)).toBe(144);
        expect(resolvePlayerBottomComponentBottomPx(152, 112)).toBe(232);
    });
});

describe('resolvePlayerSubtitleBottomFromPresence', () => {
    // 拖动改 offset 要跟手，控制条出现/消失改 presence 要走 spring，
    // 所以这两段必须能分开插值。
    it('lands on the lifted clearance and the bare baseline at the two ends', () => {
        // 控制条在场：当前基线之上再留净空；不在场：没有让位对象，落回基线。
        expect(resolvePlayerSubtitleBottomFromPresence(200, 1))
            .toBe(200 + PLAYER_BOTTOM_BAR_SUBTITLE_CLEARANCE_PX);
        expect(resolvePlayerSubtitleBottomFromPresence(200, 0))
            .toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    });

    it('reproduces the original 112 at the baseline with the bar present', () => {
        expect(resolvePlayerSubtitleBottomFromPresence(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX, 1)).toBe(112);
    });

    it('interpolates the whole gap, lift included, midway through the transition', () => {
        // presence 0.5：基线 32 + 一半的 (168 抬高量 + 80 净空)
        expect(resolvePlayerSubtitleBottomFromPresence(200, 0.5)).toBe(32 + 0.5 * (168 + 80));
    });

    it('stays pinned to the baseline while the bar is absent, whatever the offset', () => {
        expect(resolvePlayerSubtitleBottomFromPresence(300, 0)).toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    });
});

describe('resolveUnscaledSubtitleBarOffset', () => {
    it('keeps the subtitle 112 box pixels up once the stage is scaled', () => {
        for (const scale of [1, 0.63, 0.4]) {
            const stageBottom = resolvePlayerSubtitleBottomFromPresence(resolveUnscaledSubtitleBarOffset(scale), 1);
            expect(stageBottom * scale).toBeCloseTo(112);
        }
    });

    it('keeps the subtitle 112 box pixels up on a zoomed stage cut below the box', () => {
        const box = { width: 1158, height: 1038 };
        for (const zoom of [1, 1.15, 1.3]) {
            const framed = frameStage({ width: 1840, height: 1160 }, box, 1, true, zoom)!;
            const { scale } = framed.place;
            const offset = resolveUnscaledSubtitleBarOffset(scale, stageBelowBox(framed, box));
            const subtitleBottomInStage = resolvePlayerSubtitleBottomFromPresence(offset, 1);
            const stageBottomInBox = framed.frame.top + framed.place.top + framed.stage.height * scale;
            expect(box.height - (stageBottomInBox - subtitleBottomInStage * scale)).toBeCloseTo(112);
        }
    });

    it('keeps the subtitle the distance asked for above the box\'s bottom', () => {
        const box = { width: 1158, height: 1038 };
        for (const zoom of [1.15, 1.3]) {
            const framed = frameStage({ width: 1840, height: 1160 }, box, 1, true, zoom)!;
            const { scale } = framed.place;
            const offset = resolveUnscaledSubtitleBarOffset(scale, stageBelowBox(framed, box), 90);
            const subtitleBottomInStage = resolvePlayerSubtitleBottomFromPresence(offset, 1);
            const stageBottomInBox = framed.frame.top + framed.place.top + framed.stage.height * scale;
            expect(box.height - (stageBottomInBox - subtitleBottomInStage * scale)).toBeCloseTo(90);
        }
    });

    it('keeps the lyric window\'s subtitle where the unzoomed stage put it, inside a wide box', () => {
        const windowSize = { width: 1840, height: 1160 };
        const box = { width: 1158, height: 655 };
        const unzoomedScale = frameStage(windowSize, box, 1, true)!.place.scale;
        for (const zoom of [1.15, 1.3]) {
            const framed = frameStage(windowSize, box, 1, true, zoom)!;
            const { scale } = framed.place;
            const offset = resolveUnscaledSubtitleBarOffset(scale, stageBelowBox(framed, box), 112 * (scale / zoom));
            const subtitleBottomInStage = resolvePlayerSubtitleBottomFromPresence(offset, 1);
            const stageBottomInBox = framed.frame.top + framed.place.top + framed.stage.height * scale;
            // The zoom crops the stage below the box; the subtitle still sits 112 x the unzoomed scale up.
            expect(stageBelowBox(framed, box)).toBeGreaterThan(2);
            expect(box.height - (stageBottomInBox - subtitleBottomInStage * scale)).toBeCloseTo(112 * unzoomedScale);
        }
    });

    it('is the baseline on an unscaled stage', () => {
        expect(resolveUnscaledSubtitleBarOffset(1)).toBe(PLAYER_BOTTOM_BAR_BASE_OFFSET_PX);
    });
});
