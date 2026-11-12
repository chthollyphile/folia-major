// src/components/visualizer/nebbia/nebbiaGlUtils.ts
// 雾笺 WebGL2 的小工具：着色器编译、程序提交和链接结果检查、纹理创建，以及主着色器每帧的 uniform 类型（从 nebbiaGl.ts 拆出）。

export interface Tex { t: WebGLTexture; unit: number; fb?: WebGLFramebuffer }
export interface NebbiaUniforms {
    time: number; mist: number; edge: number; refract: number; bus: number; glint: number; neon: number;
    glassShift: [number, number]; sceneShift: [number, number];
    spotSrc: [number, number]; spotSrc2: [number, number]; spotTgt: [number, number]; spotR: number; spotI: number;
    /** 窗外画哪几样，位和着色器的 SCN_* 对应（nebbiaFrameUniforms.ts 的 SCENERY_BITS）。 */
    scenery: number;
    /** 凝露玻璃的冷凝水珠高光（tuning.dewGlint；雨窗的程序里没有这个 uniform）。 */
    dewGlint: number;
    /** 窗外是水族箱时：水母（nebbiaJellies.ts 每帧算好）和气泡多少；街景时 null。 */
    aqua: NebbiaAquaUniforms | null;
}
export interface NebbiaAquaUniforms {
    /** 每只 4 个数：x、y（scene 坐标）、伞盖半径、收缩；长度是着色器数组的 24 只。 */
    jelly: Float32Array;
    /** 每只 4 个数：颜色 rgb、触手波的相位。 */
    jellyColor: Float32Array;
    count: number;
    bubbles: number;
    /** 水草跟拍的弹簧：现在、0.05、0.1、0.15 秒前的横向偏移（nebbiaWeedSway.ts）。 */
    sway: Float32Array;
    /** 水草自己摆动的幅度 0..1：跟拍时落到 0，只剩跟拍的推动。 */
    weedIdle: number;
    /** 跟拍冒的一排排大泡，每排 4 个数：x、冒出的时刻（窗外时钟）、大小 0..1、种子；长度是着色器数组的 NEBBIA_MAX_BURSTS 排。 */
    bursts: Float32Array;
    burstCount: number;
    /** 1 时不冒随机的大泡（舞潮踏拍的气泡一项开着，大泡只跟拍一排排冒）；0 时照常。 */
    beatRows: number;
    /** 聚光灯光斑半径乘多少（舞潮踏拍的聚光灯一项跟拍放大，不跟拍时 1）。 */
    spotScale: number;
}

/** 提交编译，不等结果（结果在链接时一起查，见 checkLinked）。 */
export const compileShader = (gl: WebGL2RenderingContext, type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
};

/** 提交链接，不等结果：属性位置先绑死，VAO 不必等程序编好就能建。 */
export const startProgram = (gl: WebGL2RenderingContext, vs: WebGLShader, fs: WebGLShader, attribs: Record<string, number>) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    for (const [name, index] of Object.entries(attribs)) gl.bindAttribLocation(p, index, name);
    gl.linkProgram(p);
    return p;
};

/** 链接结果：失败时把着色器的报错一起抛出。查 LINK_STATUS 会等到编完，所以先确认编好了再调。 */
export const checkLinked = (gl: WebGL2RenderingContext, p: WebGLProgram) => {
    if (gl.getProgramParameter(p, gl.LINK_STATUS)) return;
    const shaderLogs = (gl.getAttachedShaders(p) ?? []).map(s => gl.getShaderInfoLog(s)).filter(Boolean).join('\n');
    throw new Error(`Nebbia program: ${gl.getProgramInfoLog(p)}${shaderLogs ? `\n${shaderLogs}` : ''}`);
};

/** 一张线性过滤、边缘夹紧的纹理，挂在采样单元 `unit` 上（程序编好后再把采样器指过来）。 */
export const makeTex = (gl: WebGL2RenderingContext, unit: number): Tex => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { t, unit };
};
