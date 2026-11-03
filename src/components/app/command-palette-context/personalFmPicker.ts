import { useOnlineProviderAccountStore } from '../../../stores/useOnlineProviderAccountStore';
import { getPersonalFmSelection, selectActiveStation, selectStationCatalog, usePersonalFmModeStore } from '../../../stores/usePersonalFmModeStore';
import { usePlaybackStore } from '../../../stores/usePlaybackStore';

// src/components/app/command-palette-context/personalFmPicker.ts
// What the command palette's FM mode picker offers right now: the modes and the choice of the extra radio on
// air if FM plays one, the Personal FM's own otherwise.

export const personalFmPickerContext = () => {
    const providerId = useOnlineProviderAccountStore.getState().activeProviderId;
    const modes = usePersonalFmModeStore.getState();
    const station = usePlaybackStore.getState().isFmMode ? selectActiveStation(modes, providerId) : null;
    return station
        ? { personalFmSelection: station.selection, personalFmCatalog: selectStationCatalog(modes, providerId, station.id) }
        : { personalFmSelection: getPersonalFmSelection(providerId), personalFmCatalog: modes.catalogs[providerId] };
};
