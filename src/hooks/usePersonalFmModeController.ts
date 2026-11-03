import { useCallback, useMemo, useRef } from 'react';
import type React from 'react';
import { omni } from '../services/onlineMusic/omni';
import {
    getPersonalFmSelectionLabel,
    isSamePersonalFmSelection,
    toPersonalFmRequestOptions,
    type PersonalFmSelection,
} from '../services/onlineMusic/fmModes';
import { usePersonalFmModeStore, selectProviderPersonalFm } from '../stores/usePersonalFmModeStore';
import { usePersonalFmCatalog } from './usePersonalFmCatalog';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { wholeQueueWritesSoFar } from '../services/wholeQueueWrites';
import { queueStartsSoFar } from '../components/app/playback/start/queueStarts';
import type { SongResult, StatusMessage } from '../types';
import { setStatusMessage as setStatusMsg } from '../stores/useStatusMessageStore';

// src/hooks/usePersonalFmModeController.ts
// Owns "apply a Personal FM mode": persist it, and when FM is on air jump straight to the first
// track of the new mode, the way the official client does — the mode change is meant to be heard.

type UsePersonalFmModeControllerParams = {
    isFmMode: boolean;
    currentSong: SongResult | null;
    playSong: (song: SongResult, queue?: SongResult[], isFmCall?: boolean) => void | Promise<void>;
    t: (key: string, fallback?: string) => string;
};

export function usePersonalFmModeController({
    isFmMode,
    currentSong,
    playSong,
    t,
}: UsePersonalFmModeControllerParams) {
    const activeProviderId = useOnlineProviderAccountStore(state => state.activeProviderId);
    const catalog = usePersonalFmCatalog(activeProviderId);
    const personalFmSelection = usePersonalFmModeStore(state => selectProviderPersonalFm(state, activeProviderId));
    const setSelection = usePersonalFmModeStore(state => state.setProviderSelection);
    const request = useRef(0);
    /** The selection stored before the switches still on their way: one that brings nothing puts it back. */
    const selectionBeforePending = useRef<{ providerId: string; selection: PersonalFmSelection } | null>(null);

    const isPersonalFmModeSupported = useMemo(() => {
        try {
            return Boolean(catalog && omni.getProviderCapabilities(activeProviderId).personalFmModes);
        } catch (error) {
            void error;
            return false;
        }
    }, [activeProviderId, catalog]);

    const setPersonalFmSelection = useCallback(async (selection: PersonalFmSelection) => {
        // From before the oldest switch still on its way: one this overtakes never played its mode either.
        const pending = selectionBeforePending.current;
        const previous = pending?.providerId === activeProviderId ? pending.selection : personalFmSelection;
        selectionBeforePending.current = null;
        const applied = setSelection(activeProviderId, selection);
        const label = getPersonalFmSelectionLabel(applied, t, catalog);
        const mine = ++request.current;
        // The same FM stream is still on air when the batch comes: nothing started a queue of its own or
        // replaced the queue whole meanwhile. The queue itself is not asked: the next song landing, an add
        // or a library refresh write it anew while the same stream plays on, and the switch is still meant.
        const queueStartsAtStart = queueStartsSoFar();
        const queueWritesAtStart = wholeQueueWritesSoFar();
        const stillCurrent = () => mine === request.current
            && useOnlineProviderAccountStore.getState().activeProviderId === activeProviderId
            && usePlaybackStore.getState().isFmMode
            && queueStartsSoFar() === queueStartsAtStart
            && wholeQueueWritesSoFar() === queueWritesAtStart;

        const source = currentSong ? getPlaybackSourceRef(currentSong) : null;
        if (!isFmMode || !currentSong || source?.kind !== 'online' || source.providerId !== activeProviderId) {
            // Cutting off an album or playlist the user chose deliberately would be worse than
            // waiting: the mode takes effect the next time Personal FM starts.
            setStatusMsg({ type: 'info', text: `${t('personalFmMode.statusPending', 'Personal FM mode')}: ${label}` });
            return;
        }

        if (isSamePersonalFmSelection(applied, previous)) {
            return;
        }

        selectionBeforePending.current = { providerId: activeProviderId, selection: previous };
        // The newest switch has its answer, whatever it is: nothing is on its way any more.
        const settle = () => {
            if (mine === request.current) selectionBeforePending.current = null;
        };
        // Only this switch's own choice is taken back: a home card clicked meanwhile has stored its own,
        // which stands.
        const putBack = () => {
            if (isSamePersonalFmSelection(selectProviderPersonalFm(usePersonalFmModeStore.getState(), activeProviderId), applied)) {
                setSelection(activeProviderId, previous);
            }
        };

        try {
            const songs = await omni.getPersonalFm(toPersonalFmRequestOptions(applied));
            settle();
            if (!stillCurrent()) return;
            if (songs.length === 0) {
                putBack();
                setStatusMsg({ type: 'error', text: t('personalFmMode.statusEmpty', 'This Personal FM mode returned nothing') });
                return;
            }

            // Announced before handing over, because playSong clears any non-persistent status of
            // its own as it starts.
            setStatusMsg({ type: 'info', text: `${t('personalFmMode.statusApplied', 'Personal FM switched to')} ${label}` });
            // The whole queue is replaced and playback jumps to the head: a new mode means a new
            // stream, so keeping the old one's leftovers around would only muddy it.
            await playSong(songs[0], songs, true);
        } catch (error) {
            // A newer request or another queue that took over meanwhile has its own outcome, which stands. So
            // does the new mode once playSong took its first song: that play counted as a start of its own.
            settle();
            if (!stillCurrent()) {
                console.error('[PersonalFm] Mode request failed after it was overtaken', error);
                return;
            }
            putBack();
            console.error('[PersonalFm] Failed to refresh queue for mode', error);
            setStatusMsg({ type: 'error', text: t('personalFmMode.statusFailed', 'Failed to switch the Personal FM mode') });
        }
    }, [activeProviderId, catalog, currentSong, isFmMode, personalFmSelection, playSong, setSelection, t]);

    const personalFmSelectionLabel = useMemo(
        () => getPersonalFmSelectionLabel(personalFmSelection, t, catalog),
        [catalog, personalFmSelection, t],
    );

    return { personalFmSelection, personalFmSelectionLabel, isPersonalFmModeSupported, setPersonalFmSelection };
}
