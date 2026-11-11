import type {
    SubtitleContentMode,
    SubtitleOverlayFollowRow,
    SubtitleOverlayLayout,
    SubtitleOverlayRowsLayout,
    SubtitleOverlayRowSource,
} from '../../types';

// src/utils/lyrics/subtitleOverlayLayout.ts
// Reads, validates and edits the shared bottom subtitle's row layout (SubtitleOverlayLayout).

export type SubtitleOverlayRowCount = 1 | 2 | 3;
export type SubtitleOverlaySingleRow = Exclude<SubtitleOverlayRowSource, 'next'>;

/** What the first row can be, alone or on top of a stack. */
export const SUBTITLE_OVERLAY_SINGLE_ROWS: readonly SubtitleOverlaySingleRow[] = ['current', 'translation', 'romanization'];
/** What each row after the first can be. */
export const SUBTITLE_OVERLAY_FOLLOW_ROWS: readonly SubtitleOverlayFollowRow[] = ['next', 'translation', 'romanization'];

export const DEFAULT_SUBTITLE_OVERLAY_LAYOUT: SubtitleOverlayLayout = 'translation';

/** Ends a layout whose rows are all it shows: no preview of the coming lyrics on a line the rows have nothing for. */
const ROWS_ONLY_SUFFIX = '|only';

const isSingleRow = (value: string): value is SubtitleOverlaySingleRow =>
    (SUBTITLE_OVERLAY_SINGLE_ROWS as readonly string[]).includes(value);

const isFollowRow = (value: string): value is SubtitleOverlayFollowRow =>
    (SUBTITLE_OVERLAY_FOLLOW_ROWS as readonly string[]).includes(value);

const parseRowsLayout = (value: string): SubtitleOverlayRowsLayout | null => {
    const rows = value.split('+');
    if (rows.length > 3 || !isSingleRow(rows[0])) return null;
    return rows.slice(1).every(isFollowRow) ? value as SubtitleOverlayRowsLayout : null;
};

/** A stored, synced or imported value as a layout; null for anything that is not one. */
export const parseSubtitleOverlayLayout = (value: unknown): SubtitleOverlayLayout | null => {
    if (typeof value !== 'string') return null;
    const rowsOnly = value.endsWith(ROWS_ONLY_SUFFIX);
    const rows = parseRowsLayout(rowsOnly ? value.slice(0, -ROWS_ONLY_SUFFIX.length) : value);
    if (!rows) return null;
    return rowsOnly ? `${rows}${ROWS_ONLY_SUFFIX}` : rows;
};

/**
 * Whether a line the rows have nothing for (a translation row on a song without one) previews the
 * coming lyrics instead. Layouts do unless they end in '|only'.
 */
export const subtitleOverlayPreviewsUpcoming = (layout: SubtitleOverlayLayout): boolean =>
    !layout.endsWith(ROWS_ONLY_SUFFIX);

const rowsLayoutOf = (layout: SubtitleOverlayLayout): string =>
    subtitleOverlayPreviewsUpcoming(layout) ? layout : layout.slice(0, -ROWS_ONLY_SUFFIX.length);

/** The layout with the preview of the coming lyrics on or off; its rows stay. */
export const withSubtitleOverlayUpcomingPreview = (
    layout: SubtitleOverlayLayout,
    previewsUpcoming: boolean,
): SubtitleOverlayLayout => {
    const rows = rowsLayoutOf(layout) as SubtitleOverlayRowsLayout;
    return previewsUpcoming ? rows : `${rows}${ROWS_ONLY_SUFFIX}`;
};

/** The rows of a layout, top to bottom. */
export const getSubtitleOverlayRows = (layout: SubtitleOverlayLayout): SubtitleOverlayRowSource[] =>
    rowsLayoutOf(layout).split('+') as SubtitleOverlayRowSource[];

export const getSubtitleOverlayRowCount = (layout: SubtitleOverlayLayout): SubtitleOverlayRowCount =>
    getSubtitleOverlayRows(layout).length as SubtitleOverlayRowCount;

/** New rows for a layout, which keeps its choice about previewing the coming lyrics; null when they are not a layout. */
const replaceRows = (layout: SubtitleOverlayLayout, rows: SubtitleOverlayRowSource[]): SubtitleOverlayLayout | null => {
    const parsed = parseRowsLayout(rows.join('+'));
    return parsed ? withSubtitleOverlayUpcomingPreview(parsed, subtitleOverlayPreviewsUpcoming(layout)) : null;
};

/**
 * The layout with another number of rows. A single row grows into a stack under the current line, and
 * going down to one row keeps the first translation or romanization row (the current line when it has
 * none), so 单行翻译 -> 双行 -> 单行 comes back to translation. A stack keeps its first row; a row added
 * under it is the content the stack does not show yet.
 */
export const withSubtitleOverlayRowCount = (
    layout: SubtitleOverlayLayout,
    count: SubtitleOverlayRowCount,
): SubtitleOverlayLayout => {
    const rows = getSubtitleOverlayRows(layout);
    if (count === 1) {
        if (rows.length === 1) return layout;
        const single = rows.find((row): row is SubtitleOverlaySingleRow => row === 'translation' || row === 'romanization') ?? 'current';
        return replaceRows(layout, [single]) ?? layout;
    }
    const first: SubtitleOverlayRowSource = rows.length === 1 ? 'current' : rows[0];
    const follows: SubtitleOverlayFollowRow[] = rows.length === 1
        ? [rows[0] === 'current' ? 'next' : rows[0] as SubtitleOverlayFollowRow]
        : rows.slice(1) as SubtitleOverlayFollowRow[];
    while (follows.length < count - 1) {
        follows.push((['translation', 'romanization', 'next'] as const).find(row => row !== first && !follows.includes(row)) ?? 'next');
    }
    return replaceRows(layout, [first, ...follows.slice(0, count - 1)]) ?? layout;
};

/**
 * The layout with one row's content changed; the layout as it was when that row cannot show that content.
 * The row count stays. A first row changed to what a row under it already shows moves that row on to content
 * the stack does not show yet, so 当前句 + 翻译 with 翻译 picked for the first row becomes 翻译 + 罗马音, not a
 * stack that says 翻译 twice.
 */
export const withSubtitleOverlayRow = (
    layout: SubtitleOverlayLayout,
    index: number,
    source: SubtitleOverlayRowSource,
): SubtitleOverlayLayout => {
    const rows = getSubtitleOverlayRows(layout);
    if (index < 0 || index >= rows.length) return layout;
    const next = rows.map((row, at) => (at === index ? source : row));
    if (index === 0) {
        for (let at = 1; at < next.length; at += 1) {
            if (next[at] !== source) continue;
            next[at] = (['translation', 'romanization'] as const).find(row => !next.includes(row)) ?? 'next';
        }
    }
    return replaceRows(layout, next) ?? layout;
};

/**
 * The layout a user had before the bottom subtitle got its own rows, read off their 副字幕内容: the
 * same single row for translation or romanization; romanization + translation under the current line
 * for 'both'; and for 'none', whose overlay previewed the coming lyrics, the current line and the next.
 */
export const subtitleOverlayLayoutFromContentMode = (mode: SubtitleContentMode): SubtitleOverlayLayout => {
    if (mode === 'romanization') return 'romanization';
    if (mode === 'both') return 'current+romanization+translation';
    if (mode === 'none') return 'current+next';
    return 'translation';
};
