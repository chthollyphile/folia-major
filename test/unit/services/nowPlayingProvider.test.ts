import { describe, expect, it } from 'vitest';
import { normalizeNowPlayingLyricPayload, normalizeNowPlayingTrack } from '@/services/nowPlayingProvider';

describe('nowPlayingProvider', () => {
    it('normalizes track payloads', () => {
        const track = normalizeNowPlayingTrack({
            id: 123,
            title: 'Song',
            author: 'Artist',
            album: 'Album',
            cover: 'http://cover.test/a.jpg',
            duration: 210000,
        });

        expect(track).toEqual({
            id: '123',
            title: 'Song',
            artist: 'Artist',
            album: 'Album',
            coverUrl: 'http://cover.test/a.jpg',
            durationMs: 210000,
        });
    });

    it('normalizes lyric payloads and preserves karaoke source fields', () => {
        const lyric = normalizeNowPlayingLyricPayload({
            source: 'QQ',
            title: 'Song',
            author: 'Artist',
            duration: 210000,
            hasLyric: true,
            hasTranslatedLyric: true,
            hasKaraokeLyric: true,
            lrc: '[00:01.00]hello',
            translatedLyric: '[00:01.00]你好',
            karaokeLyric: '[1000,500](1000,250)你(1250,250)好',
        });

        expect(lyric?.source).toBe('qq');
        expect(lyric?.hasKaraokeLyric).toBe(true);
        expect(lyric?.translatedLyric).toContain('你好');
        expect(lyric?.karaokeLyric).toContain('(1000,250)');
    });

    it('extracts qrc lyric content from now-playing xml payloads', () => {
        const lyric = normalizeNowPlayingLyricPayload({
            source: 'QQ',
            hasKaraokeLyric: true,
            karaokeLyric: `<?xml version="1.0" encoding="utf-8"?>
<QrcInfos>
<LyricInfo LyricCount="1">
<Lyric_1 LyricType="1" LyricContent="[ti:Song]
[ar:Artist]
[1000,800]你(1000,250)好(1250,250)"/>
</LyricInfo>
</QrcInfos>`,
        });

        expect(lyric?.karaokeLyric).toContain('[ti:Song]');
        expect(lyric?.karaokeLyric).toContain('[1000,800]你(1000,250)好(1250,250)');
        expect(lyric?.karaokeLyric).not.toContain('<?xml');
        expect(lyric?.karaokeLyric).not.toContain('<Lyric_1');
    });
});
