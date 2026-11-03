import { useMemo } from 'react';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import type { LyricProviderSource } from '../types';
import { LYRIC_SOURCES } from '../utils/lyrics/lyricSources';
import { omni } from '../services/onlineMusic/omni';

// src/hooks/useLyricMatchSources.ts
// The lyric sources on offer now: the tabs of the match dialogs and the choices of the priority
// setting. A source that needs an account comes and goes with that account's sign-in.
export const useLyricMatchSources = (): LyricProviderSource[] => {
    const signedIn = useOnlineProviderAccountStore(state => (
        LYRIC_SOURCES.filter(source => source.needsAccount && state.accounts[source.id]?.user).map(source => source.id).join()
    ));
    const configured = omni.getProviderSummaries().filter(provider => provider.availability.configured).map(provider => provider.providerId).join();
    return useMemo(() => {
        const ready = signedIn.split(',');
        const available = configured.split(',');
        return LYRIC_SOURCES.filter(source => (!source.needsAccount || ready.includes(source.id))
            && (!source.needsConfiguredProvider || available.includes(source.id))).map(source => source.id);
    }, [signedIn, configured]);
};
