// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time, and Node's own experimental storage
// shadows jsdom's here, so an in-memory Storage goes in before any import runs.
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
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { motionValue } from 'framer-motion';
import VisualizerBackdrop from '@/components/visualizer/VisualizerBackdrop';
import type { VisualizerRegistryEntry, VisualizerSharedProps } from '@/components/visualizer/definition';

// test/unit/visualizer/temperaRuntimeRebuild.test.ts
// 凝彩's WebGL runtime is made again whenever its rebuild key changes, and the blobs of its image
// layers are in that key. With no layer images the effect that reads them put a new empty map in
// place of the empty one the style mounted with: every start of 凝彩 made a runtime, threw it away
// half made and made another (on four slow cores the thrown-away context alone held the page 60 to
// 100 ms).

/** The rebuild key of every render, as the style handed it to the Pixi host. */
const rebuildKeys: unknown[][] = [];
vi.mock('@/components/visualizer/pixi/pixiRuntimeHost', () => ({
    useVisualizerPixiHost: (options: { rebuildKey: unknown[] }) => {
        rebuildKeys.push([...options.rebuildKey]);
        return { current: null };
    },
}));

const { default: VisualizerTempera } = await import('@/components/visualizer/tempera/VisualizerTempera');

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    rebuildKeys.length = 0;
});

describe('凝彩 without layer images', () => {
    it('keeps its rebuild key once its effects have run', async () => {
        const props = {
            currentTime: motionValue(0),
            currentLineIndex: -1,
            lines: [],
            theme: { name: 'test', backgroundColor: '#000000', primaryColor: '#ffffff', secondaryColor: '#888888', accentColor: '#ff0000', fontStyle: 'sans' },
            audioPower: motionValue(0),
            audioBands: {},
            isPreviewMode: true,
        } as unknown as VisualizerSharedProps;
        // No background, so nothing but the style mounts in the backdrop.
        const entry = { background: false } as unknown as VisualizerRegistryEntry;
        root = createRoot(document.body.appendChild(document.createElement('div')));
        await act(async () => {
            root!.render(React.createElement(VisualizerBackdrop, { entry, props, children: React.createElement(VisualizerTempera, props) }));
        });
        expect(rebuildKeys.length).toBeGreaterThan(1);
        expect(new Set(rebuildKeys.map(key => key[1])).size).toBe(1);
    });
});
