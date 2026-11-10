import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliumContextKind, FoliumStageContext, FoliumStageLayerDef } from '@/mods/folium/contract';
import { createFoliumRegistry } from '@/mods/runtime/registry';
import { bindFoliumStageRegistry } from '@/mods/folium/registries/stageRegistry';

// test/unit/mod-system/foliumStageLayout.test.ts
// Stage subscriptions own geometry demand; registration and mount lifetimes
// prevent retained contexts from restarting observation after teardown.

const state = vi.hoisted(() => ({
    main: true,
    snapshot: { bounds: { left: 0, top: 0, width: 800, height: 600 }, insets: { top: 0, right: 0, bottom: 0, left: 0 }, obstacles: [] },
    listeners: new Set<() => void>(),
    get: vi.fn(),
    subscribe: vi.fn(),
}));
vi.mock('@/utils/appSurface', () => ({ get isMainAppSurface() { return state.main; } }));
vi.mock('@/services/playerOverlayLayout', () => ({ playerOverlayLayout: { source: { get: state.get, subscribe: state.subscribe } } }));

beforeEach(() => {
    state.main = true;
    state.listeners.clear();
    state.get.mockReset().mockImplementation(() => state.listeners.size ? state.snapshot : null);
    state.subscribe.mockReset().mockImplementation((listener: () => void) => {
        state.listeners.add(listener);
        return () => state.listeners.delete(listener);
    });
});

const setup = (options: { optIn?: boolean; preview?: boolean; context?: FoliumContextKind; throwMount?: boolean } = {}) => {
    const registry = createFoliumRegistry<FoliumStageLayerDef>('stageLayers');
    const bound = bindFoliumStageRegistry(registry, {
        id: 'demo', experimental: options.optIn === false ? [] : ['player.layout'],
    }, options.context ?? 'main');
    const baseListeners = new Set<() => void>();
    const base = {
        isPreview: options.preview ?? false,
        getLayout: () => null,
        onChange: (listener: () => void) => {
            baseListeners.add(listener);
            return () => baseListeners.delete(listener);
        },
    } as unknown as FoliumStageContext;
    const contexts: FoliumStageContext[] = [];
    const handle = bound.register({
        id: 'layer', slot: 'app.overlay', mount: (_container, ctx) => {
            contexts.push(ctx);
            if (options.throwMount) { ctx.onChange(() => {}); throw new Error('failed mount'); }
        },
    });
    // A synchronous mount here: what the bound mount hands back is the disposer.
    const mount = () => registry.get(handle.id)!.def.mount({} as HTMLElement, base) as (() => void) | undefined;
    return { registry, bound, handle, contexts, mount, baseListeners };
};

describe('stage context layout subscriptions', () => {
    it('starts only on subscribe, shares demand, and merges geometry with ordinary context changes', () => {
        const fixture = setup();
        const dispose = fixture.mount();
        const ctx = fixture.contexts[0];
        expect(ctx.getLayout()).toBeNull();
        expect(state.subscribe).not.toHaveBeenCalled();
        const first = vi.fn(); const second = vi.fn();
        const stopFirst = ctx.onChange(first); const stopSecond = ctx.onChange(second);
        expect(state.subscribe).toHaveBeenCalledTimes(1);
        expect(ctx.getLayout()).toBe(state.snapshot);
        state.listeners.forEach((listener) => listener());
        fixture.baseListeners.forEach((listener) => listener());
        expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(2);
        stopFirst();
        expect(state.listeners.size).toBe(1);
        stopSecond();
        expect(state.listeners.size).toBe(0); expect(fixture.baseListeners.size).toBe(0);
        expect(ctx.getLayout()).toBeNull();
        dispose?.();
    });

    it.each([
        ['undeclared', { optIn: false }], ['preview', { preview: true }], ['export', { context: 'export' as const }],
    ])('keeps layout inert in %s while ordinary stage notifications work', (_name, options) => {
        const fixture = setup(options); const dispose = fixture.mount();
        const ctx = fixture.contexts[0]; const listener = vi.fn();
        ctx.onChange(listener);
        expect(ctx.getLayout()).toBeNull(); expect(state.subscribe).not.toHaveBeenCalled();
        fixture.baseListeners.forEach((notify) => notify());
        expect(listener).toHaveBeenCalledTimes(1);
        dispose?.(); expect(fixture.baseListeners.size).toBe(0);
    });

    it('does not observe or expose layout on the OBS/remote app surface', () => {
        state.main = false;
        const fixture = setup(); const dispose = fixture.mount();
        fixture.contexts[0].onChange(() => {});
        expect(fixture.contexts[0].getLayout()).toBeNull();
        expect(state.subscribe).not.toHaveBeenCalled(); dispose?.();
    });

    it.each(['unregister', 'disable'] as const)('invalidates retained contexts immediately on %s', (action) => {
        const fixture = setup(); const dispose = fixture.mount(); const ctx = fixture.contexts[0];
        ctx.onChange(() => {});
        if (action === 'unregister') fixture.handle.unregister();
        else fixture.registry.unregisterAll('demo');
        expect(state.listeners.size).toBe(0); expect(fixture.baseListeners.size).toBe(0);
        expect(ctx.getLayout()).toBeNull();
        ctx.onChange(() => {});
        expect(state.subscribe).toHaveBeenCalledTimes(1);
        dispose?.();
    });

    it('gives effect replay a fresh scope and never reactivates the old one', () => {
        const fixture = setup(); const firstDispose = fixture.mount(); const first = fixture.contexts[0];
        first.onChange(() => {}); firstDispose?.();
        const secondDispose = fixture.mount(); const second = fixture.contexts[1];
        expect(second).not.toBe(first);
        first.onChange(() => {}); expect(state.listeners.size).toBe(0);
        second.onChange(() => {}); expect(state.listeners.size).toBe(1);
        expect(first.getLayout()).toBeNull(); expect(second.getLayout()).toBe(state.snapshot);
        firstDispose?.(); expect(state.listeners.size).toBe(1);
        secondDispose?.(); expect(state.listeners.size).toBe(0);
    });

    it('does not revive a retained context when the same registration id is reused', () => {
        const fixture = setup(); const dispose = fixture.mount(); const old = fixture.contexts[0];
        old.onChange(() => {}); fixture.handle.unregister();
        let fresh: FoliumStageContext | undefined;
        fixture.bound.register({ id: 'layer', slot: 'app.overlay', mount: (_container, ctx) => { fresh = ctx; } });
        const nextDispose = fixture.mount();
        old.onChange(() => {}); expect(state.listeners.size).toBe(0);
        fresh!.onChange(() => {}); expect(state.listeners.size).toBe(1);
        fixture.handle.unregister(); expect(state.listeners.size).toBe(1);
        dispose?.(); nextDispose?.(); expect(state.listeners.size).toBe(0);
    });

    it('counts each subscription even when the callback is reused', () => {
        const fixture = setup(); const dispose = fixture.mount(); const ctx = fixture.contexts[0];
        const listener = vi.fn(); const first = ctx.onChange(listener); const second = ctx.onChange(listener);
        first(); expect(state.listeners.size).toBe(1);
        second(); expect(state.listeners.size).toBe(0);
        dispose?.();
    });

    it('releases observations when a mount subscribes and then throws', () => {
        const fixture = setup({ throwMount: true });
        expect(fixture.mount).toThrow('failed mount');
        expect(state.listeners.size).toBe(0); expect(fixture.baseListeners.size).toBe(0);
        fixture.contexts[0].onChange(() => {});
        expect(state.subscribe).toHaveBeenCalledTimes(1);
    });
});
