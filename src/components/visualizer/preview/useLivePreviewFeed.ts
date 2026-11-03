import { useEffect, useMemo, useSyncExternalStore, type RefObject } from 'react';
import { audioBands, audioPower, currentTime, lyricCurrentTime } from '../../../stores/motionSignals';
import {
    selectDisplayCoverUrl,
    selectDisplayDuration,
    selectDisplayLyrics,
    selectDisplaySong,
    usePlaybackStore,
} from '../../../stores/usePlaybackStore';
import { createLivePreviewFeed, type LivePreviewContent, type LivePreviewSource } from './livePreviewFeed';
import { observeMounts } from './stillClockPulse';

// src/components/visualizer/preview/useLivePreviewFeed.ts
// The live source of a lyric preview, bound to the player's stores: the song, lyrics, cover and
// transport are the held picture the player itself draws (the usePlaybackStore display selectors),
// the lyric clock and the audio levels its motion signals. Local playback and every stage source
// write the same ones, so one feed covers them.

export const readLivePreviewContent = (state = usePlaybackStore.getState()): LivePreviewContent | null => {
    const lines = selectDisplayLyrics(state)?.lines;
    if (!lines || lines.length === 0) return null;
    const song = selectDisplaySong(state);
    const duration = selectDisplayDuration(state);
    return {
        lines,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        songTitle: song?.name,
        coverUrl: selectDisplayCoverUrl(state),
        currentLineIndex: state.currentLineIndex,
        seed: `live-preview-${song?.id ?? 'none'}`,
    };
};

const playerSource: LivePreviewSource = {
    read: () => readLivePreviewContent(),
    subscribe: listener => usePlaybackStore.subscribe(() => listener()),
    signals: { currentTime: lyricCurrentTime, audioPower, audioBands },
    playbackTime: currentTime,
};

type UseLivePreviewFeedOptions = {
    /** The preview shows the live source. Off, nothing here subscribes to anything. */
    enabled: boolean;
    /** Hold the picture of this moment; on again, go back to what the player shows now. */
    paused: boolean;
    /** The box the preview is drawn in, watched for styles being mounted in it. */
    stageRef: RefObject<HTMLElement | null>;
};

export const useLivePreviewFeed = ({ enabled, paused, stageRef }: UseLivePreviewFeedOptions) => {
    const feed = useMemo(() => createLivePreviewFeed(playerSource), []);
    const content = useSyncExternalStore(feed.subscribe, feed.getContent);

    useEffect(() => (enabled ? feed.attach(!paused) : undefined), [enabled, paused, feed]);
    useEffect(() => {
        if (!enabled) feed.clear();
    }, [enabled, feed]);

    // A style is lazy and mounts when its code has arrived, however late; when the time stands still,
    // a held picture or a player that is itself paused, what is mounted into the box is the cue to stir it.
    useEffect(() => {
        const stage = stageRef.current;
        return enabled && stage ? observeMounts(stage, feed.nudge, feed.pulsing) : undefined;
    }, [enabled, feed, stageRef]);

    return {
        content: enabled ? content : null,
        currentTime: feed.currentTime,
        playbackTime: feed.playbackTime,
        audioPower: feed.audioPower,
        audioBands: feed.audioBands,
    };
};

export type LivePreview = ReturnType<typeof useLivePreviewFeed>;
