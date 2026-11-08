import { readStoredTuning } from '../../../stores/visualizerSettingsPersistence';
import { canRenderFogToFloat, NebbiaProgramBuild } from './nebbiaPrograms';
import nebbiaTuning from './tuning';

// src/components/visualizer/nebbia/nebbiaShaderWarmup.ts
// 启动时预先编雾笺的着色器（entry.tsx 的 prewarm：保存的歌词样式是雾笺时应用一启动就调，否则首屏出来后空闲时调）。在一个不上屏的
// WebGL2 上下文里按运行时同样的编法编一遍，编好就丢掉上下文：GPU 进程留着编好的程序（内存里，也写进磁盘缓存），
// 雾笺真正挂上时链接直接命中，不用再等将近 1 秒的冷编。编译在 GPU 进程的后台线程上跑，这里只每隔一会儿问一次，不占主线程。

const POLL_MS = 100;
/** 最多等这么久：还编不完（驱动卡住之类）就放弃，运行时自己再编。 */
const GIVE_UP_MS = 30_000;

let started = false;

/** 预热一次（同一个窗口里只做一次）；没有 WebGL2 或编不过时什么都不做，运行时照常处理。 */
export const warmNebbiaShaders = (): void => {
    if (started || typeof document === 'undefined') return;
    started = true;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    // 上下文参数和运行时（nebbiaGl.ts）一样；透明时运行时带透明通道，程序缓存按源码命中，不影响
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
    if (!gl) {
        console.info('[Nebbia] shader warm-up skipped: no WebGL2');
        return;
    }
    // 没有并行编译扩展时查结果会卡住主线程：那就不预热，留给运行时
    if (!gl.getExtension('KHR_parallel_shader_compile')) {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        console.info('[Nebbia] shader warm-up skipped: no KHR_parallel_shader_compile');
        return;
    }
    const startedAt = performance.now();
    // 窗外是哪套场景、玻璃是哪种是着色器变体：按保存的那套编
    const { defaults, storage } = nebbiaTuning;
    const saved = storage ? readStoredTuning({ defaults, storage }) : defaults;
    const scene = saved.behind === 'aquarium' ? 'aquarium' : 'night';
    const build = new NebbiaProgramBuild(gl, canRenderFogToFloat(gl), scene, saved.glass);
    const finish = (outcome: string, error?: unknown) => {
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        const ms = Math.round(performance.now() - startedAt);
        if (error) console.warn(`[Nebbia] shader warm-up ${outcome} after ${ms} ms`, error);
        else console.info(`[Nebbia] shader warm-up ${outcome} in ${ms} ms`);
    };
    const poll = () => {
        if (gl.isContextLost()) return finish('lost the context');
        try {
            if (build.poll()) return finish('done');
        } catch (error) {
            return finish('failed', error);
        }
        if (performance.now() - startedAt > GIVE_UP_MS) return finish('gave up');
        window.setTimeout(poll, POLL_MS);
    };
    window.setTimeout(poll, POLL_MS);
};
