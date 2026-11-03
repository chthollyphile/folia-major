// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

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
import VisualizerShell from '@/components/visualizer/VisualizerShell';
import type { VisualizerRegistryEntry, VisualizerSharedProps } from '@/components/visualizer/definition';
import { stageLayersRegistry } from '@/mods/folium/registries/stageLayers';

// test/unit/visualizer/stageLayersAcrossStyleSwitch.test.ts
// A mod's stage layer belongs to the player page, not to a lyric style: the contract remounts it only
// for new lyrics, a new song or static mode. Each style draws its own VisualizerShell, so a layer the
// shell drew was torn down and mounted again on every style switch (an embedded video started over).
// Inside VisualizerRenderer the backdrop draws the stage layers, around whichever style is on screen.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    stageLayersRegistry.unregisterAll('mod-a');
    document.body.replaceChildren();
});

const props = {
    theme: { fontStyle: 'sans' },
    audioPower: motionValue(0),
    audioBands: {},
    isPreviewMode: false,
    staticMode: false,
} as unknown as VisualizerSharedProps;

// No background, so nothing but the stage layers mounts around the style.
const entry = { background: false } as unknown as VisualizerRegistryEntry;

const styleOf = (name: string): React.FC => {
    const Style: React.FC = () => React.createElement(VisualizerShell, {
        theme: props.theme,
        audioPower: props.audioPower,
        audioBands: props.audioBands,
        sharedProps: props,
        children: React.createElement('div', { 'data-style': name }),
    });
    return Style;
};
const StyleA = styleOf('a');
const StyleB = styleOf('b');

const show = (Style: React.FC) => React.createElement(VisualizerBackdrop, { entry, props, children: React.createElement(Style) });

// The slot's view is loaded lazily: load it first, so a few turns are enough for it to arrive and mount.
beforeAll(async () => {
    await import('@/mods/folium/registries/stageLayerView');
});
const settle = () => act(async () => {
    for (let index = 0; index < 20; index += 1) await new Promise(resolve => setTimeout(resolve, 0));
});

describe('stage layers across a style switch', () => {
    it('mounts each layer once and keeps it while the style changes', async () => {
        const mounts = { back: 0, front: 0 };
        const unmounts = { back: 0, front: 0 };
        for (const slot of ['back', 'front'] as const) {
            stageLayersRegistry.register('mod-a', {
                id: slot,
                slot: `player.stage.${slot}`,
                mount: () => {
                    mounts[slot] += 1;
                    return () => { unmounts[slot] += 1; };
                },
            });
        }

        const host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
        act(() => root!.render(show(StyleA)));
        await settle();
        expect(document.querySelector('[data-style="a"]')).not.toBeNull();
        expect(mounts).toEqual({ back: 1, front: 1 });

        act(() => root!.render(show(StyleB)));
        await settle();
        expect(document.querySelector('[data-style="b"]')).not.toBeNull();
        expect(document.querySelector('[data-style="a"]')).toBeNull();
        expect(mounts).toEqual({ back: 1, front: 1 });
        expect(unmounts).toEqual({ back: 0, front: 0 });
        // Drawn once each, by the backdrop, not by the shell as well.
        expect(document.querySelectorAll('[data-folium-slot="player.stage.back"]')).toHaveLength(1);
        expect(document.querySelectorAll('[data-folium-slot="player.stage.front"]')).toHaveLength(1);
    });
});
