import { createPuppet } from './puppet.js';
import { createScenery } from './scenery.js';
import { createLyrics } from './lyrics.js';
import { compileNotes, hummingAt, clamp } from './timeline.js';
import { compile } from '../lyricImprint/timeline.mjs';
import { emitterAt } from './coordinates.mjs';

// API 2 entry: all animation follows the host song clock, including pause and arbitrary seeks.
FoliaStyle.define(async context => {
    const ctx = context.canvas.getContext('2d');
    if (!ctx) throw new Error('Nightingale requires Canvas 2D');
    const images = {};
    try {
        for (const [name, uri] of Object.entries(context.assets)) {
            const [prefix, encoded] = uri.split(',');
            const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
            images[name] = await createImageBitmap(new Blob([bytes], { type: prefix.slice(5).split(';')[0] }));
        }
    } catch (error) { Object.values(images).forEach(image => image.close()); throw error; }
    const puppet = createPuppet(images.girl), scenery = createScenery(images, puppet);
    let lyrics = createLyrics(ctx, context.settings), scene = { title: '', artist: '', lines: [] }, notes = [], program = compile(scene);
    return {
        update(next) {
            scene = next; notes = compileNotes(next.lines);
            program = compile(next, { artStyle: 'atmospheric-light', ...context.settings });
            lyrics = createLyrics(ctx, context.settings);
        },
        render(frame) {
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
            const motion = frame.reducedMotion ? 0 : clamp(Number(context.settings.motion ?? 1), 0, 1.5);
            const energy = frame.reducedMotion ? 0 : hummingAt(notes, frame.time);
            scenery(ctx, frame, energy, motion);
            lyrics(frame, program, { key: motion, at: time => emitterAt(frame, time, hummingAt(notes, time), motion) });
            if (context.settings.showTitle !== false) {
                const size = Math.min(frame.width, frame.height) * .019;
                ctx.save(); ctx.font = `${frame.subtitleFontWeight} ${size}px ${frame.subtitleFontFamily}`;
                ctx.fillStyle = '#d8e2df'; ctx.globalAlpha = .5; ctx.textAlign = 'left';
                ctx.fillText(scene.title, frame.width * .055, frame.height * .07, frame.width * .65);
                ctx.restore();
            }
        },
        dispose() { puppet.dispose(); Object.values(images).forEach(image => image.close()); },
    };
});
