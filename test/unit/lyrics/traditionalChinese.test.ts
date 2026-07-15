import { describe, expect, it } from 'vitest';
import type { LyricData } from '@/types';
import { convertLyricDataToTraditional } from '@/utils/lyrics/traditionalChinese';

// test/unit/lyrics/traditionalChinese.test.ts
// Verifies local Simplified-to-Traditional conversion preserves all lyric timing data.

describe('convertLyricDataToTraditional', () => {
    it('converts visible lyric fields without mutating timing or romanization', async () => {
        const source: LyricData = {
            title: '后来',
            artist: '音乐人',
            isWordByWord: true,
            lines: [{
                fullText: '后来我终于明白',
                translation: '音乐响起',
                romanization: 'hou lai wo zhong yu ming bai',
                startTime: 1.25,
                endTime: 4.5,
                words: [{
                    text: '后来',
                    startTime: 1.25,
                    endTime: 2,
                    syllables: [{
                        text: '后来',
                        startTime: 1.25,
                        endTime: 2,
                        ruby: [{ text: '后来', startTime: 1.25, endTime: 2 }],
                    }],
                }],
                alternateTexts: [
                    { role: 'translation', text: '音乐响起' },
                    { role: 'romanization', text: 'yin yue xiang qi' },
                ],
                backgroundVocal: {
                    text: '风吹过',
                    translation: '云散开',
                    romanization: 'feng chui guo',
                    startTime: 2,
                    endTime: 3,
                    words: [{ text: '风吹过', startTime: 2, endTime: 3 }],
                },
            }],
            ttml: {
                agents: {
                    v1: { id: 'v1', name: '歌手' },
                },
            },
        };

        const converted = await convertLyricDataToTraditional(source);

        expect(converted?.title).toBe('後來');
        expect(converted?.artist).toBe('音樂人');
        expect(converted?.lines[0].fullText).toBe('後來我終於明白');
        expect(converted?.lines[0].translation).toBe('音樂響起');
        expect(converted?.lines[0].words[0].text).toBe('後來');
        expect(converted?.lines[0].words[0].syllables?.[0].ruby?.[0].text).toBe('後來');
        expect(converted?.lines[0].alternateTexts?.[0].text).toBe('音樂響起');
        expect(converted?.lines[0].alternateTexts?.[1].text).toBe('yin yue xiang qi');
        expect(converted?.lines[0].backgroundVocal?.text).toBe('風吹過');
        expect(converted?.lines[0].backgroundVocal?.romanization).toBe('feng chui guo');
        expect(converted?.ttml?.agents?.v1.name).toBe('歌手');
        expect(converted?.lines[0].startTime).toBe(1.25);
        expect(converted?.lines[0].words[0].endTime).toBe(2);
        expect(source.lines[0].fullText).toBe('后来我终于明白');
    });

    it('returns null when no lyrics are loaded', async () => {
        await expect(convertLyricDataToTraditional(null)).resolves.toBeNull();
    });
});
