import type React from 'react';
import { getGlowWordPairGap, getGlowWordReach, GLOW_WORD_LINE_HEIGHT } from '../glowWordOverlap';
import type { WordLayoutConfig } from './partitaLayout';

// src/components/visualizer/partita/partitaOverlap.ts
// 云阶的「防止文字重叠」：相邻两个词、相邻两行成对地算，按它们实际朝对方伸出多少留出刚好不碰的距离，
// 放得下时仍是原来的 0.8rem 词距和行距。词宽按 em 给（字号由 clamp 决定，这里拿不到 px），
// 词的随机偏移是 px，两种单位分开算，再用 CSS 的 max() / calc() 拼起来。

/** The word gap Partita always had (PARTITA_WORD_LAYOUT_STYLE): the least two words ever sit apart. */
const WORD_GAP = '0.8rem';

/** A hair of room past touching, in em. */
const BREATH_EM = 0.05;

/**
 * The 0.8rem word gap in em at its largest, for the row's turn estimate: the main size can come down
 * to about 1rem (2.5rem, times the long-line density 0.8, times the fit's floor 0.5).
 */
const WORD_GAP_EM_AT_MOST = 0.8;

/** PartitaChunk's vertical padding (0.2rem a side), which already parts two rows' word boxes. */
const CHUNK_PADDING_Y = '0.2rem';

/** One chunk as the spacing needs it: its display words' widths in em, their configs, the chunk's own. */
export interface PartitaOverlapRow {
    widthsEm: number[];
    wordConfigs: WordLayoutConfig[];
    config: WordLayoutConfig;
    rtl: boolean;
}

/** What a chunk applies: each word's inline-end gap, and its own top (first row only) and bottom margins. */
export interface PartitaRowSpacing {
    words: React.CSSProperties[];
    marginTop?: string;
    marginBottom: string;
}

const lengthOf = (em: number, px: number) => `calc(${em.toFixed(3)}em + ${px.toFixed(1)}px)`;

/** How far a row's words reach above and below their boxes: the em part and the px part, each at its deepest. */
const rowReach = (row: PartitaOverlapRow) => {
    let topEm = Number.NEGATIVE_INFINITY;
    let bottomEm = Number.NEGATIVE_INFINITY;
    let topPx = Number.NEGATIVE_INFINITY;
    let bottomPx = Number.NEGATIVE_INFINITY;
    let rowWidthEm = 0;
    row.wordConfigs.forEach((wordConfig, index) => {
        const widthEm = row.widthsEm[index] ?? 0;
        const reach = getGlowWordReach(widthEm, 1, wordConfig);
        // Past the word box, or (negative) short of it: a word drawn smaller than its box gives room back.
        const overHeight = reach.halfHeight - GLOW_WORD_LINE_HEIGHT / 2;
        topEm = Math.max(topEm, overHeight);
        bottomEm = Math.max(bottomEm, overHeight);
        // The word's own jitter is in px: it moves the drawing the same way whatever the font size.
        topPx = Math.max(topPx, -wordConfig.y);
        bottomPx = Math.max(bottomPx, wordConfig.y);
        rowWidthEm += Math.max(widthEm, 2 * reach.halfWidth) + WORD_GAP_EM_AT_MOST;
    });
    // A turned row lifts one end and drops the other by up to half its width times the sine.
    const turnEm = (rowWidthEm / 2) * Math.abs(Math.sin((row.config.rotate * Math.PI) / 180));
    return { topEm: topEm + turnEm, bottomEm: bottomEm + turnEm, topPx, bottomPx };
};

/**
 * The spacing of every chunk of one column, top to bottom. Two neighbouring words are parted by how
 * far the two reach toward each other (their offsets included), two neighbouring rows by how far the
 * upper reaches down plus how far the lower reaches up; never by less than Partita's own gaps.
 */
export const getPartitaOverlapSpacing = (rows: PartitaOverlapRow[]): PartitaRowSpacing[] => {
    const reaches = rows.map(rowReach);

    return rows.map((row, rowIndex) => {
        const direction = row.rtl ? 'rtl' : 'ltr';
        const words = row.wordConfigs.map((wordConfig, index): React.CSSProperties => {
            const next = row.wordConfigs[index + 1];
            if (!next) return { marginInlineEnd: WORD_GAP };
            // Reaches in em (no offsets), the offsets' share in px.
            const gapEm = getGlowWordPairGap(
                { width: row.widthsEm[index] ?? 0, pose: wordConfig },
                { width: row.widthsEm[index + 1] ?? 0, pose: next },
                1,
            );
            const gapPx = row.rtl ? next.x - wordConfig.x : wordConfig.x - next.x;
            return { marginInlineEnd: `max(${WORD_GAP}, ${lengthOf(gapEm + BREATH_EM, gapPx)})` };
        });

        const reach = reaches[rowIndex];
        const below = reaches[rowIndex + 1];
        // Room the two rows' word boxes need between them, less the chunk padding already there.
        const marginBottom = below
            ? `max(${row.config.marginBottom}, calc(${lengthOf(reach.bottomEm + below.topEm + BREATH_EM, reach.bottomPx + below.topPx)} - 2 * ${CHUNK_PADDING_Y}))`
            : `max(${row.config.marginBottom}, calc(${lengthOf(reach.bottomEm, reach.bottomPx)} - ${CHUNK_PADDING_Y}))`;

        return {
            words,
            marginTop: rowIndex === 0 ? `max(0px, calc(${lengthOf(reach.topEm, reach.topPx)} - ${CHUNK_PADDING_Y}))` : undefined,
            marginBottom,
        };
    });
};
