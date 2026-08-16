// src/components/visualizer/brut/brutDepthGradient.ts
// One brightness ramp shared by the shell's vertex colors, the relief's instanceColor and the
// decals, so the walls and everything standing on them never disagree about how deep in the shaft
// they are. This is what lets the well read as infinite in BOTH directions: linear fog has a single
// colour and can only fade toward it, while this fades up toward the mouth and down toward black.
//
// The ramp is written around the CAMERA, not around a fixed height, so it is deliberately split at
// rel = 0: surfaces at eye level must stay properly lit, and only the shaft below them falls away.

/** Below this much depth under the camera the wall is effectively unlit. */
const DEPTH_BELOW = 11;
/** Above this much height over the camera the wall has reached full daylight. */
const DEPTH_ABOVE = 30;
const DEPTH_MIN = 0.035;
const DEPTH_EYE = 0.74;
const DEPTH_MAX = 1.16;

const smoothstep = (value: number) => value * value * (3 - 2 * value);

export const resolveBrutDepthBrightness = (worldY: number, cameraY: number): number => {
    const relative = worldY - cameraY;
    if (relative < 0) {
        const normalized = Math.max(0, 1 + relative / DEPTH_BELOW);
        return DEPTH_MIN + (DEPTH_EYE - DEPTH_MIN) * smoothstep(normalized);
    }
    const normalized = Math.min(1, relative / DEPTH_ABOVE);
    return DEPTH_EYE + (DEPTH_MAX - DEPTH_EYE) * smoothstep(normalized);
};
