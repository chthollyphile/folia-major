import { describe, expect, it, vi } from 'vitest';
import { createFoliumRegistry } from '@/mods/folium/registry';

// test/unit/mod-system/foliumRegistry.test.ts
// The one registry implementation behind every folium.registries.*: ids are
// namespaced per mod, duplicates and bad names are refused, a failing adapter
// rolls the registration back, and tearing a mod down removes all it owns.

interface Def { id: string; value?: number }

describe('createFoliumRegistry', () => {
    it('namespaces ids with the owning mod and lists entries', () => {
        const registry = createFoliumRegistry<Def>('things');
        const handle = registry.register('mod-a', { id: 'one' });
        expect(handle.id).toBe('mod-a:one');
        expect(registry.get('mod-a:one')?.modId).toBe('mod-a');
        expect(registry.list().map((entry) => entry.id)).toEqual(['mod-a:one']);
    });

    it('lets two mods use the same local name but refuses duplicates within one mod', () => {
        const registry = createFoliumRegistry<Def>('things');
        registry.register('mod-a', { id: 'x' });
        registry.register('mod-b', { id: 'x' });
        expect(() => registry.register('mod-a', { id: 'x' })).toThrow('duplicate id "mod-a:x"');
    });

    it('refuses ids that are not lowercase slugs', () => {
        const registry = createFoliumRegistry<Def>('things');
        expect(() => registry.register('mod-a', { id: 'Has Space' })).toThrow('id must match');
        expect(() => registry.register('mod-a', { id: 'a:b' })).toThrow('id must match');
    });

    it('runs validate, and rolls back when onAdd throws', () => {
        const onAdd = vi.fn(() => { throw new Error('host refused'); });
        const registry = createFoliumRegistry<Def, number>('things', {
            validate: (def) => def.value ?? 0,
            onAdd,
        });
        expect(() => registry.register('mod-a', { id: 'x', value: 3 })).toThrow('host refused');
        expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ def: 3 }));
        expect(registry.list()).toEqual([]);
    });

    it('unregisterAll removes only the owning mod entries and calls onRemove', () => {
        const onRemove = vi.fn();
        const registry = createFoliumRegistry<Def>('things', { onRemove });
        registry.register('mod-a', { id: 'x' });
        registry.register('mod-a', { id: 'y' });
        registry.register('mod-b', { id: 'z' });
        registry.unregisterAll('mod-a');
        expect(registry.list().map((entry) => entry.id)).toEqual(['mod-b:z']);
        expect(onRemove).toHaveBeenCalledTimes(2);
    });

    it('notifies subscribers and keeps list() stable between changes', () => {
        const registry = createFoliumRegistry<Def>('things');
        const listener = vi.fn();
        registry.subscribe(listener);
        const before = registry.list();
        expect(registry.list()).toBe(before);
        const handle = registry.register('mod-a', { id: 'x' });
        expect(listener).toHaveBeenCalledTimes(1);
        expect(registry.list()).not.toBe(before);
        handle.unregister();
        handle.unregister();
        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('ignores a stale handle once the id belongs to a newer registration', () => {
        const registry = createFoliumRegistry<Def>('things');
        const stale = registry.register('mod-a', { id: 'x', value: 1 });
        registry.unregisterAll('mod-a');
        registry.register('mod-a', { id: 'x', value: 2 });
        stale.unregister();
        expect(registry.get('mod-a:x')?.def.value).toBe(2);
    });
});
