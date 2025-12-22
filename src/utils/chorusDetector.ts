/**
 * Detects chorus lines from LRC content based on frequency analysis.
 * Returns a Set of strings representing the chorus lines.
 */
export const detectChorusLines = (lrcString: string): Set<string> => {
    const lines = lrcString.split('\n');
    const lineCounts = new Map<string, number>();
    const timeRegex = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;

    // 1. Count frequencies of normalized lines
    lines.forEach(line => {
        // Remove time tags
        const text = line.replace(timeRegex, '').trim();
        if (!text || text === "......") return;

        // Normalize: remove punctuation, lowercase? 
        // For now, let's keep it simple: exact match of trimmed text.
        // Maybe ignore very short lines (interjections like "Yeah", "Oh")?
        if (text.length < 2) return;

        const count = lineCounts.get(text) || 0;
        lineCounts.set(text, count + 1);
    });

    // 2. Find the maximum frequency
    let maxCount = 0;
    lineCounts.forEach(count => {
        if (count > maxCount) maxCount = count;
    });

    // 3. Identify chorus lines
    // A line is considered a chorus candidate if it appears frequently.
    // Heuristic: If maxCount > 2, take lines with count >= maxCount - 1?
    // Or just take the most frequent ones?
    // User request: "认为重复次数最多的歌词文本属于高潮阶段" (Consider the most repeated lyric text as the climax/chorus)

    const chorusLines = new Set<string>();

    // If no repetition found (maxCount <= 1), return empty
    if (maxCount <= 1) return chorusLines;

    lineCounts.forEach((count, text) => {
        // Strict: only the absolute max? Or near max?
        // "重复次数最多的" implies absolute max.
        if (count === maxCount) {
            chorusLines.add(text);
        }
    });
    console.log("[ChorusDetector] Chorus lines detected:", chorusLines);
    return chorusLines;
};
