import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type AudioBands, type DioramaGeometryVisibility, type Line, type Theme } from '../../../types';
import { buildLineGraphemeTimeline, splitLyricGraphemes, type GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { prepareDioramaKeywordMatchers, resolveDioramaKeywordUnitColors } from './dioramaKeywordColor';
import {
    buildFormation,
    DIORAMA_HERO_DISTANCE,
    getFrame,
    type DioramaFrame,
    type DioramaMotionParams,
    type DioramaTextPlacement,
    getDioramaShot,
    getDioramaTextPlacement,
} from './cameraPath';
import { resolveGlobal, type SequencerState, totalGlobalLines } from './dioramaSequencer';
import {
    DIORAMA_CLUSTER_COLLISION_LINE_SPAN,
    selectVisibleDioramaClusters,
    type DioramaParticleClusterAnchor,
} from './dioramaGeometry';
import {
    buildDioramaFontSpec,
    DIORAMA_RASTER_FONT_PX,
    type DioramaLineRaster,
    measureDioramaText,
    rasterDioramaLine,
    rasterDioramaUnit,
    type DioramaUnitRaster,
} from './dioramaTextRaster';
import { DioramaParticleField } from './DioramaParticleField';
import { buildDioramaParticleCorridorWindow } from './dioramaParticleCorridor';
import {
    DIORAMA_MOTE_LINES_AHEAD,
    DIORAMA_MOTE_LINES_BEHIND,
    DIORAMA_MOTE_WINDOW_LINES,
    dioramaMoteSlot,
    extendDioramaFrame,
    resolveDioramaMoteCircumference,
    resolveDioramaMoteRadial,
    writeDioramaMoteLine,
} from './dioramaMoteField';

// src/components/visualizer/diorama/DioramaScene.tsx
// Renders the lyric corridor along the winding path. Each nearby lyric line is staged on its path
// frame (per-line offset, scale, roll, yaw), plus a per-line procedural geometry formation matched to
// that line's camera move. Text, camera and geometry all read from the same shared `frames` +
// placements, so everything stays consistent as the path bends. Formation anchors render as a single
// self-lit point-cloud field; camera, text and transition logic remain independent from audio.
//
// TEXT is canvas-rasterised (see dioramaTextRaster.ts for why not SDF): the browser's own text engine
// draws every glyph - perfect stroke continuity for every script and the full shared subtitle font
// stack (theme style, weight, uploaded custom font, fallback). The ACTIVE line renders as INDIVIDUAL
// units (every CJK char / latin word its own plane), laid out by measuring the full line so kerning
// is preserved; behind each unit sits an additive plane holding the cadenza (心象) glow raster of the
// SAME glyph - registration is exact by construction. 辉光跟唱 follows the classic reveal model: the
// sung unit turns accent-coloured and lit, finished units return to plain bright, unsung units wait
// dim; each unit's light swells/decays on its own smoothed envelope, breathing with the music.
//
// The music is expressed HERE, in the world - never in the camera: bass accelerates the point-cloud
// flow while treble increases curl disturbance and sparkle. Particle clouds AND text live a
// distance-based LIFECYCLE: born
// from the far haze (no pop-in) and dissolving gracefully when the camera closes in. Theme colours
// are DAMPED per-frame (fog, lights, materials), so theme/AI theme changes and song switches glide
// instead of snapping. All per-frame values are refs inside useFrame - never React state.
interface DioramaSceneProps {
    theme: Theme;
    // The continuous-tunnel sequencer + the sticky GLOBAL line index. The scene resolves each global
    // index in the mounted window to its segment/local line/world frame, so the window can straddle a
    // graft joint: the outgoing song's tail lines recede/dissolve behind while the incoming song's head
    // lines are born from the far haze ahead - the transition, performed in-world with no overlay.
    sequencer: SequencerState;
    globalIndex: number;
    // During a transition, the global index of the line the camera is LEAVING. The scene mounts a second
    // window around it so the outgoing corridor recedes on-screen instead of vanishing. Null when idle.
    transitionOutgoingIndex: number | null;
    currentTime: MotionValue<number>;
    // Written each frame with the active line's measured WORLD width so CameraRig can size its
    // word-following lateral truck to the actual subtitle - the subtitle/camera coupling.
    activeLineWidthRef: React.MutableRefObject<number>;
    // Live audio levels (0..255) - geometry/light reaction only (the camera stays audio-free).
    audioPower: MotionValue<number>;
    audioBands: AudioBands;
    motion: DioramaMotionParams;
    /** Master lyric visibility (the shared subtitle toggle): hides all 3D text but keeps the world flying. */
    showLyrics: boolean;
    /** Background particle-mote layer toggle (from the diorama tuning panel). */
    showParticles: boolean;
    /** Background dust shell's two independent axes; the field clamps each to its cap and multiplies them
     *  into the per-line mote count. 圆周 = motes around each ring, 径向 = layers across the shell thickness. */
    backgroundParticleCircumference: number;
    backgroundParticleRadial: number;
    /** Parent + per-family visibility for the staged point-cloud layer. */
    geometryVisibility: DioramaGeometryVisibility;
    /** Requested number of points per formation anchor (the particle builder also enforces a global cap). */
    particleDensity: number;
    /** Spatial scale multiplier for each complete point-cloud formation. */
    particleScale: number;
    /** One soft cluster aura, separate from the lyric sung-glow effect. */
    particleGlowEnabled: boolean;
    particleGlowIntensity: number;
    /** Global lyric font-size scale (the 通用 字号 setting): scales the 3D text uniformly. */
    lyricsFontScale: number;
    /** 普通辉光跟唱 EFFECTIVE strength (toggle off resolves to 0) - the soft cadenza glow. */
    glowIntensity: number;
    /** 灵魂出窍跟唱 EFFECTIVE strength (toggle off resolves to 0) - the drifting ghost copy. */
    soulIntensity: number;
    /** 当前字漂移 ON/OFF (already ANDed with the master 灵魂出窍 toggle upstream). ON lets the glyph being
     *  sung right now drift at the same soulIntensity as the rest; OFF keeps it registered and clean (no
     *  doubling / reading obstruction) until it finishes. The already-sung detach flight is untouched
     *  either way. Has no strength of its own - it borrows soulIntensity. */
    soulActiveEnabled: boolean;
    /** 渐变跟唱 EFFECTIVE strength (toggle off resolves to 0) - fill deepens with sung progress. */
    gradientIntensity: number;
    /** 关键字着色: the theme's keyword units take their own emphasis colour as their follow-sing TARGET -
     *  hidden until the singing reaches them, never a resting colour. See the colour block in useFrame. */
    keywordColoringEnabled: boolean;
}

// Which lines get mounted as 3D text + formations, relative to the current line. Past lines stay
// mounted so a finished line recedes visibly instead of vanishing; upcoming lines mount ahead and are
// born out of the far haze by the lifecycle fade.
const LINES_AHEAD = 3;
const LINES_BEHIND = 2;
// The outgoing TEXT during a transition needs only a small departing cluster on screen (it is being left
// behind), so its window is tighter than the live one - fewer meshes/rasters mounted per switch. This
// pair is text-only; the corridor sizes its outgoing window from clearance instead (see below).
const OUTGOING_LINES_BEHIND = 2;
const OUTGOING_LINES_AHEAD = 1;
// The corridor gets a LONGER window than the text, and it has to clear the visible band at BOTH ends: a
// point stops existing past DIORAMA_SHAPE_FADE_IN_END (27) and fog closes at FOG_FAR (30), so an end
// nearer than that is a hole you can look through. Lines sit DIORAMA_STEP_DISTANCE (8) apart, and the
// camera trails the read head by DIORAMA_HERO_DISTANCE (5.2), stretched to ~15 in the worst case (the
// widest shot pulls back to 2x hero, and 运镜幅度 scales that excursion by up to 1.6):
//   ahead:  7 * 8 - 3.4 (nearest shot) = 52 units clear - most visible at a song's start, staring down
//           the tunnel from line 0.
//   behind: 6 * 8 - 15 (widest shot)   = 33 units clear. This was 2, i.e. 16 - 15 = ONE unit clear: any
//           shot that swung the camera off the forward axis showed the tunnel's open back end.
const CORRIDOR_LINES_AHEAD = 7;
const CORRIDOR_LINES_BEHIND = 6;
// How many neighbour line textures to rasterise per animation frame - keeps the per-frame cost bounded so
// a song change (several new lines at once) spreads across a few frames instead of hitching one.
const NEIGHBOR_RASTER_BUDGET = 2;
// Opacity for a non-active mounted line, by SIGNED offset from the current line. Past lines stay as a
// receding trail but MUTED - bright enough to exist, dim enough that a lingering credits line can
// never read as a second subtitle stamped over the current one.
const resolveNeighborLineOpacity = (offset: number): number => {
    if (offset === -1) return 0.3;
    if (offset === -2) return 0.1;
    if (offset === 1) return 0.34;
    if (offset === 2) return 0.16;
    if (offset === 3) return 0.06;
    return 0;
};
// Opacity for an OUTGOING corridor's lines during a transition: a soft, uniform departing glow. Its own
// former-active line reads brightest, the rest a touch dimmer, so the leaving scene still looks like a
// real scene. Uniform ON PURPOSE - the fade-out is the camera flying away from them, applied by the
// distance lifecycle (resolveTextLife) and dressed by the fog, not baked into this curve.
const resolveOutgoingLineOpacity = (offsetFromOutgoing: number): number =>
    offsetFromOutgoing === 0 ? 0.7 : Math.abs(offsetFromOutgoing) <= 2 ? 0.45 : 0.25;

// Nominal world size of one em of lyric text. A line is always exactly one row (the rasteriser never
// wraps); longer lines are shrunk to fit via the frame-fit scale below.
const LINE_FONT_SIZE = 0.62;
// Fraction of the visible frame width a full line may occupy AT THE HERO DISTANCE. The fit scale is
// computed against this FIXED reference distance, not the live camera distance, so the camera
// approaching/passing a line genuinely grows/foreshortens it (real dolly motion).
const TARGET_FRAME_WIDTH_FRACTION = 0.72;
// Floor for the fit scale so an extremely long line becomes small-but-readable instead of vanishing.
const MIN_FIT_SCALE = 0.28;
const DEG_TO_RAD = Math.PI / 180;
// Fog band: far enough to keep the hero line and its formation crisp, near enough that the +3 line
// and its set-piece are born inside the haze (the lifecycle fade and the fog work together).
const FOG_NEAR = 12;
const FOG_FAR = 30;
// Text-specific near-dissolve band (tighter than the shapes'): a lyric passing right by the lens
// melts away instead of smearing across it, but no shot's normal framing distance ever triggers it.
const TEXT_DISSOLVE_START = 2.0;
const TEXT_DISSOLVE_END = 0.9;
// Far end of the text lifecycle - the half that was missing. Sits entirely PAST the fog's far plane, so
// it can never dim a line the scene actually means to show (a mounted neighbour tops out around 24-30
// units even in the widest shot); it exists to guarantee a line reaches true zero rather than merely
// fog-coloured. Fog recolours a fragment toward the background, it does not remove it - a fully-fogged
// lyric still draws background-coloured glyphs at its own opacity, which over the corridor's points
// (rather than over the empty shell background) reads as a ghost line that is not in this scene. A song
// change parks the previous corridor TRANSITION_DISTANCE (46) away while its last lines stay mounted as
// the new song's index-adjacent trail, so that is the normal path, not a corner case.
const TEXT_FADE_IN_START = 32;
const TEXT_FADE_IN_END = 40;
// How quickly the damped theme colours chase their targets (per-second rate for the exp smoothing).
// Deliberately gentle (~1.5s to settle) so on a song change the palette eases over roughly the same span
// the outgoing scene takes to recede into the fog - the departing elements don't visibly snap to the new
// song's theme mid-flight, and manual/AI theme changes glide instead of stepping.
const COLOR_DAMP_RATE = 1.2;
// Per-unit sung-state rendering, copying the project's classic-visualizer reveal model: a unit that
// has not been sung yet sits dim; the unit being sung RIGHT NOW turns accent-coloured and glows; a
// finished unit returns to plain bright text.
const ACTIVE_LINE_OPACITY = 0.92;
const UNSUNG_UNIT_OPACITY = 0.5;
// Ceiling for the glow plane's additive opacity (scaled by the per-frame level and the 辉光 slider).
const UNIT_GLOW_MAX_OPACITY = 0.9;
// 灵魂出窍跟唱: an additive GHOST copy of the sung glyph (the crisp base raster, not the blurred
// glow). While the unit is being sung the ghost hovers just off the text; once the unit finishes,
// its envelope releases slowly and the ghost DETACHES - rising, swelling and fading out, like the
// glyph's energy layer leaving the body. All ceilings scale with the 灵魂出窍 slider.
const SOUL_MAX_OPACITY = 0.6;
const SOUL_ACTIVE_LIFT_EM = 0.06;
const SOUL_DETACH_LIFT_EM = 0.5;
const SOUL_ACTIVE_SWELL = 0.1;
const SOUL_DETACH_SWELL = 0.3;
// How long AFTER a glyph finishes the ghost eases from "registered on the glyph" (当前字漂移) to full
// "out-of-body flight" (灵魂出窍强度). Read from the clock, so it is exactly 0 the whole time the glyph
// is being sung - the currently-sung glyph can never pick up the flight, no matter its envelope charge.
const SOUL_HANDOFF_SECONDS = 0.5;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// Fast-attack / slow-release envelope step: a rising target is chased quickly (beats hit on time), a
// falling one slowly (long notes sustain, then breathe out). Everything music-reactive in the scene
// tracks these smoothed envelopes instead of raw per-frame FFT values, so nothing can flicker.
const stepEnvelope = (current: number, target: number, attack: number, release: number, delta: number): number =>
    current + (target - current) * (1 - Math.exp(-(target > current ? attack : release) * delta));

const smoothstep01 = (t: number): number => t * t * (3 - 2 * t);

// 渐变跟唱 wake, in seconds AFTER a unit stops being sung: a brief hold at full tint, then a bounded
// decay that lands on exactly 0. Total wake is HOLD + TRAIL, the same order as the trail this replaces.
const GRADIENT_HOLD_SECONDS = 0.35;
const GRADIENT_TRAIL_SECONDS = 1.8;

/**
 * 渐变跟唱 energy for ONE unit at ONE instant: 0 before it is sung, easing to 1 across its own span,
 * holding, then decaying one-way to 0 - 出现 / 保持 / 衰减 / 回到底色.
 *
 * Reads ONLY this unit's own start/end time. It deliberately knows nothing about the line's progress:
 * the previous version summed a `0.25 * lineProgress` term into every sung unit, so each finished word
 * was re-tinted, brighter and brighter, by later words still being sung (measured: a line's first word
 * decayed to 0.42 and then climbed back to 0.60 over a 12s line). It also had a 0.35 floor, so a
 * finished word never reached its base colour - the whole line un-tinted together when a line-level
 * gate released, instead of each word settling on its own.
 *
 * PURE, and carries no frame-to-frame state. That is what makes seeking, looping, pausing and song
 * changes correct BY CONSTRUCTION: the colour is a function of the playback clock, so there is nothing
 * to reset and nothing that can drift out of step with it. The gate it replaces was an envelope
 * advanced by real frame delta, which kept fading the tint for seconds after a pause froze the clock.
 */
export const resolveGradientEnergy = (
    now: number,
    unit: { startTime: number; endTime: number },
): number => {
    if (now <= unit.startTime) return 0;
    if (now < unit.endTime) {
        const span = Math.max(unit.endTime - unit.startTime, 0.001);
        return smoothstep01(clamp01((now - unit.startTime) / span));
    }
    const sinceSung = now - unit.endTime;
    if (sinceSung <= GRADIENT_HOLD_SECONDS) return 1;
    return 1 - smoothstep01(clamp01((sinceSung - GRADIENT_HOLD_SECONDS) / GRADIENT_TRAIL_SECONDS));
};

/**
 * The fill colour of ONE lyric unit: its resting colour, dyed toward `target` by its OWN sung progress.
 *
 * Every unit rests at `primary` - keyword or not. `target` is the ONLY thing 关键字着色 changes, and that
 * is precisely what keeps an AI keyword hidden until the singing reaches it: at progress 0 this returns
 * exactly `primary`, so no target colour can leak ahead of the read-head, whatever colour it is. An AI
 * keyword marks what colour a word BECOMES when sung, never what colour it starts as.
 *
 * One base, one target, one interpolation - so keyword colour and follow-sing colour can never be two
 * finished colours fighting to overwrite each other. Writes into `out`; allocates nothing per frame.
 */
export const resolveDioramaUnitFill = (
    out: THREE.Color,
    primary: THREE.Color,
    target: THREE.Color,
    progress: number,
): THREE.Color => out.copy(primary).lerp(target, clamp01(progress));

/**
 * Whether the active line's per-unit state (the light/soul envelope arrays and the material ref slots)
 * must be reallocated this frame.
 *
 * The obvious trigger is a new active line. The second one is not obvious and was missing: a lyric swap
 * under a LIVE index. updateActiveSegmentLines rebuilds the active corridor IN PLACE - same globalStart,
 * same index, different words - when a slow load's lyrics arrive late or a provider reprocesses them. The
 * line changes, its unit count changes with it, and the global index does not move, so keying the reset on
 * the index alone left the envelope arrays sized for the PREVIOUS line.
 *
 * That failed silently, which is why it has a test. A Float32Array read past its end is `undefined`, not an
 * error; `undefined` then flows through the envelope step into NaN, a write of NaN past the end is
 * swallowed, and the unit's fill lerps by NaN - so every unit past the old length renders a NaN colour for
 * the rest of the line. Comparing the LENGTH catches it directly and covers the first allocation too
 * (`undefined !== count`), so there is no separate init path.
 */
export const shouldResetDioramaUnitState = (
    previousGlobalIndex: number,
    globalIndex: number,
    unitStateLength: number | undefined,
    unitCount: number,
): boolean => previousGlobalIndex !== globalIndex || unitStateLength !== unitCount;

/**
 * Distance lifecycle for a lyric plane, BOTH ends - the same shape resolveShapeLifeOpacity gives the
 * set-pieces: 0 beyond the far haze, 1 through the mid-range, dissolving again as it passes the lens.
 */
export const resolveTextLife = (distanceToCamera: number): number => {
    const farT = clamp01((TEXT_FADE_IN_END - distanceToCamera) / (TEXT_FADE_IN_END - TEXT_FADE_IN_START));
    const nearT = clamp01((distanceToCamera - TEXT_DISSOLVE_END) / (TEXT_DISSOLVE_START - TEXT_DISSOLVE_END));
    return (farT * farT * (3 - 2 * farT)) * (nearT * nearT * (3 - 2 * nearT));
};

// Uniform scale that shrinks a rendered line so it occupies at most TARGET_FRAME_WIDTH_FRACTION of
// the visible frame width at `distance`. three.js `fov` is the VERTICAL field of view.
const resolveFrameFitScale = (
    renderedWidth: number,
    distance: number,
    verticalFovDeg: number,
    aspect: number
): number => {
    if (renderedWidth <= 0 || distance <= 0) return 1;
    const frameWidth = 2 * distance * Math.tan((verticalFovDeg * DEG_TO_RAD) / 2) * aspect;
    const targetWidth = frameWidth * TARGET_FRAME_WIDTH_FRACTION;
    return Math.min(1, Math.max(MIN_FIT_SCALE, targetWidth / renderedWidth));
};

// Gradient colour temporaries (no per-frame alloc), all derived live from the theme's damped colours
// so a manual/AI theme switch re-colours the gradient automatically. _sungTint = the theme accent,
// made hue-safe when the palette is degenerate (see useFrame); _gradDeep = a darker, HUE-PRESERVING
// version the sung glyphs are dyed toward; _neutral = scratch for building a neutral grey.
const _sungTint = new THREE.Color();
const _gradDeep = new THREE.Color();
const _neutral = new THREE.Color();

// Reusable temporaries for building a line's text orientation from its path frame (no per-call alloc).
const _basisMatrix = new THREE.Matrix4();
const _basisQuat = new THREE.Quaternion();
const _tiltQuat = new THREE.Quaternion();
const _basisRight = new THREE.Vector3();
const _basisUp = new THREE.Vector3();
const _basisFwd = new THREE.Vector3();
const _axisY = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

// Orient a line's text to face back along the path toward the trailing camera (local +X -> frame
// right, +Y -> frame up, +Z -> -forward: a proper rotation, never mirrored), then stage it with the
// placement's slight yaw and in-plane roll so the typography sits expressively rather than level.
const frameQuaternion = (frame: DioramaFrame, roll = 0, yaw = 0): [number, number, number, number] => {
    _basisRight.set(frame.right.x, frame.right.y, frame.right.z);
    _basisUp.set(frame.up.x, frame.up.y, frame.up.z);
    _basisFwd.set(-frame.forward.x, -frame.forward.y, -frame.forward.z);
    _basisMatrix.makeBasis(_basisRight, _basisUp, _basisFwd);
    _basisQuat.setFromRotationMatrix(_basisMatrix);
    if (yaw !== 0) _basisQuat.multiply(_tiltQuat.setFromAxisAngle(_axisY, yaw));
    if (roll !== 0) _basisQuat.multiply(_tiltQuat.setFromAxisAngle(_axisZ, roll));
    return [_basisQuat.x, _basisQuat.y, _basisQuat.z, _basisQuat.w];
};

interface VisibleLineEntry {
    index: number;
    line: Line;
    placement: DioramaTextPlacement;
    position: [number, number, number];
    quaternion: [number, number, number, number];
    /** True for lines belonging to the OUTGOING corridor during a transition (a different segment than
     * the active one): rendered as a receding departing cluster rather than the current-song neighbours. */
    isOutgoing: boolean;
}

interface DampedThemeColors {
    primary: THREE.Color;
    accent: THREE.Color;
    secondary: THREE.Color;
    bg: THREE.Color;
}

// One "unit" of the active line, rendered as its OWN plane: a single grapheme for CJK (每个字单独),
// a whole word for other scripts (每个词单独). charStart/charEnd are code-unit indices into the line
// string, used to measure the unit's exact slot in the full-line layout (kerning preserved).
interface LyricUnit {
    text: string;
    charStart: number;
    charEnd: number;
    startTime: number;
    endTime: number;
}

// Graphemes that split per character: han, kana, compatibility ideographs, half-width kana, PLUS
// bullets/geometric shapes (the interlude countdown dots ●●● must each be their own unit so the
// glow can centre on each dot). Everything else (latin etc.) groups into per-word units.
const CJK_GRAPHEME_RE = /[⺀-鿿぀-ヿ豈-﫿ｦ-ﾟ•·■-◿]/;

// A laid-out, rasterised unit of the active line, in world units at scale 1.
interface PlacedUnitRaster {
    raster: DioramaUnitRaster;
    centerX: number;
    width: number;
    height: number;
}

const DioramaScene: React.FC<DioramaSceneProps> = ({
    theme,
    sequencer,
    globalIndex,
    transitionOutgoingIndex,
    currentTime,
    activeLineWidthRef,
    audioPower,
    audioBands,
    motion,
    showLyrics,
    showParticles,
    backgroundParticleCircumference,
    backgroundParticleRadial,
    geometryVisibility,
    particleDensity,
    particleScale,
    particleGlowEnabled,
    particleGlowIntensity,
    lyricsFontScale,
    glowIntensity,
    soulIntensity,
    soulActiveEnabled,
    gradientIntensity,
    keywordColoringEnabled,
}) => {
    // Neighbour line planes (one rasterised texture per line) - meshes for the fit scale, materials
    // for per-frame colour/opacity. Keyed by GLOBAL line index (which grows without bound across the
    // continuous tunnel), so Maps rather than arrays - entries are added/removed as the window moves.
    const lineMeshRefs = useRef<Map<number, THREE.Mesh>>(new Map());
    const lineMatRefs = useRef<Map<number, THREE.MeshBasicMaterial>>(new Map());
    // The active line's per-unit planes. Each of the three follow-sing effects has its OWN render
    // path so they never stand in for each other: base material (plain glyph; the gradient effect
    // tints it), glow material/mesh (additive cadenza glow raster - 普通辉光), and soul material/mesh
    // (additive crisp ghost copy that drifts out - 灵魂出窍).
    const unitsGroupRef = useRef<THREE.Group>(null);
    const unitBaseMatRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const unitGlowMatRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const unitGlowMeshRefs = useRef<Array<THREE.Mesh | null>>([]);
    const unitSoulMatRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);
    const unitSoulMeshRefs = useRef<Array<THREE.Mesh | null>>([]);
    // Per-unit smoothed values (one slot per unit): lightVals drive the glow (fast release), soulVals
    // the ghost (slow release so it lingers and drifts after the word finishes). Both reset on a line
    // change via prevActiveGlobalRef. 渐变跟唱 keeps no state here - it is a pure function of the clock.
    const unitLightValsRef = useRef<Float32Array | null>(null);
    const unitSoulValsRef = useRef<Float32Array | null>(null);
    // Reset per-unit state when the ACTIVE global line changes. Keyed on the global index (not the line
    // object) so a single-loop restart - which replays the very same line objects in a fresh segment -
    // still resets cleanly instead of carrying the previous round's envelopes.
    const prevActiveGlobalRef = useRef<number>(-1);
    // Overall music-power envelope (fast attack, slow release) shared by the glow and the dust.
    const powerEnvRef = useRef<number>(0);
    const trebleEnvRef = useRef<number>(0);
    // Background-mote layer refs, animated per-frame (subtle drift + music breathing).
    const pointsRef = useRef<THREE.Points>(null);
    const pointsMatRef = useRef<THREE.PointsMaterial>(null);

    const colors = useMemo(() => ({
        primary: theme.primaryColor,
        accent: theme.accentColor || theme.primaryColor,
        secondary: theme.secondaryColor,
    }), [theme.primaryColor, theme.accentColor, theme.secondaryColor]);

    // Target theme colours as THREE colours; the damped copies chase these per-frame so theme / AI
    // theme / song switches glide the whole scene's colour instead of snapping it.
    const colorTargets = useMemo<DampedThemeColors>(() => ({
        primary: new THREE.Color(colors.primary),
        accent: new THREE.Color(colors.accent),
        secondary: new THREE.Color(colors.secondary),
        bg: new THREE.Color(theme.backgroundColor),
    }), [colors, theme.backgroundColor]);
    const dampedColorsRef = useRef<DampedThemeColors | null>(null);

    // Rasters must rebuild once the app's web fonts (bundled + uploaded custom font) finish loading -
    // a line rasterised before that would keep the fallback face.
    const [fontsEpoch, setFontsEpoch] = useState(0);
    useEffect(() => {
        let mounted = true;
        if (typeof document !== 'undefined' && document.fonts?.ready) {
            document.fonts.ready.then(() => { if (mounted) setFontsEpoch((e) => e + 1); });
        }
        return () => { mounted = false; };
    }, []);
    const fontStack = useMemo(
        () => resolveThemeFontStack(theme),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [theme.fontStyle, theme.fontFamily, fontsEpoch]
    );
    const fontSpec = useMemo(() => buildDioramaFontSpec(fontStack), [fontStack]);

    // The active (newest) segment - the corridor currently playing. During a transition the previous
    // segment is still in the sequencer (the outgoing scene); everything on screen is one of the two.
    const activeSeg = sequencer.segments[sequencer.segments.length - 1] ?? null;
    const total = totalGlobalLines(sequencer);
    // The sequencer is a mutable ref-held object, so nothing downstream of it can be memoised on its
    // identity. `total` covers a lyric load that changes the LINE COUNT; this covers one that does not
    // (a reprocess, a provider swap, a translation landing) - same key, same span, different words.
    const linesEpoch = activeSeg?.linesEpoch ?? 0;

    // Which GLOBAL indices to mount. Normally a small forward-weighted window around the current line;
    // during a transition ALSO a tighter window around the outgoing line, so the departing corridor stays
    // on screen and recedes into the fog instead of vanishing - two spatially-separated clusters, one
    // scene. The outgoing cluster may be a different segment (song change) or the far end of the SAME
    // segment (loop back to start), so membership is by index proximity, not by segment.
    const mountedIndices = useMemo(() => {
        const indices = new Set<number>();
        const addWindow = (center: number, behind: number, ahead: number) => {
            const start = Math.max(center - behind, 0);
            const end = Math.min(center + ahead, total - 1);
            for (let i = start; i <= end; i += 1) indices.add(i);
        };
        addWindow(globalIndex, LINES_BEHIND, LINES_AHEAD);
        if (transitionOutgoingIndex != null) addWindow(transitionOutgoingIndex, OUTGOING_LINES_BEHIND, OUTGOING_LINES_AHEAD);
        return Array.from(indices).sort((a, b) => a - b);
    }, [globalIndex, transitionOutgoingIndex, total]);

    const visibleLines = useMemo(() => {
        const result: VisibleLineEntry[] = [];
        for (const i of mountedIndices) {
            const resolved = resolveGlobal(sequencer, i);
            if (!resolved || !resolved.line) continue;
            const { frame } = resolved;
            const placement = getDioramaTextPlacement(resolved.localIndex, resolved.segment.seed, motion.weaveScale);
            const position = {
                x: frame.position.x + frame.right.x * placement.offsetR + frame.up.x * placement.offsetU,
                y: frame.position.y + frame.right.y * placement.offsetR + frame.up.y * placement.offsetU,
                z: frame.position.z + frame.right.z * placement.offsetR + frame.up.z * placement.offsetU,
            };
            result.push({
                index: i,
                line: resolved.line,
                placement,
                position: [position.x, position.y, position.z],
                quaternion: frameQuaternion(frame, placement.roll, placement.yaw),
                // A line belongs to the departing cluster if it sits nearer the outgoing centre than the
                // current one (works whether that cluster is a different segment or this corridor's own end).
                isOutgoing: transitionOutgoingIndex != null
                    && Math.abs(i - transitionOutgoingIndex) <= Math.abs(i - globalIndex),
            });
        }
        return result;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mountedIndices, sequencer, linesEpoch, transitionOutgoingIndex, globalIndex, motion.weaveScale]);

    // Which shape the point-cloud layer takes: independent per-line formations, or one path tunnel.
    const geometryMode = geometryVisibility.mode ?? 'clouds';

    // Corridor mode only: one point tunnel threaded along the path. Each line contributes a span keyed by
    // its ABSOLUTE global index (pathStart), and each span's nextFrame comes from its own segment so it
    // never bridges a graft. The corridor uses its OWN, longer window than the text (see the constants):
    // it has to reach past the point fade-in distance or its far end reads as a hole - most visibly at a
    // song's start, where the camera sits at line 0 and stares straight down the tunnel.
    // During a song change the outgoing window is included too, so both tunnels exist: the departing one
    // recedes and disperses while the incoming one is born in the fog and gathers as the camera arrives.
    const corridorSpans = useMemo(() => {
        if (geometryMode !== 'corridor') return [];
        // Each window extends its OWN segment past that segment's ends (see the builder). During a song
        // change the two tunnels genuinely coexist - the departing one receding, the incoming one born in
        // the fog - so both windows are built whole and simply concatenated. They can hold the same global
        // index (one as a real line, the other as its own extension) and that is correct: they are
        // TRANSITION_DISTANCE apart in the world.
        const live = buildDioramaParticleCorridorWindow(
            sequencer, globalIndex, CORRIDOR_LINES_BEHIND, CORRIDOR_LINES_AHEAD,
        );
        if (transitionOutgoingIndex == null) return live;
        return [
            ...buildDioramaParticleCorridorWindow(
                sequencer, transitionOutgoingIndex, CORRIDOR_LINES_BEHIND, CORRIDOR_LINES_AHEAD,
            ),
            ...live,
        ];
    }, [geometryMode, globalIndex, transitionOutgoingIndex, sequencer, linesEpoch]);

    // Clouds mode only: per-line point-cloud anchors matched to each camera move and kept outside the
    // lyric/camera rail. The stable particleSeed excludes GLOBAL indices so a loop rebuilds the same
    // local cloud pattern even though the world segment has advanced.
    // Built in ASCENDING line order over the mounted window PLUS a short margin behind it, and NEVER
    // ranked by distance from the current line: the collision pass resolves a tie by earlier line, so
    // every possible blocker of a mounted cluster must be present for its verdict to come out the same
    // wherever the camera is. Ranking by the current line instead re-ran that pass in a different order on
    // every line advance and silently re-shuffled the whole surrounding composition. The margin clusters
    // only vote; they are dropped again below.
    const particleClusters = useMemo(() => {
        if (geometryMode !== 'clouds') return [];
        const result: DioramaParticleClusterAnchor[] = [];
        const mounted = new Set(mountedIndices);
        const clusterIndices = new Set<number>();
        for (const i of mountedIndices) {
            for (let back = 0; back <= DIORAMA_CLUSTER_COLLISION_LINE_SPAN; back += 1) {
                if (i - back >= 0) clusterIndices.add(i - back);
            }
        }
        for (const i of Array.from(clusterIndices).sort((a, b) => a - b)) {
            const resolved = resolveGlobal(sequencer, i);
            if (!resolved) continue;
            const { frame, localIndex, segment } = resolved;
            const placement = getDioramaTextPlacement(localIndex, segment.seed, motion.weaveScale);
            const shot = getDioramaShot(localIndex, segment.lines, segment.seed, motion.subMode);
            buildFormation(localIndex, segment.seed, shot, frame, placement, particleScale).forEach((piece, slot) => {
                result.push({
                    ...piece,
                    key: `${i}-${slot}`,
                    sourceLine: i,
                    particleSeed: `${segment.seed ?? 'seed'}:${localIndex}:${slot}:${piece.kind}`,
                    role: 'formation',
                });
            });
            // Foreground gate clouds are intentionally omitted: their negative depth placed them on the
            // camera side of the lyric rail and was the main source of path crossings and one-sided piles.
        }
        return selectVisibleDioramaClusters(result, geometryVisibility)
            .filter((cluster) => mounted.has(cluster.sourceLine));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [geometryMode, mountedIndices, sequencer, motion.weaveScale, motion.subMode, geometryVisibility, particleScale]);

    // Background mote field: one Points draw call holding a sliding WINDOW of lines around the read head
    // (see dioramaMoteField.ts). The buffer is fixed-size and recycled in place per-frame below, so the
    // draw cost is bounded by the density cap no matter how long the song is.
    const activeSegKey = activeSeg?.key ?? 'x';
    // Two independent axes for the dust shell: 圆周 (motes around each ring) x 径向 (layers across the
    // shell thickness). The per-line count is their product; the buffer is sized from it as before.
    const moteCircumference = resolveDioramaMoteCircumference(backgroundParticleCircumference);
    const moteRadial = resolveDioramaMoteRadial(backgroundParticleRadial);
    const moteDensity = moteCircumference * moteRadial;
    const motePositions = useMemo(
        () => new Float32Array(DIORAMA_MOTE_WINDOW_LINES * moteDensity * 3),
        [moteDensity]
    );
    const moteAttrRef = useRef<THREE.BufferAttribute>(null);
    // slot -> the line index currently written there. Empty = every slot is stale and will be rewritten.
    const moteWrittenRef = useRef<number[]>([]);
    // A new buffer (density change) or a new song's dust must not be read as the old window.
    useEffect(() => { moteWrittenRef.current = []; }, [moteDensity, activeSegKey]);
    const particleKey = `dust-${activeSegKey}-${moteDensity}`;

    const activeResolved = resolveGlobal(sequencer, globalIndex);
    const activeLine = activeResolved?.line ?? null;
    const activeEntry = useMemo(
        () => visibleLines.find((entry) => entry.index === globalIndex) ?? null,
        [visibleLines, globalIndex]
    );
    // Per-grapheme timing for the active line - same source every other visualizer reveals against.
    const activeLineTimeline: GraphemeTiming[] = useMemo(
        () => (activeLine ? buildLineGraphemeTimeline(activeLine) : []),
        [activeLine]
    );
    // Split the active line into individually-rendered units: every CJK grapheme is its own unit,
    // consecutive non-CJK graphemes of the same word form one unit. Whitespace separates units and is
    // never a unit itself (its advance still shapes the layout via prefix measurement).
    const activeLineUnits: LyricUnit[] = useMemo(() => {
        if (!activeLine || activeLineTimeline.length === 0) return [];
        const graphemes = splitLyricGraphemes(activeLine.fullText);
        // Prefix code-unit offset of each grapheme, mapping grapheme index -> string index.
        const charOffsets: number[] = [];
        let acc = 0;
        for (const g of graphemes) { charOffsets.push(acc); acc += g.length; }
        const units: LyricUnit[] = [];
        const pushUnit = (from: number, to: number) => {
            const text = graphemes.slice(from, to).join('');
            if (text.trim().length === 0) return;
            units.push({
                text,
                charStart: charOffsets[from] ?? 0,
                charEnd: (charOffsets[to - 1] ?? 0) + (graphemes[to - 1]?.length ?? 1),
                startTime: activeLineTimeline[from].startTime,
                endTime: activeLineTimeline[to - 1].endTime,
            });
        };
        let i = 0;
        while (i < activeLineTimeline.length) {
            const g = graphemes[i] ?? '';
            if (g.trim().length === 0) { i += 1; continue; }
            if (CJK_GRAPHEME_RE.test(g)) {
                pushUnit(i, i + 1);
                i += 1;
                continue;
            }
            // Non-CJK: extend across the same word (same wordIndex), stopping at whitespace or CJK.
            const wordIndex = activeLineTimeline[i].wordIndex;
            let j = i + 1;
            while (
                j < activeLineTimeline.length
                && activeLineTimeline[j].wordIndex === wordIndex
                && (graphemes[j] ?? '').trim().length > 0
                && !CJK_GRAPHEME_RE.test(graphemes[j] ?? '')
            ) {
                j += 1;
            }
            pushUnit(i, j);
            i = j;
        }
        return units;
    }, [activeLine, activeLineTimeline]);

    // 关键字着色. The keywords and their colours are the THEME's own `wordColors` - written by the AI
    // theme from the song's own lyrics, and the exact source every other visualizer draws from -
    // prepared by the shared matcher, then resolved onto units by character RANGE. What comes out is a
    // per-unit follow-sing TARGET, never a resting colour; see the colour block in useFrame.
    // Colour never reaches a texture (the rasters are pure white and are tinted by the material), so
    // keyword colouring adds no texture, no cache key and nothing to dispose: it only changes which
    // colour a material is dyed toward each frame.
    const keywordMatchers = useMemo(
        () => prepareDioramaKeywordMatchers(theme.wordColors, keywordColoringEnabled),
        [theme.wordColors, keywordColoringEnabled],
    );
    const keywordUnitColors = useMemo(
        () => resolveDioramaKeywordUnitColors(
            activeLine?.fullText ?? '',
            activeLineUnits,
            keywordMatchers,
            colorTargets.primary,
            colorTargets.accent,
            colorTargets.bg,
        ),
        [activeLine, activeLineUnits, keywordMatchers, colorTargets],
    );

    // Rasterise + lay out the active line's units. Layout measures PREFIX strings of the full line, so
    // every unit lands at its exact kerned slot; each unit's base/glow textures share one canvas
    // geometry, so the glow registers on the strokes exactly. Synchronous - ready the frame it's built.
    const activeUnitsRaster = useMemo(() => {
        if (!activeLine?.fullText || activeLineUnits.length === 0) return null;
        const worldPerPx = LINE_FONT_SIZE / DIORAMA_RASTER_FONT_PX;
        const full = activeLine.fullText;
        const totalPx = measureDioramaText(full, fontSpec);
        const units: PlacedUnitRaster[] = activeLineUnits.map((unit) => {
            const prefixPx = measureDioramaText(full.slice(0, unit.charStart), fontSpec);
            const raster = rasterDioramaUnit(full.slice(unit.charStart, unit.charEnd), fontSpec);
            return {
                raster,
                centerX: (-totalPx / 2 + prefixPx + raster.advancePx / 2) * worldPerPx,
                width: raster.canvasWidthPx * worldPerPx,
                height: raster.canvasHeightPx * worldPerPx,
            };
        });
        return { units, lineWidth: totalPx * worldPerPx };
    }, [activeLine, activeLineUnits, fontSpec]);
    // Dispose the previous line's unit textures once a new set is in place.
    useEffect(() => {
        const current = activeUnitsRaster;
        return () => {
            current?.units.forEach((u) => {
                u.raster.baseTexture.dispose();
                u.raster.glowTexture.dispose();
            });
        };
    }, [activeUnitsRaster]);

    // Neighbour line rasters, cached per line index and built INCREMENTALLY off the render frame. A song
    // change wants several new line textures at once; rasterising them all synchronously during render is
    // a main source of the switch-frame hitch. Instead this effect prunes/flushes synchronously (cheap)
    // but rasterises the MISSING lines only a couple per animation frame - and since incoming lines start
    // fog-hidden, the few-frame delay before a plane can mount is invisible. The tick state re-renders as
    // textures land (so their planes mount); every consumer reads the cache ref live.
    const lineRasterCacheRef = useRef<Map<number, DioramaLineRaster>>(new Map());
    const lineRasterFontRef = useRef('');
    const lineRasterEpochRef = useRef(-1);
    const [, bumpNeighborTick] = useState(0);
    useEffect(() => {
        const cache = lineRasterCacheRef.current;
        // A cached raster is only ever built for a MISSING index, so a lyric swap under a live index would
        // otherwise keep serving the previous song's words at the right place forever. Flush on the epoch
        // for the same reason the font change flushes: every entry is now derived from stale input.
        if (lineRasterFontRef.current !== fontSpec || lineRasterEpochRef.current !== linesEpoch) {
            cache.forEach((raster) => raster.texture.dispose());
            cache.clear();
            lineRasterFontRef.current = fontSpec;
            lineRasterEpochRef.current = linesEpoch;
        }
        const wanted = new Set<number>();
        visibleLines.forEach(({ index, line }) => {
            if (line?.fullText && index !== globalIndex) wanted.add(index);
        });
        let changed = false;
        cache.forEach((raster, index) => {
            if (!wanted.has(index)) {
                raster.texture.dispose();
                cache.delete(index);
                changed = true;
            }
        });
        const missing: number[] = [];
        wanted.forEach((index) => { if (!cache.has(index)) missing.push(index); });
        if (missing.length === 0) {
            if (changed) bumpNeighborTick((v) => v + 1);
            return undefined;
        }
        let cancelled = false;
        let rafId = 0;
        let qi = 0;
        const buildBatch = () => {
            if (cancelled) return;
            for (let n = 0; n < NEIGHBOR_RASTER_BUDGET && qi < missing.length; n += 1, qi += 1) {
                const entry = visibleLines.find((e) => e.index === missing[qi]);
                if (entry?.line?.fullText && !cache.has(missing[qi])) {
                    cache.set(missing[qi], rasterDioramaLine(entry.line.fullText, fontStack));
                }
            }
            bumpNeighborTick((v) => v + 1);
            if (qi < missing.length) rafId = requestAnimationFrame(buildBatch);
        };
        rafId = requestAnimationFrame(buildBatch);
        return () => { cancelled = true; if (rafId) cancelAnimationFrame(rafId); };
    }, [visibleLines, globalIndex, fontSpec, fontStack, linesEpoch]);

    // Free the neighbour cache's WebGL textures on UNMOUNT. The incremental effect above only disposes
    // textures it prunes (index no longer wanted) or flushes (font change); its cleanup just cancels the
    // rAF. three.js never frees manually-created textures on its own, so without this every mount/unmount
    // of the diorama (switching visualizer, leaving the player) would leak the still-cached CanvasTextures
    // on the GPU. A dedicated []-deps effect: its cleanup runs ONLY on unmount, so it can't drop textures
    // that are still in use across an ordinary re-render.
    useEffect(() => () => {
        lineRasterCacheRef.current.forEach((raster) => raster.texture.dispose());
        lineRasterCacheRef.current.clear();
    }, []);

    // The line the camera is LEAVING was, until this frame, drawn as per-glyph units (which never build a
    // whole-line neighbour raster). The instant a transition demotes it to a receding plane it needs that
    // raster THIS render, or it blinks out for the frame or two the async builder above would take (a
    // one-frame disappear/reappear of the outgoing lyric). Build just that ONE line synchronously - no
    // spike - so the swap from units to plane is seamless; all the genuinely new lines stay async.
    if (transitionOutgoingIndex != null && !lineRasterCacheRef.current.has(transitionOutgoingIndex)) {
        const leaving = visibleLines.find((entry) => entry.index === transitionOutgoingIndex);
        if (leaving?.line?.fullText) {
            lineRasterCacheRef.current.set(transitionOutgoingIndex, rasterDioramaLine(leaving.line.fullText, fontStack));
        }
    }

    // Fog toward the shell's background colour (the colour itself is damped per-frame below): distant
    // lines and set-pieces melt into the same haze the lifecycle fade births them from.
    // Owned IMPERATIVELY, on purpose. three only ever reads fog off the SCENE, and R3F's `attach` is a
    // plain parent-property write - so an `<fog attach="fog"/>` element rendered inside this component's
    // own <group> silently sets group.fog, which nothing reads. That is exactly what used to happen here:
    // scene.fog stayed null and the diorama ran with NO fog at all, which is why departing lyrics never
    // faded and the far end of the mote field showed up as a clump. Setting it on the scene directly keeps
    // it correct no matter how this component's JSX is later nested.
    const scene = useThree((state) => state.scene);
    useEffect(() => {
        const previous = scene.fog;
        scene.fog = new THREE.Fog(colorTargets.bg.getHex(), FOG_NEAR, FOG_FAR);
        return () => { scene.fog = previous; };
        // colorTargets.bg is only the initial colour here; useFrame keeps it damped from then on.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scene]);

    useFrame((frameState, delta) => {
        // Damped theme colours chase the targets, then everything colour-bearing copies from them -
        // fog, lights, shape materials - so a theme/AI/song switch is a glide, not a jump.
        if (!dampedColorsRef.current) {
            dampedColorsRef.current = {
                primary: colorTargets.primary.clone(),
                accent: colorTargets.accent.clone(),
                secondary: colorTargets.secondary.clone(),
                bg: colorTargets.bg.clone(),
            };
        }
        const damped = dampedColorsRef.current;
        const colorK = 1 - Math.exp(-COLOR_DAMP_RATE * delta);
        damped.primary.lerp(colorTargets.primary, colorK);
        damped.accent.lerp(colorTargets.accent, colorK);
        damped.secondary.lerp(colorTargets.secondary, colorK);
        damped.bg.lerp(colorTargets.bg, colorK);
        const sceneFog = frameState.scene.fog;
        if (sceneFog) sceneFog.color.copy(damped.bg);

        // Audio levels arrive 0..255; scaled by the tuning's audioLevel (0 disables entirely). The
        // background motes and lyric effects use smoothed envelopes here; the point-cloud field owns its
        // separate shader uniforms. Neither path writes audio into the camera.
        const audioK = motion.audioLevel;
        const treble01 = Math.min(1, audioBands.treble.get() / 255) * audioK;
        const power01 = Math.min(1, audioPower.get() / 255) * audioK;
        const trebleEnv = stepEnvelope(trebleEnvRef.current, treble01, 14, 3.2, delta);
        trebleEnvRef.current = trebleEnv;
        const powerEnv = stepEnvelope(powerEnvRef.current, power01, 18, 3.5, delta);
        powerEnvRef.current = powerEnv;
        const camPos = frameState.camera.position;

        // Recycle the mote window onto the read head. Every line from -BEHIND to +AHEAD maps to its own
        // ring slot, so this is a no-op on the frames where the read head has not moved, and rewrites
        // exactly the lines that entered the window on the frames where it has. Lines past either end of
        // the lyrics get a straight procedural frame, so the dust keeps going where the path stops.
        if (showParticles) {
            const written = moteWrittenRef.current;
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
                    activeSeg?.seed,
                );
                written[slot] = line;
                dirty = true;
            }
            if (dirty && moteAttrRef.current) moteAttrRef.current.needsUpdate = true;
        }

        // Background motes drift as a quiet depth cue; restrained audio response keeps them from
        // competing with lyrics or reading as bright foreground debris.
        if (pointsRef.current) {
            const t = frameState.clock.elapsedTime;
            pointsRef.current.position.set(Math.sin(t * 0.17) * 0.12, Math.sin(t * 0.11 + 1.7) * 0.09, Math.cos(t * 0.13) * 0.12);
        }
        if (pointsMatRef.current) {
            pointsMatRef.current.size = 0.03 * (1 + 0.42 * trebleEnv);
            pointsMatRef.current.opacity = 0.16 + 0.18 * powerEnv;
            pointsMatRef.current.color.copy(damped.secondary).lerp(damped.accent, 0.3);
        }

        // Fit each lyric line to read well at the HERO distance (times its per-line staging scale and
        // the global 字号 scale), then leave it alone - no billboarding, no live-distance rescale, so
        // camera motion is real. Widths are known synchronously from the raster layout.
        const { camera } = frameState;
        const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
        const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 55;
        visibleLines.forEach(({ index, placement, isOutgoing }) => {
            if (index === globalIndex) return;
            const mesh = lineMeshRefs.current.get(index);
            const mat = lineMatRefs.current.get(index);
            const raster = lineRasterCacheRef.current.get(index);
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

        // Per-unit reveal + the three INDEPENDENT follow-sing effects. The base reveal (dim -> bright
        // sweep) always runs; on top of it each effect has its own render path and its own effective
        // strength (0 = its toggle is off): 普通辉光 lights the additive cadenza-glow plane, 灵魂出窍
        // drives the additive ghost plane, 渐变 tints the base fill with the line's sung progress.
        // Disabling one never changes what the others draw. All per-frame writes are material
        // colour/opacity + mesh transforms - nothing ever re-rasterises during a line.
        const unitsGroup = unitsGroupRef.current;
        if (shouldResetDioramaUnitState(
            prevActiveGlobalRef.current, globalIndex, unitLightValsRef.current?.length, activeLineUnits.length,
        )) {
            // New active line (or new segment/round): fresh per-unit state (the keyed group already
            // remounted fresh planes). Also fires when THIS line's words were swapped under it - the
            // group is keyed by index, so it keeps its planes and only these arrays have to catch up.
            prevActiveGlobalRef.current = globalIndex;
            unitLightValsRef.current = new Float32Array(activeLineUnits.length);
            unitSoulValsRef.current = new Float32Array(activeLineUnits.length);
            unitBaseMatRefs.current.length = activeLineUnits.length;
            unitGlowMatRefs.current.length = activeLineUnits.length;
            unitGlowMeshRefs.current.length = activeLineUnits.length;
            unitSoulMatRefs.current.length = activeLineUnits.length;
            unitSoulMeshRefs.current.length = activeLineUnits.length;
        }
        if (unitsGroup && activeUnitsRaster && activeEntry && activeLine) {
            const fit = resolveFrameFitScale(activeUnitsRaster.lineWidth, DIORAMA_HERO_DISTANCE, fov, aspect)
                * activeEntry.placement.scale * lyricsFontScale;
            unitsGroup.scale.setScalar(fit);
            // Publish the active line's world width so CameraRig sizes its word-following truck.
            activeLineWidthRef.current = activeUnitsRaster.lineWidth * fit;
            const life = resolveTextLife(unitsGroup.position.distanceTo(camPos));
            const now = currentTime.get();
            const breath = 0.9 + 0.1 * Math.sin(frameState.clock.elapsedTime * 1.9);
            const lightVals = unitLightValsRef.current;
            const soulVals = unitSoulValsRef.current;

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
                const baseMat = unitBaseMatRefs.current[i];
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
                const glowMat = unitGlowMatRefs.current[i];
                const glowMesh = unitGlowMeshRefs.current[i];
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
                const soulMat = unitSoulMatRefs.current[i];
                const soulMesh = unitSoulMeshRefs.current[i];
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
        } else {
            activeLineWidthRef.current = 0;
        }
    });

    return (
        <group>
            {showParticles && (
                <points key={particleKey} ref={pointsRef} frustumCulled={false}>
                    <bufferGeometry>
                        <bufferAttribute ref={moteAttrRef} attach="attributes-position" args={[motePositions, 3]} />
                    </bufferGeometry>
                    {/* Size/opacity/colour are driven per-frame from the music envelopes in useFrame. */}
                    <pointsMaterial
                        ref={pointsMatRef}
                        size={0.03}
                        sizeAttenuation
                        transparent
                        opacity={0.2}
                        depthWrite={false}
                        color={colors.secondary}
                        blending={THREE.NormalBlending}
                    />
                </points>
            )}

            {(geometryMode === 'corridor' ? corridorSpans.length > 0 : particleClusters.length > 0) && (
                <DioramaParticleField
                    mode={geometryMode}
                    clusters={particleClusters}
                    corridorSpans={corridorSpans}
                    density={particleDensity}
                    particleGlowEnabled={particleGlowEnabled}
                    particleGlowIntensity={particleGlowIntensity}
                    currentTime={currentTime}
                    audioPower={audioPower}
                    audioBands={audioBands}
                    audioLevel={motion.audioLevel}
                    primaryColor={colors.primary}
                    accentColor={colors.accent}
                    secondaryColor={colors.secondary}
                    backgroundColor={theme.backgroundColor}
                    transitionActive={transitionOutgoingIndex != null}
                    readHeadLine={globalIndex}
                    resetKey={activeSegKey}
                />
            )}

            {showLyrics && visibleLines.map(({ index, line, position, quaternion, isOutgoing }) => {
                if (!line?.fullText) return null;
                if (index === globalIndex) return null;
                // Outgoing (departing) lines use their own soft opacity so a huge index gap never gates
                // them out; incoming neighbours use the offset-from-current bell. Both are refreshed per
                // frame in useFrame - these are just the initial values.
                const offset = index - globalIndex;
                const initialOpacity = isOutgoing
                    ? resolveOutgoingLineOpacity(index - (transitionOutgoingIndex ?? index))
                    : resolveNeighborLineOpacity(offset);
                if (initialOpacity <= 0) return null;
                const raster = lineRasterCacheRef.current.get(index);
                if (!raster) return null;
                const worldPerPx = LINE_FONT_SIZE / raster.fontPx;
                const initialColor = isOutgoing || offset < 0 ? colors.primary : colors.secondary;
                return (
                    // One rasterised plane per neighbour line (colour/opacity refreshed per-frame). Refs are
                    // keyed by GLOBAL index in a Map: added on mount, removed on unmount as the window moves.
                    <mesh
                        key={index}
                        ref={el => { if (el) lineMeshRefs.current.set(index, el); else lineMeshRefs.current.delete(index); }}
                        position={position}
                        quaternion={quaternion}
                        renderOrder={0}
                    >
                        <planeGeometry args={[raster.canvasWidthPx * worldPerPx, raster.canvasHeightPx * worldPerPx]} />
                        <meshBasicMaterial
                            ref={el => { if (el) lineMatRefs.current.set(index, el); else lineMatRefs.current.delete(index); }}
                            map={raster.texture}
                            transparent
                            opacity={initialOpacity}
                            depthWrite={false}
                            color={initialColor}
                        />
                    </mesh>
                );
            })}

            {showLyrics && activeLine?.fullText && activeEntry && activeUnitsRaster && (
                // The active line as INDIVIDUAL units (every CJK char / latin word its own plane), laid
                // out at their exact kerned slots in the full-line layout. Keyed by line index: fresh
                // planes/textures every line. Behind each unit sits an additive plane with the cadenza
                // glow raster of the SAME glyph - registration is exact by construction; its opacity/
                // scale breathe per-frame. The active line never depth-tests, so geometry can frame it
                // from any angle without covering the words.
                <group key={globalIndex} ref={unitsGroupRef} position={activeEntry.position} quaternion={activeEntry.quaternion}>
                    {activeUnitsRaster.units.map((placed, unitIndex) => (
                        <React.Fragment key={unitIndex}>
                            <mesh
                                ref={el => { unitGlowMeshRefs.current[unitIndex] = el; }}
                                visible={false}
                                position={[placed.centerX, 0, -0.01]}
                                renderOrder={17}
                            >
                                <planeGeometry args={[placed.width, placed.height]} />
                                <meshBasicMaterial
                                    ref={el => { unitGlowMatRefs.current[unitIndex] = el; }}
                                    map={placed.raster.glowTexture}
                                    transparent
                                    opacity={0}
                                    depthTest={false}
                                    depthWrite={false}
                                    blending={THREE.AdditiveBlending}
                                    color={colors.accent}
                                />
                            </mesh>
                            {/* 灵魂出窍 ghost: the CRISP base raster (not the blurred glow) drawn
                                additively; useFrame lifts/swells/fades it as its envelope releases. */}
                            <mesh
                                ref={el => { unitSoulMeshRefs.current[unitIndex] = el; }}
                                visible={false}
                                position={[placed.centerX, 0, -0.005]}
                                renderOrder={18}
                            >
                                <planeGeometry args={[placed.width, placed.height]} />
                                <meshBasicMaterial
                                    ref={el => { unitSoulMatRefs.current[unitIndex] = el; }}
                                    map={placed.raster.baseTexture}
                                    transparent
                                    opacity={0}
                                    depthTest={false}
                                    depthWrite={false}
                                    blending={THREE.AdditiveBlending}
                                    color={colors.accent}
                                />
                            </mesh>
                            <mesh position={[placed.centerX, 0, 0]} renderOrder={19}>
                                <planeGeometry args={[placed.width, placed.height]} />
                                <meshBasicMaterial
                                    ref={el => { unitBaseMatRefs.current[unitIndex] = el; }}
                                    map={placed.raster.baseTexture}
                                    transparent
                                    opacity={UNSUNG_UNIT_OPACITY}
                                    depthTest={false}
                                    depthWrite={false}
                                    color={colors.primary}
                                />
                            </mesh>
                        </React.Fragment>
                    ))}
                </group>
            )}

        </group>
    );
};

export default DioramaScene;
