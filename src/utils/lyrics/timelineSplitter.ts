export function splitCombinedTimeline(rawText: string): { main: string, trans: string } {
    if (!rawText) return { main: '', trans: '' };

    const timeRegex = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;
    const enhancedAngleRegex = /<\d{2}:\d{2}[.:]\d{2,3}>/;
    const enhancedBracketRegex = /^\s*\[\d{2}:\d{2}[.:]\d{2,3}\][^\[\]\n]+(?:\[\d{2}:\d{2}[.:]\d{2,3}\][^\[\]\n]*)+$/;
    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);

    const extracted: Array<{
        raw: string,
        timestampSignature: string,
        startTimestamp: string,
        isEnhancedLike: boolean,
    }> = [];

    for (const line of lines) {
        timeRegex.lastIndex = 0;
        let match: RegExpExecArray | null;
        let timestampSignature = '';
        let startTimestamp = '';

        while ((match = timeRegex.exec(line)) !== null) {
            if (!startTimestamp) {
                startTimestamp = match[0];
            }
            timestampSignature += match[0];
        }

        if (timestampSignature) {
            const hasMultipleBracketTimestamps = line.indexOf('[', 1) !== -1;

            extracted.push({
                raw: line,
                timestampSignature,
                startTimestamp,
                isEnhancedLike: enhancedAngleRegex.test(line) || (hasMultipleBracketTimestamps && enhancedBracketRegex.test(line))
            });
        } else {
            extracted.push({
                raw: line,
                timestampSignature: '',
                startTimestamp: '',
                isEnhancedLike: false
            });
        }
    }

    const mainLines: string[] = [];
    const transLines: string[] = [];
    let isCombined = false;
    
    for (let i = 0; i < extracted.length; i++) {
        const current = extracted[i];

        if (i === extracted.length - 1) {
            mainLines.push(current.raw);
            break;
        }

        const next = extracted[i + 1];
        const isExactPair = current.timestampSignature !== '' && current.timestampSignature === next.timestampSignature;
        const isEnhancedPair =
            current.startTimestamp !== '' &&
            current.startTimestamp === next.startTimestamp &&
            (current.isEnhancedLike || next.isEnhancedLike);

        if (isExactPair || isEnhancedPair) {
            mainLines.push(current.raw);
            transLines.push(next.raw);
            isCombined = true;
            i++;
        } else {
            mainLines.push(current.raw);
        }
    }

    if (isCombined) {
        return { main: mainLines.join('\n'), trans: transLines.join('\n') };
    } else {
        return { main: rawText, trans: '' };
    }
}
