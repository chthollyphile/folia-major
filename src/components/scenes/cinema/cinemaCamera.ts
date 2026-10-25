import * as THREE from 'three';
import type { SceneAnchor, SceneContext } from '../definition';
import type { CameraRig } from '../kit/camera';
import { rowFloor, rowZ } from './cinemaLayout';

// src/components/scenes/cinema/cinemaCamera.ts
// The hall's tour: a slow filmed walk round the hall (a push down the aisle, a dolly along a row with the
// seat backs passing close, a crane up, a low angle by the aisle), with a little handheld weight and the
// head turned toward the pointer (ctx.input). The route is published as a path anchor; the rig walks the
// anchor's points on a smooth curve, each stop with its own width of view.

/** One stop of the tour: where the camera is, where it looks, how wide (tangent of half the horizontal view). */
interface Shot {
    position: [number, number, number];
    target: [number, number, number];
    halfTan: number;
    /** Seconds from this stop to the next. */
    seconds: number;
}

/** A seated view: about 70 degrees across, the screen and some of the hall round it. */
export const SEAT_HALF_TAN = 0.7;

/** Eye height for a camera in the leg room in front of a row's seats. */
const legroom = (row: number, x: number, eye = 1.12): [number, number, number] => [x, rowFloor(row) + eye, rowZ(row, x) - 0.32];

/** The tour: the whole hall, the screen always in the picture. */
const HALL_SHOTS: Shot[] = [
    // Wide from the back, above the heads.
    { position: [-2.6, rowFloor(13) + 2.5, 21], target: [0, 4.6, 0], halfTan: 0.8, seconds: 24 },
    // Down the aisle, slowly pushing in.
    { position: [4.5, rowFloor(10) + 1.55, rowZ(10, 4.5) - 0.5], target: [0.6, 5.0, 0], halfTan: 0.7, seconds: 20 },
    { position: [4.4, rowFloor(6) + 1.5, rowZ(6, 4.4) - 0.5], target: [0.3, 5.2, 0], halfTan: 0.66, seconds: 14 },
    // Into a row: a lateral dolly at a seated eye, the row in front passing close below.
    { position: legroom(7, 3.2, 1.16), target: [0.9, 4.6, 0], halfTan: 0.74, seconds: 26 },
    { position: legroom(7, -3.0, 1.16), target: [-0.7, 4.6, 0], halfTan: 0.74, seconds: 22 },
    // A crane up and back toward the height of the boxes.
    { position: [-4.6, 6.6, 16.5], target: [-0.4, 5.0, 0], halfTan: 0.72, seconds: 22 },
    // Low in the aisle, looking up past the seat ends.
    { position: [4.45, rowFloor(3) + 0.85, rowZ(3, 4.45) - 0.55], target: [0.2, 5.7, 0], halfTan: 0.86, seconds: 18 },
    // Rising back up the aisle to the back.
    { position: [4.0, rowFloor(8) + 1.7, rowZ(8, 4.0) - 0.4], target: [0.2, 5.0, 0], halfTan: 0.74, seconds: 22 },
];


/** How far the pointer turns the head, in radians. */
const POINTER_YAW = THREE.MathUtils.degToRad(15);
const POINTER_PITCH = THREE.MathUtils.degToRad(8);
/** After this long without a move, the head turns back to where the tour looks. */
const POINTER_REST_MS = 3500;

export const TOUR_PATH_ID = 'tour';

/** The tour as the path anchor the hall publishes. */
export const tourPathAnchor = (): Extract<SceneAnchor, { kind: 'path' }> => ({
    kind: 'path',
    id: TOUR_PATH_ID,
    points: HALL_SHOTS.map(shot => ({ position: shot.position, lookAt: shot.target, seconds: shot.seconds })),
});

const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Sets the vertical view for a horizontal half-width (tangent), capped for tall windows. */
export const fitView = (camera: THREE.PerspectiveCamera, halfTan: number) => {
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.min(halfTan / camera.aspect, 0.78)));
    if (Math.abs(fov - camera.fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
};

/** Walks the tour path anchor; paused (dt 0) it holds. The head follows the pointer while the music plays. */
export const tourRig = (ctx: SceneContext): CameraRig => {
    let built: { points: readonly unknown[]; positions: THREE.CatmullRomCurve3; targets: THREE.CatmullRomCurve3; seconds: number[]; total: number } | null = null;
    const curves = () => {
        const points = ctx.anchors.list('path').find(entry => entry.id === TOUR_PATH_ID)?.points ?? [];
        if (points.length < 2) return null;
        if (built?.points !== points) {
            const seconds = points.map(point => Math.max(0.001, point.seconds));
            built = {
                points,
                positions: new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point.position)), true, 'centripetal'),
                targets: new THREE.CatmullRomCurve3(points.map(point => new THREE.Vector3(...point.lookAt)), true, 'centripetal'),
                seconds,
                total: seconds.reduce((sum, value) => sum + value, 0),
            };
        }
        return built;
    };
    // Start a little into the first move, so the first picture is already travelling.
    let tour = HALL_SHOTS[0].seconds * 0.15;
    let clock = 0;
    const head = { yaw: 0, pitch: 0 };
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();

    const update = (camera: THREE.PerspectiveCamera, dt: number) => {
        const route = curves();
        if (!route) return;
        const { seconds, total } = route;
        tour = (tour + dt) % total;
        clock += dt;
        // Which move the tour is in, and how far along; each move eases a little at its ends.
        let index = 0;
        let start = 0;
        while (index < seconds.length - 1 && tour >= start + seconds[index]) {
            start += seconds[index];
            index += 1;
        }
        const local = (tour - start) / seconds[index];
        const eased = THREE.MathUtils.lerp(local, smoother(local), 0.55);
        const u = (index + eased) / seconds.length;
        route.positions.getPoint(u, position);
        route.targets.getPoint(u, target);
        const halfTanAt = (at: number) => HALL_SHOTS[at % HALL_SHOTS.length]?.halfTan ?? SEAT_HALF_TAN;
        const halfTan = THREE.MathUtils.lerp(halfTanAt(index), halfTanAt(index + 1), smoother(local));

        // Handheld weight: a slow breath in the camera's height and a few slow, unrelated sways.
        position.y += Math.sin(clock * 0.43) * 0.012 + Math.sin(clock * 0.21 + 1.3) * 0.01;
        camera.position.copy(position);
        camera.up.set(0, 1, 0);
        camera.lookAt(target);

        if (dt > 0) {
            const pointer = ctx.input.pointer();
            const resting = pointer.restMs > POINTER_REST_MS;
            const aimYaw = resting ? 0 : -pointer.x * POINTER_YAW;
            const aimPitch = resting ? 0 : pointer.y * POINTER_PITCH;
            // Follows the pointer like a head turning; going back to rest is slower still.
            const rate = resting ? 0.9 : 2.4;
            const k = 1 - Math.exp(-rate * Math.min(dt, 0.1));
            head.yaw += (aimYaw - head.yaw) * k;
            head.pitch += (aimPitch - head.pitch) * k;
        }
        camera.rotateY(head.yaw + Math.sin(clock * 0.31 + 0.7) * 0.0035 + Math.sin(clock * 0.77) * 0.0012);
        camera.rotateX(head.pitch + Math.sin(clock * 0.37 + 2.1) * 0.0025 + Math.sin(clock * 0.93 + 0.4) * 0.001);
        camera.rotateZ(Math.sin(clock * 0.19 + 0.3) * 0.0028);
        fitView(camera, halfTan);
        camera.updateMatrixWorld();
    };

    return { update };
};
