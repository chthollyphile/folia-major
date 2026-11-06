// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXAMPLE_PACK } from '../../../src/stylePacks/example';

// Installation commits only after persistence succeeds, including ID replacement and reload recovery.
const pack = (id = 'test.room') => ({ ...structuredClone(EXAMPLE_PACK), id });
beforeEach(() => { vi.resetModules(); localStorage.clear(); vi.restoreAllMocks(); });
describe('installed style pack library', () => {
    it('installs, replaces by ID, restores on reload and removes', async () => {
        let { useStylePackLibrary } = await import('../../../src/stylePacks/library');
        useStylePackLibrary.getState().install(pack());
        useStylePackLibrary.getState().install({ ...pack(), version: '2.0.0' });
        expect(useStylePackLibrary.getState().packs).toHaveLength(1);
        vi.resetModules();
        ({ useStylePackLibrary } = await import('../../../src/stylePacks/library'));
        expect(useStylePackLibrary.getState().packs[0].version).toBe('2.0.0');
        useStylePackLibrary.getState().remove('test.room');
        expect(useStylePackLibrary.getState().packs).toEqual([]);
    });
    it('keeps the previous library on failed writes and invalid imports', async () => {
        const { useStylePackLibrary } = await import('../../../src/stylePacks/library');
        useStylePackLibrary.getState().install(pack());
        const before = useStylePackLibrary.getState().packs;
        const primitives = await import('../../../src/stores/storagePrimitives');
        vi.spyOn(primitives, 'setStoredString').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
        expect(() => useStylePackLibrary.getState().install(pack('test.other'))).toThrow();
        expect(useStylePackLibrary.getState().packs).toBe(before);
        expect(() => useStylePackLibrary.getState().remove('test.room')).toThrow();
        expect(useStylePackLibrary.getState().packs).toBe(before);
        expect(() => useStylePackLibrary.getState().install({ ...pack(), layers: [] })).toThrow();
    });
    it('protects the built-in ID and bounds installed packs', async () => {
        const { useStylePackLibrary } = await import('../../../src/stylePacks/library');
        expect(() => useStylePackLibrary.getState().install(EXAMPLE_PACK)).toThrow('reserved');
        for (let i = 0; i < 12; i++) useStylePackLibrary.getState().install(pack(`test.room${i}`));
        expect(() => useStylePackLibrary.getState().install(pack('test.overflow'))).toThrow('libraryFull');
        expect(useStylePackLibrary.getState().packs).toHaveLength(12);
    });
    it('skips corrupt records without discarding valid ones', async () => {
        localStorage.setItem('folia_style_pack_library_v1', JSON.stringify([null, pack(), { id: 'invalid' }]));
        const { useStylePackLibrary } = await import('../../../src/stylePacks/library');
        expect(useStylePackLibrary.getState().packs).toEqual([pack()]);
    });
});
