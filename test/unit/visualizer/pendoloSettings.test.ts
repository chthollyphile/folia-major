import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PENDOLO_TUNING } from '@/types';
import { useVisualizerSettingsStore } from '@/stores/useVisualizerSettingsStore';
import pendoloTuning from '@/components/visualizer/pendolo/tuning';

// test/unit/visualizer/pendoloSettings.test.ts
// Verifies the Pendolo glow preference survives the settings store and local persistence boundary.
const createLocalStorageMock = (): Storage => {
    const values = new Map<string, string>();

    return {
        get length() {
            return values.size;
        },
        getItem: (key) => values.get(key) ?? null,
        key: (index) => Array.from(values.keys())[index] ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
        clear: () => values.clear(),
    };
};

describe('Pendolo settings', () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createLocalStorageMock();
        vi.stubGlobal('localStorage', storage);
        vi.stubGlobal('window', { localStorage: storage });
        useVisualizerSettingsStore.setState({ pendoloTuning: { ...DEFAULT_PENDOLO_TUNING } });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('updates and persists the line glow preference', () => {
        useVisualizerSettingsStore.getState().handleSetPendoloTuning({ enableLineGlow: true });

        expect(useVisualizerSettingsStore.getState().pendoloTuning.enableLineGlow).toBe(true);
        expect(JSON.parse(storage.getItem('pendolo_tuning') ?? '{}').enableLineGlow).toBe(true);

        useVisualizerSettingsStore.getState().handleSetPendoloTuning({ enableLineGlow: false });

        expect(useVisualizerSettingsStore.getState().pendoloTuning.enableLineGlow).toBe(false);
        expect(JSON.parse(storage.getItem('pendolo_tuning') ?? '{}').enableLineGlow).toBe(false);
    });
});

describe('Pendolo render override (#929)', () => {
    const storage = pendoloTuning.storage!;

    it('follows the global level when an old save has no render field', () => {
        const read = storage.read({ arcRadius: 0.5 } as never);
        expect(read.render).toEqual({ scale: 'global', antialias: 'global' });
        expect(read.arcRadius).toBe(0.5);
    });

    it('reads a stored render back as it is, and falls back to global on bad values', () => {
        expect(storage.read({ render: { scale: 1.5, antialias: 'off' } } as never).render).toEqual({ scale: 1.5, antialias: 'off' });
        expect(storage.read({ render: { scale: 3, antialias: 'auto' } } as never).render).toEqual({ scale: 'global', antialias: 'global' });
        expect(storage.read({ render: 'high' } as never).render).toEqual({ scale: 'global', antialias: 'global' });
    });

    it('keeps the held render through a patch that does not touch it, and takes a new one', () => {
        const held = storage.read({ render: { scale: 0.75, antialias: 'on' } } as never);
        expect(storage.merge(held, { arcRadius: 0.5 }).render).toEqual({ scale: 0.75, antialias: 'on' });
        expect(storage.merge(held, { render: { scale: 'global', antialias: 'off' } }).render).toEqual({ scale: 'global', antialias: 'off' });
    });
});
