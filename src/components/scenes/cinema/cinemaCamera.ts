import * as THREE from 'three';
import type { SceneAnchor, SceneContext } from '../definition';
import { aimCamera, type CameraRig, type Head } from '../kit/camera';
import { rowFloor, rowZ } from './cinemaLayout';

// src/components/scenes/cinema/cinemaCamera.ts
// The hall's tour: a slow filmed walk round the hall (a push down the aisle, a dolly along a row with the
// seat backs passing close, a crane up, a low angle by the aisle), with a little handheld weight and the
// user's head turned by dragging (kit Head). The route is published as a path anchor; the rig walks the
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

/** Walks the tour path anchor; paused (dt 0) it holds. The user's head turns the view on top of where the tour looks. */
export const tourRig = (ctx: SceneContext, head: Head): CameraRig => {
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
        aimCamera(camera, position, target, head);
        camera.rotateY(Math.sin(clock * 0.31 + 0.7) * 0.0035 + Math.sin(clock * 0.77) * 0.0012);
        camera.rotateX(Math.sin(clock * 0.37 + 2.1) * 0.0025 + Math.sin(clock * 0.93 + 0.4) * 0.001);
        camera.rotateZ(Math.sin(clock * 0.19 + 0.3) * 0.0028);
        fitView(camera, halfTan);
        camera.updateMatrixWorld();
    };

    return { update };
};
