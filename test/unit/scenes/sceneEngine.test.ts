import { describe, expect, it } from 'vitest';
import type { SceneManifest } from '../../../src/components/scenes/definition';
import { computeLyricPhase } from '../../../src/components/scenes/engine/lyricPhase';
import {
    planSceneLayers,
    resolveSceneOffered,
    sceneOffersBackground,
    sceneOffersLyricStyle,
} from '../../../src/components/scenes/engine/scenePlacement';
import { diffSceneSignals, type SceneSignalSnapshot } from '../../../src/components/scenes/engine/sceneSignals';
import { quadHomography, quadToMatrix3d } from '../../../src/components/scenes/engine/surfaceQuad';
import type { Line } from '../../../src/types';

// test/unit/scenes/sceneEngine.test.ts
// The host's own logic: lyric phases, where borrowed styles go, which choices the selector offers,
// the frame-to-frame events and the surface mapping.

const line = (startTime: number, endTime: number): Line => ({ words: [], startTime, endTime, fullText: `${startTime}` });
const LINES = [line(10, 14), line(15, 18), line(30, 33)];

describe('lyric phase', () => {
    it('names every stretch of a song', () => {
        expect(computeLyricPhase([], 3)).toEqual({ phase: 'instrumental', lineIndex: -1, nextLineIn: Infinity });
        expect(computeLyricPhase(LINES, 4)).toEqual({ phase: 'intro', lineIndex: -1, nextLineIn: 6 });
        expect(computeLyricPhase(LINES, 12)).toMatchObject({ phase: 'singing', lineIndex: 0, nextLineIn: 3 });
        expect(computeLyricPhase(LINES, 14.5)).toMatchObject({ phase: 'between-lines', lineIndex: 0 });
        expect(computeLyricPhase(LINES, 20)).toMatchObject({ phase: 'interlude', lineIndex: 1, nextLineIn: 10 });
        expect(computeLyricPhase(LINES, 31)).toMatchObject({ phase: 'singing', lineIndex: 2, nextLineIn: Infinity });
        expect(computeLyricPhase(LINES, 40)).toMatchObject({ phase: 'outro', lineIndex: 2 });
    });

    it('takes the interlude threshold it is given', () => {
        expect(computeLyricPhase(LINES, 20, 20).phase).toBe('between-lines');
    });
});

const manifest = (patch: Partial<SceneManifest>): SceneManifest => ({
    format: 1,
    engine: '^1.0',
    id: 'cinema',
    version: '1.0.0',
    name: { en: 'Cinema' },
    surfaces: [{ id: 'screen', aspect: 1.85 }],
    lyrics: { own: true, style: { surface: 'screen' } },
    background: { own: true, host: { surface: 'screen' } },
    quality: { default: 'low', presets: { low: {}, medium: {}, high: {} } },
    ...patch,
});

describe('scene placement', () => {
    it('uses the scene\'s own lyrics and screen until the user picks theirs', () => {
        const hall = manifest({});
        expect(planSceneLayers(hall, {})).toEqual({ surfaces: [], overlayLyrics: false, behindBackground: false });
        expect(planSceneLayers(hall, { lyrics: 'style' }).surfaces).toEqual([{ id: 'screen', lyrics: true, background: false }]);
        expect(planSceneLayers(hall, { lyrics: 'style', screen: 'background' }).surfaces).toEqual([{ id: 'screen', lyrics: true, background: true }]);
    });

    it('lays a lyric style over a scene without lyrics of its own, and a background behind', () => {
        const field = manifest({ lyrics: { own: false, style: 'overlay' }, background: { own: false, host: 'behind' } });
        expect(planSceneLayers(field, { lyrics: 'scene', screen: 'scene' })).toEqual({ surfaces: [], overlayLyrics: true, behindBackground: true });
        expect(planSceneLayers(manifest({ lyrics: { own: true, style: 'none' } }), { lyrics: 'style' }).surfaces).toEqual([]);
    });

    it('offers only the styles and backgrounds the scene takes', () => {
        const hall = manifest({ lyrics: { own: true, style: { surface: 'screen' }, exclude: ['still'] }, background: { own: true, host: 'none' } });
        expect(sceneOffersLyricStyle(null, 'still')).toBe(true);
        expect(sceneOffersLyricStyle(hall, 'still')).toBe(false);
        expect(sceneOffersLyricStyle(hall, 'classic')).toBe(true);
        expect(sceneOffersBackground(hall, 'latent')).toBe(false);
        expect(resolveSceneOffered(mode => sceneOffersLyricStyle(hall, mode), 'still', ['still', 'classic'])).toBe('classic');
        expect(resolveSceneOffered(mode => sceneOffersLyricStyle(hall, mode), 'classic', ['still', 'classic'])).toBe('classic');
    });
});

describe('scene events', () => {
    const at = (patch: Partial<SceneSignalSnapshot>): SceneSignalSnapshot => ({
        seed: 'a', blending: false, lineIndex: 0, phase: 'singing', paused: false, time: 10, ...patch,
    });

    it('tells nothing on the first frame or a quiet one', () => {
        expect(diffSceneSignals(null, at({}), 0)).toEqual([]);
        expect(diffSceneSignals(at({}), at({ time: 10.016 }), 0.016)).toEqual([]);
    });

    it('tells song, blend, play state, seek, line and phase changes', () => {
        expect(diffSceneSignals(at({}), at({ seed: 'b', time: 0, lineIndex: -1, phase: 'intro' }), 0.016)).toEqual(['songChange', 'lineChange', 'phaseChange']);
        expect(diffSceneSignals(at({}), at({ blending: true, time: 10.016 }), 0.016)).toEqual(['blendStart']);
        expect(diffSceneSignals(at({}), at({ paused: true, time: 10.016 }), 0.016)).toEqual(['pause']);
        expect(diffSceneSignals(at({ paused: true }), at({ time: 10 }), 0.5)).toEqual(['play']);
        expect(diffSceneSignals(at({}), at({ time: 60 }), 0.016)).toEqual(['seek']);
    });
});

describe('surface mapping', () => {
    it('lays the box corners on the quad', () => {
        const quad = [{ x: 100, y: 50 }, { x: 500, y: 80 }, { x: 480, y: 300 }, { x: 120, y: 260 }] as const;
        const h = quadHomography(800, 432, quad);
        const map = (x: number, y: number) => {
            const w = h[6] * x + h[7] * y + h[8];
            return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
        };
        const corners = [map(0, 0), map(800, 0), map(800, 432), map(0, 432)];
        corners.forEach(([x, y], index) => {
            expect(x).toBeCloseTo(quad[index].x, 6);
            expect(y).toBeCloseTo(quad[index].y, 6);
        });
        expect(quadToMatrix3d(800, 432, quad)).toMatch(/^matrix3d\((-?[\d.e-]+,){15}-?[\d.e-]+\)$/);
    });
});
