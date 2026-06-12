// src/utils/intlSegmenter.ts
// Guards Intl.Segmenter access so older Android WebView builds cannot crash app startup.

export const createIntlSegmenter = (
    granularity: Intl.SegmenterOptions['granularity']
): Intl.Segmenter | null => {
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
        return null;
    }

    try {
        return new Intl.Segmenter(undefined, { granularity });
    } catch {
        return null;
    }
};

export const splitIntoGraphemes = (text: string): string[] => {
    if (!text) {
        return [];
    }

    const segmenter = createIntlSegmenter('grapheme');
    if (!segmenter) {
        return Array.from(text);
    }

    return Array.from(segmenter.segment(text), ({ segment }) => segment);
};
