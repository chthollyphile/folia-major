import { useEffect } from 'react';
import { omni } from '../services/onlineMusic/omni';
import { selectStationCatalog, usePersonalFmModeStore } from '../stores/usePersonalFmModeStore';

// Load a provider's own FM choices once per mount; the adapter owns its network cache.
export function usePersonalFmCatalog(providerId: string) {
    const catalog = usePersonalFmModeStore(state => state.catalogs[providerId]);
    useEffect(() => {
        let current = true;
        void omni.getPersonalFmCatalog(providerId).then(value => {
            if (current) usePersonalFmModeStore.getState().setCatalog(providerId, value);
        }).catch(error => console.warn('[PersonalFm] Mode catalogue could not be read', error));
        return () => { current = false; };
    }, [providerId]);
    return catalog;
}

/** The mode choices of the extra radio on air, loaded once per radio; undefined while none is on air or it is still loading. */
export function usePersonalFmStationCatalog(providerId: string, station: string | null) {
    const catalog = usePersonalFmModeStore(state => (station ? selectStationCatalog(state, providerId, station) : undefined));
    useEffect(() => {
        if (!station) return undefined;
        let current = true;
        void omni.getPersonalFmStationCatalog(providerId, station).then(value => {
            if (current && value) usePersonalFmModeStore.getState().setStationCatalog(providerId, station, value);
        }).catch(error => console.warn('[PersonalFm] Station mode catalogue could not be read', error));
        return () => { current = false; };
    }, [providerId, station]);
    return catalog;
}
