// Timing and release choices are compiled from lyrics; artwork traits are chosen by the authoring agent.
export const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, value));
export const smooth = value => { const p = clamp(value); return p * p * (3 - 2 * p); };
export const FADE_SECONDS = .9;
export const phraseOpacity = (phrase, time) => time < phrase.releaseStart ? 0 : 1 - smooth((time - phrase.fadeAt) / FADE_SECONDS);
export const hash = text => Array.from(text).reduce((n, ch) => (Math.imul(n, 31) + ch.codePointAt(0)) >>> 0, 17);
const grapheme = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const word = new Intl.Segmenter(undefined, { granularity: 'word' });
export const split = text => Array.from(grapheme.segment(text), part => ({ text: part.segment, offset: part.index }));
const connected = /[\u0590-\u0dff]/u;

export function chooseMode(settings = {}, text = '') {
    const explicit = ['glyph', 'line', 'assemble'].includes(settings.lyricMode) ? settings.lyricMode : null;
    const mode = explicit || ({ 'line-art': 'glyph', 'graphic-poster': 'line', 'atmospheric-light': 'assemble' }[settings.artStyle] || 'glyph');
    return connected.test(text) ? 'line' : mode;
}

export function compile(scene, settings = {}) {
    const phrases = scene.lines.filter(line => line.text?.trim()).map((line, index) => {
        const start = Math.max(0, Number(line.start) || 0);
        const timings = (line.glyphs?.length ? line.glyphs : line.words || []).filter(cue => Number.isFinite(cue.start) && Number.isFinite(cue.end));
        const end = Math.max(start + .01, Number(line.end) || start, ...timings.map(cue => cue.end));
        const onsets = timings.filter(cue => cue.text.trim()).map(cue => ({ start: Math.max(start, cue.start), end: Math.max(cue.start + .01, cue.end) })).sort((a, b) => a.start - b.start);
        return { ...line, start, end, index, mode: chooseMode(settings, line.text), seed: hash(line.text), onsets,
            density: Math.min(12, Array.from(line.text.replace(/\s/g, '')).length / Math.max(.1, end - start)) };
    }).sort((a, b) => a.start - b.start || a.index - b.index);
    phrases.forEach((phrase, order) => {
        phrase.order = order; phrase.units = unitsFor(phrase);
        phrase.releaseStart = phrase.mode === 'glyph' ? Math.min(...phrase.units.filter(unit => !unit.blank).map(unit => unit.start)) : phrase.start;
    });
    phrases.forEach((phrase, order) => { phrase.fadeAt = phrases[order + 2]?.releaseStart ?? Infinity; });
    // Interval components reserve distinct reading lanes for the full readable lifetime, not only vocal time.
    let component = [], reservations = [], componentEnd = -Infinity;
    const finish = () => component.forEach(phrase => { phrase.laneCount = reservations.length; });
    for (const phrase of phrases) {
        if (phrase.releaseStart > componentEnd) { finish(); component = []; reservations = []; componentEnd = -Infinity; }
        let lane = reservations.findIndex(end => end <= phrase.releaseStart);
        if (lane < 0) lane = reservations.length;
        reservations[lane] = phrase.fadeAt + FADE_SECONDS;
        phrase.lane = lane; component.push(phrase); componentEnd = Math.max(componentEnd, phrase.fadeAt + FADE_SECONDS);
    }
    finish();
    const tree = (start, end) => {
        if (start >= end) return null;
        const mid = (start + end) >>> 1, left = tree(start, mid), right = tree(mid + 1, end), phrase = phrases[mid];
        return { phrase, left, right, minStart: phrases[start].start, maxEnd: Math.max(phrase.end, left?.maxEnd ?? 0, right?.maxEnd ?? 0),
            maxVisibleEnd: Math.max(phrase.fadeAt + FADE_SECONDS, left?.maxVisibleEnd ?? 0, right?.maxVisibleEnd ?? 0) };
    };
    const end = Math.max(1, Number(scene.duration) || 0, ...phrases.map(phrase => phrase.end + 2));
    return { phrases, tree: tree(0, phrases.length), duration: end, seed: hash(scene.title || 'Cat and Bee') };
}

export function latest(items, time, key = 'start') {
    let lo = 0, hi = items.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (items[mid][key] <= time) lo = mid + 1; else hi = mid; }
    return lo - 1;
}

export function activePhrases(program, time) {
    const result = [];
    const visit = node => {
        if (!node || node.minStart > time || node.maxVisibleEnd <= time) return;
        visit(node.left);
        if (node.phrase.releaseStart <= time && node.phrase.fadeAt + FADE_SECONDS > time) result.push(node.phrase);
        visit(node.right);
    };
    visit(program.tree); return result;
}

export function rhythmAt(program, time) {
    const find = node => {
        if (!node || node.minStart > time || node.maxEnd < time) return null;
        return find(node.right) || (node.phrase.start <= time && node.phrase.end >= time ? node.phrase : null) || find(node.left);
    };
    const phrase = find(program.tree);
    if (!phrase) return { active: 0, rate: 0, phrase: null, progress: 0 };
    const cues = phrase.onsets, at = latest(cues, time), cue = cues[at];
    const span = cue ? Math.max(.1, Math.min(cue.end - cue.start, (cues[at + 1]?.start ?? phrase.end) - cue.start || 1)) : 1 / Math.max(.2, phrase.density);
    const rate = cue && time > cue.end + .18 ? 0 : Math.min(10, 1 / span);
    return { active: 1, rate, phrase, progress: clamp((time - phrase.start) / Math.max(.01, phrase.end - phrase.start)) };
}

// Chinese uses graphemes; Latin words and connected scripts keep their shaping context.
export function unitsFor(phrase) {
    if (phrase.units) return phrase.units;
    const glyphs = split(phrase.text), exact = phrase.glyphs?.map(glyph => glyph.text).join('') === phrase.text;
    const timing = glyphs.map((glyph, i) => ({ ...glyph,
        start: exact ? phrase.glyphs[i].start : phrase.start + (phrase.end - phrase.start) * i / Math.max(1, glyphs.length),
        end: exact ? phrase.glyphs[i].end : phrase.start + (phrase.end - phrase.start) * (i + 1) / Math.max(1, glyphs.length) }));
    if (!exact) {
        let cursor = 0;
        for (const cue of phrase.words || []) {
            const offset = phrase.text.indexOf(cue.text, cursor);
            if (offset < 0 || !cue.text) continue;
            const covered = timing.filter(glyph => glyph.offset >= offset && glyph.offset < offset + cue.text.length);
            covered.forEach((glyph, i) => { glyph.start = cue.start + (cue.end - cue.start) * i / covered.length; glyph.end = cue.start + (cue.end - cue.start) * (i + 1) / covered.length; });
            cursor = offset + cue.text.length;
        }
    }
    const groups = Array.from(word.segment(phrase.text)).flatMap(part =>
        /[\u2e80-\u9fff\u3040-\u30ff\uac00-\ud7af]/u.test(part.segment) ? split(part.segment).map(glyph => ({ segment: glyph.text, index: part.index + glyph.offset })) : [part]);
    return groups.map((part, index) => {
        const covered = timing.filter(glyph => glyph.offset >= part.index && glyph.offset < part.index + part.segment.length);
        const start = Math.max(phrase.start, covered[0]?.start ?? phrase.start), end = Math.max(start + .01, ...covered.map(glyph => glyph.end));
        return { text: part.segment, start, end, index, blank: !part.segment.trim(), offset: part.index };
    });
}
