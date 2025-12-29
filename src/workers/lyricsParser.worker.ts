/**
 * Lyrics Parser Web Worker
 * 
 * Offloads LRC and YRC parsing from the main thread.
 * 
 * Message API:
 * Request: { type: 'parse', format: 'lrc' | 'yrc', content: string, translation?: string, requestId?: string }
 * Response: { type: 'result', data: LyricData, requestId?: string } | { type: 'error', message: string, requestId?: string }
 */

// Inline type definitions (workers can't import from main)
interface Word {
    text: string;
    startTime: number;
    endTime: number;
}

interface Line {
    words: Word[];
    startTime: number;
    endTime: number;
    fullText: string;
    translation?: string;
    isChorus?: boolean;
    chorusEffect?: 'bars' | 'circles' | 'beams';
}

interface LyricData {
    lines: Line[];
    title?: string;
    artist?: string;
}

// --- LRC Parser ---
const parseLRC = (lrcString: string, translationString: string = ''): LyricData => {
    const lines: Line[] = [];
    const timeRegex = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/;

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

    rawEntries.sort((a, b) => a.startTime - b.startTime);

    for (let i = 0; i < rawEntries.length; i++) {
        const current = rawEntries[i];
        const next = rawEntries[i + 1];

        const candidates = transEntries.filter(t => Math.abs(t.startTime - current.startTime) < 1.0);
        candidates.sort((a, b) => Math.abs(a.startTime - current.startTime) - Math.abs(b.startTime - current.startTime));
        const translation = candidates[0]?.text;

        let duration = next ? next.startTime - current.startTime : 5;

        const MAX_DURATION_PER_CHAR = 0.5;
        const estimatedReadingTime = current.text.length * MAX_DURATION_PER_CHAR;
        if (duration > estimatedReadingTime + 2 && duration > 5) {
            duration = Math.min(duration, estimatedReadingTime + 2);
        }

        const endTime = current.startTime + duration;

        const rawTokens = current.text.split(/\s+/).filter(t => t);
        let tokens: { text: string; weight: number }[] = [];
        let totalWeight = 0;

        for (const token of rawTokens) {
            if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(token)) {
                const chars = token.split('');
                chars.forEach(c => {
                    const isPunctuation = /[，。！？、：；"'）]/.test(c);
                    const weight = isPunctuation ? 0 : 1;
                    tokens.push({ text: c, weight });
                    totalWeight += weight;
                });
            } else {
                const weight = 1 + (token.length * 0.15);
                tokens.push({ text: token, weight });
                totalWeight += weight;
            }
        }

        if (totalWeight === 0) totalWeight = 1;

        const activeDuration = duration * 0.9;
        const timePerWeight = activeDuration / totalWeight;

        const words: Word[] = [];
        let currentWordStart = current.startTime;

        if (tokens.length > 0) {
            tokens.forEach((token) => {
                const wordDuration = token.weight * timePerWeight;
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

    const finalLines: Line[] = [];

    const createInterlude = (start: number, end: number): Line => {
        const duration = end - start;
        const dots = "......";
        const wordDuration = duration / 6;
        const words: Word[] = [];

        for (let j = 0; j < 6; j++) {
            words.push({
                text: ".",
                startTime: start + (j * wordDuration),
                endTime: start + ((j + 1) * wordDuration)
            });
        }

        return { startTime: start, endTime: end, fullText: dots, words };
    };

    if (lines.length > 0 && lines[0].startTime > 3) {
        finalLines.push(createInterlude(0.5, lines[0].startTime - 0.5));
    }

    for (let i = 0; i < lines.length; i++) {
        const current = lines[i];
        finalLines.push(current);

        const next = lines[i + 1];
        if (next) {
            const gap = next.startTime - current.endTime;
            if (gap > 3) {
                finalLines.push(createInterlude(current.endTime + 0.05, next.startTime - 0.05));
            }
        }
    }

    return { lines: finalLines };
};

// --- YRC Parser ---
const parseYRC = (yrcString: string, translationString: string = ''): LyricData => {
    const lines: Line[] = [];

    const parseTranslation = (str: string) => {
        const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;
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

    const translationEntries = parseTranslation(translationString);
    const rawLines = yrcString.split('\n');

    for (const rawLine of rawLines) {
        const lineMatch = rawLine.match(/^\[(\d+),(\d+)\](.*)/);
        if (!lineMatch) continue;

        const lineStartTimeMs = parseInt(lineMatch[1], 10);
        const lineDurationMs = parseInt(lineMatch[2], 10);
        const rest = lineMatch[3];

        const lineStartTime = lineStartTimeMs / 1000;
        const lineEndTime = (lineStartTimeMs + lineDurationMs) / 1000;

        const words: Word[] = [];
        let fullText = "";

        const wordRegex = /\((\d+),(\d+),(\d+)\)([^\(]*)/g;
        let wordMatch;

        while ((wordMatch = wordRegex.exec(rest)) !== null) {
            const wStartMs = parseInt(wordMatch[1], 10);
            const wDurMs = parseInt(wordMatch[2], 10);
            const text = wordMatch[4];

            const wStartTime = wStartMs / 1000;
            const wEndTime = (wStartMs + wDurMs) / 1000;

            words.push({ text, startTime: wStartTime, endTime: wEndTime });
            fullText += text;
        }

        const candidates = translationEntries.filter(t => Math.abs(t.startTime - lineStartTime) < 1.0);
        candidates.sort((a, b) => Math.abs(a.startTime - lineStartTime) - Math.abs(b.startTime - lineStartTime));
        const translation = candidates.length > 0 ? candidates[0].text : undefined;

        if (words.length > 0) {
            lines.push({ words, startTime: lineStartTime, endTime: lineEndTime, fullText, translation });
        }
    }

    lines.sort((a, b) => a.startTime - b.startTime);

    const finalLines: Line[] = [];

    const createInterlude = (start: number, end: number): Line => {
        const duration = end - start;
        const dots = "......";
        const wordDuration = duration / 6;
        const words: Word[] = [];

        for (let j = 0; j < 6; j++) {
            words.push({
                text: ".",
                startTime: start + (j * wordDuration),
                endTime: start + ((j + 1) * wordDuration)
            });
        }

        return { startTime: start, endTime: end, fullText: dots, words };
    };

    if (lines.length > 0 && lines[0].startTime > 3) {
        finalLines.push(createInterlude(0.5, lines[0].startTime - 0.5));
    }

    for (let i = 0; i < lines.length; i++) {
        const current = lines[i];
        finalLines.push(current);

        const next = lines[i + 1];
        if (next) {
            const gap = next.startTime - current.endTime;
            if (gap > 3) {
                finalLines.push(createInterlude(current.endTime + 0.05, next.startTime - 0.05));
            }
        }
    }

    return { lines: finalLines };
};

// --- Worker Message Handler ---
self.onmessage = (e: MessageEvent) => {
    const { type, format, content, translation, requestId } = e.data;

    if (type !== 'parse') {
        self.postMessage({ type: 'error', message: 'Unknown message type', requestId });
        return;
    }

    try {
        let result: LyricData;
        if (format === 'yrc') {
            result = parseYRC(content, translation || '');
        } else {
            result = parseLRC(content, translation || '');
        }
        self.postMessage({ type: 'result', data: result, requestId });
    } catch (err) {
        self.postMessage({ type: 'error', message: String(err), requestId });
    }
};
