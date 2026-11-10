import * as THREE from 'three';

// src/components/visualizer/machi/engine/programWarmup.ts
// 町景的着色器预编：起步和换场景时先把这一帧要用的着色器程序都交给 GPU 去编，等它们编好再画第一帧，
// 编译不再卡在第一帧的 render 里（冷启动一秒多、热缓存也要两三百毫秒，样式切换的动画会停在半路）。
// three 的程序按“材质 + 画进哪种目标”区分：画进 HDR 目标的是线性输出、不做色调映射，直接上屏的才带 sRGB 和色调映射，
// 所以每组都要在它真正画进的那个目标下编（compileInto），不然编出来的变体一个也用不上。
// 有 KHR_parallel_shader_compile 时编译在 GPU 进程的后台跑，这里只隔一会儿问一次好了没有（waitForPrograms），不占主线程；
// 没有这个扩展时 three 把程序当作已经编好，第一帧照旧同步等，和以前一样。

/** 问一次程序好了没有的间隔。 */
const POLL_MS = 12;
/** 最多等这么久（驱动卡住之类）：到点照样往下走，剩下的由第一帧同步编完。 */
const GIVE_UP_MS = 8000;

/** 让出主线程一次：其它任务（选择框的动画、输入）先跑。 */
export const yieldToMain = (): Promise<void> => {
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (typeof scheduler?.yield === 'function') return scheduler.yield();
    return new Promise(resolve => setTimeout(resolve, 0));
};

/**
 * 在 target 这个渲染目标下，为 root 里 only 选中的网格发起编译（不等结果）。灯取自 lightsFrom（按镜头的图层），
 * 雾、环境也按它；only 用来跳过这个镜头画不到的东西（倒影只画 REFLECT 图层）。
 */
export const compileInto = (
    renderer: THREE.WebGLRenderer,
    target: THREE.WebGLRenderTarget | null,
    root: THREE.Object3D,
    camera: THREE.Camera,
    lightsFrom: THREE.Scene,
    only?: (object: THREE.Object3D) => boolean,
) => {
    // renderer.compile 只用 traverse 找材质；要筛选时给它一个只遍历选中网格的壳，灯另从 lightsFrom 取。
    const subject = only
        ? ({ traverse: (visit: (object: THREE.Object3D) => void) => root.traverse(object => { if (only(object)) visit(object); }), traverseVisible: () => {} } as unknown as THREE.Object3D)
        : root;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    try {
        renderer.compile(subject, camera, lightsFrom);
    } finally {
        renderer.setRenderTarget(previous);
    }
};

interface ThreeProgram {
    name: string;
    /** 材质的着色器类型（MeshToonMaterial、ShaderMaterial 之类），没起名字的材质靠它认。 */
    type: string;
    program: WebGLProgram;
    isReady: () => boolean;
}

/** 渲染器里的程序（three 的 WebGLProgram，类型里写成了 DOM 的 WebGLProgram）。 */
const programsOf = (renderer: THREE.WebGLRenderer) => (renderer.info.programs ?? []) as unknown as ThreeProgram[];

const checkedPrograms = new WeakSet<ThreeProgram>();

/**
 * 查一遍新编好的程序有没有链接失败，失败的才取日志报出来。three 自己的检查（debug.checkShaderErrors）在每个程序第一次用时
 * 同步取编译日志，几十个程序要几十毫秒，全落在第一帧里；生产构建关掉它，换成这里只问一次链接状态（便宜）。
 */
export const reportBrokenPrograms = (renderer: THREE.WebGLRenderer) => {
    if (renderer.debug.checkShaderErrors) return;
    const gl = renderer.getContext();
    programsOf(renderer).forEach(entry => {
        if (checkedPrograms.has(entry) || !entry.isReady()) return;
        checkedPrograms.add(entry);
        if (gl.getProgramParameter(entry.program, gl.LINK_STATUS)) return;
        // 链接日志常常只说“着色器没编过”，真正的报错和行号在各个着色器自己的编译日志里。
        const shaderLogs = (gl.getAttachedShaders(entry.program) ?? [])
            .filter(shader => !gl.getShaderParameter(shader, gl.COMPILE_STATUS))
            .map(shader => gl.getShaderInfoLog(shader));
        console.error(`[Machi] shader program ${entry.name || entry.type} failed to link`, { link: gl.getProgramInfoLog(entry.program), shaders: shaderLogs });
    });
};

/** 等渲染器里所有程序都编好（或中止、超时）。 */
export const waitForPrograms = (renderer: THREE.WebGLRenderer, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const check = () => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        // isReady 用并行编译扩展问，不阻塞。
        if (programsOf(renderer).every(program => program.isReady())) {
            resolve();
            return;
        }
        if (performance.now() - startedAt > GIVE_UP_MS) {
            console.warn(`[Machi] shader programs still compiling after ${GIVE_UP_MS} ms, drawing anyway`);
            resolve();
            return;
        }
        setTimeout(check, POLL_MS);
    };
    check();
});
