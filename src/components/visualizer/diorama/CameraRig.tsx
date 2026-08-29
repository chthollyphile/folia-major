import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { type MotionValue } from 'framer-motion';
import * as THREE from 'three';
import { type Line } from '../../../types';
import { buildLineGraphemeTimeline, type GraphemeTiming } from '../../../utils/lyrics/graphemeTiming';
import { getLineRenderEndTime } from '../../../utils/lyrics/renderHints';
import {
    DIORAMA_CAMERA_LIFT,
    DIORAMA_HERO_DISTANCE,
    DIORAMA_SAFE_FRAME_FRACTION,
    DIORAMA_SNAP_DISTANCE,
    type DioramaMotionParams,
    type DioramaShotKind,
    frameHalfWidth,
    getDioramaShot,
    getDioramaTextPlacement,
    getFrame,
    resolveCameraDrift,
    resolveHoldSettle,
    resolveReadHeadTruck,
    resolveShotOffset,
    smoothDamp,
} from './cameraPath';
import { resolveGlobal, type SequencerState } from './dioramaSequencer';
import {
    flightPerp,
    flightSide,
    TRANSITION_AIM_SWEEP,
    TRANSITION_BANK,
    TRANSITION_DURATION,
    transitionEase,
} from './dioramaTransition';

// src/components/visualizer/diorama/CameraRig.tsx
// Drives the camera every frame from refs only - no React state - per the frontend runtime guardrails.
// The camera continuously SmoothDamps to trail the "read-head" (the sung point of the line, at the
// line's ACTUAL text placement - which is offset/scaled/tilted off the path), and HOW it frames that
// point is decided by the line's assigned cinematic SHOT. Shot offsets and the follow are composed in
// the line's LOCAL path frame, so moves stay correct as the corridor turns. Line-to-line the SmoothDamp
// blends one shot into the next: varied techniques, smooth transitions.
//
// Deliberately NO audio input here: the camera's motion curves stay clean and composed (the music
// expresses itself through the geometry/lighting in DioramaScene instead). `globalIndex` is the sticky
// position in the continuous-tunnel sequencer (resolved by VisualizerDiorama), so the camera holds on
// the last line through an instrumental gap and, on a song change / loop, simply flies forward one step
// across the graft joint into the next segment - the transition is ordinary forward follow, no snap.
interface CameraRigProps {
    currentTime: MotionValue<number>;
    sequencer: SequencerState;
    globalIndex: number;
    activeLineWidthRef: React.MutableRefObject<number>;
    motion: DioramaMotionParams;
    /** Bumped by VisualizerDiorama on each song change / loop restart. A change starts the cinematic
     * flight: the camera captures its current pose and flies an eased Bezier arc to the incoming scene's
     * opening pose over TRANSITION_DURATION, then hands back to the normal follow. 0 = no transition. */
    transitionEpoch: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

// Reading-alignment (回正): a SOFT reading aid inside the shot system, never a lock. The camera's
// orientation leans toward the text plane's orientation only as much as the current moment needs:
//
//   weight = readNeed(time within the sung window, smooth ramps) x shot's own alignment ceiling
//
// - readNeed rises smoothly ahead of the line and releases smoothly after it; gaps/interludes fall to
//   ZERO - the free spatial moves between lines are completely untouched.
// - Each SHOT KIND keeps its own ceiling: composed reading shots (hold/pushIn/track) square up almost
//   fully, while expressive spatial moves (orbit/spiral/flyby/pendulum) only lean partway toward
//   readable - their rotational character survives, the text just never tips past recognisable.
// The result of both is then exp-smoothed at a gentle rate, so the deepening/releasing itself always
// plays as a slow camera gesture, not a state flip.
const ALIGN_SHOT_CEILING: Record<DioramaShotKind, number> = {
    hold: 0.9,
    pushIn: 0.85,
    track: 0.85,
    swell: 0.8,
    float: 0.78,
    glide: 0.72,
    crane: 0.7,
    pullBack: 0.7,
    arc: 0.62,
    pendulum: 0.6,
    orbit: 0.55,
    spiral: 0.5,
    flyby: 0.5,
};
// readNeed ramp: starts easing in ALIGN_LEAD_IN before the line, reaches full ALIGN_SETTLE after it
// starts (the settle IS the visible "square up on the lyric" move), and releases over ALIGN_RELEASE
// after the line finishes.
const ALIGN_LEAD_IN = 0.6;
const ALIGN_SETTLE = 0.35;
const ALIGN_RELEASE = 1.0;
const ALIGN_RATE = 1.2;
// How fast the smoothed alignment orientation pans toward a new line's text plane (per-second rate) -
// low enough that squaring up on a differently-tilted line reads as a deliberate camera move.
const ALIGN_TURN_RATE = 2.6;
// Keep-in-frame guarantee: after the orientation blend, the read-head must sit within this fraction
// of the half-FOV (the tighter of vertical/horizontal). If alignment has rotated it further out (big
// lateral shot offsets in chaotic mode), the orientation is pulled back just enough - the lyric can
// never leave the frame, in any intensity mode.
const FRAME_KEEP_FRACTION = 0.7;

const smoothstep01 = (t: number): number => {
    const c = clamp01(t);
    return c * c * (3 - 2 * c);
};

// Reusable temporaries for the alignment quaternion math (no per-frame alloc). The text basis below
// mirrors DioramaScene's frameQuaternion: +X -> frame right, +Y -> frame up, +Z -> -forward, then the
// placement's yaw and roll post-multiplied - so the "aligned" camera orientation IS the text's.
const _alignRight = new THREE.Vector3();
const _alignUp = new THREE.Vector3();
const _alignFwd = new THREE.Vector3();
const _alignMatrix = new THREE.Matrix4();
const _alignQuat = new THREE.Quaternion();
const _tiltQuat = new THREE.Quaternion();
const _lookQuat = new THREE.Quaternion();
const _AXIS_Y = new THREE.Vector3(0, 1, 0);
const _AXIS_Z = new THREE.Vector3(0, 0, 1);
const _viewDir = new THREE.Vector3();
const _camForward = new THREE.Vector3();
const _targetQuat = new THREE.Quaternion();
// Transition-flight scratch (no per-frame alloc): target pose, aim point, and the pure look-at quat.
const _flightTo = new THREE.Vector3();
// Transition flight: the follow's smooth-time starts here (a slow sweep) and eases to the normal value;
// the bowed arc's mid-flight peak height is this fraction of the flight length.
const FLIGHT_SMOOTH_TIME = 1.1;
const FLIGHT_ARC_FRAC = 0.16;

// DECOUPLED orientation pipeline: the aim, the reading-alignment blend and the keep-in-frame clamp
// only ever compose a TARGET orientation - they are allowed to kink (threshold crossings, weight
// changes, fast shot sweeps). The camera's real orientation is written in exactly ONE place: a
// quaternion low-pass follower chasing that target at this rate. Any discontinuity upstream becomes
// a smooth turn downstream - twitching is structurally impossible, in any intensity mode.
const ORIENT_FOLLOW_RATE = 4.2;

// Grapheme-reveal fraction (0..1) of a line at `now`, interpolating within the active grapheme so it is
// continuous. Mirrors the reveal math in DioramaScene so the camera tracks the same read position the
// on-text highlight shows.
const resolveWordProgress = (line: Line, timeline: GraphemeTiming[], now: number): number => {
    if (timeline.length === 0) return 0;
    const renderEndTime = getLineRenderEndTime(line);
    if (now >= renderEndTime) return 1;
    if (now <= line.startTime) return 0;
    let revealed = 0;
    for (let i = 0; i < timeline.length; i += 1) {
        const timing = timeline[i];
        if (now >= timing.endTime) {
            revealed = i + 1;
        } else if (now >= timing.startTime) {
            const span = Math.max(timing.endTime - timing.startTime, 0.001);
            revealed = i + clamp01((now - timing.startTime) / span);
            break;
        } else {
            break;
        }
    }
    return revealed / timeline.length;
};

const CameraRig: React.FC<CameraRigProps> = ({
    currentTime,
    sequencer,
    globalIndex,
    activeLineWidthRef,
    motion,
    transitionEpoch,
}) => {
    // Cinematic transition flight: on an epoch change the camera snapshots its current pose and flies a
    // bowed eased arc to the incoming scene's live follow pose over TRANSITION_DURATION, then releases
    // back to the normal SmoothDamp follow (which continues seamlessly from the arrival pose).
    const flightRef = useRef({
        flying: false,
        epoch: 0,
        start: 0,
        perp: new THREE.Vector3(),
        side: 1,
        flightLen: 1,
    });
    const posRef = useRef(new THREE.Vector3(0, 0.6, 9));
    const posVelRef = useRef(new THREE.Vector3(0, 0, 0));
    const lookRef = useRef(new THREE.Vector3(0, 0, -10));
    const lookVelRef = useRef(new THREE.Vector3(0, 0, 0));
    // Smoothed reading-alignment weight (0 = free spatial look, 1 = fully squared on the lyric plane).
    const alignRef = useRef(0);
    // Smoothed alignment ORIENTATION: the target text-plane pose jumps instantly at a line change (new
    // frame basis + new roll/yaw), so the camera never chases it directly - it chases this quaternion,
    // which slerps toward the target every frame. Squaring up on a newly-tilted line thereby plays as a
    // smooth pan/roll move (the re-alignment IS a camera move), never a cut.
    const alignQuatRef = useRef(new THREE.Quaternion());
    const alignQuatInitRef = useRef(false);
    // The orientation FOLLOWER (see ORIENT_FOLLOW_RATE): the only state that reaches camera.quaternion.
    const orientRef = useRef(new THREE.Quaternion());
    const orientInitRef = useRef(false);

    // Resolve the sticky global index to its segment/local line/world frame in the continuous tunnel.
    // Everything downstream reads the LOCAL index + segment seed, so each song keeps its own
    // deterministic shot language even though the camera flies one unbroken path across all of them.
    const resolved = useMemo(() => resolveGlobal(sequencer, globalIndex), [sequencer, globalIndex]);

    // Grapheme timeline, assigned shot and text placement for the current line - rebuilt only when the
    // resolved line (or the weave scale) changes, never per frame.
    const line = resolved?.line ?? null;
    const timeline = useMemo(() => (line ? buildLineGraphemeTimeline(line) : []), [line]);
    const shotKind: DioramaShotKind = useMemo(
        () => (resolved ? getDioramaShot(resolved.localIndex, resolved.segment.lines, resolved.segment.seed, motion.subMode) : 'hold'),
        [resolved, motion.subMode]
    );
    const placement = useMemo(
        () => getDioramaTextPlacement(resolved?.localIndex ?? 0, resolved?.segment.seed, motion.weaveScale),
        [resolved, motion.weaveScale]
    );

    useFrame((state, delta) => {
        // Frame-lock: if the index can't resolve to a real path frame this frame (a transient during a
        // song swap), HOLD the current pose rather than compute one from the origin default frame - a
        // held pose is invisible, an origin snap is a twitch. The camera never renders a default pose.
        if (!resolved) return;
        const now = currentTime.get();
        const wordProgress = line ? resolveWordProgress(line, timeline, now) : 0;
        // Time-progress through the line (0 at start, 1 once fully sung / held in a gap) - drives the arc.
        let progress = line ? 1 : 0;
        if (line) {
            const renderEndTime = getLineRenderEndTime(line);
            const span = renderEndTime - line.startTime;
            progress = span > 0 ? clamp01((now - line.startTime) / span) : now >= line.startTime ? 1 : 0;
        }

        const camera = state.camera as THREE.PerspectiveCamera;
        const aspect = camera.isPerspectiveCamera ? camera.aspect : 1;
        const fov = camera.isPerspectiveCamera ? camera.fov : 55;
        const visibleHalf = frameHalfWidth(DIORAMA_HERO_DISTANCE, fov, aspect) * DIORAMA_SAFE_FRAME_FRACTION;

        // Local frame of the current line on the winding path. Everything below is composed in it.
        const frame = resolved ? resolved.frame : getFrame([], 0);
        const R = frame.right;
        const U = frame.up;
        const F = frame.forward;

        // A shot held far past its line resolves back to a clean frame on the lyric it is showing (see
        // resolveHoldSettle): the excursion, the truck and the look offset all release together, so an
        // instrumental gets one slow settling move instead of a frozen pose with the line off the edge.
        const settle = line ? resolveHoldSettle(now - getLineRenderEndTime(line)) : 1;

        // Read-head = the line's ACTUAL text position (path anchor + placement offsets) + the lateral
        // truck that follows the sung word.
        const truck = resolveReadHeadTruck(wordProgress, activeLineWidthRef.current, visibleHalf) * settle;
        const headR = placement.offsetR + truck;
        const headU = placement.offsetU;
        const baseX = frame.position.x + R.x * headR + U.x * headU;
        const baseY = frame.position.y + R.y * headR + U.y * headU;
        const baseZ = frame.position.z + R.z * headR + U.z * headU;

        // Shot offset (local right/up/back) + faint idle drift, composed with the frame into a world pose.
        // Seed + LOCAL index (not global) so the shot handedness matches this song's formation build.
        const shotSeed = resolved?.segment.seed;
        const shot = resolveShotOffset(shotKind, {
            progress,
            wordProgress,
            hero: DIORAMA_HERO_DISTANCE,
            lift: DIORAMA_CAMERA_LIFT,
            seed: shotSeed,
            lineIndex: resolved?.localIndex ?? 0,
            // moveScale IS the excursion away from the neutral trailing pose, so the settle rides it.
            moveScale: motion.moveScale * settle,
        });
        const drift = resolveCameraDrift(now, shotSeed, motion.driftScale);
        const offRight = shot.right + drift.swayX;
        const offUp = shot.up + drift.swayY + drift.lift;
        const offBack = shot.back + drift.dist;
        const poseX = baseX + R.x * offRight + U.x * offUp - F.x * offBack;
        const poseY = baseY + R.y * offRight + U.y * offUp - F.y * offBack;
        const poseZ = baseZ + R.z * offRight + U.z * offUp - F.z * offBack;

        // ── Cinematic transition flight (flavours the normal follow, never replaces it) ────────────
        // On an epoch bump (song change / loop) `pose` now belongs to the incoming corridor far away.
        // Instead of a rigid path that ignores the live target, the flight FLAVOURS the normal follow for
        // TRANSITION_DURATION: it suppresses the seek-snap (the big jump is flown, not cut), stretches the
        // smooth-time to a slow sweep that eases back to normal, and adds a decaying perpendicular ARC +
        // BANK + aim SWEEP. Because the underlying move stays a SmoothDamp toward the LIVE pose, a song that
        // is already singing (its read-head stepping forward mid-flight) is tracked smoothly - no juddering
        // toward a stale target, no snap onto the current lyric at the end, no fixed path to go stale.
        const flight = flightRef.current;
        if (transitionEpoch !== flight.epoch && transitionEpoch > 0) {
            flight.epoch = transitionEpoch;
            flight.flying = true;
            flight.start = state.clock.elapsedTime;
            _flightTo.set(poseX, poseY, poseZ);
            const perp = flightPerp(posRef.current, _flightTo);
            flight.perp.set(perp.x, perp.y, perp.z);
            flight.side = flightSide(shotSeed, transitionEpoch);
            flight.flightLen = posRef.current.distanceTo(_flightTo);
        }
        let flying = false;
        let te = 1;
        if (flight.flying) {
            te = (state.clock.elapsedTime - flight.start) / TRANSITION_DURATION;
            if (te >= 1) flight.flying = false;
            else flying = true;
        }
        // Longer smooth-time at the start easing to normal; a sin^2 envelope for the arc/bank/sweep. sin^2
        // is zero in BOTH value AND velocity at te=0 and te=1 (unlike plain sin, whose velocity is nonzero
        // at the ends) - so the arc offset releases with zero speed as the flight lands, instead of being
        // dropped mid-motion and kicking the camera (the little bounce right before the next lyric).
        const followSmooth = flying
            ? FLIGHT_SMOOTH_TIME + (motion.smoothTime - FLIGHT_SMOOTH_TIME) * transitionEase(te)
            : motion.smoothTime;
        const swayEnv = flying ? Math.sin(Math.PI * te) ** 2 : 0;
        const arcMag = swayEnv * flight.flightLen * FLIGHT_ARC_FRAC;
        const sweepMag = swayEnv * flight.flightLen * TRANSITION_AIM_SWEEP * flight.side;
        const bank = swayEnv * TRANSITION_BANK * flight.side;

        // SmoothDamp the camera toward the pose (critically damped, carries velocity -> smooth ease in and
        // out even when the read-head steps at a line change). Snap only on a real seek (a big jump while
        // NOT flying); a flight's far jump is flown by the stretched smooth-time above.
        const posGap = Math.hypot(poseX - posRef.current.x, poseY - posRef.current.y, poseZ - posRef.current.z);
        const snapped = !flying && posGap > DIORAMA_SNAP_DISTANCE;
        if (snapped) {
            posRef.current.set(poseX, poseY, poseZ);
            posVelRef.current.set(0, 0, 0);
        } else {
            const sx = smoothDamp(posRef.current.x, poseX, posVelRef.current.x, followSmooth, delta);
            const sy = smoothDamp(posRef.current.y, poseY, posVelRef.current.y, followSmooth, delta);
            const sz = smoothDamp(posRef.current.z, poseZ, posVelRef.current.z, followSmooth, delta);
            posRef.current.set(sx.value, sy.value, sz.value);
            posVelRef.current.set(sx.velocity, sy.velocity, sz.velocity);
        }
        // The bowed ARC is a decaying visual offset ON TOP of the damped follow (never stored in posRef, so
        // it can't accumulate or kink the handoff): a perpendicular bow plus an upward crane lift.
        camera.position.set(
            posRef.current.x + flight.perp.x * arcMag,
            posRef.current.y + flight.perp.y * arcMag + arcMag * 0.5,
            posRef.current.z + flight.perp.z * arcMag
        );

        // Aim beside the read-head by the line's compositional look offset (rule-of-thirds framing: the
        // text sits off-centre, the formation fills the rest), SmoothDamped the same way so the look flows
        // with the camera. During a flight the aim also SWEEPS sideways (a graceful mid-flight reframe).
        const lookOff = placement.lookR * settle;
        const lookX = baseX + R.x * lookOff + flight.perp.x * sweepMag;
        const lookY = baseY + R.y * lookOff + flight.perp.y * sweepMag;
        const lookZ = baseZ + R.z * lookOff + flight.perp.z * sweepMag;
        const lookGap = Math.hypot(lookX - lookRef.current.x, lookY - lookRef.current.y, lookZ - lookRef.current.z);
        if (!flying && lookGap > DIORAMA_SNAP_DISTANCE) {
            lookRef.current.set(lookX, lookY, lookZ);
            lookVelRef.current.set(0, 0, 0);
        } else {
            const lx = smoothDamp(lookRef.current.x, lookX, lookVelRef.current.x, followSmooth, delta);
            const ly = smoothDamp(lookRef.current.y, lookY, lookVelRef.current.y, followSmooth, delta);
            const lz = smoothDamp(lookRef.current.z, lookZ, lookVelRef.current.z, followSmooth, delta);
            lookRef.current.set(lx.value, ly.value, lz.value);
            lookVelRef.current.set(lx.velocity, ly.velocity, lz.velocity);
        }

        // Reset up before every lookAt: three.js derives roll from `camera.up` at lookAt time. Forcing
        // world-up keeps the horizon level (no roll/dutch tilt) even as the aim swings along the path.
        camera.up.copy(UP);
        camera.lookAt(lookRef.current);

        // Reading-alignment (回正): ease the camera's orientation toward the TEXT PLANE's orientation,
        // weighted by readNeed x the shot's alignment ceiling (see ALIGN_SHOT_CEILING). Matching the
        // text's basis means the view axis squares toward the lyric AND the camera's up follows the
        // line's roll - a staged tilted line reads near-level on screen. Position keeps its shot
        // offsets, so the framing keeps its spatial feel.
        //
        // The TARGET pose jumps at every line change (new basis, new roll/yaw), so the camera chases a
        // SMOOTHED copy of it (alignQuatRef, always tracking - even at weight 0 - so it is never stale
        // when a line starts): re-aligning to the next line's tilt is thereby itself a smooth pan/roll
        // camera move, never a cut. A position snap (seek) hard-resets it alongside.
        _alignRight.set(R.x, R.y, R.z);
        _alignUp.set(U.x, U.y, U.z);
        _alignFwd.set(-F.x, -F.y, -F.z);
        _alignMatrix.makeBasis(_alignRight, _alignUp, _alignFwd);
        _alignQuat.setFromRotationMatrix(_alignMatrix);
        if (placement.yaw !== 0) _alignQuat.multiply(_tiltQuat.setFromAxisAngle(_AXIS_Y, placement.yaw));
        if (placement.roll !== 0) _alignQuat.multiply(_tiltQuat.setFromAxisAngle(_AXIS_Z, placement.roll));
        if (snapped || !alignQuatInitRef.current) {
            alignQuatRef.current.copy(_alignQuat);
            alignQuatInitRef.current = true;
        } else {
            alignQuatRef.current.slerp(_alignQuat, 1 - Math.exp(-ALIGN_TURN_RATE * delta));
        }

        // Continuous reading-need: smooth ramps around the sung window (never a binary state), scaled
        // by the current shot's own alignment ceiling so expressive moves keep their character. Gaps
        // ramp to zero - the spatial moves between lines stay completely free.
        let readTarget = 0;
        if (line) {
            const renderEnd = getLineRenderEndTime(line);
            const rampIn = smoothstep01((now - (line.startTime - ALIGN_LEAD_IN)) / (ALIGN_LEAD_IN + ALIGN_SETTLE));
            const rampOut = 1 - smoothstep01((now - renderEnd) / ALIGN_RELEASE);
            readTarget = Math.min(rampIn, rampOut) * (ALIGN_SHOT_CEILING[shotKind] ?? 0.7);
        }
        alignRef.current += (readTarget - alignRef.current) * (1 - Math.exp(-ALIGN_RATE * delta));

        // ---- Orientation TARGET composition (allowed to kink) ----
        // camera.lookAt above produced the pure aim orientation; everything from here composes a
        // target only - nothing below this block writes the camera directly.
        _lookQuat.copy(camera.quaternion);
        _targetQuat.copy(_lookQuat).slerp(alignQuatRef.current, alignRef.current);

        // Keep-in-frame on the TARGET: if the alignment blend would carry the read-head out of the
        // safe cone (large lateral shot offsets, chaotic mode), pull the target back toward the pure
        // aim just enough. Any threshold kink this creates is absorbed by the follower below.
        _viewDir.subVectors(lookRef.current, camera.position).normalize();
        _camForward.set(0, 0, -1).applyQuaternion(_targetQuat);
        const offAxisAngle = _camForward.angleTo(_viewDir);
        const halfV = THREE.MathUtils.degToRad(fov) / 2;
        const halfH = Math.atan(Math.tan(halfV) * aspect);
        const maxOffAxis = Math.min(halfV, halfH) * FRAME_KEEP_FRACTION;
        if (offAxisAngle > maxOffAxis) {
            _targetQuat.slerp(_lookQuat, 1 - maxOffAxis / offAxisAngle);
        }

        // ---- Orientation FOLLOWER (the only writer of camera.quaternion) ----
        // A quaternion low-pass chasing the composed target: upstream kinks become smooth turns.
        // Seeks (position snaps) hard-reset it so a jump-cut stays a clean cut.
        if (snapped || !orientInitRef.current) {
            orientRef.current.copy(_targetQuat);
            orientInitRef.current = true;
        } else {
            orientRef.current.slerp(_targetQuat, 1 - Math.exp(-ORIENT_FOLLOW_RATE * delta));
        }
        camera.quaternion.copy(orientRef.current);
        // Decaying bank INTO the arc (visual only, like the position arc): a roll about the view axis that
        // peaks mid-flight and is zero by the end, so it releases seamlessly into the level follow.
        if (bank !== 0) camera.rotateZ(bank);
    });

    return null;
};

export default CameraRig;
