import { useEffect } from 'react';
import { omni } from '../services/onlineMusic/omni';
import { usePersonalFmModeStore } from '../stores/usePersonalFmModeStore';

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
