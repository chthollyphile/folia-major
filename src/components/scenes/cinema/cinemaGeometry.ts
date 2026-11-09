import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
    BAYS,
    BLOCKS,
    BOXES,
    EXIT_DOOR,
    HALL,
    PROSCENIUM,
    ROWS,
    SCREEN,
    STAGE,
    STAGE_LIGHTS,
    bayZ,
    boxLampPositions,
    boxOut,
    rowFloor,
    rowYaw,
    rowZ,
    seatXs,
} from './cinemaLayout';
import type { CurtainPose } from './cinemaIntermission';

// src/components/scenes/cinema/cinemaGeometry.ts
// Builds the hall as two meshes for one shader (cinemaShaders.ts ROOM_*): the whole room merged into
// one geometry, and one seat geometry drawn once per seat (instanced). Every vertex carries the
// material it belongs to (aMatShade.x, the M_* ids below) and a baked shade for folds and corners (aMatShade.y).

/** Material ids; the room shader picks albedo, pattern and lights by these (MATERIAL_GLSL). */
export const MAT = {
    CARPET: 0,
    WALL: 1,
    PILASTER: 2,
    PILASTER_FACE: 3,
    CEILING: 4,
    BEAM: 5,
    COVE: 6,
    PROSC_WALL: 7,
    GOLD: 8,
    MASKING: 9,
    CURTAIN: 10,
    FRINGE: 11,
    STAGE_FRONT: 12,
    STAGE_TOP: 13,
    SEAT_FABRIC: 14,
    SEAT_SHELL: 15,
    SEAT_ARM: 16,
    DOOR: 17,
    EXIT_SIGN: 18,
    EXIT_HOUSING: 19,
    SCONCE_GLASS: 20,
    BRASS: 21,
    AUDIENCE: 22,
    BOX_FRONT: 23,
    BOX_LAMP: 24,
} as const;

export const MATERIAL_GLSL = Object.entries(MAT)
    .map(([name, id]) => `const int M_${name} = ${id};`)
    .join('\n');

type Vec3 = [number, number, number];
type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const normalize = (a: Vec3): Vec3 => {
    const length = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / length, a[1] / length, a[2] / length];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Collects quads, boxes and parametric surfaces into one indexed geometry. */
class MeshBuilder {
    private positions: number[] = [];
    private normals: number[] = [];
    private uvs: number[] = [];
    private matShade: number[] = [];
    private indices: number[] = [];

    private vertex(p: Vec3, n: Vec3, u: number, v: number, mat: number, shade: number) {
        this.positions.push(p[0], p[1], p[2]);
        this.normals.push(n[0], n[1], n[2]);
        this.uvs.push(u, v);
        this.matShade.push(mat, shade);
        return this.positions.length / 3 - 1;
    }

    /** A flat quad a→b→c→d, counter-clockwise seen from its front; uv runs 0..1 over it. */
    quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, mat: number, shade = 1) {
        const n = normalize(cross(sub(b, a), sub(d, a)));
        const first = this.vertex(a, n, 0, 0, mat, shade);
        this.vertex(b, n, 1, 0, mat, shade);
        this.vertex(c, n, 1, 1, mat, shade);
        this.vertex(d, n, 0, 1, mat, shade);
        this.indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
    }

    /** An axis-aligned box: only the faces listed (all six by default), each with its own material where given. */
    box(min: Vec3, max: Vec3, mat: number, options: { faces?: Face[]; faceMat?: Partial<Record<Face, number>>; shade?: number } = {}) {
        const [x0, y0, z0] = min;
        const [x1, y1, z1] = max;
        const faces = options.faces ?? ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
        const shade = options.shade ?? 1;
        const corners: Record<Face, [Vec3, Vec3, Vec3, Vec3]> = {
            px: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
            nx: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
            py: [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]],
            ny: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
            pz: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
            nz: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
        };
        faces.forEach(face => {
            const [a, b, c, d] = corners[face];
            this.quad(a, b, c, d, options.faceMat?.[face] ?? mat, shade);
        });
    }

    /**
     * A surface at(u, v), u and v in 0..1, cut into nu × nv cells. Normals come from the surface's own
     * derivatives and are turned to face `facing`. shadeAt bakes a shade per vertex.
     */
    grid(nu: number, nv: number, at: (u: number, v: number) => Vec3, mat: number, facing: Vec3, shadeAt?: (u: number, v: number) => number) {
        const eps = 1e-3;
        const normalAt = (u: number, v: number) => {
            const du = sub(at(Math.min(1, u + eps), v), at(Math.max(0, u - eps), v));
            const dv = sub(at(u, Math.min(1, v + eps)), at(u, Math.max(0, v - eps)));
            return normalize(cross(du, dv));
        };
        const flip = dot(normalAt(0.5, 0.5), facing) < 0;
        const first = this.positions.length / 3;
        for (let j = 0; j <= nv; j += 1) {
            for (let i = 0; i <= nu; i += 1) {
                const u = i / nu;
                const v = j / nv;
                const n = normalAt(u, v);
                this.vertex(at(u, v), flip ? [-n[0], -n[1], -n[2]] : n, u, v, mat, shadeAt ? shadeAt(u, v) : 1);
            }
        }
        const row = nu + 1;
        for (let j = 0; j < nv; j += 1) {
            for (let i = 0; i < nu; i += 1) {
                const a = first + j * row + i;
                const b = a + 1;
                const c = a + row + 1;
                const d = a + row;
                if (flip) this.indices.push(a, c, b, a, d, c);
                else this.indices.push(a, b, c, a, c, d);
            }
        }
    }

    build() {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
        geometry.setAttribute('aMatShade', new THREE.Float32BufferAttribute(this.matShade, 2));
        geometry.setIndex(this.indices);
        geometry.computeBoundingSphere();
        return geometry;
    }
}

const W = HALL.halfWidth;
const PW = PROSCENIUM.halfWidth;
const CEIL = HALL.ceiling;

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
const smooth = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/** Vertical folds of velvet: a few sines of unrelated lengths so the pleats never look printed. */
const folds = (s: number, depth: number) => depth * (
    0.62 * Math.sin(s * 2 * Math.PI * 7.3 + 1.3)
    + 0.28 * Math.sin(s * 2 * Math.PI * 15.7 + 0.4)
    + 0.1 * Math.sin(s * 2 * Math.PI * 3.1 + 2.2)
);

/** Where the side curtains' inner edge hangs, untied: just outside the screen's picture. */
const CURTAIN_INNER = SCREEN.width / 2 + 0.12;
/** The hem of the valance between its swags: a little below the screen's top edge at the swags' lowest. */
const VALANCE_HEM = SCREEN.centerY + SCREEN.height / 2 + 0.245;

const CURTAIN_OUTER = PW + 0.2;
const CURTAIN_TIE_Y = 3.1;
/** Upstage of the proscenium wall, between it and the masking. */
const CURTAIN_Z = 0.2;
/** Cells across and down a side curtain: across enough for the fine pleats of a drawn curtain (31 over its width). */
const CURTAIN_CELLS = [160, 40] as const;
/** Drawn, the leading edges pass the centre line by this much, the left curtain in front, so no light shows between them. */
const CURTAIN_OVERLAP = 0.12;

/**
 * A point of a side curtain hanging in `pose`, and its baked shade: u from its leading edge (0) to
 * the wall (1), v from the hem (0) to the top (1); side -1 is stage left. Open, it is caught by a
 * tie-back; drawn, its leading edge reaches the centre line and the fabric hangs straight.
 */
const curtainPoint = (side: number, pose: CurtainPose, u: number, v: number): [Vec3, number] => {
    const y = lerp(STAGE.height, PROSCENIUM.top + 0.1, v);
    // How far closed the leading edge is at this height: the hem trails the carriage, most at the bottom; it stops at the centre, against the other curtain.
    const closure = Math.min(1, pose.top - (pose.top - pose.bottom) * (1 - v) ** 1.5);
    const drawn = Math.max(0, closure);
    // On the tie-back the inner edge is pulled toward the wall and swings back out above and below it.
    const gather = Math.exp(-(((y - CURTAIN_TIE_Y) / 1.9) ** 2)) * (1 - drawn);
    const openInner = CURTAIN_INNER + 0.62 * gather + 0.12 * smooth(CURTAIN_TIE_Y, PROSCENIUM.top, y);
    const x = lerp(lerp(openInner, -CURTAIN_OVERLAP, closure), CURTAIN_OUTER, u);
    // Spread out, the deep folds open into shallow waves and the fabric's fine pleats show.
    const depth = (0.07 + 0.07 * gather) * (1 - 0.45 * drawn);
    const fine = 0.05 * drawn;
    const wave = folds(u, depth) + fine * Math.sin(u * 2 * Math.PI * 31 + 0.9);
    // Up under the valance the fabric hangs flatter and further back, between the screen and the valance,
    // touching neither. Where they overlap, the left curtain's leading edge stays in front of the right one's all the way up.
    const under = smooth(8.2, 8.8, y);
    const lip = side < 0 ? 0.1 * drawn * (1 - smooth(0.02, 0.05, u)) * (1 - 0.5 * under) : 0;
    const z = lerp(CURTAIN_Z, 0.1, under) + wave * (1 - 0.55 * under) + lip + 0.05 * gather;
    return [[side * x, y, z], 0.4 + 0.6 * smooth(-depth - fine, depth + fine, wave)];
};

/** Half the width of the gap between the side curtains at the screen's centre height: how much of the screen they leave uncovered. */
export const curtainGap = (left: CurtainPose, right: CurtainPose) => {
    const v = (SCREEN.centerY - STAGE.height) / (PROSCENIUM.top + 0.1 - STAGE.height);
    return Math.max(0, (curtainPoint(1, right, 0, v)[0][0] - curtainPoint(-1, left, 0, v)[0][0]) / 2);
};

const addSideCurtain = (builder: MeshBuilder, side: number, pose: CurtainPose) => {
    builder.grid(
        CURTAIN_CELLS[0],
        CURTAIN_CELLS[1],
        (u, v) => curtainPoint(side, pose, u, v)[0],
        MAT.CURTAIN,
        [0, 0, 1],
        (u, v) => curtainPoint(side, pose, u, v)[1],
    );
};

/** The tie-back on the wall: a gold band where the open curtain is gathered. */
const addTieBack = (builder: MeshBuilder, side: number) => {
    const inner = CURTAIN_INNER + 0.62;
    builder.box(
        [side > 0 ? inner - 0.02 : -CURTAIN_OUTER - 0.02, CURTAIN_TIE_Y - 0.06, CURTAIN_Z + 0.05],
        [side > 0 ? CURTAIN_OUTER + 0.02 : -inner + 0.02, CURTAIN_TIE_Y + 0.06, CURTAIN_Z + 0.2],
        MAT.GOLD,
        { faces: ['pz', 'py', 'ny'] },
    );
};

/**
 * The two side curtains as a geometry of their own, open; set() hangs them in new poses (the
 * intermission calls it only while they move). Left first, then right, as many vertices each.
 */
export const buildSideCurtains = () => {
    const open: CurtainPose = { top: 0, bottom: 0 };
    const builder = new MeshBuilder();
    addSideCurtain(builder, -1, open);
    addSideCurtain(builder, 1, open);
    const geometry = builder.build();
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv');
    const matShade = geometry.getAttribute('aMatShade') as THREE.BufferAttribute;
    position.setUsage(THREE.DynamicDrawUsage);
    matShade.setUsage(THREE.DynamicDrawUsage);
    const perSide = position.count / 2;
    const set = (left: CurtainPose, right: CurtainPose) => {
        for (let index = 0; index < position.count; index += 1) {
            const [point, shade] = index < perSide
                ? curtainPoint(-1, left, uv.getX(index), uv.getY(index))
                : curtainPoint(1, right, uv.getX(index), uv.getY(index));
            position.setXYZ(index, point[0], point[1], point[2]);
            matShade.setY(index, shade);
        }
        position.needsUpdate = true;
        matShade.needsUpdate = true;
        geometry.computeVertexNormals();
    };
    return { geometry, set };
};

/** The valance across the top of the proscenium: pleated swags with a gold fringe under them. */
const addValance = (builder: MeshBuilder) => {
    const half = PW + 0.2;
    const swags = 6;
    // In front of the side curtains' tops (curtainPoint), behind the proscenium wall.
    const z0 = 0.26;
    const top = PROSCENIUM.top + 0.2;
    const hem = (x: number) => {
        const s = ((x + half) / (2 * half)) * swags;
        return VALANCE_HEM - 0.34 * Math.sin(Math.PI * (s - Math.floor(s)));
    };
    const bulge = (x: number, v: number) => {
        const s = ((x + half) / (2 * half)) * swags;
        return 0.12 * Math.sin(Math.PI * (s - Math.floor(s))) * (1 - v) ** 1.5;
    };
    const at = (u: number, v: number): Vec3 => {
        const x = lerp(-half, half, u);
        const y = lerp(hem(x), top, v);
        return [x, y, z0 + bulge(x, v) + 0.04 * Math.sin(u * 2 * Math.PI * 34)];
    };
    builder.grid(340, 12, at, MAT.CURTAIN, [0, 0, 1], (u, v) => {
        const pleat = 0.5 + 0.5 * Math.sin(u * 2 * Math.PI * 34);
        return (0.55 + 0.45 * pleat) * (0.6 + 0.4 * smooth(0, 0.5, 1 - v)) * (0.75 + 0.25 * v);
    });
    const fringe = (u: number, v: number): Vec3 => {
        const x = lerp(-half, half, u);
        return [x, hem(x) - 0.17 + 0.18 * v, z0 + bulge(x, 0) + 0.02];
    };
    builder.grid(340, 1, fringe, MAT.FRINGE, [0, 0, 1]);
};

const addFloor = (builder: MeshBuilder) => {
    // From the stage to the first row: flat.
    builder.grid(64, 4, (u, v) => {
        const x = lerp(-W, W, u);
        return [x, 0, lerp(STAGE.front, rowZ(0, x) - ROWS.treadFront, v)];
    }, MAT.CARPET, [0, 1, 0]);
    // One curved tread per row, each with its riser: turning round in a seat shows them.
    const lastRow = ROWS.count + 1;
    for (let row = 0; row <= lastRow; row += 1) {
        const y = rowFloor(row);
        const below = row > 0 ? rowFloor(row - 1) : 0;
        const edge = (r: number, x: number) => rowZ(r, x) - ROWS.treadFront;
        builder.grid(64, 2, (u, v) => {
            const x = lerp(-W, W, u);
            return [x, y, lerp(edge(row, x), edge(row + 1, x), v)];
        }, MAT.CARPET, [0, 1, 0]);
        if (y > below) {
            builder.grid(64, 1, (u, v) => {
                const x = lerp(-W, W, u);
                return [x, lerp(below, y, v), edge(row, x)];
            }, MAT.CARPET, [0, 0, -1], () => 0.55);
        }
    }
    // Behind the last row, flat to the back wall.
    const top = rowFloor(lastRow);
    builder.grid(64, 2, (u, v) => {
        const x = lerp(-W, W, u);
        return [x, top, lerp(rowZ(lastRow + 1, x) - ROWS.treadFront, HALL.back, v)];
    }, MAT.CARPET, [0, 1, 0]);
};

const addWalls = (builder: MeshBuilder) => {
    const back = HALL.back;
    for (const side of [-1, 1]) {
        const x = side * W;
        builder.box(
            side > 0 ? [x, -1, PROSCENIUM.z] : [x - 0.1, -1, PROSCENIUM.z],
            side > 0 ? [x + 0.1, CEIL, back] : [x, CEIL, back],
            MAT.WALL,
            { faces: [side > 0 ? 'nx' : 'px'] },
        );
        // Picture rail in gold, running the length of the hall.
        const inward = side > 0 ? 'nx' : 'px';
        builder.box(
            side > 0 ? [x - 0.05, 7.3, PROSCENIUM.z] : [x, 7.3, PROSCENIUM.z],
            side > 0 ? [x, 7.4, back] : [x + 0.05, 7.4, back],
            MAT.GOLD,
            { faces: [inward, 'py', 'ny'] },
        );
        for (let bay = 1; bay < BAYS.count; bay += 1) {
            const z = bayZ(bay);
            const face = side > 0 ? W - 0.3 : -W + 0.3;
            builder.box(
                side > 0 ? [face, -1, z - 0.28] : [-W, -1, z - 0.28],
                side > 0 ? [W, CEIL, z + 0.28] : [face, CEIL, z + 0.28],
                MAT.PILASTER,
                { faces: [inward, 'pz', 'nz'], faceMat: { [inward]: MAT.PILASTER_FACE } },
            );
            addSconce(builder, side, face, z);
        }
        addExitDoor(builder, side);
    }
};

/** An art deco fan sconce on a pilaster: a half dome of glass on a brass plate. */
const addSconce = (builder: MeshBuilder, side: number, face: number, z: number) => {
    const y = BAYS.sconceY;
    const out = -side;
    builder.box(
        side > 0 ? [face - 0.03, y - 0.34, z - 0.2] : [face, y - 0.34, z - 0.2],
        side > 0 ? [face, y + 0.06, z + 0.2] : [face + 0.03, y + 0.06, z + 0.2],
        MAT.BRASS,
        { faces: [side > 0 ? 'nx' : 'px', 'py', 'ny', 'pz', 'nz'] },
    );
    builder.grid(24, 6, (u, v) => {
        const angle = u * Math.PI;
        const radius = 0.05 + 0.27 * v;
        const dome = 0.11 * (1 - v * v);
        return [face + out * (0.035 + dome), y - 0.1 + radius * Math.sin(angle), z + radius * Math.cos(angle)];
    }, MAT.SCONCE_GLASS, [out, 0, 0]);
};

const addExitDoor = (builder: MeshBuilder, side: number) => {
    const z = EXIT_DOOR.z;
    const half = EXIT_DOOR.width / 2;
    const inward: Face = side > 0 ? 'nx' : 'px';
    const wall = side * W;
    const at = (depth: number) => wall - side * depth;
    builder.box(
        side > 0 ? [at(0.02), 0, z - half] : [wall, 0, z - half],
        side > 0 ? [wall, EXIT_DOOR.height, z + half] : [at(0.02), EXIT_DOOR.height, z + half],
        MAT.DOOR,
        { faces: [inward] },
    );
    // A gold architrave around the door.
    const frame = (z0: number, z1: number, y0: number, y1: number) => builder.box(
        side > 0 ? [at(0.07), y0, z0] : [wall, y0, z0],
        side > 0 ? [wall, y1, z1] : [at(0.07), y1, z1],
        MAT.GOLD,
        { faces: [inward, 'pz', 'nz', 'py'] },
    );
    frame(z - half - 0.12, z - half, 0, EXIT_DOOR.height + 0.12);
    frame(z + half, z + half + 0.12, 0, EXIT_DOOR.height + 0.12);
    frame(z - half - 0.12, z + half + 0.12, EXIT_DOOR.height, EXIT_DOOR.height + 0.12);
    const signY = EXIT_DOOR.signY;
    builder.box(
        side > 0 ? [at(0.16), signY - 0.13, z - 0.3] : [wall, signY - 0.13, z - 0.3],
        side > 0 ? [wall, signY + 0.13, z + 0.3] : [at(0.16), signY + 0.13, z + 0.3],
        MAT.EXIT_HOUSING,
        { faces: [inward, 'py', 'ny', 'pz', 'nz'], faceMat: { [inward]: MAT.EXIT_SIGN } },
    );
};

const addCeiling = (builder: MeshBuilder) => {
    builder.box([-W, CEIL, PROSCENIUM.z], [W, CEIL + 0.1, HALL.back], MAT.CEILING, { faces: ['ny'] });
    for (let bay = 0; bay < BAYS.count; bay += 1) {
        const z = bayZ(bay);
        builder.box([-W, CEIL - 0.62, z - 0.3], [W, CEIL, z + 0.3], MAT.BEAM, { faces: ['ny', 'pz', 'nz'] });
        // The cove strip on the beam's lower edge, facing the audience.
        builder.box([-W, CEIL - 0.68, z + 0.26], [W, CEIL - 0.6, z + 0.36], MAT.COVE, { faces: ['pz', 'ny'] });
    }
};

const addProscenium = (builder: MeshBuilder) => {
    const z = PROSCENIUM.z;
    const top = PROSCENIUM.top;
    builder.quad([-W, -1, z], [-PW, -1, z], [-PW, CEIL, z], [-W, CEIL, z], MAT.PROSC_WALL);
    builder.quad([PW, -1, z], [W, -1, z], [W, CEIL, z], [PW, CEIL, z], MAT.PROSC_WALL);
    builder.quad([-PW, top, z], [PW, top, z], [PW, CEIL, z], [-PW, CEIL, z], MAT.PROSC_WALL);
    // Masking: black velour around the screen, behind the opening.
    builder.quad([-PW, STAGE.height, 0], [PW, STAGE.height, 0], [PW, top, 0], [-PW, top, 0], MAT.MASKING);
    // Stepped gold frame around the opening.
    const trims: Array<[number, number]> = [[0, 0.24], [0.42, 0.5]];
    trims.forEach(([from, to], index) => {
        const depth = z + (index === 0 ? 0.16 : 0.08);
        builder.box([-PW - to, 0, z], [-PW - from, top + to, depth], MAT.GOLD, { faces: ['pz', 'px', 'nx'] });
        builder.box([PW + from, 0, z], [PW + to, top + to, depth], MAT.GOLD, { faces: ['pz', 'px', 'nx'] });
        builder.box([-PW - from, top + from, z], [PW + from, top + to, depth], MAT.GOLD, { faces: ['pz', 'ny', 'py'] });
    });
    // Fluted pilasters flanking the stage, each with a gold capital and a lamp at its foot.
    for (const side of [-1, 1]) {
        const x0 = side * PROSCENIUM.pilasterInner;
        const x1 = side * PROSCENIUM.pilasterOuter;
        const [left, right] = side > 0 ? [x0, x1] : [x1, x0];
        builder.box([left, -1, z], [right, top + 0.1, z + 0.34], MAT.PILASTER, {
            faces: ['pz', 'px', 'nx'],
            faceMat: { pz: MAT.PILASTER_FACE },
        });
        builder.box([left - 0.08, top + 0.1, z], [right + 0.08, top + 0.4, z + 0.42], MAT.GOLD, { faces: ['pz', 'px', 'nx', 'ny'] });
        builder.box([left - 0.04, 0, z], [right + 0.04, 0.3, z + 0.4], MAT.BRASS, { faces: ['pz', 'px', 'nx', 'py'] });
    }
};

const addStage = (builder: MeshBuilder) => {
    const h = STAGE.height;
    builder.box([-PW, -1, 0], [PW, h, STAGE.front], MAT.STAGE_TOP, {
        faces: ['py', 'pz'],
        faceMat: { pz: MAT.STAGE_FRONT },
    });
    // Brass nosing on the stage lip, and the hooded trough of the footlights.
    builder.box([-PW, h - 0.06, STAGE.front], [PW, h, STAGE.front + 0.03], MAT.BRASS, { faces: ['pz', 'py'] });
    const half = STAGE_LIGHTS.footHalfWidth + 0.15;
    builder.box([-half, h, STAGE_LIGHTS.footZ + 0.02], [half, h + 0.09, STAGE.front], MAT.BRASS, { faces: ['pz', 'py'] });
};

/** A box on the side wall: bowed walnut front, velvet rail, gold trim, an opening framed in gold with a short drape. */
const addBox = (builder: MeshBuilder, side: number) => {
    const { z0, z1, floorY, railY } = BOXES;
    const inward: Vec3 = [-side, 0, 0];
    const foot = floorY - 0.3;
    const xAt = (t: number, extra = 0) => side * (W - boxOut(t) - extra);
    const zAt = (t: number) => lerp(z0, z1, t);
    builder.grid(48, 6, (u, v) => [xAt(u), lerp(foot + 0.1, railY - 0.07, v), zAt(u)], MAT.BOX_FRONT, inward);
    // Gold bands at the foot and under the rail, a little proud of the front.
    builder.grid(48, 1, (u, v) => [xAt(u, 0.015), lerp(foot, foot + 0.1, v), zAt(u)], MAT.GOLD, inward);
    builder.grid(48, 1, (u, v) => [xAt(u, 0.015), lerp(railY - 0.07, railY, v), zAt(u)], MAT.GOLD, inward);
    // The velvet rail: a rounded cushion along the top.
    builder.grid(48, 6, (u, v) => [
        side * (W - boxOut(u) + 0.2 - v * 0.24),
        railY + 0.07 * Math.sin(Math.PI * v),
        zAt(u),
    ], MAT.CURTAIN, [0, 1, 0]);
    // The soffit under the box.
    builder.grid(24, 2, (u, v) => [side * (W - v * boxOut(u)), foot, zAt(u)], MAT.PROSC_WALL, [0, -1, 0]);
    // Gold posts at both ends of the opening and a lintel over it, with a short drape under the lintel.
    const postIn = W - BOXES.endOut - 0.1;
    for (const z of [z0, z1]) {
        builder.box(
            side > 0 ? [postIn, railY, z - 0.07] : [-W, railY, z - 0.07],
            side > 0 ? [W, 7.25, z + 0.07] : [-postIn, 7.25, z + 0.07],
            MAT.GOLD,
            { faces: [side > 0 ? 'nx' : 'px', 'pz', 'nz'] },
        );
    }
    builder.box(
        side > 0 ? [postIn, 7.05, z0 - 0.07] : [-W, 7.05, z0 - 0.07],
        side > 0 ? [W, 7.3, z1 + 0.07] : [-postIn, 7.3, z1 + 0.07],
        MAT.GOLD,
        { faces: [side > 0 ? 'nx' : 'px', 'ny'] },
    );
    builder.grid(60, 6, (u, v) => {
        const y = lerp(6.45 + 0.18 * Math.sin(Math.PI * ((u * 2) % 1)), 7.05, v);
        return [side * (postIn + 0.04 - folds(u * 0.6, 0.04)), y, zAt(u)];
    }, MAT.CURTAIN, inward, (u) => 0.55 + 0.45 * smooth(-0.04, 0.04, folds(u * 0.6, 0.04)));
    // The lamps' little shades.
    boxLampPositions().filter(([x]) => Math.sign(x) === side).forEach(([x, y, z]) => {
        builder.box([x - 0.06, y - 0.09, z - 0.06], [x + 0.06, y + 0.03, z + 0.06], MAT.BOX_LAMP, { faces: ['px', 'nx', 'pz', 'nz', 'py'] });
    });
};

/** The whole room but the seats and the side curtains (buildSideCurtains): walls, ceiling, stage, proscenium, valance and the floor. */
export const buildRoomGeometry = () => {
    const builder = new MeshBuilder();
    addFloor(builder);
    addWalls(builder);
    addBox(builder, -1);
    addBox(builder, 1);
    addCeiling(builder);
    addProscenium(builder);
    addStage(builder);
    addTieBack(builder, -1);
    addTieBack(builder, 1);
    addValance(builder);
    return builder.build();
};

/** Moves a part into place and gives every vertex its material and a shade, darker toward the floor. */
const part = (geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, mat: number) => {
    geometry.applyMatrix4(matrix);
    const position = geometry.getAttribute('position');
    const matShade = new Float32Array(position.count * 2);
    for (let index = 0; index < position.count; index += 1) {
        matShade[index * 2] = mat;
        // Under the seat little light ever reaches.
        matShade[index * 2 + 1] = 0.3 + 0.7 * smooth(0.05, 1.05, position.getY(index));
    }
    geometry.setAttribute('aMatShade', new THREE.BufferAttribute(matShade, 2));
    return geometry;
};

const mergeParts = (parts: THREE.BufferGeometry[], what: string) => {
    const merged = mergeGeometries(parts);
    parts.forEach(geometry => geometry.dispose());
    if (!merged) throw new Error(`[Cinema] Could not merge the ${what} geometry`);
    return merged;
};

/** One seat, its back to +z: velvet back and cushion, a wooden shell behind, the arm on its left. */
export const buildSeatGeometry = () => {
    const lean = new THREE.Matrix4().makeRotationX(0.17);
    const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
    const backAt = (x: number, y: number, z: number) => at(0, 0.78, -0.1).multiply(lean).multiply(at(x, y, z));
    const parts = [
        part(new RoundedBoxGeometry(0.5, 0.74, 0.13, 3, 0.055), backAt(0, 0, 0), MAT.SEAT_FABRIC),
        part(new RoundedBoxGeometry(0.53, 0.66, 0.05, 2, 0.022), backAt(0, -0.06, 0.075), MAT.SEAT_SHELL),
        part(new RoundedBoxGeometry(0.48, 0.12, 0.46, 3, 0.045), at(0, 0.44, -0.38), MAT.SEAT_FABRIC),
        part(new RoundedBoxGeometry(0.075, 0.06, 0.5, 2, 0.026), at(-0.28, 0.67, -0.32), MAT.SEAT_ARM),
        part(new RoundedBoxGeometry(0.05, 0.64, 0.4, 1, 0.012), at(-0.28, 0.32, -0.32), MAT.SEAT_SHELL),
    ];
    return mergeParts(parts, 'seat');
};

/**
 * Someone seated in buildSeatGeometry's seat: the back against the seat back (leaning with it), the hips
 * on the cushion, the thighs along it and the shins down to the floor, so no part goes through the seat.
 */
export const buildAudienceGeometry = () => {
    const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
    // The seat back's own frame (as buildSeatGeometry's backAt): its front face is at z = -0.065.
    const leaning = (x: number, y: number, z: number) => at(0, 0.78, -0.1).multiply(new THREE.Matrix4().makeRotationX(0.17)).multiply(at(x, y, z));
    // Rounded boxes come without an index; the others are made the same way so they merge.
    const flat = (geometry: THREE.BufferGeometry) => {
        const result = geometry.toNonIndexed();
        geometry.dispose();
        return result;
    };
    const head = flat(new THREE.SphereGeometry(0.105, 14, 10));
    head.applyMatrix4(new THREE.Matrix4().makeScale(0.92, 1.12, 1));
    const neck = flat(new THREE.CylinderGeometry(0.05, 0.06, 0.16, 10));
    return mergeParts([
        part(head, leaning(0, 0.46, -0.18), MAT.AUDIENCE),
        part(neck, leaning(0, 0.35, -0.18), MAT.AUDIENCE),
        part(new RoundedBoxGeometry(0.4, 0.56, 0.2, 3, 0.08), leaning(0, 0.02, -0.18), MAT.AUDIENCE),
        part(new RoundedBoxGeometry(0.36, 0.14, 0.44, 3, 0.06), at(0, 0.57, -0.4), MAT.AUDIENCE),
        part(new RoundedBoxGeometry(0.32, 0.5, 0.12, 2, 0.05), at(0, 0.26, -0.64), MAT.AUDIENCE),
    ], 'audience');
};

/** A number from 0 to 1 that stays the same for the same seat on every visit. */
const seatHash = (row: number, x: number) => {
    const value = Math.sin(row * 127.1 + x * 311.7) * 43758.5453;
    return value - Math.floor(value);
};

/** Whether someone sits in the seat (row from 0, x its lateral place); the seat map shows these as taken. */
export const isSeatTaken = (row: number, x: number) => row < ROWS.count - 1 && row !== 6 && row !== 7 && seatHash(row, x) <= 0.34;

/**
 * Where people sit: about a third of the seats, none in the rows the camera passes through (6 and 7),
 * and two in each box, turned toward the stage.
 */
export const buildAudienceMatrices = () => {
    const matrices: THREE.Matrix4[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const rotation = new THREE.Quaternion();
    for (let row = 0; row < ROWS.count - 1; row += 1) {
        if (row === 6 || row === 7) continue;
        seatXs().forEach(x => {
            if (!isSeatTaken(row, x)) return;
            const lean = (seatHash(row + 31, x) - 0.5) * 0.5;
            rotation.setFromAxisAngle(up, rowYaw(row, x) + lean * 0.3);
            const size = 0.92 + 0.16 * seatHash(row + 7, x);
            matrices.push(new THREE.Matrix4().compose(
                new THREE.Vector3(x + lean * 0.06, rowFloor(row) - (1 - size) * 0.8, rowZ(row, x)),
                rotation,
                new THREE.Vector3(size, size, size),
            ));
        });
    }
    for (const side of [-1, 1]) {
        [0.38, 0.62].forEach((t, index) => {
            // Inside the box: halfway between its rail and the wall.
            const x = side * (W - boxOut(t) / 2);
            const z = lerp(BOXES.z0, BOXES.z1, t);
            rotation.setFromAxisAngle(up, Math.atan2(x, z + 9) * 0.6 + (index - 0.5) * 0.2);
            // On a riser: head and shoulders clear the rail, as over a parapet about 0.9 m high.
            matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, BOXES.floorY + 0.15, z), rotation, new THREE.Vector3(1, 1, 1)));
        });
    }
    return matrices;
};

/** Where each seat stands: rows in front of the camera's row only, since the rest is never seen. */
export const buildSeatMatrices = () => {
    const matrices: THREE.Matrix4[] = [];
    const xs = seatXs();
    const rotation = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(1, 1, 1);
    for (let row = 0; row < ROWS.count; row += 1) {
        xs.forEach(x => {
            rotation.setFromAxisAngle(up, rowYaw(row, x));
            matrices.push(new THREE.Matrix4().compose(new THREE.Vector3(x, rowFloor(row), rowZ(row, x)), rotation, scale));
        });
    }
    return matrices;
};

export interface GlowPoint {
    position: Vec3;
    /** Linear colour times brightness. */
    color: Vec3;
    /** Diameter in metres. */
    size: number;
    /** 0 steady, 1 twinkling star, 2 tinted by the cove colour. */
    kind: number;
}

const AMBER: Vec3 = [1.0, 0.5, 0.16];
const WARM: Vec3 = [1.0, 0.62, 0.3];
const scaled = (color: Vec3, k: number): Vec3 => [color[0] * k, color[1] * k, color[2] * k];

/** Every small light in the hall drawn as a soft glow: aisle lamps, footlights, sconces, coves, stars. */
export const buildGlowPoints = (): GlowPoint[] => {
    const points: GlowPoint[] = [];
    const edges = [BLOCKS.aisleInner + 0.03, BLOCKS.aisleOuter - 0.03, BLOCKS.aisleOuter + BLOCKS.sideSeats * BLOCKS.seatPitch + 0.03];
    for (let row = 0; row <= ROWS.count; row += 1) {
        for (const side of [-1, 1]) {
            edges.forEach(edge => {
                points.push({ position: [side * edge, rowFloor(row) + 0.2, rowZ(row, edge) - 0.3], color: scaled(AMBER, 0.9), size: 0.16, kind: 0 });
            });
        }
    }
    for (let x = -STAGE_LIGHTS.footHalfWidth + 0.2; x <= STAGE_LIGHTS.footHalfWidth - 0.2 + 1e-6; x += 0.5) {
        points.push({ position: [x, STAGE.height + 0.1, STAGE_LIGHTS.footZ + 0.08], color: scaled(WARM, 0.55), size: 0.24, kind: 0 });
    }
    for (let bay = 1; bay < BAYS.count; bay += 1) {
        for (const side of [-1, 1]) {
            const position: Vec3 = [side * (W - 0.45), BAYS.sconceY + 0.02, bayZ(bay)];
            points.push({ position, color: scaled(WARM, 0.22), size: 1.5, kind: 0 });
            points.push({ position, color: scaled(WARM, 0.9), size: 0.34, kind: 0 });
        }
    }
    boxLampPositions().forEach(([x, y, z]) => {
        points.push({ position: [x, y - 0.03, z], color: scaled(WARM, 0.25), size: 1.2, kind: 0 });
        points.push({ position: [x, y - 0.03, z], color: scaled(WARM, 1.1), size: 0.2, kind: 0 });
    });
    for (const side of [-1, 1]) {
        points.push({ position: [side * (W - 0.2), EXIT_DOOR.signY, EXIT_DOOR.z], color: [0.05, 0.42, 0.16], size: 1.1, kind: 0 });
        points.push({ position: [side * (PROSCENIUM.pilasterInner + PROSCENIUM.pilasterOuter) / 2, 0.32, PROSCENIUM.z + 0.45], color: scaled(WARM, 0.6), size: 0.5, kind: 0 });
    }
    for (let bay = 0; bay < BAYS.count; bay += 1) {
        for (let x = -W + 0.4; x < W; x += 0.75) {
            points.push({ position: [x, CEIL - 0.66, bayZ(bay) + 0.37], color: [0.16, 0.16, 0.16], size: 0.65, kind: 2 });
        }
    }
    // Stars on the ceiling between the beams, scattered by a fixed sequence so every visit looks the same.
    let state = 7;
    const random = () => {
        state = (state * 16807) % 2147483647;
        return state / 2147483647;
    };
    for (let count = 0; count < 170;) {
        const z = lerp(PROSCENIUM.z + 1, bayZ(BAYS.count - 1), random());
        const nearest = Math.round((z - BAYS.first) / BAYS.pitch);
        if (Math.abs(z - bayZ(nearest)) < 0.45) continue;
        const brightness = 0.5 + 1.5 * random() ** 3;
        points.push({ position: [lerp(-W + 0.3, W - 0.3, random()), CEIL - 0.02, z], color: [0.9 * brightness, 0.85 * brightness, 0.75 * brightness], size: 0.07 + 0.07 * random(), kind: 1 });
        count += 1;
    }
    return points;
};
