import React from 'react';
import { ChevronDown, Pause, Play, Radio, SkipBack, SkipForward, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PlayerState } from '../../types';
import { omni } from '../../services/onlineMusic/omni';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { Tooltip } from '../modal/settings/kit';
import { IconSwap } from './shell/IconSwap';
import { LikeButton } from './shell/LikeButton';
import { PanelButton } from './shell/PanelButton';
import { PanelIconButton } from './shell/PanelIconButton';

// src/components/panelTab/FmTab.tsx
// The panel's radio tab, shown in place of the queue while a personal FM plays: the mode the radio
// is in, and under it one line with its controls: 删除 / 不喜欢 at the left, previous, play or pause
// and next in the middle, the heart at the right.

interface FmTabProps {
    playerState: PlayerState;
    modeLabel: string;
    /** Absent when the active provider has no FM modes, which hides the entry entirely. */
    onOpenModePicker?: () => void;
    onTogglePlay: () => void;
    onNextTrack: () => void;
    onPrevTrack: () => void;
    onTrash: () => void;
    /** provider 没有「不喜欢」时置灰（QQ、波点）。 */
    trashDisabled?: boolean;
    onLike: () => void;
    isLiked: boolean;
    likeDisabled?: boolean;
    likeDisabledReason?: string;
}

const FmTab: React.FC<FmTabProps> = ({
    playerState,
    modeLabel,
    onOpenModePicker,
    onTogglePlay,
    onNextTrack,
    onPrevTrack,
    onTrash,
    trashDisabled = false,
    onLike,
    isLiked,
    likeDisabled = false,
    likeDisabledReason,
}) => {
    const { t } = useTranslation();
    // A song of a provider that has no like at all (`capabilities.likes`) gets no heart here: greyed
    // out it could never be pressed. Any other reason to grey the heart out passes, and it stays.
    const hasLike = usePlaybackStore(state => !state.currentSong
        || getPlaybackSourceRef(state.currentSong).kind !== 'online'
        || omni.canLikeSong(state.currentSong));
    const isPlaying = playerState === PlayerState.PLAYING;
    const playLabel = isPlaying ? t('player.pause') : t('player.play');

    return (
        <div className="flex flex-col items-center gap-3.5 px-1 pb-1.5 pt-2.5">
            {/* Opens the command palette's FM mode picker: the same surface the palette offers, so
                the mode lives in one place instead of being reimplemented inside the panel. */}
            {onOpenModePicker && (
                <Tooltip text={t('personalFmMode.openPicker', 'Switch the Personal FM mode')} className="inline-flex max-w-full">
                    <PanelButton icon={Radio} onClick={onOpenModePicker}>
                        {modeLabel}
                        <ChevronDown size={13} className="text-[color:var(--st-t2)]" />
                    </PanelButton>
                </Tooltip>
            )}

            {/* Three columns, so play stays in the middle of the line when there is no heart. */}
            <div className="grid w-full grid-cols-[1fr_auto_1fr] items-center">
                <PanelIconButton size="l" label={t('ui.trashDislike')} onClick={onTrash} disabled={trashDisabled} className="justify-self-start">
                    <Trash2 size={19} />
                </PanelIconButton>

                <div className="flex items-center gap-3">
                    {/* Previous (Disabled by default typically for FM, but requested) */}
                    <PanelIconButton size="l" label={t('ui.previousTrack')} onClick={onPrevTrack} className="opacity-50">
                        <SkipBack size={20} />
                    </PanelIconButton>
                    <Tooltip text={playLabel} className="inline-flex shrink-0">
                        <button
                            type="button"
                            aria-label={playLabel}
                            onClick={onTogglePlay}
                            className="st-t-fast grid h-[52px] w-[52px] place-items-center rounded-full bg-[var(--st-accent)] text-[color:var(--st-on-accent)] transition-[opacity,scale] hover:opacity-90 active:scale-[0.96]"
                        >
                            <IconSwap name={isPlaying ? 'pause' : 'play'}>
                                {isPlaying
                                    ? <Pause size={22} fill="currentColor" />
                                    : <Play size={22} fill="currentColor" className="ml-0.5" />}
                            </IconSwap>
                        </button>
                    </Tooltip>
                    <PanelIconButton size="l" label={t('ui.nextTrack')} onClick={onNextTrack}>
                        <SkipForward size={20} />
                    </PanelIconButton>
                </div>

                {hasLike && (
                    <LikeButton
                        size="l"
                        like={{ isLiked, onLike, disabled: likeDisabled, disabledReason: likeDisabledReason }}
                        className="justify-self-end"
                    />
                )}
            </div>
        </div>
    );
};

export default FmTab;
