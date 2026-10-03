import type * as twgl from 'twgl.js';
import {
    createTideFullscreenBuffer,
    createTideProgram,
    createTideTarget,
    deleteTideTarget,
    type TideTarget,
} from './tideGl';
import {
    TIDE_ADVECT_FRAGMENT_SHADER,
    TIDE_CURL_FRAGMENT_SHADER,
    TIDE_DIVERGENCE_FRAGMENT_SHADER,
    TIDE_FLUID_VERTEX_SHADER,
    TIDE_PRESSURE_FRAGMENT_SHADER,
    TIDE_PROJECT_FRAGMENT_SHADER,
    TIDE_SCALE_FRAGMENT_SHADER,
    TIDE_SPLAT_FRAGMENT_SHADER,
    TIDE_VORTICITY_FRAGMENT_SHADER,
} from './tideShaders';
import { TIDE_SURFACE_FRAGMENT_SHADER } from './tideSurfaceShader';

// src/components/visualizer/backgrounds/tide/tideResources.ts
// Owns every GL object the water needs: nine programs, one fullscreen buffer and the half-float
// solver fields. Returns null when a program fails to link, so the runtime can drop the canvas
// instead of leaving an opaque, empty one behind.

export interface TidePrograms {
    splat: twgl.ProgramInfo;
    curl: twgl.ProgramInfo;
    vorticity: twgl.ProgramInfo;
    divergence: twgl.ProgramInfo;
    pressure: twgl.ProgramInfo;
    project: twgl.ProgramInfo;
    advect: twgl.ProgramInfo;
    scale: twgl.ProgramInfo;
    surface: twgl.ProgramInfo;
}

export interface TidePair {
    read: TideTarget;
    write: TideTarget;
}

export interface TideResources {
    programs: TidePrograms;
    buffer: twgl.BufferInfo;
    velocity: TidePair;
    ink: TidePair;
    pressure: TidePair;
    divergence: TideTarget;
    curl: TideTarget;
    fluidWidth: number;
    fluidHeight: number;
    /** 1 / fluid size: the fluid vertex shader turns it into the four neighbour uvs. */
    texel: [number, number];
}

export const swapTidePair = (pair: TidePair): void => {
    const previousRead = pair.read;
    pair.read = pair.write;
    pair.write = previousRead;
};

export const clearTideFluid = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    resources: Pick<TideResources, 'velocity' | 'ink' | 'pressure' | 'divergence' | 'curl'>,
): void => {
    const targets = [
        resources.velocity.read,
        resources.velocity.write,
        resources.ink.read,
        resources.ink.write,
        resources.pressure.read,
        resources.pressure.write,
        resources.divergence,
        resources.curl,
    ];

    gl.clearColor(0, 0, 0, 1);
    targets.forEach(target => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
        gl.viewport(0, 0, target.width, target.height);
        gl.clear(gl.COLOR_BUFFER_BIT);
    });
};

const createPair = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    width: number,
    height: number,
): TidePair => ({
    read: createTideTarget(gl, width, height),
    write: createTideTarget(gl, width, height),
});

export const createTideResources = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    fluidWidth: number,
    fluidHeight: number,
): TideResources | null => {
    const splat = createTideProgram(gl, TIDE_SPLAT_FRAGMENT_SHADER, TIDE_FLUID_VERTEX_SHADER);
    const curl = createTideProgram(gl, TIDE_CURL_FRAGMENT_SHADER, TIDE_FLUID_VERTEX_SHADER);
    const vorticity = createTideProgram(gl, TIDE_VORTICITY_FRAGMENT_SHADER, TIDE_FLUID_VERTEX_SHADER);
    const divergence = createTideProgram(gl, TIDE_DIVERGENCE_FRAGMENT_SHADER, TIDE_FLUID_VERTEX_SHADER);
    const pressure = createTideProgram(gl, TIDE_PRESSURE_FRAGMENT_SHADER, TIDE_FLUID_VERTEX_SHADER);
    const project = createTideProgram(gl, TIDE_PROJECT_FRAGMENT_SHADER, TIDE_FLUID_VERTEX_SHADER);
    const advect = createTideProgram(gl, TIDE_ADVECT_FRAGMENT_SHADER, TIDE_FLUID_VERTEX_SHADER);
    const scale = createTideProgram(gl, TIDE_SCALE_FRAGMENT_SHADER, TIDE_FLUID_VERTEX_SHADER);
    const surface = createTideProgram(gl, TIDE_SURFACE_FRAGMENT_SHADER);
    const created = [splat, curl, vorticity, divergence, pressure, project, advect, scale, surface];
    if (created.some(program => program === null)) {
        created.forEach(program => {
            if (program) {
                gl.deleteProgram(program.program);
            }
        });
        return null;
    }

    if (!splat || !curl || !vorticity || !divergence || !pressure || !project || !advect || !scale || !surface) {
        return null;
    }

    const resources: TideResources = {
        programs: { splat, curl, vorticity, divergence, pressure, project, advect, scale, surface },
        buffer: createTideFullscreenBuffer(gl),
        velocity: createPair(gl, fluidWidth, fluidHeight),
        ink: createPair(gl, fluidWidth, fluidHeight),
        pressure: createPair(gl, fluidWidth, fluidHeight),
        divergence: createTideTarget(gl, fluidWidth, fluidHeight),
        curl: createTideTarget(gl, fluidWidth, fluidHeight),
        fluidWidth,
        fluidHeight,
        texel: [1 / fluidWidth, 1 / fluidHeight],
    };

    clearTideFluid(gl, resources);

    return resources;
};

/** Rebuilds the solver fields for a new size. The old targets stay usable when nothing changed. */
export const resizeTideResources = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    resources: TideResources,
    fluidWidth: number,
    fluidHeight: number,
): boolean => {
    if (resources.fluidWidth === fluidWidth && resources.fluidHeight === fluidHeight) {
        return false;
    }

    [resources.velocity, resources.ink, resources.pressure].forEach(pair => {
        deleteTideTarget(gl, pair.read);
        deleteTideTarget(gl, pair.write);
    });
    deleteTideTarget(gl, resources.divergence);
    deleteTideTarget(gl, resources.curl);

    resources.velocity = createPair(gl, fluidWidth, fluidHeight);
    resources.ink = createPair(gl, fluidWidth, fluidHeight);
    resources.pressure = createPair(gl, fluidWidth, fluidHeight);
    resources.divergence = createTideTarget(gl, fluidWidth, fluidHeight);
    resources.curl = createTideTarget(gl, fluidWidth, fluidHeight);
    resources.fluidWidth = fluidWidth;
    resources.fluidHeight = fluidHeight;
    resources.texel = [1 / fluidWidth, 1 / fluidHeight];
    clearTideFluid(gl, resources);

    return true;
};

export const disposeTideResources = (
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    resources: TideResources,
): void => {
    Object.values(resources.programs).forEach(program => gl.deleteProgram(program.program));
    const positionBuffer = resources.buffer.attribs?.a_position?.buffer;
    if (positionBuffer) {
        gl.deleteBuffer(positionBuffer);
    }
    [resources.velocity, resources.ink, resources.pressure].forEach(pair => {
        deleteTideTarget(gl, pair.read);
        deleteTideTarget(gl, pair.write);
    });
    deleteTideTarget(gl, resources.divergence);
    deleteTideTarget(gl, resources.curl);
};
