import { create } from 'zustand';
import { DEFAULT_PERSONAL_FM_SELECTION, DEFAULT_PERSONAL_FM_CATALOG, isDefaultPersonalFmSelection, normalizePersonalFmSelection, toPersonalFmRequestOptions } from '../services/onlineMusic/fmModes';
import type { PersonalFmCatalog, PersonalFmSelection } from '../types/personalFm';
import type { PersonalFmRequestOptions } from '../types/onlineMusic';
import { getStoredString, setStoredString } from './storagePrimitives';

// src/stores/usePersonalFmModeStore.ts
// The one place that holds the current Personal FM mode. Providers read it straight from here,
// so the home card, radio grid and queue refill all stay on the selected mode.
// Keep the published legacy setting intact; providers with their own catalogue keep separate choices.
// A provider's extra radio (a "station") is held below in memory only: its mode choice is not stored,
// so a restart, a switch to another radio or the end of FM all leave it at the default.
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
/** The extra radio on air for one provider, and the mode chosen in it. */
export type ActivePersonalFmStation = { id: string; selection: PersonalFmSelection };
type PersonalFmModeState = {
    selection: PersonalFmSelection;
    providerSelections: Record<string, PersonalFmSelection>;
    catalogs: Record<string, PersonalFmCatalog>;
    /** Memory only. Read while FM is on air: the card of a station sets it, the Personal FM card clears it. */
    stations: Record<string, ActivePersonalFmStation>;
    stationCatalogs: Record<string, Record<string, PersonalFmCatalog>>;
    /**
     * Memory only. Counts, per provider, the streams a card put on air (a station or the Personal FM): a mode
     * switch still on its way from an earlier stream is not put back over a later one.
     */
    fmRuns: Record<string, number>;
    startStation(providerId: string, station: string, selection: PersonalFmSelection): PersonalFmSelection;
    endStation(providerId: string): void;
    /** FM went off air: the radios keep who they are (an undo may put their queue back), their modes go back to the default. */
    resetStationSelections(): void;
    setStationSelection(providerId: string, selection: PersonalFmSelection): PersonalFmSelection;
    setStationCatalog(providerId: string, station: string, catalog: PersonalFmCatalog): void;
    setSelection(selection: PersonalFmSelection): PersonalFmSelection;
    setProviderSelection(providerId: string, selection: PersonalFmSelection): PersonalFmSelection;
    setCatalog(providerId: string, catalog: PersonalFmCatalog): void;
};
export const selectProviderPersonalFm = (state: PersonalFmModeState, providerId: string): PersonalFmSelection => (
    state.catalogs[providerId] === DEFAULT_PERSONAL_FM_CATALOG ? state.selection
        : state.providerSelections[providerId] ?? DEFAULT_PERSONAL_FM_SELECTION
);
export const selectActiveStation = (state: PersonalFmModeState, providerId: string): ActivePersonalFmStation | null => state.stations[providerId] ?? null;
export const selectStationCatalog = (state: PersonalFmModeState, providerId: string, station: string): PersonalFmCatalog | undefined => (
    state.stationCatalogs[providerId]?.[station]
);
export const selectFmRun = (state: PersonalFmModeState, providerId: string): number => state.fmRuns[providerId] ?? 0;
export const usePersonalFmModeStore = create<PersonalFmModeState>((set, get) => ({
    selection: readLegacy(), providerSelections: readProviders(), catalogs: {}, stations: {}, stationCatalogs: {}, fmRuns: {},
    startStation(providerId, station, selection) {
        // A station that starts, again or after another, starts from the choice it comes with.
        const normalized = normalizePersonalFmSelection(selection, selectStationCatalog(get(), providerId, station));
        set({
            stations: { ...get().stations, [providerId]: { id: station, selection: normalized } },
            fmRuns: { ...get().fmRuns, [providerId]: selectFmRun(get(), providerId) + 1 },
        });
        return normalized;
    },
    endStation(providerId) {
        // The Personal FM itself went on air: a new stream, whether or not a station was on before.
        const { [providerId]: ended, ...stations } = get().stations;
        void ended;
        set({ stations, fmRuns: { ...get().fmRuns, [providerId]: selectFmRun(get(), providerId) + 1 } });
    },
    resetStationSelections() {
        const entries = Object.entries(get().stations);
        if (entries.every(([, station]) => isDefaultPersonalFmSelection(station.selection))) return;
        set({ stations: Object.fromEntries(entries.map(([providerId, station]) => [providerId, { id: station.id, selection: DEFAULT_PERSONAL_FM_SELECTION }])) });
    },
    setStationSelection(providerId, selection) {
        const active = get().stations[providerId];
        if (!active) return DEFAULT_PERSONAL_FM_SELECTION;
        const normalized = normalizePersonalFmSelection(selection, selectStationCatalog(get(), providerId, active.id));
        set({ stations: { ...get().stations, [providerId]: { id: active.id, selection: normalized } } });
        return normalized;
    },
    setStationCatalog(providerId, station, catalog) {
        const known = get().stationCatalogs[providerId];
        if (known?.[station] === catalog) return;
        const active = get().stations[providerId];
        const stations = active?.id === station
            ? { ...get().stations, [providerId]: { id: station, selection: normalizePersonalFmSelection(active.selection, catalog) } }
            : get().stations;
        set({ stationCatalogs: { ...get().stationCatalogs, [providerId]: { ...known, [station]: catalog } }, stations });
    },
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
/**
 * The request options of the extra radio on air for the provider, or undefined when it has none (every
 * platform without a station): the top-up of a running FM passes them, so its next batch is the radio's.
 */
export const getStationRequestOptions = (providerId: string): PersonalFmRequestOptions | undefined => {
    const active = selectActiveStation(usePersonalFmModeStore.getState(), providerId);
    return active ? toPersonalFmRequestOptions(active.selection, active.id) : undefined;
};
/** The extra radio the FM queue on air came from, for a window handoff; undefined when it is the Personal FM. */
export const captureActiveStations = (providerId: string | null | undefined): Record<string, string> | undefined => {
    const station = providerId ? selectActiveStation(usePersonalFmModeStore.getState(), providerId) : null;
    return station && providerId ? { [providerId]: station.id } : undefined;
};
/** Puts handed-over radios back on air at their default mode: only which radio the queue came from travels. */
export const restoreActiveStations = (stations: unknown): void => {
    if (!stations || typeof stations !== 'object' || Array.isArray(stations)) return;
    for (const [providerId, station] of Object.entries(stations)) {
        if (typeof station === 'string' && station && providerId.length < 100) {
            usePersonalFmModeStore.getState().startStation(providerId, station, DEFAULT_PERSONAL_FM_SELECTION);
        }
    }
};
export const getPersonalFmRequestOptions = (providerId?: string): PersonalFmRequestOptions => toPersonalFmRequestOptions(getPersonalFmSelection(providerId));
