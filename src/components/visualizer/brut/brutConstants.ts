// src/components/visualizer/brut/brutConstants.ts
// Single source of truth for the light-well geometry, recycling windows and per-frame budgets.

/** Inner half-width of the shaft. Walls sit at |x| = |z| = BRUT_SHAFT_HALF. */
export const BRUT_SHAFT_HALF = 4.2;

/** World height consumed by one RENDERED lyric line. The camera ascends, so this is +Y. */
export const BRUT_LINE_RISE = 3.35;

/** Rendered lines hosted by one recyclable facade module. */
export const BRUT_MODULE_LINES = 3;
export const BRUT_MODULE_HEIGHT = BRUT_LINE_RISE * BRUT_MODULE_LINES;

/** Modules kept alive around the camera, and how many of them sit below it. */
export const BRUT_MODULE_WINDOW = 6;
export const BRUT_MODULE_BELOW = 2;
export const BRUT_SHELL_HEIGHT = BRUT_MODULE_HEIGHT * BRUT_MODULE_WINDOW;

/** Vertical subdivisions of the shell, used only to carry the depth gradient in vertex colors. */
export const BRUT_SHELL_ROWS = 24;
export const BRUT_FACE_COUNT = 4;

/**
 * World units per concrete texture tile. The vertical tile MUST divide BRUT_MODULE_HEIGHT into a
 * whole number of tiles, otherwise the shell's module-sized snap shifts the texture and the wall
 * visibly jumps every recycle. Covered by brutShaftConstants.test.ts.
 */
export const BRUT_SHELL_TILE_V = BRUT_MODULE_HEIGHT / 3;
export const BRUT_SHELL_TILE_U = 3.9;

/** Relief blocks per module: BRUT_MODULE_LINES mounting pads plus decorative ribs, always exactly this many. */
export const BRUT_BLOCKS_PER_MODULE = 20;
export const BRUT_RELIEF_COUNT = BRUT_MODULE_WINDOW * BRUT_BLOCKS_PER_MODULE;

/** Recessed light strips and spray marks per module. */
export const BRUT_CHANNELS_PER_MODULE = 8;
export const BRUT_GRAFFITI_PER_MODULE = 4;

/** Mounting pad the lyric frame is bolted onto. Fixed size so relief stays independent of raster width. */
export const BRUT_PAD_HALF_WIDTH = 2.6;
export const BRUT_PAD_HEIGHT = 2.65;
export const BRUT_PAD_DEPTH = 0.46;

/**
 * Only ROLL is allowed on a lyric block. Roll turns the block in its own plane and costs nothing;
 * a yaw or a pitch would tilt the plane off the wall, and across a block several units wide that
 * swings the far end deeper than the mount itself - which is how tokens end up buried in concrete.
 */
export const BRUT_FRAME_MAX_ROLL = 0.02;

/** A face change may only happen after this many ordinals, and only ever by one step. */
export const BRUT_FACE_STEP_INTERVAL = 2;

/** Lyric window around the active line. */
export const BRUT_LINES_BEHIND = 4;
export const BRUT_LINES_AHEAD = 8;
export const BRUT_FRAME_SLOTS = BRUT_LINES_BEHIND + BRUT_LINES_AHEAD + 1;

/** World size of one em of lyric text before the user's font scale is applied. */
export const BRUT_GLYPH_EM = 0.36;

/** Scatter layout: tokens flow in rows of this many em, stepping down by the row step. */
export const BRUT_UNIT_ROW_EM = 17;
export const BRUT_UNIT_ROW_STEP_EM = 1.9;
export const BRUT_UNIT_GAP_EM = 0.36;

/** Depth of the slab that pushes out of the wall to carry one token. */
export const BRUT_SLAB_DEPTH = 0.17;
/** Slab overhang around its token, wide enough to still frame it during the ignition swell. */
export const BRUT_SLAB_MARGIN_EM = 0.2;

/** How many already-sung lines stay on the wall behind the active one. */
export const BRUT_INSTALLED_LINES = 2;

/** Raster + install budgets. */
export const BRUT_MAX_INSTALL_UNITS = 40;
export const BRUT_GLYPH_SLOTS = 48;
export const BRUT_RASTER_CACHE_MAX = 12;
export const BRUT_RASTER_BUILD_BUDGET = 2;
export const BRUT_RASTER_FONT_PX = 128;
export const BRUT_RASTER_MAX_CANVAS_PX = 2048;

/** World width a lyric frame may never exceed. */
/** A block never exceeds its mounting pad, so every token slab has flat wall to grow from. */
export const BRUT_FRAME_MAX_WIDTH = 4.9;

/** Camera. */
/**
 * The camera rides BELOW the active line and rises toward it. At eye level a wall-mounted sign is
 * seen edge-on and becomes unreadable, so the eye trails the frame and the frame tilts down to meet
 * it - which is also how signage on a real facade is mounted.
 */
export const BRUT_EYE_LEAD = -1.35;
/**
 * The camera does not sit at a fixed distance: it backs off until the active line fills a constant
 * share of the frame, so a 40-character line is not rendered a third the height of a 10-character
 * one. These bound how far it may travel along the active wall's normal.
 */
export const BRUT_ORBIT_MIN = -1.2;
export const BRUT_ORBIT_MAX = 6.4;
export const BRUT_ORBIT_RADIUS = 1.6;
/** Share of the visible width the active line should occupy. */
export const BRUT_FRAME_SCREEN_FILL = 0.6;
export const BRUT_SEEK_JUMP_LINES = 2;
export const BRUT_FOG_NEAR = 11;
export const BRUT_FOG_FAR = 62;
export const BRUT_CAMERA_NEAR = 0.12;
export const BRUT_CAMERA_FAR = 140;
export const BRUT_MOUTH_LEAD_START = 78;
export const BRUT_MOUTH_LEAD_END = 46;
