import * as THREE from 'three';
import type { LyricPhase, SceneContext } from '../definition';

// src/components/scenes/kit/camera.ts
// 可选工具箱：机位和导演。viewpointRig 坐在座位上；pathRig 沿 path 锚点慢慢走；phaseDirector 按歌词阶段选机位：
// 下一句还很远时去巡游，下一句前几秒回到座位。用户按住拖动转头（Head，turnHead），viewpointRig 和拿到 Head 的机位
// 在自己看的方向上再转这么多。只动摄像机，听者不跟它。

export interface CameraRig {
    update: (camera: THREE.PerspectiveCamera, dt: number) => void;
}

const DEG = Math.PI / 180;
/** The head stops just short of straight up and straight down, as in a game. */
const PITCH_LIMIT = 89 * DEG;

/** How far the user has turned their head by dragging (radians, left and up positive), on top of where a rig looks. */
export interface Head {
    yaw: number;
    pitch: number;
}

/** How far a seated person turns their head to either side. */
export const YAW_LIMIT = 80 * DEG;

/** Adds this frame's drag (ctx.input.look()) to the head: once a frame, before the rigs. Left and right it stops at YAW_LIMIT. */
export const turnHead = (ctx: SceneContext, head: Head) => {
    const turned = ctx.input.look();
    head.yaw = THREE.MathUtils.clamp(head.yaw + turned.yaw, -YAW_LIMIT, YAW_LIMIT);
    head.pitch += turned.pitch;
};

const direction = new THREE.Vector3();

/** Puts the camera at `position` looking at `target`, then turned by the head. */
export const aimCamera = (camera: THREE.PerspectiveCamera, position: THREE.Vector3, target: THREE.Vector3, head: Head) => {
    direction.subVectors(target, position);
    const baseYaw = Math.atan2(-direction.x, -direction.z);
    const basePitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));
    // Held here, so dragging back down answers at once after the view has stopped at straight up.
    head.pitch = THREE.MathUtils.clamp(head.pitch, -PITCH_LIMIT - basePitch, PITCH_LIMIT - basePitch);
    camera.position.copy(position);
    camera.up.set(0, 1, 0);
    camera.rotation.set(basePitch + head.pitch, baseYaw + head.yaw, 0, 'YXZ');
};

export interface ViewpointRigOptions {
    /** The seat anchor's id; without one, the user's seat (ctx.viewpoints), else the preferred one, else the first. */
    viewpoint?: string | (() => string | undefined);
    /** The user's head (turnHead); without one the rig looks straight at the seat's lookAt. */
    head?: Head;
}

export const viewpointRig = (ctx: SceneContext, options: ViewpointRigOptions = {}): CameraRig => {
    const still: Head = { yaw: 0, pitch: 0 };
    const eye = new THREE.Vector3();
    const target = new THREE.Vector3();
    return {
        update: (camera) => {
            const seats = ctx.anchors.list('viewpoint');
            const wanted = (typeof options.viewpoint === 'function' ? options.viewpoint() : options.viewpoint) ?? ctx.viewpoints.chosen() ?? undefined;
            // A taken seat is not sat in (as the seat map shows it): the preferred one instead.
            const seat = seats.find(entry => entry.id === wanted && !entry.occupied) ?? seats.find(entry => entry.preferred) ?? seats[0];
            if (!seat) return;
            aimCamera(camera, eye.set(...seat.eye), target.set(...seat.lookAt), options.head ?? still);
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
    // A song opens in the seat: the tour is only for gaps once the singing has begun.
    if (phase === 'singing' || phase === 'intro' || phase === 'instrumental') return 'seat';
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

