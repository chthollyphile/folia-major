import { compile, clamp } from './phrases.mjs';
import { buildFlight, flightAt } from './flight.mjs';
import { createRelease } from './release.mjs';

// Local Cat and Bee test pack: source artwork, new deterministic lyric-driven animation.
FoliaStyle.define(async context => {
    const ctx = context.canvas.getContext('2d');
    if (!ctx) throw new Error('Cat and Bee needs Canvas 2D');
    const images = {};
    try {
        for (const [name, uri] of Object.entries(context.assets)) {
            const [prefix, data] = uri.split(',');
            const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
            images[name] = await createImageBitmap(new Blob([bytes], { type: prefix.slice(5).split(';')[0] }));
        }
    } catch (error) { Object.values(images).forEach(image => image.close()); throw error; }
    let program = compile({ lines: [], duration: 1 }), typeset = createRelease(ctx), scene = { title: '' }, flight = null, aspect = 0;
    return {
        update(next) { scene = next; program = compile(next, context.settings); typeset = createRelease(ctx); flight = null; },
        render(f) {
            const w = f.width, h = f.height, s = Math.min(w, h), t = f.reducedMotion ? 0 : f.time;
            if (!flight || aspect !== w / h) { aspect = w / h; flight = buildFlight(program, aspect); }
            const bee = flightAt(flight, f.time, f.reducedMotion);
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
            ctx.fillStyle = '#08090b'; ctx.fillRect(0, 0, w, h);
            const cw = Math.min(w * .46, h * .44), ch = cw * 463 / 685, floor = h * .70;
            const dip = f.reducedMotion ? 0 : .1 * clamp((bee.y - .25) / .29);
            const cx = w * .5 + (bee.x - .5) * cw * .07, cy = floor - ch * (.83 - dip);
            ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, floor); ctx.clip();
            ctx.drawImage(images.cat, cx - cw / 2, cy, cw, ch);
            const blinkPhase = ((t + .7) % 4.9), blink = f.reducedMotion ? 1 : blinkPhase < .17 ? .08 + .92 * Math.abs(blinkPhase / .085 - 1) : 1;
            for (const direction of [-1, 1]) {
                const ex = cx + direction * cw * .14, ey = cy + ch * .59, radius = cw * .104;
                ctx.save(); ctx.translate(ex, ey); ctx.scale(1, blink);
                ctx.fillStyle = '#f4f4ef'; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill();
                const dx = bee.x * w - ex, dy = bee.y * h - ey, length = Math.hypot(dx, dy) || 1;
                ctx.fillStyle = '#08090b'; ctx.beginPath(); ctx.arc(dx / length * radius * .46, dy / length * radius * .46, radius * .26, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
            ctx.restore();
            ctx.strokeStyle = '#f4f4ef'; ctx.lineWidth = Math.max(1, s * .0021);
            ctx.beginPath(); ctx.moveTo(w * .07, floor); ctx.lineTo(w * .93, floor); ctx.stroke();
            if (!f.reducedMotion) {
                for (let i = 8; i >= 1; i--) {
                    const past = flightAt(flight, Math.max(0, f.time - i * .055));
                    const speed = Math.hypot(past.x - bee.x, past.y - bee.y);
                    ctx.globalAlpha = (1 - i / 9) * .38 * clamp(speed * 70);
                    ctx.fillStyle = '#f4f4ef'; ctx.beginPath(); ctx.arc(past.x * w, past.y * h, s * .0016, 0, Math.PI * 2); ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
            const angle = Math.atan2(bee.vy * h, bee.vx * w);
            const bs = s * .035;
            ctx.save(); ctx.translate(bee.x * w, bee.y * h); ctx.rotate(f.reducedMotion ? 0 : Math.sin(angle) * .3);
            ctx.scale(1, 1 + Math.sin(t * 37) * .045);
            ctx.drawImage(images.bee, 50, 50, 59, 42, -bs / 2, -bs * 42 / 118, bs, bs * 42 / 59); ctx.restore();
            typeset(f, program, flight);
            if (f.showText) {
                ctx.font = `${f.subtitleFontWeight} ${Math.max(10 * f.dpr, s * .017)}px ${f.subtitleFontFamily}`;
                ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.globalAlpha = .38; ctx.fillStyle = '#f4f4ef';
                ctx.fillText(scene.title, w * .07, h * .085, w * .7);
            }
            ctx.globalAlpha = 1;
        },
        dispose() { Object.values(images).forEach(image => image.close()); },
    };
});
