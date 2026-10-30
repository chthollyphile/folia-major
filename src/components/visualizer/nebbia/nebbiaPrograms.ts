import { checkLinked, compileShader, startProgram } from './nebbiaGlUtils';
import { NEBBIA_MASK_FS, NEBBIA_MASK_VS } from './nebbiaMaskGl';
import { NEBBIA_BLD_FILL_FS, NEBBIA_FOG_FS, NEBBIA_MAIN_FALLBACK_FS, NEBBIA_MAIN_FS, NEBBIA_SPRITE_FS, NEBBIA_SPRITE_VS, NEBBIA_VS } from './nebbiaShaders';

// src/components/visualizer/nebbia/nebbiaPrograms.ts
// 雾笺的五个着色器程序（雾的预渲染、主画面、水珠精灵、擦痕遮罩、楼群缓存的补画）在后台编：有 KHR_parallel_shader_compile 时提交了不等，
// 每帧问一次编好没有，编好才查链接结果（查结果会一直等到编完，D3D11 上冷编要将近 1 秒）；问编好没有只读共享内存，不等 GPU 进程。
// 没有这个扩展时提交后插一个栅栏，栅栏到了再查：栅栏是异步查的，到了说明 GPU 进程已经处理完前面的链接，查结果不用再等。
// 运行时（nebbiaGl.ts）和启动时的预热（nebbiaShaderWarmup.ts）都从这里编：源码、属性位置一样，GPU 进程的程序缓存才对得上。

export interface NebbiaPrograms {
    /** 雾的预渲染；不能渲染到浮点纹理时没有（主画面自己算雾）。 */
    fog: WebGLProgram | null;
    main: WebGLProgram;
    sprite: WebGLProgram;
    /** 擦痕遮罩（nebbiaMaskGl.ts）。 */
    mask: WebGLProgram;
    /** 往楼群缓存里补画（nebbiaBuildingCache.ts）。 */
    bldFill: WebGLProgram;
}

type ParallelCompile = { COMPLETION_STATUS_KHR: number };

/** 能不能把雾预渲染到浮点纹理：有 EXT_color_buffer_float，而且 RGBA16F 的帧缓冲拼得起来。上下文刚建好时调（查状态要等 GPU 进程一个来回）。 */
export const canRenderFogToFloat = (gl: WebGL2RenderingContext): boolean => {
    if (!gl.getExtension('EXT_color_buffer_float')) return false;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    // 有的驱动报了 EXT_color_buffer_float 却拼不成 RGBA16F 的帧缓冲：退回主画面自己算雾
    if (!ok) console.warn('[Nebbia] fog prepass framebuffer incomplete, computing the fog in the main pass');
    return ok;
};

/** 提交五个程序的编译，`poll` 问编好没有。 */
export class NebbiaProgramBuild {
    readonly programs: NebbiaPrograms;
    private readonly parallel: ParallelCompile | null;
    /** 没有并行编译扩展时，提交编译后插的栅栏：没到之前不查链接结果。 */
    private fence: WebGLSync | null;
    private done = false;

    constructor(private readonly gl: WebGL2RenderingContext, fogToFloat: boolean) {
        this.parallel = gl.getExtension('KHR_parallel_shader_compile') as ParallelCompile | null;
        const vs = compileShader(gl, gl.VERTEX_SHADER, NEBBIA_VS);
        const frag = (src: string) => compileShader(gl, gl.FRAGMENT_SHADER, src);
        this.programs = {
            fog: fogToFloat ? startProgram(gl, vs, frag(NEBBIA_FOG_FS), { aPos: 0 }) : null,
            main: startProgram(gl, vs, frag(fogToFloat ? NEBBIA_MAIN_FS : NEBBIA_MAIN_FALLBACK_FS), { aPos: 0 }),
            sprite: startProgram(gl, compileShader(gl, gl.VERTEX_SHADER, NEBBIA_SPRITE_VS), frag(NEBBIA_SPRITE_FS), { aCorner: 0, aRect: 1, aParam: 2 }),
            mask: startProgram(gl, compileShader(gl, gl.VERTEX_SHADER, NEBBIA_MASK_VS), frag(NEBBIA_MASK_FS), { aCorner: 0, aSeg: 1, aParam: 2 }),
            bldFill: startProgram(gl, vs, frag(NEBBIA_BLD_FILL_FS), { aPos: 0 }),
        };
        this.fence = this.parallel ? null : gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
    }

    /** 都编好了吗：没编好返回 false，不等；编好了查链接结果，失败抛错。 */
    poll(): boolean {
        if (this.done) return true;
        const { gl, parallel, fence } = this;
        if (fence) {
            // 栅栏的状态要回到事件循环才更新：同一个任务里提交完马上问，总是没到
            if (gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) return false;
            gl.deleteSync(fence);
            this.fence = null;
        }
        const list = [this.programs.fog, this.programs.main, this.programs.sprite, this.programs.mask, this.programs.bldFill].filter((p): p is WebGLProgram => !!p);
        if (parallel && !list.every(p => gl.getProgramParameter(p, parallel.COMPLETION_STATUS_KHR))) return false;
        for (const p of list) checkLinked(gl, p);
        // 链接好了，着色器对象不再要：删掉（挂在程序上的等程序删了才真正释放）
        for (const p of list) for (const s of gl.getAttachedShaders(p) ?? []) gl.deleteShader(s);
        this.done = true;
        return true;
    }
}
