import { useCallback, useMemo, useRef } from 'react';
import type React from 'react';
import { omni } from '../services/onlineMusic/omni';
import {
    getPersonalFmSelectionLabel,
    getPersonalFmStatusText,
    isSamePersonalFmSelection,
    normalizePersonalFmSelection,
    toPersonalFmRequestOptions,
    type PersonalFmSelection,
} from '../services/onlineMusic/fmModes';
import { usePersonalFmModeStore, selectActiveStation, selectFmRun, selectProviderPersonalFm } from '../stores/usePersonalFmModeStore';
import { usePersonalFmCatalog, usePersonalFmStationCatalog } from './usePersonalFmCatalog';
import { getPlaybackSourceRef } from '../utils/appPlaybackGuards';
import { useOnlineProviderAccountStore } from '../stores/useOnlineProviderAccountStore';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { wholeQueueWritesSoFar } from '../services/wholeQueueWrites';
import { queueStartsSoFar } from '../components/app/playback/start/queueStarts';
import { registerPersonalFmLanding } from '../components/app/playback/start/personalFmLanding';
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
    const providerCatalog = usePersonalFmCatalog(activeProviderId);
    // The extra radio on air, if FM plays one: the picker then offers its modes and its choice, kept in memory only.
    const station = usePersonalFmModeStore(state => (isFmMode ? selectActiveStation(state, activeProviderId) : null));
    const stationCatalog = usePersonalFmStationCatalog(activeProviderId, station?.id ?? null);
    const catalog = station ? stationCatalog : providerCatalog;
    const providerSelection = usePersonalFmModeStore(state => selectProviderPersonalFm(state, activeProviderId));
    const personalFmSelection = station ? station.selection : providerSelection;
    const setSelection = useCallback((providerId: string, selection: PersonalFmSelection) => (
        station
            ? usePersonalFmModeStore.getState().setStationSelection(providerId, selection)
            : usePersonalFmModeStore.getState().setProviderSelection(providerId, selection)
    ), [station]);
    // What is chosen now, in the radio on air or in the Personal FM.
    const chosenNow = () => {
        const state = usePersonalFmModeStore.getState();
        return station ? selectActiveStation(state, activeProviderId)?.selection : selectProviderPersonalFm(state, activeProviderId);
    };
    const request = useRef(0);
    /**
     * The selection stored before the switches still on their way: one that brings nothing puts it back. Only
     * within the same stream (`run`): a card that put another radio, or the Personal FM, on air meanwhile has
     * a choice of its own, which an earlier stream's must not overwrite.
     */
    const selectionBeforePending = useRef<{ providerId: string; run: number; selection: PersonalFmSelection } | null>(null);

    const isPersonalFmModeSupported = useMemo(() => {
        try {
            // A radio's catalogue is the provider's offer of modes for it, so it needs no capability flag.
            if (station) return Boolean(stationCatalog);
            return Boolean(catalog && omni.getProviderCapabilities(activeProviderId).personalFmModes);
        } catch (error) {
            void error;
            return false;
        }
    }, [activeProviderId, catalog, station, stationCatalog]);

    const setPersonalFmSelection = useCallback(async (selection: PersonalFmSelection) => {
        // From before the oldest switch still on its way: one this overtakes never played its mode either.
        const pending = selectionBeforePending.current;
        const run = selectFmRun(usePersonalFmModeStore.getState(), activeProviderId);
        const previous = pending?.providerId === activeProviderId && pending.run === run ? pending.selection : personalFmSelection;
        selectionBeforePending.current = null;
        const applied = station ? normalizePersonalFmSelection(selection, catalog ?? undefined) : setSelection(activeProviderId, selection);
        const label = getPersonalFmSelectionLabel(applied, t, catalog);
        // A radio on air is named in its status lines, as in the picker's title; the Personal FM keeps its own words.
        const statusOf = (kind: 'applied' | 'empty' | 'failed'): string => (station
            ? getPersonalFmStatusText(kind, catalog)
            : kind === 'applied' ? t('personalFmMode.statusApplied', 'Personal FM switched to')
                : kind === 'empty' ? t('personalFmMode.statusEmpty', 'This Personal FM mode returned nothing')
                    : t('personalFmMode.statusFailed', 'Failed to switch the Personal FM mode'));
        const mine = ++request.current;
        // The same FM stream is still on air when the batch comes: nothing started a queue of its own or
        // replaced the queue whole meanwhile. The queue itself is not asked: the next song landing, an add
        // or a library refresh write it anew while the same stream plays on, and the switch is still meant.
        const queueStartsAtStart = queueStartsSoFar();
        const queueWritesAtStart = wholeQueueWritesSoFar();
        const stillCurrent = () => mine === request.current
            && useOnlineProviderAccountStore.getState().activeProviderId === activeProviderId
            && usePlaybackStore.getState().isFmMode
            && (selectActiveStation(usePersonalFmModeStore.getState(), activeProviderId)?.id ?? null) === (station?.id ?? null)
            && selectFmRun(usePersonalFmModeStore.getState(), activeProviderId) === run
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

        selectionBeforePending.current = { providerId: activeProviderId, run, selection: previous };
        // The newest switch has its answer, whatever it is: nothing is on its way any more.
        const settle = () => {
            if (mine === request.current) selectionBeforePending.current = null;
        };
        // Only this switch's own choice is taken back: a home card clicked meanwhile has stored its own,
        // which stands.
        const putBack = () => {
            if (station) return;
            const now = chosenNow();
            if (now && isSamePersonalFmSelection(now, applied)) {
                setSelection(activeProviderId, previous);
            }
        };

        try {
            const songs = await omni.getPersonalFm(toPersonalFmRequestOptions(applied, station?.id));
            settle();
            if (!stillCurrent()) return;
            if (songs.length === 0) {
                putBack();
                setStatusMsg({ type: 'error', text: statusOf('empty') });
                return;
            }

            // Announced before handing over, because playSong clears any non-persistent status of
            // its own as it starts.
            if (!station) setStatusMsg({ type: 'info', text: `${statusOf('applied')} ${label}` });
            // The whole queue is replaced and playback jumps to the head: a new mode means a new
            // stream, so keeping the old one's leftovers around would only muddy it.
            if (station) registerPersonalFmLanding(songs, () => {
                const state = usePersonalFmModeStore.getState();
                if (mine === request.current
                    && useOnlineProviderAccountStore.getState().activeProviderId === activeProviderId
                    && usePlaybackStore.getState().isFmMode
                    && selectActiveStation(state, activeProviderId)?.id === station.id
                    && selectFmRun(state, activeProviderId) === run) {
                    state.setStationSelection(activeProviderId, applied);
                    setStatusMsg({ type: 'info', text: `${statusOf('applied')} ${label}` });
                }
            });
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
            setStatusMsg({ type: 'error', text: statusOf('failed') });
        }
    }, [activeProviderId, catalog, currentSong, isFmMode, personalFmSelection, playSong, setSelection, station, t]);

    const personalFmSelectionLabel = useMemo(
        () => getPersonalFmSelectionLabel(personalFmSelection, t, catalog),
        [catalog, personalFmSelection, t],
    );

    return { personalFmSelection, personalFmSelectionLabel, isPersonalFmModeSupported, setPersonalFmSelection, personalFmStation: station?.id ?? null };
}
