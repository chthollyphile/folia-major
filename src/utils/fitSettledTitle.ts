import { layoutWithLines, measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';

// src/utils/fitSettledTitle.ts — three-line title fitting from a target width, plus the DOM
// corrector that stands behind it.

export const TYPOGRAPHY = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
    'font-variation-settings', 'line-height', 'letter-spacing', 'word-spacing', 'text-transform',
    'text-wrap', 'word-break', 'overflow-wrap', 'white-space'] as const;

/** Lines a preview may occupy, unless its metrics say otherwise (`maxLines`). The clamp in the stylesheet has to agree with this. */
export const TITLE_MAX_LINES = 3;
const ELLIPSIS = '…';
/** Sub-pixel slack for a line count derived from a measured height. */
const LINE_EPSILON = 0.02;

/** Everything the measurement depends on, read once from the live cascade. */
export type TitleMetrics = {
    /** Canvas font shorthand: style, weight, size/line-height and the family stack. */
    font: string;
    letterSpacing: number;
    lineHeight: number;
    fontSize: number;
    /** Layout width the title will occupy, which is not always the width it has right now. */
    width: number;
    /** Lines the preview may occupy where that is not TITLE_MAX_LINES (a heading of the explore wall: two). */
    maxLines?: number;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemesOf = (text: string) => [...segmenter.segment(text)].map(segment => segment.segment);

/**
 * Reads the metrics a fit depends on. `width` is the box the title is heading for; pass null to
 * take the one it currently has.
 *
 * Only the properties the measurement actually consumes are read. Everything else on `TYPOGRAPHY`
 * still matters to the DOM corrector, which clones the node's own computed style rather than this.
 */
export function readTitleMetrics(node: HTMLElement, targetWidth: number | null): TitleMetrics | null {
    const style = getComputedStyle(node);
    const lineHeight = parseFloat(style.lineHeight);
    const width = targetWidth ?? parseFloat(style.width);
    if (!(lineHeight > 0) || !(width > 0)) return null;
    return {
        font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`,
        letterSpacing: parseFloat(style.letterSpacing) || 0,
        lineHeight,
        fontSize: parseFloat(style.fontSize),
        width,
    };
}

/**
 * The longest prefix of `text` that still renders in three lines (in `metrics.maxLines`, where
 * the metrics name a limit), with an ellipsis when anything was dropped. Pure arithmetic over
 * font metrics: no element has to exist, let alone be laid out, so an expanding card can be
 * fitted against the width it is springing toward.
 *
 * Two rules here are what keep the result usable, both taken from `seniorious-text`'s layout:
 * the mark's own width comes out of the last line's budget, and the cut is walked by grapheme
 * rather than stopped at the last word boundary, which is exactly what leaves a line half empty.
 */
export function fitTitleToWidth(text: string, metrics: TitleMetrics): string {
    const { font, letterSpacing, lineHeight, width } = metrics;
    const maxLines = metrics.maxLines ?? TITLE_MAX_LINES;
    const countLines = (value: string) => layoutWithLines(
        prepareWithSegments(value, font, { letterSpacing }), width, lineHeight).lineCount;
    const laid = layoutWithLines(prepareWithSegments(text, font, { letterSpacing }), width, lineHeight);
    if (laid.lineCount <= maxLines) return text;

    const graphemes = graphemesOf(text);
    const candidate = (count: number) => `${graphemes.slice(0, count).join('').trimEnd()}${ELLIPSIS}`;
    // Seeded at what the first three lines hold, which is close but is not the answer: those lines
    // end on break opportunities, while a cut ends wherever the mark still fits, so the last line
    // is filled by grapheme past the final whole word - stopping at that word is exactly what
    // leaves a clamped line half empty. Line count only grows with length, so walking out until it
    // no longer fits and then back in lands on the boundary.
    let count = Math.min(graphemes.length,
        graphemesOf(laid.lines.slice(0, maxLines).map(line => line.text).join('')).length);
    while (count < graphemes.length && countLines(candidate(count + 1)) <= maxLines) count += 1;
    while (count > 0 && countLines(candidate(count)) > maxLines) count -= 1;
    return candidate(count);
}

// Where a line may end. Whitespace, the dashes and the slash, and every script that breaks between
// characters rather than between words. Deliberately generous: this is only used to find runs that
// cannot be broken at all, and over-reporting a break opportunity costs at worst one exact measure.
const BREAK_OPPORTUNITY = /[\s\-\u2010-\u2014/\u2E80-\u9FFF\u3000-\u303F\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/u;

// Under this many ems a line holds so few characters that the rules forbidding a line from
// starting on a closing bracket, or ending on an opening one, start deciding where the cut lands,
// and the model stops agreeing with the browser about them. Measured over 180 title/width
// combinations: every disagreement sat at or below 4.6 ems per line, none at or above 4.9.
const MIN_EMS_PER_LINE = 6;

/**
 * Whether a predicted fit can be trusted for this text at this width.
 *
 * Two known divergences, both answered by handing the case to the browser instead:
 *
 * The model breaks inside a word that does not fit; the browser, under the default
 * `overflow-wrap: normal`, refuses to and lets the word overflow a line of its own. That only
 * happens once some unbreakable run is wider than the column - rare on a compact poster, common on
 * an expanded card at display size.
 *
 * And a column only a few characters wide, where the line-break prohibitions around CJK
 * punctuation move the cut. A single-cell poster and the expanded card are both in that regime.
 */
export function titleFitIsPredictable(text: string, metrics: TitleMetrics): boolean {
    if (!(metrics.fontSize > 0) || metrics.width < metrics.fontSize * MIN_EMS_PER_LINE) return false;
    for (const run of text.split(BREAK_OPPORTUNITY)) {
        if (!run) continue;
        const width = measureNaturalWidth(prepareWithSegments(run, metrics.font, {
            letterSpacing: metrics.letterSpacing,
        }));
        if (width > metrics.width) return false;
    }
    return true;
}

/** Lines the node is actually rendering, read from its own box. */
const renderedLines = (node: HTMLElement, style: CSSStyleDeclaration) => {
    const lineHeight = parseFloat(style.lineHeight);
    if (!(lineHeight > 0)) return null;
    const inner = node.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    return inner / lineHeight;
};

/**
 * Whether the browser disagreed with the prediction badly enough to be worth re-measuring.
 *
 * Measured over 160 title/width combinations: never for a compact poster, and for about one in
 * forty expanded ones, where the display size puts whole words past the column - the browser
 * overflows such a word onto its own line, and the model breaks inside it instead. Both directions
 * are worth catching: too many lines bleeds a fourth one through the padding, and too few means
 * the title was cut shorter than it had to be.
 *
 * Must be called while the settled rule is in force, or the CSS clamp caps the height being read.
 */
export function titleFitNeedsCorrection(node: HTMLElement, text: string, fitted: string, maxLines = TITLE_MAX_LINES): boolean {
    const lines = renderedLines(node, getComputedStyle(node));
    if (lines === null) return false;
    if (lines > maxLines + LINE_EPSILON) return true;
    return fitted !== text && lines < maxLines - LINE_EPSILON;
}

/**
 * Measure an isolated copy; binary search never edits the visible card.
 *
 * The browser's own answer, and the corrector behind `fitTitleToWidth` rather than the path a
 * title normally takes. `width` fits against a box the node has not reached yet. Only the width
 * may differ: the three-line limit comes from the line height, which here is set by the viewport
 * rather than by the container.
 */
export function fitTitle(node: HTMLElement, text: string, options?: { width?: string; maxLines?: number; onRead?: () => void }) {
    const style = getComputedStyle(node);
    const probe = document.createElement('div');
    for (const property of TYPOGRAPHY) probe.style.setProperty(property, style.getPropertyValue(property));
    Object.assign(probe.style, {
        position: 'fixed', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none',
        width: options?.width ?? style.width, padding: '0', margin: '0', border: '0', boxSizing: 'border-box',
    });
    document.body.append(probe);
    const limit = parseFloat(style.lineHeight) * (options?.maxLines ?? TITLE_MAX_LINES) + 1;
    const fits = (value: string) => {
        probe.textContent = value;
        options?.onRead?.();
        return probe.getBoundingClientRect().height <= limit;
    };
    try {
        if (fits(text)) return text;
        const segments = graphemesOf(text);
        let low = 0;
        let high = segments.length;
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (fits(`${segments.slice(0, middle).join('').trimEnd()}${ELLIPSIS}`)) low = middle;
            else high = middle - 1;
        }
        return `${segments.slice(0, low).join('').trimEnd()}${ELLIPSIS}`;
    } finally {
        probe.remove();
    }
}
