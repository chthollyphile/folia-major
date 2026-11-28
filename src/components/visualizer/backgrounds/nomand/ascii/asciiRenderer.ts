import { ASCII_CELL_H, ASCII_CELL_W, getAsciiGlyphAtlas } from './asciiGlyphAtlas';
import type { AsciiImageMaps } from './asciiImageMaps';
import { ASCII_CELL_FS, ASCII_GLYPH_FS, ASCII_QUAD_VS } from './asciiShaders';

// src/components/visualizer/backgrounds/nomand/ascii/asciiRenderer.ts
// The WebGL2 side of the Nomand ASCII effect: the picture, its maps and the glyph strip as
// textures, a cell target one texel per 5×7 cell, and the two passes drawn into the canvas.
// Everything is drawn at one canvas pixel per glyph pixel; the layer scales the canvas up
// without smoothing.

export interface AsciiPalette {
    back: [number, number, number];
    front: [number, number, number];
    highlight: [number, number, number];
}

export interface AsciiFrameParams {
    /** Loop phase, 0..1. */
    t: number;
    /** Sway amount; 0 is still. */
    motion: number;
    themeColors: boolean;
    invert: boolean;
    palette: AsciiPalette;
}

export interface AsciiRenderer {
    /** Sets the picture and its maps; the picture must be loaded and not tainted. */
    setImage: (image: TexImageSource & { width: number; height: number }, maps: AsciiImageMaps) => void;
    hasImage: () => boolean;
    /** Sets the drawing buffer size, in glyph pixels. */
    resize: (width: number, height: number) => void;
    draw: (params: AsciiFrameParams) => void;
    dispose: () => void;
}

/** Light direction the relighting assumes the picture already has (upper left, as in living-ascii). */
const PICTURE_LIGHT = (130 * Math.PI) / 180;

const compile = (gl: WebGL2RenderingContext, type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('createShader failed');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`ascii shader: ${log ?? 'compile failed'}`);
    }
    return shader;
};

const link = (gl: WebGL2RenderingContext, fragment: string) => {
    const program = gl.createProgram();
    const vs = compile(gl, gl.VERTEX_SHADER, ASCII_QUAD_VS);
    const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`ascii program: ${log ?? 'link failed'}`);
    }
    return program;
};

const makeTexture = (gl: WebGL2RenderingContext, filter: number) => {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
};

/** Creates the renderer on a canvas; null where WebGL2 is not available. */
export const createAsciiRenderer = (canvas: HTMLCanvasElement): AsciiRenderer | null => {
    const gl = canvas.getContext('webgl2', {
        antialias: false,
        depth: false,
        stencil: false,
        alpha: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
    });
    if (!gl) return null;

    const cellProgram = link(gl, ASCII_CELL_FS);
    const glyphProgram = link(gl, ASCII_GLYPH_FS);
    const vao = gl.createVertexArray();
    const locate = (program: WebGLProgram, names: string[]) => Object.fromEntries(
        names.map(name => [name, gl.getUniformLocation(program, name)]),
    ) as Record<string, WebGLUniformLocation | null>;
    const cellU = locate(cellProgram, ['tImg', 'tMap', 'uRes', 'uCoverScale', 'uWind', 'uT', 'uMotion', 'uLight', 'uImgLod']);
    const glyphU = locate(glyphProgram, ['tCells', 'tAtlas', 'uRes', 'uCover', 'uThemeColors', 'uInvert', 'uBack', 'uFront', 'uHighlight']);

    const imageTex = makeTexture(gl, gl.LINEAR_MIPMAP_LINEAR);
    const mapTex = makeTexture(gl, gl.LINEAR);
    const cellTex = makeTexture(gl, gl.NEAREST);
    const atlasTex = makeTexture(gl, gl.NEAREST);
    const atlas = getAsciiGlyphAtlas();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, atlas.width, atlas.height, 0, gl.RED, gl.UNSIGNED_BYTE, atlas.data);
    const cellFbo = gl.createFramebuffer();

    let width = 1;
    let height = 1;
    let cols = 1;
    let rows = 1;
    let image: { width: number; height: number } | null = null;
    let wind: [number, number] = [1, 0];

    const resize = (nextWidth: number, nextHeight: number) => {
        width = Math.max(1, Math.round(nextWidth));
        height = Math.max(1, Math.round(nextHeight));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
        cols = Math.ceil(width / ASCII_CELL_W);
        rows = Math.ceil(height / ASCII_CELL_H);
        gl.bindTexture(gl.TEXTURE_2D, cellTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, cellFbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cellTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    };

    const setImage: AsciiRenderer['setImage'] = (source, maps) => {
        gl.bindTexture(gl.TEXTURE_2D, imageTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.generateMipmap(gl.TEXTURE_2D);
        // The maps are already stored bottom-up.
        gl.bindTexture(gl.TEXTURE_2D, mapTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, maps.width, maps.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, maps.data);
        image = { width: source.width, height: source.height };
        wind = [Math.cos(maps.dominant), Math.sin(maps.dominant)];
    };

    const draw = (params: AsciiFrameParams) => {
        if (!image || gl.isContextLost()) return;
        // Cover fit: the part of the picture the canvas shows, as a scale around its centre.
        const viewAspect = width / height;
        const imageAspect = image.width / Math.max(1, image.height);
        const scaleX = viewAspect > imageAspect ? 1 : viewAspect / imageAspect;
        const scaleY = viewAspect > imageAspect ? imageAspect / viewAspect : 1;
        // Picture pixels per glyph pixel, so the 35 samples a cell takes come from the right mip.
        const lod = Math.max(0, Math.log2((image.width * scaleX) / width));

        gl.bindVertexArray(vao);
        gl.disable(gl.BLEND);

        gl.bindFramebuffer(gl.FRAMEBUFFER, cellFbo);
        gl.viewport(0, 0, cols, rows);
        gl.useProgram(cellProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, imageTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, mapTex);
        gl.uniform1i(cellU.tImg, 0);
        gl.uniform1i(cellU.tMap, 1);
        gl.uniform2f(cellU.uRes, width, height);
        gl.uniform2f(cellU.uCoverScale, scaleX, scaleY);
        gl.uniform2f(cellU.uWind, wind[0], wind[1]);
        gl.uniform1f(cellU.uT, params.t);
        gl.uniform1f(cellU.uMotion, params.motion);
        gl.uniform1f(cellU.uLight, PICTURE_LIGHT);
        gl.uniform1f(cellU.uImgLod, lod);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, width, height);
        gl.useProgram(glyphProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, cellTex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, atlasTex);
        gl.uniform1i(glyphU.tCells, 0);
        gl.uniform1i(glyphU.tAtlas, 1);
        gl.uniform2f(glyphU.uRes, width, height);
        gl.uniform1fv(glyphU.uCover, atlas.covers);
        gl.uniform1i(glyphU.uThemeColors, params.themeColors ? 1 : 0);
        gl.uniform1i(glyphU.uInvert, params.invert ? 1 : 0);
        gl.uniform3fv(glyphU.uBack, params.palette.back);
        gl.uniform3fv(glyphU.uFront, params.palette.front);
        gl.uniform3fv(glyphU.uHighlight, params.palette.highlight);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    };

    const dispose = () => {
        gl.deleteTexture(imageTex);
        gl.deleteTexture(mapTex);
        gl.deleteTexture(cellTex);
        gl.deleteTexture(atlasTex);
        gl.deleteFramebuffer(cellFbo);
        gl.deleteProgram(cellProgram);
        gl.deleteProgram(glyphProgram);
        gl.deleteVertexArray(vao);
        // Gives the drawing buffer back now rather than whenever the canvas is collected.
        gl.getExtension('WEBGL_lose_context')?.loseContext();
    };

    resize(canvas.width, canvas.height);
    return { setImage, hasImage: () => image !== null, resize, draw, dispose };
};
