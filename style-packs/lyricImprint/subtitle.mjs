import { unitsFor } from './timeline.mjs';

// Static text measurement for accessibility and translations; normal primary lyrics use trail.mjs exclusively.
export function createLayout(ctx) {
    let key = '', cache = new Map();
    return (frame, phrase, activeCount = 1) => {
        const next = JSON.stringify([frame.width, frame.height, frame.dpr, frame.fontFamily, frame.fontWeight, frame.fontScale, frame.subtitleFontFamily, frame.subtitleFontWeight, frame.subtitleFontScale]);
        if (key !== next) { key = next; cache.clear(); }
        if (cache.has(phrase)) return cache.get(phrase);
        const units = unitsFor(phrase), w = frame.width, h = frame.height, s = Math.min(w, h);
        let size = s * .052 * frame.fontScale, rows = [], font;
        for (let attempt = 0; attempt < 32; attempt++) {
            font = `${frame.fontWeight} ${size}px ${frame.fontFamily}`; ctx.font = font;
            rows = []; let row = [], width = 0, widest = 0;
            for (const unit of units) {
                const advance = ctx.measureText(unit.text).width + (unit.blank ? 0 : size * .08);
                if (row.length && width + advance > w * .80) { rows.push({ units: row, width }); row = []; width = 0; }
                row.push({ ...unit, advance, left: width }); width += advance; widest = Math.max(widest, width);
            }
            if (row.length) rows.push({ units: row, width });
            const height = phrase.laneCount > 1 ? h * .30 / phrase.laneCount * .82 : h * .22;
            if (rows.length * size * 1.5 <= height && widest <= w * .82) break;
            size *= .89;
        }
        const rtl = /[\u0590-\u08ff]/u.test(phrase.text), laid = [];
        const baseY = h * (phrase.laneCount > 1 ? .16 + (phrase.lane + .5) * .30 / phrase.laneCount : .34);
        rows.forEach((row, rowIndex) => {
            row.text = row.units.map(unit => unit.text).join(''); row.y = baseY + (rowIndex - (rows.length - 1) / 2) * size * 1.5;
            row.units.forEach(unit => {
                const x = w * .5 + unit.left + unit.advance / 2 - row.width / 2;
                const bend = rows.length > 3 ? 0 : Math.sin((unit.left / Math.max(1, row.width)) * Math.PI) * size * .38;
                laid.push({ ...unit, x, y: row.y - bend, row: rowIndex });
            });
        });
        const subtitleSize = Math.max(12 * frame.dpr, s * .024) * frame.subtitleFontScale;
        const subFont = `${frame.subtitleFontWeight} ${subtitleSize}px ${frame.subtitleFontFamily}`;
        ctx.font = subFont;
        const translation = phrase.translation || '', subRows = [];
        let row = '';
        for (const token of Array.from(new Intl.Segmenter(undefined, { granularity: 'word' }).segment(translation), part => part.segment)) {
            if (row && ctx.measureText(row + token).width > w * .82) { subRows.push(row.trim()); row = ''; }
            row += token;
        }
        if (row.trim()) subRows.push(row.trim());
        const result = { units: laid, rows, font, size, baseY, subFont, subtitleSize, subRows, rtl,
            mode: laid.length > 192 || size < 11 * frame.dpr ? 'line' : phrase.mode };
        // Repeated seeks do not retain every song's layout indefinitely.
        while (cache.size >= Math.max(8, activeCount)) cache.delete(cache.keys().next().value);
        cache.set(phrase, result); return result;
    };
}
