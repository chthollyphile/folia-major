import { describe, expect, it } from 'vitest';
import { buildNowPlayingLyricSource } from '@/utils/lyrics/nowPlayingSource';

// Lock down now-playing field mapping so enhanced LRC stays precise
// even when upstream only provides it through the plain lrc field.
describe('nowPlayingSource', () => {
    it('detects enhanced-lrc when now-playing only provides bracket-timed lrc content', () => {
        const lyricSource = buildNowPlayingLyricSource({
            source: 'spotify',
            title: 'Song',
            artist: 'Artist',
            durationMs: 0,
            hasLyric: true,
            hasTranslatedLyric: true,
            hasKaraokeLyric: false,
            lrc: [
                '[00:19.95]あ[00:20.22]の[00:20.64]日[00:21.19]見[00:21.51]渡[00:22.46]し[00:22.74]た[00:23.11]渚[00:24.17]を[00:24.42]',
                '[00:19.95]如今我仍在回想[00:24.93]',
            ].join('\n'),
            translatedLyric: '',
            karaokeLyric: '',
        });

        expect(lyricSource).toEqual({
            type: 'local',
            lrcContent: [
                '[00:19.95]あ[00:20.22]の[00:20.64]日[00:21.19]見[00:21.51]渡[00:22.46]し[00:22.74]た[00:23.11]渚[00:24.17]を[00:24.42]',
                '[00:19.95]如今我仍在回想[00:24.93]',
            ].join('\n'),
            formatHint: 'enhanced-lrc',
        });
    });

    it('keeps netease karaoke payloads on the yrc branch', () => {
        const lyricSource = buildNowPlayingLyricSource({
            source: 'netease',
            title: 'Song',
            artist: 'Artist',
            durationMs: 0,
            hasLyric: false,
            hasTranslatedLyric: true,
            hasKaraokeLyric: true,
            lrc: '',
            translatedLyric: '[00:01.00]hello',
            karaokeLyric: '[1000,800](1000,250,0)你(1250,250,0)好',
        });

        expect(lyricSource).toEqual({
            type: 'local',
            lrcContent: '[1000,800](1000,250,0)你(1250,250,0)好',
            tLrcContent: '[00:01.00]hello',
            formatHint: 'yrc',
        });
    });

    it('keeps non-netease karaoke payloads on the qrc branch', () => {
        const lyricSource = buildNowPlayingLyricSource({
            source: 'qq',
            title: 'Song',
            artist: 'Artist',
            durationMs: 0,
            hasLyric: false,
            hasTranslatedLyric: false,
            hasKaraokeLyric: true,
            lrc: '',
            translatedLyric: '',
            karaokeLyric: '[1000,800](1000,250)你(1250,250)好',
        });

        expect(lyricSource).toEqual({
            type: 'qrc',
            qrcContent: '[1000,800](1000,250)你(1250,250)好',
        });
    });
});
