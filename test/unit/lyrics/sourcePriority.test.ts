import { describe, expect, it } from 'vitest';
import {
    buildLyricSourceOrder,
    migratePreferredLyricSource,
} from '@/utils/lyrics/sourcePriority';

// test/unit/lyrics/sourcePriority.test.ts

describe('lyric source priority', () => {
    it('defaults to QQ and retains every fallback exactly once', () => {
        expect(buildLyricSourceOrder()).toEqual(['qq', 'netease', 'amll', 'kugou', 'qishui', 'spotify']);
        expect(buildLyricSourceOrder('kugou')).toEqual(['kugou', 'netease', 'amll', 'qq', 'qishui', 'spotify']);
        expect(buildLyricSourceOrder('netease')).toEqual(['netease', 'amll', 'qq', 'kugou', 'qishui', 'spotify']);
        expect(buildLyricSourceOrder('amll')).toEqual(['amll', 'netease', 'qq', 'kugou', 'qishui', 'spotify']);
        expect(buildLyricSourceOrder('spotify')).toEqual(['spotify', 'netease', 'amll', 'qq', 'kugou', 'qishui']);
        expect(buildLyricSourceOrder('qishui')).toEqual(['qishui', 'netease', 'amll', 'qq', 'kugou', 'spotify']);
    });

    it('migrates missing, invalid, and legacy NetEase preferences to QQ', () => {
        expect(migratePreferredLyricSource(null, null)).toBe('qq');
        expect(migratePreferredLyricSource(null, 'netease')).toBe('qq');
        expect(migratePreferredLyricSource(null, 'invalid')).toBe('qq');
        expect(migratePreferredLyricSource('invalid', 'kugou')).toBe('qq');
    });

    it('preserves other legacy values and trusts the versioned preference thereafter', () => {
        expect(migratePreferredLyricSource(null, 'amll')).toBe('amll');
        expect(migratePreferredLyricSource(null, 'qq')).toBe('qq');
        expect(migratePreferredLyricSource(null, 'kugou')).toBe('kugou');
        expect(migratePreferredLyricSource('netease', 'qq')).toBe('netease');
    });
});
