// Where does the CURRENT lyric actually sit in frame while the camera is parked on it?
//
// A "hold" is any moment the camera sits on a line whose reading window has closed: an instrumental,
// the last line of a song, a long gap between lines. Per CameraRig, in a hold:
//   - progress = wordProgress = 1, so resolveShotOffset returns a FROZEN end-of-move pose;
//   - alignRef has decayed to 0, so the orientation is exactly camera.lookAt(read-head + lookR);
//   - the read-head still carries the end-of-line truck.
// All of that is real exported code, so the held framing can be computed rather than watched.
//
// The control is the same line MID-LINE, where the reading alignment is at its shot ceiling - that
// is the framing the shot language was designed around, and the number to compare against.
//
// Local frame: right = +x, up = +y, corridor forward = -z (three.js camera convention), text plane
// at z = 0. Reports the NDC x of both ends of the line; |x| > 1 is off screen.

import * as THREE from 'three';
import {
    DIORAMA_CAMERA_LIFT,
    DIORAMA_HERO_DISTANCE,
    DIORAMA_SAFE_FRAME_FRACTION,
    frameHalfWidth,
    getDioramaShot,
    getDioramaTextPlacement,
    resolveCameraDrift,
    resolveHoldSettle,
    resolveReadHeadTruck,
    resolveShotOffset,
    type DioramaShotKind,
} from '../../src/components/visualizer/diorama/cameraPath';
import type { Line } from '../../src/types';

const FOV = 55;
const ASPECT = 16 / 9;
const visibleHalf = frameHalfWidth(DIORAMA_HERO_DISTANCE, FOV, ASPECT) * DIORAMA_SAFE_FRAME_FRACTION;
// resolveFrameFitScale caps a line at TARGET_FRAME_WIDTH_FRACTION (0.72) of the frame at the hero
// distance; placement.scale (0.82..1.28) multiplies on top.
const maxRenderedWidth = 2 * frameHalfWidth(DIORAMA_HERO_DISTANCE, FOV, ASPECT) * 0.72;

// Copied from CameraRig (module-private there). The probe measures the shipped numbers, so a drift
// between the two files would show up as a wrong control, not a silent pass.
const ALIGN_SHOT_CEILING: Record<DioramaShotKind, number> = {
    hold: 0.9, pushIn: 0.85, track: 0.85, swell: 0.8, float: 0.78, glide: 0.72, crane: 0.7,
    pullBack: 0.7, arc: 0.62, pendulum: 0.6, orbit: 0.55, spiral: 0.5, flyby: 0.5,
};
const FRAME_KEEP_FRACTION = 0.7;

const camera = new THREE.PerspectiveCamera(FOV, ASPECT, 0.1, 200);
const _q = new THREE.Quaternion();
const _align = new THREE.Quaternion();
const _tilt = new THREE.Quaternion();
const _fwd = new THREE.Vector3();
const _view = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const halfV = THREE.MathUtils.degToRad(FOV) / 2;
const maxOffAxis = Math.min(halfV, Math.atan(Math.tan(halfV) * ASPECT)) * FRAME_KEEP_FRACTION;

/**
 * How far the worse end of the line falls outside the frame, as a fraction of a half-frame, on
 * EITHER axis (0 = the whole line is inside). Mirrors CameraRig's orientation pipeline at settled
 * state: aim, then the reading-alignment slerp at weight `align`, then the keep-in-frame clamp.
 */
const overshoot = (
    pos: THREE.Vector3, aim: THREE.Vector3, align: number,
    yaw: number, roll: number, leftR: number, rightR: number, u: number,
): number => {
    camera.position.copy(pos);
    camera.up.set(0, 1, 0);
    camera.lookAt(aim);
    camera.updateMatrixWorld(true);
    if (align > 0) {
        _q.copy(camera.quaternion);
        _align.identity();
        if (yaw !== 0) _align.multiply(_tilt.setFromAxisAngle(AXIS_Y, yaw));
        if (roll !== 0) _align.multiply(_tilt.setFromAxisAngle(AXIS_Z, roll));
        camera.quaternion.copy(_q).slerp(_align, align);
        _view.subVectors(aim, pos).normalize();
        _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
        const offAxis = _fwd.angleTo(_view);
        if (offAxis > maxOffAxis) camera.quaternion.slerp(_q, 1 - maxOffAxis / offAxis);
        camera.updateMatrixWorld(true);
    }
    const l = new THREE.Vector3(leftR, u, 0).project(camera);
    const r = new THREE.Vector3(rightR, u, 0).project(camera);
    const worst = Math.max(Math.abs(l.x), Math.abs(r.x), Math.abs(l.y), Math.abs(r.y));
    return Math.max(0, worst - 1);
};

const modes = [
    { name: 'calm    x0.4', move: 0.6 * 0.4, drift: 0.4 * 0.4, weave: 0.5 * 0.4 },
    { name: 'normal  x1.0', move: 1, drift: 0.62, weave: 1 },
    { name: 'chaotic x1.6', move: 1.35 * 1.6, drift: 0.85 * 1.6, weave: 1.35 * 1.6 },
];

// Stand-in lines: getDioramaShot only reads their timings when weighting the shot choice.
const lines: Line[] = Array.from({ length: 24 }, (_, i) => ({
    startTime: i * 4, endTime: i * 4 + 3, text: 'x', words: [],
} as unknown as Line));

const SEEDS = ['a', 'song-2', 'zz9', 'folia', '77', 'q', 'seed-x', 'mmm'];
const DRIFT_TIMES = [0, 14, 28, 42, 57, 71, 85, 99, 113, 127];

for (const mode of modes) {
    const tally = { sung: { n: 0, off: 0, worst: 0 }, held: { n: 0, off: 0, worst: 0 }, settled: { n: 0, off: 0, worst: 0 }, 'settled+lock': { n: 0, off: 0, worst: 0 }, 'settled+ceil': { n: 0, off: 0, worst: 0 } };

    for (const seed of SEEDS) {
        for (let i = 0; i < lines.length; i += 1) {
            const p = getDioramaTextPlacement(i, seed, mode.weave);
            const kind = getDioramaShot(i, lines, seed, 'normal');
            const ctx = { hero: DIORAMA_HERO_DISTANCE, lift: DIORAMA_CAMERA_LIFT, seed, lineIndex: i, moveScale: mode.move };
            const heldShot = resolveShotOffset(kind, { ...ctx, progress: 1, wordProgress: 1 });
            const sungShot = resolveShotOffset(kind, { ...ctx, progress: 0.5, wordProgress: 0.5 });
            // The shipped settle, at a hold long enough to have fully resolved. CameraRig applies it
            // to moveScale, the truck and the look offset - all three, exactly as here.
            const settle = resolveHoldSettle(60);
            const settledShot = resolveShotOffset(kind, { ...ctx, progress: 1, wordProgress: 1, moveScale: mode.move * settle });

            for (const frac of [0.25, 0.5, 0.75, 1]) {
                const width = maxRenderedWidth * frac * p.scale;
                const leftR = p.offsetR - width / 2;
                const rightR = p.offsetR + width / 2;
                const heldTruck = resolveReadHeadTruck(1, width, visibleHalf);
                const sungTruck = resolveReadHeadTruck(0.5, width, visibleHalf);

                for (const t of DRIFT_TIMES) {
                    const d = resolveCameraDrift(t, seed, mode.drift);
                    const shots: Array<[keyof typeof tally, typeof heldShot, number, number, number]> = [
                        // mid-line, alignment at the shot's ceiling - the designed framing
                        ['sung', sungShot, sungTruck, p.lookR, ALIGN_SHOT_CEILING[kind]],
                        // held, alignment released - what an instrumental actually shows
                        ['held', heldShot, heldTruck, p.lookR, 0],
                        // held with the whole reading composition released - the shipped fix
                        ['settled', settledShot, heldTruck * settle, p.lookR * settle, 0],
                        // ...and the reading alignment brought back instead of released, which is
                        // what "the camera stops locking onto the lyric" is actually about.
                        ['settled+lock', settledShot, heldTruck * settle, p.lookR * settle, 1],
                        ['settled+ceil', settledShot, heldTruck * settle, p.lookR * settle, ALIGN_SHOT_CEILING[kind]],
                    ];
                    for (const [key, shot, truck, lookR, align] of shots) {
                        const baseR = p.offsetR + truck;
                        const pos = new THREE.Vector3(
                            baseR + shot.right + d.swayX,
                            p.offsetU + shot.up + d.swayY + d.lift,
                            shot.back + d.dist,
                        );
                        const aim = new THREE.Vector3(baseR + lookR, p.offsetU, 0);
                        const over = overshoot(pos, aim, align, p.yaw, p.roll, leftR, rightR, p.offsetU);
                        const bucket = tally[key];
                        bucket.n += 1;
                        if (over > 0) bucket.off += 1;
                        if (over > bucket.worst && Number.isFinite(over)) bucket.worst = Math.min(over, 99);
                    }
                }
            }
        }
    }

    console.log(`\n${mode.name}`);
    for (const key of ['sung', 'held', 'settled', 'settled+ceil', 'settled+lock'] as const) {
        const b = tally[key];
        console.log(`  ${key.padEnd(13)} an end off screen: ${String(b.off).padStart(5)}/${b.n}  (${(100 * b.off / b.n).toFixed(1).padStart(5)}%)   worst overshoot ${(b.worst * 100).toFixed(0)}% of a half-frame`);
    }
}
