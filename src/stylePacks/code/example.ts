import type { CodeContext, CodeRenderer, CodeStylePack, CodeScene } from './contract';

// An actual standalone renderer, not a host template: authors may replace this entire program.
function prismRenderer(context: CodeContext): CodeRenderer {
    const { canvas, settings } = context;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    let scene: CodeScene = { title: '', artist: '', album: '', duration: 0, lines: [] };
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const ease = (v: number) => 1 - Math.pow(1 - clamp(v), 3);
    const ink = '#13151b', paper = '#eee9dd', acid = String(settings.accent || '#d8f16f');
    let cacheKey = '', layout: { char: string; x: number; y: number; start: number; end: number }[] = [], size = 0;
    return {
        update(next) { scene = next; cacheKey = ''; },
        render(f) {
            const w = f.width, h = f.height, s = Math.min(w, h), portrait = h > w;
            const selected = scene.lines[f.index];
            const index = Math.max(0, f.index), kind = index % 3;
            const local = f.time - (selected?.start ?? 0), span = Math.max(.1, (selected?.end ?? 6) - (selected?.start ?? 0));
            const motion = f.reducedMotion ? 0 : Number(settings.motion ?? 1);
            const progress = clamp(local / span), arrive = f.reducedMotion ? 1 : ease((local + .12) / .65);
            const t = f.reducedMotion ? 0 : f.time, inverted = kind === 1;
            const bg = inverted ? acid : ink, fg = inverted ? ink : paper, highlight = inverted ? '#3e5049' : acid;
            ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
            ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
            // A persistent architectural grid makes the shot changes read as one visual world.
            ctx.strokeStyle = fg; ctx.lineWidth = Math.max(1, s / 800); ctx.globalAlpha = .12;
            for (let i = 1; i < 8; i++) { ctx.beginPath(); ctx.moveTo(w * i / 8, 0); ctx.lineTo(w * i / 8, h); ctx.stroke(); }
            for (let i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(0, h * i / 5); ctx.lineTo(w, h * i / 5); ctx.stroke(); }
            ctx.save(); ctx.translate(w * (kind === 2 ? .5 : .78), h * .47);
            ctx.rotate((kind === 1 ? -.35 : .3) + Math.sin(t * .16) * .08 * motion);
            const radial = s * (.38 + .02 * f.audio * motion);
            if (kind === 0) {
                ctx.fillStyle = acid; ctx.globalAlpha = .92;
                ctx.beginPath(); ctx.ellipse(0, 0, radial * .62, radial * 1.6, 0, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = ink; ctx.beginPath(); ctx.ellipse(0, 0, radial * .43, radial * 1.2, 0, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = acid; ctx.globalAlpha = .35;
                for (let i = 0; i < 8; i++) { ctx.beginPath(); ctx.ellipse(0, 0, radial * (.68 + i * .08), radial * (1.65 + i * .1), 0, 0, Math.PI * 2); ctx.stroke(); }
            } else if (kind === 1) {
                ctx.globalAlpha = .12; ctx.fillStyle = ink;
                for (let i = -5; i < 6; i++) ctx.fillRect(i * s * .16 + progress * s * .08 * motion, -h, s * .08, h * 2);
            } else {
                ctx.globalAlpha = .6; ctx.strokeStyle = acid;
                for (let i = 0; i < 6; i++) {
                    ctx.rotate(.26); ctx.beginPath(); ctx.ellipse(0, 0, radial * 1.4, radial * (.35 + i * .025), 0, 0, Math.PI * 2); ctx.stroke();
                }
                for (let i = 0; i < 24; i++) {
                    const a = i * Math.PI / 12 + t * .1 * motion;
                    ctx.fillStyle = i % 3 ? acid : '#ff846c'; ctx.fillRect(Math.cos(a) * radial * 1.25, Math.sin(a) * radial * 1.25, s * .006, s * .006);
                }
            }
            ctx.restore(); ctx.globalAlpha = 1;
            // Oversized type is part of the composition, not a fixed player card.
            ctx.font = `900 ${s * .55}px ${f.fontFamily}`; ctx.fillStyle = fg; ctx.globalAlpha = .06;
            ctx.textAlign = 'left'; ctx.fillText(String(index + 1).padStart(2, '0'), w * .025, h * .82);
            ctx.globalAlpha = 1;
            const glyphs = selected?.glyphs.length ? selected.glyphs : Array.from(scene.title || 'PRISM').map(text => ({ text, start: 0, end: 0 }));
            const key = [index, w, h, f.fontFamily, f.fontWeight, f.fontScale, f.showText, glyphs.map(g => g.text).join('')].join('|');
            if (cacheKey !== key) {
                cacheKey = key;
                const maxWidth = w * (portrait ? .78 : .78), maxHeight = h * .48;
                size = s * (portrait ? .145 : .15) * f.fontScale;
                for (let attempt = 0; attempt < 16; attempt++) {
                    ctx.font = `${f.fontWeight} ${size}px ${f.fontFamily}`;
                    const rows: typeof layout[] = [[]]; let x = 0;
                    for (const glyph of glyphs.slice(0, 500)) {
                        const advance = ctx.measureText(glyph.text).width + size * .015;
                        if ((x + advance > maxWidth && x > 0) || glyph.text === '\n') { rows.push([]); x = 0; }
                        rows[rows.length - 1].push({ char: glyph.text, x, y: 0, start: glyph.start, end: glyph.end }); x += advance;
                    }
                    if (rows.length * size * 1.18 <= maxHeight || attempt === 15) {
                        layout = rows.flatMap((row, ri) => {
                            const end = row.at(-1); const rowWidth = end ? end.x + ctx.measureText(end.char).width : 0;
                            return row.map(g => ({ ...g, x: g.x - rowWidth / 2, y: (ri - (rows.length - 1) / 2) * size * 1.18 }));
                        }); break;
                    }
                    size *= .86;
                }
            }
            if (f.showText) {
                ctx.save(); ctx.translate(w * .5, h * .47);
                ctx.rotate((kind === 0 ? -.055 : kind === 2 ? .045 : 0) * motion);
                ctx.translate(0, (1 - arrive) * s * .08 * motion);
                ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = `${f.fontWeight} ${size}px ${f.fontFamily}`;
                for (let i = 0; i < layout.length; i++) {
                    const g = layout[i], sung = f.time >= g.start, active = sung && f.time < g.end;
                    const pop = motion * (active ? Math.sin(clamp((f.time - g.start) / Math.max(.1, g.end - g.start)) * Math.PI) : 0);
                    const enter = f.reducedMotion ? 1 : ease((local + .22 - i * .012) / .55);
                    ctx.save(); ctx.translate(g.x, g.y + (1 - enter) * size * .7 * motion - pop * size * .06);
                    ctx.globalAlpha = selected ? .38 + .62 * enter : 1;
                    // Solid backing keeps singing text legible over the moving geometric field.
                    ctx.strokeStyle = bg; ctx.lineWidth = size * .09; ctx.lineJoin = 'round'; ctx.strokeText(g.char, 0, 0);
                    ctx.fillStyle = active ? highlight : sung ? fg : inverted ? '#526735' : '#89918b';
                    ctx.fillText(g.char, 0, 0); ctx.restore();
                }
                ctx.restore();
            }
            ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.globalAlpha = .85;
            ctx.font = `500 ${s * .014}px ${f.fontFamily}`; ctx.fillStyle = fg;
            ctx.fillText('FOLIA / PRISM', w * .045, h * .075);
            ctx.textAlign = 'right'; ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${String(Math.max(1, scene.lines.length)).padStart(2, '0')}`, w * .955, h * .075);
            ctx.textAlign = 'center';
            ctx.font = `${f.subtitleFontWeight} ${Math.min(s * .026 * f.fontScale * f.subtitleFontScale, w * .04)}px ${f.subtitleFontFamily}`;
            let subtitle = f.showText ? f.translation : '';
            while (subtitle.length > 1 && ctx.measureText(subtitle).width > w * .84) subtitle = subtitle.slice(0, -2);
            ctx.fillText(subtitle, w * .5, h * .8);
            ctx.font = `500 ${s * .017}px ${f.fontFamily}`;
            ctx.fillText(`${scene.title}  /  ${scene.artist}`.slice(0, 100), w * .5, h * .9, w * .84);
            ctx.globalAlpha = .22; ctx.fillRect(w * .045, h * .95, w * .91, Math.max(1, s * .002));
            ctx.globalAlpha = 1; ctx.fillStyle = highlight; ctx.fillRect(w * .045, h * .95, w * .91 * clamp(f.time / Math.max(1, f.duration)), Math.max(2, s * .003));
            if (context.cover) ctx.drawImage(context.cover, w * .045, h * .83, s * .065, s * .065);
        },
        dispose() { layout = []; },
    };
}

export const RENDERER_PACK: CodeStylePack = {
    format: 'folia-style', schemaVersion: 2, id: 'folia.prism', name: 'PRISM — Lyric Atlas', version: '1.0.0', author: 'Folia',
    description: 'A kinetic lyric stage: three shot compositions, timed glyphs, orbital geometry and deterministic camera motion.',
    palette: { background: '#13151b', primary: '#eee9dd', secondary: '#89918b', accent: '#d8f16f' },
    settings: { accent: '#d8f16f', motion: 1 },
    renderer: { apiVersion: 2, code: `FoliaStyle.define(${prismRenderer.toString()});` },
};
