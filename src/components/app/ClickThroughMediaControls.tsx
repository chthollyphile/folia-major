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
    const buttonClass = `flex h-full w-7 items-center justify-center rounded-lg transition-colors duration-200 ${
        isDaylight ? 'hover:bg-black/[0.05] hover:text-zinc-900' : 'hover:bg-white/10 hover:text-white'
    }`;
    const playPauseLabel = isPlaying ? t('remote.pause') : t('remote.play');

    if (!hasSong) return null;

    return (
        <div
            // Three 28px buttons plus two 1px gaps preserve the existing 86px unlock hotspot.
            className={`flex h-7 items-center gap-px transition-all duration-200 ${
                shown
                    ? 'click-through-interactive pointer-events-auto opacity-100 translate-y-0'
                    : 'pointer-events-none opacity-0 -translate-y-1'
            } ${
                isDaylight
                    ? 'text-zinc-800'
                    : 'text-white/75'
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
