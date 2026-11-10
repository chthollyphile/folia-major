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
    /**
     * 分层视差：离表盘平面高 1px（朝观看者）的点，在齐次坐标里多出来的那一份，[x', y', w]。
     * 就是倾斜后表盘法线朝观看者的方向（w 那一项已除过视距）。平放时是 (0, 0, -1/f)。
     */
    lift: [number, number, number];
    /** 1 / 视距，抬高 h 的一层先在平面内按 1 - h/f 缩一下，平放时正好抵掉透视放大。 */
    invFocal: number;
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
    const focal = PENDOLO_PERSPECTIVE_FACTOR * Math.max(1, viewportWidth, viewportHeight);
    if (!tiltDeg) return { matrix, flat: true, lift: [0, 0, -1 / focal], invFocal: 1 / focal };
    const theta = (Math.max(-PENDOLO_TILT_LIMIT_DEG, Math.min(PENDOLO_TILT_LIMIT_DEG, tiltDeg)) * Math.PI) / 180;
    const phi = (axisDeg * Math.PI) / 180;
    const ux = Math.cos(phi);
    const uy = Math.sin(phi);
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    // Rodrigues：平面上的点 p 绕轴 u 转 θ 后，xy = p·cosθ + u(u·p)(1-cosθ)，深度 z = (uy·x - ux·y)·sinθ
    // （z 为正是离开观看者）。透视：屏幕 = xy · f / (f + z)，写成齐次就是第三行 z/f + 1。
    const k = 1 - cos;
    matrix[0] = cos + ux * ux * k;
    matrix[1] = ux * uy * k;
    matrix[3] = ux * uy * k;
    matrix[4] = cos + uy * uy * k;
    matrix[6] = (uy * sin) / focal;
    matrix[7] = (-ux * sin) / focal;
    // 上面的 z 对应绕 u 转 -θ，法线 (0,0,1) 同样转过之后是 (-uy·sinθ, ux·sinθ, cosθ)（z 为正是离开观看者），
    // 朝观看者就取反；抬高的层在屏幕上往表盘远侧挪，和真实 3D 一致，深度遮挡才对得上
    return {
        matrix,
        flat: false,
        lift: [uy * sin, -ux * sin, -cos / focal],
        invFocal: 1 / focal,
    };
};

/** 轮心视角相机高度、后退距离的可调范围（轮盘半径的倍数）。 */
export const PENDOLO_HUB_VIEW_HEIGHT_MIN = 0.4;
export const PENDOLO_HUB_VIEW_HEIGHT_MAX = 3;
// 后退距离不到 0 时相机就在轮心正上方，弧线两端的句子贴近相机平面；留一点距离，配合两端淡出
export const PENDOLO_HUB_VIEW_BACK_MIN = 0.2;
export const PENDOLO_HUB_VIEW_BACK_MAX = 3;

/** 轮心视角的视距按视口长边的倍数算：比倾斜的 1.2 广一些，左右两侧的歌词也进得了画面。 */
const PENDOLO_HUB_VIEW_FOCAL_FACTOR = 0.75;
/** 轮心视角下焦点句落在屏幕上的位置（视口宽、高的比例）：偏上一点，近处的齿轮留在下半屏。 */
const PENDOLO_HUB_VIEW_TARGET_X = 0.5;
const PENDOLO_HUB_VIEW_TARGET_Y = 0.42;

/**
 * 轮心视角：相机从轮心沿刻度针反方向后退 `backDistancePx`、抬高 `cameraHeightPx`，越过轮心看向焦点句
 * （离轮心 `targetDistancePx`，在针的方向上）；`side` 是针的朝向（1 朝右，镜像时 -1）。点都是相对轮心的
 * 屏幕布局坐标（和倾斜一样，表盘画布再乘镜像）。`hubX`/`hubY` 是轮心在屏幕上的位置，焦点句投到视口里固定的一点。
 *
 * 相机在 (-s·B, 0, H)，到焦点句的水平距离 D' = D + B。相机坐标：前方 f = (s·D', 0, -H)/L，
 * 右手 r = (0, s, 0)，上方 u = (s·H, 0, D')/L（L = √(D'²+H²)）。点 (x, y, h) 相对相机是 (x + s·B, y, h - H)，
 * 屏幕 = 焦点句的位置 + F·(右, -上)/前。整体除以 L，焦点句那里 w = 1。高度方向是线性的，所以分层直接加
 * h·lift，不再按 1 - h/f 缩（invFocal 为 0）。w ≤ 0 的是相机背后的东西，着色器按齐次坐标裁掉。
 */
export const buildPendoloHubViewProjection = (
    cameraHeightPx: number,
    backDistancePx: number,
    targetDistancePx: number,
    side: 1 | -1,
    hubX: number,
    hubY: number,
    viewportWidth: number,
    viewportHeight: number,
): PendoloDialProjection => {
    const s = side;
    const H = Math.max(1, cameraHeightPx);
    const B = Math.max(0, backDistancePx);
    const D = Math.max(1, targetDistancePx);
    const Dc = D + B;
    const L2 = Dc * Dc + H * H;
    const L = Math.sqrt(L2);
    const F = PENDOLO_HUB_VIEW_FOCAL_FACTOR * Math.max(1, viewportWidth, viewportHeight);
    // 焦点句在屏幕上相对轮心的位置
    const sx = viewportWidth * PENDOLO_HUB_VIEW_TARGET_X - hubX;
    const sy = viewportHeight * PENDOLO_HUB_VIEW_TARGET_Y - hubY;
    // w = 前 / L；x' = F·右/L + sx·w；y' = -F·上/L + sy·w
    const w0 = (s * Dc) / L2;
    const wc = (Dc * B + H * H) / L2;
    const matrix = new Float32Array([
        sx * w0, (F * s) / L, sx * wc,
        (-F * s * H) / L2 + sy * w0, 0, (F * D * H) / L2 + sy * wc,
        w0, 0, wc,
    ]);
    const lw = -H / L2;
    return {
        matrix,
        flat: false,
        lift: [sx * lw, (-F * Dc) / L2 + sy * lw, lw],
        invFocal: 0,
    };
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
        lift: tilt.lift,
        invFocal: tilt.invFocal,
    };
};

/**
 * 分层视差：离表盘平面高 `heightPx`（朝观看者）的一层的投影。平面内先缩 1 - h/f，再加上抬高的
 * 那一份；平放时 w = 1 - h/f 正好抵掉缩放，和高度 0 完全一样，所以只有倾斜时各层才错开。
 */
export const buildPendoloLayerProjection = (
    projection: PendoloDialProjection,
    heightPx: number,
): PendoloDialProjection => {
    if (projection.flat || !heightPx) return projection;
    const m = projection.matrix;
    const shrink = 1 - heightPx * projection.invFocal;
    const [lx, ly, lw] = projection.lift;
    return {
        ...projection,
        matrix: new Float32Array([
            m[0] * shrink, m[1] * shrink, m[2] + heightPx * lx,
            m[3] * shrink, m[4] * shrink, m[5] + heightPx * ly,
            m[6] * shrink, m[7] * shrink, m[8] + heightPx * lw,
        ]),
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

/**
 * 轮心视角下歌词立起来用的 CSS matrix3d：和 resolvePendoloPlaneCssTransform 一样把平面点投到屏幕，再把
 * z（离表盘平面的高度，朝观看者为正）接到抬高方向上，子元素用 preserve-3d 立起来时也按同一个相机投影。
 * 只对 invFocal 为 0 的投影（轮心视角）成立：那时高度是纯线性的一项，不再按 1 - h/f 缩。
 * 输出的 z 就是输入的 z：只用来让矩阵可逆（不可逆的变换浏览器整层不画），屏幕位置只看 x、y、w。
 */
export const resolvePendoloSpaceCssTransform = (projection: PendoloDialProjection): string => {
    const [a, b, c, d, e, f, g, h, i] = projection.matrix;
    const [lx, ly, lw] = projection.lift;
    return `matrix3d(${a}, ${d}, 0, ${g}, ${b}, ${e}, 0, ${h}, ${lx}, ${ly}, 1, ${lw}, ${c}, ${f}, 0, ${i})`;
};

/**
 * 同一个投影写成 CSS matrix3d（transform-origin 要放在轮心）：平面点 (x, y, 0, 1) 映成
 * (M·[x,y,1] 的 x', y', 0, w)，浏览器做透视除法，和着色器里的结果一致。
 */
export const resolvePendoloPlaneCssTransform = (projection: PendoloDialProjection): string => {
    const [a, b, c, d, e, f, g, h, i] = projection.matrix;
    // matrix3d 按列给：第一列是 x 的系数，第二列 y，第三列 z（保持不动），第四列常数项
    return `matrix3d(${a}, ${d}, 0, ${g}, ${b}, ${e}, 0, ${h}, 0, 0, 1, 0, ${c}, ${f}, 0, ${i})`;
};
