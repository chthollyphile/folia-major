import { describe, expect, it } from 'vitest';
import { getLyricProviderLabel, getOnlineLyricSourceLabel, getSongNativeLyricProviderSource } from '@/utils/lyrics/lyricSourceLabels';

// test/unit/lyrics/lyricSourceLabels.test.ts

describe('getSongNativeLyricProviderSource', () => {
    it('uses the online playback provider as the native lyric source', () => {
        expect(getSongNativeLyricProviderSource({
            sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'HASH' },
        })).toBe('kugou');
        expect(getSongNativeLyricProviderSource({
            sourceRef: { kind: 'online', providerId: 'netease', mediaId: '1' },
        })).toBe('netease');
    });

    it('does not invent a lyric source for unrelated playback providers', () => {
        expect(getSongNativeLyricProviderSource({
            sourceRef: { kind: 'online', providerId: 'future-provider', mediaId: '1' },
        })).toBeUndefined();
    });
});

describe('getOnlineLyricSourceLabel', () => {
    const ytmSong = { sourceRef: { kind: 'online' as const, providerId: 'ytm', mediaId: 'm9SMT5ipbxk' } };
    const qqSong = { sourceRef: { kind: 'online' as const, providerId: 'qq', mediaId: '1' } };

    it('names the platform the lyrics were matched from', () => {
        expect(getOnlineLyricSourceLabel(ytmSong, { matchedLyricsSource: 'qq' }, 'YT Music')).toBe(getLyricProviderLabel('qq'));
        expect(getOnlineLyricSourceLabel(ytmSong, { matchedLyricsSource: 'amll', matchedLyricsProviderPlatform: 'ncm' }, 'YT Music'))
            .toBe(getLyricProviderLabel('amll', 'ncm'));
    });

    // Without a match the lyrics on screen are the song's own platform's, not NetEase's.
    it('names the song\'s own platform when nothing was matched', () => {
        expect(getOnlineLyricSourceLabel(ytmSong, null, 'YT Music')).toBe('YT Music');
        expect(getOnlineLyricSourceLabel(ytmSong, {}, 'YT Music')).toBe('YT Music');
        expect(getOnlineLyricSourceLabel(ytmSong, null, 'YT Music')).not.toBe(getLyricProviderLabel('netease'));
        expect(getOnlineLyricSourceLabel(qqSong, null, 'QQ')).toBe(getLyricProviderLabel('qq'));
    });
});
