import { describe, expect, it } from 'vitest';
import {
    isPersistablePlaybackPosition,
    resolveResumablePosition,
} from '@/components/app/playback/playbackPositionCache';
import type { SongResult } from '@/types';

// test/unit/playback/playbackPositionCache.test.ts
// 锁定"启动时记住上一次播放进度"的两端保护与歌曲身份校验。

const song = {
    id: 123,
    name: 'Test',
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: '123' },
} as unknown as SongResult;

const otherProviderSong = {
    id: 123,
    name: 'Test',
    sourceRef: { kind: 'online', providerId: 'kugou', mediaId: '123' },
} as unknown as SongResult;

describe('isPersistablePlaybackPosition', () => {
    it('开头几秒不记录，避免恢复到几乎没听的位置', () => {
        expect(isPersistablePlaybackPosition(1, 200)).toBe(false);
        expect(isPersistablePlaybackPosition(30, 200)).toBe(true);
    });

    it('接近结尾不记录，避免下次启动立刻切歌', () => {
        expect(isPersistablePlaybackPosition(198, 200)).toBe(false);
        expect(isPersistablePlaybackPosition(190, 200)).toBe(true);
    });

    it('duration 未知时只做起始端保护', () => {
        expect(isPersistablePlaybackPosition(30, null)).toBe(true);
        expect(isPersistablePlaybackPosition(1, null)).toBe(false);
    });

    it('拒绝非有限数值', () => {
        expect(isPersistablePlaybackPosition(Number.NaN, 200)).toBe(false);
        expect(isPersistablePlaybackPosition(Number.POSITIVE_INFINITY, 200)).toBe(false);
    });
});

describe('resolveResumablePosition', () => {
    it('歌曲一致时返回记录的位置', () => {
        expect(resolveResumablePosition({ songKey: 'online:netease:123', position: 42 }, song)).toBe(42);
    });

    it('同一数字 id 但 provider 不同时不恢复', () => {
        expect(resolveResumablePosition({ songKey: 'online:netease:123', position: 42 }, otherProviderSong)).toBeNull();
    });

    it('缺少快照或歌曲时返回 null', () => {
        expect(resolveResumablePosition(null, song)).toBeNull();
        expect(resolveResumablePosition({ songKey: 'online:netease:123', position: 42 }, null)).toBeNull();
    });

    it('快照字段类型损坏时返回 null', () => {
        expect(resolveResumablePosition({ songKey: 'online:netease:123', position: '42' } as never, song)).toBeNull();
        expect(resolveResumablePosition({ songKey: 42, position: 42 } as never, song)).toBeNull();
    });

    it('位置过于靠前时不恢复', () => {
        expect(resolveResumablePosition({ songKey: 'online:netease:123', position: 1 }, song)).toBeNull();
    });
});
