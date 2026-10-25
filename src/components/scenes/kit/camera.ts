import * as THREE from 'three';
import type { LyricPhase, SceneContext } from '../definition';

// src/components/scenes/kit/camera.ts
// 可选工具箱：机位和导演。seatRig 坐在座位上、鼠标转头；pathRig 沿 path 锚点慢慢走；
// phaseDirector 按歌词阶段选机位：下一句还很远时去巡游，下一句前几秒回到座位。只动摄像机，听者不跟它。

export interface CameraRig {
    update: (camera: THREE.PerspectiveCamera, dt: number) => void;
}

const DEG = Math.PI / 180;

export interface SeatRigOptions {
    /** The seat anchor's id; without one, the user's seat, else the preferred one, else the first. */
    seat?: string | (() => string | undefined);
    /** How far the pointer turns the head, in degrees. */
    clampDeg?: number;
    /** A tighter turn while a line is sung (the hall: about 6°). */
    singingClampDeg?: number;
    /** How quickly the head follows (per second). */
    follow?: number;
}

export const seatRig = (ctx: SceneContext, options: SeatRigOptions = {}): CameraRig => {
    let yaw = 0;
    let pitch = 0;
    return {
        update: (camera, dt) => {
            const seats = ctx.anchors.list('seat');
            const wanted = typeof options.seat === 'function' ? options.seat() : options.seat;
            const seat = seats.find(entry => entry.id === wanted) ?? seats.find(entry => entry.preferred) ?? seats[0];
            if (!seat) return;
            const singing = ctx.lyrics.phase() === 'singing' && options.singingClampDeg !== undefined;
            const limit = (singing ? options.singingClampDeg! : options.clampDeg ?? 12) * DEG;
            const pointer = ctx.input.pointer();
            const k = 1 - Math.exp(-(options.follow ?? 4) * dt);
            yaw += (-pointer.x * limit - yaw) * k;
            pitch += (pointer.y * limit * 0.5 - pitch) * k;
            camera.position.set(...seat.eye);
            camera.lookAt(...seat.lookAt);
            camera.rotateY(yaw);
            camera.rotateX(pitch);
        },
    };
};

/** Walks a path anchor's points, each segment over its seconds, eased, round and round. */
export const pathRig = (ctx: SceneContext, pathId: string): CameraRig => {
    let elapsed = 0;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const look = new THREE.Vector3();
    const lookTo = new THREE.Vector3();
    return {
        update: (camera, dt) => {
            const points = ctx.anchors.list('path').find(entry => entry.id === pathId)?.points ?? [];
            if (points.length === 0) return;
            const total = points.reduce((sum, entry) => sum + Math.max(0.001, entry.seconds), 0);
            elapsed = (elapsed + dt) % total;
            let index = 0;
            let start = 0;
            while (start + Math.max(0.001, points[index].seconds) < elapsed) {
                start += Math.max(0.001, points[index].seconds);
                index += 1;
            }
            const a = points[index];
            const b = points[(index + 1) % points.length];
            const t = THREE.MathUtils.smoothstep((elapsed - start) / Math.max(0.001, a.seconds), 0, 1);
            camera.position.copy(from.set(...a.position).lerp(to.set(...b.position), t));
            camera.lookAt(look.set(...a.lookAt).lerp(lookTo.set(...b.lookAt), t));
        },
    };
};

export type DirectorShot = 'seat' | 'tour';

export interface DirectorTiming {
    /** Go touring when the next line is at least this far (seconds). */
    tourAfterSec: number;
    /** Be back in the seat this long before the next line. */
    leadInSec: number;
}

export const DEFAULT_DIRECTOR_TIMING: DirectorTiming = { tourAfterSec: 10, leadInSec: 2.5 };

/** The shot for this moment, given the one on now (the gap between the two thresholds keeps it from flickering). */
export const chooseDirectorShot = (current: DirectorShot, phase: LyricPhase, nextLineIn: number, timing: DirectorTiming = DEFAULT_DIRECTOR_TIMING): DirectorShot => {
    if (phase === 'singing') return 'seat';
    if (current === 'seat') return nextLineIn >= timing.tourAfterSec ? 'tour' : 'seat';
    return nextLineIn <= timing.leadInSec ? 'seat' : 'tour';
};

/** Picks the seat or the tour by the lyric phase and moves between them over `blendSec`. */
export const phaseDirector = (
    ctx: SceneContext,
    rigs: { seat: CameraRig; tour: CameraRig },
    options: Partial<DirectorTiming> & { blendSec?: number } = {},
): CameraRig => {
    const timing = { ...DEFAULT_DIRECTOR_TIMING, ...options };
    const blendSec = options.blendSec ?? 2;
    let shot: DirectorShot = 'seat';
    let leaving: DirectorShot | null = null;
    let blend = 1;
    const from = new THREE.PerspectiveCamera();
    return {
        update: (camera, dt) => {
            const next = chooseDirectorShot(shot, ctx.lyrics.phase(), ctx.lyrics.nextLineIn(), timing);
            if (next !== shot) {
                leaving = shot;
                shot = next;
                blend = 0;
            }
            rigs[shot].update(camera, dt);
            if (!leaving) return;
            blend = Math.min(1, blend + dt / blendSec);
            rigs[leaving].update(from, dt);
            const t = THREE.MathUtils.smootherstep(blend, 0, 1);
            camera.position.lerpVectors(from.position, camera.position, t);
            camera.quaternion.slerpQuaternions(from.quaternion, camera.quaternion.clone(), t);
            if (blend >= 1) leaving = null;
        },
    };
};

