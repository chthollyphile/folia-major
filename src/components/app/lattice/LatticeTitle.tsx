import { useCallback } from 'react';
import { useSettledTitle } from '../../../hooks/useSettledTitle';
import { readTitleMetrics, type TitleMetrics } from '../../../utils/fitSettledTitle';
import { readTitleColumn, titleColumnWidth, type TitleColumn } from './titleLayoutWidth';

// src/components/app/lattice/LatticeTitle.tsx — preserve the full accessible title while fitting its preview.

/** Everything a fit reads from the cascade, minus the width, which is arithmetic over the poster. */
type TitleTypography = Omit<TitleMetrics, 'width'> & { column: TitleColumn };

/**
 * One computed-style read per poster shape, not per poster.
 *
 * A held arrow key or a pan mounts a dozen cards in one commit, and each card's layout effect
 * used to ask the cascade for its own typography. Every such read lands on a tree the previous
 * card just dirtied, so the browser recalculated style once per card - measured at a quarter of
 * the React work behind a key repeat. The cascade gives every card of a shape the same answer:
 * the type size is set per shape and viewport, the copy block's insets per shape, so the first
 * card to ask fills the entry and the rest take it. The key carries the fonts and viewport epochs
 * the hook already tracks, which is exactly when a stored entry could go stale.
 */
const typographyByShape = new Map<string, TitleTypography>();
const TYPOGRAPHY_ENTRIES = 16;

function readTypography(node: HTMLElement, key: string): TitleTypography | null {
    const cached = typographyByShape.get(key);
    if (cached) return cached;
    const column = readTitleColumn(node);
    if (!column) return null;
    // A width of 1 keeps the null-guard for "no width" out of the way; only the type is wanted.
    const metrics = readTitleMetrics(node, 1);
    if (!metrics) return null;
    const { width: _width, ...typography } = metrics;
    const entry = { ...typography, column };
    if (typographyByShape.size >= TYPOGRAPHY_ENTRIES) typographyByShape.clear();
    typographyByShape.set(key, entry);
    return entry;
}

export function LatticeTitle({ title, expanded, targetPosterWidth }:
    { title: string; expanded: boolean; targetPosterWidth?: number }) {
    // The poster's target rect is known before the spring runs, so the fit never waits for it.
    const readMetrics = useCallback((node: HTMLElement, epoch: string): TitleMetrics | null => {
        if (targetPosterWidth === undefined) return readTitleMetrics(node, null);
        const typography = readTypography(node, `${epoch}|${expanded ? 'expanded' : 'compact'}`);
        if (!typography) return null;
        const width = titleColumnWidth(typography.column, targetPosterWidth);
        if (width === null) return null;
        const { column: _column, ...metrics } = typography;
        return { ...metrics, width };
    }, [expanded, targetPosterWidth]);
    const { ref, value, settled } = useSettledTitle(title, expanded, { readMetrics });
    return <strong ref={ref} aria-label={title} title={title} data-title-settled={settled || undefined}>{value}</strong>;
}
