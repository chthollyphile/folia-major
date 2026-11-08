import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';
import 'pixi.js/advanced-blend-modes';
import type { Theme } from '../../../types';
import { resolveGlowColorStrength } from '../colorMix';
import { buildSonnetGlyphLayout } from './sonnetGlyphLayout';
import { resolveSonnetSegmentDepth, resolveSonnetSegmentNormalOffset } from './sonnetMotion';
import { hashSonnetSeed } from './sonnetRandom';
import { buildSonnetStaffView } from './sonnetStaffView';
import { buildSonnetTextFixedGeo } from './sonnetTextFixedGeo';
import { resolveSonnetCameraTrackingGlyphs } from './sonnetCameraTracking';
import { createSonnetGuide, type SonnetGuideView } from './sonnetGuides';
import { buildSonnetFrameDecor, resolveSonnetFrameDecorSpec, type SonnetFrameDecorView } from './sonnetFrameDecor';
import type { SonnetSemanticSegment } from './types';
import {
    isSonnetEmphasisRole,
    type SonnetSegmentRole,
    type SonnetTypographyPlacement,
} from './sonnetTypographyLayout';
import { resolveSonnetRoleFontWeight } from './sonnetTypographyRoles';

// src/components/visualizer/sonnet/sonnetTextViewBuilder.ts
// Creates parser-timed core/halo glyph pairs and their semantic guide view.
type PixiModule = typeof import('pixi.js');

export interface GlyphGhostView {
    node: import('pixi.js').Text;
    // Full-spread offset in wrapper-local px and the layer's peak alpha, both
    // precomputed so the runtime only scales by the envelope.
    dirX: number;
    dirY: number;
    alphaBase: number;
}

export interface GlyphView {
    display: import('pixi.js').Container;
    halo: import('pixi.js').Text | null;
    // Lives in the shot's shared aberration layer, not under `display`; the runtime copies the
    // wrapper's transform onto it each frame.
    caWrapper?: import('pixi.js').Container;
    caCyan?: import('pixi.js').Text;
    caRed?: import('pixi.js').Text;
    caOffset?: number;
    ghosts?: GlyphGhostView[];
    ghostDuration?: number;
    baseX: number;
    baseY: number;
    enterX: number;
    enterY: number;
    entryRotation: number;
    finalRotation: number;
    startTime: number;
    settleTime: number;
    zDepth: number;
    isBackgroundShape?: boolean;
    isTextGlyph?: boolean;
    updateAnimation?: (time: number) => void;
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
    frameDecor?: SonnetFrameDecorView | null;
    glyphs: GlyphView[];
    trackingGlyphs: GlyphView[];
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
    fontWeight?: number | null;
    theme: Theme;
    glowEnabled: boolean;
    showFixedGeo: boolean;
    guideLayer: import('pixi.js').Container;
    haloLayer: import('pixi.js').Container;
    textLayer: import('pixi.js').Container;
    /** Child of `textLayer`, below every glyph wrapper; see sonnetSceneBuilder. */
    caLayer: import('pixi.js').Container;
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
    const placement = { ...originalPlacement };

    const fontSize = options.baseFontSize * placement.fontScale;
    const normalOffsetSeed = hashSonnetSeed([
        segment.text,
        segment.startOffset,
        segment.endOffset,
        options.segmentIndex,
        'normal-offset',
    ].join(':'));
    const normalOffset = resolveSonnetSegmentNormalOffset(
        placement.role,
        placement.layoutDirection,
        placement.rotation,
        fontSize,
        normalOffsetSeed / 0xffffffff,
    );
    placement.x += normalOffset.x;
    placement.y += normalOffset.y;
    const isKeyword = options.theme.wordColors?.find(w => w.word.toLowerCase() === segment.text.toLowerCase());

    // The main body of the text remains the primary color
    const bodyColor = options.theme.primaryColor;

    // The glow and decoration edges use keyword colors, or accent colors for support text
    const glowColor = isKeyword
        ? isKeyword.color
        : (isSonnetEmphasisRole(placement.role) ? options.theme.primaryColor : options.theme.accentColor);

    const isDecoration = placement.role === 'decoration';
    const renderWeight = resolveSonnetRoleFontWeight(options.fontWeight, placement.role);
    const fontSpec = `${renderWeight} ${fontSize}px ${options.fontFamily}`;

    // Parallax depth assignment
    const zDepth = resolveSonnetSegmentDepth(placement.role);

    const blurAmount = Math.abs(zDepth) * fontSize * 0.12;
    const isBlurry = blurAmount > 2;

    const hasGlow = options.glowEnabled && !isDecoration;
    const glowBlur = Math.max(12, fontSize * 0.18);
    let glowStrength = 0;
    if (hasGlow) {
        const glowRgb = pixi.Color.shared.setValue(glowColor);
        glowStrength = resolveGlowColorStrength(glowRgb.red * 255, glowRgb.green * 255, glowRgb.blue * 255);
    }
    const baseDropShadow = glowStrength > 0 ? {
        color: glowColor,
        alpha: 0.8 * glowStrength,
        blur: glowBlur,
        distance: 0,
    } : undefined;

    const style = new TextStyle({
        fontFamily: options.fontFamily,
        fontWeight: String(renderWeight) as import('pixi.js').TextStyleFontWeight,
        fontSize,
        fill: (isDecoration ? 'transparent' : bodyColor),
        stroke: isDecoration ? { color: glowColor, width: Math.max(1, Math.min(8, fontSize * 0.006)) } : undefined,
        align: 'center',
        dropShadow: baseDropShadow,
        // Keep the glyph bounds stable when only the glow color becomes dark.
        padding: hasGlow ? Math.max(20, glowBlur * 2.5) : 0,
    });

    // Semi-hero echo ghosts: hollow (stroke-only) copies that split along the
    // normal of the layout flow direction, fade in and vanish quickly. Peak alpha
    // is kept low so they read as a faint afterimage, never competing with the core.
    const isSemiHero = placement.role === 'semi-hero';
    const ghostStyle = isSemiHero ? new TextStyle({
        fontFamily: options.fontFamily,
        fontWeight: String(renderWeight) as import('pixi.js').TextStyleFontWeight,
        fontSize,
        fill: 'transparent',
        stroke: { color: glowColor, width: Math.max(1, Math.min(8, fontSize * 0.006)) },
        align: 'center',
    }) : undefined;
    // Normal of the flow direction in screen space, converted into wrapper-local
    // coordinates so the ghosts inherit the wrapper's rotation correctly.
    const ghostNormal = (() => {
        const screen = placement.layoutDirection === 'vertical' ? { x: 1, y: 0 } : { x: 0, y: 1 };
        const cosine = Math.cos(-placement.rotation);
        const sine = Math.sin(-placement.rotation);
        return {
            x: screen.x * cosine - screen.y * sine,
            y: screen.x * sine + screen.y * cosine,
        };
    })();
    const ghostSpread = fontSize * 0.85;
    const ghostDuration = Math.min(
        0.7,
        Math.max(0.4, (options.shotEndTime - options.shotStartTime) * 0.12 + 0.1),
    );

    if (segment.text === '♪') {
        const staffView = buildSonnetStaffView(
            pixi,
            placement,
            options.theme,
            options.baseFontSize,
            options.shotStartTime,
            options.width,
            options.textLayer
        );
        const guide = createSonnetGuide(
            pixi,
            segment,
            placement,
            options.theme,
            fontSize,
            staffView.startTime,
        );
        if (!isDecoration) {
            options.guideLayer.addChild(guide.container);
        }
        return {
            segmentIndex: options.segmentIndex,
            displayText: segment.text,
            role: placement.role,
            fontScale: placement.fontScale,
            x: placement.x,
            y: placement.y,
            rotation: placement.rotation,
            enterX: placement.enterX,
            enterY: placement.enterY,
            vertical: placement.vertical,
            timingPhase: placement.timingPhase,
            guide,
            glyphs: [staffView],
            trackingGlyphs: [staffView],
        };
    }

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
        let caWrapperNode: import('pixi.js').Container | undefined;
        let caCyanNode: import('pixi.js').Text | undefined;
        let caRedNode: import('pixi.js').Text | undefined;
        let caOffsetValue: number | undefined;

        if (!isDecoration) {
            const isHero = isSonnetEmphasisRole(placement.role);
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

            const caWrapper = new pixi.Container();
            caWrapper.rotation = wrapper.rotation;
            caWrapper.position.copyFrom(wrapper.position);
            caWrapper.alpha = 0;
            caWrapper.addChild(caCyan, caRed);
            options.caLayer.addChild(caWrapper);
            caWrapperNode = caWrapper;
            caCyanNode = caCyan;
            caRedNode = caRed;
        }

        wrapper.addChild(display);

        // Echo ghosts sit behind the core glyph; per-ghost dir/alpha precomputed.
        // Both echoes stack on one normal side (deterministic per segment) so the
        // afterimage reads as a directional streak rather than a symmetric blur.
        let ghosts: GlyphGhostView[] | undefined;
        if (ghostStyle) {
            ghosts = [];
            const side = normalOffsetSeed % 2 === 0 ? 1 : -1;
            for (let layer = 1; layer <= 2; layer++) {
                const ghost = new Text({ text: glyph.char, style: ghostStyle });
                ghost.anchor.set(0.5);
                ghost.alpha = 0;
                ghost.visible = false;
                wrapper.addChildAt(ghost, 0);
                const factor = layer === 1 ? 1 : 1.7;
                ghosts.push({
                    node: ghost,
                    dirX: ghostNormal.x * side * factor * ghostSpread,
                    dirY: ghostNormal.y * side * factor * ghostSpread,
                    alphaBase: layer === 1 ? 0.3 : 0.16,
                });
            }
        }

        options.textLayer.addChild(wrapper);

        return {
            display: wrapper,
            halo: null,
            caWrapper: caWrapperNode,
            caCyan: caCyanNode,
            caRed: caRedNode,
            caOffset: caOffsetValue,
            ghosts,
            ghostDuration: ghosts ? ghostDuration : undefined,
            baseX: glyph.baseX,
            baseY: glyph.baseY,
            enterX: glyph.enterX,
            enterY: glyph.enterY,
            entryRotation: glyph.entryRotation,
            finalRotation: placement.rotation,
            startTime: glyph.startTime,
            settleTime: glyph.settleTime,
            zDepth,
            isTextGlyph: true,
        };
    });


    // Randomized background geometry accompanying specific text segments.
    // Kept rarer than before and mutually exclusive with the frame decor so the
    // two outline-style layers never stack on the same segment.
    const isChorusParagraph = options.paragraphKind === 'chorus';
    const textSeed = segment.text.split('').reduce((a, b) => a + b.charCodeAt(0), 0) + options.segmentIndex * 13;
    const isChorusEffect = isChorusParagraph || ((textSeed % 100) < 35);
    const shapeThreshold = isChorusEffect ? 26 : 15; // Higher chance in chorus effect
    const hasFrameDecor = resolveSonnetFrameDecorSpec(segment).applied;
    const shouldAddBgShape = options.showFixedGeo
        && (textSeed % 100) < shapeThreshold
        && !isDecoration
        && segment.isWordLike
        && !hasFrameDecor
        && glyphs.length > 0;

    if (shouldAddBgShape) {
        const bgWrapper = new pixi.Container();
        bgWrapper.position.set(placement.x, placement.y);
        bgWrapper.rotation = placement.rotation;
        bgWrapper.alpha = 0;
        
        const bgShape = buildSonnetTextFixedGeo(pixi, {
            seed: textSeed,
            isChorusEffect,
            fontSize,
            layoutWidth: options.width,
            theme: options.theme,
        });
        
        bgWrapper.addChild(bgShape);
        options.textLayer.addChildAt(bgWrapper, 0); // Ensure it stays behind the text
        
        const firstGlyph = glyphs[0];
        const bgGlyph: GlyphView = {
            display: bgWrapper,
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
            isBackgroundShape: true,
            isTextGlyph: false,
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

    // Decorative open frame (30% of segments), kept behind the glyphs.
    const frameDecor = buildSonnetFrameDecor(pixi, {
        segment,
        placement,
        theme: options.theme,
        fontSize,
        shotStartTime: options.shotStartTime,
        shotEndTime: options.shotEndTime,
        firstGlyphStartTime: glyphs.find(glyph => glyph.isTextGlyph !== false)?.startTime
            ?? segment.startTime,
    });
    if (frameDecor) options.textLayer.addChildAt(frameDecor.container, 0);

    return {
        segmentIndex: options.segmentIndex,
        displayText: segment.text,
        role: placement.role,
        fontScale: placement.fontScale,
        x: placement.x,
        y: placement.y,
        rotation: placement.rotation,
        enterX: placement.enterX,
        enterY: placement.enterY,
        vertical: placement.vertical,
        timingPhase: placement.timingPhase,
        guide,
        frameDecor,
        glyphs,
        trackingGlyphs: resolveSonnetCameraTrackingGlyphs(glyphs),
    };
};
