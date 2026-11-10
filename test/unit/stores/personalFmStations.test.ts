// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    captureActiveStations,
    getStationRequestOptions,
    restoreActiveStations,
    selectActiveStation,
    selectFmRun,
    selectStationCatalog,
    usePersonalFmModeStore,
} from '../../../src/stores/usePersonalFmModeStore';
import { DEFAULT_PERSONAL_FM_CATALOG, DEFAULT_PERSONAL_FM_SELECTION, toPersonalFmRequestOptions } from '../../../src/services/onlineMusic/fmModes';
import type { PersonalFmCatalog } from '../../../src/types/personalFm';

// test/unit/stores/personalFmStations.test.ts
// A provider's extra radio ("station") keeps its mode choice in memory only: the stored Personal FM
// settings, their keys and the platforms that have no station stay exactly as they were.

const stationCatalog: PersonalFmCatalog = {
    modes: DEFAULT_PERSONAL_FM_CATALOG.modes.filter(entry => entry.id === 'DEFAULT' || entry.id === 'SCENE_RCMD'),
    categories: [{ id: 'g', labelKey: '', labelFallback: 'Group' }],
    scenes: [
        { id: '7', category: 'g', labelKey: '', labelFallback: 'Seven', keywords: [] },
        { id: '8', category: 'g', labelKey: '', labelFallback: 'Eight', keywords: [] },
    ],
};
const scene7 = { mode: 'SCENE_RCMD' as const, scene: '7' };
const SELECTION_KEY = 'folia.personalFm.selection';
const PROVIDERS_KEY = 'folia.personalFm.providerSelections';

beforeEach(() => {
    localStorage.clear();
    usePersonalFmModeStore.setState({ catalogs: {}, providerSelections: {}, stations: {}, stationCatalogs: {}, fmRuns: {} });
});

describe('station memory', () => {
    it('has no station on air until one starts, and asks for no station options', () => {
        const state = usePersonalFmModeStore.getState();
        expect(selectActiveStation(state, 'p')).toBeNull();
        expect(getStationRequestOptions('p')).toBeUndefined();
    });

    it('starts a station with the selection it was given and hands it on as request options', () => {
        usePersonalFmModeStore.getState().setStationCatalog('p', 'radio', stationCatalog);
        const applied = usePersonalFmModeStore.getState().startStation('p', 'radio', scene7);
        expect(applied).toEqual(scene7);
        expect(selectActiveStation(usePersonalFmModeStore.getState(), 'p')).toEqual({ id: 'radio', selection: scene7 });
        expect(getStationRequestOptions('p')).toEqual({ station: 'radio', mode: 'SCENE_RCMD', submode: '7' });
    });

    it('drops a scene the station catalogue does not have', () => {
        usePersonalFmModeStore.getState().setStationCatalog('p', 'radio', stationCatalog);
        const applied = usePersonalFmModeStore.getState().startStation('p', 'radio', { mode: 'SCENE_RCMD', scene: 'gone' });
        expect(applied).toEqual(DEFAULT_PERSONAL_FM_SELECTION);
    });

    it('changes the choice of the station on air and forgets it when another station or none starts', () => {
        const store = usePersonalFmModeStore.getState();
        store.setStationCatalog('p', 'radio', stationCatalog);
        store.startStation('p', 'radio', scene7);
        expect(store.setStationSelection('p', { mode: 'SCENE_RCMD', scene: '8' })).toEqual({ mode: 'SCENE_RCMD', scene: '8' });
        store.startStation('p', 'other', DEFAULT_PERSONAL_FM_SELECTION);
        expect(selectActiveStation(usePersonalFmModeStore.getState(), 'p')?.selection).toEqual(DEFAULT_PERSONAL_FM_SELECTION);
        store.startStation('p', 'radio', DEFAULT_PERSONAL_FM_SELECTION);
        expect(selectActiveStation(usePersonalFmModeStore.getState(), 'p')?.selection).toEqual(DEFAULT_PERSONAL_FM_SELECTION);
        store.endStation('p');
        expect(selectActiveStation(usePersonalFmModeStore.getState(), 'p')).toBeNull();
        expect(getStationRequestOptions('p')).toBeUndefined();
    });

    it('ignores a choice for a station that is not on air', () => {
        const store = usePersonalFmModeStore.getState();
        store.setStationCatalog('p', 'radio', stationCatalog);
        expect(store.setStationSelection('p', scene7)).toEqual(DEFAULT_PERSONAL_FM_SELECTION);
        expect(selectActiveStation(usePersonalFmModeStore.getState(), 'p')).toBeNull();
    });

    it('keeps each platform on its own', () => {
        const store = usePersonalFmModeStore.getState();
        store.setStationCatalog('p', 'radio', stationCatalog);
        store.startStation('p', 'radio', scene7);
        expect(selectActiveStation(usePersonalFmModeStore.getState(), 'q')).toBeNull();
        expect(selectStationCatalog(usePersonalFmModeStore.getState(), 'q', 'radio')).toBeUndefined();
        expect(selectStationCatalog(usePersonalFmModeStore.getState(), 'p', 'radio')).toBe(stationCatalog);
    });

    it('re-reads the station on air when its catalogue changes', () => {
        const store = usePersonalFmModeStore.getState();
        store.setStationCatalog('p', 'radio', stationCatalog);
        store.startStation('p', 'radio', scene7);
        store.setStationCatalog('p', 'radio', { ...stationCatalog, scenes: [stationCatalog.scenes[1]] });
        expect(selectActiveStation(usePersonalFmModeStore.getState(), 'p')?.selection).toEqual(DEFAULT_PERSONAL_FM_SELECTION);
    });
});

describe('what stays stored', () => {
    it('writes nothing for a station, and leaves the Personal FM settings alone', () => {
        const store = usePersonalFmModeStore.getState();
        store.setSelection({ mode: 'EXPLORE', scene: null });
        const before = [localStorage.getItem(SELECTION_KEY), localStorage.getItem(PROVIDERS_KEY)];
        store.setStationCatalog('p', 'radio', stationCatalog);
        store.startStation('p', 'radio', scene7);
        store.setStationSelection('p', { mode: 'SCENE_RCMD', scene: '8' });
        store.endStation('p');
        expect([localStorage.getItem(SELECTION_KEY), localStorage.getItem(PROVIDERS_KEY)]).toEqual(before);
        const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
        expect(keys.filter(key => key?.startsWith('folia.personalFm'))).toEqual([SELECTION_KEY]);
    });

    it('leaves the request options of a platform without a station as they were', () => {
        expect(toPersonalFmRequestOptions({ mode: 'EXPLORE', scene: null })).toEqual({ mode: 'EXPLORE', submode: null });
        expect(toPersonalFmRequestOptions(scene7, 'radio')).toEqual({ mode: 'SCENE_RCMD', submode: '7', station: 'radio' });
    });
});

describe('window handoff', () => {
    it('carries which radio is on air, not the mode chosen in it', () => {
        const store = usePersonalFmModeStore.getState();
        expect(captureActiveStations('p')).toBeUndefined();
        store.setStationCatalog('p', 'radio', stationCatalog);
        store.startStation('p', 'radio', scene7);
        // Only the platform whose FM queue is on air: a radio left over on another one stays behind.
        store.startStation('q', 'stale', DEFAULT_PERSONAL_FM_SELECTION);
        expect(captureActiveStations(null)).toBeUndefined();
        const carried = JSON.parse(JSON.stringify(captureActiveStations('p')));
        expect(carried).toEqual({ p: 'radio' });

        // The new window starts with an empty memory.
        usePersonalFmModeStore.setState({ stations: {}, stationCatalogs: {} });
        restoreActiveStations(carried);
        expect(selectActiveStation(usePersonalFmModeStore.getState(), 'p')).toEqual({ id: 'radio', selection: DEFAULT_PERSONAL_FM_SELECTION });
        expect(getStationRequestOptions('p')).toEqual({ station: 'radio', mode: 'DEFAULT', submode: null });
    });

    it.each([undefined, null, [], 'radio', { p: 3 }, { p: '' }])('restores nothing from %j', (stations) => {
        restoreActiveStations(stations);
        expect(usePersonalFmModeStore.getState().stations).toEqual({});
    });
});

describe('stream runs and the end of FM', () => {
    it('counts every stream a card puts on air, a station or the Personal FM', () => {
        const store = usePersonalFmModeStore.getState();
        expect(selectFmRun(usePersonalFmModeStore.getState(), 'p')).toBe(0);
        store.startStation('p', 'radio', DEFAULT_PERSONAL_FM_SELECTION);
        store.endStation('p');
        store.endStation('p');
        expect(selectFmRun(usePersonalFmModeStore.getState(), 'p')).toBe(3);
        expect(selectFmRun(usePersonalFmModeStore.getState(), 'q')).toBe(0);
    });

    it('puts the mode of a radio back to the default when FM ends, and keeps which radio it is', () => {
        const store = usePersonalFmModeStore.getState();
        store.setStationCatalog('p', 'radio', stationCatalog);
        store.startStation('p', 'radio', scene7);
        store.resetStationSelections();
        expect(selectActiveStation(usePersonalFmModeStore.getState(), 'p')).toEqual({ id: 'radio', selection: DEFAULT_PERSONAL_FM_SELECTION });
        const before = usePersonalFmModeStore.getState().stations;
        store.resetStationSelections();
        expect(usePersonalFmModeStore.getState().stations).toBe(before);
    });
});
