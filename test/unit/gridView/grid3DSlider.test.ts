import { describe, expect, it } from 'vitest';
import {
    getGrid3DCardGeometryKey,
    getGrid3DSliderSecondaryText,
    getGrid3DSliderSummaryText,
    resolveGrid3DWheelInput,
} from '../../../src/components/folia-grid/Grid3DSlider';

// test/unit/gridView/grid3DSlider.test.ts
// Verifies collection cards use real descriptions instead of a hard-coded symbol.

describe('getGrid3DSliderSecondaryText', () => {
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
