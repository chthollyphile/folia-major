import { describe, expect, it, vi } from 'vitest';
import { createIntlSegmenter, splitIntoGraphemes } from '@/utils/intlSegmenter';

// test/unit/utils/intlSegmenter.test.ts
// Verifies Segmenter access falls back safely on runtimes where WebView exposes a broken Intl.Segmenter.

describe('intlSegmenter', () => {
    it('returns null when Intl.Segmenter is missing', () => {
        vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });

        try {
            expect(createIntlSegmenter('grapheme')).toBeNull();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('returns null when Intl.Segmenter is not constructible', () => {
        vi.stubGlobal('Intl', { ...Intl, Segmenter: {} });

        try {
            expect(createIntlSegmenter('grapheme')).toBeNull();
            expect(splitIntoGraphemes('你好')).toEqual(['你', '好']);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
