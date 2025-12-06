import { LyricData, Line, Word } from '../types';

export const parseLRC = (lrcString: string, translationString: string = ''): LyricData => {
    const lines: Line[] = [];
    // Support both dot (.) and colon (:) as separator for milliseconds
    const timeRegex = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/;

    // Helper to parse simple lrc structure
    const parseRaw = (str: string) => {
        return str.split('\n').map(line => {
            const match = timeRegex.exec(line);
            if (!match) return null;

            const min = parseInt(match[1], 10);
            const sec = parseInt(match[2], 10);
            const ms = parseFloat(`0.${match[3]}`);
            const startTime = min * 60 + sec + ms;
            const text = line.replace(timeRegex, '').trim();

            return { startTime, text };
        }).filter((entry): entry is { startTime: number, text: string } => entry !== null && entry.text.length > 0);
    };

    const rawEntries = parseRaw(lrcString);
    const transEntries = parseRaw(translationString);

    // Sort by time
    rawEntries.sort((a, b) => a.startTime - b.startTime);

    // Convert to Line objects with estimated durations
    for (let i = 0; i < rawEntries.length; i++) {
        const current = rawEntries[i];
        const next = rawEntries[i + 1];

        // Find translation (fuzzy match time within 1.0s, closest)
        const candidates = transEntries.filter(t => Math.abs(t.startTime - current.startTime) < 1.0);
        candidates.sort((a, b) => Math.abs(a.startTime - current.startTime) - Math.abs(b.startTime - current.startTime));
        const translationMatch = candidates[0];
        const translation = translationMatch ? translationMatch.text : undefined;

        // Estimate raw duration
        // If there is a next line, duration is difference.
        // If last line, default to 5s.
        let duration = next ? next.startTime - current.startTime : 5;

        // HEURISTIC: Clamp max duration per line to avoid "hanging" lyrics during instrumental breaks
        const MAX_DURATION_PER_CHAR = 0.5;
        const estimatedReadingTime = current.text.length * MAX_DURATION_PER_CHAR;
        if (duration > estimatedReadingTime + 2 && duration > 5) {
            duration = Math.min(duration, estimatedReadingTime + 2);
        }

        const endTime = current.startTime + duration;

        // --- Intelligent Splitting & Weighting ---

        const rawTokens = current.text.split(/\s+/).filter(t => t);
        let tokens: { text: string; weight: number }[] = [];
        let totalWeight = 0;

        for (const token of rawTokens) {
            // Check if token contains CJK characters
            if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(token)) {
                // Split CJK into individual chars
                const chars = token.split('');
                chars.forEach(c => {
                    // CJK punctuation gets 0 weight (instant), normal chars get 1
                    const isPunctuation = /[，。！？、：；”’）]/.test(c);
                    const weight = isPunctuation ? 0 : 1;
                    tokens.push({ text: c, weight });
                    totalWeight += weight;
                });
            } else {
                // English/Latin word. 
                const weight = 1 + (token.length * 0.15);
                tokens.push({ text: token, weight });
                totalWeight += weight;
            }
        }

        // If strictly punctuation or empty
        if (totalWeight === 0) totalWeight = 1;

        // Distribute time based on weights
        const activeDuration = duration * 0.9;
        const padding = duration * 0.1;
        const timePerWeight = activeDuration / totalWeight;

        const words: Word[] = [];
        let currentWordStart = current.startTime;

        if (tokens.length > 0) {
            tokens.forEach((token) => {
                const wordDuration = token.weight * timePerWeight;

                // Ensure min duration for visibility
                const finalDuration = Math.max(wordDuration, 0.05);

                words.push({
                    text: token.text,
                    startTime: currentWordStart,
                    endTime: currentWordStart + finalDuration
                });

                if (token.weight > 0) {
                    currentWordStart += wordDuration;
                } else {
                    currentWordStart += 0.05;
                }
            });
        }

        // Fix overlaps if any (simple clamp)
        if (words.length > 0) {
            const lastWord = words[words.length - 1];
            if (lastWord.endTime > endTime) {
                const scale = (endTime - current.startTime) / (lastWord.endTime - current.startTime);
                words.forEach(w => {
                    w.startTime = current.startTime + (w.startTime - current.startTime) * scale;
                    w.endTime = current.startTime + (w.endTime - current.startTime) * scale;
                });
            }
        }

        lines.push({
            words,
            startTime: current.startTime,
            endTime,
            fullText: current.text,
            translation
        });
    }

    return { lines };
};