import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import type { PackFrame, PackLayer, StylePack } from './types';

// Deterministic Canvas 2D rendering: no wall clock, randomness, network or executable pack content.
const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
export function layerTransform(layer: PackLayer, frame: Pick<PackFrame, 'time' | 'audio' | 'reducedMotion'>) {
    const motion = layer.motion;
    if (!motion || frame.reducedMotion) return { y: 0, scale: 1, rotation: 0 };
    const signal = motion.signal === 'audio' ? clamp(frame.audio) : Math.sin(frame.time * Math.PI * 2 / motion.period);
    return {
        y: motion.kind === 'float' ? signal * motion.amount : 0,
        scale: motion.kind === 'pulse' ? 1 + signal * motion.amount / 100 : 1,
        rotation: motion.kind === 'rotate' ? signal * motion.amount * Math.PI / 180 : 0,
    };
}

export function resolvePackColor(value: string, frame: PackFrame): string {
    return value.startsWith('@') ? frame.theme[value.slice(1) as keyof PackFrame['theme']] : value;
}

export function resolvePackTypography(layer: PackLayer, frame: PackFrame) {
    const subtitle = layer.source === 'translation';
    return {
        family: subtitle ? frame.subtitleFontFamily : frame.fontFamily,
        weight: subtitle ? frame.subtitleFontWeight : frame.fontWeight,
        scale: subtitle ? frame.fontScale * frame.subtitleFontScale : layer.kind === 'lyrics' ? frame.fontScale : 1,
    };
}

// A cache belongs to one mounted renderer and is bounded across songs and window sizes.
export function createPackRenderer() {
    const layouts = new Map<string, { font: string; size: number; lines: { text: string }[] }>();
    function drawText(ctx: CanvasRenderingContext2D, layer: PackLayer, frame: PackFrame, width: number, height: number, unit: number) {
        if (layer.kind === 'lyrics' && !frame.showText) return;
        const source = layer.source ?? 'literal';
        const text = (source === 'literal' ? layer.text ?? '' : frame[source]).slice(0, 2000);
        if (!text) return;
        const typography = resolvePackTypography(layer, frame);
        const initialSize = (layer.fontSize ?? 4) * unit * typography.scale;
        const key = JSON.stringify([text, initialSize, width, height, typography.family, typography.weight]);
        let layout = layouts.get(key);
        if (!layout) {
            let size = initialSize;
            let font = `${typography.weight} ${size}px ${typography.family}`;
            let lines = layoutWithLines(prepareWithSegments(text, font), width, size * 1.25).lines;
            for (let attempt = 0; lines.length * size * 1.25 > height && attempt < 8; attempt++) {
                size *= 0.85;
                font = `${typography.weight} ${size}px ${typography.family}`;
                lines = layoutWithLines(prepareWithSegments(text, font), width, size * 1.25).lines;
            }
            layout = { font, size, lines };
            if (layouts.size >= 128) layouts.clear();
            layouts.set(key, layout);
        }
        ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
        ctx.font = layout.font;
        ctx.textAlign = layer.align ?? 'left'; ctx.textBaseline = 'middle';
        const x = layer.align === 'center' ? width / 2 : layer.align === 'right' ? width : 0;
        const top = (height - layout.lines.length * layout.size * 1.25) / 2;
        layout.lines.forEach((line, index) => ctx.fillText(line.text, x, top + (index + 0.5) * layout!.size * 1.25, width));
    }

    return (ctx: CanvasRenderingContext2D, pack: StylePack, frame: PackFrame, width: number, height: number) => {
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = resolvePackColor(pack.palette.background, frame); ctx.fillRect(0, 0, width, height);
        const layers = width < height ? pack.portraitLayers ?? pack.layers : pack.layers;
        const unit = Math.min(width, height) / 100;
        for (const layer of layers) {
            const w = layer.width * width / 100, h = layer.height * height / 100;
            const transform = layerTransform(layer, frame);
            ctx.save();
            try {
                ctx.translate(layer.x * width / 100 + w / 2, layer.y * height / 100 + h / 2 + transform.y * unit);
                ctx.rotate(transform.rotation); ctx.scale(transform.scale, transform.scale); ctx.translate(-w / 2, -h / 2);
                ctx.globalAlpha = layer.opacity ?? 1;
                const color = layer.color.startsWith('@') ? pack.palette[layer.color.slice(1) as keyof StylePack['palette']] : layer.color;
                ctx.fillStyle = resolvePackColor(color, frame);
                if (layer.kind === 'text' || layer.kind === 'lyrics') drawText(ctx, layer, frame, w, h, unit);
                else if (layer.kind === 'ellipse') { ctx.beginPath(); ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); }
                else if (layer.kind === 'progress') {
                    ctx.globalAlpha *= 0.2; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = layer.opacity ?? 1;
                    ctx.fillRect(0, 0, w * clamp(frame.duration > 0 ? frame.time / frame.duration : 0), h);
                } else if (layer.kind === 'spectrum') {
                    for (let i = 0; i < 32; i++) {
                        const magnitude = frame.reducedMotion ? 0.08 : clamp(frame.spectrum[i] ?? frame.audio);
                        ctx.fillRect(i * w / 32, h * (1 - magnitude), w / 48, h * magnitude);
                    }
                } else {
                    ctx.beginPath(); ctx.roundRect(0, 0, w, h, Math.min(w / 2, h / 2, (layer.radius ?? 0) * unit));
                    ctx.fill();
                    if (layer.kind === 'cover' && frame.cover) {
                        ctx.clip();
                        const image = frame.cover as HTMLImageElement;
                        const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
                        if (iw > 0 && ih > 0) {
                            const scale = Math.max(w / iw, h / ih);
                            ctx.drawImage(frame.cover, (w - iw * scale) / 2, (h - ih * scale) / 2, iw * scale, ih * scale);
                        }
                    }
                }
            } finally { ctx.restore(); }
        }
    };
}
