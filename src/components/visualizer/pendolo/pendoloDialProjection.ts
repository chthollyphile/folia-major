// src/components/visualizer/pendolo/pendoloDialProjection.ts
// 表盘倾斜与左右镜像：把表盘平面上的点（相对轮心的 CSS px）映到屏幕上。
// 倾斜是绕一条过轮心、躺在表盘平面里的轴转出屏幕，再按透视投回屏幕，所以是一个 3x3 单应矩阵；
// 镜像在倾斜之前先把平面左右翻过来。WebGL 的各个着色器、Canvas2D 回退和歌词、摆轮图标这些 DOM
// 都从这里取同一个矩阵，画出来的表盘和压在它上面的东西对得上。倾斜为 0 时矩阵是单位阵，各处直接
// 走原来的路径，画面和没有这个功能时一样。

/** 倾斜角度的可调范围（度）；再往上接近侧视，表盘薄成一条线、远侧会越过视点。 */
export const PENDOLO_TILT_LIMIT_DEG = 70;

/** 视点到屏幕的距离按视口长边的倍数算；1.2 和 CSS 里常见的 perspective 观感接近。 */
const PENDOLO_PERSPECTIVE_FACTOR = 1.2;

export interface PendoloDialProjection {
    /** 行主序 3x3：[x', y', w] = M · [x, y, 1]，屏幕上的点（相对轮心）= (x'/w, y'/w)。 */
    matrix: Float32Array;
    /** 倾斜是不是 0（镜像不算）；是的话透视除法恒为 1，可以按原来的仿射路径画。 */
    flat: boolean;
}

/**
 * 只有倾斜（不含镜像）的投影。`tiltDeg` 为正时，倾斜轴上方的一侧往屏幕里退；
 * `axisDeg` 是倾斜轴在屏幕上的方向，0 是水平轴（前后俯仰），90 是竖直轴（左右偏转）。
 */
export const buildPendoloTiltProjection = (
    tiltDeg: number,
    axisDeg: number,
    viewportWidth: number,
    viewportHeight: number,
): PendoloDialProjection => {
    const matrix = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    if (!tiltDeg) return { matrix, flat: true };
    const theta = (Math.max(-PENDOLO_TILT_LIMIT_DEG, Math.min(PENDOLO_TILT_LIMIT_DEG, tiltDeg)) * Math.PI) / 180;
    const phi = (axisDeg * Math.PI) / 180;
    const ux = Math.cos(phi);
    const uy = Math.sin(phi);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const focal = PENDOLO_PERSPECTIVE_FACTOR * Math.max(1, viewportWidth, viewportHeight);
    // Rodrigues：平面上的点 p 绕轴 u 转 θ 后，xy = p·cosθ + u(u·p)(1-cosθ)，深度 z = (uy·x - ux·y)·sinθ
    // （z 为正是离开观看者）。透视：屏幕 = xy · f / (f + z)，写成齐次就是第三行 z/f + 1。
    const k = 1 - cos;
    matrix[0] = cos + ux * ux * k;
    matrix[1] = ux * uy * k;
    matrix[3] = ux * uy * k;
    matrix[4] = cos + uy * uy * k;
    matrix[6] = (uy * sin) / focal;
    matrix[7] = (-ux * sin) / focal;
    return { matrix, flat: false };
};

/** 表盘本身的投影：先镜像（平面左右翻转），再倾斜。 */
export const buildPendoloDialProjection = (
    tilt: PendoloDialProjection,
    mirror: boolean,
): PendoloDialProjection => {
    if (!mirror) return tilt;
    const m = tilt.matrix;
    // M · diag(-1, 1, 1)：第一列取反
    return {
        matrix: new Float32Array([-m[0], m[1], m[2], -m[3], m[4], m[5], -m[6], m[7], m[8]]),
        flat: tilt.flat,
    };
};

/** 把相对轮心的点投到屏幕上（仍相对轮心）；`depthScale` 是这一点的透视缩放（近大远小）。 */
export const projectPendoloDialPoint = (
    projection: PendoloDialProjection,
    x: number,
    y: number,
): { x: number; y: number; depthScale: number } => {
    const m = projection.matrix;
    const w = m[6] * x + m[7] * y + m[8];
    const safeW = w > 1e-3 ? w : 1e-3;
    return {
        x: (m[0] * x + m[1] * y + m[2]) / safeW,
        y: (m[3] * x + m[4] * y + m[5]) / safeW,
        depthScale: 1 / safeW,
    };
};

/** 3x3 求逆（行主序），给中心渐变从屏幕像素反查回表盘平面用；奇异时返回单位阵。 */
export const invertPendoloProjectionMatrix = (m: Float32Array): Float32Array => {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h;
    const B = -(d * i - f * g);
    const C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-9) return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    const inv = 1 / det;
    return new Float32Array([
        A * inv, -(b * i - c * h) * inv, (b * f - c * e) * inv,
        B * inv, (a * i - c * g) * inv, -(a * f - c * d) * inv,
        C * inv, -(a * h - b * g) * inv, (a * e - b * d) * inv,
    ]);
};
