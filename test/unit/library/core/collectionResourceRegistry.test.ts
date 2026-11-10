import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryCollectionDescriptor } from '@/library/core/collection/collection.contract';
import type { CollectionResource, CollectionResourceKind } from '@/library/core/shared/resource.contract';
import { createCollectionResourceRegistry } from '@/library/core/collection/resource/collectionResourceRegistry.service';

// test/unit/library/core/collectionResourceRegistry.test.ts
// 资源生命周期：StrictMode 的「挂载 → 卸载 → 挂载」不能造成重复请求；只 peek 不 retain 的实例
// 要被回收；释放后的在线资源只在自己认可时才复用，LRU 有上限。

const descriptor = { source: 'online', providerId: 'p', id: 'pl', name: 'PL', type: 'playlist' } as LibraryCollectionDescriptor;

type FakeResource = CollectionResource & { paused: number; disposed: boolean; reusable: boolean };

const fakeResource = (key: string, kind: CollectionResourceKind = 'online'): FakeResource => {
    const resource = {
        key,
        kind,
        paused: 0,
        disposed: false,
        reusable: true,
        getSnapshot: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        ensure: vi.fn(),
        reload: vi.fn(),
        resumeSync: vi.fn(),
        canReuse: vi.fn(() => resource.reusable && !resource.disposed),
        pause: vi.fn(() => { resource.paused += 1; }),
        dispose: vi.fn(() => { resource.disposed = true; }),
        removeTracks: vi.fn(async () => {}),
        removeAt: vi.fn(() => false),
        replaceTrackAt: vi.fn(() => false),
        replaceAll: vi.fn(async () => true),
    } as unknown as FakeResource;
    return resource;
};

describe('collection resource registry', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('survives the StrictMode mount, unmount, mount sequence with one instance', () => {
        const registry = createCollectionResourceRegistry();
        const create = vi.fn(() => fakeResource('a'));

        const first = registry.peekOrCreate('a', descriptor, create);
        const second = registry.peekOrCreate('a', descriptor, create);
        const releaseFirst = registry.retain(first)!;
        releaseFirst();
        const releaseSecond = registry.retain(second)!;
        vi.runAllTimers();

        expect(create).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
        expect((first as FakeResource).paused).toBe(0);
        expect(registry.size()).toEqual({ live: 1, retained: 0 });
        releaseSecond();
    });

    it('pauses a released online resource and reuses it when it says it can', () => {
        const registry = createCollectionResourceRegistry();
        const resource = registry.peekOrCreate('a', descriptor, () => fakeResource('a'));
        registry.retain(resource)!();
        vi.runAllTimers();
        expect((resource as FakeResource).paused).toBe(1);
        expect(registry.size()).toEqual({ live: 0, retained: 1 });

        const create = vi.fn(() => fakeResource('a'));
        expect(registry.peekOrCreate('a', descriptor, create)).toBe(resource);
        expect(create).not.toHaveBeenCalled();
    });

    it('creates a fresh resource when the released one cannot be reused', () => {
        const registry = createCollectionResourceRegistry();
        const stale = registry.peekOrCreate('a', descriptor, () => fakeResource('a')) as FakeResource;
        registry.retain(stale)!();
        vi.runAllTimers();
        stale.reusable = false;

        const fresh = registry.peekOrCreate('a', descriptor, () => fakeResource('a'));
        expect(fresh).not.toBe(stale);
        expect(stale.disposed).toBe(true);
    });

    it('disposes non-online resources as soon as nobody uses them', () => {
        const registry = createCollectionResourceRegistry();
        const resource = registry.peekOrCreate('n', descriptor, () => fakeResource('n', 'navidrome')) as FakeResource;
        registry.retain(resource)!();
        vi.runAllTimers();
        expect(resource.disposed).toBe(true);
        expect(registry.size()).toEqual({ live: 0, retained: 0 });
    });

    it('keeps at most maxRetained released resources and disposes the oldest', () => {
        const registry = createCollectionResourceRegistry({ maxRetained: 2 });
        const resources = ['a', 'b', 'c'].map(key => {
            const resource = registry.peekOrCreate(key, descriptor, () => fakeResource(key)) as FakeResource;
            registry.retain(resource)!();
            vi.runAllTimers();
            return resource;
        });

        expect(registry.size().retained).toBe(2);
        expect(resources.map(resource => resource.disposed)).toEqual([true, false, false]);
    });

    it('reclaims an instance that was peeked during a discarded render and never retained', () => {
        const registry = createCollectionResourceRegistry({ orphanGraceMs: 5000 });
        const orphan = registry.peekOrCreate('a', descriptor, () => fakeResource('a')) as FakeResource;
        vi.advanceTimersByTime(4999);
        expect(registry.size().live).toBe(1);
        vi.advanceTimersByTime(1);
        expect(orphan.paused).toBe(1);
        expect(registry.size()).toEqual({ live: 0, retained: 1 });
    });

    it('refuses to retain a resource it no longer holds, and ignores a second release', () => {
        const registry = createCollectionResourceRegistry();
        const resource = registry.peekOrCreate('a', descriptor, () => fakeResource('a'));
        const release = registry.retain(resource)!;
        const releaseAgain = registry.retain(resource)!;
        release();
        release();
        vi.runAllTimers();
        expect(registry.size().live).toBe(1);
        releaseAgain();
        vi.runAllTimers();
        expect(registry.size().live).toBe(0);

        expect(registry.retain(fakeResource('unknown'))).toBeNull();
    });
});
