import type { MotionValue } from 'framer-motion';
import type { AudioBands, SonnetTuning, Theme } from '../../../types';
import {
    clamp01,
    easeSonnetInOut,
    resolveSegmentProgress,
    resolveSonnetAnimationScale,
    resolveSonnetBreathWeight,
    resolveSonnetCameraBreath,
    resolveSonnetFocusWeights,
    resolveSonnetSmoothedCameraFocus,
    resolveShotMotionFrame,
    resolveShotProgress,
    resolveTimelineShake,
} from './sonnetMotion';
import { hashSonnetSeed } from './sonnetRandom';
import type { ShotView } from './sonnetSceneBuilder';
import { isSonnetEmphasisRole } from './sonnetTypographyLayout';
import { resolveSonnetSegmentCameraFocus } from './sonnetCameraTracking';
import { applySonnetBeatFxLayers, restoreSonnetBeatFxLayers, type SonnetBeatFxFrame } from './sonnetBeatFx';

// src/components/visualizer/sonnet/sonnetShotFrame.ts
// 单个 shot 的逐帧姿态：镜头运动、间隙漂移与呼吸、逐段落焦点跟踪、MG / 引导线 / 开放画框时间，
// 以及逐字入场、视差、色差与回声。只按绝对播放时间和传入的设置写 view，不持有状态。

/** What a shot frame reads besides the view and the clock; all of it is read fresh every frame. */
export interface SonnetShotFrameContext {
    tuning: SonnetTuning;
    /** 智能动感模式 (`smartBeatActive`: on or cached), whether or not this track's beats are in yet. */
    smartBeatEnabled: boolean;
    theme: Theme;
    audioBands?: AudioBands;
    audioPower?: MotionValue<number>;
    /** Mod multiplier lookup; 1 when the key is absent. */
    mod: (key: string) => number;
    /** 智能动感模式 for this frame; null/absent unless it is on and the track's beats are installed. */
    beatFx?: SonnetBeatFxFrame | null;
}

/** Reads a mod modulation key, falling back to 1 so the frame is unchanged when absent. */
export const readSonnetModulation = (modulation: Record<string, number> | undefined, key: string): number => {
    const value = modulation?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : 1;
};

type ShotTracking = {
    trackSegments: ShotView['segments'];
    revealDoneTime: number;
    focusRanges: { startTime: number; endTime: number }[];
};

// The camera-tracked segments and their focus windows are fixed once a shot is built, so they
// are worked out on the shot's first frame and reused for the rest of its life.
const shotTrackingCache = new WeakMap<ShotView, ShotTracking>();

const resolveShotTracking = (view: ShotView): ShotTracking => {
    const cached = shotTrackingCache.get(view);
    if (cached) return cached;
    let trackSegments = view.segments.filter(s => s.role !== 'decoration' && s.trackingGlyphs.length > 0);
    if (trackSegments.length === 0) {
        trackSegments = view.segments.filter(s => s.trackingGlyphs.length > 0);
    }
    const revealDoneTime = trackSegments.length > 0
        ? Math.max(...trackSegments.map(segment => segment.trackingGlyphs.at(-1)?.startTime ?? view.shot.endTime))
        : view.shot.endTime;
    const focusRanges = trackSegments.map(segment => ({
        startTime: segment.trackingGlyphs[0]?.startTime ?? view.shot.startTime,
        endTime: segment.trackingGlyphs.at(-1)?.startTime ?? view.shot.endTime,
    }));
    const tracking = { trackSegments, revealDoneTime, focusRanges };
    shotTrackingCache.set(view, tracking);
    return tracking;
};

export const updateSonnetShot = (
    view: ShotView,
    time: number,
    width: number,
    height: number,
    shakeIntensity: number,
    { tuning, smartBeatEnabled, theme, audioBands, audioPower: audioPowerValue, mod, beatFx }: SonnetShotFrameContext,
) => {
    const progress = resolveShotProgress(view.shot, time);
    const motion = tuning.typographyMotion * resolveSonnetAnimationScale(theme) * mod('motionScale');
    const camera = tuning.cameraIntensity * resolveSonnetAnimationScale(theme) * mod('cameraScale');
    const cameraFrame = resolveShotMotionFrame(view.shot.kind, progress);

    // Add a slow continuous pan during the time gap to prevent the scene from looking frozen
    const gapTime = Math.max(0, time - view.shot.endTime);
    if (gapTime > 0) {
        // Inherit the movement direction from the tail end of the shot (progress 0.8 to 1.0)
        const tailStart = resolveShotMotionFrame(view.shot.kind, 0.8);
        const dx = cameraFrame.x - tailStart.x;
        const dy = cameraFrame.y - tailStart.y;
        const dScale = cameraFrame.scale - tailStart.scale;
        const dRot = cameraFrame.rotation - tailStart.rotation;

        // Continue drifting in that direction at a slow, relaxed PV pace
        // speed = 0.8 means it takes 1.25 seconds of gap to drift the same distance 
        // the camera covered in the last 20% of the shot.
        const maxDrift = 2.0;
        const driftSpeed = (1 - Math.exp(-gapTime * 0.4)) * maxDrift * mod('driftScale');
        cameraFrame.x += dx * driftSpeed;
        cameraFrame.y += dy * driftSpeed;
        cameraFrame.scale += dScale * driftSpeed;
        cameraFrame.rotation += dRot * driftSpeed;
    }

    const shake = resolveTimelineShake(time, shakeIntensity);

    const { trackSegments, revealDoneTime, focusRanges } = resolveShotTracking(view);

    // Layer a deterministic breathing float once the lyric reveal completes, so the
    // frame never goes fully static while the shot holds or drifts through a gap.
    const breathWeight = resolveSonnetBreathWeight(time, revealDoneTime);
    if (breathWeight > 0) {
        const breathPhase = (hashSonnetSeed(view.shot.id) % 1024) / 1024 * Math.PI * 2;
        const breath = resolveSonnetCameraBreath(time, breathPhase);
        const breathScale = mod('breathScale');
        cameraFrame.x += breath.x * breathWeight * breathScale;
        cameraFrame.y += breath.y * breathWeight * breathScale;
        cameraFrame.scale += breath.scale * breathWeight * breathScale;
        cameraFrame.rotation += breath.rotation * breathWeight * breathScale;
    }

    let currentFocusX = view.basePivotX;
    let currentFocusY = view.basePivotY;

    if (trackSegments.length > 0) {
        const resolveFocusAtTime = (focusTime: number) => {
            let focusX = 0;
            let focusY = 0;
            const focusWeights = resolveSonnetFocusWeights(focusRanges, focusTime);
            for (let i = 0; i < trackSegments.length; i++) {
                const seg = trackSegments[i];
                if (seg.trackingGlyphs.length === 0) continue;
                const weight = focusWeights[i] ?? 0;
                const pos = resolveSonnetSegmentCameraFocus(seg.trackingGlyphs, focusTime);
                focusX += pos.x * weight;
                focusY += pos.y * weight;
            }
            return { x: focusX, y: focusY };
        };
        const focusTime = Math.max(view.shot.startTime, Math.min(time, view.shot.endTime));
        const smoothedFocus = resolveSonnetSmoothedCameraFocus(
            focusTime,
            view.shot.startTime,
            view.shot.endTime,
            resolveFocusAtTime,
        );

        currentFocusX = smoothedFocus.x;
        currentFocusY = smoothedFocus.y;
    }

    view.container.pivot.set(
        view.basePivotX + (currentFocusX - view.basePivotX) * camera,
        view.basePivotY + (currentFocusY - view.basePivotY) * camera
    );

    view.container.scale.set(
        view.shot.camera.zoom
        * (1 + (cameraFrame.scale - 1) * camera),
    );
    view.container.rotation = (
        view.shot.camera.rotation + cameraFrame.rotation + shake.rotation
    ) * camera;
    view.container.x = view.baseX + (cameraFrame.x * width + shake.x * width) * camera;
    view.container.y = view.baseY + (cameraFrame.y * height + shake.y * height) * camera;

    if (beatFx) {
        // Beat punch on top of the tracked camera: zooms about the focus pivot, tilt alternates.
        // The frame overlay is a stage sibling of the scenes, so it never moves with this.
        view.container.scale.set(view.container.scale.x * beatFx.zoom);
        view.container.rotation += beatFx.rotation;
        applySonnetBeatFxLayers(view, beatFx);
    } else if (smartBeatEnabled) {
        // On, but no beats for this track (yet): the original frame, including what an earlier
        // beat FX frame - the previous track's - left on these layers.
        restoreSonnetBeatFxLayers(view);
    }

    if (view.mgParticleLayer) {
        // Create a slight time-difference/parallax effect for decorative elements
        const particleParallaxX = (cameraFrame.x * width + shake.x * width) * camera * 0.4 * mod('parallaxScale');
        const particleParallaxY = (cameraFrame.y * height + shake.y * height) * camera * 0.4 * mod('parallaxScale');
        view.mgParticleLayer.position.set(particleParallaxX, particleParallaxY);
        
        // Continuous independent rotation based on shot time
        view.mgParticleLayer.rotation = (time - view.shot.startTime) * 0.05 * mod('mgSwimScale');
        // Slower scale response creates depth illusion
        view.mgParticleLayer.scale.set(1 + (cameraFrame.scale - 1) * 0.3);
    }
    
    if (view.mgFixedGeoLayer) {
        // Keep fixed geometry upright regardless of camera rotation
        view.mgFixedGeoLayer.rotation = -view.container.rotation;
    }

    const audioBass = audioBands?.bass?.get() ?? 0;
    const audioPower = audioPowerValue?.get() ?? 0;
    const audioVocal = audioBands?.vocal?.get() ?? 0;

    if ((view.mgLayer as any).updateTime) {
        (view.mgLayer as any).updateTime(
            time,
            view.shot.cues,
            view.shot.startTime,
            view.shot.endTime,
            audioBass,
            audioPower,
            audioVocal,
        );
    }

    view.segments.forEach(segmentView => {
        const guide = segmentView.guide;
        const guideActive = time >= guide.startTime && time <= guide.endTime;
        guide.container.visible = guideActive && tuning.showGuide && !tuning.showOnlyText;
        if (guideActive) {
            const guideProgress = clamp01(
                (time - guide.startTime) / Math.max(0.001, guide.endTime - guide.startTime),
            );
            if ((guide as any).update) {
                guide.container.alpha = guide.maxAlpha;
                (guide as any).update(guideProgress);
            } else {
                const eased = easeSonnetInOut(guideProgress);
                guide.container.alpha = Math.sin(eased * Math.PI) * guide.maxAlpha;
                guide.container.scale.set(0.76 + eased * 0.24);
            }
        }

        // Decorative open frames share the 文字浮标 (showFixedGeo) toggle.
        const frameDecor = segmentView.frameDecor;
        if (frameDecor) {
            const frameVisible = tuning.showFixedGeo && !tuning.showOnlyText;
            frameDecor.container.visible = frameVisible;
            if (frameVisible) {
                frameDecor.update(clamp01(
                    (time - frameDecor.startTime) / Math.max(0.001, frameDecor.endTime - frameDecor.startTime),
                ));
            }
        }

        segmentView.glyphs.forEach(glyph => {
            const glyphProgress = resolveSegmentProgress(
                glyph.startTime,
                glyph.settleTime,
                time,
            );
            const waiting = time < glyph.startTime;
            const offset = (1 - glyphProgress) * motion;
            const coreAlpha = waiting ? 0 : 0.16 + glyphProgress * 0.84;
            const haloAlpha = waiting ? 0 : 1 - glyphProgress * 0.28;
            const scale = isSonnetEmphasisRole(segmentView.role) && view.shot.kind === 'type-impact'
                ? 0.52 + glyphProgress * 0.48
                : 0.86 + glyphProgress * 0.14;
            const x = glyph.baseX + glyph.enterX * offset;
            const y = glyph.baseY + glyph.enterY * offset;
            const rotation = glyph.finalRotation + glyph.entryRotation * offset;
            const isGiantDecorativeText = segmentView.role === 'decoration';
            const showTextGlyph = glyph.isTextGlyph !== false;
            const glyphVisible = tuning.showOnlyText
                ? showTextGlyph && (!isGiantDecorativeText || tuning.showGiantDecorativeText)
                : (!glyph.isBackgroundShape || tuning.showBackgroundDecor)
                    && (!isGiantDecorativeText || tuning.showGiantDecorativeText);

            // Simulated Parallax 3D effect
            const depth = glyph.zDepth || 0;
            const parallaxScale = mod('parallaxScale');
            // Move faster/slower than camera
            const parallaxX = (cameraFrame.x * width + shake.x * width) * camera * depth * 2.5 * parallaxScale;
            const parallaxY = (cameraFrame.y * height + shake.y * height) * camera * depth * 2.5 * parallaxScale;
            // Scale larger if closer to camera (positive depth)
            const depthScale = 1 + depth * 0.45 * parallaxScale;

            glyph.display.alpha = coreAlpha;
            glyph.display.visible = glyphVisible;
            glyph.display.scale.set(scale * depthScale);
            glyph.display.position.set(x + parallaxX, y + parallaxY);
            glyph.display.rotation = rotation;
            if (glyph.halo) {
                glyph.halo.alpha = haloAlpha;
                glyph.halo.scale.set(scale * (1.08 - glyphProgress * 0.08));
                glyph.halo.position.set(x, y);
                glyph.halo.rotation = rotation;
            }

            // Animate Chromatic Aberration separation and merging
            if (glyph.caWrapper && glyph.caCyan && glyph.caRed && glyph.caOffset) {
                const ca = glyph.caWrapper;
                ca.visible = glyphVisible && !tuning.showOnlyText;
                ca.alpha = coreAlpha;
                ca.scale.copyFrom(glyph.display.scale);
                ca.position.copyFrom(glyph.display.position);
                ca.rotation = rotation;
                // Starts separated (impact), and gently merges to a very subtle base offset
                const mergeEased = easeSonnetInOut(glyphProgress);
                const currentOffset = glyph.caOffset * (1 - mergeEased * 0.8) * mod('caScale'); // 1.0 -> 0.2

                glyph.caCyan.position.set(-currentOffset, currentOffset * 0.5);
                glyph.caRed.position.set(currentOffset, -currentOffset * 0.5);
            }

            // Semi-hero echo ghosts: split along the layout normal on glyph entry,
            // fade in over the first quarter, then quickly vanish. One-shot.
            if (glyph.ghosts && glyph.ghostDuration) {
                const ghostProgress = clamp01((time - glyph.startTime) / glyph.ghostDuration);
                const ghostActive = glyphVisible && ghostProgress > 0 && ghostProgress < 1;
                // Quick fade-in, then a squared falloff so the echo dies fast.
                const envelope = ghostProgress <= 0.2
                    ? ghostProgress / 0.2
                    : Math.pow(1 - (ghostProgress - 0.2) / 0.8, 2);
                const spread = (1 - Math.pow(1 - ghostProgress, 3)) * mod('ghostScale');
                for (const ghost of glyph.ghosts) {
                    ghost.node.visible = ghostActive;
                    if (!ghostActive) continue;
                    ghost.node.position.set(ghost.dirX * spread, ghost.dirY * spread);
                    ghost.node.alpha = envelope * ghost.alphaBase;
                }
            }

            glyph.updateAnimation?.(time);
        });
    });
};
