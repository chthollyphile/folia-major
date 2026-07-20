import { describe, expect, it } from 'vitest';
import {
    getGrid3DSliderSecondaryText,
    getGrid3DSliderSummaryText,
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
