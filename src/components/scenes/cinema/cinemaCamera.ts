import * as THREE from 'three';

// src/components/scenes/cinema/cinemaCamera.ts
// The width of view in the hall: the camera stays in the user's seat (kit viewpointRig); only a drag turns the head.

/** A seated view: about 70 degrees across, the screen and some of the hall round it. */
export const SEAT_HALF_TAN = 0.7;

/** Sets the vertical view for a horizontal half-width (tangent), capped for tall windows. */
export const fitView = (camera: THREE.PerspectiveCamera, halfTan: number) => {
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.min(halfTan / camera.aspect, 0.78)));
    if (Math.abs(fov - camera.fov) > 1e-4) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
    }
};
