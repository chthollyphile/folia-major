import { FOG_DIV, NEBBIA_FIXED } from './nebbiaConstants';
import raindropSpriteUrl from './nebbiaRaindrop.png';
import { BLD_FILL_UNIFORMS, NebbiaBuildingCache, type NebbiaBuildingState } from './nebbiaBuildingCache';
import { makeTex, type NebbiaUniforms, type Tex } from './nebbiaGlUtils';
import { NebbiaMaskGl } from './nebbiaMaskGl';
import { canRenderFogToFloat, NebbiaProgramBuild } from './nebbiaPrograms';
import type { NebbiaSegments } from './nebbiaSegments';

// src/components/visualizer/nebbia/nebbiaGl.ts
// 雾笺的 WebGL2 部分：雾的预渲染和主画面两个全屏着色器，四张玻璃上的纹理（擦痕遮罩（nebbiaMaskGl.ts 每帧画）、擦痕边 / 雨点的水珠、雾上的凝结水珠、哈气的白气），
// 两张雾的预渲染（RGBA16F，1/4 画布分辨率，各一个 FBO、一层画一次；不支持浮点渲染目标时主画面自己算），
// 窗外楼群的缓存（nebbiaBuildingCache.ts，采样单元 9–14，雾的预渲染和主画面从它取楼群）。
// 着色器在后台编（nebbiaPrograms.ts）：`ready` 为真之前不画。
// 水珠精灵是 raindrop-fx 1.0.8（MIT，见 nebbiaRaindrop.LICENSE.txt）的 assets/img/raindrop.png。

type Locations = Record<string, WebGLUniformLocation | null>;

// 两层雾的模糊半径（屏高的比例）
const FOG_BLUR = [0.03, 0.09];
// 街景（两个程序都有）读的 uniform；其余只在主画面
const PALETTE_UNIFORMS = ['uSky0', 'uSky1', 'uLa', 'uLb', 'uLc'];
const SCENE_UNIFORMS = ['uRes', 'uSceneShift', 'uTime', 'uBus', 'uNeon', ...PALETTE_UNIFORMS, 'uSpotSrc', 'uSpotSrc2', 'uSpotTgt', 'uSpotR', 'uSpotI', 'uBldOn', 'uBldGeo'];
const MAIN_UNIFORMS = [...SCENE_UNIFORMS, 'uMist', 'uEdge', 'uRefract', 'uGlint', 'uGlassShift', 'uBreathOn', 'uBreathThick'];

const locate = (gl: WebGL2RenderingContext, prog: WebGLProgram, names: string[]): Locations => (
    Object.fromEntries(names.map(n => [n, gl.getUniformLocation(prog, n)]))
);

/**
 * 按 CSS 尺寸和像素比定画布尺寸，没变就不碰：建了 WebGL 上下文以后改尺寸要同步等 GPU 进程，
 * 着色器还在编时会一直等到编完（Linux 上冷编约 0.5 秒）。运行时在建上下文之前先调一次。
 */
export const fitNebbiaCanvas = (canvas: HTMLCanvasElement, W: number, H: number, dpr: number) => {
    const width = Math.max(1, Math.round(W * dpr)), height = Math.max(1, Math.round(H * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
};

export class NebbiaGl {
    private readonly gl: WebGL2RenderingContext;
    private readonly build: NebbiaProgramBuild;
    private readonly quadVao: WebGLVertexArrayObject;
    private readonly spriteVao: WebGLVertexArrayObject;
    private readonly instBuf: WebGLBuffer;
    /** 编好后取的 uniform 位置：主画面、雾的预渲染、楼群缓存的补画。 */
    private U: Locations = {};
    private F: Locations = {};
    private B: Locations = {};
    private readonly bld: NebbiaBuildingCache;
    private uView: WebGLUniformLocation | null = null;
    private uFogB: WebGLUniformLocation | null = null;
    private linked = false;
    private readonly mask: NebbiaMaskGl; private readonly drop: Tex; private readonly field: Tex; private readonly sprite: Tex; private readonly breath: Tex;
    private readonly fogTex: Tex[];
    private readonly fogOK: boolean;
    private readonly fogFbs: WebGLFramebuffer[] = [];
    private fogW = 1; private fogH = 1;
    private W = 1; private H = 1;
    private spriteReady = false;
    private instData = new Float32Array(0);
    /** 主题配色：编好之前先记下，编好时补上。 */
    private palette: number[][] | null = null;
    /** 精灵贴图加载好时调（这之前不画水珠）。 */
    onSpriteReady: (() => void) | null = null;

    constructor(private readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false });
        if (!gl) throw new Error('Nebbia: WebGL2 unavailable');
        this.gl = gl;
        this.fogOK = canRenderFogToFloat(gl);
        this.build = new NebbiaProgramBuild(gl, this.fogOK);
        this.quadVao = gl.createVertexArray()!;
        gl.bindVertexArray(this.quadVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        // 属性位置在 nebbiaPrograms.ts 里绑死：aPos 0；aCorner 0、aRect 1、aParam 2；遮罩 aCorner 0、aSeg 1、aParam 2
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.mask = new NebbiaMaskGl(gl, 2);
        this.drop = makeTex(gl, 3);
        this.field = makeTex(gl, 4);
        this.sprite = makeTex(gl, 5);
        this.fogTex = [makeTex(gl, 6), makeTex(gl, 7)];
        this.breath = makeTex(gl, 8);
        this.bld = new NebbiaBuildingCache(gl, 9);
        if (this.fogOK) for (let i = 0; i < 2; i += 1) this.fogFbs.push(gl.createFramebuffer()!);

        this.spriteVao = gl.createVertexArray()!;
        gl.bindVertexArray(this.spriteVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        this.instBuf = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(1, 1);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(2, 1);
        gl.bindVertexArray(null);
        this.loadSprite();
    }

    get isContextLost() {
        return this.gl.isContextLost();
    }

    /** 着色器编好了没有（没编好不等）；编好的那一次取 uniform 位置、指好采样器。链接失败时抛错。 */
    get ready(): boolean {
        if (this.linked) return true;
        if (!this.build.poll()) return false;
        const { gl } = this;
        const { main, fog, sprite, mask, bldFill } = this.build.programs;
        this.mask.attach(mask);
        this.U = locate(gl, main, MAIN_UNIFORMS);
        gl.useProgram(main);
        const samplers: [string, Tex][] = [['uMask', this.mask.tex], ['uDrop', this.drop], ['uField', this.field], ['uFogBlur', this.fogTex[0]], ['uFogGlow', this.fogTex[1]], ['uBreath', this.breath]];
        for (const [name, tex] of samplers) gl.uniform1i(gl.getUniformLocation(main, name), tex.unit);
        gl.uniform1f(this.U.uBreathThick, NEBBIA_FIXED.breathThick);
        this.bld.bindSamplers(main);
        if (fog) {
            this.F = locate(gl, fog, SCENE_UNIFORMS);
            this.uFogB = gl.getUniformLocation(fog, 'uFogB');
            this.bld.bindSamplers(fog);
        }
        this.B = locate(gl, bldFill, [...PALETTE_UNIFORMS, ...BLD_FILL_UNIFORMS]);
        gl.useProgram(sprite);
        this.uView = gl.getUniformLocation(sprite, 'uView');
        gl.uniform1i(gl.getUniformLocation(sprite, 'uSprite'), this.sprite.unit);
        this.linked = true;
        if (this.palette) this.applyPalette(this.palette);
        return true;
    }

    private loadSprite() {
        const img = new Image();
        img.onload = () => {
            const { gl } = this;
            if (gl.isContextLost()) return;
            gl.activeTexture(gl.TEXTURE0 + this.sprite.unit);
            gl.bindTexture(gl.TEXTURE_2D, this.sprite.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            this.spriteReady = true;
            this.onSpriteReady?.();
        };
        img.src = raindropSpriteUrl;
    }

    /** 主题配色：天色两档、三个灯光色，0..1 的 RGB。 */
    setPalette(sky0: number[], sky1: number[], la: number[], lb: number[], lc: number[]) {
        this.palette = [sky0, sky1, la, lb, lc];
        if (this.linked) this.applyPalette(this.palette);
    }

    private applyPalette([sky0, sky1, la, lb, lc]: number[][]) {
        const { gl } = this;
        const { main, fog, bldFill } = this.build.programs;
        for (const [prog, L] of [[main, this.U], [fog, this.F], [bldFill, this.B]] as const) {
            if (!prog) continue;
            gl.useProgram(prog);
            gl.uniform3fv(L.uSky0, sky0); gl.uniform3fv(L.uSky1, sky1);
            gl.uniform3fv(L.uLa, la); gl.uniform3fv(L.uLb, lb); gl.uniform3fv(L.uLc, lc);
        }
        // 楼群的颜色跟着配色：缓存全部重画
        this.bld.invalidate();
    }

    /** W、H 是 CSS 像素（水珠纹理用这个分辨率），dpr 是画布的像素比。 */
    resize(W: number, H: number, dpr: number) {
        const { gl } = this;
        this.W = Math.max(1, Math.round(W)); this.H = Math.max(1, Math.round(H));
        fitNebbiaCanvas(this.canvas, W, H, dpr);
        this.mask.resize(W, H);
        for (const tex of [this.drop, this.field]) {
            gl.activeTexture(gl.TEXTURE0 + tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, tex.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            if (!tex.fb) tex.fb = gl.createFramebuffer()!;
            gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0);
        }
        // 帧缓冲能不能拼起来在建上下文时已经试过（canRenderFogToFloat），这里不再同步查状态
        if (this.fogOK) {
            this.fogW = Math.max(1, Math.ceil(this.canvas.width / FOG_DIV));
            this.fogH = Math.max(1, Math.ceil(this.canvas.height / FOG_DIV));
            this.fogTex.forEach((tex, i) => {
                gl.activeTexture(gl.TEXTURE0 + tex.unit);
                gl.bindTexture(gl.TEXTURE_2D, tex.t);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.fogW, this.fogH, 0, gl.RGBA, gl.HALF_FLOAT, null);
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.fogFbs[i]);
                gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0);
            });
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.bld.resize(this.canvas.width, this.canvas.height, Math.max(1, Math.ceil(this.canvas.height / FOG_DIV)));
    }

    // 水珠实例画进一张水珠纹理（CSS 分辨率）
    private renderDrops(tex: Tex, inst: number[]) {
        const { gl } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb!);
        gl.viewport(0, 0, this.W, this.H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (inst.length && this.spriteReady) {
            if (this.instData.length < inst.length) this.instData = new Float32Array(Math.ceil(inst.length * 1.5));
            this.instData.set(inst);
            gl.useProgram(this.build.programs.sprite);
            gl.bindVertexArray(this.spriteVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
            gl.bufferData(gl.ARRAY_BUFFER, this.instData.subarray(0, inst.length), gl.DYNAMIC_DRAW);
            gl.uniform2f(this.uView, this.W, this.H);
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, inst.length / 6);
            gl.disable(gl.BLEND);
            gl.bindVertexArray(null);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // 街景要的 uniform（两个程序都设）
    private setScene(L: Locations, u: NebbiaUniforms) {
        const { gl } = this;
        gl.uniform2f(L.uRes, this.canvas.width, this.canvas.height);
        gl.uniform1f(L.uTime, u.time); gl.uniform1f(L.uBus, u.bus); gl.uniform1f(L.uNeon, u.neon);
        gl.uniform2fv(L.uSceneShift, u.sceneShift);
        gl.uniform2fv(L.uSpotSrc, u.spotSrc); gl.uniform2fv(L.uSpotSrc2, u.spotSrc2); gl.uniform2fv(L.uSpotTgt, u.spotTgt);
        gl.uniform1f(L.uSpotR, u.spotR); gl.uniform1f(L.uSpotI, u.spotI);
    }

    // 楼群缓存的取样状态（两个程序都设）
    private setBuildings(L: Locations, s: NebbiaBuildingState) {
        const { gl } = this;
        gl.uniform3i(L.uBldOn, s.on[0], s.on[1], s.on[2]);
        gl.uniform3fv(L.uBldGeo, s.geo);
    }

    /**
     * 画一帧（`ready` 为真之后才调）：擦痕遮罩，白气遮罩上传（只在这一帧有哈气时传，`breath` 为 null 就不传），
     * 两张水珠纹理，补画楼群缓存，雾的预渲染，主画面。
     */
    render(mask: NebbiaSegments, breath: HTMLCanvasElement | null, drops: number[], field: number[], u: NebbiaUniforms) {
        const { gl, U } = this;
        const { main, fog, bldFill } = this.build.programs;
        this.mask.draw(mask);
        if (breath) {
            gl.activeTexture(gl.TEXTURE0 + this.breath.unit);
            gl.bindTexture(gl.TEXTURE_2D, this.breath.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, breath);
        }
        this.renderDrops(this.drop, drops);
        this.renderDrops(this.field, field);
        gl.bindVertexArray(this.quadVao);
        const buildings = this.bld.update(u.time * u.bus, bldFill, this.B);
        if (fog) {
            // 预渲染只采样楼群缓存，画进雾纹理不会和主画面的采样单元成反馈环
            gl.useProgram(fog);
            this.setScene(this.F, u);
            this.setBuildings(this.F, buildings);
            gl.viewport(0, 0, this.fogW, this.fogH);
            FOG_BLUR.forEach((b, i) => {
                gl.bindFramebuffer(gl.FRAMEBUFFER, this.fogFbs[i]);
                gl.uniform1f(this.uFogB, b);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            });
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        }
        gl.useProgram(main);
        this.setScene(U, u);
        this.setBuildings(U, buildings);
        gl.uniform1f(U.uMist, u.mist); gl.uniform1f(U.uEdge, u.edge);
        gl.uniform1f(U.uRefract, u.refract); gl.uniform1f(U.uGlint, u.glint);
        gl.uniform2fv(U.uGlassShift, u.glassShift);
        gl.uniform1i(U.uBreathOn, breath ? 1 : 0);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    destroy() {
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}
