import { BRUT_FACE_COUNT, BRUT_SHAFT_HALF } from './brutConstants';

// src/components/visualizer/brut/brutFaceBasis.ts
// The shaft's four inner walls share one right-handed local basis so relief, frames and the camera
// all agree on where a face is. For face f with angle θ = f * π/2:
//   inward normal n = ( sin θ, 0,  cos θ )   -> a mesh with rotation.y = θ maps local +Z to n
//   tangent      t = ( cos θ, 0, -sin θ )   -> local +X
//   wall centre    = -n * BRUT_SHAFT_HALF
// (t, up, n) is right-handed, so a plane's default front face points into the shaft.

export const normalizeBrutFace = (face: number): number => (
    ((face % BRUT_FACE_COUNT) + BRUT_FACE_COUNT) % BRUT_FACE_COUNT
);

export const resolveBrutFaceAngle = (face: number): number => normalizeBrutFace(face) * Math.PI / 2;

/** Converts a point on a face (lateral offset, world height, protrusion) into world space. */
export const brutFacePointToWorld = (
    face: number,
    lateral: number,
    height: number,
    depth: number,
    out: { x: number; y: number; z: number },
): void => {
    const angle = resolveBrutFaceAngle(face);
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    out.x = -sin * BRUT_SHAFT_HALF + cos * lateral + sin * depth;
    out.y = height;
    out.z = -cos * BRUT_SHAFT_HALF - sin * lateral + cos * depth;
};

/**
 * Shortest-path target yaw for the camera when the active line moves to `face`.
 * Without this the orbit would spin 270° to reach an angle 90° away.
 */
export const resolveBrutFaceYaw = (face: number, currentYaw: number): number => {
    const target = resolveBrutFaceAngle(face);
    const turn = Math.PI * 2;
    let delta = (target - currentYaw) % turn;
    if (delta > Math.PI) delta -= turn;
    if (delta < -Math.PI) delta += turn;
    return currentYaw + delta;
};
