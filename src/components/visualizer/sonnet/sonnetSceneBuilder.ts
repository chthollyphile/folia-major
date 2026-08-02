import type { SonnetTuning, Theme } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import type { SonnetParagraph, SonnetShot } from './types';
import { hashSonnetSeed } from './sonnetRandom';
import { buildSonnetShotMg } from './sonnetShotMg';
import {
    applySonnetScenePostProcess,
    createSonnetHaloLayer,
    resolveSonnetPostProcessProfile,
} from './sonnetPostProcess';
import {
    resolveSonnetTypographyLayout,
} from './sonnetTypographyLayout';
import {
    buildSonnetTextView,
    type SegmentView,
} from './sonnetTextViewBuilder';
import { createSonnetGlitchEffect, type SonnetGlitchEffect } from './sonnetGlitchFilter';

// src/components/visualizer/sonnet/sonnetSceneBuilder.ts
// Builds one bounded paragraph scene; playback-time mutation remains in the runtime controller.
type PixiModule = typeof import('pixi.js');

export interface ShotView {
    shot: SonnetShot;
    container: import('pixi.js').Container;
    segments: SegmentView[];
    baseX: number;
    baseY: number;
    basePivotX: number;
    basePivotY: number;
    haloLayer: import('pixi.js').Container;
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
    transitionBlurFilter: import('pixi.js').BlurFilter | null;
    transitionGlitchEffect: SonnetGlitchEffect | null;
    activeShotIndex: number;
}

export interface SonnetSceneBuildOptions {
    programSeed: string;
    host: HTMLDivElement;
    theme: Theme;
    tuning: SonnetTuning;
    lyricsFontScale: number;
    staticMode: boolean;
}

const colorNumber = (pixi: PixiModule, color: string) => pixi.Color.shared.setValue(color).toNumber();

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
    const sceneSeed = hashSonnetSeed(`${options.programSeed}:${paragraph.id}`);
    const postProcessProfile = resolveSonnetPostProcessProfile(
        options.theme,
        options.tuning,
        options.staticMode,
    );
    const postProcessFilters: import('pixi.js').Filter[] = [];
    if (showBackgroundMg) {
        const density = Math.round(4 + options.tuning.mgDensity * 5);
        sceneBackgroundLayer.addChild(new Graphics()
            .rect(0, 0, width, height)
            .fill({ color: colorNumber(pixi, options.theme.backgroundColor), alpha: 0.10 }));

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
                fontFamily: resolveThemeFontStack(options.theme),
                fontWeight: 'bold',
                fontSize: 14,
                fill: options.theme.primaryColor,
                letterSpacing: 4
            })
        });
        nameText.alpha = 0.2;
        nameText.rotation = -Math.PI / 2;
        nameText.position.set(20, height - 20);
        nameText.anchor.set(0, 1);
        if (showBackgroundMg) sceneBackgroundLayer.addChild(nameText);
    }
    
    if (options.theme.description) {
        const descText = new Text({
            text: options.theme.description,
            style: new TextStyle({
                fontFamily: resolveThemeFontStack(options.theme),
                fontSize: 12,
                fill: options.theme.secondaryColor,
                wordWrap: true,
                wordWrapWidth: width * 0.3
            })
        });
        descText.alpha = 0.3;
        descText.position.set(width - 20, 20);
        descText.anchor.set(1, 0);
        if (showBackgroundMg) sceneBackgroundLayer.addChild(descText);
    }
    container.addChild(sceneBackgroundLayer);




    const fontFamily = resolveThemeFontStack(options.theme);
    const fontWeight = resolveThemeFontWeight(options.theme, 600);
    const shots = paragraph.shots.map((shot, shotIndex) => {
        const shotContainer = new Container();
        const compiledLines = shot.lineIndices
            .map(lineIndex => paragraph.lines.find(item => item.sourceIndex === lineIndex))
            .filter(Boolean) as SonnetParagraph['lines'];
        const linesSegments = compiledLines
            .map(line => line.segments.filter(segment => segment.text.length > 0))
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
            fontWeight,
        });
        const mgLayer = buildSonnetShotMg(
            pixi,
            shot.kind,
            options.theme,
            width,
            height,
            sceneSeed + shotIndex * 97,
            iconTextures
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
                    fontWeight,
                    theme: options.theme,
                    glowEnabled: postProcessProfile.glowStrength > 0,
                    guideLayer,
                    haloLayer,
                    textLayer,
                },
            ));
        });
        const bounds = shotContainer.getLocalBounds();
        if (shot.kind === 'mask-reveal') {
            const mask = new Graphics()
                .rect(bounds.x - 6, bounds.y - 6, bounds.width + 12, bounds.height + 12)
                .fill(0xffffff);
            shotContainer.addChild(mask);
            shotContainer.mask = mask;
        }
        
        // Ensure camera always focuses precisely on the hero word, regardless of how large or skewed the layout is
        const heroPlacement = placements.find(p => p.role === 'hero');
        const focusX = heroPlacement ? heroPlacement.x : (bounds.x + bounds.width / 2);
        const focusY = heroPlacement ? heroPlacement.y : (bounds.y + bounds.height / 2);
        
        shotContainer.pivot.set(focusX, focusY);
        shotContainer.position.set(
            width * (0.5 + shot.camera.x),
            height * (0.48 + shot.camera.y + (shotIndex % 2 ? 0.025 : -0.025)),
        );
        container.addChild(shotContainer);
        return {
            shot,
            container: shotContainer,
            segments: views,
            baseX: shotContainer.x,
            baseY: shotContainer.y,
            basePivotX: focusX,
            basePivotY: focusY,
            haloLayer,
            mgLayer,
            mgBackgroundLayer,
            mgGeoLayer,
            mgParticleLayer,
            mgFixedGeoLayer,
        };
    });


    if (!showOnlyText) {
        postProcessFilters.push(...applySonnetScenePostProcess(
            pixi,
            container,
            postProcessProfile,
            sceneSeed,
        ));
    }
    const transitionBlurFilter = options.tuning.enableTransitions && !options.staticMode
        ? new pixi.BlurFilter({ strength: 0, quality: 1, kernelSize: 5, resolution: 0.5 })
        : null;
    if (transitionBlurFilter) {
        transitionBlurFilter.enabled = false;
        container.filters = [...(container.filters ?? []), transitionBlurFilter];
        postProcessFilters.push(transitionBlurFilter);
    }
    const transitionGlitchEffect = options.tuning.enableTransitions && !options.staticMode
        ? createSonnetGlitchEffect(pixi)
        : null;
    if (transitionGlitchEffect) {
        container.filters = [...(container.filters ?? []), transitionGlitchEffect.filter];
        postProcessFilters.push(transitionGlitchEffect.filter);
    }
    container.visible = false;
    return {
        paragraph,
        container,
        shots,
        shotTimeline: shots.map(shot => shot.shot),
        postProcessFilters,
        transitionBlurFilter,
        transitionGlitchEffect,
        activeShotIndex: -1,
    };
};
