import { measureUnits, overlap, rectangle } from '../lyricImprint/anchors.mjs';
import { FADE_SECONDS, hash, phraseOpacity, smooth, clamp } from '../lyricImprint/timeline.mjs';
import { imprintPose } from '../lyricImprint/motion.mjs';
import { compileJourneys, journeyPose } from './journey.mjs';

// A breath writes a rising, uneven ribbon; its letters settle locally instead of travelling with the singer.
const random = (seed, salt) => {
    let value = hash(`${seed}:${salt}`);
    value = Math.imul(value ^ value >>> 16, 0x21f0aaad);
    value = Math.imul(value ^ value >>> 15, 0x735a2d97);
    return ((value ^ value >>> 15) >>> 0) / 0xffffffff;
};

function ribbon(units, size, width, phrase) {
    const rows = []; let row = [], advance = 0;
    const limit = width * (.76 + random(phrase.seed, 'width') * .16);
    for (const unit of units) {
        const previous = row.at(-1), pause = previous ? clamp((unit.start - previous.end) * 1.6) : 0;
        const gap = size * (.54 + pause * .7 + (previous && /[，,。.!！?？、]/u.test(previous.text) ? .5 : 0));
        const cell = unit.halfWidth * 2 + gap;
        if (row.length && advance + cell > limit) { rows.push({ units: row, width: advance }); row = []; advance = 0; }
        row.push({ ...unit, left: advance, cell }); advance += cell;
    }
    if (row.length) rows.push({ units: row, width: advance });
    const breath = clamp((phrase.end - phrase.start) / Math.max(1, units.length) / 1.2);
    const shaped = []; let lift = 0;
    rows.forEach((row, rowIndex) => {
        const bend = random(phrase.seed, `bend${rowIndex}`), rise = size * (1.1 + breath * 1.4 + bend * .6);
        const bow = size * (.55 + breath * .7 + random(phrase.seed, `bow${rowIndex}`) * .5);
        const offset = rowIndex ? size * (random(phrase.seed, `offset${rowIndex}`) - .5) * 1.6 : 0;
        row.units.forEach((unit, i) => {
            const t = row.units.length === 1 ? 0 : (unit.left + unit.cell / 2 - row.units[0].cell / 2) / Math.max(1, row.width - (row.units[0].cell + row.units.at(-1).cell) / 2);
            shaped.push({ ...unit, dx: offset + unit.left + unit.cell / 2 - row.units[0].cell / 2,
                dy: -lift - rise * t - bow * Math.sin(Math.PI * t) + size * .13 * Math.sin(i * 1.7 + bend * 5),
                row: rowIndex });
        });
        lift += rise + bow + size * 2.2;
    });
    return shaped;
}

// All visible lifetimes and entrance envelopes are reserved once; no current-time collision search can move old text.
export function compileFlow(ctx, program, frame, source, options) {
    const bounds = options.bounds(frame), short = Math.min(frame.width, frame.height), portrait = frame.height > frame.width;
    const births = [...program.phrases].sort((a, b) => a.releaseStart - b.releaseStart || a.order - b.order);
    for (let attempt = 0; attempt < 13; attempt++) {
        const size = short * .037 * frame.fontScale * .82 ** attempt, float = Math.min(2.6, size * .065);
        const margin = size * .04, groups = new Map();
        let occupied = (options.obstacles?.(frame) || []).map(box => ({ box, until: Infinity })), failed = false;
        for (const phrase of births) {
            occupied = occupied.filter(item => item.until > phrase.releaseStart);
            const units = measureUnits(ctx, phrase, frame, size, (bounds.right - bounds.left) * .7);
            const shaped = ribbon(units, size, bounds.right - bounds.left, phrase);
            const origin = source.at(phrase.releaseStart, phrase), span = Math.max(.001, Math.min(phrase.end, phrase.fadeAt) - phrase.releaseStart);
            // Very narrow portraits can put the safe text corridor farther from the head than half the screen width.
            const corridorDistance = Math.hypot(Math.max(bounds.left - origin.x, 0, origin.x - bounds.right), Math.max(bounds.top - origin.y, 0, origin.y - bounds.bottom));
            const sourceRadius = Math.max(short * .56, corridorDistance + short * .3);
            const window = Math.max(0, span - Math.min(1.6, span * .45)), enter = Math.min(.7, span * .3);
            const prepared = shaped.map((unit, rank) => {
                const seed = random(phrase.seed, unit.index);
                const flowDelay = window * clamp((unit.start - units[0].start) / Math.max(.01, phrase.end - units[0].start));
                const entryX = size * .11 * (seed * 2 - 1), entryY = size * (.35 + seed * .15);
                const padX = float + margin + Math.abs(entryX), padY = float + margin + entryY;
                return { ...unit, rank, count: shaped.length, birth: phrase.mode === 'glyph' ? unit.start : phrase.releaseStart + (phrase.mode === 'assemble' ? flowDelay : 0),
                    flowDelay, flowEnter: enter, entryX, entryY, float, padding: margin, layoutSize: size, origin, sourceRadius,
                    hw: unit.halfWidth + padX, hh: unit.halfHeight + padY, flowPhase: seed * Math.PI * 2 };
            });
            const left = Math.min(0, ...prepared.map(u => u.dx - u.hw)), right = Math.max(0, ...prepared.map(u => u.dx + u.hw));
            const top = Math.min(0, ...prepared.map(u => u.dy - u.hh)), bottom = Math.max(0, ...prepared.map(u => u.dy + u.hh));
            const loX = bounds.left - left, hiX = bounds.right - right, loY = bounds.top - top, hiY = bounds.bottom - bottom;
            if (loX > hiX || loY > hiY) { failed = true; break; }
            const wanted = { x: origin.x - short * (portrait ? .27 : .16), y: origin.y - short * (portrait ? .24 : .065) };
            // Search around the feasible point; an off-screen center collapses every candidate onto the same edge.
            const center = { x: Math.max(loX, Math.min(hiX, wanted.x)), y: Math.max(loY, Math.min(hiY, wanted.y)) };
            let placement = null;
            const tryAt = (x, y) => {
                x = Math.max(loX, Math.min(hiX, x)); y = Math.max(loY, Math.min(hiY, y));
                if (Math.hypot(x + prepared[0].dx - origin.x, y + prepared[0].dy - origin.y) > sourceRadius) return null;
                const boxes = prepared.map(u => rectangle(x + u.dx, y + u.dy, u.hw, u.hh));
                if (boxes.some((box, i) => occupied.some(other => overlap(box, other.box)) || boxes.slice(0, i).some(other => overlap(box, other)))) return null;
                return { x, y, boxes };
            };
            placement = tryAt(center.x, center.y);
            const step = Math.max(short * .018, size * .65);
            for (let ring = 1; !placement && ring <= 22; ring++) for (let spoke = 0; !placement && spoke < 24; spoke++) {
                const angle = spoke * Math.PI / 12 + random(phrase.seed, 'search') * .4;
                placement = tryAt(center.x + Math.cos(angle) * step * ring, center.y + Math.sin(angle) * step * ring);
            }
            if (!placement) { failed = true; break; }
            const fixed = prepared.map((unit, i) => ({ ...unit, anchorX: placement.x + unit.dx, anchorY: placement.y + unit.dy,
                groupX: placement.x, groupY: placement.y, envelope: placement.boxes[i] }));
            groups.set(phrase, fixed);
            occupied.push(...placement.boxes.map(box => ({ box, until: phrase.fadeAt + FADE_SECONDS })));
        }
        if (!failed) {
            if (!frame.reducedMotion) compileJourneys(groups, source, frame);
            return { groups, size, bounds, attempts: attempt + 1 };
        }
    }
    throw new Error('Nightingale breath ribbons exceed the available area');
}

export function flowPose(unit, time, reduced) {
    if (reduced || unit.phrase.mode === 'glyph') return imprintPose(unit, time, reduced);
    if (unit.phrase.mode === 'assemble') return journeyPose(unit, time);
    const age = time - unit.birth, life = phraseOpacity(unit.phrase, time);
    if (age < 0 || life <= 0) return null;
    const whole = unit.phrase.mode === 'line', phase = whole ? unit.phrase.seed : unit.flowPhase;
    const q = smooth(age / Math.max(.0001, unit.flowEnter));
    const x = unit.anchorX + (whole ? 0 : unit.entryX) * (1 - q) + unit.float * Math.sin(age * .56) * Math.cos(phase);
    const y = unit.anchorY + (whole ? unit.layoutSize * .28 : unit.entryY) * (1 - q) + unit.float * Math.sin(age * .73) * Math.sin(phase + .6);
    const scale = .88 + .12 * q;
    return { ...unit, x, y, alpha: life * q, scale, reveal: 1, box: rectangle(x, y, unit.halfWidth * scale, unit.halfHeight * scale) };
}
