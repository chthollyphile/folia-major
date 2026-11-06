import type { CodeContext, CodeRenderer, CodeLine, CodeStylePack } from './contract';

// A reusable lyric-only starter: no scene, cover, camera or permanent decoration is drawn.
function lyricTemplate(context: CodeContext): CodeRenderer {
    const ctx = context.canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    type Unit = { text: string; start: number; end: number };
    let timeline: { line: CodeLine; units: Unit[]; rtl: boolean; slot: number; fadeAt: number }[] = [], slots = 1, cacheKey = '';
    const layouts = new Map<number, { size: number; rows: { text: string; start: number; x: number; row: number }[] }>();
    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    const mode = String(context.settings.release ?? 'glyph');
    const rtlLetter = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}\p{Script=Samaritan}\p{Script=Mandaic}\p{Script=Adlam}\p{Script=Hanifi_Rohingya}\p{Script=Yezidi}]/u;
    // This starter keeps complex scripts intact; richer shaping needs an adapted renderer.
    const simpleGlyphs = /^[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Common}\p{Script=Inherited}\s]*$/u;
    return {
        update(next) {
            const lines = next.lines.filter(line => line.text.trim()).slice().sort((a, b) => a.start - b.start);
            const prepared = lines.map(line => {
                const wholeLine = mode === 'line' || !simpleGlyphs.test(line.text);
                const units = wholeLine ? [{ text: line.text, start: line.start, end: line.end }] : line.glyphs.length ? line.glyphs
                    : Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line.text), ({ segment: text }) => ({ text, start: line.start, end: line.end }));
                const birth = Math.max(line.start, Math.min(line.end, ...units.filter(unit => unit.text.trim()).map(unit => unit.start)));
                const firstLetter = Array.from(line.text).find(char => /\p{Letter}/u.test(char)) ?? '';
                return { line, units, birth, rtl: rtlLetter.test(firstLetter) };
            });
            const freeAt: number[] = [];
            timeline = prepared.map(({ line, units, birth, rtl }, index) => {
                const fadeAt = prepared[index + 2]?.birth ?? Infinity;
                // Allocate a fixed lane for the entire lifetime, including the N+2 fade.
                let slot = freeAt.findIndex(end => end <= birth);
                if (slot < 0) slot = freeAt.length;
                freeAt[slot] = fadeAt + .9;
                return { line, units, rtl, slot, fadeAt };
            });
            slots = Math.max(1, freeAt.length); layouts.clear(); cacheKey = '';
        },
        render(frame) {
            const { width: w, height: h, time } = frame;
            ctx.clearRect(0, 0, w, h);
            if (!frame.showText) return;
            const key = `${w}|${h}|${frame.dpr}|${frame.fontFamily}|${frame.fontWeight}|${frame.fontScale}`;
            if (key !== cacheKey) { layouts.clear(); cacheKey = key; }
            timeline.forEach(({ line, units, rtl, slot, fadeAt }, index) => {
                const alpha = Number.isFinite(fadeAt) ? 1 - clamp((time - fadeAt) / .9) : 1;
                if (time < line.start || alpha <= 0) return;
                let layout = layouts.get(index);
                if (!layout) {
                    let size = Math.min(w, h) * .052 * frame.fontScale;
                    let rows: { text: string; start: number; x: number; row: number }[] = [];
                    for (let attempt = 0; attempt < 24; attempt++) {
                        ctx.font = `${frame.fontWeight} ${size}px ${frame.fontFamily}`;
                        let x = 0, row = 0, widest = 0;
                        rows = units.map(unit => {
                            const advance = ctx.measureText(unit.text).width + size * .08;
                            if (x && x + advance > w * .8) { row++; x = 0; }
                            const glyph = { text: unit.text, start: unit.start, x, row }; x += advance; widest = Math.max(widest, x); return glyph;
                        });
                        if (widest <= w * .8 && (row + 2) * size * 1.5 < h * .8 / slots) break;
                        size *= .8;
                    }
                    layout = { size, rows }; layouts.set(index, layout);
                }
                const { size, rows } = layout;
                const y = h * (.1 + slot * .8 / slots) + size;
                ctx.font = `${frame.fontWeight} ${size}px ${frame.fontFamily}`;
                ctx.textBaseline = 'top';
                ctx.direction = rtl ? 'rtl' : 'ltr';
                ctx.textAlign = rtl ? 'right' : 'left';
                rows.forEach((unit, i) => {
                    const birth = Math.min(line.end, mode === 'line' ? line.start : unit.start);
                    if (time < birth) return;
                    // Finish even a late glyph's arrival by the line deadline.
                    const duration = Math.min(.45, Math.max(0, line.end - birth));
                    const enter = frame.reducedMotion || duration === 0 ? 1 : clamp((time - birth) / duration);
                    const offset = mode === 'assemble' ? (1 - enter) * size : 0;
                    ctx.globalAlpha = alpha * enter;
                    ctx.fillStyle = frame.theme.primary;
                    ctx.fillText(unit.text, w * (rtl ? .9 : .1) + unit.x + Math.sin(i * 2.4) * offset, y + unit.row * size * 1.5 - offset);
                });
            });
            ctx.globalAlpha = 1;
        },
    };
}
export const LYRIC_TEMPLATE_PACK: CodeStylePack = {
    format: 'folia-style', schemaVersion: 2, kind: 'lyric-template', id: 'folia.lyric-template', name: 'Lyric template', version: '1.0.0', author: 'Folia',
    description: 'A lyric-only starting point with glyph, line or independent assembly release. Adapt layout and lifetime to the personality.',
    palette: { background: '#13151b', primary: '#eee9dd', secondary: '#89918b', accent: '#d8f16f' },
    settings: { release: 'glyph' }, renderer: { apiVersion: 2, code: `FoliaStyle.define(${lyricTemplate.toString()});` },
};
