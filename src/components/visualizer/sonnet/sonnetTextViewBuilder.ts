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
    segmentIndex: number;
    displayText: string;
    role: SonnetSegmentRole;
    fontScale: number;
    x: number;
    y: number;
    rotation: number;
    enterX: number;
    enterY: number;
    vertical: boolean;
    timingPhase: number;
    guide: SonnetGuideView;
    glyphs: GlyphView[];
}

interface SonnetTextViewOptions {
    segment: SonnetSemanticSegment;
    placement: SonnetTypographyPlacement;
    segmentIndex: number;
    baseFontSize: number;
    shotStartTime: number;
    shotEndTime: number;
    paragraphKind: string;
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
    const { segment, placement: originalPlacement } = options;
    const isAscii = /^[\x00-\x7F]*$/.test(segment.text.trim());
    const placement = { ...originalPlacement };
    
    // In vertical layout, pure English (ASCII) words should not be stacked vertically letter-by-letter.
    // Instead, they should be laid out horizontally, and the entire word block rotated 90 degrees clockwise.
    if (placement.vertical && isAscii && segment.text.length > 1) {
        placement.vertical = false;
        placement.rotation += Math.PI / 2;
    }

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

    const style = new TextStyle({
        fontFamily: options.fontFamily,
        fontWeight: renderWeight as import('pixi.js').TextStyleFontWeight,
        fontSize,
        fill: (isDecoration ? 'transparent' : bodyColor),
        stroke: isDecoration ? { color: glowColor, width: Math.max(1, Math.min(8, fontSize * 0.006)) } : undefined,
        align: 'center',
        dropShadow: baseDropShadow,
        padding: baseDropShadow ? Math.max(20, baseDropShadow.blur * 2.5) : 0,
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

        if (!isDecoration) {
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


    // Randomized background geometry accompanying specific text segments
    const isChorusParagraph = options.paragraphKind === 'chorus';
    const textSeed = segment.text.split('').reduce((a, b) => a + b.charCodeAt(0), 0) + options.segmentIndex * 13;
    const isChorusEffect = isChorusParagraph || ((textSeed % 100) < 35);
    const shapeThreshold = isChorusEffect ? 65 : 25; // Higher chance in chorus effect
    const shouldAddBgShape = (textSeed % 100) < shapeThreshold && !isDecoration && segment.isWordLike && glyphs.length > 0;

    if (shouldAddBgShape) {
        const bgWrapper = new pixi.Container();
        bgWrapper.position.set(placement.x, placement.y);
        bgWrapper.rotation = placement.rotation;
        bgWrapper.alpha = 0;
        
        const bgShape = new pixi.Graphics();
        let blockType = textSeed % 4; // 0: solid rect, 1: hollow rect, 2: 45deg hollow rect, 3: abstract sphere
        
        if (isChorusEffect) {
            // Bias towards hollow frames in chorus effect
            const chorusSeed = textSeed % 10;
            if (chorusSeed < 5) blockType = 1;      // 50% hollow rect
            else if (chorusSeed < 9) blockType = 2; // 40% 45deg hollow rect
            else blockType = 3;                     // 10% abstract sphere
        }

        const color = (textSeed % 2 === 0) ? options.theme.primaryColor : options.theme.secondaryColor;
        const alpha = (isChorusEffect ? 0.4 : 0.25) + (textSeed % 10) * 0.03;
        
        // Size proportional to the word size and overall layout
        const scaleMultiplier = isChorusEffect ? (1.5 + (textSeed % 5) * 0.3) : 1.0;
        const w = Math.max(fontSize * 2.5 * scaleMultiplier, options.width * 0.12 * scaleMultiplier);
        const h = blockType === 3 ? w : Math.max(fontSize * 1.8 * scaleMultiplier, options.width * 0.08 * scaleMultiplier);
        
        const x = -w / 2;
        const y = -h / 2;

        if (blockType === 0) {
            bgShape.rect(x, y, w, h).fill({ color, alpha });
        } else if (blockType === 1) {
            bgShape.rect(x, y, w, h).stroke({ color, width: Math.max(1.5, fontSize * 0.02), alpha });
            if (isChorusEffect && textSeed % 2 === 0) {
                // Double concentric frame for explosiveness
                bgShape.rect(x * 1.2, y * 1.2, w * 1.2, h * 1.2).stroke({ color, width: 1, alpha: alpha * 0.5 });
            }
        } else if (blockType === 2) {
            const rw = w * 0.8;
            const rh = h * 0.8;
            bgShape.rect(-rw / 2, -rh / 2, rw, rh).stroke({ color, width: Math.max(1.5, fontSize * 0.02), alpha });
            if (isChorusEffect && textSeed % 2 === 0) {
                // Double concentric frame
                bgShape.rect(-rw * 0.6, -rh * 0.6, rw * 1.2, rh * 1.2).stroke({ color, width: 1, alpha: alpha * 0.5 });
            }
            bgShape.rotation = Math.PI / 4;
        } else if (blockType === 3) {
            const r = w * 0.5;
            bgShape.circle(0, 0, r).fill({ color, alpha: alpha * 0.15 });
            
            const hatch = new pixi.Graphics();
            const hatchSpacing = Math.max(4, w * 0.05);
            for (let d = -r; d < r; d += hatchSpacing) {
                const lineH = Math.sqrt(Math.max(0, r * r - d * d));
                hatch.moveTo(d + r * 0.4, -lineH + r * 0.4);
                hatch.lineTo(d + r * 0.4, lineH + r * 0.4);
            }
            hatch.stroke({ color, width: 1.5, alpha: alpha * 0.6 });
            bgShape.addChild(hatch);
        }
        
        bgWrapper.addChild(bgShape);
        options.textLayer.addChildAt(bgWrapper, 0); // Ensure it stays behind the text
        
        const firstGlyph = glyphs[0];
        const bgGlyph: GlyphView = {
            display: bgWrapper as any,
            halo: null,
            baseX: placement.x,
            baseY: placement.y,
            enterX: placement.enterX,
            enterY: placement.enterY,
            entryRotation: 0,
            finalRotation: placement.rotation,
            startTime: firstGlyph.startTime,
            settleTime: firstGlyph.settleTime,
            zDepth: -0.5 - (textSeed % 5) * 0.1, // background depth for parallax
        };
        glyphs.unshift(bgGlyph);
    }

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
        timingPhase: placement.timingPhase,
    };
};
