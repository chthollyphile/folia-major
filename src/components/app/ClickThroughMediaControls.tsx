import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { PlayerState } from '../../types';
import { selectDisplayPlayerState, usePlaybackStore } from '../../stores/usePlaybackStore';
import type { TransportButtonAction } from './playback/bridges/useTransportCommandRefs';

// Previous / play-pause / next beside the click-through lock (#471). While click-through is on the
// window controls are hidden and the player can't be clicked, so these come up with the lock when
// the cursor reaches its hotspot (`clickThroughUnlockHotspot.ts` covers them too).

type ClickThroughMediaControlsProps = {
    visible: boolean;
    isDaylight: boolean;
    onAction: (action: TransportButtonAction) => void;
};

const ClickThroughMediaControls: React.FC<ClickThroughMediaControlsProps> = ({ visible, isDaylight, onAction }) => {
    const { t } = useTranslation();
    // The same check runTransportButtonAction makes, so the buttons never show while presses do nothing.
    const hasSong = usePlaybackStore(state => Boolean(state.currentSong));
    const isPlaying = usePlaybackStore(selectDisplayPlayerState) === PlayerState.PLAYING;
    const shown = visible && hasSong;
    const buttonClass = `flex h-full w-7 items-center justify-center rounded-full transition-colors duration-150 ${
        isDaylight ? 'hover:bg-black/[0.07] hover:text-zinc-900' : 'hover:bg-white/15 hover:text-white'
    }`;
    const playPauseLabel = isPlaying ? t('remote.pause') : t('remote.play');

    return (
        <div
            className={`flex h-7 items-center rounded-full border shadow-[0_8px_24px_rgba(0,0,0,0.28)] backdrop-blur-md transition-all duration-200 ${
                shown
                    ? 'click-through-interactive pointer-events-auto opacity-100 translate-y-0'
                    : 'pointer-events-none opacity-0 -translate-y-1'
            } ${
                isDaylight
                    ? 'border-black/[0.06] bg-white/80 text-zinc-700'
                    : 'border-white/15 bg-black/55 text-white/85'
            }`}
        >
            <button
                type="button"
                className={buttonClass}
                tabIndex={shown ? 0 : -1}
                title={t('remote.previous')}
                aria-label={t('remote.previous')}
                onClick={() => onAction('previous')}
            >
                <SkipBack size={13} />
            </button>
            <button
                type="button"
                className={buttonClass}
                tabIndex={shown ? 0 : -1}
                title={playPauseLabel}
                aria-label={playPauseLabel}
                onClick={() => onAction('play-pause')}
            >
                {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            </button>
            <button
                type="button"
                className={buttonClass}
                tabIndex={shown ? 0 : -1}
                title={t('remote.next')}
                aria-label={t('remote.next')}
                onClick={() => onAction('next')}
            >
                <SkipForward size={13} />
            </button>
        </div>
    );
};

export default ClickThroughMediaControls;
