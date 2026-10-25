import type { ScreenQuad } from '../definition';

// src/components/scenes/engine/surfaceQuad.ts
// 把一个 width × height 的网页盒子贴到场景给的四个角上：算出 CSS matrix3d（透视映射，transform-origin 要是 0 0）。

type Matrix3 = number[];

const adjugate = (m: Matrix3): Matrix3 => [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
];

const multiply = (a: Matrix3, b: Matrix3): Matrix3 => {
    const c = new Array<number>(9).fill(0);
    for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
            for (let k = 0; k < 3; k += 1) c[3 * i + j] += a[3 * i + k] * b[3 * k + j];
        }
    }
    return c;
};

// The matrix taking the unit basis to four points (the first three as the basis, the fourth fixing the scale).
const basisToPoints = (p: readonly (readonly [number, number])[]): Matrix3 => {
    const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1];
    const a = adjugate(m);
    const v = [
        a[0] * p[3][0] + a[1] * p[3][1] + a[2],
        a[3] * p[3][0] + a[4] * p[3][1] + a[5],
        a[6] * p[3][0] + a[7] * p[3][1] + a[8],
    ];
    return multiply(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]);
};

/** The 3×3 projective map (row-major, last entry 1) from the box's corners to the quad's. */
export const quadHomography = (width: number, height: number, quad: ScreenQuad): Matrix3 => {
    // Basis order: top-left, top-right, bottom-left, then bottom-right.
    const source = basisToPoints([[0, 0], [width, 0], [0, height], [width, height]]);
    const target = basisToPoints([[quad[0].x, quad[0].y], [quad[1].x, quad[1].y], [quad[3].x, quad[3].y], [quad[2].x, quad[2].y]]);
    const h = multiply(target, adjugate(source));
    return h.map(value => value / h[8]);
};

/** The CSS transform that lays a width × height box over the quad (with `transform-origin: 0 0`). */
export const quadToMatrix3d = (width: number, height: number, quad: ScreenQuad): string => {
    const h = quadHomography(width, height, quad);
    const columns = [h[0], h[3], 0, h[6], h[1], h[4], 0, h[7], 0, 0, 1, 0, h[2], h[5], 0, h[8]];
    return `matrix3d(${columns.map(value => (Number.isFinite(value) ? Number(value.toFixed(9)) : 0)).join(',')})`;
};
