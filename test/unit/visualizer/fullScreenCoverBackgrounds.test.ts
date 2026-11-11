// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

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
import type { ReactElement } from 'react';
import { motionValue } from 'framer-motion';
import monet from '@/components/visualizer/backgrounds/monet/entry';
import nomand from '@/components/visualizer/backgrounds/nomand/entry';
import type { VisualizerBackgroundRenderProps } from '@/components/visualizer/backgrounds/definition';
import { getSizedCoverUrl } from '@/utils/coverUrl';
import { DEFAULT_THEME } from '@/services/baseThemes';

// test/unit/visualizer/fullScreenCoverBackgrounds.test.ts
// Monet and Nomand fill the screen with the cover, so they read the backdrop's 1024 step back to the
// provider's original; the backgrounds that only take colours keep the sized one.

const QQ = 'https://y.gtimg.cn/music/photo_new/T002M000album-mid.jpg?max_age=2592000';
const NETEASE = 'https://p1.music.126.net/abc/109951.jpg';

const props = (coverUrl: string | null | undefined): VisualizerBackgroundRenderProps => ({
    config: {},
    theme: DEFAULT_THEME,
    isDaylight: false,
    coverUrl,
    audioPower: motionValue(0),
    audioBands: { bass: motionValue(0), lowMid: motionValue(0), mid: motionValue(0), vocal: motionValue(0), treble: motionValue(0) },
    staticMode: false,
    paused: false,
});

describe.each([['monet', monet], ['nomand', nomand]] as const)('%s background cover', (_name, entry) => {
    it.each([QQ, NETEASE])('draws the original of %s, not the backdrop step', original => {
        const backdrop = getSizedCoverUrl(original, 1024);
        expect(backdrop).not.toBe(original);
        expect(entry.song?.(props(backdrop))).toEqual([original]);
        const element = entry.render(props(backdrop)) as ReactElement<{ coverUrl?: string | null }>;
        expect(element.props.coverUrl).toBe(original);
    });

    it('keeps no cover as no cover, so the uploaded image still stands in', () => {
        expect(entry.song?.(props(undefined))).toEqual([null]);
        const element = entry.render(props(null)) as ReactElement<{ coverUrl?: string | null }>;
        expect(element.props.coverUrl).toBeNull();
    });
});
