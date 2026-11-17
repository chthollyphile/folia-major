import { describe, expect, it } from 'vitest';
import type { RemoteLyricLayout } from '../../../src/types/remoteControl';
import {
    DEFAULT_REMOTE_LYRIC_LAYOUT,
    parseRemoteLyricLayout,
    readRemoteLyricLayout,
    serializeRemoteLyricLayout,
    withRemoteLyricPairs,
    withRemoteLyricRow,
} from '../../../src/utils/remoteLyricLayout';
import {
    REMOTE_LYRIC_IDLE_MAX_HEIGHT,
    resolveRemoteLyricBlockHeight,
    resolveRemoteLyricFit,
    resolveRemoteLyricRows,
    resolveRemoteLyricTexts,
    resolveRemoteUpcomingFit,
    resolveRemoteUpcomingHeight,
} from '../../../src/components/remote/remoteLyricText';

// test/unit/remote/remoteLyricRows.test.ts
// The remote window's lyric rows (its settings page): how the layout is stored and read back, what
// each row shows, and how the next pair fits under the first when idle.

const LINE = { fullText: 'main line', translation: 'tr', romanization: 'ro' };
const NEXT = { fullText: 'next line', translation: 'next tr', romanization: 'next ro' };
const layout = (pairs: 1 | 2, rows: RemoteLyricLayout['rows']): RemoteLyricLayout => ({ pairs, rows });

describe('remote lyric layout', () => {
    it('round-trips through its stored string', () => {
        const value = layout(2, ['translation', 'original', 'original', 'none']);
        expect(serializeRemoteLyricLayout(value)).toBe('2|translation+original|original+none');
        expect(parseRemoteLyricLayout(serializeRemoteLyricLayout(value))).toEqual(value);
        expect(parseRemoteLyricLayout(serializeRemoteLyricLayout(DEFAULT_REMOTE_LYRIC_LAYOUT))).toEqual(DEFAULT_REMOTE_LYRIC_LAYOUT);
    });

    it('rejects what is not a layout', () => {
        for (const value of [null, 1, '', '3|original+auto|original+auto', '1|auto+auto|original+auto',
            '1|original+next|original+auto', '1|original+auto', '1|original+auto|original+auto|x', '1|original+auto+none|original+auto']) {
            expect(parseRemoteLyricLayout(value), String(value)).toBeNull();
        }
    });

    it('reads a missing or broken layout from IPC as the default', () => {
        expect(readRemoteLyricLayout(undefined)).toBe(DEFAULT_REMOTE_LYRIC_LAYOUT);
        expect(readRemoteLyricLayout({ pairs: 3, rows: ['original', 'auto', 'original', 'auto'] })).toBe(DEFAULT_REMOTE_LYRIC_LAYOUT);
        expect(readRemoteLyricLayout({ pairs: 2, rows: ['auto', 'auto', 'original', 'auto'] })).toBe(DEFAULT_REMOTE_LYRIC_LAYOUT);
        expect(readRemoteLyricLayout({ pairs: 2, rows: ['romanization', 'none', 'original', 'auto'] }))
            .toEqual(layout(2, ['romanization', 'none', 'original', 'auto']));
    });

    it('keeps the second pair\'s rows while one pair is shown', () => {
        const two = layout(2, ['original', 'auto', 'translation', 'none']);
        expect(withRemoteLyricPairs(withRemoteLyricPairs(two, 1), 2)).toEqual(two);
        expect(withRemoteLyricRow(two, 3, 'romanization').rows).toEqual(['original', 'auto', 'translation', 'romanization']);
        expect(withRemoteLyricRow(two, 0, 'original')).toBe(two);
    });
});

describe('remote lyric rows', () => {
    it('is the old window by default: the 副字幕 under the line, the next line standing in', () => {
        for (const mode of ['translation', 'romanization', 'both', 'none'] as const) {
            const rows = resolveRemoteLyricRows(DEFAULT_REMOTE_LYRIC_LAYOUT, mode, LINE, NEXT);
            expect(rows).toEqual({ hero: null, upcoming: null, ...resolveRemoteLyricTexts(mode, LINE, NEXT) });
        }
    });

    it('draws the translation or romanization large when asked, the line itself when it has none', () => {
        expect(resolveRemoteLyricRows(layout(1, ['translation', 'none', 'original', 'auto']), 'translation', LINE, NEXT).hero)
            .toEqual({ text: 'tr', kind: 'translation' });
        expect(resolveRemoteLyricRows(layout(1, ['translation', 'none', 'original', 'auto']), 'translation', { fullText: 'main line' }, NEXT).hero)
            .toBeNull();
    });

    it('shows a picked small row, the next line when it is missing with one pair, nothing with two', () => {
        const one = layout(1, ['original', 'romanization', 'original', 'auto']);
        expect(resolveRemoteLyricRows(one, 'translation', LINE, NEXT).second).toEqual({ text: 'ro', kind: 'romanization' });
        expect(resolveRemoteLyricRows(one, 'translation', { fullText: 'main line' }, NEXT).second).toEqual({ text: 'next line', kind: 'next' });
        const two = layout(2, ['original', 'romanization', 'original', 'auto']);
        expect(resolveRemoteLyricRows(two, 'translation', { fullText: 'main line' }, NEXT).second).toBeNull();
        // 'auto' with two pairs: no stand-in either.
        expect(resolveRemoteLyricRows(layout(2, ['original', 'auto', 'original', 'auto']), 'translation', { fullText: 'main line' }, NEXT).second).toBeNull();
    });

    it('never says the large row twice', () => {
        // Translation large, 'auto' following the translation: the next line stands in with one pair.
        expect(resolveRemoteLyricRows(layout(1, ['translation', 'auto', 'original', 'auto']), 'translation', LINE, NEXT).second)
            .toEqual({ text: 'next line', kind: 'next' });
        // 'both' keeps the romanization and drops the translation the large row shows.
        expect(resolveRemoteLyricRows(layout(1, ['translation', 'auto', 'original', 'auto']), 'both', LINE, NEXT))
            .toMatchObject({ romanization: 'ro', second: null });
        // The original under the translation.
        expect(resolveRemoteLyricRows(layout(1, ['translation', 'original', 'original', 'auto']), 'none', LINE, NEXT).second)
            .toEqual({ text: 'main line', kind: 'original' });
    });

    it('lets the next line stand in once the large row took the only text under the line', () => {
        const rows = layout(1, ['romanization', 'auto', 'original', 'auto']);
        expect(resolveRemoteLyricRows(rows, 'both', { fullText: 'main line', romanization: 'ro' }, NEXT))
            .toMatchObject({ romanization: null, second: { text: 'next line', kind: 'next' } });
        expect(resolveRemoteLyricRows(layout(2, rows.rows), 'both', { fullText: 'main line', romanization: 'ro' }, NEXT))
            .toMatchObject({ romanization: null, second: null });
    });

    it('shows nothing under the line for none', () => {
        expect(resolveRemoteLyricRows(layout(1, ['original', 'none', 'original', 'auto']), 'both', LINE, NEXT))
            .toMatchObject({ romanization: null, second: null });
    });

    it('gives the second pair the next line and its small row', () => {
        const two = (sub: RemoteLyricLayout['rows'][3], main: RemoteLyricLayout['rows'][2] = 'original') => layout(2, ['original', 'auto', main, sub]);
        expect(resolveRemoteLyricRows(two('auto'), 'translation', LINE, NEXT).upcoming).toEqual({ main: 'next line', sub: 'next tr' });
        expect(resolveRemoteLyricRows(two('auto'), 'both', LINE, { fullText: 'next line', romanization: 'next ro' }).upcoming)
            .toEqual({ main: 'next line', sub: 'next ro' });
        expect(resolveRemoteLyricRows(two('auto'), 'none', LINE, NEXT).upcoming).toEqual({ main: 'next line', sub: null });
        expect(resolveRemoteLyricRows(two('none'), 'translation', LINE, NEXT).upcoming).toEqual({ main: 'next line', sub: null });
        expect(resolveRemoteLyricRows(two('original', 'translation'), 'translation', LINE, NEXT).upcoming).toEqual({ main: 'next tr', sub: 'next line' });
        // Asked for a translation it lacks, the large row shows the line, and a small row repeating it goes.
        expect(resolveRemoteLyricRows(two('original', 'translation'), 'translation', LINE, { fullText: 'next line' }).upcoming)
            .toEqual({ main: 'next line', sub: null });
        expect(resolveRemoteLyricRows(two('auto'), 'translation', LINE, null).upcoming).toBeNull();
        // 'both' under a large row showing the translation takes the romanization, as the first pair does.
        expect(resolveRemoteLyricRows(two('auto', 'translation'), 'both', LINE, NEXT).upcoming).toEqual({ main: 'next tr', sub: 'next ro' });
        expect(resolveRemoteLyricRows(layout(1, ['original', 'auto', 'original', 'auto']), 'translation', LINE, NEXT).upcoming).toBeNull();
    });
});

describe('remote next pair fit', () => {
    it('keeps the second line to one line with two pairs', () => {
        expect(resolveRemoteLyricFit({ mainLinesAtLarge: 1, hasRomanization: false, hasSecond: true, secondOnOneLine: true }).secondMaxLines).toBe(1);
    });

    it('fits both rows under a one-line pair, the large row only under a two-line lyric with a second line', () => {
        const oneLine = resolveRemoteLyricFit({ mainLinesAtLarge: 1, hasRomanization: true, hasSecond: true, secondOnOneLine: true });
        expect(resolveRemoteUpcomingFit(oneLine, true)).toEqual({ main: true, sub: true });
        const twoLines = resolveRemoteLyricFit({ mainLinesAtLarge: 2, hasRomanization: false, hasSecond: true, secondOnOneLine: true });
        expect(resolveRemoteUpcomingFit(twoLines, true)).toEqual({ main: true, sub: false });
        expect(resolveRemoteUpcomingFit(oneLine, false)).toEqual({ main: true, sub: false });
    });

    it('never lets the two pairs pass the idle block', () => {
        for (const mainLinesAtLarge of [1, 2, 3, 6]) {
            for (const hasRomanization of [false, true]) {
                for (const hasSecond of [false, true]) {
                    const fit = resolveRemoteLyricFit({ mainLinesAtLarge, hasRomanization, hasSecond, secondOnOneLine: true });
                    const upcoming = resolveRemoteUpcomingFit(fit, true);
                    expect(upcoming.main, `${mainLinesAtLarge} lines`).toBe(true);
                    expect(resolveRemoteLyricBlockHeight(fit) + resolveRemoteUpcomingHeight(upcoming))
                        .toBeLessThanOrEqual(REMOTE_LYRIC_IDLE_MAX_HEIGHT);
                }
            }
        }
    });
});
