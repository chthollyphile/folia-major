import type { Container, Sprite, Texture } from 'pixi.js';
import type { MonetVisibleLineEntry } from '../../../visualizer/monet/monetLyricsModel';
import { resolveMonetSweepEdgeSoftness, resolveMonetSweepEnd } from '../../../visualizer/monet/monetLyricsModel';
import { resolveMonetFillWidth, resolveMonetGlow, clampMonetProgress } from '../../../visualizer/monet/monetLyricMotion';
import { buildWordColorRangesFromMatchers, prepareWordColorMatchers, resolveTokenColorMap } from '../../../visualizer/wordColoring';
import { colorWithAlpha, mixColors } from '../../../visualizer/colorMix';
import { getLineRenderEndTime } from '../../../../utils/lyrics/renderHints';
import type { LatticeLyricInput } from './types';
import type { LatticeLineLayout, LatticeTypography, LyricPiece } from './latticeLyricLayout';
import type { LatticeRaster } from './latticeLyricRaster';
import { createLatticeSweepFilter, type LatticeSweep } from './latticeLyricFilters';

// src/components/app/lattice/lyrics/latticeLyricScene.ts
type Pixi = typeof import('pixi.js');
interface PieceView { sprite: Sprite; glow: Sprite[]; texture: Texture; sweep: LatticeSweep;
    pad: number; width: number; height: number; piece: LyricPiece; color: string; base: number[]; }

/** Builds only the rows near the card viewport; a long lyric never allocates a song-sized texture. */
export function createLatticeLineView(pixi: Pixi, raster: LatticeRaster, parent: Container,
    entry: MonetVisibleLineEntry, layout: LatticeLineLayout, type: LatticeTypography, input: LatticeLyricInput) {
    const container = new pixi.Container(); parent.addChild(container);
    const near = new pixi.Container(), far = new pixi.Container(), text = new pixi.Container();
    container.addChild(far, near, text);
    const chorus = Boolean(entry.line.isChorus);
    const radii = [Math.round(type.fontPx * (chorus ? 0.45 : 0.28)), Math.round(type.fontPx * (chorus ? 0.9 : 0.65))];
    const glowFilters = radii.map(strength => new pixi.BlurFilter({ strength, quality: 3, resolution: 1 }));
    near.filters = [glowFilters[0]]; far.filters = [glowFilters[1]];
    const blur = new pixi.BlurFilter({ strength: 0, quality: 2 }); container.filters = [blur];
    const pieces = new Map<number, PieceView>();
    const matchers = prepareWordColorMatchers(input.theme.wordColors, input.keywordColoringEnabled);
    const colors = resolveTokenColorMap(layout.pieces.map(p => p.token), buildWordColorRangesFromMatchers(entry.line.fullText, matchers));
    const accent = chorus ? mixColors(input.theme.primaryColor, input.theme.accentColor, 0.48) : colorWithAlpha(input.theme.primaryColor, 0.98);
    const destroyPiece = (view: PieceView) => {
        view.sweep.filter.destroy(); view.sprite.destroy(); view.glow.forEach(sprite => sprite.destroy()); view.texture.destroy(true);
    };
    const createPiece = (piece: LyricPiece): PieceView => {
        const px = piece.translation ? type.translationPx : type.fontPx;
        const image = raster.rasterize(piece.text, piece.translation ? type.translationFont : type.font, px);
        const color = piece.translation ? (input.subtitleTheme ?? input.theme).primaryColor : colors.get(piece.token.key) ?? accent;
        const base = new pixi.Color(input.theme.primaryColor).toArray();
        const sweep = createLatticeSweepFilter(pixi, base, new pixi.Color(color).toArray());
        sweep.uniforms.uGlyphRange = [(image.pad - piece.tokenOffset) / image.width, (piece.offsets.at(-1) ?? piece.width) / image.width];
        const sprite = new pixi.Sprite(image.texture); sprite.filters = [sweep.filter];
        sprite.position.set(piece.x - image.pad, piece.y - image.pad); text.addChild(sprite);
        const glow = [near, far].map(layer => {
            const clone = new pixi.Sprite(image.texture); clone.position.copyFrom(sprite.position); layer.addChild(clone); return clone;
        });
        return { ...image, sprite, glow, sweep, piece, color, base };
    };
    const update = (time: number, status: MonetVisibleLineEntry['status'], baseAlpha: number, viewportHeight: number,
        top: number, scale: number, quiet: boolean) => {
        const maxText = status === 'active' ? Infinity : type.lineHeight * 2;
        let glowing = false;
        for (let i = 0; i < layout.pieces.length; i++) {
            const piece = layout.pieces[i];
            const y = piece.translation && status !== 'active' ? Math.min(layout.textHeight, maxText) + type.fontPx * 0.3 + piece.row * type.translationLineHeight : piece.y;
            const visible = (piece.translation ? status === 'active' : piece.y < maxText) && (top + y * scale > -type.lineHeight * 2)
                && (top + y * scale < viewportHeight + type.lineHeight * 2);
            const old = pieces.get(i);
            if (!visible) { if (old) { destroyPiece(old); pieces.delete(i); } continue; }
            const view = old ?? createPiece(piece); pieces.set(i, view);
            view.sprite.y = y - view.pad; view.glow.forEach(sprite => { sprite.y = view.sprite.y; });
            const token = piece.token, start = token.startTime ?? Infinity, end = token.endTime ?? Infinity;
            const passed = token.timed && (status === 'passed' || (status === 'active' && time > end));
            const progress = status === 'active' && token.timed ? clampMonetProgress((time - start) / Math.max(0.001, end - start)) : 0;
            const width = status === 'active' ? resolveMonetFillWidth(time, start, end, piece.offsets, token.graphemeTimings) : 0;
            const softness = resolveMonetSweepEdgeSoftness(type.fontPx);
            const front = resolveMonetSweepEnd(width, piece.offsets.at(-1) ?? 0, softness);
            const uniforms = view.sweep.uniforms;
            if (piece.translation) {
                uniforms.uBase = uniforms.uWord;
                uniforms.uBase[3] = 0.68;
            } else { view.base[3] = baseAlpha; uniforms.uBase = view.base; }
            uniforms.uProgress = progress; uniforms.uPassed = passed ? 1 : 0;
            uniforms.uFront = (front - piece.tokenOffset + view.pad) / view.width;
            uniforms.uSoftness = softness / view.width;
            const clipped = status !== 'active' && piece.row === 1 && layout.rows > 2;
            uniforms.uVerticalFade[0] = clipped ? (view.pad + type.lineHeight * 0.55) / view.height : 2;
            uniforms.uVerticalFade[1] = clipped ? (view.pad + type.lineHeight) / view.height : 3;
            const glow = !quiet && !piece.translation && token.timed && status !== 'waiting'
                ? resolveMonetGlow(time, start, end, getLineRenderEndTime(entry.line)) : 0;
            glowing ||= glow > 0;
            const word = uniforms.uWord;
            const r = Math.round((view.base[0] + (word[0] - view.base[0]) * glow) * 255);
            const g = Math.round((view.base[1] + (word[1] - view.base[1]) * glow) * 255);
            const b = Math.round((view.base[2] + (word[2] - view.base[2]) * glow) * 255);
            for (const sprite of view.glow) {
                sprite.alpha = glow * (chorus ? 1 : 0.88);
                sprite.tint = (r << 16) | (g << 8) | b;
            }
        }
        near.renderable = far.renderable = glowing;
    };
    return { container, blur, layout, entry, update,
        destroy() { pieces.forEach(destroyPiece); pieces.clear(); blur.destroy(); glowFilters.forEach(f => f.destroy()); container.destroy({ children: true }); },
    };
}
export type LatticeLineView = ReturnType<typeof createLatticeLineView>;
