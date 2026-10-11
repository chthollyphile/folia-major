import { describe, expect, it, vi } from 'vitest';
import type { PaperShaderElement } from '@paper-design/shaders';
import { createPaperShaderReleaseRef, PAPER_SHADER_CONTEXT_ATTRIBUTES } from '@/utils/paperShaderContext';

// test/unit/utils/paperShaderContext.test.ts
// The latent background's paper shaders must give their WebGL context back when they unmount,
// but only once the canvas has left the document (a StrictMode simulated detach keeps it).

const fakeShaderElement = (isConnected: boolean) => {
    const loseContext = vi.fn();
    const gl = { isContextLost: () => false, getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null) };
    const canvas = { isConnected, getContext: vi.fn(() => gl) };
    const element = { paperShaderMount: { canvasElement: canvas } } as unknown as PaperShaderElement;
    return { element, canvas, loseContext };
};

const flushMicrotasks = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('createPaperShaderReleaseRef', () => {
    it('tracks the element and loses the context once the canvas has left the document', async () => {
        const target: { current: PaperShaderElement | null } = { current: null };
        const { element, canvas, loseContext } = fakeShaderElement(false);
        const cleanup = createPaperShaderReleaseRef(target)(element);
        expect(target.current).toBe(element);
        cleanup?.();
        expect(target.current).toBeNull();
        expect(canvas.getContext).toHaveBeenCalledWith('webgl2');
        await flushMicrotasks();
        expect(loseContext).toHaveBeenCalledTimes(1);
    });

    it('keeps the context while the canvas is still in the document', async () => {
        const { element, loseContext } = fakeShaderElement(true);
        createPaperShaderReleaseRef({ current: null })(element)?.();
        await flushMicrotasks();
        expect(loseContext).not.toHaveBeenCalled();
    });

    it('does nothing when the shader mount was never created', async () => {
        const element = {} as PaperShaderElement;
        expect(() => createPaperShaderReleaseRef({ current: null })(element)?.()).not.toThrow();
        await flushMicrotasks();
    });

    it('asks for a context without MSAA or depth', () => {
        expect(PAPER_SHADER_CONTEXT_ATTRIBUTES).toEqual({ antialias: false, depth: false });
    });
});
