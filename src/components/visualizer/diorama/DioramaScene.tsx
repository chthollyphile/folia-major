import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type AudioBands, type DioramaGeometryVisibility, type Theme } from '../../../types';
import { buildLineGraphemeTimeline, type GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { prepareDioramaKeywordMatchers, resolveDioramaKeywordUnitColors } from './dioramaKeywordColor';
import { DIORAMA_HERO_DISTANCE, type DioramaMotionParams } from './cameraPath';
import { resolveGlobal, type SequencerState, totalGlobalLines } from './dioramaSequencer';
import { buildDioramaFontSpec } from './dioramaTextRaster';
import { DioramaParticleField } from './DioramaParticleField';
import { DIORAMA_MOTE_WINDOW_LINES, resolveDioramaMoteCircumference, resolveDioramaMoteRadial } from './dioramaMoteField';
import {
    COLOR_DAMP_RATE,
    FOG_FAR,
    FOG_NEAR,
    LINE_FONT_SIZE,
    resolveNeighborLineOpacity,
    resolveOutgoingLineOpacity,
    stepEnvelope,
} from './dioramaSceneConstants';
import { resolveFrameFitScale, resolveTextLife, shouldResetDioramaUnitState } from './dioramaSceneUnits';
import { type DampedThemeColors, type LyricUnit } from './dioramaSceneTypes';
import {
    buildDioramaCorridorSpans,
    buildDioramaParticleClusters,
    buildDioramaVisibleLines,
    layoutDioramaActiveUnits,
    resolveDioramaMountedIndices,
    splitDioramaLyricUnits,
} from './dioramaSceneLayout';
import { DioramaLineRasterCache } from './dioramaLineRasterCache';
import {
    type DioramaUnitPlanes,
    recycleDioramaMoteWindow,
    updateDioramaActiveUnits,
    updateDioramaNeighborLines,
} from './dioramaSceneFrame';
import { DioramaActiveUnitPlanes } from './DioramaActiveUnitPlanes';
import { resolveDioramaLyricHop } from './dioramaBeatRipples';
import { getBeatFxFiredCounts, isBeatFxReady } from '../../../services/beatFx/beatFxLive';
import { beatImpact, downbeatImpact } from '../../../stores/motionSignals';

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
//
// 结构推导在 dioramaSceneLayout（纯函数），邻行栅格缓存在 dioramaLineRasterCache，每帧的写入在
// dioramaSceneFrame，当前行逐单元平面在 DioramaActiveUnitPlanes；这里只做 React 装配与 useFrame 调度。
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
    // The beat hop (智能动感模式): which unit of the active line jumps (the one sung when the last beat
    // fired, -1 none), and the clock's beat count it was picked at.
    const hopUnitRef = useRef(-1);
    const hopBeatsRef = useRef<number | null>(null);
    const unitPlanesRef = useRef<DioramaUnitPlanes>({ baseMats: [], glowMats: [], glowMeshes: [], soulMats: [], soulMeshes: [], unitGroups: [] });
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
    const fontWeight = resolveThemeFontWeight(theme, 700);
    const fontSpec = useMemo(() => buildDioramaFontSpec(fontStack, fontWeight), [fontStack, fontWeight]);

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
    const mountedIndices = useMemo(
        () => resolveDioramaMountedIndices(globalIndex, transitionOutgoingIndex, total),
        [globalIndex, transitionOutgoingIndex, total],
    );

    const visibleLines = useMemo(
        () => buildDioramaVisibleLines(sequencer, mountedIndices, globalIndex, transitionOutgoingIndex, motion.weaveScale),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [mountedIndices, sequencer, linesEpoch, transitionOutgoingIndex, globalIndex, motion.weaveScale],
    );

    // Which shape the point-cloud layer takes: independent per-line formations, or one path tunnel.
    const geometryMode = geometryVisibility.mode ?? 'clouds';

    // Corridor mode only: one point tunnel threaded along the path. Each line contributes a span keyed by
    // its ABSOLUTE global index (pathStart), and each span's nextFrame comes from its own segment so it
    // never bridges a graft. The corridor uses its OWN, longer window than the text (see the constants):
    // it has to reach past the point fade-in distance or its far end reads as a hole - most visibly at a
    // song's start, where the camera sits at line 0 and stares straight down the tunnel.
    // During a song change the outgoing window is included too, so both tunnels exist: the departing one
    // recedes and disperses while the incoming one is born in the fog and gathers as the camera arrives.
    const corridorSpans = useMemo(
        () => buildDioramaCorridorSpans(sequencer, globalIndex, transitionOutgoingIndex, geometryVisibility, geometryMode),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [geometryVisibility.enabled, geometryMode, globalIndex, transitionOutgoingIndex, sequencer, linesEpoch],
    );

    // Clouds mode only: per-line point-cloud anchors matched to each camera move and kept outside the
    // lyric/camera rail. The stable particleSeed excludes GLOBAL indices so a loop rebuilds the same
    // local cloud pattern even though the world segment has advanced.
    // Built in ASCENDING line order over the mounted window PLUS a short margin behind it, and NEVER
    // ranked by distance from the current line: the collision pass resolves a tie by earlier line, so
    // every possible blocker of a mounted cluster must be present for its verdict to come out the same
    // wherever the camera is. Ranking by the current line instead re-ran that pass in a different order on
    // every line advance and silently re-shuffled the whole surrounding composition. The margin clusters
    // only vote; they are dropped again below.
    const particleClusters = useMemo(
        () => buildDioramaParticleClusters(sequencer, mountedIndices, geometryMode, motion, geometryVisibility, particleScale),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [geometryMode, mountedIndices, sequencer, motion.weaveScale, motion.subMode, geometryVisibility, particleScale],
    );

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
    // A new buffer (density change) or a new song's dust must not be read as the old window. Key on BOTH
    // axes, not their product: 28x2 and 14x4 share moteDensity=56, so keying on the product alone would
    // leave every slot marked current and the frame loop would keep the old distribution until a line
    // recycled or the song changed.
    useEffect(() => { moteWrittenRef.current = []; }, [moteCircumference, moteRadial, activeSegKey]);
    const particleKey = `dust-${activeSegKey}-${moteCircumference}x${moteRadial}`;

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
    const activeLineUnits: LyricUnit[] = useMemo(
        () => splitDioramaLyricUnits(activeLine, activeLineTimeline),
        [activeLine, activeLineTimeline],
    );

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
    const activeUnitsRaster = useMemo(
        () => layoutDioramaActiveUnits(activeLine, activeLineUnits, fontSpec),
        [activeLine, activeLineUnits, fontSpec],
    );
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
    const lineRasterCacheRef = useRef<DioramaLineRasterCache | null>(null);
    if (!lineRasterCacheRef.current) lineRasterCacheRef.current = new DioramaLineRasterCache();
    const lineRasters = lineRasterCacheRef.current;
    const [, bumpNeighborTick] = useState(0);
    useEffect(() => lineRasters.sync({
        visibleLines,
        globalIndex,
        fontSpec,
        fontStack,
        fontWeight,
        linesEpoch,
        onChange: () => bumpNeighborTick((v) => v + 1),
    }), [visibleLines, globalIndex, fontSpec, fontStack, fontWeight, linesEpoch, lineRasters]);

    // Free the neighbour cache's WebGL textures on UNMOUNT. The incremental effect above only disposes
    // textures it prunes (index no longer wanted) or flushes (font change); its cleanup just cancels the
    // rAF. three.js never frees manually-created textures on its own, so without this every mount/unmount
    // of the diorama (switching visualizer, leaving the player) would leak the still-cached CanvasTextures
    // on the GPU. A dedicated []-deps effect: its cleanup runs ONLY on unmount, so it can't drop textures
    // that are still in use across an ordinary re-render.
    useEffect(() => () => {
        lineRasters.disposeAll();
    }, [lineRasters]);

    // The line the camera is LEAVING was, until this frame, drawn as per-glyph units (which never build a
    // whole-line neighbour raster). The instant a transition demotes it to a receding plane it needs that
    // raster THIS render, or it blinks out for the frame or two the async builder above would take (a
    // one-frame disappear/reappear of the outgoing lyric). Build just that ONE line synchronously - no
    // spike - so the swap from units to plane is seamless; all the genuinely new lines stay async.
    if (transitionOutgoingIndex != null) {
        lineRasters.ensureOutgoing(transitionOutgoingIndex, visibleLines, fontStack, fontWeight);
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
            const dirty = recycleDioramaMoteWindow({
                written: moteWrittenRef.current,
                motePositions,
                sequencer,
                globalIndex,
                total,
                moteCircumference,
                moteRadial,
                seed: activeSeg?.seed,
            });
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
        updateDioramaNeighborLines({
            visibleLines,
            globalIndex,
            transitionOutgoingIndex,
            meshes: lineMeshRefs.current,
            materials: lineMatRefs.current,
            rasters: lineRasters.rasters,
            camPos,
            fov,
            aspect,
            lyricsFontScale,
            damped,
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
            const planes = unitPlanesRef.current;
            planes.baseMats.length = activeLineUnits.length;
            planes.glowMats.length = activeLineUnits.length;
            planes.glowMeshes.length = activeLineUnits.length;
            planes.soulMats.length = activeLineUnits.length;
            planes.soulMeshes.length = activeLineUnits.length;
            planes.unitGroups.length = activeLineUnits.length;
            hopUnitRef.current = -1;
        }
        if (unitsGroup && activeUnitsRaster && activeEntry && activeLine) {
            const fit = resolveFrameFitScale(activeUnitsRaster.lineWidth, DIORAMA_HERO_DISTANCE, fov, aspect)
                * activeEntry.placement.scale * lyricsFontScale;
            unitsGroup.scale.setScalar(fit);
            // Publish the active line's world width so CameraRig sizes its word-following truck.
            activeLineWidthRef.current = activeUnitsRaster.lineWidth * fit;
            const life = resolveTextLife(unitsGroup.position.distanceTo(camPos));
            const now = currentTime.get();
            // 智能动感模式: the word being sung jumps up on each beat and falls back as the beat fades
            // (dioramaBeatRipples.ts). Picked when the beat fires - the unit sung then, or the last one
            // begun if the beat lands between words - and kept through its fall, so moving on to the
            // next word does not cut the hop short. Off, or until the beats are in, every unit rests.
            const fired = getBeatFxFiredCounts().beats;
            const beatFxOn = isBeatFxReady();
            if (beatFxOn && hopBeatsRef.current !== null && fired > hopBeatsRef.current) {
                let picked = -1;
                activeLineUnits.forEach((unit, index) => {
                    if (unit.startTime <= now) picked = index;
                });
                hopUnitRef.current = picked;
            }
            hopBeatsRef.current = fired;
            const hop = beatFxOn ? resolveDioramaLyricHop(beatImpact.get(), downbeatImpact.get()) : 0;
            unitPlanesRef.current.unitGroups.forEach((group, index) => {
                if (!group) return;
                const placed = activeUnitsRaster.units[index];
                const lift = index === hopUnitRef.current && placed ? hop * placed.height : 0;
                if (group.position.y !== lift) group.position.y = lift;
            });
            const breath = 0.9 + 0.1 * Math.sin(frameState.clock.elapsedTime * 1.9);
            updateDioramaActiveUnits({
                activeLineUnits,
                planes: unitPlanesRef.current,
                lightVals: unitLightValsRef.current,
                soulVals: unitSoulValsRef.current,
                now,
                delta,
                life,
                breath,
                powerEnv,
                damped,
                keywordUnitColors,
                glowIntensity,
                soulIntensity,
                soulActiveEnabled,
                gradientIntensity,
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
                const raster = lineRasters.get(index);
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
                    <DioramaActiveUnitPlanes
                        units={activeUnitsRaster.units}
                        planes={unitPlanesRef.current}
                        primaryColor={colors.primary}
                        accentColor={colors.accent}
                    />
                </group>
            )}

        </group>
    );
};

export default DioramaScene;
