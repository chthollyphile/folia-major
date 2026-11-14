import { describe, expect, it } from 'vitest';
import {
    buildLyricSourceOrder,
    migratePreferredLyricSource,
} from '@/utils/lyrics/sourcePriority';

// test/unit/lyrics/sourcePriority.test.ts

describe('lyric source priority', () => {
    it('defaults to QQ and retains every fallback exactly once', () => {
        expect(buildLyricSourceOrder()).toEqual(['qq', 'netease', 'amll', 'kugou', 'qishui', 'spotify', 'appleMusic']);
        expect(buildLyricSourceOrder('kugou')).toEqual(['kugou', 'netease', 'amll', 'qq', 'qishui', 'spotify', 'appleMusic']);
        expect(buildLyricSourceOrder('netease')).toEqual(['netease', 'amll', 'qq', 'kugou', 'qishui', 'spotify', 'appleMusic']);
        expect(buildLyricSourceOrder('amll')).toEqual(['amll', 'netease', 'qq', 'kugou', 'qishui', 'spotify', 'appleMusic']);
        expect(buildLyricSourceOrder('spotify')).toEqual(['spotify', 'netease', 'amll', 'qq', 'kugou', 'qishui', 'appleMusic']);
        expect(buildLyricSourceOrder('qishui')).toEqual(['qishui', 'netease', 'amll', 'qq', 'kugou', 'spotify', 'appleMusic']);
    });

    it('migrates missing, invalid, and legacy NetEase preferences to QQ', () => {
        expect(migratePreferredLyricSource(null, null)).toBe('qq');
        expect(migratePreferredLyricSource(null, 'netease')).toBe('qq');
        expect(migratePreferredLyricSource(null, 'invalid')).toBe('qq');
        expect(migratePreferredLyricSource('', 'kugou')).toBe('qq');
        expect(migratePreferredLyricSource(42, 'kugou')).toBe('qq');
    });

    // Folium 2.0 方案 §7.1：存着的首选来源不改写，没注册的来源按缺失条目处理，排在最前、匹配时被跳过。
    it('keeps a versioned preference that names no registered source, and puts it first', () => {
        expect(migratePreferredLyricSource('folium.mod.lyrics', 'kugou')).toBe('folium.mod.lyrics');
        expect(buildLyricSourceOrder('folium.mod.lyrics')).toEqual(['folium.mod.lyrics', 'netease', 'amll', 'qq', 'kugou', 'qishui', 'spotify', 'appleMusic']);
    });

    it('preserves other legacy values and trusts the versioned preference thereafter', () => {
        expect(migratePreferredLyricSource(null, 'amll')).toBe('amll');
        expect(migratePreferredLyricSource(null, 'qq')).toBe('qq');
        expect(migratePreferredLyricSource(null, 'kugou')).toBe('kugou');
        expect(migratePreferredLyricSource('netease', 'qq')).toBe('netease');
    });
});
