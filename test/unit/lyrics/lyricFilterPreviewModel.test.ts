import { describe, expect, it } from 'vitest';
import { buildLyricFilterPreviewModel } from '@/components/modal/lyric-filter/buildLyricFilterPreviewModel';
import { applyLyricLineRules, compileLyricLineRules } from '@/utils/lyrics/lyricLineRules';
import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';
import { applyLyricStaffPolicy } from '@/utils/lyrics/staffCreditsPolicy';
import type { LyricStaffPolicyOptions } from '@/utils/lyrics/staffCreditsPolicy';

// test/unit/lyrics/lyricFilterPreviewModel.test.ts
// The preview of the lyric filter window says, per line, which rule removed it and when the line
// starts once both rules have run. What it says has to be what playback does with the same rules.

const parse = (lrc: string) => parseLyricsByFormat('lrc', lrc);

// A title, four credits packed into the first seconds, then a long intro.
const LONG_INTRO = parse([
    '[00:00.00]某首歌 - 某歌手',
    '[00:01.00]作词 : A',
    '[00:01.20]作曲 : B',
    '[00:01.40]编曲 : C',
    '[00:01.60]制作人 : D',
    '[00:40.00]第一句歌词',
    '[00:44.00]第二句歌词',
].join('\n'));

// Credits with separator lines between them, then a long intro.
const SEPARATED = parse([
    '[00:00.00]作词 : A',
    '[00:00.10]#',
    '[00:00.20]作曲 : B',
    '[00:00.30]#',
    '[00:40.00]第一句歌词',
    '[00:44.00]第二句歌词',
].join('\n'));

// Credits and a short intro.
const SHORT_INTRO = parse([
    '[00:00.50]作词 : A',
    '[00:00.70]作曲 : B',
    '[00:00.90]编曲 : C',
    '[00:01.10]混音 : D',
    '[00:05.00]第一句歌词',
    '[00:09.00]第二句歌词',
].join('\n'));

const rules = (pattern: string) => compileLyricLineRules(pattern ? [{ id: 'legacy', on: true, shape: 'written', text: pattern }] : []);

const SMART: LyricStaffPolicyOptions = { policy: 'smart', minDwellSeconds: 1.5, absorbMode: 'off', pattern: '' };

/** The lines playback shows for these rules, as text and start time. */
const played = (lyrics: ReturnType<typeof parse>, filterPattern: string, staffOptions: LyricStaffPolicyOptions) => (
    (applyLyricStaffPolicy(applyLyricLineRules(lyrics, compileLyricLineRules([{ id: 'legacy', on: true, shape: 'written', text: filterPattern }])), staffOptions)?.lines ?? [])
        .filter(line => line.fullText !== '......')
        .map(line => [line.fullText, line.startTime])
);

/** The lines the preview leaves standing, as text and the start time it shows. */
const previewed = (lyrics: ReturnType<typeof parse>, filterPattern: string, staffOptions: LyricStaffPolicyOptions) => (
    buildLyricFilterPreviewModel(lyrics, compileLyricLineRules([{ id: 'legacy', on: true, shape: 'written', text: filterPattern }]), staffOptions).rows
        .filter(row => !row.removedByFilter && !row.removedByStaff)
        .map(row => [row.line.fullText, row.startTime])
);

describe('lyric filter preview model', () => {
    it('gives the spread credits the start times playback gives them', () => {
        const model = buildLyricFilterPreviewModel(LONG_INTRO, rules(''), SMART);

        expect(model.staff.verdict).toBe('retime');
        // Four credits share the 38 seconds from the first credit to one second before the first lyric.
        expect(model.rows.map(row => row.startTime)).toEqual([0, 1, 10.5, 20, 29.5, 40, 44]);
        expect(model.rows.map(row => row.timeMoved)).toEqual([false, false, true, true, true, false, false]);
        expect(model.rows.map(row => row.inStaffBlock)).toEqual([false, true, true, true, true, false, false]);
        expect(model.removedCount).toBe(0);
    });

    it('marks the separator lines of a spread block as removed by the credits rule', () => {
        const model = buildLyricFilterPreviewModel(SEPARATED, rules(''), SMART);

        expect(model.staff.verdict).toBe('retime');
        expect(model.rows.map(row => row.removedByStaff)).toEqual([false, true, false, true, false, false]);
        expect(model.rows.map(row => row.inStaffBlock)).toEqual([true, true, true, true, false, false]);
        // A removed line keeps its own time.
        expect(model.rows[1].startTime).toBe(0.1);
        expect(model.rows[1].timeMoved).toBe(false);
        expect(model.removedCount).toBe(2);
    });

    it('names the rule that removed each line', () => {
        const model = buildLyricFilterPreviewModel(SHORT_INTRO, rules('^第二句'), SMART);

        expect(model.staff.verdict).toBe('hide');
        expect(model.rows.map(row => (row.removedByFilter ? 'line' : row.removedByStaff ? 'staff' : null)))
            .toEqual(['staff', 'staff', 'staff', 'staff', null, 'line']);
        expect(model.rows.every(row => row.startTime === row.line.startTime)).toBe(true);
        expect(model.removedCount).toBe(5);
    });

    it('marks no block and moves no time when credits are always shown', () => {
        const model = buildLyricFilterPreviewModel(LONG_INTRO, rules(''), { ...SMART, policy: 'keep' });

        expect(model.staff.verdict).toBe('none');
        expect(model.rows.some(row => row.inStaffBlock || row.removedByStaff || row.timeMoved)).toBe(false);
    });

    it('leaves standing exactly the lines playback shows, at the same times', () => {
        const cases: Array<[ReturnType<typeof parse>, string, LyricStaffPolicyOptions]> = [
            [LONG_INTRO, '', SMART],
            // The line rule takes a credit out of the middle of the block before the credits rule runs.
            [LONG_INTRO, '^作曲', SMART],
            [LONG_INTRO, '', { ...SMART, absorbMode: 'before' }],
            [LONG_INTRO, '', { ...SMART, minDwellSeconds: 4 }],
            [LONG_INTRO, '', { ...SMART, policy: 'hide' }],
            [LONG_INTRO, '', { ...SMART, policy: 'keep' }],
            [SEPARATED, '', SMART],
            [SEPARATED, '', { ...SMART, absorbMode: 'both' }],
            [SHORT_INTRO, '', SMART],
            [SHORT_INTRO, '^第二句', SMART],
        ];

        for (const [lyrics, filterPattern, staffOptions] of cases) {
            expect(previewed(lyrics, filterPattern, staffOptions)).toEqual(played(lyrics, filterPattern, staffOptions));
        }
    });
});
