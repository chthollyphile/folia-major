import type { FoliumLayoutRect, FoliumPlayerLayout } from '../mods/folium/contract';
import { EMPTY_PLAYER_INSETS, freezePlayerLayout, samePlayerLayout, type NativePlayerObstacle } from '../utils/playerOverlayGeometry';

// src/services/playerOverlayLayout.ts
// Native components register their own refs; mods only receive immutable geometry.

type ObstacleReader = (bounds: FoliumLayoutRect) => NativePlayerObstacle | null;
type Entry = { element: Element | null; read: ObstacleReader };
export interface PlayerLayoutSource {
    get(): FoliumPlayerLayout | null;
    subscribe(listener: () => void): () => void;
}

export const createPlayerOverlayLayout = () => {
    let root: Element | null = null;
    let measuredRoot: Element | null = null;
    let snapshot: FoliumPlayerLayout | null = null;
    let insets = EMPTY_PLAYER_INSETS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: ResizeObserver | undefined;
    const entries = new Map<symbol, Entry>();
    const listeners = new Set<() => void>();

    const measure = () => {
        const bounds = root?.isConnected ? root.getBoundingClientRect() : null;
        const next = bounds && bounds.width > 0 && bounds.height > 0
            ? freezePlayerLayout(bounds, [...entries.values()].flatMap(({ read }) => {
                const obstacle = read(bounds);
                return obstacle ? [obstacle] : [];
            }), insets)
            : null;
        if (measuredRoot === root && samePlayerLayout(snapshot, next)) return false;
        measuredRoot = root;
        snapshot = next;
        return true;
    };
    const notify = () => {
        if (!measure()) return;
        for (const listener of [...listeners]) {
            try { listener(); } catch (error) { console.warn('[Folium] layout subscriber failed', error); }
        }
    };
    // Motion callbacks invalidate the layout, but neither measure nor update React every frame.
    const invalidate = () => {
        if (!listeners.size || timer !== undefined || (!root && snapshot === null)) return;
        timer = setTimeout(() => { timer = undefined; notify(); }, 80);
    };
    const observeEntries = () => {
        observer?.disconnect();
        window.removeEventListener('resize', invalidate);
        window.removeEventListener('scroll', invalidate, true);
        if (!root || !listeners.size) {
            observer = undefined;
            return;
        }
        if (!observer && typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(invalidate);
        observer?.observe(root);
        for (const entry of entries.values()) if (entry.element) observer?.observe(entry.element);
        window.addEventListener('resize', invalidate);
        window.addEventListener('scroll', invalidate, true);
    };
    const source: PlayerLayoutSource = {
        get: () => {
            if (!root?.isConnected || !listeners.size) return null;
            return measuredRoot === root ? snapshot : null;
        },
        subscribe: (listener) => {
            listeners.add(listener);
            if (listeners.size === 1) observeEntries();
            invalidate();
            let disposed = false;
            return () => {
                if (disposed) return;
                disposed = true;
                listeners.delete(listener);
                if (!listeners.size) {
                    clearTimeout(timer);
                    timer = undefined;
                    observeEntries();
                    snapshot = null;
                    measuredRoot = null;
                }
            };
        },
    };
    return {
        source,
        invalidate,
        registerRoot: (element: Element, safeInsets: FoliumPlayerLayout['insets'] = EMPTY_PLAYER_INSETS) => {
            root = element;
            insets = { ...safeInsets };
            observeEntries();
            invalidate();
            return () => {
                if (root === element) root = null;
                observeEntries();
                invalidate();
            };
        },
        register: (element: Element | null, read: ObstacleReader) => {
            const token = Symbol();
            entries.set(token, { element, read });
            observeEntries();
            invalidate();
            return () => {
                entries.delete(token);
                observeEntries();
                invalidate();
            };
        },
    };
};

export const playerOverlayLayout = createPlayerOverlayLayout();
