import type { RemoteLyricLayout, RemoteLyricMainRow, RemoteLyricSubRow } from '../types/remoteControl';

// src/utils/remoteLyricLayout.ts
// The remote window's lyric rows (RemoteLyricLayout) as plain rules: the default, what each row can
// show, and how the layout is stored as a string and read back. Here rather than beside the remote
// window because the settings store (useDesktopSettingsStore) reads it too.

/** What the large row of a pair can show. */
export const REMOTE_LYRIC_MAIN_ROWS: readonly RemoteLyricMainRow[] = ['original', 'translation', 'romanization'];
/** What the small row of a pair can show. */
export const REMOTE_LYRIC_SUB_ROWS: readonly RemoteLyricSubRow[] = ['auto', 'translation', 'romanization', 'original', 'none'];

/** One pair whose small row follows the 副字幕: the window as it was before it had these rows. */
export const DEFAULT_REMOTE_LYRIC_LAYOUT: RemoteLyricLayout = {
    pairs: 1,
    rows: ['original', 'auto', 'original', 'auto'],
};

const isMainRow = (value: unknown): value is RemoteLyricMainRow =>
    (REMOTE_LYRIC_MAIN_ROWS as readonly unknown[]).includes(value);

const isSubRow = (value: unknown): value is RemoteLyricSubRow =>
    (REMOTE_LYRIC_SUB_ROWS as readonly unknown[]).includes(value);

/** A layout as stored: `pairs|main+sub|main+sub`, e.g. `2|original+translation|original+none`. */
export const serializeRemoteLyricLayout = (layout: RemoteLyricLayout): string => {
    const [main1, sub1, main2, sub2] = layout.rows;
    return `${layout.pairs}|${main1}+${sub1}|${main2}+${sub2}`;
};

/** A stored string as a layout; null for anything that is not one. */
export const parseRemoteLyricLayout = (value: unknown): RemoteLyricLayout | null => {
    if (typeof value !== 'string') return null;
    const [pairs, first, second, ...rest] = value.split('|');
    if (rest.length > 0 || (pairs !== '1' && pairs !== '2') || !first || !second) return null;
    const [main1, sub1, ...firstRest] = first.split('+');
    const [main2, sub2, ...secondRest] = second.split('+');
    if (firstRest.length > 0 || secondRest.length > 0) return null;
    if (!isMainRow(main1) || !isSubRow(sub1) || !isMainRow(main2) || !isSubRow(sub2)) return null;
    return { pairs: pairs === '2' ? 2 : 1, rows: [main1, sub1, main2, sub2] };
};

/**
 * A layout that came over IPC, as the remote window reads it: the default for a missing or broken one,
 * so a main window older than the setting keeps the old look.
 */
export const readRemoteLyricLayout = (value: unknown): RemoteLyricLayout => {
    if (!value || typeof value !== 'object') return DEFAULT_REMOTE_LYRIC_LAYOUT;
    const candidate = value as Partial<RemoteLyricLayout>;
    const rows = Array.isArray(candidate.rows) ? candidate.rows : [];
    const [main1, sub1, main2, sub2] = rows;
    if ((candidate.pairs !== 1 && candidate.pairs !== 2) || rows.length !== 4
        || !isMainRow(main1) || !isSubRow(sub1) || !isMainRow(main2) || !isSubRow(sub2)) {
        return DEFAULT_REMOTE_LYRIC_LAYOUT;
    }
    return { pairs: candidate.pairs, rows: [main1, sub1, main2, sub2] };
};

/** The layout with one pair or two; the rows stay. */
export const withRemoteLyricPairs = (layout: RemoteLyricLayout, pairs: 1 | 2): RemoteLyricLayout => (
    layout.pairs === pairs ? layout : { ...layout, pairs }
);

/** The layout with one row changed: rows 0 and 2 take a large-row choice, 1 and 3 a small-row one. */
export function withRemoteLyricRow(layout: RemoteLyricLayout, index: 0 | 2, row: RemoteLyricMainRow): RemoteLyricLayout;
export function withRemoteLyricRow(layout: RemoteLyricLayout, index: 1 | 3, row: RemoteLyricSubRow): RemoteLyricLayout;
export function withRemoteLyricRow(
    layout: RemoteLyricLayout,
    index: 0 | 1 | 2 | 3,
    row: RemoteLyricMainRow | RemoteLyricSubRow,
): RemoteLyricLayout {
    if (layout.rows[index] === row) return layout;
    const rows: Array<RemoteLyricMainRow | RemoteLyricSubRow> = [...layout.rows];
    rows[index] = row;
    return { ...layout, rows: rows as RemoteLyricLayout['rows'] };
}
