import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    VISUALIZER_COMPLEX_STORAGE_KEY,
    createDefaultVisualizerComplex,
    normalizeVisualizerComplex,
    readStoredVisualizerComplex,
    writeStoredVisualizerComplex,
} from '@/components/visualizer/complex';

// test/unit/visualizer/complex.test.ts
// Locks the persisted visualizer complex schema and fallback behavior.
const createLocalStorageMock = (): Storage => {
    const store = new Map<string, string>();

    return {
        get length() {
            return store.size;
        },
        getItem: (key: string) => store.get(key) ?? null,
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
        clear: () => {
            store.clear();
        },
    };
};

describe('visualizer complex', () => {
    let storage: Storage;

    beforeEach(() => {
        storage = createLocalStorageMock();
        vi.stubGlobal('localStorage', storage);
        (globalThis as { window?: { localStorage: Storage; }; }).window = { localStorage: storage };
        vi.restoreAllMocks();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        delete (globalThis as { window?: unknown; }).window;
    });

    it('builds the default output stack', () => {
        const complex = createDefaultVisualizerComplex();

        expect(complex.version).toBe(2);
        expect(complex.output.bgNodeIds).toEqual(['bg-solid', 'bg-geometric', 'bg-vignette']);
        expect(complex.output.mainNodeIds).toEqual(['main-classic']);
        expect(complex.output.overlayNodeIds).toEqual(['overlay-subtitle']);
    });

    it('falls back to default for malformed stored data', () => {
        storage.setItem(VISUALIZER_COMPLEX_STORAGE_KEY, '{bad');

        expect(readStoredVisualizerComplex().output.mainNodeIds).toEqual(['main-classic']);
    });

    it('normalizes node positions and opacity values', () => {
        const normalized = normalizeVisualizerComplex({
            version: 2,
            nodes: [
                {
                    id: 'bg',
                    role: 'visualizerBg',
                    kind: 'solidTheme',
                    label: 'Bg',
                    enabled: true,
                    position: { x: '10', y: '20' },
                    config: { opacity: 2 },
                },
            ],
            edges: [],
        });

        const node = normalized.nodes[0];
        expect(node.position).toEqual({ x: 10, y: 20 });
        expect(node.role === 'visualizerBg' ? node.config.opacity : null).toBe(1);
    });

    it('normalizes concrete visualizer node parameters', () => {
        const normalized = normalizeVisualizerComplex({
            version: 2,
            nodes: [
                {
                    id: 'main',
                    role: 'visualizerMain',
                    kind: 'mainRenderer',
                    label: 'Main',
                    enabled: true,
                    position: { x: 0, y: 0 },
                    config: {
                        mode: 'fume',
                        opacity: 1,
                        lyricsFontScale: 4,
                        fumeTuning: {
                            hidePrintSymbols: true,
                            disableGeometricBackground: false,
                            backgroundObjectOpacity: 3,
                            textHoldRatio: -1,
                            cameraTrackingMode: 'bad',
                            cameraSpeed: 8,
                            glowIntensity: 4,
                            heroScale: 3,
                        },
                    },
                },
            ],
            edges: [],
        });

        const node = normalized.nodes[0];
        expect(node.role === 'visualizerMain' ? node.config.lyricsFontScale : null).toBe(1.8);
        expect(node.role === 'visualizerMain' ? node.config.fumeTuning?.backgroundObjectOpacity : null).toBe(1);
        expect(node.role === 'visualizerMain' ? node.config.fumeTuning?.textHoldRatio : null).toBe(0);
        expect(node.role === 'visualizerMain' ? node.config.fumeTuning?.cameraTrackingMode : null).toBe('smooth');
    });

    it('writes normalized complex data to localStorage', () => {
        const complex = createDefaultVisualizerComplex();
        writeStoredVisualizerComplex(complex);

        const saved = JSON.parse(storage.getItem(VISUALIZER_COMPLEX_STORAGE_KEY) ?? 'null');
        expect(saved.version).toBe(2);
        expect(saved.output.mainNodeIds).toEqual(['main-classic']);
    });

    it('rejects invalid typed port edges while normalizing', () => {
        const normalized = normalizeVisualizerComplex({
            version: 2,
            nodes: [
                { id: 'input-theme', role: 'input', kind: 'theme', label: 'Theme', enabled: true, position: { x: 0, y: 0 } },
                {
                    id: 'main',
                    role: 'visualizerMain',
                    kind: 'mainRenderer',
                    label: 'Main',
                    enabled: true,
                    position: { x: 0, y: 0 },
                    config: { mode: 'classic', opacity: 1 },
                },
            ],
            edges: [
                { id: 'ok', source: 'input-theme', sourceHandle: 'theme.accentColor', target: 'main', targetHandle: 'theme.primaryColor' },
                { id: 'bad', source: 'input-theme', sourceHandle: 'theme.accentColor', target: 'main', targetHandle: 'lyrics.lines' },
            ],
        });

        expect(normalized.edges.map(edge => edge.id)).toEqual(['ok']);
    });
});
