import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import 'pixi.js/advanced-blend-modes';
import type { Theme } from '../../../types';
import { buildSonnetGlyphLayout } from './sonnetGlyphLayout';
import { createSonnetGuide, type SonnetGuideView } from './sonnetGuides';
import type { SonnetSemanticSegment } from './types';
import type {
    SonnetSegmentRole,
    SonnetTypographyPlacement,
} from './sonnetTypographyLayout';

// src/components/visualizer/sonnet/sonnetTextViewBuilder.ts
// Creates parser-timed core/halo glyph pairs and their semantic guide view.
type PixiModule = typeof import('pixi.js');

export interface GlyphView {
    display: import('pixi.js').Text;
    halo: import('pixi.js').Text | null;
    caCyan?: import('pixi.js').Text;
    caRed?: import('pixi.js').Text;
    caOffset?: number;
    baseX: number;
    baseY: number;
    enterX: number;
    enterY: number;
    entryRotation: number;
    finalRotation: number;
    startTime: number;
    settleTime: number;
    zDepth: number;
}

export interface SegmentView {
    segment: SonnetSemanticSegment;
    glyphs: GlyphView[];
    guide: SonnetGuideView;
    index: number;
    role: SonnetSegmentRole;
}

interface SonnetTextViewOptions {
    segment: SonnetSemanticSegment;
    placement: SonnetTypographyPlacement;
    segmentIndex: number;
    baseFontSize: number;
    shotStartTime: number;
    shotEndTime: number;
    width: number;
    fontFamily: string;
    fontWeight: number;
    theme: Theme;
    glowEnabled: boolean;
    guideLayer: import('pixi.js').Container;
    haloLayer: import('pixi.js').Container;
    textLayer: import('pixi.js').Container;
}

export const measureText = (text: string, fontSpec: string, fontSize: number) => {
    try {
        const layout = layoutWithLines(prepareWithSegments(text || ' ', fontSpec), 99999, fontSize * 1.2);
        return layout.lines[0]?.width ?? text.length * fontSize * 0.6;
    } catch {
        return text.length * fontSize * 0.6;
    }
};

export const buildSonnetTextView = (
    pixi: PixiModule,
    options: SonnetTextViewOptions,
): SegmentView => {
    const { Text, TextStyle } = pixi;
    const { segment, placement } = options;
    const fontSize = options.baseFontSize * placement.fontScale;
    const isKeyword = options.theme.wordColors?.find(w => w.word.toLowerCase() === segment.text.toLowerCase());

    // The main body of the text remains the primary color
    const bodyColor = options.theme.primaryColor;

    // The glow and decoration edges use keyword colors, or accent colors for support text
    const glowColor = isKeyword
        ? isKeyword.color
        : (placement.role === 'hero' ? options.theme.primaryColor : options.theme.accentColor);

    const isDecoration = placement.role === 'decoration';
    const renderWeight = placement.role === 'hero' ? '900' : isDecoration ? '300' : '700';
    const fontSpec = `${renderWeight} ${fontSize}px ${options.fontFamily}`;

    // Parallax depth assignment
    const zDepth = isDecoration
        ? (Math.random() > 0.5 ? 0.5 + Math.random() * 0.8 : -0.5 - Math.random() * 0.8)
        : (placement.role === 'support' ? (Math.random() - 0.5) * 0.25 : 0);

    const blurAmount = Math.abs(zDepth) * fontSize * 0.12;
    const isBlurry = blurAmount > 2;

    const baseDropShadow = options.glowEnabled && !isDecoration ? {
        color: glowColor,
        alpha: 0.8,
        blur: Math.max(12, fontSize * 0.18),
        distance: 0,
    } : undefined;

    // If it's a blurry element, we use dropShadow to bake Depth of Field directly into the texture
    const finalDropShadow = isBlurry ? {
        color: isDecoration ? glowColor : bodyColor,
        alpha: isDecoration ? 0.6 : 0.9,
        blur: blurAmount,
        distance: 0,
    } : baseDropShadow;

    const style = new TextStyle({
        fontFamily: options.fontFamily,
        fontWeight: renderWeight as import('pixi.js').TextStyleFontWeight,
        fontSize,
        fill: (isBlurry && isDecoration) ? 'transparent' : (isDecoration ? 'transparent' : bodyColor),
        stroke: isDecoration ? { color: glowColor, width: Math.max(1, Math.min(8, fontSize * (isBlurry ? 0.02 : 0.006))) } : undefined,
        align: 'center',
        dropShadow: finalDropShadow,
        padding: finalDropShadow ? Math.max(20, finalDropShadow.blur * 2.5) : 0,
    });

    const glyphs: GlyphView[] = buildSonnetGlyphLayout(
        segment,
        placement,
        fontSize,
        char => measureText(char, fontSpec, fontSize),
        {
            startTime: options.shotStartTime,
            endTime: options.shotEndTime,
        },
    ).map(glyph => {
        const display = new Text({ text: glyph.char, style });
        display.anchor.set(0.5);
        if (isDecoration) display.alpha = 0.2;

        const wrapper = new pixi.Container();
        wrapper.rotation = placement.rotation;
        wrapper.position.set(glyph.baseX, glyph.baseY);
        wrapper.alpha = 0;

        // Chromatic Aberration (Dispersion) Effect
        let caCyanNode: import('pixi.js').Text | undefined;
        let caRedNode: import('pixi.js').Text | undefined;
        let caOffsetValue: number | undefined;

        if (!isDecoration && !isBlurry) {
            const isHero = placement.role === 'hero';
            const offset = fontSize * (isHero ? 0.025 : 0.010);
            caOffsetValue = offset;

            const caCyan = new Text({ text: glyph.char, style });
            caCyan.tint = 0x00ffff;
            caCyan.blendMode = 'screen';
            caCyan.anchor.set(0.5);
            caCyan.alpha = isHero ? 0.8 : 0.5;

            const caRed = new Text({ text: glyph.char, style });
            caRed.tint = 0xff0044;
            caRed.blendMode = 'screen';
            caRed.anchor.set(0.5);
            caRed.alpha = isHero ? 0.8 : 0.5;

            wrapper.addChild(caCyan, caRed);
            caCyanNode = caCyan;
            caRedNode = caRed;
        }

        wrapper.addChild(display);

        options.textLayer.addChild(wrapper);

        return {
            display: wrapper as any,
            halo: null,
            caCyan: caCyanNode,
            caRed: caRedNode,
            caOffset: caOffsetValue,
            baseX: glyph.baseX,
            baseY: glyph.baseY,
            enterX: glyph.enterX,
            enterY: glyph.enterY,
            entryRotation: glyph.entryRotation,
            finalRotation: placement.rotation,
            startTime: glyph.startTime,
            settleTime: glyph.settleTime,
            zDepth,
        };
    });
    const guide = createSonnetGuide(
        pixi,
        segment,
        placement,
        options.theme,
        fontSize,
        glyphs[0]?.startTime ?? options.shotStartTime,
    );
    if (!isDecoration) {
        options.guideLayer.addChild(guide.container);
    }
    return {
        segment,
        glyphs,
        guide,
        index: options.segmentIndex,
        role: placement.role,
    };
};
