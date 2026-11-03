import { createContext, lazy, Suspense, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { MotionValue } from 'framer-motion';
import type { LyricData, SongResult } from '../../../types';
import type { CommandPalettePlaybackContext } from '../../command-palette/types';
import type { PlayerControlSlotContext } from '../../floating-player/playerControlSlotActions';
import { resolveLikeAvailability } from '../../../utils/playerLikeAvailability';
import { canShuffleQueue, resolvePlaybackNeighbors } from '../../../utils/playbackNeighbors';
import { resolveLyricSeekMediaTime } from '../../../utils/lyrics/lyricSeekTime';

// src/components/app/lattice/LatticePlaybackProvider.tsx
// Reuses the main bar's playback actions and keeps its timeline outside transformed cards.
const LyricsTimelineModal = lazy(() => import('../../modal/LyricsTimelineModal'));
export type LatticePlaybackActions = {
    playback: Pick<CommandPalettePlaybackContext, 'prev' | 'next' | 'toggleLoop' | 'shuffleQueue' | 'toggleSongLike' | 'isSongLiked' | 'isFmMode'>;
    loopMode: PlayerControlSlotContext['loopMode'];
    invokeCommandById: PlayerControlSlotContext['invokeCommandById'];
    canInvokeCommandById: PlayerControlSlotContext['canInvokeCommandById'];
    isStageActive?: boolean;
    disabled?: boolean;
};
const PlaybackContext = createContext<PlayerControlSlotContext | null>(null);
export const useLatticePlaybackActions = () => {
    const context = useContext(PlaybackContext);
    if (!context) throw new Error('Lattice playback controls need their provider');
    return context;
};

type Props = {
    actions: LatticePlaybackActions;
    currentSong: SongResult | null;
    queue: SongResult[];
    lyrics: LyricData | null;
    currentTime: MotionValue<number>;
    /** The lyric clock (media time + preview clip start - manual offset): what the timeline's lines are timed on. */
    lyricCurrentTime: MotionValue<number>;
    duration: number;
    /** Seeks the media, in media time. */
    onSeek: (time: number) => void;
    isDaylight: boolean;
    children: ReactNode;
};

export default function LatticePlaybackProvider({ actions, currentSong, queue, lyrics, currentTime, lyricCurrentTime, duration, onSeek, isDaylight, children }: Props) {
    const [timelineOpen, setTimelineOpen] = useState(false);
    // The timeline highlights and seeks on the lyric clock; a click is turned back into media time
    // here (see resolveLyricSeekMediaTime for a line outside a preview clip).
    const seekLyricTime = (lyricTimeSec: number) => {
        const target = resolveLyricSeekMediaTime(lyricTimeSec, {
            mediaTimeSec: currentTime.get(), lyricTimeSec: lyricCurrentTime.get(), durationSec: duration,
        });
        if (target !== null) onSeek(target);
    };
    const context = useMemo<PlayerControlSlotContext>(() => {
        const neighbors = resolvePlaybackNeighbors({ playQueue: queue, currentSong, loopMode: actions.loopMode,
            isFmMode: actions.playback.isFmMode, isStageActive: Boolean(actions.isStageActive) });
        return {
            loopMode: actions.loopMode,
            onToggleLoop: actions.playback.toggleLoop,
            onPrev: actions.playback.prev,
            onNext: actions.playback.next,
            canPrev: neighbors.prev.canGo && !actions.disabled,
            canNext: neighbors.next.canGo && !actions.disabled,
            onShuffle: actions.playback.shuffleQueue,
            canShuffle: canShuffleQueue(queue.length, actions.playback.isFmMode, Boolean(actions.isStageActive)),
            onLike: () => { void actions.playback.toggleSongLike(); },
            isLiked: actions.playback.isSongLiked,
            likeDisabled: resolveLikeAvailability(currentSong, Boolean(actions.disabled), Boolean(actions.isStageActive)).disabled,
            hasLyrics: Boolean(lyrics?.lines.length),
            onToggleTimeline: () => setTimelineOpen(value => !value),
            invokeCommandById: actions.invokeCommandById,
            canInvokeCommandById: actions.canInvokeCommandById,
        };
    }, [actions, currentSong, lyrics, queue]);
    return <PlaybackContext.Provider value={context}>
        {children}
        {timelineOpen && createPortal(<Suspense fallback={null}>
            <LyricsTimelineModal isOpen onClose={() => setTimelineOpen(false)} lyrics={lyrics}
                currentTime={lyricCurrentTime} duration={duration} onSeek={seekLyricTime} isDaylight={isDaylight} disabled={actions.disabled} />
        </Suspense>, document.body)}
    </PlaybackContext.Provider>;
}
