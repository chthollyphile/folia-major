import { useEffect, useMemo, useRef } from 'react';
import { selectDisplaySong, selectIsShowingTail, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { lyricCurrentTime } from '../../../../stores/motionSignals';
import { readLyricOffset } from '../../../../utils/lyrics/lyricOffsetMemory';

// src/components/app/playback/bridges/useLyricReadHead.ts
// The lyric read-head across a song change: restores the displayed song's remembered offset, resets the
// clock to the top of that song unless a blend handed it over, and gives the incoming track's offset
// the visualizer bridge reads its clock against during a blend.

/**
 * Runs the read-head reset for the displayed song and returns the live song's lyric offset (per-song
 * plus device), which during a blend is the incoming track's.
 */
export function useLyricReadHead(globalLyricTimelineOffsetMs: number): number {
    const displaySongId = usePlaybackStore(state => selectDisplaySong(state)?.id);
    const liveSongId = usePlaybackStore(state => state.currentSong?.id);
    const isShowingTail = usePlaybackStore(selectIsShowingTail);
    const lyricTimelineOffsetMs = usePlaybackStore(state => state.lyricTimelineOffsetMs);
    const setLyricTimelineOffsetMs = usePlaybackStore(state => state.setLyricTimelineOffsetMs);

    // The live song's, which during a blend is the incoming one: the visualizer bridge reads that
    // track's lyric clock against it, so the read-head runs on unchanged once the settle makes it the
    // displayed song (the effect that restores the displayed song's offset). Recomputed when an offset
    // is edited, since the memory it reads has no subscription.
    const incomingLyricTimelineOffsetMs = useMemo(
        () => readLyricOffset(liveSongId) + globalLyricTimelineOffsetMs,
        // eslint-disable-next-line react-hooks/exhaustive-deps -- lyricTimelineOffsetMs: re-read after an edit
        [liveSongId, globalLyricTimelineOffsetMs, lyricTimelineOffsetMs],
    );

    // Restore the displayed song's remembered manual offset (0 when never adjusted, so a fresh
    // song behaves exactly like the old reset). Keyed on the DISPLAYED song, not the playing one:
    // this is what the lyrics on screen are read against, and firing it when a blend arms would
    // both mis-offset the outgoing lyrics and snap their read-head to zero - a lyric view that
    // scrolls back to the top of a song it is still showing, which reads as an early song change.
    // currentSongFullRef.current holds the live song for App's offset change handler, so a user's
    // correction is still saved against the track the app has actually committed to.
    //
    // There must be exactly ONE of these. Upstream grew its own copy keyed on `currentSong`, the
    // merge kept both, and the live-keyed one fired on every blend ARM - snapping the read-head to
    // the top of the song still on screen, which the diorama reads as a loop restart and answers
    // with a full camera flight that lands back where it started. That is the "it changes song,
    // then changes song again" report.
    //
    // A blend that hands over is the one song change that keeps the read-head where it is: the visualizer
    // bridge has already moved it onto the incoming track, read against that track's own offset (the
    // hand-off), and the track is seconds in. Set back to the top here, the lyrics on screen would
    // start that song again for a frame - a line that jumps, and Monet, which reads a clock going
    // back to zero as a loop, replaying its intro over a blend that had already handed over.
    // Only a hand-over: a blend cancelled or dropped for a skip mid-blend ends on a song whose clock
    // the bridge did not carry over, and that song starts from the top like any other.
    const wasShowingTailRef = useRef(isShowingTail);
    useEffect(() => {
        const nextOffsetMs = readLyricOffset(displaySongId);
        setLyricTimelineOffsetMs(nextOffsetMs);
        const handedOver = wasShowingTailRef.current
            && !isShowingTail
            && usePlaybackStore.getState().transitionEnd === 'handedOver';
        // The top of the whole song, which is where a full song's deck starts. A preview clip that
        // starts inside its song, or a deck restored at a saved position, is not known here: the deck
        // may still hold the previous song's source. The visualizer bridge moves the read-head onto the
        // deck's real position: on each frame while it plays, and when it loads or seeks while paused.
        if (!handedOver) lyricCurrentTime.set(-(nextOffsetMs + globalLyricTimelineOffsetMs) / 1000);
        // Exactly ONE of these per song change, including across an automix blend. Two inside one
        // transition means the duplicate effect described above is back: the second one fires on
        // the arm, resets the read-head under the song still on screen, and the diorama answers it
        // with a camera flight that lands where it started.
        console.log(
            `[Lyrics] read-head reset for the DISPLAYED song ${String(displaySongId ?? 'none')}`
            + ` (per-song ${nextOffsetMs}ms + device ${globalLyricTimelineOffsetMs}ms)`
            + `${handedOver ? ', kept running: handed over by the blend' : ''}`,
        );
        // globalLyricTimelineOffsetMs is intentionally not a dependency: it is a device-level constant
        // the user tunes in Lab settings, and re-running this effect on it would fight the panel value.
        // isShowingTail neither: the song change is what this answers, and the hold only says how.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [displaySongId]);
    // After the effect above, so that one reads whether the picture was held before this commit.
    useEffect(() => {
        wasShowingTailRef.current = isShowingTail;
    }, [isShowingTail]);

    return incomingLyricTimelineOffsetMs;
}
