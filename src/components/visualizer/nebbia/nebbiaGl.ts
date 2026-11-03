import { FOG_DIV, NEBBIA_FIXED } from './nebbiaConstants';
import raindropSpriteUrl from './nebbiaRaindrop.png';
import { BLD_FILL_UNIFORMS, NebbiaBuildingCache, type NebbiaBuildingState } from './nebbiaBuildingCache';
import { NebbiaFogGl } from './nebbiaFogGl';
import { NebbiaNoiseTex } from './nebbiaNoiseTex';
import { makeTex, type NebbiaUniforms, type Tex } from './nebbiaGlUtils';
import { NebbiaMaskGl } from './nebbiaMaskGl';
import { canRenderFogToFloat, NebbiaProgramBuild } from './nebbiaPrograms';
import type { NebbiaSegments } from './nebbiaSegments';
import { NebbiaSnowGl } from './nebbiaSnowGl';
import { NebbiaFireflyGl } from './nebbiaFireflyGl';
import type { NebbiaGlass, NebbiaWindowScene } from './types';

// src/components/visualizer/nebbia/nebbiaGl.ts
// 雾笺的 WebGL2 部分：雾的预渲染和主画面两个全屏着色器，四张玻璃上的纹理（擦痕遮罩（nebbiaMaskGl.ts 每帧画）、擦痕边 / 雨点的水珠、雾上的凝结水珠、哈气的白气），
// 两张雾的预渲染（nebbiaFogGl.ts，RGBA16F，1/4、1/8 画布分辨率；不支持浮点渲染目标时主画面自己算；凝露玻璃再加一张清晰的给细水珠折射，采样单元 1），
// 窗外楼群的缓存（nebbiaBuildingCache.ts，采样单元 9–14，雾的预渲染和主画面从它取楼群），
// 静态噪声纹理（nebbiaNoiseTex.ts，采样单元 15）；雪窗的雪花在主画面之后叠上去（nebbiaSnowGl.ts，图集在采样单元 1，凝露才用的那个）。
// 透明（seeThrough）时画布带透明通道，窗外不画：楼群缓存和雾的预渲染都跳过，主画面输出预乘的透明度。
// 窗外是水族箱（scene）时程序按水族箱编，没有楼群缓存，每帧多传水母和气泡的 uniform。
// 着色器在后台编（nebbiaPrograms.ts）：`ready` 为真之前不画。
// 水珠精灵是 raindrop-fx 1.0.8（MIT，见 nebbiaRaindrop.LICENSE.txt）的 assets/img/raindrop.png。

type Locations = Record<string, WebGLUniformLocation | null>;

// 街景（两个程序都有）读的 uniform；其余只在主画面
const PALETTE_UNIFORMS = ['uSky0', 'uSky1', 'uLa', 'uLb', 'uLc'];
// 水族箱的（uJelly 这些）在街景的程序里取不到位置，设了也没事
const SCENE_UNIFORMS = ['uRes', 'uSceneShift', 'uTime', 'uBus', 'uNeon', ...PALETTE_UNIFORMS, 'uSpotSrc', 'uSpotSrc2', 'uSpotTgt', 'uSpotR', 'uSpotI', 'uScenery', 'uBldOn', 'uBldGeo',
    'uJelly', 'uJellyC', 'uJellyN', 'uBubbles', 'uSway', 'uBurst', 'uBurstN', 'uBeatRows'];
const MAIN_UNIFORMS = [...SCENE_UNIFORMS, 'uDewGlint', 'uMist', 'uEdge', 'uRefract', 'uGlint', 'uGlassShift', 'uBreathOn', 'uBreathThick', 'uNoiseOn', 'uSeeThrough', 'uMistTint'];

/** uScenery 里楼群那一位（nebbiaFrameUniforms.ts 的 SCENERY_BITS），和关着时给着色器的楼群缓存状态。 */
const SCN_BUILDINGS = 1;
const NO_BUILDINGS: NebbiaBuildingState = { on: [0, 0, 0], geo: [0, 1, 1, 0, 1, 1, 0, 1, 1] };

const locate = (gl: WebGL2RenderingContext, prog: WebGLProgram, names: string[]): Locations => (
    Object.fromEntries(names.map(n => [n, gl.getUniformLocation(prog, n)]))
);

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
    /** 楼群缓存，只有雨夜街景有（水族箱没有楼群，不建这几张纹理）。 */
    private readonly bld: NebbiaBuildingCache | null;
    private uView: WebGLUniformLocation | null = null;
    private uFogB: WebGLUniformLocation | null = null;
    private linked = false;
    private readonly mask: NebbiaMaskGl; private readonly drop: Tex; private readonly field: Tex; private readonly sprite: Tex; private readonly breath: Tex;
    private readonly fogGl: NebbiaFogGl;
    private readonly fogOK: boolean;
    private readonly noise: NebbiaNoiseTex;
    private readonly snow: NebbiaSnowGl | null;
    /** 凝露玻璃上的萤虫；别的玻璃 null。 */
    private readonly fireflies: NebbiaFireflyGl | null;
    private W = 1; private H = 1;
    private spriteReady = false;
    /** 白气纹理里是哪一版画布、多大（版本没变不重传）。 */
    private breathVersion = -1; private breathW = 0; private breathH = 0;
    /** 雾上水珠纹理是不是还是对的：换尺寸后、精灵贴图加载好之前画的都不算，下一帧照画。 */
    private fieldValid = false;
    private instData = new Float32Array(0);
    /** 主题配色：编好之前先记下，编好时补上。 */
    private palette: number[][] | null = null;
    /** 透明时雾的颜色（0..1 的 RGB），跟主题日夜。 */
    mistTint: [number, number, number] = [0.07, 0.08, 0.1];
    /** 精灵贴图加载好时调（这之前不画水珠）。 */
    onSpriteReady: (() => void) | null = null;

    constructor(private readonly canvas: HTMLCanvasElement, private readonly seeThrough = false, scene: NebbiaWindowScene = 'night', glass: NebbiaGlass = 'rain') {
        const gl = canvas.getContext('webgl2', { antialias: false, alpha: seeThrough, preserveDrawingBuffer: false });
        if (!gl) throw new Error('Nebbia: WebGL2 unavailable');
        this.gl = gl;
        this.fogOK = canRenderFogToFloat(gl);
        this.build = new NebbiaProgramBuild(gl, this.fogOK, scene, glass);
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
        this.fogGl = new NebbiaFogGl(gl, 6, this.fogOK, glass === 'dew' && !seeThrough ? 1 : null);
        this.breath = makeTex(gl, 8);
        this.bld = scene === 'night' ? new NebbiaBuildingCache(gl, 9) : null;
        this.noise = new NebbiaNoiseTex(gl, 15);
        this.snow = glass === 'snow' ? new NebbiaSnowGl(gl, 1) : null;
        this.fireflies = glass === 'dew' ? new NebbiaFireflyGl(gl) : null;

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
        const { main, fog, sprite, mask, bldFill, flake, firefly } = this.build.programs;
        this.mask.attach(mask);
        this.U = locate(gl, main, MAIN_UNIFORMS);
        gl.useProgram(main);
        const [fogBlur, fogGlow, fogSharp] = this.fogGl.layers;
        const samplers: [string, Tex][] = [['uMask', this.mask.tex], ['uDrop', this.drop], ['uField', this.field], ['uFogBlur', fogBlur.tex], ['uFogGlow', fogGlow.tex], ['uBreath', this.breath], ['uNoise', this.noise.tex]];
        if (fogSharp) samplers.push(['uFogSharp', fogSharp.tex]);
        for (const [name, tex] of samplers) gl.uniform1i(gl.getUniformLocation(main, name), tex.unit);
        gl.uniform1f(this.U.uBreathThick, NEBBIA_FIXED.breathThick);
        gl.uniform1i(this.U.uSeeThrough, this.seeThrough ? 1 : 0);
        this.bld?.bindSamplers(main);
        if (fog) {
            this.F = locate(gl, fog, SCENE_UNIFORMS);
            this.uFogB = gl.getUniformLocation(fog, 'uFogB');
            this.bld?.bindSamplers(fog);
        }
        if (bldFill) this.B = locate(gl, bldFill, [...PALETTE_UNIFORMS, ...BLD_FILL_UNIFORMS]);
        if (flake) this.snow?.attach(flake, fogGlow.tex.unit, fogBlur.tex.unit, this.fogOK && !this.seeThrough);
        if (firefly) this.fireflies?.attach(firefly, fogGlow.tex.unit, this.fogOK && !this.seeThrough);
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
        this.bld?.invalidate();
    }

    /** W、H 是 CSS 像素（水珠纹理用这个分辨率），dpr 是画布的像素比。 */
    resize(W: number, H: number, dpr: number) {
        const { gl } = this;
        this.W = Math.max(1, Math.round(W)); this.H = Math.max(1, Math.round(H));
        this.canvas.width = Math.max(1, Math.round(W * dpr));
        this.canvas.height = Math.max(1, Math.round(H * dpr));
        this.mask.resize(W, H);
        this.fieldValid = false;
        for (const tex of [this.drop, this.field]) {
            gl.activeTexture(gl.TEXTURE0 + tex.unit);
            gl.bindTexture(gl.TEXTURE_2D, tex.t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.W, this.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            if (!tex.fb) tex.fb = gl.createFramebuffer()!;
            gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.t, 0);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.fogGl.resize(this.canvas.width, this.canvas.height);
        this.noise.resize(this.canvas.width, this.canvas.height);
        this.bld?.resize(this.canvas.width, this.canvas.height, Math.max(1, Math.ceil(this.canvas.height / FOG_DIV)));
    }

    // 水珠实例画进一张水珠纹理（CSS 分辨率）
    // inst 是 Float32Array（凝露的冷凝水珠，nebbiaCondensation.ts）时直接上传，不再拷一遍
    private renderDrops(tex: Tex, inst: number[] | Float32Array) {
        const { gl } = this;
        gl.bindFramebuffer(gl.FRAMEBUFFER, tex.fb!);
        gl.viewport(0, 0, this.W, this.H);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (inst.length && this.spriteReady) {
            let data: Float32Array;
            if (inst instanceof Float32Array) data = inst;
            else {
                if (this.instData.length < inst.length) this.instData = new Float32Array(Math.ceil(inst.length * 1.5));
                this.instData.set(inst);
                data = this.instData.subarray(0, inst.length);
            }
            gl.useProgram(this.build.programs.sprite);
            gl.bindVertexArray(this.spriteVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
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
        gl.uniform1i(L.uScenery, u.scenery);
        gl.uniform1f(L.uDewGlint, u.dewGlint);
        if (u.aqua) {
            gl.uniform4fv(L.uJelly, u.aqua.jelly); gl.uniform4fv(L.uJellyC, u.aqua.jellyColor);
            gl.uniform1i(L.uJellyN, u.aqua.count); gl.uniform1f(L.uBubbles, u.aqua.bubbles);
            gl.uniform4fv(L.uSway, u.aqua.sway); gl.uniform4fv(L.uBurst, u.aqua.bursts); gl.uniform1i(L.uBurstN, u.aqua.burstCount);
            gl.uniform1f(L.uBeatRows, u.aqua.beatRows);
        }
    }

    // 楼群缓存的取样状态（两个程序都设）
    private setBuildings(L: Locations, s: NebbiaBuildingState) {
        const { gl } = this;
        gl.uniform3i(L.uBldOn, s.on[0], s.on[1], s.on[2]);
        gl.uniform3fv(L.uBldGeo, s.geo);
    }

    /**
     * 画一帧（`ready` 为真之后才调）：擦痕遮罩，白气遮罩上传（这一帧有哈气、且画布重画过才传，`breath` 为 null 就不传），
     * 两张水珠纹理，补画楼群缓存，静态噪声纹理（改尺寸后算一次），雾的预渲染，主画面。
     */
    render(mask: NebbiaSegments, breath: { canvas: HTMLCanvasElement; version: number } | null, drops: number[], field: number[] | Float32Array, u: NebbiaUniforms, fieldChanged = true) {
        const { gl, U } = this;
        const { main, fog, bldFill, noise } = this.build.programs;
        this.mask.draw(mask);
        // 白气画布重画过才重传；尺寸没变时只覆盖内容，不重新分配纹理
        if (breath && breath.version !== this.breathVersion) {
            const { canvas: c } = breath;
            gl.activeTexture(gl.TEXTURE0 + this.breath.unit);
            gl.bindTexture(gl.TEXTURE_2D, this.breath.t);
            if (c.width === this.breathW && c.height === this.breathH) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, c);
            else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
            this.breathVersion = breath.version; this.breathW = c.width; this.breathH = c.height;
        }
        this.renderDrops(this.drop, drops);
        // 雾上水珠没变（凝露的冷凝水珠隔一阵才更新）时纹理留着上次的
        if (fieldChanged || !this.fieldValid) {
            this.renderDrops(this.field, field);
            this.fieldValid = this.spriteReady;
        }
        gl.bindVertexArray(this.quadVao);
        // 楼群关着时不补画缓存；再打开时缓存发现位置对不上，自己整张重画。水族箱没有楼群（没有补画程序）
        const buildings = u.scenery & SCN_BUILDINGS && !this.seeThrough && bldFill && this.bld ? this.bld.update(u.time * u.bus, bldFill, this.B) : NO_BUILDINGS;
        const noiseOn = this.noise.update(noise);
        if (fog && !this.seeThrough) {
            gl.useProgram(fog);
            this.setScene(this.F, u);
            this.setBuildings(this.F, buildings);
            this.fogGl.draw(this.uFogB);
        }
        gl.useProgram(main);
        this.setScene(U, u);
        this.setBuildings(U, buildings);
        gl.uniform1f(U.uMist, u.mist); gl.uniform1f(U.uEdge, u.edge);
        gl.uniform1f(U.uRefract, u.refract); gl.uniform1f(U.uGlint, u.glint);
        gl.uniform2fv(U.uGlassShift, u.glassShift);
        gl.uniform1i(U.uBreathOn, breath ? 1 : 0);
        gl.uniform1i(U.uNoiseOn, noiseOn ? 1 : 0);
        gl.uniform3fv(U.uMistTint, this.mistTint);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    /** 雪花图集（雪窗才有）。 */
    setFlakeAtlas(canvas: HTMLCanvasElement, rows: number) { this.snow?.setAtlas(canvas, rows); }

    /** render 之后叠上雪花：count 片，shift 是这一帧的玻璃颠簸（uniform 里的 glassShift）。 */
    drawFlakes(data: Float32Array, count: number, shift: [number, number]) {
        this.snow?.draw(data, count, this.W, this.H, [-shift[0] * this.W, -shift[1] * this.H]);
    }

    /** render 之后叠上凝露玻璃上的萤虫：count 只（nebbiaFireflies.ts 排好的实例）。 */
    drawFireflies(data: Float32Array, count: number) {
        this.fireflies?.draw(data, count, this.W, this.H);
    }

    destroy() {
        this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}
