import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryBackdrop } from '@/library/app/useLibraryBackdrop';
import { NEUTRAL_LIBRARY_BACKDROP } from '@/library/core/suite/libraryBackdrop';
import { getLibrarySuite, resolveLibrarySurface } from '@/library/registry';
import { useMotionSettingsStore } from '@/stores/useMotionSettingsStore';

// test/unit/library/backdrop.test.ts
// 背景板契约：网格解析自己的动效设置，宿主使用稳定快照，中性背景板不关闭未来 suite 的转场。
const initialMotion = useMotionSettingsStore.getState();
const backdrop = getLibrarySuite('grid')!.transitions!.backdrop!;
beforeEach(() => useMotionSettingsStore.setState({
    ...initialMotion,
    reducedMotionSurfaces: { ...initialMotion.reducedMotionSurfaces, collectionMorph: false },
    followSystemReducedMotion: false,
    systemPrefersReducedMotion: false,
}));
afterEach(() => useMotionSettingsStore.setState(initialMotion));

describe('library backdrop contract', () => {
    it('preserves grid enter and exit timings and uses stable reduced snapshots', () => {
        const full = backdrop.getSnapshot();
        expect(full).toEqual({
            enabled: true,
            enter: { duration: 0.62, ease: [0.22, 1, 0.36, 1] },
            exit: { duration: 0.28, ease: [0.4, 0, 0.2, 1] },
        });
        expect(backdrop.getSnapshot()).toBe(full);
        useMotionSettingsStore.setState(state => ({ reducedMotionSurfaces: { ...state.reducedMotionSurfaces, collectionMorph: true } }));
        const reduced = backdrop.getSnapshot();
        expect(reduced).toEqual({ ...NEUTRAL_LIBRARY_BACKDROP, enabled: false });
        expect(backdrop.getSnapshot()).toBe(reduced);
        useMotionSettingsStore.setState(state => ({ reducedMotionSurfaces: { ...state.reducedMotionSurfaces, collectionMorph: false } }));
        expect(backdrop.getSnapshot()).toBe(full);
    });

    it('follows the shared system preference rule', () => {
        useMotionSettingsStore.setState({ systemPrefersReducedMotion: true });
        expect(backdrop.getSnapshot().enabled).toBe(true);
        useMotionSettingsStore.setState({ followSystemReducedMotion: true });
        expect(backdrop.getSnapshot().enabled).toBe(false);
    });

    it('notifies only when its resolved motion preference changes and unsubscribes', () => {
        const listener = vi.fn();
        const unsubscribe = backdrop.subscribe(listener);
        try {
            useMotionSettingsStore.setState(state => ({ reducedMotionSurfaces: { ...state.reducedMotionSurfaces, lattice: true } }));
            expect(listener).not.toHaveBeenCalled();
            useMotionSettingsStore.setState({ followSystemReducedMotion: true, systemPrefersReducedMotion: true });
            expect(listener).toHaveBeenCalledTimes(1);
            useMotionSettingsStore.setState(state => ({ reducedMotionSurfaces: { ...state.reducedMotionSurfaces, collectionMorph: true } }));
            expect(listener).toHaveBeenCalledTimes(1);
        } finally {
            unsubscribe();
        }
        useMotionSettingsStore.setState({ followSystemReducedMotion: false });
        useMotionSettingsStore.setState(state => ({ reducedMotionSurfaces: { ...state.reducedMotionSurfaces, collectionMorph: false } }));
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('resolves the backdrop with the actual surface suite, including fallback', () => {
        expect(resolveLibrarySurface('collection', 'grid').transitions?.backdrop).toBe(backdrop);
        expect(resolveLibrarySurface('artist', 'unknown-suite').transitions?.backdrop).toBe(backdrop);
        expect(resolveLibrarySurface('collection', 'tui').transitions?.backdrop).toBeUndefined();
        expect(resolveLibrarySurface('artist', 'tui').transitions?.backdrop).toBeUndefined();
    });

    it('uses a neutral SSR snapshot and leaves undeclared backdrop transitions enabled', () => {
        const ReadBackdrop = ({ declared }: { declared: boolean }) => createElement('span', null,
            JSON.stringify(useLibraryBackdrop(declared ? backdrop : undefined)));
        useMotionSettingsStore.setState(state => ({ reducedMotionSurfaces: { ...state.reducedMotionSurfaces, collectionMorph: true } }));
        expect(renderToString(createElement(ReadBackdrop, { declared: true })))
            .toBe(renderToString(createElement(ReadBackdrop, { declared: false })));
        expect(NEUTRAL_LIBRARY_BACKDROP.enabled).toBe(true);
        expect(NEUTRAL_LIBRARY_BACKDROP.enter.duration).toBe(0.18);
        expect(NEUTRAL_LIBRARY_BACKDROP.exit).toBeUndefined();
    });
});
