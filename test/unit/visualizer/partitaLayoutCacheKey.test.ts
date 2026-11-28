import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTITA_TUNING, type Line, type Theme } from '@/types';
import { buildPartitaLayoutCacheKey, PartitaLayoutCache } from '@/components/visualizer/partita/partitaLayout';

// test/unit/visualizer/partitaLayoutCacheKey.test.ts
// Partita keeps built columns in a Map bounded only by an LRU, so anything that changes the
// layout has to change the key or a line already on screen keeps its stale columns.
const line = (fullText: string, wordSegments?: string[]): Line => ({
    id: 'line-1',
    startTime: 0,
    endTime: 4,
    fullText,
    words: Array.from(fullText, (text, index) => ({ text, startTime: index, endTime: index + 1 })),
    isChorus: false,
    wordSegments,
});

const theme = { animationIntensity: 'calm', fontWeight: 600 } as unknown as Theme;

const key = (source: Line) => buildPartitaLayoutCacheKey(source, theme, 900, DEFAULT_PARTITA_TUNING);

describe('buildPartitaLayoutCacheKey', () => {
    it('separates a saved word segmentation from the default split', () => {
        expect(key(line('把回忆拼好给你', ['把', '回忆', '拼好', '给', '你'])))
            .not.toBe(key(line('把回忆拼好给你')));
    });

    it('separates two segmentations of the same line', () => {
        expect(key(line('把回忆拼好给你', ['把回忆', '拼好', '给你'])))
            .not.toBe(key(line('把回忆拼好给你', ['把', '回忆', '拼好', '给', '你'])));
    });

    it('separates a moved boundary that keeps the segment count', () => {
        expect(key(line('把回忆拼好给你', ['把', '回忆拼', '好', '给', '你'])))
            .not.toBe(key(line('把回忆拼好给你', ['把', '回忆', '拼好', '给', '你'])));
    });

    it('stays stable for the same line and segmentation', () => {
        expect(key(line('把回忆', ['把', '回忆']))).toBe(key(line('把回忆', ['把', '回忆'])));
    });
});

describe('PartitaLayoutCache', () => {
    it('reuses the last request without reading the text on each playback tick', () => {
        const source = line('把回忆拼好给你', ['把回忆', '拼好', '给你']);
        let reads = 0;
        const upcoming = {
            ...source,
            get fullText() {
                reads += 1;
                return source.fullText;
            },
        };
        const cache = new PartitaLayoutCache();
        const layout = cache.getOrBuild(upcoming, theme, 900, DEFAULT_PARTITA_TUNING);
        const initialReads = reads;

        for (let tick = 0; tick < 60; tick += 1) {
            expect(cache.getOrBuild(upcoming, theme, 900, DEFAULT_PARTITA_TUNING)).toBe(layout);
        }
        expect(initialReads).toBeGreaterThan(0);
        expect(reads).toBe(initialReads);
        expect(cache.getOrBuild(source, theme, 900, DEFAULT_PARTITA_TUNING)).toBe(layout);
    });

    it('keeps the keyed cache behavior across line, viewport, theme and tuning changes', () => {
        const cache = new PartitaLayoutCache();
        const source = line('把回忆拼好给你', ['把回忆', '拼好', '给你']);
        const resegmented = line(source.fullText, ['把', '回忆', '拼好', '给', '你']);
        const chaotic = { ...theme, animationIntensity: 'chaotic' } satisfies Theme;
        const tuning = { ...DEFAULT_PARTITA_TUNING, staggerMin: 90, staggerMax: 90 };
        const original = cache.getOrBuild(source, theme, 900, DEFAULT_PARTITA_TUNING);

        expect(cache.getOrBuild(resegmented, theme, 900, DEFAULT_PARTITA_TUNING)).not.toBe(original);
        expect(cache.getOrBuild(source, theme, 600, DEFAULT_PARTITA_TUNING)).not.toBe(original);
        expect(cache.getOrBuild(source, chaotic, 900, DEFAULT_PARTITA_TUNING)).not.toBe(original);
        expect(cache.getOrBuild(source, theme, 900, tuning)).not.toBe(original);
        expect(cache.getOrBuild(source, theme, 900, DEFAULT_PARTITA_TUNING)).toBe(original);
    });
});
