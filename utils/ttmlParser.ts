import { LyricData, Line, Word } from '../types';

const parseTime = (timeStr: string): number => {
  if (!timeStr) return 0;
  // Format: HH:MM:SS.mmm or MM:SS.mmm
  const parts = timeStr.split(':');
  let seconds = 0;
  
  if (parts.length === 3) {
    seconds += parseInt(parts[0], 10) * 3600;
    seconds += parseInt(parts[1], 10) * 60;
    seconds += parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds += parseInt(parts[0], 10) * 60;
    seconds += parseFloat(parts[1]);
  } else {
    seconds = parseFloat(timeStr);
  }
  return seconds;
};

export const parseTTML = (xmlString: string): LyricData => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "text/xml");
  
  const body = xmlDoc.getElementsByTagName("body")[0];
  if (!body) throw new Error("Invalid TTML: No body tag found");

  const lines: Line[] = [];
  const ps = xmlDoc.getElementsByTagName("p");

  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const begin = parseTime(p.getAttribute("begin") || "0");
    const end = parseTime(p.getAttribute("end") || "0");
    const spans = p.getElementsByTagName("span");
    
    const words: Word[] = [];
    let fullText = "";

    if (spans.length > 0) {
      for (let j = 0; j < spans.length; j++) {
        const span = spans[j];
        const wordText = span.textContent || "";
        const wBegin = parseTime(span.getAttribute("begin") || p.getAttribute("begin") || "0");
        const wEnd = parseTime(span.getAttribute("end") || p.getAttribute("end") || "0");
        
        words.push({
          text: wordText,
          startTime: wBegin,
          endTime: wEnd
        });
        fullText += wordText;
      }
    } else {
      // Fallback if no spans (line-level only)
      const text = p.textContent || "";
      fullText = text;
      // Heuristic splitting if needed, or treat as one big word
      words.push({
        text: text,
        startTime: begin,
        endTime: end
      });
    }

    lines.push({
      words,
      startTime: begin,
      endTime: end,
      fullText
    });
  }

  // Sort by start time just in case
  lines.sort((a, b) => a.startTime - b.startTime);

  return { lines };
};