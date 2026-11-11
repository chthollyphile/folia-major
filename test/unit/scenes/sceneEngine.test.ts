import { describe, expect, it, vi } from 'vitest';
import type { SceneManifest } from '../../../src/components/scenes/definition';
import { createSceneEventBus } from '../../../src/components/scenes/engine/sceneEvents';
import { computeLyricPhase } from '../../../src/components/scenes/engine/lyricPhase';
import {
    planSceneLayers,
    resolveSceneOffered,
    sceneOffersBackground,
    sceneOffersLyricStyle,
} from '../../../src/components/scenes/engine/scenePlacement';
import { diffSceneSignals, type SceneSignalSnapshot } from '../../../src/components/scenes/engine/sceneSignals';
import { quadHomography, quadToMatrix3d } from '../../../src/components/scenes/engine/surfaceQuad';
import * as THREE from 'three';
import { chooseDirectorShot, viewpointRig } from '../../../src/components/scenes/kit/camera';
import type { SceneAnchor, SceneContext } from '../../../src/components/scenes/definition';
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
    lyrics: { style: { surface: 'screen' } },
    background: { host: { surface: 'screen' } },
    quality: { default: 'low', presets: { low: {}, medium: {}, high: {} } },
    ...patch,
});

describe('scene placement', () => {
    it('puts the user\'s lyric style and background on the surface the scene names', () => {
        expect(planSceneLayers(manifest({}))).toEqual({ surfaces: [{ id: 'screen', lyrics: true, background: true }], overlayLyrics: false, behindBackground: false });
    });

    it('lays a lyric style over the scene and a background behind it, or leaves them out', () => {
        const field = manifest({ lyrics: { style: 'overlay' }, background: { host: 'behind' } });
        expect(planSceneLayers(field)).toEqual({ surfaces: [], overlayLyrics: true, behindBackground: true });
        expect(planSceneLayers(manifest({ lyrics: { style: 'none' }, background: { host: 'none' } }))).toEqual({ surfaces: [], overlayLyrics: false, behindBackground: false });
    });

    it('shows a style the scene cannot take as the first it can', () => {
        const hall = manifest({ lyrics: { style: { surface: 'screen' }, exclude: ['still'] }, background: { host: 'none' } });
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

    it('keeps a surface partly behind the camera, the corner behind with its w still negative', () => {
        // Homogeneous corners of a parallelogram: the right edge is behind the camera (w < 0).
        const quad = [{ x: 100, y: 50, w: 1 }, { x: -300, y: -20, w: -0.5 }, { x: -260, y: 90, w: -0.5 }, { x: 140, y: 160, w: 1 }] as const;
        const h = quadHomography(800, 432, quad);
        const map = (x: number, y: number) => [h[0] * x + h[1] * y + h[2], h[3] * x + h[4] * y + h[5], h[6] * x + h[7] * y + h[8]];
        [[0, 0], [800, 0], [800, 432], [0, 432]].forEach(([x, y], index) => {
            const [X, Y, W] = map(x, y);
            const { x: qx, y: qy, w: qw } = quad[index];
            // Same point up to a positive scale: the sign of w (which side of the camera) is kept.
            expect(Math.sign(W)).toBe(Math.sign(qw));
            expect(X / W).toBeCloseTo(qx / qw, 6);
            expect(Y / W).toBeCloseTo(qy / qw, 6);
        });
    });
});

describe('phase director', () => {
    it('tours only when the next line is far, and is back in the seat before it', () => {
        expect(chooseDirectorShot('seat', 'interlude', 12)).toBe('tour');
        expect(chooseDirectorShot('seat', 'between-lines', 4)).toBe('seat');
        expect(chooseDirectorShot('tour', 'interlude', 5)).toBe('tour');
        expect(chooseDirectorShot('tour', 'interlude', 2)).toBe('seat');
        expect(chooseDirectorShot('tour', 'singing', 20)).toBe('seat');
        expect(chooseDirectorShot('seat', 'outro', Infinity)).toBe('tour');
        expect(chooseDirectorShot('seat', 'intro', 30)).toBe('seat');
        expect(chooseDirectorShot('tour', 'intro', 30)).toBe('seat');
        expect(chooseDirectorShot('seat', 'instrumental', Infinity)).toBe('seat');
    });
});

describe('seat rig', () => {
    const seat = (id: string, x: number, extra: Partial<Extract<SceneAnchor, { kind: 'viewpoint' }>> = {}): Extract<SceneAnchor, { kind: 'viewpoint' }> => (
        { kind: 'viewpoint', id, ear: [x, 1, 0], eye: [x, 1.2, 0], lookAt: [x, 1.2, -10], ...extra }
    );
    const sitIn = (chosen: string | null) => {
        const seats = [seat('A1', 0), seat('A2', 1, { occupied: true }), seat('A3', 2, { preferred: true })];
        const ctx = {
            anchors: { list: () => seats },
            viewpoints: { chosen: () => chosen },
        } as unknown as SceneContext;
        const camera = new THREE.PerspectiveCamera();
        viewpointRig(ctx).update(camera, 0);
        return camera.position.x;
    };

    it('sits in the chosen seat, and in the preferred one when the chosen seat is taken', () => {
        expect(sitIn('A1')).toBe(0);
        expect(sitIn('A2')).toBe(2);
        expect(sitIn(null)).toBe(2);
    });
});

describe('scene event bus', () => {
    it('fails the scene on a throwing listener and calls none of its listeners after', () => {
        const bus = createSceneEventBus(() => bus.dispose());
        const later = vi.fn();
        bus.on('pause', () => { throw new Error('boom'); });
        bus.on('pause', later);
        bus.emit('pause', {});
        bus.emit('play', {});
        expect(later).not.toHaveBeenCalled();
    });

    it('releases the subscriptions it tracks on dispose, once, and catches their throws into fail', () => {
        const fail = vi.fn();
        const bus = createSceneEventBus(fail);
        const release = vi.fn();
        const releaseByScene = bus.track(release);
        bus.guard(() => { throw new Error('in onChange'); })();
        expect(fail).toHaveBeenCalledTimes(1);
        bus.dispose();
        releaseByScene();
        expect(release).toHaveBeenCalledTimes(1);
        const afterwards = vi.fn();
        bus.guard(afterwards)();
        expect(afterwards).not.toHaveBeenCalled();
    });
});
