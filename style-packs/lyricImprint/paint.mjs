import { activePhrases, phraseOpacity } from './timeline.mjs';
import { createLayout } from './subtitle.mjs';

// Paint the shared stationary imprints; palette and small musical accents belong to each artwork.
export function createPaint(ctx, planner, palette = {}) {
    const layout = createLayout(ctx);
    return (frame, program, source) => {
        if (!frame.showText) return;
        const plan = planner(frame, program, source);
        palette.underlay?.(ctx, frame, plan, source);
        for (const item of plan.items) {
            ctx.save(); ctx.translate(item.x, item.y); ctx.scale(item.scale, item.scale);
            ctx.font = item.font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = item.rtl ? 'rtl' : 'ltr';
            ctx.globalAlpha = item.alpha; ctx.fillStyle = palette.text || '#f5f3e9';
            ctx.shadowColor = palette.shadow || 'transparent'; ctx.shadowBlur = palette.shadow ? item.size * .15 : 0;
            if (item.reveal < 1) { ctx.beginPath(); ctx.rect(-item.halfWidth - 1, -item.halfHeight, (item.halfWidth * 2 + 2) * item.reveal, item.halfHeight * 2); ctx.clip(); }
            ctx.fillText(item.text, 0, 0); ctx.restore();
        }
        if (palette.musical && !frame.reducedMotion) {
            for (const phrase of activePhrases(program, frame.time)) {
                const age = frame.time - phrase.releaseStart, alpha = phraseOpacity(phrase, frame.time);
                if (age < 0 || age > 1.25) continue;
                const point = source.at(phrase.releaseStart, phrase);
                ctx.save(); ctx.font = `${frame.fontWeight} ${Math.min(frame.width, frame.height) * .018}px ${frame.fontFamily}`;
                ctx.textAlign = 'center'; ctx.fillStyle = palette.accent || '#e5c992'; ctx.globalAlpha = alpha * Math.sin(Math.PI * age / 1.25) * .55;
                ctx.fillText('♪', point.x - age * 14, point.y - age * 16); ctx.restore();
            }
        }
        const candidates = activePhrases(program, frame.time), primary = candidates.at(-1);
        if (primary && frame.time >= primary.releaseStart && palette.translation !== false) {
            const measured = layout(frame, primary, candidates.length);
            ctx.save(); ctx.font = measured.subFont; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = palette.subtitle || '#aaa9a2'; ctx.globalAlpha = phraseOpacity(primary, frame.time) * .65;
            measured.subRows.slice(0, 3).forEach((text, row) => ctx.fillText(text, frame.width * .5, frame.height * (palette.subtitleY || .81) + row * measured.subtitleSize * 1.4, frame.width * .82));
            ctx.restore();
        }
    };
}
