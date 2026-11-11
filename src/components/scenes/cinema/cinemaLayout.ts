// src/components/scenes/cinema/cinemaLayout.ts
// The cinema hall's measurements in metres, shared by the geometry (cinemaGeometry.ts) and the
// shaders (cinemaShaders.ts reads LAYOUT_GLSL), so a light and the thing it lights cannot drift apart.
// The screen stands in the plane z = 0 and faces +z; the audience sits toward +z, y is up.

export const HALL = {
    halfWidth: 9.5,
    ceiling: 10.6,
    back: 30,
};

/**
 * 1.85 : 1 flat screen, as large as the proscenium allows with the curtains still drawn open beside
 * it: 14 m wide fills about 40 degrees of view from the back row (19.3 m away), the angle THX asks
 * of a premium hall (at least 36), well above the 30 of SMPTE EG 18. Its foot stands just above the stage.
 */
export const SCREEN = {
    width: 14,
    height: 7.57,
    centerY: 4.885,
};

/** The opening's gold frame reaches 0.5 m outside halfWidth; a fluted pilaster stands at each side. */
export const PROSCENIUM = {
    z: 0.4,
    halfWidth: 8.2,
    top: 9.7,
    pilasterInner: 8.8,
    pilasterOuter: 9.3,
};

export const STAGE = {
    front: 2.0,
    height: 0.95,
};

/** Stadium rows: curved on arcs around one focus in front of the screen, rising toward the back. */
export const ROWS = {
    first: 5.6,
    pitch: 1.05,
    count: 14,
    flatRows: 3,
    rise: 0.32,
    arcRadius: 40,
    /** How far in front of a row's seat backs its tread begins. */
    treadFront: 0.62,
};

/** Seat blocks across the hall: |x| inside the centre block, an aisle, then the side blocks. */
export const BLOCKS = {
    seatPitch: 0.56,
    centerSeats: 7,
    aisleInner: 3.92,
    aisleOuter: 5.08,
    sideSeats: 6,
};

/** Bays of the side walls; a pilaster with a sconce and a ceiling beam stand at each. */
export const BAYS = {
    first: 2.6,
    pitch: 3.4,
    count: 8,
    sconceY: 4.6,
};

export const EXIT_DOOR = {
    z: 3.4,
    width: 1.3,
    height: 2.4,
    signY: 2.78,
};

/**
 * The boxes high on the side walls between the proscenium and the first pilaster: a bowed front
 * standing out from the wall, a velvet rail on top, two little lamps on the rail.
 */
export const BOXES = {
    z0: 1.15,
    z1: 5.35,
    /** The box's floor; the front's foot hangs a little below it. */
    floorY: 4.1,
    railY: 5.15,
    /** How far the front stands out from the wall: at its ends, and at most in its middle. */
    endOut: 0.35,
    bowOut: 0.75,
    lampY: 5.42,
    /** Where along the front the two lamps stand, as a share of its length. */
    lampAt: [0.26, 0.74],
};

/** How far the box front stands out from the wall at t (0..1 along it). */
export const boxOut = (t: number) => BOXES.endOut + BOXES.bowOut * Math.sin(Math.PI * t);
const boxLampZ = (index: number) => BOXES.z0 + (BOXES.z1 - BOXES.z0) * BOXES.lampAt[index];
const boxLampX = () => HALL.halfWidth - boxOut(BOXES.lampAt[0]) + 0.08;

/** The projector's lens in the booth behind the audience: behind the back wall, so the beam comes out of the wall. */
export const PROJECTOR = {
    y: 8.9,
    z: HALL.back + 1,
};

export const STAGE_LIGHTS = {
    footY: 1.02,
    footZ: 1.92,
    footHalfWidth: PROSCENIUM.halfWidth - 0.7,
};

const rowRadius = (row: number) => ROWS.arcRadius + row * ROWS.pitch;
const focusZ = ROWS.first - ROWS.arcRadius;

/** The z of a row's seat backs at lateral position x (rows bow toward the screen at the sides). */
export const rowZ = (row: number, x: number) => {
    const radius = rowRadius(row);
    return focusZ + Math.sqrt(radius * radius - x * x);
};

/** How far a seat at x turns toward the hall's axis, in radians about y. */
export const rowYaw = (row: number, x: number) => Math.asin(x / rowRadius(row));

/** Floor height of a row's tread. */
export const rowFloor = (row: number) => Math.max(0, row - ROWS.flatRows + 1) * ROWS.rise;

/** The lateral positions of the seats in one row, left to right. */
export const seatXs = (): number[] => {
    const xs: number[] = [];
    const half = BLOCKS.seatPitch / 2;
    for (let index = 0; index < BLOCKS.centerSeats; index += 1) {
        const x = half + index * BLOCKS.seatPitch;
        xs.push(-x, x);
    }
    for (let index = 0; index < BLOCKS.sideSeats; index += 1) {
        const x = BLOCKS.aisleOuter + half + index * BLOCKS.seatPitch;
        xs.push(-x, x);
    }
    return xs.sort((left, right) => left - right);
};

export const bayZ = (index: number) => BAYS.first + index * BAYS.pitch;

const f = (value: number) => value.toFixed(4);

/** The same measurements as GLSL constants for the shaders. */
export const LAYOUT_GLSL = `
const float HALL_HALF_WIDTH = ${f(HALL.halfWidth)};
const float HALL_CEILING = ${f(HALL.ceiling)};
const float SCREEN_W = ${f(SCREEN.width)};
const float SCREEN_H = ${f(SCREEN.height)};
const float SCREEN_CY = ${f(SCREEN.centerY)};
const float PROSC_Z = ${f(PROSCENIUM.z)};
const float PROSC_HALF_WIDTH = ${f(PROSCENIUM.halfWidth)};
const float PILASTER_X = ${f((PROSCENIUM.pilasterInner + PROSCENIUM.pilasterOuter) / 2)};
const float ROW_FIRST = ${f(ROWS.first)};
const float ROW_PITCH = ${f(ROWS.pitch)};
const float ROW_COUNT = ${f(ROWS.count)};
const float ROW_FLAT = ${f(ROWS.flatRows)};
const float ROW_RISE = ${f(ROWS.rise)};
const float ROW_RADIUS = ${f(ROWS.arcRadius)};
const float ROW_TREAD_FRONT = ${f(ROWS.treadFront)};
const float AISLE_INNER = ${f(BLOCKS.aisleInner)};
const float AISLE_OUTER = ${f(BLOCKS.aisleOuter)};
const float SIDE_EDGE = ${f(BLOCKS.aisleOuter + BLOCKS.sideSeats * BLOCKS.seatPitch)};
const float BAY_FIRST = ${f(BAYS.first)};
const float BAY_PITCH = ${f(BAYS.pitch)};
const float BAY_COUNT = ${f(BAYS.count)};
const float SCONCE_Y = ${f(BAYS.sconceY)};
const float EXIT_Z = ${f(EXIT_DOOR.z)};
const float EXIT_SIGN_Y = ${f(EXIT_DOOR.signY)};
const float FOOT_Y = ${f(STAGE_LIGHTS.footY)};
const float FOOT_Z = ${f(STAGE_LIGHTS.footZ)};
const float FOOT_HALF_WIDTH = ${f(STAGE_LIGHTS.footHalfWidth)};
const float PROJ_Y = ${f(PROJECTOR.y)};
const float PROJ_Z = ${f(PROJECTOR.z)};
const float BOX_LAMP_X = ${f(boxLampX())};
const float BOX_LAMP_Y = ${f(BOXES.lampY)};
const float BOX_LAMP_Z0 = ${f(boxLampZ(0))};
const float BOX_LAMP_Z1 = ${f(boxLampZ(1))};
`;

/** The box lamps' positions, left box then right box. */
export const boxLampPositions = (): Array<[number, number, number]> => [-1, 1].flatMap(side => [0, 1].map(index => (
    [side * boxLampX(), BOXES.lampY, boxLampZ(index)] as [number, number, number]
)));
