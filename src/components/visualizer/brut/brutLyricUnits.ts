import { type Line } from '../../../types';
import {
    endsWithApostrophe,
    isContractionSuffix,
    isStickyTrailingPunctuation,
} from '../../../utils/lyrics/cjkSemanticLayout';
import { buildLineGraphemeTimeline } from '../../../utils/lyrics/graphemeTiming';
import { buildGraphemeDisplayUnits, type GraphemeDisplayUnit } from '../../../utils/lyrics/graphemeUnits';
import { BRUT_MAX_INSTALL_UNITS } from './brutConstants';

// src/components/visualizer/brut/brutLyricUnits.ts
// The units that get individually bolted onto a lyric frame.
//
// Base grouping is the shared grapheme rule (CJK per character, latin per word). On top of that,
// trailing punctuation is glued to the unit before it - a lone 。 or , should never get its own
// slam - and very long lines merge adjacent units until they fit the glyph batch.
//
// Pure and DOM-free: this must never import the raster module, or it stops being unit testable.

export interface BrutInstallUnit {
    text: string;
    /** Code-unit range into line.fullText; the raster measures the unit's slot from this. */
    charStart: number;
    charEnd: number;
    startTime: number;
    endTime: number;
}

const mergeUnits = (fullText: string, first: BrutInstallUnit, second: BrutInstallUnit): BrutInstallUnit => ({
    text: fullText.slice(first.charStart, second.charEnd),
    charStart: first.charStart,
    charEnd: second.charEnd,
    startTime: first.startTime,
    endTime: second.endTime,
});

/**
 * Glues sticky trailing punctuation onto the preceding unit, and reassembles split contractions:
 * the parser emits `It | ’ | s`, and each of those must not get its own slam.
 */
const applySticky = (fullText: string, units: GraphemeDisplayUnit[]): BrutInstallUnit[] => {
    const merged: BrutInstallUnit[] = [];
    units.forEach((unit) => {
        const previous = merged[merged.length - 1];
        const sticks = previous && (
            isStickyTrailingPunctuation(unit.text)
            || (endsWithApostrophe(previous.text) && isContractionSuffix(unit.text))
        );
        if (previous && sticks) {
            merged[merged.length - 1] = mergeUnits(fullText, previous, unit);
            return;
        }
        merged.push({ ...unit });
    });
    return merged;
};

/** Halves the unit count by pairing neighbours, preserving the pair's outer timing span. */
const mergeAdjacentPairs = (fullText: string, units: BrutInstallUnit[]): BrutInstallUnit[] => {
    const merged: BrutInstallUnit[] = [];
    for (let index = 0; index < units.length; index += 2) {
        const first = units[index];
        const second = units[index + 1];
        merged.push(second ? mergeUnits(fullText, first, second) : first);
    }
    return merged;
};

/**
 * Builds the install units for one line. Returns an empty array for blank lines, so callers can use
 * the length to decide between the per-glyph batch and a single collapsed quad.
 */
export const buildBrutInstallUnits = (line: Line): BrutInstallUnit[] => {
    const fullText = line.fullText ?? '';
    if (!fullText.trim()) {
        return [];
    }

    const timeline = buildLineGraphemeTimeline(line);
    let units = applySticky(fullText, buildGraphemeDisplayUnits(fullText, timeline));
    while (units.length > BRUT_MAX_INSTALL_UNITS) {
        units = mergeAdjacentPairs(fullText, units);
    }
    return units;
};
