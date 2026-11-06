import { create } from 'zustand';
import { getStoredString, setStoredString } from '../stores/storagePrimitives';
import { EXAMPLE_PACK } from './example';
import { RENDERER_PACK } from './code/example';
import { parseStylePack } from './validate';
import type { AnyStylePack as StylePack } from './code/contract';

// A small installed-pack library; the active pack itself is a visualizer tuning, not an ID dependency.
const KEY = 'folia_style_pack_library_v1';
const LIMIT = 12;
function persist(packs: StylePack[]) {
    try { setStoredString(KEY, JSON.stringify(packs)); }
    catch (error) {
        if (error instanceof Error && error.name === 'QuotaExceededError') throw new Error('stylePacks.storageFull', { cause: error });
        throw error;
    }
}
function readLibrary(): StylePack[] {
    try {
        const value: unknown = JSON.parse(getStoredString(KEY, '[]'));
        if (!Array.isArray(value) || value.length > LIMIT) return [];
        return value.flatMap(item => {
            try { return [parseStylePack(JSON.stringify(item))]; } catch { return []; }
        }).filter((pack, index, all) => ![EXAMPLE_PACK.id, RENDERER_PACK.id].includes(pack.id) && all.findIndex(item => item.id === pack.id) === index);
    } catch { return []; }
}
export const useStylePackLibrary = create<{ packs: StylePack[]; install: (pack: StylePack) => void; remove: (id: string) => void }>((set, get) => ({
    packs: readLibrary(),
    install: value => {
        const pack = parseStylePack(JSON.stringify(value));
        if ([EXAMPLE_PACK.id, RENDERER_PACK.id].includes(pack.id)) throw new Error('stylePacks.reserved');
        const packs = [...get().packs.filter(item => item.id !== pack.id), pack];
        if (packs.length > LIMIT) throw new Error('stylePacks.libraryFull');
        persist(packs);
        set({ packs });
        console.info('[StylePacks] Installed', pack.id, pack.version);
    },
    remove: id => {
        const packs = get().packs.filter(pack => pack.id !== id);
        persist(packs);
        set({ packs });
    },
}));
