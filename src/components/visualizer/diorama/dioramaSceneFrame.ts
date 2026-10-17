import * as THREE from 'three';
import { DIORAMA_HERO_DISTANCE } from './cameraPath';
import { resolveGlobal, type SequencerState } from './dioramaSequencer';
import { type DioramaLineRaster } from './dioramaTextRaster';
import { DIORAMA_MOTE_LINES_AHEAD, DIORAMA_MOTE_LINES_BEHIND, dioramaMoteSlot, extendDioramaFrame, writeDioramaMoteLine } from './dioramaMoteField';
import {
    ACTIVE_LINE_OPACITY,
    LINE_FONT_SIZE,
    SOUL_ACTIVE_LIFT_EM,
    SOUL_ACTIVE_SWELL,
    SOUL_DETACH_LIFT_EM,
    SOUL_DETACH_SWELL,
    SOUL_HANDOFF_SECONDS,
    SOUL_MAX_OPACITY,
    UNIT_GLOW_MAX_OPACITY,
    UNSUNG_UNIT_OPACITY,
    clamp01,
    resolveNeighborLineOpacity,
    resolveOutgoingLineOpacity,
    smoothstep01,
    stepEnvelope,
} from './dioramaSceneConstants';
import { resolveDioramaUnitFill, resolveFrameFitScale, resolveGradientEnergy, resolveTextLife } from './dioramaSceneUnits';
import { type DampedThemeColors, type LyricUnit, type VisibleLineEntry } from './dioramaSceneTypes';

// src/components/visualizer/diorama/dioramaSceneFrame.ts
// 镜台场景每帧的写入（由 DioramaScene 的 useFrame 调用，不持有 React 状态）：背景尘埃窗口跟着读头回收，
// 邻行按英雄距离定尺寸并按距离 / 偏移定透明度与颜色，当前行逐单元的显现与三种跟唱效果。

// Gradient colour temporaries (no per-frame alloc), all derived live from the theme's damped colours
// so a manual/AI theme switch re-colours the gradient automatically. _sungTint = the theme accent,
// made hue-safe when the palette is degenerate (see useFrame); _gradDeep = a darker, HUE-PRESERVING
// version the sung glyphs are dyed toward; _neutral = scratch for building a neutral grey.
const _sungTint = new THREE.Color();
const _gradDeep = new THREE.Color();
const _neutral = new THREE.Color();

export interface DioramaMoteWindowInput {
    /** slot -> the line index currently written there; updated in place. */
    written: number[];
    motePositions: Float32Array;
    sequencer: SequencerState;
    globalIndex: number;
    total: number;
    moteCircumference: number;
    moteRadial: number;
    seed: string | number | undefined;
}

/**
 * Recycles the mote window onto the read head. Every line from -BEHIND to +AHEAD maps to its own
 * ring slot, so this is a no-op when the read head has not moved and rewrites exactly the lines that
 * entered the window when it has. Returns whether any slot was rewritten.
 */
export const recycleDioramaMoteWindow = ({
    written, motePositions, sequencer, globalIndex, total, moteCircumference, moteRadial, seed,
}: DioramaMoteWindowInput) => {
    const lastLine = Math.max(0, total - 1);
    let dirty = false;
    for (let line = globalIndex - DIORAMA_MOTE_LINES_BEHIND; line <= globalIndex + DIORAMA_MOTE_LINES_AHEAD; line += 1) {
        const slot = dioramaMoteSlot(line);
        if (written[slot] === line) continue;
        const anchorLine = Math.min(Math.max(line, 0), lastLine);
        const resolved = resolveGlobal(sequencer, anchorLine);
        if (!resolved) continue;
        writeDioramaMoteLine(
            motePositions,
            extendDioramaFrame(resolved.frame, line - anchorLine),
            line,
            moteCircumference,
            moteRadial,
            seed,
        );
        written[slot] = line;
        dirty = true;
    }
    return dirty;
};

export interface DioramaNeighborLinesInput {
    visibleLines: readonly VisibleLineEntry[];
    globalIndex: number;
    transitionOutgoingIndex: number | null;
    meshes: ReadonlyMap<number, THREE.Mesh>;
    materials: ReadonlyMap<number, THREE.MeshBasicMaterial>;
    rasters: ReadonlyMap<number, DioramaLineRaster>;
    camPos: THREE.Vector3;
    fov: number;
    aspect: number;
    lyricsFontScale: number;
    damped: DampedThemeColors;
}

/**
 * Fits each neighbour line to read well at the HERO distance (times its staging scale and the global
 * 字号 scale) - no billboarding, no live-distance rescale - and sets its opacity and tone.
 */
export const updateDioramaNeighborLines = ({
    visibleLines, globalIndex, transitionOutgoingIndex, meshes, materials, rasters, camPos, fov, aspect, lyricsFontScale, damped,
}: DioramaNeighborLinesInput) => {
    visibleLines.forEach(({ index, placement, isOutgoing }) => {
        if (index === globalIndex) return;
        const mesh = meshes.get(index);
        const mat = materials.get(index);
        const raster = rasters.get(index);
        if (!mesh || !mat || !raster) return;
        const worldWidth = raster.advancePx * (LINE_FONT_SIZE / raster.fontPx);
        const fit = resolveFrameFitScale(worldWidth, DIORAMA_HERO_DISTANCE, fov, aspect) * placement.scale * lyricsFontScale;
        mesh.scale.setScalar(fit);
        const life = resolveTextLife(mesh.position.distanceTo(camPos));
        if (isOutgoing) {
            // Departing corridor: a soft primary-toned cluster the camera is flying away from; `life`
            // fades it out as it recedes, the fog dresses the way down (see resolveOutgoingLineOpacity).
            mat.opacity = resolveOutgoingLineOpacity(index - (transitionOutgoingIndex ?? index)) * life;
            mat.color.copy(damped.primary);
        } else {
            const offset = index - globalIndex;
            mat.opacity = resolveNeighborLineOpacity(offset) * life;
            // Past (already-sung) lines glow in the primary/bright tone as a lit trail; upcoming lines
            // sit in the dim secondary tone, waiting in the dark.
            mat.color.copy(offset < 0 ? damped.primary : damped.secondary);
        }
    });
};

/** The active line's per-unit planes, filled by ref callbacks: base, additive glow, additive soul ghost. */
export interface DioramaUnitPlanes {
    baseMats: Array<THREE.MeshBasicMaterial | null>;
    glowMats: Array<THREE.MeshBasicMaterial | null>;
    glowMeshes: Array<THREE.Mesh | null>;
    soulMats: Array<THREE.MeshBasicMaterial | null>;
    soulMeshes: Array<THREE.Mesh | null>;
    /** Each unit's three planes, grouped so the beat hop (智能动感模式) moves them together; at rest otherwise. */
    unitGroups: Array<THREE.Group | null>;
}

export interface DioramaActiveUnitsInput {
    activeLineUnits: readonly LyricUnit[];
    planes: DioramaUnitPlanes;
    lightVals: Float32Array | null;
    soulVals: Float32Array | null;
    now: number;
    delta: number;
    life: number;
    breath: number;
    powerEnv: number;
    damped: DampedThemeColors;
    keywordUnitColors: ReadonlyMap<number, THREE.Color>;
    glowIntensity: number;
    soulIntensity: number;
    soulActiveEnabled: boolean;
    gradientIntensity: number;
}

/**
 * Per-unit reveal + the three INDEPENDENT follow-sing effects. The base reveal always runs; 普通辉光
 * lights the glow plane, 灵魂出窍 drives the ghost plane, 渐变 tints the base fill. Only material
 * colour/opacity and mesh transforms are written - nothing re-rasterises during a line.
 */
export const updateDioramaActiveUnits = ({
    activeLineUnits, planes, lightVals, soulVals, now, delta, life, breath, powerEnv, damped,
    keywordUnitColors, glowIntensity, soulIntensity, soulActiveEnabled, gradientIntensity,
}: DioramaActiveUnitsInput) => {
    // 渐变跟唱 strength tier. There is deliberately no line-level gate: each unit owns its own
    // wake (resolveGradientEnergy), so a line hands over to the next simply by its units running
    // out of wake, and nothing at line scope can re-tint a word that has already settled.
    const gradientStrength = Math.min(1.5, gradientIntensity);
    // Sung-tint axis for this frame, from the theme's damped colours: normally the accent as
    // is. When the palette is DEGENERATE (accent ~= primary - e.g. the built-in 墨染/素白
    // themes ship the SAME colour for both, so any accent<->primary blend is mathematically
    // invisible), the accent is blended toward a NEUTRAL grey offset in VALUE from the primary
    // (darker on light-text themes, brighter on dark-text). Neutral, never a hue: amplifying
    // the accent's sub-perceptual channel noise would tint a greyscale theme.
    const tintSeparation = Math.abs(damped.accent.r - damped.primary.r)
        + Math.abs(damped.accent.g - damped.primary.g)
        + Math.abs(damped.accent.b - damped.primary.b);
    _sungTint.copy(damped.accent);
    if (tintSeparation < 0.4) {
        const deficit = 1 - tintSeparation / 0.4;
        const primaryLum = (damped.primary.r + damped.primary.g + damped.primary.b) / 3;
        const accentLum = (damped.accent.r + damped.accent.g + damped.accent.b) / 3;
        const targetLum = primaryLum > 0.5 ? accentLum * (1 - 0.5 * deficit) : accentLum + (1 - accentLum) * 0.55 * deficit;
        _neutral.setRGB(targetLum, targetLum, targetLum);
        _sungTint.lerp(_neutral, deficit);
    }
    // The gradient's DEEP anchor: a darker, hue-PRESERVING (multiply, not HSL - HSL would
    // amplify channel noise into a fake hue) version of the sung-tint. The sung glyphs are
    // dyed from the plain primary toward this, so the wave carries a deep, saturated,
    // same-family colour that no palette washes out. The 强 tier makes the anchor deeper.
    const gradHot01 = Math.min(1, Math.max(0, (gradientStrength - 0.1) / 1.4));
    _gradDeep.copy(_sungTint).multiplyScalar(0.8 - 0.18 * gradHot01);

    activeLineUnits.forEach((unit, i) => {
        const baseMat = planes.baseMats[i];
        if (!baseMat || !lightVals || !soulVals) return;
        const isCurrent = now >= unit.startTime && now < unit.endTime;
        const sung = now >= unit.endTime;
        const span = Math.max(unit.endTime - unit.startTime, 0.001);
        const sungMix = sung ? 1 : isCurrent ? clamp01((now - unit.startTime) / span) : 0;

        // Shared sung-state envelope: swells fast while this unit is sung, trails off after.
        // It TIMES all three effects, but colour is written exactly once below.
        lightVals[i] = stepEnvelope(lightVals[i], isCurrent ? 1 : 0, 14, 4.5, delta);

        // 渐变跟唱 energy for this unit (its OWN follow-sing computation, alive with the other
        // two effects off): a bounded wake that peaks as the unit is sung and relaxes to zero
        // behind the singing - a wave travelling through the line, leaving each word back at its
        // base colour. Unsung glyphs are untouched (energy 0).
        const gradientEnergy = resolveGradientEnergy(now, unit) * gradientStrength;

        // BASE REVEAL (always on): dim while unsung, sweeping to full as the unit is sung.
        // The gradient effect adds a small opacity lift on top.
        baseMat.opacity = Math.min(
            1,
            (UNSUNG_UNIT_OPACITY + (ACTIVE_LINE_OPACITY - UNSUNG_UNIT_OPACITY) * sungMix + 0.08 * Math.min(1, gradientEnergy)) * life
        );

        // ---- UNIFIED sung-colour state: the fill colour is computed exactly ONCE ----
        // Glow and soul only READ this colour below (never re-dye), so stacking never double-
        // deepens or over-saturates - and it is what makes them follow a keyword's own colour
        // instead of glowing in the ordinary sung tint around AI-coloured glyphs.
        //
        // ONE base, ONE target, ONE interpolation driven by this unit's own sung progress:
        //   unsung -> exactly damped.primary       sung -> target       after -> back to primary
        // 关键字着色 changes only the TARGET. An AI keyword is a HIDDEN colour: it is not a
        // resting colour and must never appear before the singing arrives, or a line shows its
        // own answers ahead of itself. It emerges only as the unit is sung, everything else
        // dyes toward the same colour, and it decays back to the plain lyric colour behind the
        // singing. Ordinary units keep the shared sung tint as their target, exactly as before.
        const unitTarget = keywordUnitColors.get(i)
            ?? (gradientIntensity > 0 ? _gradDeep : _sungTint);
        // 渐变跟唱 times the dye when it is on (a pure, one-way function of this unit's own
        // start/end - so a keyword emerges, peaks and decays with the word itself, and a seek
        // or a loop recomputes it from the clock). Otherwise the shared baseline envelope does.
        const unitProgress = gradientIntensity > 0 ? gradientEnergy : lightVals[i] * 1.15;
        resolveDioramaUnitFill(baseMat.color, damped.primary, unitTarget, unitProgress);

        // 普通辉光 (visual layer only - reads the unified colour, never writes it): brightness
        // rides the shared envelope, breath and the music-power envelope AFTER smoothing.
        // CRITICAL: the glow plane NEVER scales or moves - a scaled/offset additive glyph
        // copy reads as a displaced ghost (that displacement IS the soul-drift mechanism,
        // owned by the soul plane below). The glow stays registered on the strokes.
        const glowStrength = Math.min(1.5, glowIntensity);
        const glowLevel = lightVals[i] * life * breath * (0.6 + 0.4 * powerEnv) * glowStrength;
        const glowMat = planes.glowMats[i];
        const glowMesh = planes.glowMeshes[i];
        if (glowMat) {
            glowMat.opacity = Math.min(1, UNIT_GLOW_MAX_OPACITY * glowLevel);
            glowMat.color.copy(baseMat.color);
        }
        if (glowMesh) {
            glowMesh.visible = glowLevel > 0.012;
        }

        // 灵魂出窍 (visual layer only - reads the unified colour as its energy tint): TWO disjoint
        // ghosts split by the glyph's PLAYBACK PHASE, read from the clock - NOT from the envelope
        // magnitude (that was the leak: a short/fast glyph never lets soulVals reach 1, so
        // `1-soulVals` fed the flight onto the glyph WHILE it was still being sung):
        //   while CURRENT (now in [start,end)) -> registered ghost ON the glyph, the reading-
        //     obstruction doubling            -> gated by the 当前字漂移 ON/OFF switch
        //   once FINISHED (now >= end)         -> flight ghost rising, swelling and fading away, the trail
        //     -> always on, at 灵魂出窍强度 (soulIntensity)
        // `flightMix` is exactly 0 for the WHOLE time the glyph is current (sung is false then) and
        // eases 0->1 over SOUL_HANDOFF_SECONDS after it finishes. 当前字漂移 is a plain on/off: ON lets
        // the CURRENT glyph drift at the SAME soulIntensity as the trail; OFF holds it registered and
        // clean (opacity/lift/swell all 0) until it finishes, while the trail still flies at full
        // strength. The mix is continuous from 0 at the hand-off so nothing pops when the singing steps
        // to the next glyph. soulVals stays the fade-in/out CHARGE (so the trail still fades as it
        // flies). With 当前字漂移 ON, opacity collapses to SOUL_MAX*life*soulVals - the old look.
        soulVals[i] = stepEnvelope(soulVals[i], isCurrent ? 1 : 0, 12, 2.2, delta);
        const soulMat = planes.soulMats[i];
        const soulMesh = planes.soulMeshes[i];
        if (soulMat && soulMesh) {
            const soulStrength = Math.min(1.5, soulIntensity);       // 灵魂出窍强度: drives both phases
            const flightMix = sung ? smoothstep01(clamp01((now - unit.endTime) / SOUL_HANDOFF_SECONDS)) : 0;
            // 当前字漂移 ON => the current glyph drifts at the same strength as everything else; OFF => 0.
            const activeReach = soulActiveEnabled ? soulStrength : 0;
            const onGlyph = (1 - flightMix) * activeReach;   // registered doubling, current glyph only
            const flown = flightMix * soulStrength;          // out-of-body flight, finished glyph only
            soulMat.color.copy(baseMat.color);
            soulMat.opacity = Math.min(1, SOUL_MAX_OPACITY * life * soulVals[i] * (onGlyph + flown));
            soulMesh.position.y = LINE_FONT_SIZE * (SOUL_ACTIVE_LIFT_EM * onGlyph + SOUL_DETACH_LIFT_EM * flown);
            const soulSwell = 1 + SOUL_ACTIVE_SWELL * onGlyph + SOUL_DETACH_SWELL * flown;
            soulMesh.scale.set(soulSwell, soulSwell, 1);
            soulMesh.visible = soulMat.opacity > 0.015;
        }
    });
};
