import type { GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { buildLineGraphemeTimeline } from '../../../utils/lyrics/graphemeTiming';
import type { Line } from '../../../types';
import { ElegyGlyphCache, type ElegyGlyphAsset } from './elegyGlyphCache';
import type { WritingStroke } from './types';

// src/components/visualizer/elegy/elegyScene.ts
// Builds, lays out, and incrementally updates a prepared line without React participation.
type PixiModule = typeof import('pixi.js');

interface ElegyGlyphView {
    asset: ElegyGlyphAsset;
    timing: GraphemeTiming;
    sprite: import('pixi.js').Sprite | null;
    mask: import('pixi.js').Graphics | null;
    lastProgress: number;
}

export interface ElegyLineScene {
    line: Line;
    container: import('pixi.js').Container;
    glyphs: ElegyGlyphView[];
    totalAdvance: number;
    ascent: number;
    descent: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const resolveElegyWritingProgress = (
    lineStartTime: number,
    glyphEndTime: number,
    currentTime: number,
) => {
    const duration = glyphEndTime - lineStartTime;
    if (duration <= 0) return currentTime >= lineStartTime ? 1 : 0;
    return clamp01((currentTime - lineStartTime) / duration);
};

// Draws only the travelled portion of precomputed paths; tracing and sorting never enter the frame loop.
const drawWritingMask = (
    graphics: import('pixi.js').Graphics,
    rasterSize: number,
    strokes: WritingStroke[],
    totalLength: number,
    progress: number,
) => {
    graphics.clear();
    let remaining = totalLength * progress;
    for (const stroke of strokes) {
        if (remaining <= 0) break;
        const points = stroke.points;
        graphics.moveTo(points[0].x * rasterSize, points[0].y * rasterSize);
        const travelled = Math.min(remaining, stroke.length);
        for (let index = 1; index < points.length; index += 1) {
            const segmentEnd = stroke.cumulativeLengths[index];
            const segmentStart = stroke.cumulativeLengths[index - 1];
            if (travelled >= segmentEnd) {
                graphics.lineTo(points[index].x * rasterSize, points[index].y * rasterSize);
                continue;
            }
            const segmentLength = segmentEnd - segmentStart;
            const amount = segmentLength <= 0 ? 0 : clamp01((travelled - segmentStart) / segmentLength);
            const previous = points[index - 1];
            const next = points[index];
            graphics.lineTo(
                (previous.x + (next.x - previous.x) * amount) * rasterSize,
                (previous.y + (next.y - previous.y) * amount) * rasterSize,
            );
            break;
        }
        remaining -= stroke.length;
    }
    graphics.stroke({
        color: 0xffffff,
        width: Math.max(10, rasterSize * 0.14),
        cap: 'round',
        join: 'round',
    });
};

// Builds one immutable glyph layout; only masks and fallback alpha mutate during playback.
export const buildElegyLineScene = async (
    pixi: PixiModule,
    glyphCache: ElegyGlyphCache,
    textures: Map<string, import('pixi.js').Texture>,
    line: Line,
): Promise<ElegyLineScene> => {
    const timeline = buildLineGraphemeTimeline(line);
    const assets = await Promise.all(timeline.map(({ char }) => glyphCache.prepare(char)));
    const container = new pixi.Container();
    const glyphs: ElegyGlyphView[] = [];
    const totalAdvance = assets.reduce((total, asset) => total + asset.advance, 0);
    const ascent = assets.reduce((maximum, asset) => Math.max(maximum, asset.ascent), 1);
    const descent = assets.reduce((maximum, asset) => Math.max(maximum, asset.descent), 1);
    let cursor = -totalAdvance / 2;

    assets.forEach((asset, index) => {
        if (!asset.canvas) {
            cursor += asset.advance;
            return;
        }
        let texture = textures.get(asset.char);
        if (!texture) {
            texture = pixi.Texture.from(asset.canvas);
            textures.set(asset.char, texture);
        }
        const glyphContainer = new pixi.Container();
        glyphContainer.position.set(cursor - asset.left, -asset.ascent);
        const sprite = new pixi.Sprite(texture);
        glyphContainer.addChild(sprite);

        let mask: import('pixi.js').Graphics | null = null;
        if (asset.glyph && asset.glyph.totalLength > 0) {
            mask = new pixi.Graphics();
            glyphContainer.addChild(mask);
            sprite.mask = mask;
        } else {
            sprite.alpha = 0;
        }
        glyphs.push({ asset, timing: timeline[index], sprite, mask, lastProgress: -1 });
        container.addChild(glyphContainer);
        cursor += asset.advance;
    });

    return { line, container, glyphs, totalAdvance, ascent, descent };
};

export const layoutElegyLineScene = (
    scene: ElegyLineScene,
    width: number,
    height: number,
    rasterFontSize: number,
    lyricsFontScale: number,
) => {
    const designFontSize = Math.min(Math.max(width * 0.065, 48), 108) * lyricsFontScale;
    const scale = Math.max(0.05, Math.min(
        designFontSize / rasterFontSize,
        width * 0.84 / Math.max(scene.totalAdvance, 1),
        height * 0.38 / Math.max(scene.ascent + scene.descent, 1),
    ));
    scene.container.scale.set(scale);
    scene.container.position.set(width / 2, height * 0.46);
};

export const updateElegyLineScene = (scene: ElegyLineScene, currentTime: number) => {
    scene.glyphs.forEach(view => {
        const progress = resolveElegyWritingProgress(
            scene.line.startTime,
            view.timing.endTime,
            currentTime,
        );
        if (Math.abs(progress - view.lastProgress) < 0.001) return;
        view.lastProgress = progress;
        if (view.mask && view.asset.glyph) {
            drawWritingMask(
                view.mask,
                view.asset.rasterSize,
                view.asset.glyph.strokes,
                view.asset.glyph.totalLength,
                progress,
            );
        } else if (view.sprite) {
            view.sprite.alpha = progress;
        }
    });
};
