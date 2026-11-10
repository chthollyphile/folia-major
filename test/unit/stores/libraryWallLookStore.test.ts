import { afterEach, describe, expect, it, vi } from 'vitest';
import { SLOTS_PER_BLOCK } from '@/components/wall/blockTemplates';
import {
    clampLibraryWallWindowsPerBlock,
    DEFAULT_LIBRARY_WALL_LOOK,
    DEFAULT_LIBRARY_WALL_WINDOWS_PER_BLOCK,
    isLibraryWallLook,
    LIBRARY_WALL_LOOKS,
    LIBRARY_WALL_SLOTS_PER_BLOCK,
    LIBRARY_WALL_WINDOW_COUNTS,
    libraryWallWindowSharePercent,
    normalizeLibraryWallLook,
} from '@/utils/libraryWallLook';
import type { useLibraryWallLookStore as StoreHook } from '@/stores/useLibraryWallLookStore';

// test/unit/stores/libraryWallLookStore.test.ts
// bravais 透光偏好（B6b②）：取值规则（三档、窗数 1–6 的钳制、百分比标注）与 store 的默认值、持久化、
// 非法 / 越界存储值、存储不可用时的容错；集合叠页边开关（默认开）。store 在 import 时读存储，所以每个用例重新 import 一份。

const LOOK_KEY = 'library_wall_look';
const WINDOWS_KEY = 'library_wall_windows_per_block';
const STACK_EDGES_KEY = 'library_wall_stack_edges';
const SEAM_CLEAR_KEY = 'library_wall_seam_clear';
const SEAM_STYLE_KEY = 'library_wall_seam_style';
const SEAM_DIRECTION_KEY = 'library_wall_seam_direction';
const BACKDROP_LYRICS_KEY = 'library_wall_backdrop_lyrics';
const BACKDROP_BLUR_KEY = 'library_wall_backdrop_blur';

type StorageOptions = { throwOnGet?: boolean; throwOnSet?: boolean; noWindow?: boolean };

let storage: Map<string, string>;

/** 按给定的存储内容「重启」一次：重新 import store。 */
const loadStore = async (initial: Record<string, string> = {}, options: StorageOptions = {}): Promise<typeof StoreHook> => {
    vi.resetModules();
    storage = new Map(Object.entries(initial));
    if (!options.noWindow) vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => {
            if (options.throwOnGet) throw new Error('storage disabled');
            return storage.get(key) ?? null;
        },
        setItem: (key: string, value: string) => {
            if (options.throwOnSet) throw new Error('quota exceeded');
            storage.set(key, value);
        },
    });
    return (await import('@/stores/useLibraryWallLookStore')).useLibraryWallLookStore;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
});

describe('library wall look rules', () => {
    it('lists the three looks in display order and defaults to solid', () => {
        expect(LIBRARY_WALL_LOOKS).toEqual(['solid', 'partial', 'clear']);
        expect(DEFAULT_LIBRARY_WALL_LOOK).toBe('solid');
        expect(LIBRARY_WALL_LOOKS.every(isLibraryWallLook)).toBe(true);
        expect(isLibraryWallLook('frosted')).toBe(false);
        expect(normalizeLibraryWallLook('clear')).toBe('clear');
        expect(normalizeLibraryWallLook('partial')).toBe('partial');
        expect(normalizeLibraryWallLook('Partial')).toBe('solid');
        expect(normalizeLibraryWallLook(null)).toBe('solid');
        expect(normalizeLibraryWallLook(2)).toBe('solid');
    });

    it('offers one to six windows per block, three by default', () => {
        expect(LIBRARY_WALL_WINDOW_COUNTS).toEqual([1, 2, 3, 4, 5, 6]);
        expect(DEFAULT_LIBRARY_WALL_WINDOWS_PER_BLOCK).toBe(3);
    });

    it('clamps out-of-range counts to the nearest bound and falls back to 3 for non-numbers', () => {
        expect(clampLibraryWallWindowsPerBlock(4)).toBe(4);
        expect(clampLibraryWallWindowsPerBlock('5')).toBe(5);
        expect(clampLibraryWallWindowsPerBlock(9)).toBe(6);
        expect(clampLibraryWallWindowsPerBlock('12')).toBe(6);
        expect(clampLibraryWallWindowsPerBlock(0)).toBe(1);
        expect(clampLibraryWallWindowsPerBlock(-3)).toBe(1);
        expect(clampLibraryWallWindowsPerBlock(2.6)).toBe(3);
        expect(clampLibraryWallWindowsPerBlock(Number.NaN)).toBe(3);
        expect(clampLibraryWallWindowsPerBlock(Number.POSITIVE_INFINITY)).toBe(3);
        expect(clampLibraryWallWindowsPerBlock('abc')).toBe(3);
        expect(clampLibraryWallWindowsPerBlock('')).toBe(3);
        expect(clampLibraryWallWindowsPerBlock('  ')).toBe(3);
        expect(clampLibraryWallWindowsPerBlock(null)).toBe(3);
        expect(clampLibraryWallWindowsPerBlock(undefined)).toBe(3);
    });

    it('labels each count with its share of a 12-slot block (8%–50%)', () => {
        expect(LIBRARY_WALL_SLOTS_PER_BLOCK).toBe(SLOTS_PER_BLOCK);
        expect(LIBRARY_WALL_WINDOW_COUNTS.map(libraryWallWindowSharePercent)).toEqual([8, 17, 25, 33, 42, 50]);
    });
});

describe('useLibraryWallLookStore', () => {
    it('starts solid with three windows kept for partial and writes nothing until the listener chooses', async () => {
        const store = await loadStore();

        expect(store.getState().look).toBe('solid');
        expect(store.getState().windowsPerBlock).toBe(3);
        expect(storage.size).toBe(0);
    });

    it('persists both choices and reads them back after a restart', async () => {
        const store = await loadStore();
        store.getState().setLook('clear');
        store.getState().setWindowsPerBlock(5);

        expect(storage.get(LOOK_KEY)).toBe('clear');
        expect(storage.get(WINDOWS_KEY)).toBe('5');

        const restarted = await loadStore(Object.fromEntries(storage));
        expect(restarted.getState().look).toBe('clear');
        expect(restarted.getState().windowsPerBlock).toBe(5);
    });

    it('falls back to the default look for an unknown stored value', async () => {
        const store = await loadStore({ [LOOK_KEY]: 'frosted' });

        expect(store.getState().look).toBe('solid');
    });

    it.each([
        ['9', 6],
        ['0', 1],
        ['-2', 1],
        ['4.4', 4],
        ['many', 3],
        ['', 3],
    ])('reads a stored window count of %j as %i', async (stored, expected) => {
        const store = await loadStore({ [WINDOWS_KEY]: stored });

        expect(store.getState().windowsPerBlock).toBe(expected);
    });

    it('clamps and normalizes what the setters are handed before storing it', async () => {
        const store = await loadStore();

        store.getState().setWindowsPerBlock(10);
        expect(store.getState().windowsPerBlock).toBe(6);
        expect(storage.get(WINDOWS_KEY)).toBe('6');

        store.getState().setWindowsPerBlock(Number.NaN);
        expect(store.getState().windowsPerBlock).toBe(3);
        expect(storage.get(WINDOWS_KEY)).toBe('3');

        store.getState().setLook('clear');
        store.getState().setLook('opaque' as never);
        expect(store.getState().look).toBe('solid');
        expect(storage.get(LOOK_KEY)).toBe('solid');
    });

    it('keeps the window count when the look moves away from partial and back', async () => {
        const store = await loadStore({ [WINDOWS_KEY]: '2' });

        store.getState().setLook('solid');
        store.getState().setLook('partial');

        expect(store.getState().windowsPerBlock).toBe(2);
    });

    it('re-reads storage on hydrate', async () => {
        const store = await loadStore();
        storage.set(LOOK_KEY, 'clear');
        storage.set(WINDOWS_KEY, '7');

        store.getState().hydrate();

        expect(store.getState().look).toBe('clear');
        expect(store.getState().windowsPerBlock).toBe(6);
    });

    it('uses the defaults when storage cannot be read', async () => {
        const store = await loadStore({ [LOOK_KEY]: 'clear' }, { throwOnGet: true });

        expect(store.getState().look).toBe('solid');
        expect(store.getState().windowsPerBlock).toBe(3);
    });

    it('keeps a choice for the session when storage cannot be written', async () => {
        const store = await loadStore({}, { throwOnSet: true });

        expect(() => store.getState().setLook('clear')).not.toThrow();
        expect(() => store.getState().setWindowsPerBlock(6)).not.toThrow();
        expect(store.getState().look).toBe('clear');
        expect(store.getState().windowsPerBlock).toBe(6);
        expect(storage.size).toBe(0);
    });

    it('neither reads nor writes storage outside a browser', async () => {
        const store = await loadStore({ [LOOK_KEY]: 'clear' }, { noWindow: true });

        expect(store.getState().look).toBe('solid');
        store.getState().setLook('partial');
        expect(storage.get(LOOK_KEY)).toBe('clear');
    });

    it('shows the collection stack edges by default and persists turning them off', async () => {
        const store = await loadStore();
        expect(store.getState().collectionStackEdges).toBe(true);
        expect(storage.size).toBe(0);

        store.getState().setCollectionStackEdges(false);
        expect(storage.get(STACK_EDGES_KEY)).toBe('false');
        const restarted = await loadStore(Object.fromEntries(storage));
        expect(restarted.getState().collectionStackEdges).toBe(false);

        // 只认 'false' 为关；读不到或别的值按默认（开）。
        expect((await loadStore({ [STACK_EDGES_KEY]: 'nope' })).getState().collectionStackEdges).toBe(true);
        expect((await loadStore({ [STACK_EDGES_KEY]: 'false' }, { throwOnGet: true })).getState().collectionStackEdges).toBe(true);
    });

    // 2026-10-09：信息条的材质与墙后的画面。信息条始终透明默认开（用户定，只认 'false' 为关）；歌词 / 模糊默认关、
    // 只认 'true'；预设默认主题纸色，非法值回默认。
    it('keeps the info strip clear and the backdrop plain by default, and persists the changes', async () => {
        const store = await loadStore();
        expect(store.getState()).toMatchObject({ seamClear: true, seamStyle: 'paper', backdropLyrics: false, backdropBlur: false });
        expect(storage.size).toBe(0);

        store.getState().setSeamClear(false);
        store.getState().setSeamClear(true);
        store.getState().setSeamStyle('black');
        store.getState().setBackdropLyrics(true);
        store.getState().setBackdropBlur(true);
        expect(Object.fromEntries(storage)).toEqual({
            [SEAM_CLEAR_KEY]: 'true',
            [SEAM_STYLE_KEY]: 'black',
            [BACKDROP_LYRICS_KEY]: 'true',
            [BACKDROP_BLUR_KEY]: 'true',
        });
        const restarted = await loadStore(Object.fromEntries(storage));
        expect(restarted.getState()).toMatchObject({ seamClear: true, seamStyle: 'black', backdropLyrics: true, backdropBlur: true });

        // 非法预设回默认后再写；透明只认 'false' 为关，读不到也按默认开。
        restarted.getState().setSeamStyle('neon' as never);
        expect(storage.get(SEAM_STYLE_KEY)).toBe('paper');
        expect((await loadStore({ [SEAM_STYLE_KEY]: 'Dots', [SEAM_CLEAR_KEY]: 'yes' })).getState()).toMatchObject({ seamStyle: 'paper', seamClear: true });
        expect((await loadStore({ [SEAM_CLEAR_KEY]: 'false' })).getState().seamClear).toBe(false);
        expect((await loadStore({ [SEAM_CLEAR_KEY]: 'false' }, { throwOnGet: true })).getState().seamClear).toBe(true);
        expect((await loadStore({ [BACKDROP_BLUR_KEY]: 'true' }, { throwOnGet: true })).getState().backdropBlur).toBe(false);
    });

    // 信息条方向：默认自动（按视口形状）；三个取值以外的回默认后再写，读不到也按默认。
    it('opens the info strip by the screen shape by default and persists a fixed direction', async () => {
        const store = await loadStore();
        expect(store.getState().seamDirection).toBe('auto');
        expect(storage.size).toBe(0);

        store.getState().setSeamDirection('horizontal');
        expect(storage.get(SEAM_DIRECTION_KEY)).toBe('horizontal');
        const restarted = await loadStore(Object.fromEntries(storage));
        expect(restarted.getState().seamDirection).toBe('horizontal');

        restarted.getState().setSeamDirection('sideways' as never);
        expect(storage.get(SEAM_DIRECTION_KEY)).toBe('auto');
        expect((await loadStore({ [SEAM_DIRECTION_KEY]: 'Vertical' })).getState().seamDirection).toBe('auto');
        expect((await loadStore({ [SEAM_DIRECTION_KEY]: 'vertical' })).getState().seamDirection).toBe('vertical');
        expect((await loadStore({ [SEAM_DIRECTION_KEY]: 'vertical' }, { throwOnGet: true })).getState().seamDirection).toBe('auto');
    });
});
