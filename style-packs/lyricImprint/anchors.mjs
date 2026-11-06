import { FADE_SECONDS, unitsFor } from './timeline.mjs';

// Allocate immutable birth anchors and reserve the complete local animation envelope until N+2 has faded.
export const overlap = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
export const rectangle = (x, y, hw, hh) => ({ left: x - hw, right: x + hw, top: y - hh, bottom: y + hh });

function nearestFree(wanted, hw, hh, bounds, occupied, step, allowed = () => true) {
    const loX = bounds.left + hw, hiX = bounds.right - hw, loY = bounds.top + hh, hiY = bounds.bottom - hh;
    if (loX > hiX || loY > hiY) return null;
    const test = (x, y) => {
        x = Math.max(loX, Math.min(hiX, x)); y = Math.max(loY, Math.min(hiY, y));
        const box = rectangle(x, y, hw, hh);
        return !allowed(x, y) || occupied.some(item => overlap(box, item.box)) ? null : { x, y, box };
    };
    let found = test(wanted.x, wanted.y);
    if (found) return found;
    // This search only runs while compiling anchors. Playback never chooses another position.
    for (let ring = 1; ring <= 18; ring++) {
        for (let spoke = 0; spoke < 20; spoke++) {
            const angle = spoke * Math.PI / 10 + ring * .37;
            found = test(wanted.x + Math.cos(angle) * ring * step, wanted.y + Math.sin(angle) * ring * step);
            if (found) return found;
        }
    }
    let best = null, score = Infinity;
    for (let y = loY; y <= hiY; y += step) for (let x = loX; x <= hiX; x += step) {
        const distance = (x - wanted.x) ** 2 + (y - wanted.y) ** 2;
        if (distance >= score) continue;
        const candidate = test(x, y);
        if (candidate) { best = candidate; score = distance; }
    }
    return best;
}

export function measureUnits(ctx, phrase, frame, size, maxWidth) {
    ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    // Connected/mixed-direction scripts stay one Canvas-shaped run; do not reverse English around one RTL word.
    const connected = /[\u0590-\u0dff]/u.test(phrase.text);
    const sourceUnits = connected ? [{ text: phrase.text, index: 0, start: phrase.start, end: phrase.end, offset: 0 }] : unitsFor(phrase).filter(unit => !unit.blank);
    const units = sourceUnits.map(unit => {
        const firstLetter = unit.text.match(/\p{L}/u)?.[0] || '';
        const rtl = /[\u0590-\u08ff]/u.test(firstLetter);
        ctx.direction = rtl ? 'rtl' : 'ltr';
        let localSize = size, font = `${frame.fontWeight} ${localSize}px ${frame.fontFamily}`;
        ctx.font = font;
        const initial = ctx.measureText(unit.text);
        localSize *= Math.min(1, maxWidth / Math.max(1, initial.width));
        font = `${frame.fontWeight} ${localSize}px ${frame.fontFamily}`; ctx.font = font;
        const metric = ctx.measureText(unit.text);
        return { ...unit, phrase, rtl, font, size: localSize,
            halfWidth: Math.max(metric.width / 2, Math.abs(metric.actualBoundingBoxLeft || 0), Math.abs(metric.actualBoundingBoxRight || 0)),
            halfHeight: Math.max(localSize * .6, Math.abs(metric.actualBoundingBoxAscent || 0), Math.abs(metric.actualBoundingBoxDescent || 0)) };
    });
    ctx.restore(); return units;
}

function groupLayout(units, size, width) {
    const rows = []; let row = [], advance = 0;
    for (const unit of units) {
        const gap = size * (/^[\p{L}\p{N}]+$/u.test(unit.text) && unit.text.length > 1 ? .32 : .17);
        const cell = unit.halfWidth * 2 + gap;
        if (row.length && advance + cell > width) { rows.push({ units: row, width: advance }); row = []; advance = 0; }
        row.push({ ...unit, left: advance, cell }); advance += cell;
    }
    if (row.length) rows.push({ units: row, width: advance });
    const lineHeight = Math.max(size * 1.8, ...units.map(unit => unit.halfHeight * 2 + size * .8));
    const rtl = units.some(unit => unit.rtl), placed = [];
    rows.forEach((row, index) => row.units.forEach(unit => placed.push({ ...unit,
        dx: (unit.left + unit.cell / 2 - row.width / 2) * (rtl ? -1 : 1), dy: (index - (rows.length - 1) / 2) * lineHeight })));
    return { units: placed, width: Math.max(0, ...rows.map(row => row.width)), height: rows.length * lineHeight };
}

export function compileAnchors(ctx, program, frame, source, options) {
    const bounds = options.bounds(frame), short = Math.min(frame.width, frame.height);
    for (let attempt = 0; attempt < 10; attempt++) {
        const size = short * (options.fontSize || .041) * frame.fontScale * .8 ** attempt;
        const float = Math.min(3, size * .075), margin = Math.max(.6, size * .075), events = [];
        for (const phrase of program.phrases) {
            const units = measureUnits(ctx, phrase, frame, size, (bounds.right - bounds.left) * .8);
            if (phrase.mode === 'glyph' && !frame.reducedMotion) {
                const radius = short * (options.birthRadius || .22);
                for (let from = 0; from < units.length;) {
                    const origins = [source.at(units[from].start, phrase, units[from])];
                    let to = from + 1;
                    // Slow syllables may be far apart. Split by actual source span, not a fixed character count.
                    while (to < Math.min(units.length, from + 6)) {
                        const next = source.at(units[to].start, phrase, units[to]), points = [...origins, next];
                        const xs = points.map(p => p.x), ys = points.map(p => p.y);
                        if (Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > radius * .65) break;
                        origins.push(next); to++;
                    }
                    const group = groupLayout(units.slice(from, to), size, (bounds.right - bounds.left) * .73);
                    const center = origins.reduce((point, origin) => ({ x: point.x + origin.x / origins.length, y: point.y + origin.y / origins.length }), { x: 0, y: 0 });
                    group.units = group.units.map((unit, i) => ({ ...unit, origin: origins[i],
                        dy: unit.dy + Math.max(-size * .3, Math.min(size * .3, (origins[i].y - center.y) * .35)) }));
                    group.height += size * .6;
                    events.push({ birth: phrase.releaseStart, phrase, group, origin: center, radius });
                    from = to;
                }
            } else {
                const group = groupLayout(units, size, (bounds.right - bounds.left) * .73);
                events.push({ birth: phrase.releaseStart, phrase, group });
            }
        }
        events.sort((a, b) => a.birth - b.birth || a.phrase.order - b.phrase.order || (a.unit?.index ?? 0) - (b.unit?.index ?? 0));
        const groups = new Map(program.phrases.map(phrase => [phrase, []]));
        let occupied = (options.obstacles?.(frame) || []).map(box => ({ box, until: Infinity })), failed = false;
        for (const event of events) {
            occupied = occupied.filter(item => item.until > event.birth);
            const origin = event.origin || source.at(event.birth, event.phrase);
            const bias = options.bias?.(frame, event.phrase) || { x: 0, y: 0 };
            const wanted = { x: origin.x + bias.x, y: origin.y + bias.y };
            const hw = Math.max(0, ...event.group.units.map(unit => Math.abs(unit.dx) + unit.halfWidth)) + float + margin + (event.phrase.mode === 'assemble' ? size * .045 : 0);
            const entranceY = frame.reducedMotion || event.phrase.mode === 'glyph' ? 0 : size * (event.phrase.mode === 'line' ? .28 : .38);
            const hh = Math.max(0, ...event.group.units.map(unit => Math.abs(unit.dy) + unit.halfHeight)) + float + entranceY + margin;
            const allowed = event.radius ? (x, y) => event.group.units.every(unit => Math.hypot(x + unit.dx - unit.origin.x, y + unit.dy - unit.origin.y) <= event.radius) : undefined;
            const anchor = nearestFree(wanted, hw, hh, bounds, occupied, Math.max(3, size * .7), allowed);
            if (!anchor) { failed = true; break; }
            occupied.push({ box: anchor.box, until: event.phrase.fadeAt + FADE_SECONDS });
            const units = event.group.units;
            units.forEach((unit, rank) => groups.get(event.phrase).push({ ...unit, birth: event.phrase.mode === 'glyph' ? unit.start : event.birth, rank, count: units.length,
                anchorX: anchor.x + unit.dx, anchorY: anchor.y + unit.dy, groupX: anchor.x, groupY: anchor.y,
                origin: unit.origin || origin, float, envelope: anchor.box, padding: margin, layoutSize: size }));
        }
        if (!failed) return { groups, size, bounds, attempts: attempt + 1 };
    }
    throw new Error('Lyrics exceed the available imprint area even after adaptive sizing');
}
