import { clamp, smooth, phraseOpacity } from '../lyricImprint/timeline.mjs';
import { rectangle, overlap } from '../lyricImprint/anchors.mjs';

// Visible letters leave the singer, travel on a frozen path, then transfer continuously to their stationary anchors.
function point(route, q) {
    if (route.length === 7) return q < .5 ? point(route.slice(0, 4), q * 2) : point(route.slice(3), q * 2 - 1);
    const a = 1 - q;
    return { x: a ** 3 * route[0].x + 3 * a * a * q * route[1].x + 3 * a * q * q * route[2].x + q ** 3 * route[3].x,
        y: a ** 3 * route[0].y + 3 * a * a * q * route[1].y + 3 * a * q * q * route[2].y + q ** 3 * route[3].y };
}

function sample(unit, time) {
    const age = time - unit.birth, life = phraseOpacity(unit.phrase, time);
    if (age < 0 || life <= 0) return null;
    const progress = clamp(age / unit.travelDuration), q = smooth(progress), landed = progress === 1;
    const pos = landed ? { x: unit.anchorX, y: unit.anchorY } : point(unit.route, q);
    // No alpha-zero jump to a remote point: a recognisable glyph is visible at its actual departure point.
    const scale = .5 + .5 * smooth((progress - .6) / .4), alpha = life * (.78 + .22 * smooth(progress));
    const holdAge = Math.max(0, age - unit.travelDuration);
    const x = pos.x + unit.float * Math.sin(holdAge * .56) * Math.cos(unit.flowPhase);
    const y = pos.y + unit.float * Math.sin(holdAge * .73) * Math.sin(unit.flowPhase + .6);
    return { x, y, scale, alpha, landed, progress, box: rectangle(x, y, unit.halfWidth * scale, unit.halfHeight * scale) };
}

export function journeyPose(unit, time) {
    const pose = sample(unit, time);
    return pose ? { ...unit, ...pose, reveal: 1 } : null;
}

function cost(unit, earlier, frame, cache, ceiling, budget) {
    let score = 0;
    const horizon = Math.max(unit.travelDuration, ...earlier.map(other => other.birth + (other.travelDuration || 0) - unit.birth));
    const samples = unit.count > 24 ? 16 : Math.ceil(horizon * 60);
    const key = `${horizon}:${samples}`;
    if (!cache.has(key)) cache.set(key, Array.from({ length: samples + 1 }, (_, step) => {
        const time = unit.birth + horizon * step / samples;
        const boxes = earlier.flatMap(other => {
            if (--budget.remaining < 0) return [];
            const old = other.route ? sample(other, time) : time >= other.birth && phraseOpacity(other.phrase, time) > 0 ? { box: other.envelope } : null;
            return old ? [old.box] : [];
        });
        return { time, boxes };
    }));
    for (const { time, boxes } of cache.get(key)) {
        if (budget.remaining <= 0) return Infinity;
        const pose = sample(unit, time);
        if (!pose) continue;
        if (pose.box.left < 0 || pose.box.right > frame.width || pose.box.top < 0 || pose.box.bottom > frame.height) score += 100;
        const box = rectangle(pose.x, pose.y, unit.halfWidth * pose.scale + 1, unit.halfHeight * pose.scale + 1);
        for (const old of boxes) {
            if (--budget.remaining < 0) return Infinity;
            if (overlap(box, old)) score += 1;
            if (score >= ceiling) return score;
        }
    }
    return score;
}

export function compileJourneys(groups, source, frame) {
    const short = Math.min(frame.width, frame.height), earlier = [];
    // A whole song has a fixed planning budget. Exhaustion uses a deterministic direct route, never drops lyrics.
    const budget = { remaining: 350000 };
    const units = [...groups.values()].flat().sort((a, b) => a.birth - b.birth || a.phrase.order - b.phrase.order || a.rank - b.rank);
    for (const unit of units) {
        if (unit.phrase.mode !== 'assemble') { earlier.push(unit); continue; }
        const raw = source.at(unit.birth, unit.phrase, unit);
        const available = Math.max(.0001, Math.min(unit.phrase.end, unit.phrase.fadeAt) - unit.birth);
        const duration = Math.min(available, 1.15 + Math.hypot(unit.anchorX - raw.x, unit.anchorY - raw.y) / short * .6);
        let best = null, bestScore = Infinity;
        const cache = new Map();
        // A few deterministic wind/approach alternatives reduce crossings without relocating retained text.
        for (let variant = 0; variant < (unit.count > 24 ? 3 : 24); variant++) {
            const spread = (variant % 3 - 1) * short * .012;
            const launch = { x: raw.x - short * .022, y: raw.y + spread };
            const bend = Math.floor(variant / 3) % 6, side = bend % 2 ? -1 : 1;
            let route = [launch,
                { x: launch.x - short * (.14 + bend * .035), y: launch.y - short * (.06 + bend * .025) },
                { x: unit.anchorX + side * short * (.07 + bend * .025), y: unit.anchorY + side * short * (.09 + bend * .025) },
                { x: unit.anchorX, y: unit.anchorY }];
            if (variant >= 12) {
                const relevant = earlier.filter(other => other.phrase.fadeAt + .9 > unit.birth);
                const gx = Math.max(unit.halfWidth + 3, Math.min(launch.x, unit.anchorX, ...relevant.map(other => other.anchorX)) - short * (.07 + bend * .015));
                const gy = Math.max(unit.halfHeight + 3, Math.min(unit.anchorY, ...relevant.map(other => other.anchorY)) - short * (.06 + bend * .015));
                const lift = short * .055;
                route = [launch, { x: launch.x - short * .18, y: launch.y }, { x: gx, y: gy + lift }, { x: gx, y: gy },
                    { x: gx, y: gy - lift }, { x: unit.anchorX, y: gy }, { x: unit.anchorX, y: unit.anchorY }];
            }
            const speed = 1;
            const candidate = { ...unit, launch, route, travelDuration: Math.min(available, duration * speed), emitter: raw };
            if (!best) best = candidate;
            const score = budget.remaining > 0 ? cost(candidate, earlier, frame, cache, bestScore, budget) : Infinity;
            if (score < bestScore) { best = candidate; bestScore = score; }
            if (score === 0 || budget.remaining <= 0) break;
        }
        Object.assign(unit, best, { travelCost: bestScore });
        earlier.push(unit);
        // Only still-visible earlier lyrics can interact with the next departure.
        while (earlier.length && earlier[0].phrase.fadeAt + .9 < unit.birth) earlier.shift();
    }
}
