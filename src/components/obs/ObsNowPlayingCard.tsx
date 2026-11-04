import React from 'react';
import NowPlayingToast, { type NowPlayingToastSong } from '../app/overlays/NowPlayingToast';
import type { Theme } from '../../types';
import type { ObsNowPlayingCardConfig } from '../../utils/obsNowPlayingCard';

// src/components/obs/ObsNowPlayingCard.tsx
// The main window's now playing card inside an OBS browser source: same card, fed the mode,
// timeout and position the source was handed, since the source cannot read the main window's
// settings. Display only - nothing in OBS clicks it.

type ObsNowPlayingCardProps = {
    card: ObsNowPlayingCardConfig | null | undefined;
    song: NowPlayingToastSong | null;
    /** Restarts the auto-hide timer on a song change, as trackKey does in the main window. */
    trackKey: string;
    isDaylight: boolean;
    theme?: Theme;
};

const ObsNowPlayingCard: React.FC<ObsNowPlayingCardProps> = ({ card, song, trackKey, isDaylight, theme }) => {
    if (!card || !song) return null;
    return (
        <NowPlayingToast
            song={song}
            trackKey={trackKey}
            isDaylight={isDaylight}
            mode={card.mode}
            timeoutSec={card.timeoutSec}
            position={card.position}
            theme={theme}
        />
    );
};

export default ObsNowPlayingCard;
