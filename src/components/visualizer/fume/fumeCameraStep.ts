import type { Theme } from '../../../types';
import type { FumeBackgroundScene } from './FumeBackground';
import type { CameraRetargetState, CameraTarget, CameraViewTarget, FumeArticleLayout, ViewportSize } from './fumeTypes';
import { clamp, easeInOutCubic, easeOutCubic, mix, quadraticBezier } from './fumeMath';
import { resolvePrintedGraphemeCount, resolvePrintedGraphemeProgress } from './fumeReveal';
import { CAMERA_SCALE_MAX, CAMERA_SCALE_MIN, OVERVIEW_CAMERA_SOURCE, resolveBlockEntryFocusPoint, resolveCameraRetargetDuration, resolveCameraScaleForBlock, resolveFocusBlock, resolveOverviewFlightBridge, resolveOverviewRetargetDuration, resolveSmoothBlockFocusPoint, resolveSteppedBlockFocusPoint } from './fumeCamera';

// src/components/visualizer/fume/fumeCameraStep.ts
// The fume camera's per-frame motion, independent of the renderer: pick the target (focus block, the
// overview shot, or the page centre), add the idle float, then either fly the retarget bridge or run the
// spring towards it. Mutates `FumeCameraState` in place, once per frame.

export interface FumeCameraState {
    camera: CameraTarget;
    retarget: CameraRetargetState;
    initialized: boolean;
}

export const createFumeCameraState = (): FumeCameraState => ({
    initialized: false,
    retarget: {
        sourceLineIndex: -1,
        startedAt: 0,
        duration: 0.18,
        fromX: 0,
        fromY: 0,
        fromScale: 1,
        bridgeMode: 'none',
        bridgeWaypointX: 0,
        bridgeWaypointY: 0,
        bridgeWaypointScale: 1,
        bridgeWaypointPhase: 0.36,
    },
    camera: {
        x: 0,
        y: 0,
        velocityX: 0,
        velocityY: 0,
        focusX: 0,
        focusY: 0,
        scale: 1,
        velocityScale: 0,
        focusScale: 1,
    },
});

/** Places a fresh camera on a new article, or keeps a running one inside the article's bounds. */
export const syncFumeCameraToArticle = (state: FumeCameraState, article: FumeArticleLayout | null) => {
    if (article && !state.initialized) {
        state.camera = {
            x: article.width * 0.5,
            y: article.height * 0.5,
            velocityX: 0,
            velocityY: 0,
            focusX: article.width * 0.5,
            focusY: article.height * 0.5,
            scale: 1.18,
            velocityScale: 0,
            focusScale: 1.18,
        };
        state.initialized = true;
    } else if (article) {
        state.camera.x = clamp(state.camera.x, 0, article.width);
        state.camera.y = clamp(state.camera.y, 0, article.height);
        state.camera.focusX = clamp(state.camera.focusX, 0, article.width);
        state.camera.focusY = clamp(state.camera.focusY, 0, article.height);
        state.camera.scale = clamp(state.camera.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX);
        state.camera.focusScale = clamp(state.camera.focusScale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX);
    } else {
        state.initialized = false;
    }
};

export interface FumeCameraStepInput {
    article: FumeArticleLayout;
    /** Playback time, seconds. */
    time: number;
    /** Wall clock, milliseconds (drives the idle float). */
    now: number;
    /** Frame time, seconds. */
    dt: number;
    lineIndex: number;
    viewport: ViewportSize;
    overviewCamera: CameraViewTarget | null;
    overviewStartTime: number;
    cameraSpeed: number;
    cameraTrackingMode: 'stepped' | 'smooth';
    staticMode: boolean;
    animationIntensity: Theme['animationIntensity'];
}

export interface FumeCameraStepResult {
    shouldShowOverview: boolean;
    /** 0..1 while the overview shot flies in: passed text restores its standard style. */
    overviewTextRestoreProgress: number;
}

export const stepFumeCamera = (state: FumeCameraState, input: FumeCameraStepInput): FumeCameraStepResult => {
    const {
        article, time, now, dt, lineIndex, viewport, overviewCamera, overviewStartTime,
        cameraSpeed, cameraTrackingMode, staticMode, animationIntensity,
    } = input;
    const focusBlock = resolveFocusBlock(article, lineIndex, time);
    const shouldShowOverview = overviewCamera !== null && time >= overviewStartTime;
    let targetCameraX = article.width * 0.5;
    let targetCameraY = article.height * 0.5;
    let targetCameraScale = 1.18;
    let entryFocusPoint: { x: number; y: number; } | null = null;
    let didRetargetThisFrame = false;

    if (shouldShowOverview && overviewCamera) {
        targetCameraX = overviewCamera.x;
        targetCameraY = overviewCamera.y;
        targetCameraScale = overviewCamera.scale;

        if (state.retarget.sourceLineIndex !== OVERVIEW_CAMERA_SOURCE) {
            state.retarget = {
                sourceLineIndex: OVERVIEW_CAMERA_SOURCE,
                startedAt: time,
                duration: clamp(resolveOverviewRetargetDuration(viewport) / cameraSpeed, 0.12, 1.2),
                fromX: state.camera.x,
                fromY: state.camera.y,
                fromScale: state.camera.scale,
                bridgeMode: 'none',
                bridgeWaypointX: 0,
                bridgeWaypointY: 0,
                bridgeWaypointScale: 1,
                bridgeWaypointPhase: 0.36,
            };
            didRetargetThisFrame = true;
        }
    } else if (focusBlock) {
        const focusPoint = cameraTrackingMode === 'stepped'
            ? resolveSteppedBlockFocusPoint(
                focusBlock,
                resolvePrintedGraphemeCount(
                    focusBlock.line,
                    focusBlock.wordRanges,
                    focusBlock.graphemes.length,
                    time,
                ),
            )
            : resolveSmoothBlockFocusPoint(
                focusBlock,
                resolvePrintedGraphemeProgress(
                    focusBlock.line,
                    focusBlock.wordRanges,
                    focusBlock.graphemes.length,
                    time,
                ),
            );
        entryFocusPoint = resolveBlockEntryFocusPoint(focusBlock);
        targetCameraX = focusPoint.x;
        targetCameraY = focusPoint.y;
        targetCameraScale = resolveCameraScaleForBlock(focusBlock, viewport);

        if (state.retarget.sourceLineIndex !== focusBlock.sourceLineIndex) {
            state.retarget = {
                sourceLineIndex: focusBlock.sourceLineIndex,
                startedAt: time,
                duration: clamp(resolveCameraRetargetDuration(focusBlock.line) / cameraSpeed, 0.03, 0.3),
                fromX: state.camera.x,
                fromY: state.camera.y,
                fromScale: state.camera.scale,
                bridgeMode: 'none',
                bridgeWaypointX: 0,
                bridgeWaypointY: 0,
                bridgeWaypointScale: 1,
                bridgeWaypointPhase: 0.36,
            };
            didRetargetThisFrame = true;
        }
    } else if (state.retarget.sourceLineIndex !== -1) {
        state.retarget = {
            sourceLineIndex: -1,
            startedAt: time,
            duration: clamp(0.18 / cameraSpeed, 0.05, 0.4),
            fromX: state.camera.x,
            fromY: state.camera.y,
            fromScale: state.camera.scale,
            bridgeMode: 'none',
            bridgeWaypointX: 0,
            bridgeWaypointY: 0,
            bridgeWaypointScale: 1,
            bridgeWaypointPhase: 0.36,
        };
        didRetargetThisFrame = true;
    }

    const retargetElapsed = Math.max(time - state.retarget.startedAt, 0);
    const overviewTextRestoreProgress = shouldShowOverview && state.retarget.sourceLineIndex === OVERVIEW_CAMERA_SOURCE
        ? easeInOutCubic(clamp(
            retargetElapsed / Math.max(state.retarget.duration, 0.001),
            0,
            1,
        ))
        : 0;
    const retargetPhase = clamp(
        retargetElapsed / Math.max(state.retarget.duration, 0.001),
        0,
        1,
    );
    const retargetBoost = 1 - easeOutCubic(retargetPhase);
    const entryFocusBias = Math.pow(retargetBoost, 0.58);

    if (entryFocusPoint) {
        targetCameraX = mix(targetCameraX, entryFocusPoint.x, entryFocusBias);
        targetCameraY = mix(targetCameraY, entryFocusPoint.y, entryFocusBias);
    }

    if (!staticMode) {
        const floatConfig = animationIntensity === 'chaotic'
            ? { distance: 24, duration: 5.8, scaleAmplitude: 0.014 }
            : animationIntensity === 'calm'
                ? { distance: 14, duration: 8.5, scaleAmplitude: 0.008 }
                : { distance: 18, duration: 7, scaleAmplitude: 0.011 };
        const floatPhase = (now / 1000 / floatConfig.duration) * Math.PI * 2;
        const overviewAttenuation = shouldShowOverview ? 0.36 : 1;
        const screenFloatX = Math.sin(floatPhase * 0.74 + 0.8) * floatConfig.distance * 0.34;
        const screenFloatY = (
            Math.sin(floatPhase) * floatConfig.distance
            + Math.sin(floatPhase * 0.5 + 1.1) * floatConfig.distance * 0.22
        ) * overviewAttenuation;
        const worldFloatDivisor = Math.max(targetCameraScale, 0.001);

        targetCameraX -= screenFloatX / worldFloatDivisor;
        targetCameraY -= screenFloatY / worldFloatDivisor;
        targetCameraScale = clamp(
            targetCameraScale * (1 + Math.sin(floatPhase + 0.9) * floatConfig.scaleAmplitude * overviewAttenuation),
            CAMERA_SCALE_MIN,
            CAMERA_SCALE_MAX,
        );
    }

    if (didRetargetThisFrame) {
        const bridgeScale = Math.max(state.camera.scale, targetCameraScale, 0.001);
        const screenDeltaX = Math.abs(targetCameraX - state.retarget.fromX) * bridgeScale;
        const screenDeltaY = Math.abs(targetCameraY - state.retarget.fromY) * bridgeScale;
        const screenDistance = Math.hypot(screenDeltaX, screenDeltaY);
        state.retarget.bridgeMode = screenDistance >= Math.min(viewport.width, viewport.height) * 0.42
            ? 'direct'
            : 'none';
        state.retarget.bridgeWaypointX = targetCameraX;
        state.retarget.bridgeWaypointY = targetCameraY;
        state.retarget.bridgeWaypointScale = targetCameraScale;
        state.retarget.bridgeWaypointPhase = 0.5;

        if (state.retarget.sourceLineIndex >= 0) {
            const overviewFlightBridge = resolveOverviewFlightBridge({
                fromX: state.retarget.fromX,
                fromY: state.retarget.fromY,
                fromScale: state.retarget.fromScale,
                targetX: targetCameraX,
                targetY: targetCameraY,
                targetScale: targetCameraScale,
                overviewCamera,
                viewport,
            });

            if (overviewFlightBridge) {
                state.retarget.bridgeMode = 'overview';
                state.retarget.bridgeWaypointX = overviewFlightBridge.waypointX;
                state.retarget.bridgeWaypointY = overviewFlightBridge.waypointY;
                state.retarget.bridgeWaypointScale = overviewFlightBridge.waypointScale;
                state.retarget.bridgeWaypointPhase = overviewFlightBridge.waypointPhase;
                state.retarget.duration = Math.max(
                    state.retarget.duration,
                    clamp(overviewFlightBridge.duration / cameraSpeed, 0.16, 0.9),
                );
            }
        }
    }

    const cameraDistance = Math.hypot(
        targetCameraX - state.camera.x,
        targetCameraY - state.camera.y,
    );
    const shouldUseBridge = state.retarget.bridgeMode !== 'none' && retargetPhase < 1;

    if (shouldUseBridge) {
        let bridgedCameraX = targetCameraX;
        let bridgedCameraY = targetCameraY;
        let bridgedCameraScale = targetCameraScale;

        if (state.retarget.bridgeMode === 'overview') {
            const bridgePhase = easeOutCubic(retargetPhase);
            bridgedCameraX = quadraticBezier(
                state.retarget.fromX,
                state.retarget.bridgeWaypointX,
                targetCameraX,
                bridgePhase,
            );
            bridgedCameraY = quadraticBezier(
                state.retarget.fromY,
                state.retarget.bridgeWaypointY,
                targetCameraY,
                bridgePhase,
            );
            bridgedCameraScale = quadraticBezier(
                state.retarget.fromScale,
                state.retarget.bridgeWaypointScale,
                targetCameraScale,
                bridgePhase,
            );
        } else {
            const bridgePhase = easeInOutCubic(retargetPhase);
            bridgedCameraX = mix(state.retarget.fromX, targetCameraX, bridgePhase);
            bridgedCameraY = mix(state.retarget.fromY, targetCameraY, bridgePhase);
            bridgedCameraScale = mix(state.retarget.fromScale, targetCameraScale, bridgePhase);
        }

        const bridgeCatchUp = 1 - Math.exp(-dt * (
            state.retarget.bridgeMode === 'overview'
                ? mix(12.5, 22, 1 - retargetPhase)
                : mix(10.5, 17.5, 1 - retargetPhase)
        ));

        state.camera.focusX = bridgedCameraX;
        state.camera.focusY = bridgedCameraY;
        state.camera.focusScale = bridgedCameraScale;
        state.camera.x += (bridgedCameraX - state.camera.x) * bridgeCatchUp;
        state.camera.y += (bridgedCameraY - state.camera.y) * bridgeCatchUp;
        state.camera.scale += (bridgedCameraScale - state.camera.scale) * bridgeCatchUp;
        state.camera.scale = clamp(state.camera.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX);
        state.camera.velocityX *= 0.72;
        state.camera.velocityY *= 0.72;
        state.camera.velocityScale *= 0.68;
    } else {
        const boostedCatchUpRate = clamp(
            4.8 / Math.max(state.retarget.duration, 0.05),
            20,
            54,
        );
        const targetCatchUp = 1 - Math.exp(-dt * mix(11.2, boostedCatchUpRate, retargetBoost));
        state.camera.focusX += (targetCameraX - state.camera.focusX) * targetCatchUp;
        state.camera.focusY += (targetCameraY - state.camera.focusY) * targetCatchUp;
        state.camera.focusScale += (targetCameraScale - state.camera.focusScale)
            * (1 - Math.exp(-dt * mix(5.4, 12.8, retargetBoost)));

        const springStrength = mix(
            208,
            clamp(15.8 / Math.max(state.retarget.duration * state.retarget.duration, 0.0064), 260, 780),
            retargetBoost,
        );
        const damping = mix(
            24,
            clamp(Math.sqrt(springStrength) * 1.36, 24, 40),
            retargetBoost,
        );
        const accelX = (state.camera.focusX - state.camera.x) * springStrength - state.camera.velocityX * damping;
        const accelY = (state.camera.focusY - state.camera.y) * springStrength - state.camera.velocityY * damping;
        state.camera.velocityX += accelX * dt;
        state.camera.velocityY += accelY * dt;
        const maxVelocity = mix(
            1320,
            clamp(cameraDistance / Math.max(state.retarget.duration * 0.28, 0.028), 2600, 8800),
            retargetBoost,
        );
        state.camera.velocityX = clamp(state.camera.velocityX, -maxVelocity, maxVelocity);
        state.camera.velocityY = clamp(state.camera.velocityY, -maxVelocity, maxVelocity);
        state.camera.x += state.camera.velocityX * dt;
        state.camera.y += state.camera.velocityY * dt;

        const scaleSpringStrength = mix(54, 108, retargetBoost);
        const scaleDamping = mix(13.5, 21, retargetBoost);
        const accelScale = (state.camera.focusScale - state.camera.scale) * scaleSpringStrength
            - state.camera.velocityScale * scaleDamping;
        state.camera.velocityScale += accelScale * dt;
        state.camera.velocityScale = clamp(state.camera.velocityScale, -1.6, 1.6);
        state.camera.scale += state.camera.velocityScale * dt;
        state.camera.scale = clamp(state.camera.scale, CAMERA_SCALE_MIN, CAMERA_SCALE_MAX);
    }

    return { shouldShowOverview, overviewTextRestoreProgress };
};

const FUME_BACKGROUND_PARALLAX_X = 0.9;
const FUME_BACKGROUND_PARALLAX_Y = 0.74;
const FUME_BACKGROUND_SCALE_FACTOR = 0.94;
const FUME_BACKGROUND_VERTICAL_OFFSET_RATIO = 0.22;

/** Where the background layer looks: it trails the camera (parallax), sits a little lower, zooms less. */
export const resolveFumeBackgroundView = (
    backgroundScene: Pick<FumeBackgroundScene, 'width' | 'height'>,
    camera: CameraTarget,
    viewport: ViewportSize,
) => {
    const screenScale = camera.scale;
    const backgroundCenterX = backgroundScene.width * 0.5;
    const backgroundCenterY = backgroundScene.height * 0.5;
    const backgroundVerticalOffset = clamp(
        viewport.height * FUME_BACKGROUND_VERTICAL_OFFSET_RATIO / Math.max(screenScale, 0.001),
        48,
        180,
    );
    const backgroundCameraX = mix(
        backgroundCenterX,
        camera.x,
        FUME_BACKGROUND_PARALLAX_X,
    );
    const backgroundCameraY = mix(
        backgroundCenterY,
        camera.y,
        FUME_BACKGROUND_PARALLAX_Y,
    ) - backgroundVerticalOffset;
    const backgroundScale = clamp(
        screenScale * FUME_BACKGROUND_SCALE_FACTOR,
        CAMERA_SCALE_MIN,
        CAMERA_SCALE_MAX,
    );
    return { backgroundCenterX, backgroundCenterY, backgroundCameraX, backgroundCameraY, backgroundScale };
};
