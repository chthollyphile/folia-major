// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { fmModeCommandIdNow, personalFmPickerContext } from '../../../src/components/app/command-palette-context/personalFmPicker';
import { usePersonalFmModeStore } from '../../../src/stores/usePersonalFmModeStore';
import { useOnlineProviderAccountStore } from '../../../src/stores/useOnlineProviderAccountStore';
import { usePlaybackStore } from '../../../src/stores/usePlaybackStore';
import { DEFAULT_PERSONAL_FM_CATALOG } from '../../../src/services/onlineMusic/fmModes';
import type { PersonalFmCatalog } from '../../../src/types/personalFm';

// test/unit/command-palette/fmPickerContext.test.ts
// The picker offers the modes of the extra radio on air while FM plays it, and the Personal FM's own otherwise.

const stationCatalog: PersonalFmCatalog = { modes: DEFAULT_PERSONAL_FM_CATALOG.modes.slice(0, 1), scenes: [], categories: [] };
const providerCatalog: PersonalFmCatalog = { ...DEFAULT_PERSONAL_FM_CATALOG, modes: DEFAULT_PERSONAL_FM_CATALOG.modes.slice(0, 2) };

beforeEach(() => {
    useOnlineProviderAccountStore.setState({ activeProviderId: 'p' });
    usePlaybackStore.setState({ isFmMode: true });
    usePersonalFmModeStore.setState({
        catalogs: { p: providerCatalog },
        providerSelections: { p: { mode: 'EXPLORE', scene: null } },
        stations: { p: { id: 'radio', selection: { mode: 'DEFAULT', scene: null } } },
        stationCatalogs: { p: { radio: stationCatalog } },
    });
});

describe('personalFmPickerContext', () => {
    it('follows the radio on air', () => {
        expect(personalFmPickerContext()).toEqual({ personalFmSelection: { mode: 'DEFAULT', scene: null }, personalFmCatalog: stationCatalog, personalFmStation: 'radio' });
        // The FM tab's button opens the radio's own command.
        expect(fmModeCommandIdNow()).toBe('playback-station-mode');
    });

    it('goes back to the Personal FM when FM is not on air or no radio is', () => {
        usePlaybackStore.setState({ isFmMode: false });
        expect(personalFmPickerContext()).toEqual({ personalFmSelection: { mode: 'EXPLORE', scene: null }, personalFmCatalog: providerCatalog, personalFmStation: null });
        expect(fmModeCommandIdNow()).toBe('playback-fm-mode');
        usePlaybackStore.setState({ isFmMode: true });
        usePersonalFmModeStore.setState({ stations: {} });
        expect(personalFmPickerContext().personalFmCatalog).toBe(providerCatalog);
        expect(fmModeCommandIdNow()).toBe('playback-fm-mode');
    });
});
