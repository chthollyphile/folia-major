import { activePhrases, phraseOpacity, smooth, hash } from './timeline.mjs';
import { compileAnchors, rectangle } from './anchors.mjs';

// Birth grammar, local hold motion and N+2 retirement are independent; no pose uses the emitter's current position.
export function imprintPose(unit, time, reduced = false) {
    const phrase = unit.phrase, age = time - (reduced ? phrase.releaseStart : unit.birth), life = phraseOpacity(phrase, time);
    if (age < 0 || life <= 0) return null;
    const seed = hash(`${phrase.order}:${unit.index}:${unit.text}`) / 0xffffffff;
    let x = unit.anchorX, y = unit.anchorY, alpha = life, scale = 1, reveal = 1;
    if (!reduced) {
        if (phrase.mode === 'glyph') {
            const available = Math.max(.001, Math.min(unit.end, phrase.end, phrase.fadeAt) - unit.start);
            reveal = smooth(age / Math.min(.45, available * .55));
            alpha *= smooth(age / Math.min(.10, available * .5));
        } else if (phrase.mode === 'line') {
            const enter = smooth(age / Math.min(.45, Math.max(.001, Math.min(phrase.end, phrase.fadeAt) - phrase.releaseStart) * .5));
            scale = .94 + .06 * enter;
            x = unit.groupX + (x - unit.groupX) * scale;
            y = unit.groupY + (y - unit.groupY) * scale + (1 - enter) * unit.layoutSize * .28;
            alpha *= enter;
        } else {
            const span = Math.max(.001, Math.min(phrase.end, phrase.fadeAt) - phrase.releaseStart);
            const delay = seed * Math.min(.42, span * .24), gather = Math.min(.65, span * .5);
            const q = smooth((age - delay) / gather);
            x += (1 - q) * unit.size * .045 * Math.sin(seed * 19);
            y += (1 - q) * unit.size * .38 * Math.cos(seed * 23);
            scale = .86 + .14 * q; alpha *= q;
        }
        const localSeed = phrase.mode === 'glyph' ? seed * 100 : phrase.seed;
        x += unit.float * Math.sin(age * .61) * Math.cos(localSeed);
        y += unit.float * Math.sin(age * .79) * Math.sin(localSeed + .7);
    }
    return { ...unit, x, y, alpha, scale, reveal, box: rectangle(x, y, unit.halfWidth * scale, unit.halfHeight * scale) };
}

export function createImprints(ctx, options) {
    let key = '', previousProgram = null, previousSource = null, compiled = null;
    return (frame, program, source) => {
        const next = JSON.stringify([frame.width, frame.height, frame.dpr, frame.fontFamily, frame.fontWeight, frame.fontScale, frame.reducedMotion]);
        if (key !== next || previousProgram !== program || previousSource !== source.key) {
            key = next; previousProgram = program; previousSource = source.key;
            compiled = (options.compile || compileAnchors)(ctx, program, frame, source, options);
        }
        const items = [];
        for (const phrase of activePhrases(program, frame.time)) for (const unit of compiled.groups.get(phrase)) {
            const pose = (options.pose || imprintPose)(unit, frame.time, frame.reducedMotion);
            if (pose && pose.alpha > 0) items.push(pose);
        }
        return { items, ...compiled };
    };
}
