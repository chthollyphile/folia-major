import { describe, expect, it } from 'vitest';
import {
    getGrid3DCardGeometryKey,
    getGrid3DItemsSignature,
    getGrid3DTargetScrollLeft,
    getGrid3DWindowRange,
    getGrid3DSliderDisplayName,
    getGrid3DSliderSecondaryText,
    getGrid3DSliderSummaryText,
    GRID3D_LEAP_CARDS,
    GRID3D_WINDOW_RADIUS,
    resolveGrid3DLeapPlan,
    resolveGrid3DTransitionMode,
    resolveGrid3DWheelInput,
} from '../../../src/components/folia-grid/Grid3DSlider';

// test/unit/gridView/grid3DSlider.test.ts
// Verifies collection cards use real descriptions instead of a hard-coded symbol.

describe('getGrid3DSliderSecondaryText', () => {
    it('uses the full local folder path as secondary text', () => {
        const folder = {
            type: 'folder',
            name: 'Astros/Classics/Cello',
            description: '本地',
        };

        expect(getGrid3DSliderDisplayName(folder)).toBe('Astros/…/Cello');
        expect(getGrid3DSliderSecondaryText(folder)).toBe('Astros/Classics/Cello');
    });

    it('keeps virtual folder labels unchanged', () => {
        const folder = {
            type: 'folder',
            name: '全部歌曲',
            description: '本地',
            isVirtual: true,
        };

        expect(getGrid3DSliderDisplayName(folder)).toBe('全部歌曲');
        expect(getGrid3DSliderSecondaryText(folder)).toBe('本地');
    });

    it('prefers a playlist summary and falls back to its description', () => {
        expect(getGrid3DSliderSecondaryText({
            type: 'playlist',
            description: 'Creator',
            summary: '猜你喜欢的歌单',
        })).toBe('猜你喜欢的歌单');
        expect(getGrid3DSliderSecondaryText({
            type: 'playlist',
            description: 'Creator',
            summary: '',
        })).toBe('Creator');
    });

    it('does not create placeholder text when metadata is absent', () => {
        expect(getGrid3DSliderSecondaryText({ type: 'playlist' })).toBe('');
    });

    it('does not render the same playlist summary twice', () => {
        expect(getGrid3DSliderSummaryText({
            type: 'playlist',
            description: '歌单',
            summary: '猜你喜欢的歌单',
        })).toBe('');
        expect(getGrid3DSliderSummaryText({
            type: 'album',
            description: '歌手',
            summary: '专辑简介',
        })).toBe('专辑简介');
    });
});

describe('getGrid3DCardGeometryKey', () => {
    // 12 cards, 1280px viewport, 218px covers, 531px edge padding.
    const baseline = getGrid3DCardGeometryKey(12, 1280, 218, 531);

    it('stays stable while only scrolling, so centers are measured once per layout', () => {
        expect(getGrid3DCardGeometryKey(12, 1280, 218, 531)).toBe(baseline);
    });

    it('changes when a breakpoint resizes the covers without changing the card count', () => {
        // The floating player lowers the isLargeDesktop height threshold, so coverSize flips 312 -> 218
        // at an unchanged viewport width. Keying on the count alone left the cached centers stale.
        expect(getGrid3DCardGeometryKey(12, 1280, 312, 484)).not.toBe(baseline);
    });

    it('changes when edge padding shifts every card without resizing them', () => {
        expect(getGrid3DCardGeometryKey(12, 1280, 218, 480)).not.toBe(baseline);
    });

    it('changes when the viewport is resized', () => {
        expect(getGrid3DCardGeometryKey(12, 960, 218, 531)).not.toBe(baseline);
    });

    it('changes when cards are appended by progressive loading', () => {
        expect(getGrid3DCardGeometryKey(42, 1280, 218, 531)).not.toBe(baseline);
    });
});

describe('getGrid3DWindowRange', () => {
    it('keeps a long slider bounded around the focused card', () => {
        expect(getGrid3DWindowRange(5_000, 10_000)).toEqual({ start: 4_982, end: 5_019 });
    });

    it('clamps the window at both list edges', () => {
        expect(getGrid3DWindowRange(0, 100)).toEqual({ start: 0, end: 19 });
        expect(getGrid3DWindowRange(99, 100)).toEqual({ start: 81, end: 100 });
    });
});

describe('resolveGrid3DWheelInput', () => {
    it('keeps small pixel deltas on the trackpad path', () => {
        expect(resolveGrid3DWheelInput(2.5, 12.25, 0, 1200)).toEqual({
            delta: 12.25,
            isDiscreteMouseWheel: false,
        });
    });

    it('recognizes and normalizes discrete mouse-wheel input', () => {
        expect(resolveGrid3DWheelInput(0, 100, 0, 1200)).toEqual({
            delta: 100,
            isDiscreteMouseWheel: true,
        });
        expect(resolveGrid3DWheelInput(0, 3, 1, 1200)).toEqual({
            delta: 96,
            isDiscreteMouseWheel: true,
        });
    });

    it('uses the dominant axis without changing trackpad direction', () => {
        expect(resolveGrid3DWheelInput(-18, 7, 0, 1200)).toEqual({
            delta: -18,
            isDiscreteMouseWheel: false,
        });
    });
});

describe('getGrid3DItemsSignature', () => {
    it('serializes item IDs safely', () => {
        const items = [{ id: 'album-1' }, { id: 'album-2' }];
        expect(getGrid3DItemsSignature(items)).toBe('["album-1","album-2"]');
    });

    it('prevents collision when IDs contain commas', () => {
        const singleItemWithComma = [{ id: 'rock, pop' }];
        const twoItemsSplit = [{ id: 'rock' }, { id: ' pop' }];

        expect(getGrid3DItemsSignature(singleItemWithComma)).not.toBe(
            getGrid3DItemsSignature(twoItemsSplit),
        );
    });
});

describe('getGrid3DTargetScrollLeft', () => {
    it('centers the card when within container bounds', () => {
        // containerWidth: 1000, scrollWidth: 3000, cardPitch: 266, coverSize: 218, edgePadding: 391
        // target = 391 + 2 * 266 + 109 - 500 = 532
        const target = getGrid3DTargetScrollLeft(2, 1000, 3000, 266, 218, 391);
        expect(target).toBe(532);
    });

    it('clamps to zero at the start of the list', () => {
        const target = getGrid3DTargetScrollLeft(0, 1200, 3000, 266, 218, 100);
        expect(target).toBe(0);
    });

    it('clamps to maxScrollLeft at the end of the list', () => {
        const target = getGrid3DTargetScrollLeft(50, 1000, 2000, 266, 218, 391);
        expect(target).toBe(1000);
    });
});

describe('resolveGrid3DTransitionMode', () => {
    it('returns "none" when the collection list changes (such as initial mount or tab switching)', () => {
        expect(resolveGrid3DTransitionMode({
            isListChanged: true,
            prevIndex: 0,
            nextIndex: 5,
        })).toBe('none');
    });

    it('returns "none" when clicking the same collection card (returning directly to A)', () => {
        expect(resolveGrid3DTransitionMode({
            isListChanged: false,
            prevIndex: 3,
            nextIndex: 3,
        })).toBe('none');
    });

    it('returns "none" when reduced motion is requested on uiMicroMotion surface', () => {
        expect(resolveGrid3DTransitionMode({
            isListChanged: false,
            prevIndex: 1,
            nextIndex: 3,
            reduceMicroMotion: true,
        })).toBe('none');
    });

    it('returns "direct" when navigating within virtual window radius', () => {
        expect(resolveGrid3DTransitionMode({
            isListChanged: false,
            prevIndex: 1,
            nextIndex: 7,
        })).toBe('direct');
        expect(resolveGrid3DTransitionMode({
            isListChanged: false,
            prevIndex: 0,
            nextIndex: GRID3D_WINDOW_RADIUS,
        })).toBe('direct');
    });

    it('returns "leap" for distant jumps exceeding window radius to provide smooth leap-in transition', () => {
        expect(resolveGrid3DTransitionMode({
            isListChanged: false,
            prevIndex: 0,
            nextIndex: GRID3D_WINDOW_RADIUS + 1,
        })).toBe('leap');
        expect(resolveGrid3DTransitionMode({
            isListChanged: false,
            prevIndex: 0,
            nextIndex: 50,
        })).toBe('leap');
    });
});

describe('resolveGrid3DLeapPlan', () => {
    it('computes forward leap staging index using default GRID3D_LEAP_CARDS', () => {
        const plan = resolveGrid3DLeapPlan({
            prevIndex: 0,
            nextIndex: 30,
            itemCount: 100,
        });

        expect(plan.direction).toBe(1);
        expect(plan.stagingIndex).toBe(30 - GRID3D_LEAP_CARDS);
    });

    it('computes backward leap staging index', () => {
        const plan = resolveGrid3DLeapPlan({
            prevIndex: 50,
            nextIndex: 10,
            itemCount: 100,
        });

        expect(plan.direction).toBe(-1);
        expect(plan.stagingIndex).toBe(10 + GRID3D_LEAP_CARDS);
    });

    it('clamps staging index when near list boundaries', () => {
        const atStart = resolveGrid3DLeapPlan({
            prevIndex: 0,
            nextIndex: 2,
            itemCount: 5,
            leapCards: 4,
        });
        expect(atStart.direction).toBe(1);
        expect(atStart.stagingIndex).toBe(0);

        const atEnd = resolveGrid3DLeapPlan({
            prevIndex: 10,
            nextIndex: 3,
            itemCount: 5,
            leapCards: 4,
        });
        expect(atEnd.direction).toBe(-1);
        expect(atEnd.stagingIndex).toBe(4);
    });

    it('supports custom leapCards count', () => {
        const plan = resolveGrid3DLeapPlan({
            prevIndex: 0,
            nextIndex: 30,
            itemCount: 100,
            leapCards: 6,
        });

        expect(plan.stagingIndex).toBe(24);
    });
});
