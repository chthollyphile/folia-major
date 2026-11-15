// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// test/unit/stores/latticeWallForm.test.ts
// Lattice 的墙面形态（海报墙 / 电台墙）与电台墙的问号卡：读回存着的值，认不出的值回到海报墙，改了就存下。

const loadStore = async () => {
    vi.resetModules();
    return (await import('@/stores/useLatticeSettingsStore')).useLatticeSettingsStore;
};

afterEach(() => {
    localStorage.clear();
});

describe('Lattice wall form', () => {
    it('starts as the poster wall with covers showing', async () => {
        const store = await loadStore();
        expect(store.getState().latticeWallForm).toBe('poster');
        expect(store.getState().latticeRadioHideUpcoming).toBe(false);
    });

    it('reads the radio wall back, and falls back to the poster wall for a value it does not know', async () => {
        localStorage.setItem('lattice_wall_form', 'radio');
        expect((await loadStore()).getState().latticeWallForm).toBe('radio');
        localStorage.setItem('lattice_wall_form', 'carousel');
        expect((await loadStore()).getState().latticeWallForm).toBe('poster');
    });

    it('keeps what is set across a restart', async () => {
        const store = await loadStore();
        store.getState().handleSetLatticeWallForm('radio');
        store.getState().handleToggleLatticeRadioHideUpcoming(true);
        const reloaded = await loadStore();
        expect(reloaded.getState().latticeWallForm).toBe('radio');
        expect(reloaded.getState().latticeRadioHideUpcoming).toBe(true);
    });
});
