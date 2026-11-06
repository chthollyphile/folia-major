// Keep the host's grapheme timing. Latin runs stay readable; CJK syllables become individual notes.
export const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
export const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function compileNotes(lines) {
    const notes = [];
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        let word = [];
        const flush = () => {
            if (!word.length) return;
            notes.push({ text: word.map(g => g.text).join(''), glyphs: word, start: word[0].start,
                end: Math.max(word.at(-1).end, word[0].start + .08), lineIndex, seed: notes.length });
            word = [];
        };
        for (const glyph of line.glyphs) {
            if (!Number.isFinite(glyph.start) || !Number.isFinite(glyph.end)) continue;
            if (/^\s+$/u.test(glyph.text)) { flush(); continue; }
            const alphabetic = /^[\p{Script=Latin}\p{Script=Arabic}\p{Script=Hebrew}\p{N}'’-]+$/u.test(glyph.text);
            if (!alphabetic) flush();
            word.push(glyph);
            if (!alphabetic || word.length >= 12) flush();
        }
        flush();
    }
    return notes.sort((a, b) => a.start - b.start || a.seed - b.seed);
}

export function upperBound(items, time) {
    let low = 0, high = items.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (items[middle].start <= time) low = middle + 1; else high = middle;
    }
    return low;
}

export function hummingAt(notes, time) {
    const end = upperBound(notes, time);
    let energy = 0;
    for (let index = Math.max(0, end - 12); index < end; index++) {
        const note = notes[index], age = time - note.start;
        if (time > note.end + .25) continue;
        energy = Math.max(energy, smooth(age / .12) * (1 - smooth((time - note.end) / .25)));
    }
    return energy;
}

// Distance anchors prevent long words from colliding with the next emitted note.
export function measureNotes(notes, measure, size, speed) {
    let distance = 0;
    return notes.map((note, index) => {
        const width = measure(note.text);
        if (index) distance += Math.max(speed * (note.start - notes[index - 1].start), width + size * .7);
        let prefix = '';
        const timings = note.glyphs.map(glyph => {
            const left = measure(prefix); prefix += glyph.text;
            return { start: glyph.start, end: glyph.end, left, right: measure(prefix) };
        });
        return { ...note, width, distance, timings, rtl: /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(note.text) };
    });
}

export function distanceAt(notes, time, speed) {
    if (!notes.length) return 0;
    const index = upperBound(notes, time) - 1;
    if (index < 0) return notes[0].distance + (time - notes[0].start) * speed;
    const a = notes[index], b = notes[index + 1];
    if (!b) return a.distance + (time - a.start) * speed;
    const progress = clamp((time - a.start) / Math.max(.001, b.start - a.start));
    return a.distance + (b.distance - a.distance) * progress;
}

// Hold sustained notes within the readable arc until every timed glyph has been revealed.
export function noteFlight(note, time, clock, reach) {
    const age = time - note.start;
    const raw = Math.max(0, clock - note.distance);
    const hold = reach * .62;
    const release = smooth((time - note.end - .18) / 1.2);
    const travel = raw <= hold ? raw : hold + (raw - hold) * release;
    const progress = travel / reach;
    const lifetime = 1 - smooth((time - Math.max(note.start + 6.5, note.end + .2)) / 2.5);
    return { travel, progress, opacity: smooth(age / .22) * (1 - smooth((progress - .68) / .37)) * lifetime };
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function wrapGraphemes(text, maxWidth, measure) {
    const result = []; let row = '';
    for (const { segment } of segmenter.segment(text)) {
        if (row && (segment === '\n' || measure(row + segment) > maxWidth)) { result.push(row); row = ''; }
        if (segment !== '\n') row += segment;
    }
    if (row) result.push(row);
    return result;
}
