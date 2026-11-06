import { createImprints } from '../lyricImprint/motion.mjs';
import { createPaint } from '../lyricImprint/paint.mjs';
import { compileFlow, flowPose } from './flow.mjs';

// The singer's breath forms curved, uneven sentences; there is no horizontal subtitle destination.
export function createNightingalePlan(ctx) {
    return createImprints(ctx, {
        compile: compileFlow,
        pose: flowPose,
        bounds: f => ({ left: f.width * .06, right: f.width * .94, top: f.height * .11, bottom: f.height * (f.height > f.width ? .42 : .46) }),
        obstacles: f => f.height > f.width ? [] : [{ left: f.width * .44, right: f.width * .62, top: f.height * .275, bottom: f.height * .53 }],
    });
}

export function createLyrics(ctx, settings = {}) {
    return createPaint(ctx, createNightingalePlan(ctx), { text: '#fff2d7', shadow: '#a7cbd8', subtitle: '#bdd3dc', subtitleY: .87,
        accent: '#e5c992', translation: settings.showTranslation !== false });
}
