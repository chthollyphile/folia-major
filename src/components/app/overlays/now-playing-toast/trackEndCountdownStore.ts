import { create } from 'zustand';

// src/components/app/overlays/now-playing-toast/trackEndCountdownStore.ts
// Whether the now playing card is previewing the queue's next track at a plain track end (a blend
// announces its own, see App's blendNextUpTrack). Kept outside App: the answer flips twice a
// track, and as App state each flip re-rendered the whole app for a value only the card reads.

/** How many seconds before a track ends the now playing card previews the queue's next track. */
const NEXT_UP_LEAD_SEC = 5;

type TrackEndCountdownInput = {
    /** Something can show the preview and there is a track to preview. */
    enabled: boolean;
    /** Length of the track on screen, in seconds. */
    duration: number;
    /** Where the playback clock is, in seconds. */
    time: number;
};

/** True during the last NEXT_UP_LEAD_SEC seconds of the track on screen, while `enabled`. */
export const isInTrackEndCountdown = ({ enabled, duration, time }: TrackEndCountdownInput): boolean => enabled
    && Number.isFinite(duration)
    && duration > 0
    && duration - time > 0
    && duration - time <= NEXT_UP_LEAD_SEC;

/** Written by TrackEndCountdownHost, read by AppOverlays. */
export const useTrackEndCountdownStore = create<{
    active: boolean;
    setActive: (active: boolean) => void;
}>((set) => ({
    active: false,
    // Returning the state it was given tells zustand nothing changed: no subscriber is called.
    setActive: (active) => set(state => (state.active === active ? state : { active })),
}));

type NextUpCard = { nextUp?: unknown; isNextUp?: boolean };

/**
 * The card's props with the track-end countdown added.
 *
 * The overlay model marks `isNextUp` for a blend only. While the countdown runs and there is a
 * track to preview the card previews it as well; otherwise the props come back as they were given,
 * the same object, so a card that takes them stays as it was.
 */
export const withTrackEndCountdown = <T extends NextUpCard>(card: T | null | undefined, countdownActive: boolean): T | null | undefined => (
    card && countdownActive && card.nextUp != null && card.isNextUp !== true
        ? { ...card, isNextUp: true }
        : card
);
