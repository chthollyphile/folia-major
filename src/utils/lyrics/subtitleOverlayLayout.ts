import type { SubtitleContentMode, SubtitleOverlayFollowRow, SubtitleOverlayLayout, SubtitleOverlayRowSource } from '../../types';

// src/utils/lyrics/subtitleOverlayLayout.ts
// Reads, validates and edits the shared bottom subtitle's row layout (SubtitleOverlayLayout).

export type SubtitleOverlayRowCount = 1 | 2 | 3;
export type SubtitleOverlaySingleRow = Exclude<SubtitleOverlayRowSource, 'next'>;

/** What the one row of a single-row layout can be. */
export const SUBTITLE_OVERLAY_SINGLE_ROWS: readonly SubtitleOverlaySingleRow[] = ['current', 'translation', 'romanization'];
/** What each row after the current line can be. */
export const SUBTITLE_OVERLAY_FOLLOW_ROWS: readonly SubtitleOverlayFollowRow[] = ['next', 'translation', 'romanization'];

export const DEFAULT_SUBTITLE_OVERLAY_LAYOUT: SubtitleOverlayLayout = 'translation';

const isSingleRow = (value: string): value is SubtitleOverlaySingleRow =>
    (SUBTITLE_OVERLAY_SINGLE_ROWS as readonly string[]).includes(value);

const isFollowRow = (value: string): value is SubtitleOverlayFollowRow =>
    (SUBTITLE_OVERLAY_FOLLOW_ROWS as readonly string[]).includes(value);

/** A stored, synced or imported value as a layout; null for anything that is not one. */
export const parseSubtitleOverlayLayout = (value: unknown): SubtitleOverlayLayout | null => {
    if (typeof value !== 'string') return null;
    const rows = value.split('+');
    if (rows.length === 1) return isSingleRow(value) ? value : null;
    if (rows.length > 3 || rows[0] !== 'current') return null;
    return rows.slice(1).every(isFollowRow) ? value as SubtitleOverlayLayout : null;
};

/** The rows of a layout, top to bottom. */
export const getSubtitleOverlayRows = (layout: SubtitleOverlayLayout): SubtitleOverlayRowSource[] =>
    layout.split('+') as SubtitleOverlayRowSource[];

export const getSubtitleOverlayRowCount = (layout: SubtitleOverlayLayout): SubtitleOverlayRowCount =>
    getSubtitleOverlayRows(layout).length as SubtitleOverlayRowCount;

const joinRows = (rows: SubtitleOverlayRowSource[]): SubtitleOverlayLayout =>
    parseSubtitleOverlayLayout(rows.join('+')) ?? DEFAULT_SUBTITLE_OVERLAY_LAYOUT;

/**
 * The layout with another number of rows. Going down to one row keeps its first translation or
 * romanization row (the current line when it has none), so 单行翻译 -> 双行 -> 单行 comes back to
 * translation; a row added under it is the content the stack does not show yet.
 */
export const withSubtitleOverlayRowCount = (
    layout: SubtitleOverlayLayout,
    count: SubtitleOverlayRowCount,
): SubtitleOverlayLayout => {
    const rows = getSubtitleOverlayRows(layout);
    if (count === 1) {
        if (rows.length === 1) return layout;
        return rows.find((row): row is SubtitleOverlaySingleRow => row === 'translation' || row === 'romanization') ?? 'current';
    }
    const follows: SubtitleOverlayFollowRow[] = rows.length === 1
        ? [rows[0] === 'current' ? 'next' : rows[0] as SubtitleOverlayFollowRow]
        : rows.slice(1) as SubtitleOverlayFollowRow[];
    while (follows.length < count - 1) {
        follows.push((['translation', 'romanization', 'next'] as const).find(row => !follows.includes(row)) ?? 'next');
    }
    return joinRows(['current', ...follows.slice(0, count - 1)]);
};

/** The layout with one row's content changed; row 0 changes only in a single-row layout (it is the current line otherwise). */
export const withSubtitleOverlayRow = (
    layout: SubtitleOverlayLayout,
    index: number,
    source: SubtitleOverlayRowSource,
): SubtitleOverlayLayout => {
    const rows = getSubtitleOverlayRows(layout);
    if (index < 0 || index >= rows.length) return layout;
    const next = [...rows];
    next[index] = source;
    return parseSubtitleOverlayLayout(next.join('+')) ?? layout;
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
