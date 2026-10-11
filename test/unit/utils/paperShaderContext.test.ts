import { describe, expect, it } from 'vitest';
import { PAPER_SHADER_CONTEXT_ATTRIBUTES } from '@/utils/paperShaderContext';

// test/unit/utils/paperShaderContext.test.ts
// The latent background's paper shaders draw one quad with no depth test; MSAA and depth only cost memory.

describe('PAPER_SHADER_CONTEXT_ATTRIBUTES', () => {
    it('asks for a context without MSAA or depth', () => {
        expect(PAPER_SHADER_CONTEXT_ATTRIBUTES).toEqual({ antialias: false, depth: false });
    });
});
