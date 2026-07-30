import { describe, expect, it } from 'vitest';
import {
    buildSonnetIconDataUrl,
    buildSonnetIconTextureKey,
    resolveSonnetIconNames,
} from '@/components/visualizer/sonnet/sonnetIcons';

// test/unit/visualizer/sonnetIcons.test.ts
// Verifies theme icon validation and deterministic Pixi texture identities.
describe('Sonnet theme icons', () => {
    it('keeps valid unique Lucide names and ignores invalid values', () => {
        expect(resolveSonnetIconNames(['Moon', 'moon', 'heart', 'not-a-lucide-icon'])).toEqual(['Moon', 'Heart']);
    });

    it('builds theme-colored SVG data and complete cache keys', () => {
        const url = buildSonnetIconDataUrl('Sparkles', '#ff00aa', 1.5, 192);
        expect(url).toContain('data:image/svg+xml');
        expect(decodeURIComponent(url ?? '')).toContain('#ff00aa');
        expect(buildSonnetIconTextureKey('Sparkles', '#fff', 1.5, 192, 2)).toBe('Sparkles|#fff|1.5|192|2');
    });
});
