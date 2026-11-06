import type { Line } from '../../types';
import { buildLineGraphemeTimeline } from '../../utils/lyrics/graphemeTiming';
import type { CodeLine, CodeScene } from './contract';

// Whitelist only visual lyric data; source IDs, providers, account state and URLs never cross the sandbox.
export function codeLines(lines: Line[]): CodeLine[] {
    return lines.slice(0, 5000).map(line => ({
        text: line.fullText.slice(0, 4000), translation: (line.translation ?? '').slice(0, 4000),
        start: line.startTime, end: line.endTime, chorus: !!line.isChorus,
        words: line.words.slice(0, 4000).map(word => ({ text: word.text, start: word.startTime, end: word.endTime })),
        glyphs: buildLineGraphemeTimeline(line).slice(0, 4000).map(glyph => ({ text: glyph.char, start: glyph.startTime, end: glyph.endTime })),
    }));
}
export function makeCodeScene(lines: Line[], title = '', artist = '', album = '', duration = 0): CodeScene {
    return { title: title.slice(0, 2000), artist: artist.slice(0, 2000), album: album.slice(0, 2000), duration, lines: codeLines(lines) };
}
