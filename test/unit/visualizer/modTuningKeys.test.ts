// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// Some tunings' merges read a store, and stores read localStorage at import time; see foliumVisualizer.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
            key: (index: number) => Array.from(items.keys())[index] ?? null,
            get length() { return items.size; },
        },
    });
});

import type { VisualizerModTuningKey, VisualizerTuningAdapter } from '@/components/visualizer/tuningDefinition';
import { getVisualizerTuning, getVisualizerTuningModes } from '@/components/visualizer/tuningRegistry';

// test/unit/visualizer/modTuningKeys.test.ts
// The tuning keys each style declares for mods (`modKeys`, Folium 1.8 folium.visualizer.setTuning) against the
// style's own tuning: every key is a field of the defaults of the declared kind, the default fits the
// declaration, and the style's `merge` keeps every value the declaration lets through (each end of a range,
// each choice, each switch), so the host's checks are never wider than the merge's clamps and a mod is never
// told a value was kept that the style threw away.

vi.setConfig({ testTimeout: 30_000 });

type Fields = Record<string, unknown>;

/** The two ends of an ordered pair are kept in order by the merge (partita): an end is tried with the other end at the same value. */
const ORDERED_PAIRS: Record<string, Record<string, string>> = {
    partita: { staggerMin: 'staggerMax', staggerMax: 'staggerMin' },
};

const declaredStyles = () => getVisualizerTuningModes()
    .map((mode) => [mode, getVisualizerTuning(mode)!] as const)
    .filter(([, adapter]) => adapter.modKeys && Object.keys(adapter.modKeys).length > 0);

/* What the merge keeps of `value` at `key`, laid onto the defaults. */
const merged = (mode: string, adapter: VisualizerTuningAdapter, key: string, value: unknown): unknown => {
    const pair = ORDERED_PAIRS[mode]?.[key];
    const patch = pair ? { [key]: value, [pair]: value } : { [key]: value };
    return (adapter.storage!.merge(adapter.defaults, patch) as Fields)[key];
};

describe('mod tuning keys', () => {
    it('are declared by the styles that have options of their own', () => {
        const modes = declaredStyles().map(([mode]) => mode).sort();
        expect(modes).toEqual(['cappella', 'claddagh', 'classic', 'diorama', 'fume', 'hanabi', 'lumiere', 'machi', 'monet', 'nebbia', 'partita', 'pendolo', 'sonnet', 'tempera', 'tilt']);
    });

    // The names, kinds and ranges are public API (mods address them by name): a change here is a Folium change.
    it('are pinned, so a renamed or dropped key is a visible change', () => {
        expect(Object.fromEntries(declaredStyles().map(([mode, adapter]) => [mode, adapter.modKeys]))).toMatchSnapshot();
    });

    it('never offer the picture-cost settings, which are the user\'s', () => {
        for (const [mode, adapter] of declaredStyles()) {
            for (const key of ['render', 'textureResolution', 'renderQuality', 'quality', 'fogOctaves', 'postProcessTextureCompression']) {
                expect(Object.keys(adapter.modKeys!), `${mode}.${key}`).not.toContain(key);
            }
        }
    });

    for (const [mode, adapter] of declaredStyles()) {
        describe(mode, () => {
            const defaults = adapter.defaults as Fields;
            const keys = Object.entries(adapter.modKeys as Record<string, VisualizerModTuningKey>);

            it('declares only fields of its defaults, each of the kind its default is', () => {
                expect(adapter.storage, 'a stored tuning').toBeDefined();
                for (const [key, declared] of keys) {
                    const value = defaults[key];
                    if (declared.type === 'number') {
                        expect(typeof value, key).toBe('number');
                        expect(declared.min, key).toBeLessThan(declared.max);
                        expect(value as number, key).toBeGreaterThanOrEqual(declared.min);
                        expect(value as number, key).toBeLessThanOrEqual(declared.max);
                        if (declared.step !== undefined) {
                            const steps = ((value as number) - declared.min) / declared.step;
                            expect(Math.abs(steps - Math.round(steps)), `${key} lands on a step`).toBeLessThan(1e-9);
                            const span = (declared.max - declared.min) / declared.step;
                            expect(Math.abs(span - Math.round(span)), `${key} max lands on a step`).toBeLessThan(1e-9);
                        }
                    } else if (declared.type === 'boolean') {
                        expect(typeof value, key).toBe('boolean');
                    } else {
                        expect(declared.options.length, key).toBeGreaterThan(1);
                        expect(declared.options, key).toContain(value);
                    }
                }
            });

            it('keeps through its merge every value the declaration lets through', () => {
                for (const [key, declared] of keys) {
                    if (declared.type === 'number') {
                        expect(merged(mode, adapter, key, declared.min), `${key} min`).toBe(declared.min);
                        expect(merged(mode, adapter, key, declared.max), `${key} max`).toBe(declared.max);
                    } else if (declared.type === 'boolean') {
                        expect(merged(mode, adapter, key, true), `${key} on`).toBe(true);
                        expect(merged(mode, adapter, key, false), `${key} off`).toBe(false);
                    } else {
                        for (const option of declared.options) {
                            expect(merged(mode, adapter, key, option), `${key} ${option}`).toBe(option);
                        }
                    }
                }
            });
        });
    }
});
