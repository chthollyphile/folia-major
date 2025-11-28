import { LyricData, Line, Word } from '../types';

export const parseYRC = (yrcString: string, translationString: string = ''): LyricData => {
  const lines: Line[] = [];

  // Helper to parse translation (standard LRC format)
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
    // Skip JSON metadata lines for now, or parsing failures
    // Line format: [start,duration]...
    const lineMatch = rawLine.match(/^\[(\d+),(\d+)\](.*)/);
    if (!lineMatch) continue;

    const lineStartTimeMs = parseInt(lineMatch[1], 10);
    const lineDurationMs = parseInt(lineMatch[2], 10);
    const rest = lineMatch[3];
    
    const lineStartTime = lineStartTimeMs / 1000;
    const lineEndTime = (lineStartTimeMs + lineDurationMs) / 1000;

    const words: Word[] = [];
    let fullText = "";

    // Word format: (start,duration,0)text
    // Note: text might contain parentheses? The regex needs to be careful.
    // The format seems to be (start,dur,flag)text
    // We can split by '(' and process.
    
    const wordRegex = /\((\d+),(\d+),(\d+)\)([^\(]*)/g;
    let wordMatch;
    
    while ((wordMatch = wordRegex.exec(rest)) !== null) {
      const wStartMs = parseInt(wordMatch[1], 10);
      const wDurMs = parseInt(wordMatch[2], 10);
      const text = wordMatch[4]; // The text after the parenthesis group

      const wStartTime = wStartMs / 1000;
      const wEndTime = (wStartMs + wDurMs) / 1000;

      words.push({
        text,
        startTime: wStartTime,
        endTime: wEndTime
      });
      fullText += text;
    }

    // Find matching translation
    // We look for a translation line that starts around the same time (within a tolerance, e.g., 0.5s)
    const translation = translationEntries.find(t => Math.abs(t.startTime - lineStartTime) < 0.5)?.text;

    if (words.length > 0) {
      lines.push({
        words,
        startTime: lineStartTime,
        endTime: lineEndTime,
        fullText,
        translation
      });
    }
  }

  // Sort lines by start time
  lines.sort((a, b) => a.startTime - b.startTime);

  return { lines };
};

