import type { TemperaGlyphPlacement } from './temperaLayout';
import type { TemperaPalette } from './temperaPalette';
import type { TemperaDecorFragment, TemperaDecorWatermark } from './types';
import type { TemperaGlyphMotionInput } from './temperaMotion';

// src/components/visualizer/tempera/temperaTextView.ts
// Builds one Pixi Text node per grapheme plus an offset ghost copy for print misregistration.
//
// The ghost lives *inside* the inverted layer, not below it. Below it, the ghost becomes part
// of the backdrop the filter samples: each glyph then flips colour against its own shadow and
// breaks into hard patches along its strokes. Inside the layer the filter colours ghost and
// glyph alike, so the offset copy reads as a second printing plate instead of corrupting the
// decision. Nothing is ever painted behind a glyph to emphasise it either - the inversion
// against the artwork is the emphasis.
type PixiModule = typeof import('pixi.js');

export interface TemperaGlyphView {
    display: import('pixi.js').Text;
    shadow: import('pixi.js').Text | null;
    /** Motion echoes trailing back along the entrance vector; empty when echoes are off. */
    echoes: import('pixi.js').Text[];
    /** Everything the per-frame motion solver needs; the runtime never reads layout again. */
    motion: TemperaGlyphMotionInput;
    baseX: number;
    baseY: number;
    shadowDX: number;
    shadowDY: number;
    /**
     * 字号即远近: 1 for the shot's biggest glyphs (nearest), down to 0 for ones well under half
     * their size (furthest). The frame lightens far glyphs and moves them with the camera less.
     */
    depth: number;
}

interface TemperaTextViewOptions {
    placements: TemperaGlyphPlacement[];
    palette: TemperaPalette;
    fontFamily: string;
    fontWeight: number;
    shadowEnabled: boolean;
    echoCount: number;
    textLayer: import('pixi.js').Container;
    /**
     * Rendered above the inverted layer and unfiltered. Echoes live here so a trail never
     * becomes backdrop the filter has to resolve against mid-entrance.
     */
    echoLayer: import('pixi.js').Container;
    /**
     * Rendered above the inverted layer and never filtered. Keyword glyphs live here so the
     * theme's `wordColors` hue survives; inverting them would throw the colour away.
     */
    keywordLayer: import('pixi.js').Container;
}

const SHADOW_OFFSET_X = 0.06;
const SHADOW_OFFSET_Y = 0.08;
/** The ghost is tinted by the filter, so only its opacity is its own. */
const SHADOW_ALPHA = 0.34;
/** Glyph size, as a share of the shot's biggest, that sits furthest back; 1 sits in front. */
const DEPTH_FAR_SIZE = 0.4;
export const buildTemperaTextViews = (
    pixi: PixiModule,
    options: TemperaTextViewOptions,
): TemperaGlyphView[] => {
    const { Text, TextStyle } = pixi;
    const { palette, fontFamily, fontWeight } = options;
    const views: TemperaGlyphView[] = [];
    const weightToken = String(fontWeight) as import('pixi.js').TextStyleFontWeight;

    options.placements.forEach(placement => {
        if (placement.char.trim().length === 0) return;
        const baseStyle = {
            fontFamily,
            fontWeight: weightToken,
            fontSize: placement.fontSize,
        };
        const display = new Text({
            text: placement.char,
            style: new TextStyle({ ...baseStyle, fill: placement.color ?? palette.ink }),
        });
        display.anchor.set(0.5);
        display.position.set(placement.x, placement.y);
        display.rotation = placement.rotation;

        // Unblurred offset copy at partial alpha; the filter tints it with the glyph, so it
        // reads as an off-register second printing plate.
        let shadow: import('pixi.js').Text | null = null;
        if (options.shadowEnabled) {
            shadow = new Text({
                text: placement.char,
                style: new TextStyle({ ...baseStyle, fill: palette.ink }),
            });
            shadow.anchor.set(0.5);
            shadow.rotation = placement.rotation;
            options.textLayer.addChildAt(shadow, 0);
        }

        // Motion echoes: dimmed copies parked further back along the entrance vector. The
        // runtime scales their offset per index, so they read as a trail rather than a blur.
        const echoes: import('pixi.js').Text[] = [];
        for (let index = 0; index < options.echoCount; index += 1) {
            const echo = new Text({
                text: placement.char,
                style: new TextStyle({ ...baseStyle, fill: placement.color ?? palette.tone4 }),
            });
            echo.anchor.set(0.5);
            echo.rotation = placement.rotation;
            echo.visible = false;
            options.echoLayer.addChild(echo);
            echoes.push(echo);
        }

        (placement.color ? options.keywordLayer : options.textLayer).addChild(display);
        views.push({
            display,
            shadow,
            echoes,
            motion: {
                startTime: placement.startTime,
                settleTime: placement.settleTime,
                endTime: placement.endTime,
                enterX: placement.enterX,
                enterY: placement.enterY,
                enterRotation: placement.enterRotation,
                enterScale: placement.enterScale,
                rotation: placement.rotation,
                enterStyle: placement.enterStyle,
                releaseTime: placement.releaseTime,
                trackingX: placement.trackingX,
                trackingY: placement.trackingY,
            },
            baseX: placement.x,
            baseY: placement.y,
            shadowDX: placement.fontSize * SHADOW_OFFSET_X,
            shadowDY: placement.fontSize * SHADOW_OFFSET_Y,
            depth: placement.fontSize,
        });
    });

    // Sizes become depths once the shot's biggest glyph is known.
    const biggest = Math.max(0, ...views.map(view => view.depth));
    views.forEach(view => {
        view.depth = biggest > 0
            ? Math.min(1, Math.max(0, (view.depth / biggest - DEPTH_FAR_SIZE) / (1 - DEPTH_FAR_SIZE)))
            : 1;
    });

    return views;
};

interface TemperaFragmentViewOptions {
    fragments: TemperaDecorFragment[];
    palette: TemperaPalette;
    fontFamily: string;
    fontWeight: number;
    baseFontSize: number;
    width: number;
    height: number;
    layer: import('pixi.js').Container;
}

// Stray glyphs parked in the margins of sparse compositions. They carry no timeline: the
// shot's own enter/exit alpha covers them, so playback never touches these nodes.
export const buildTemperaFragmentViews = (
    pixi: PixiModule,
    options: TemperaFragmentViewOptions,
) => {
    const { Text, TextStyle } = pixi;
    options.fragments.forEach(fragment => {
        const node = new Text({
            text: fragment.char,
            style: new TextStyle({
                fontFamily: options.fontFamily,
                fontWeight: String(options.fontWeight) as import('pixi.js').TextStyleFontWeight,
                fontSize: Math.max(12, options.baseFontSize * fragment.scale),
                fill: options.palette.ink,
            }),
        });
        node.anchor.set(0.5);
        node.position.set(fragment.x * options.width, fragment.y * options.height);
        node.rotation = fragment.rotation;
        node.alpha = 0.42;
        options.layer.addChild(node);
    });
};

interface TemperaWatermarkOptions {
    watermark: TemperaDecorWatermark;
    palette: TemperaPalette;
    fontFamily: string;
    fontWeight: number;
    baseFontSize: number;
    width: number;
    height: number;
    layer: import('pixi.js').Container;
}

/**
 * Oversized decorative word behind the composition. It is deliberately placed *below* the
 * inverted text layer, so the lyric flips colour where it crosses the watermark's strokes -
 * the decoration becomes part of the artwork the type reacts to, not a second lyric.
 */
export const buildTemperaWatermark = (
    pixi: PixiModule,
    options: TemperaWatermarkOptions,
) => {
    const { watermark } = options;
    if (!watermark.text.trim()) return;
    const node = new pixi.Text({
        text: watermark.text,
        style: new pixi.TextStyle({
            fontFamily: options.fontFamily,
            fontWeight: String(options.fontWeight) as import('pixi.js').TextStyleFontWeight,
            fontSize: Math.max(48, options.baseFontSize * watermark.scale),
            fill: options.palette.tone4,
        }),
    });
    node.anchor.set(0.5);
    node.position.set(watermark.x * options.width, watermark.y * options.height);
    node.rotation = watermark.rotation;
    node.alpha = 0.16;
    options.layer.addChild(node);
};
