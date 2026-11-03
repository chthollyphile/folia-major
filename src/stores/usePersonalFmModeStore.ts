import { create } from 'zustand';
import { DEFAULT_PERSONAL_FM_SELECTION, DEFAULT_PERSONAL_FM_CATALOG, normalizePersonalFmSelection, toPersonalFmRequestOptions } from '../services/onlineMusic/fmModes';
import type { PersonalFmCatalog, PersonalFmSelection } from '../types/personalFm';
import type { PersonalFmRequestOptions } from '../types/onlineMusic';
import { getStoredString, setStoredString } from './storagePrimitives';

// src/stores/usePersonalFmModeStore.ts
// The one place that holds the current Personal FM mode. Providers read it straight from here,
// so the home card, radio grid and queue refill all stay on the selected mode.
// Keep the published legacy setting intact; providers with their own catalogue keep separate choices.
const STORAGE_KEY = 'folia.personalFm.selection';
const PROVIDERS_KEY = 'folia.personalFm.providerSelections';
const readLegacy = (): PersonalFmSelection => {
    try { return normalizePersonalFmSelection(JSON.parse(getStoredString(STORAGE_KEY, 'null'))); }
    catch { return DEFAULT_PERSONAL_FM_SELECTION; }
};
const readProviders = (): Record<string, PersonalFmSelection> => {
    try {
        const raw = JSON.parse(getStoredString(PROVIDERS_KEY, '{}'));
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
        return Object.fromEntries(Object.entries(raw).filter(([id, value]) => id.length < 100 && value && typeof value === 'object'
            && ['DEFAULT', 'FAMILIAR', 'EXPLORE', 'SCENE_RCMD', 'PUZZLE_MODE_RCMD'].includes((value as PersonalFmSelection).mode)
            && ((value as PersonalFmSelection).scene === null || typeof (value as PersonalFmSelection).scene === 'string'))) as Record<string, PersonalFmSelection>;
    } catch { return {}; }
};
const persist = (key: string, value: unknown) => { try { setStoredString(key, JSON.stringify(value)); } catch { /* A session's mode still works if storage is unavailable. */ } };
type PersonalFmModeState = {
    selection: PersonalFmSelection;
    providerSelections: Record<string, PersonalFmSelection>;
    catalogs: Record<string, PersonalFmCatalog>;
    setSelection(selection: PersonalFmSelection): PersonalFmSelection;
    setProviderSelection(providerId: string, selection: PersonalFmSelection): PersonalFmSelection;
    setCatalog(providerId: string, catalog: PersonalFmCatalog): void;
};
export const selectProviderPersonalFm = (state: PersonalFmModeState, providerId: string): PersonalFmSelection => (
    state.catalogs[providerId] === DEFAULT_PERSONAL_FM_CATALOG ? state.selection
        : state.providerSelections[providerId] ?? DEFAULT_PERSONAL_FM_SELECTION
);
export const usePersonalFmModeStore = create<PersonalFmModeState>((set, get) => ({
    selection: readLegacy(), providerSelections: readProviders(), catalogs: {},
    setSelection(selection) {
        const normalized = normalizePersonalFmSelection(selection);
        set({ selection: normalized }); persist(STORAGE_KEY, normalized); return normalized;
    },
    setProviderSelection(providerId, selection) {
        const catalog = get().catalogs[providerId];
        if (catalog === DEFAULT_PERSONAL_FM_CATALOG) return get().setSelection(selection);
        if (!catalog) return selectProviderPersonalFm(get(), providerId);
        const normalized = normalizePersonalFmSelection(selection, catalog);
        const providerSelections = { ...get().providerSelections, [providerId]: normalized };
        set({ providerSelections }); persist(PROVIDERS_KEY, providerSelections); return normalized;
    },
    setCatalog(providerId, catalog) {
        if (get().catalogs[providerId] === catalog) return;
        const previous = get().providerSelections[providerId];
        const normalized = previous ? normalizePersonalFmSelection(previous, catalog) : null;
        const providerSelections = normalized ? { ...get().providerSelections, [providerId]: normalized } : get().providerSelections;
        set({ catalogs: { ...get().catalogs, [providerId]: catalog }, providerSelections });
        if (normalized) persist(PROVIDERS_KEY, providerSelections);
    },
}));
export const getPersonalFmSelection = (providerId?: string): PersonalFmSelection => (
    providerId ? selectProviderPersonalFm(usePersonalFmModeStore.getState(), providerId) : usePersonalFmModeStore.getState().selection
);
export const getPersonalFmRequestOptions = (providerId?: string): PersonalFmRequestOptions => toPersonalFmRequestOptions(getPersonalFmSelection(providerId));
