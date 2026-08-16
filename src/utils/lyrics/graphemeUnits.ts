import { splitLyricGraphemes, type GraphemeTiming } from './graphemeTiming';

// src/utils/lyrics/graphemeUnits.ts
// Groups a line's graphemes into the units a per-character visualizer should actually render and
// animate: every CJK grapheme is its own unit (逐字), consecutive non-CJK graphemes belonging to the
// same parser word form one unit (每个词单独). Whitespace separates units and is never a unit itself,
// but its advance still shapes the layout because callers measure slots by character RANGE against
// the full line string - which is also why repeated words can never borrow each other's timing.
//
// The timing source must be buildLineGraphemeTimeline(line): it is aligned to `fullText`, including
// the spaces and punctuation that parser words may not contain.

export interface GraphemeDisplayUnit {
    text: string;
    /** Code-unit indices into the line string, so the unit's slot can be measured with kerning intact. */
    charStart: number;
    charEnd: number;
    startTime: number;
    endTime: number;
}

// Graphemes that split per character: han, kana, compatibility ideographs, half-width kana, PLUS
// bullets and geometric shapes (interlude countdown dots must each stand alone).
const CJK_GRAPHEME_RE = /[⺀-鿿぀-ヿ豈-﫿ｦ-ﾟ•·■-◿]/;

export const isCjkDisplayGrapheme = (grapheme: string): boolean => CJK_GRAPHEME_RE.test(grapheme);

/** Splits `fullText` into display units using parser-derived grapheme timing. */
export const buildGraphemeDisplayUnits = (
    fullText: string,
    timeline: GraphemeTiming[],
): GraphemeDisplayUnit[] => {
    if (!fullText || timeline.length === 0) {
        return [];
    }

    const graphemes = splitLyricGraphemes(fullText);
    const charOffsets: number[] = [];
    let cursor = 0;
    graphemes.forEach((grapheme) => {
        charOffsets.push(cursor);
        cursor += grapheme.length;
    });

    const units: GraphemeDisplayUnit[] = [];
    const pushUnit = (from: number, to: number) => {
        const text = graphemes.slice(from, to).join('');
        if (text.trim().length === 0) {
            return;
        }
        units.push({
            text,
            charStart: charOffsets[from] ?? 0,
            charEnd: (charOffsets[to - 1] ?? 0) + (graphemes[to - 1]?.length ?? 1),
            startTime: timeline[from].startTime,
            endTime: timeline[to - 1].endTime,
        });
    };

    const length = Math.min(graphemes.length, timeline.length);
    let index = 0;
    while (index < length) {
        const grapheme = graphemes[index] ?? '';
        if (grapheme.trim().length === 0) {
            index += 1;
            continue;
        }
        if (CJK_GRAPHEME_RE.test(grapheme)) {
            pushUnit(index, index + 1);
            index += 1;
            continue;
        }

        const wordIndex = timeline[index].wordIndex;
        let end = index + 1;
        while (
            end < length
            && timeline[end].wordIndex === wordIndex
            && (graphemes[end] ?? '').trim().length > 0
            && !CJK_GRAPHEME_RE.test(graphemes[end] ?? '')
        ) {
            end += 1;
        }
        pushUnit(index, end);
        index = end;
    }

    return units;
};
