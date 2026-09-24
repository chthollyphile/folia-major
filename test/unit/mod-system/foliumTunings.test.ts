// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { tuningsRegistry, readFoliumTunings } from '@/mods/folium/registries/tunings';
import { useFoliumParamStore } from '@/mods/folium/paramStore';
import { getVisualizerRegistryEntry } from '@/components/visualizer/registry';
import { useFoliumStatusStore } from '@/mods/folium/status';

// test/unit/mod-system/foliumTunings.test.ts
// Tunings of builtin modes: only declared tunables, as numbers, inside the
// declared range; one owner per key; values reach the target merged.

afterEach(() => {
    ['mod-a', 'mod-b'].forEach((modId) => tuningsRegistry.unregisterAll(modId));
    useFoliumParamStore.setState({ byScope: {} });
    useFoliumStatusStore.setState({ issues: {} });
});

const knob = (key: string, extra: Record<string, unknown> = {}) => ({ key, type: 'number' as const, label: {}, ...extra });

describe('sonnet tunables', () => {
    it('declares the eleven K3Panel multipliers', () => {
        expect(Object.keys(getVisualizerRegistryEntry('sonnet').foliumTunables ?? {}).sort()).toEqual([
            'breathScale', 'caScale', 'cameraScale', 'driftScale', 'ghostScale', 'mgSwimScale', 'motionScale',
            'parallaxScale', 'transitionBlurScale', 'transitionGlitchScale', 'transitionMotionScale',
        ]);
    });
});

describe('tunings registry', () => {
    it('refuses targets without tunables and schemas with no usable key', () => {
        expect(() => tuningsRegistry.register('mod-a', { id: 't', target: 'classic', label: {}, params: [knob('x')] }))
            .toThrow('not a mode with Folium tunables');
        expect(() => tuningsRegistry.register('mod-a', { id: 't', target: 'sonnet', label: {}, params: [knob('notAKey')] }))
            .toThrow('no usable tunable keys');
        expect(useFoliumStatusStore.getState().issues['mod-a']?.[0].message).toContain('notAKey');
    });

    it('intersects ranges and clamps the default into them', () => {
        tuningsRegistry.register('mod-a', {
            id: 't', target: 'sonnet', label: {},
            params: [knob('cameraScale', { min: -5, max: 2, defaultValue: 9 })],
        });
        const [param] = tuningsRegistry.get('mod-a:t')!.def.params;
        expect([param.min, param.max, param.defaultValue]).toEqual([0, 2, 2]);
    });

    it('gives each key to the first owner and reports the conflict', () => {
        tuningsRegistry.register('mod-a', { id: 't', target: 'sonnet', label: {}, params: [knob('caScale')] });
        tuningsRegistry.register('mod-b', {
            id: 't', target: 'sonnet', label: {}, params: [knob('caScale'), knob('ghostScale')],
        });
        expect(tuningsRegistry.get('mod-b:t')!.def.params.map((param) => param.key)).toEqual(['ghostScale']);
        expect(useFoliumStatusStore.getState().issues['mod-b']?.[0].message).toContain('already tuned by mod-a:t');

        tuningsRegistry.unregisterAll('mod-a');
        tuningsRegistry.unregisterAll('mod-b');
        tuningsRegistry.register('mod-b', { id: 't', target: 'sonnet', label: {}, params: [knob('caScale')] });
        expect(tuningsRegistry.get('mod-b:t')!.def.params.map((param) => param.key)).toEqual(['caScale']);
    });

    it('merges values for the target, defaulting to the identity', () => {
        tuningsRegistry.register('mod-a', {
            id: 't', target: 'sonnet', label: {}, params: [knob('cameraScale'), knob('ghostScale')],
        });
        expect(readFoliumTunings('sonnet')).toEqual({ cameraScale: 1, ghostScale: 1 });
        tuningsRegistry.get('mod-a:t')!.def.access.set({ cameraScale: 2.5 });
        const merged = readFoliumTunings('sonnet');
        expect(merged).toEqual({ cameraScale: 2.5, ghostScale: 1 });
        expect(readFoliumTunings('sonnet')).toBe(merged);
        expect(readFoliumTunings('classic')).toEqual({});
    });
});
