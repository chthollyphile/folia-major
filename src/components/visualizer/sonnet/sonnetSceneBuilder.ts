import type { LyricAntialias, SonnetTuning, Theme } from '../../../types';
import { normalizeFontWeight, resolveThemeFontStack } from '../../../utils/fontStacks';
import type { SonnetParagraph, SonnetShot } from './types';
import { hashSonnetSeed } from './sonnetRandom';
import { buildSonnetShotMg } from './sonnetShotMg';
import {
    applySonnetScenePostProcess,
    createSonnetHaloLayer,
    resolveSonnetPostProcessProfile,
} from './sonnetPostProcess';
import {
    isSonnetLayoutSegment,
    resolveSonnetTypographyLayout,
} from './sonnetTypographyLayout';
import {
    buildSonnetTextView,
    type SegmentView,
} from './sonnetTextViewBuilder';
import { createSonnetGlitchEffect, type SonnetGlitchEffect } from './sonnetGlitchFilter';
import {
    buildSonnetMeasuredBoundsDebug,
    createSonnetShotDebugInfo,
    type SonnetDebugShotInfo,
} from './sonnetDebug';
import { resolveSonnetGeoVariant } from './sonnetSpatialMgGeometry';
import { resolveSonnetBackgroundMgVariant } from './sonnetBackgroundMgVariants';
import { resolveSonnetBackgroundDecorVariant } from './sonnetBackgroundDecor';
import { resolveSonnetFixedGeoVariant } from './sonnetFixedGeoVariants';

// src/components/visualizer/sonnet/sonnetSceneBuilder.ts
// Builds one bounded paragraph scene; playback-time mutation remains in the runtime controller.
type PixiModule = typeof import('pixi.js');

export interface ShotView {
    shot: SonnetShot;
    container: import('pixi.js').Container;
    segments: SegmentView[];
    debugInfo: SonnetDebugShotInfo;
    baseX: number;
    baseY: number;
    basePivotX: number;
    basePivotY: number;
    haloLayer: import('pixi.js').Container;
    /** The halo's alpha as built; 智能动感模式's downbeat flare lifts from it and returns to it. */
    haloBaseAlpha: number;
    mgLayer: import('pixi.js').Container;
    mgBackgroundLayer?: import('pixi.js').Container;
    mgGeoLayer?: import('pixi.js').Container;
    mgParticleLayer?: import('pixi.js').Container;
    mgFixedGeoLayer?: import('pixi.js').Container;
}

export interface SceneView {
    paragraph: SonnetParagraph;
    container: import('pixi.js').Container;
    shots: ShotView[];
    shotTimeline: SonnetShot[];
    postProcessFilters: import('pixi.js').Filter[];
    /** The antialiasing every filter on the scene container asks for (see resolveSonnetSceneFilterAntialias). */
    filterAntialias: SonnetSceneFilterAntialias;
    transitionBlurFilter: import('pixi.js').BlurFilter | null;
    transitionGlitchEffect: SonnetGlitchEffect | null;
    activeShotIndex: number;
}

export interface SonnetSceneBuildOptions {
    programSeed: string;
    host: HTMLDivElement;
    theme: Theme;
    tuning: SonnetTuning;
    /** 智能动感模式 (`smartBeatActive`: on or cached): builds the MG onset pop and the downbeat tear's filter. */
    smartBeatEnabled: boolean;
    lyricsFontScale: number;
    staticMode: boolean;
    transparentBackground: boolean;
    /**
     * What the canvas is actually running at (`textureResolution` times the 分辨率 multiplier, after
     * the texture-pool snap). The scene's filters are sized from it; the runtime rebuilds the
     * scenes whenever it changes.
     */
    renderResolution: number;
    /**
     * The 抗锯齿 setting as the user left it (global tier with the style's override on top; 'auto'
     * in previews). The canvas only carries a yes or no, which cannot tell 'auto' from the other two.
     */
    antialiasMode: LyricAntialias;
}

export type SonnetSceneFilterAntialias = 'on' | 'off' | 'inherit';

/** The transition blur runs at this share of the canvas resolution: it is blurring anyway. */
export const SONNET_TRANSITION_BLUR_RESOLUTION_SHARE = 0.5;

/**
 * The antialiasing the filters on a scene container ask for. Pixi runs one container's enabled
 * filters as a single pass, multisampled only when none of them refuses, so they have to agree.
 *
 * - 'off': nothing is multisampled, the post-process chain included (it asks for 'on' by itself).
 * - With a post-process chain: 'on', like the chain. The canvas is not multisampled by default
 *   while post-processing is on, the pass is.
 * - 'on' without a chain: the canvas is multisampled, and the transition and outro passes follow it.
 * - 'auto' without a chain: the transition and outro passes are not multisampled. They last a few
 *   frames and tear or blur the picture anyway, while a 4-sample target at the canvas resolution
 *   would stay in the texture pool for good: at 1920x1080 and the default 1.5x that is about
 *   130 MB against 32 MB.
 */
export const resolveSonnetSceneFilterAntialias = (
    mode: LyricAntialias,
    hasPostProcessChain: boolean,
): SonnetSceneFilterAntialias => {
    if (mode === 'off') return 'off';
    if (hasPostProcessChain) return 'on';
    return mode === 'on' ? 'inherit' : 'off';
};

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();

export const shouldDrawSonnetSceneBackdrop = (showBackgroundMg: boolean, transparentBackground: boolean) => (
    showBackgroundMg && !transparentBackground
);

export const buildSonnetScene = (
    pixi: PixiModule,
    options: SonnetSceneBuildOptions,
    iconTextures: Map<string, import('pixi.js').Texture>,
    paragraph: SonnetParagraph,
): SceneView => {
    const { Container, Graphics, Sprite } = pixi;
    const width = Math.max(options.host.clientWidth, 320);
    const height = Math.max(options.host.clientHeight, 240);
    const container = new Container();
    const sceneBackgroundLayer = new Container();
    // Resolve visibility once while building; playback only mutates animation state afterward.
    const showOnlyText = options.tuning.showOnlyText;
    const showBackgroundMg = !showOnlyText && options.tuning.showBackgroundMg;
    const showFixedGeo = !showOnlyText && options.tuning.showFixedGeo;
    const showBackgroundDecor = !showOnlyText && options.tuning.showBackgroundDecor;
    const showGuide = !showOnlyText && options.tuning.showGuide;
    const showOuterMetadata = !showOnlyText && options.tuning.outerFrameMode === 'full';
    const sceneSeed = hashSonnetSeed(`${options.programSeed}:${paragraph.id}`);
    const postProcessProfile = resolveSonnetPostProcessProfile(
        options.theme,
        options.tuning,
        options.staticMode,
    );
    const fontFamily = resolveThemeFontStack(options.theme);
    const manualFontWeight = normalizeFontWeight(options.theme.fontWeight);
    const postProcessFilters: import('pixi.js').Filter[] = [];
    if (showBackgroundMg) {
        const density = Math.round(4 + options.tuning.mgDensity * 5);
        if (shouldDrawSonnetSceneBackdrop(showBackgroundMg, options.transparentBackground)) {
            sceneBackgroundLayer.addChild(new Graphics()
                .rect(0, 0, width, height)
                .fill({ color: colorNumber(pixi, options.theme.backgroundColor), alpha: 0.10 }));
        }

        for (let index = 0; index < density; index += 1) {
            const x = ((sceneSeed + index * 97) % 997) / 997 * width;
            const y = ((sceneSeed + index * 193) % 991) / 991 * height;
            const length = 32 + ((sceneSeed + index * 43) % 180);
            sceneBackgroundLayer.addChild(new Graphics()
                .moveTo(x, y)
                .lineTo(Math.min(width, x + length), y)
                .stroke({
                    color: colorNumber(pixi, index % 2 ? options.theme.secondaryColor : options.theme.accentColor),
                    width: index % 3 === 0 ? 2 : 1,
                    alpha: 0.12 + (index % 4) * 0.04,
                }));
        }
    }

    const { Text, TextStyle } = pixi;
    // Decorative theme metadata text
    if (options.theme.name) {
        const nameText = new Text({
            text: `[ THEME ] ${options.theme.name.toUpperCase()}`,
            style: new TextStyle({
                fontFamily,
                fontWeight: manualFontWeight === null
                    ? 'bold'
                    : String(manualFontWeight) as import('pixi.js').TextStyleFontWeight,
                fontSize: 14,
                fill: options.theme.primaryColor,
                letterSpacing: 4
            })
        });
        nameText.alpha = 0.2;
        nameText.rotation = -Math.PI / 2;
        nameText.position.set(20, height - 20);
        nameText.anchor.set(0, 1);
        if (showOuterMetadata) sceneBackgroundLayer.addChild(nameText);
    }
    
    if (options.theme.description) {
        const descText = new Text({
            text: options.theme.description,
            style: new TextStyle({
                fontFamily,
                fontWeight: manualFontWeight === null
                    ? undefined
                    : String(manualFontWeight) as import('pixi.js').TextStyleFontWeight,
                fontSize: 12,
                fill: options.theme.secondaryColor,
                wordWrap: true,
                wordWrapWidth: width * 0.3
            })
        });
        descText.alpha = 0.3;
        descText.position.set(width - 20, 20);
        descText.anchor.set(1, 0);
        if (showOuterMetadata) sceneBackgroundLayer.addChild(descText);
    }
    container.addChild(sceneBackgroundLayer);
    const shots = paragraph.shots.map((shot, shotIndex) => {
        const shotContainer = new Container();
        const compiledLines = shot.lineIndices
            .map(lineIndex => paragraph.lines.find(item => item.sourceIndex === lineIndex))
            .filter(Boolean) as SonnetParagraph['lines'];
        const linesSegments = compiledLines
            .map(line => line.segments.filter(isSonnetLayoutSegment))
            .filter(segs => segs.length > 0);
        const segments = linesSegments.flat();
        const wordCount = Math.max(1, segments.filter(segment => segment.isWordLike).length);
        const heroScale = shot.kind === 'type-impact' ? 1.55 : shot.kind === 'quiet-tableau' ? 0.82 : 1;
        const fontSize = Math.max(24, Math.min(112, (
            width / Math.max(7, wordCount * 2.15)
        ) * heroScale * options.lyricsFontScale));
        const views: SegmentView[] = [];
        const placements = resolveSonnetTypographyLayout({
            lines: linesSegments,
            shotKind: shot.kind,
            paragraphKind: paragraph.kind,
            width,
            height,
            baseFontSize: fontSize,
            fontFamily,
            fontWeight: manualFontWeight,
        });
        const shotSeed = sceneSeed + shotIndex * 97;
        const mgLayer = buildSonnetShotMg(
            pixi,
            shot.kind,
            options.theme,
            width,
            height,
            shotSeed,
            iconTextures,
            options.smartBeatEnabled,
        );
        shotContainer.addChild(mgLayer);
        const mgBackgroundLayer = (mgLayer as any).bgLayer as import('pixi.js').Container | undefined;
        const mgGeoLayer = (mgLayer as any).geoLayer as import('pixi.js').Container | undefined;
        const mgParticleLayer = (mgLayer as any).particleLayer as import('pixi.js').Container | undefined;
        const mgFixedGeoLayer = (mgLayer as any).fixedGeoLayer as import('pixi.js').Container | undefined;
        mgLayer.visible = showBackgroundMg || showFixedGeo || showBackgroundDecor;
        if (mgBackgroundLayer) mgBackgroundLayer.visible = showBackgroundMg;
        if (mgGeoLayer) mgGeoLayer.visible = showBackgroundMg;
        if (mgParticleLayer) mgParticleLayer.visible = showBackgroundDecor;
        if (mgFixedGeoLayer) mgFixedGeoLayer.visible = showFixedGeo;
        const { layer: haloLayer, filters: haloFilters } = createSonnetHaloLayer(
            pixi,
            postProcessProfile,
        );
        const guideLayer = new Container();
        const textLayer = new Container();
        // Every glyph's screen-blended aberration copies share this one layer instead of sitting in
        // the glyph wrapper. Interleaved screen/normal children break Pixi's batch on each switch,
        // turning a shot into ~2 draws per glyph; an Intel iGPU has hung on exactly that stream and
        // the failed engine reset took the compositor down with it. Added first, so the bg shapes
        // and frame decor later inserted at index 0 still sit below the aberration.
        const caLayer = new Container();
        textLayer.addChild(caLayer);
        guideLayer.visible = showGuide;
        haloLayer.visible = !showOnlyText;
        shotContainer.addChild(guideLayer, haloLayer, textLayer);
        postProcessFilters.push(...haloFilters);
        // Virtual instrumental lines can share one shot; the complete staff belongs to the shot, not each line.
        let staffViewAdded = false;
        placements.forEach((placement, placementIndex) => {
            const segment = segments[placement.segmentIndex];
            if (segment.text === '♪') {
                if (staffViewAdded) return;
                staffViewAdded = true;
            }
            views.push(buildSonnetTextView(
                pixi,
                {
                    segment,
                    placement,
                    segmentIndex: placement.segmentIndex,
                    baseFontSize: fontSize,
                    shotStartTime: shot.startTime,
                    shotEndTime: shot.endTime,
                    paragraphKind: paragraph.kind,
                    width,
                    fontFamily,
                    fontWeight: manualFontWeight,
                    theme: options.theme,
                    glowEnabled: postProcessProfile.glowStrength > 0,
                    showFixedGeo,
                    guideLayer,
                    haloLayer,
                    textLayer,
                    caLayer,
                },
            ));
        });
        const bounds = shotContainer.getLocalBounds();
        // `mask-reveal` is revealed by the glyph timeline. A bounds-sized mask would stay
        // static while camera tracking and parallax move the shot, clipping open MG artwork.
        // Debug overlay stays above the text and never feeds the bounds/focus math.
        shotContainer.addChild(buildSonnetMeasuredBoundsDebug(pixi, placements));
        const usesGeoMg = shot.kind === 'type-impact' || shot.kind === 'fragment-collage';
        const debugInfo = createSonnetShotDebugInfo({
            programSeed: options.programSeed,
            paragraphId: paragraph.id,
            paragraphKind: paragraph.kind,
            shot,
            shotIndex,
            shotCount: paragraph.shots.length,
            baseFontSize: fontSize,
            wordCount,
            geoVariant: usesGeoMg ? resolveSonnetGeoVariant(shotSeed) : null,
            backgroundMgVariant: resolveSonnetBackgroundMgVariant(shotSeed),
            fixedGeoVariant: usesGeoMg ? resolveSonnetFixedGeoVariant(shotSeed) : null,
            backgroundDecorVariant: resolveSonnetBackgroundDecorVariant(shotSeed),
            placements,
            segmentTexts: segments.map(segment => segment.text),
        });
        
        // Poster blocks start centered before runtime tracking; other templates start on the hero word.
        const heroPlacement = placements.find(p => p.role === 'hero');
        const focusX = shot.kind === 'poster-blocks'
            ? 0
            : heroPlacement ? heroPlacement.x : (bounds.x + bounds.width / 2);
        const focusY = shot.kind === 'poster-blocks'
            ? 0
            : heroPlacement ? heroPlacement.y : (bounds.y + bounds.height / 2);
        
        shotContainer.pivot.set(focusX, focusY);
        shotContainer.position.set(
            width * (shot.kind === 'poster-blocks' ? 0.5 : 0.5 + shot.camera.x),
            height * (shot.kind === 'poster-blocks'
                ? 0.5
                : 0.48 + shot.camera.y + (shotIndex % 2 ? 0.025 : -0.025)),
        );
        container.addChild(shotContainer);
        return {
            shot,
            container: shotContainer,
            segments: views,
            debugInfo,
            baseX: shotContainer.x,
            baseY: shotContainer.y,
            basePivotX: focusX,
            basePivotY: focusY,
            haloLayer,
            haloBaseAlpha: haloLayer.alpha,
            mgLayer,
            mgBackgroundLayer,
            mgGeoLayer,
            mgParticleLayer,
            mgFixedGeoLayer,
        };
    });


    if (!showOnlyText) {
        const sceneFilters = applySonnetScenePostProcess(
            pixi,
            container,
            postProcessProfile,
            sceneSeed,
        );
        if (sceneFilters.length > 0) {
            // Keep full-scene shaders in viewport space even when visible lyric/decor bounds are smaller.
            container.filterArea = new pixi.Rectangle(0, 0, width, height);
            // Pixi's Filter default is a hard resolution 1: left alone, the whole scene would be
            // drawn at one pixel per CSS pixel and stretched onto the canvas, whatever
            // `textureResolution` and the 分辨率 multiplier say.
            sceneFilters.forEach((filter) => {
                filter.resolution = 'inherit';
                // The chain asks for multisampling by itself; 抗锯齿 set to 关 takes it away.
                if (options.antialiasMode === 'off') filter.antialias = 'off';
            });
            postProcessFilters.push(...sceneFilters);
        }
    }
    const filterAntialias = resolveSonnetSceneFilterAntialias(options.antialiasMode, postProcessFilters.length > 0);
    const transitionBlurFilter = options.tuning.enableTransitions && !options.staticMode
        ? new pixi.BlurFilter({
            strength: 0,
            quality: 1,
            kernelSize: 5,
            // One container's filters share the lowest resolution among the enabled ones, so this
            // is what the scene is drawn at while the blur is on: a share of the canvas, not a
            // fixed 0.5 that a 3x canvas would stretch sixfold.
            resolution: options.renderResolution * SONNET_TRANSITION_BLUR_RESOLUTION_SHARE,
        })
        : null;
    if (transitionBlurFilter) {
        transitionBlurFilter.antialias = filterAntialias;
        // BlurFilter's padding is strength * 2, and Pixi pads the chain's shared render frame
        // (already clipped to the viewport) by the sum of all enabled filters' padding. A growing
        // frame rescales the vignette pass's screen coordinates, so ramping the blur brightened the
        // vignette mid-transition. repeatEdgePixels pins padding at 0; the extra margin was
        // off-screen anyway.
        transitionBlurFilter.repeatEdgePixels = true;
        transitionBlurFilter.enabled = false;
        container.filters = [...(container.filters ?? []), transitionBlurFilter];
        postProcessFilters.push(transitionBlurFilter);
    }
    // 智能动感模式 reuses this filter for the downbeat tear.
    const transitionGlitchEffect = (options.tuning.enableTransitions || options.smartBeatEnabled) && !options.staticMode
        ? createSonnetGlitchEffect(pixi)
        : null;
    if (transitionGlitchEffect) {
        transitionGlitchEffect.filter.antialias = filterAntialias;
        container.filters = [...(container.filters ?? []), transitionGlitchEffect.filter];
        postProcessFilters.push(transitionGlitchEffect.filter);
    }
    if (transitionBlurFilter || transitionGlitchEffect) {
        // Without a filterArea the transition filters run over the scene's content bounds, and those
        // follow what has drawn in so far: AnimatedGraphics skips commands that have not started yet,
        // so the glitch's slice offsets would depend on stagger progress. Pin the frame to the
        // viewport, as the post-process above does.
        container.filterArea = new pixi.Rectangle(0, 0, width, height);
    }
    container.visible = false;
    return {
        paragraph,
        container,
        shots,
        shotTimeline: shots.map(shot => shot.shot),
        postProcessFilters,
        filterAntialias,
        transitionBlurFilter,
        transitionGlitchEffect,
        activeShotIndex: -1,
    };
};
