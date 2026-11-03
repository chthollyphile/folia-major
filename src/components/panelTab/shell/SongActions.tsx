import React from 'react';
import { Crosshair, Home as HomeIcon, Settings, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { usePlayingFromCollection } from '../../app/playing-song-locator/usePlayingFromCollection';
import { openAddToPlaylist, useAddToPlaylistStore } from '../../../stores/useAddToPlaylistStore';
import { Tooltip } from '../../modal/settings/kit/Tooltip';
import { LikeButton, type SongLike } from './LikeButton';
import { PanelIconButton } from './PanelIconButton';

// src/components/panelTab/shell/SongActions.tsx
// The row under the song's title on the cover tab, always in view: like, add to a playlist, the
// collection the queue is playing from, and at the right the way home and the options.

type SongActionsProps = {
    like: SongLike;
    /** Finds the playing song on its collection's page. */
    onLocatePlayingSong: () => void;
    onNavigateHome: () => void;
    onOpenSettings?: () => void;
};

const SongActions: React.FC<SongActionsProps> = ({ like, onLocatePlayingSong, onNavigateHome, onOpenSettings }) => {
    const { t } = useTranslation();
    // Answered by AddToPlaylistHost, which owns the picker now: the same question is asked by a
    // command that can fire with this panel closed, so it cannot be derived from panel props.
    const addToPlaylist = useAddToPlaylistStore(state => state.availability);
    // The collection the queue was started from, for as long as the queue is still of its songs.
    const playingFrom = usePlayingFromCollection();
    const playingFromLabel = playingFrom ? t('ui.playingFrom', { name: playingFrom.name }) : '';

    return (
        <div className="mt-3.5 flex items-center gap-1.5">
            <LikeButton like={like} filled />
            {addToPlaylist.isApplicable && (
                <PanelIconButton
                    label={addToPlaylist.disabledReason || t('localMusic.addToPlaylist')}
                    filled
                    disabled={!addToPlaylist.canAdd}
                    onClick={openAddToPlaylist}
                >
                    <Star size={17} />
                </PanelIconButton>
            )}
            {/* 这首歌所在的歌单或专辑，点一下回到那一页并找到它的卡片。队列不再是那张歌单的歌时不出现。 */}
            {playingFrom && (
                <Tooltip text={playingFromLabel} className="flex min-w-0">
                    <button
                        type="button"
                        data-panel-locate
                        onClick={onLocatePlayingSong}
                        aria-label={playingFromLabel}
                        className="st-t-fast flex h-8 min-w-0 items-center gap-1.5 rounded-full bg-[var(--st-fill)] pl-2.5 pr-3 text-xs text-[color:var(--st-t2)] transition-colors hover:bg-[var(--st-fill2)] hover:text-[color:var(--st-t1)]"
                    >
                        <Crosshair size={14} className="shrink-0" />
                        <span className="truncate">{playingFrom.name}</span>
                    </button>
                </Tooltip>
            )}
            <span className="min-w-1.5 flex-1" />
            <PanelIconButton label={t('ui.backToHome')} onClick={onNavigateHome}>
                <HomeIcon size={17} />
            </PanelIconButton>
            {onOpenSettings && (
                <PanelIconButton label={t('ui.options')} onClick={onOpenSettings}>
                    <Settings size={17} />
                </PanelIconButton>
            )}
        </div>
    );
};

export default SongActions;
