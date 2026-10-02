import * as twgl from 'twgl.js';
import { TIDE_VERTEX_SHADER } from './tideShaders';
import { resolveTideUniforms } from './tideUniforms';

// src/components/visualizer/backgrounds/tide/tideGl.ts
// Thin twgl wrappers shared by the tide runtime: one program per fragment shader, a fullscreen
// triangle, float render targets for the solver and one draw helper. Kept apart from the runtime so
// the render loop file only talks about passes.

export type TideTarget = twgl.FramebufferInfo;

/** twgl render targets expose their colour attachment through attachments[0], never through .texture. */
export const tideTargetTexture = (target: TideTarget): WebGLTexture => target.attachments[0];

export interface TideTargetOptions {
    /** Solver fields need signed values; the slat field is fine with 8 bits. */
    halfFloat?: boolean;
    minMag?: number;
}

/** Returns null when the shader fails to compile or link: the caller degrades instead of drawing. */
export const createTideProgram = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    fragmentShader: string,
    vertexShader: string = TIDE_VERTEX_SHADER,
): twgl.ProgramInfo | null => twgl.createProgramInfo(
    gl,
    [vertexShader, fragmentShader],
    error => console.error('TideBackground twgl program error:', error),
) ?? null;

export const createTideFullscreenBuffer = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
): twgl.BufferInfo => twgl.createBufferInfoFromArrays(gl, {
    a_position: { numComponents: 2, data: [-1, -1, 3, -1, -1, 3] },
});

export const createTideTarget = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    width: number,
    height: number,
    options: TideTargetOptions = {},
): TideTarget => {
    const halfFloat = options.halfFloat !== false;
    const gl2 = gl as WebGL2RenderingContext;
    const attachment = halfFloat
        ? {
            internalFormat: gl2.RGBA16F,
            format: gl.RGBA,
            type: gl2.HALF_FLOAT,
            minMag: options.minMag ?? gl.LINEAR,
        }
        : {
            internalFormat: gl.RGBA,
            format: gl.RGBA,
            type: gl.UNSIGNED_BYTE,
            minMag: options.minMag ?? gl.NEAREST,
        };

    return twgl.createFramebufferInfo(
        gl,
        [attachment],
        Math.max(2, Math.floor(width)),
        Math.max(2, Math.floor(height)),
    );
};

export const drawTidePass = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    programInfo: twgl.ProgramInfo,
    bufferInfo: twgl.BufferInfo,
    target: TideTarget | null,
    uniforms: Record<string, unknown>,
): void => {
    gl.useProgram(programInfo.program);
    twgl.setBuffersAndAttributes(gl, programInfo, bufferInfo);
    twgl.setUniforms(programInfo, resolveTideUniforms(uniforms));
    // bindFramebufferInfo binds and sets the viewport from the target (or the canvas for null).
    twgl.bindFramebufferInfo(gl, target);
    twgl.drawBufferInfo(gl, bufferInfo);
};

export const deleteTideTarget = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    target: TideTarget | null,
): void => {
    if (!target) {
        return;
    }

    gl.deleteFramebuffer(target.framebuffer);
    target.attachments.forEach(attachment => gl.deleteTexture(attachment));
};
