import { object, string } from './validation.mjs';

// Compare supplied, time-parametrized traces; diagnostics never certify aesthetic quality.
const coordinate = { type: 'number', minimum: -4, maximum: 4 };
export const motionSchema = object({
    source: object({ kind: { type: 'string', enum: ['rendered', 'planned'] }, artifact: string(2000) }),
    phrases: { type: 'array', minItems: 2, maxItems: 32, items: object({
        label: string(120), context: string(120), reason: string(1500), motif: string(500),
        samples: { type: 'array', minItems: 5, maxItems: 64, items: object({
            t: { type: 'number', minimum: 0, maximum: 86400 }, x: coordinate, y: coordinate,
        }) },
    }, ['label', 'context', 'reason', 'samples']) },
});

function normalize(samples) {
    for (let i = 1; i < samples.length; i++) {
        if (samples[i].t <= samples[i - 1].t) throw new Error('Sample times must strictly increase within each phrase.');
    }
    const first = samples[0], last = samples.at(-1);
    let cursor = 1;
    return Array.from({ length: 17 }, (_, i) => {
        const t = first.t + (last.t - first.t) * i / 16;
        while (cursor < samples.length - 1 && samples[cursor].t < t) cursor++;
        const a = samples[cursor - 1], b = samples[cursor];
        const u = (t - a.t) / (b.t - a.t);
        return { x: a.x + (b.x - a.x) * u - first.x, y: a.y + (b.y - a.y) * u - first.y };
    });
}
export function reviewMotion(input) {
    const traces = input.phrases.map(phrase => normalize(phrase.samples));
    const similarPairs = [], distances = [];
    for (let i = 0; i < traces.length; i++) {
        for (let j = i + 1; j < traces.length; j++) {
            const rms = Math.sqrt(traces[i].reduce((sum, point, k) => sum + (point.x - traces[j][k].x) ** 2 + (point.y - traces[j][k].y) ** 2, 0) / 17);
            distances.push(rms);
            if (rms < .025) similarPairs.push({ a: input.phrases[i].label, b: input.phrases[j].label,
                rms: Number(rms.toFixed(5)), motif: [input.phrases[i].motif ?? null, input.phrases[j].motif ?? null] });
        }
    }
    const ratio = similarPairs.length / distances.length;
    const contexts = [...new Set(input.phrases.map(phrase => phrase.context))];
    const warnings = [];
    if (ratio >= .6) warnings.push({ code: 'repeated-trajectory', message: 'Most supplied paths have similar shape and relative timing after removing translation. Review phrase-level changes; noise, renamed families or emitter drift do not establish variety. A deliberate recurring motif can be valid: watch its rhythm, typography and transitions.' });
    if (input.phrases.length < 4) warnings.push({ code: 'limited-sample', message: 'Fewer than four phrases; add a continuous passage containing sparse/dense lyrics, a sustain and a rest.' });
    if (contexts.length < 2) warnings.push({ code: 'limited-context', message: 'Only one declared musical context; inspect behavior across changes in density, duration and silence.' });
    if (input.source.kind === 'planned') warnings.push({ code: 'not-rendered', message: 'These are planned paths. Capture actual renderer behavior before visual acceptance.' });
    return { accepted: false, status: 'diagnostics-only', source: input.source, artifactVerified: false,
        metrics: { phrases: traces.length, contexts, similarPairRatio: Number(ratio.toFixed(3)), threshold: .025, similarPairs }, warnings,
        limitations: 'Supplied coordinates only; no media opened. Translation is removed, duration normalized; amplitude, direction and relative timing retained. Cannot judge text readability, occlusion, character binding, lighting, absolute speed or musical intent. No warning does not mean visual acceptance.',
        next: 'Watch continuous landscape and portrait previews; record timestamp, observation, evidence path and pass/revise/unobserved per criterion in folium-authoring://motion.' };
}
