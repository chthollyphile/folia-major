import type { LyricData } from '../../types';
import { findTranslationsForSortedStartTimes, type TimedTextEntry } from './parserCore';

// src/utils/lyrics/mergeLyricTranslation.ts

// Copies translations from `donor` onto `base` lines by start time (within one second), leaving
// the base text and timing untouched. Returns null when nothing could be merged.
export const mergeLyricTranslation = (base: LyricData, donor: LyricData): LyricData | null => {
    const entries: TimedTextEntry[] = donor.lines
        .filter(line => line.translation?.trim())
        .map(line => ({ startTime: line.startTime, text: line.translation!.trim() }))
        .sort((left, right) => left.startTime - right.startTime);
    if (entries.length === 0) return null;

    const order = base.lines.map((line, index) => ({ index, startTime: line.startTime }))
        .sort((left, right) => left.startTime - right.startTime);
    const translations = findTranslationsForSortedStartTimes(order.map(item => item.startTime), entries);
    const byIndex = new Map(order.map((item, position) => [item.index, translations[position]]));

    let merged = 0;
    const lines = base.lines.map((line, index) => {
        const translation = byIndex.get(index);
        if (!translation || line.translation?.trim()) return line;
        merged += 1;
        return { ...line, translation };
    });
    return merged > 0 ? { ...base, lines } : null;
};
