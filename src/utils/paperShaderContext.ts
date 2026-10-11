import type { PaperShaderElement } from '@paper-design/shaders';

// src/utils/paperShaderContext.ts
// Context options and teardown for full-screen paper-shaders backgrounds.

/**
 * The paper shaders draw one full-screen quad with no depth test, so WebGL's default 4x MSAA
 * and depth buffer only cost memory (about 72 MB for the two latent layers at 1280x720) and a
 * resolve per frame. readPixels output with and without them is identical, channel for channel.
 * paper-shaders reads this once, when the context is created.
 */
export const PAPER_SHADER_CONTEXT_ATTRIBUTES: WebGLContextAttributes = Object.freeze({
    antialias: false,
    depth: false,
});

/**
 * A ref for a paper shader's host element that gives the WebGL context back once the shader
 * unmounts. paper-shaders' dispose() deletes its program and removes the canvas, but never
 * loses the context, so the drawing buffers stay alive until the canvas happens to be
 * garbage-collected; switching visualizer modes a few times piled up hundreds of MB that way.
 *
 * The ref is detached before paper's own effect cleanup disposes the mount, so the context is
 * still reachable here. It is only lost after the canvas has actually left the document, which
 * a StrictMode simulated detach never does; WebGL calls on a lost context, including dispose()'s
 * deletes, are no-ops.
 */
export const createPaperShaderReleaseRef = (target: { current: PaperShaderElement | null }) => (
    (element: PaperShaderElement | null) => {
        target.current = element;
        if (!element) return undefined;
        return () => {
            target.current = null;
            const canvas = element.paperShaderMount?.canvasElement;
            if (!canvas) return;
            const gl = canvas.getContext('webgl2');
            queueMicrotask(() => {
                if (!gl || canvas.isConnected || gl.isContextLost()) return;
                gl.getExtension('WEBGL_lose_context')?.loseContext();
            });
        };
    }
);
