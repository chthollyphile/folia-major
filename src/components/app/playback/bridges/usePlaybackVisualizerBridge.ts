import { useCallback, useEffect, useRef } from 'react';
import { backendPlayback, usesPlaybackBackend } from '../../../../services/playbackBackend/controller';
import type { MutableRefObject } from 'react';
import type { MotionValue } from 'framer-motion';
import { findLatestActiveLineIndex } from '../../../../utils/appPlaybackHelpers';
import { PlayerState } from '../../../../types';
import type { AudioBands, LyricData } from '../../../../types';
import { setCurrentLineIndex, setHandoffLineIndex, setPlayerState } from '../../../../stores/usePlaybackStore';
import { selectDisplayLyrics, usePlaybackStore } from '../../../../stores/usePlaybackStore';
import {
    audioBands,
    audioPower,
    currentTime,
    handoffLyricCurrentTime,
    handoffProgress,
    lyricCurrentTime,
} from '../../../../stores/motionSignals';
import { getTransitionHandoffProgress } from '../../../../services/automix/transitionCue';
import { omni } from '../../../../services/onlineMusic/omni';
import { tickBeatFx } from '../../../../services/beatFx/beatFxLive';
import { useBeatFxTrack } from '../../../../hooks/useBeatFxTrack';
import { readIncomingLyricClock } from './incomingLyricClock';
import { isBackgroundLyricHeld, setHeldLyricTime, useBackgroundLyricHoldStore } from '../../backgroundThrottling/backgroundLyricHoldStore';

// src/components/app/playback/bridges/usePlaybackVisualizerBridge.ts

/**
 * How often the loop runs while 后台节流 holds the lyric animation. Only the clocks are kept then (the
 * progress bar, stage end, mods' playback time), and a timer keeps them going in a hidden window,
 * where frames stop.
 */
const HELD_TICK_MS = 250;

type UsePlaybackVisualizerBridgeParams = {

    audioRef: MutableRefObject<HTMLAudioElement | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    animationFrameRef: MutableRefObject<number>;
    effectiveLoopMode: 'off' | 'all' | 'one';
    isNowPlayingStageActive: boolean;
    isPlayerCapStageActive: boolean;
    stageActiveEntryKind: string | null;
    stageLyricsSession: unknown;
    stageLyricsClockRef: MutableRefObject<{
        startTimeSec: number;
        endTimeSec: number;
        baseTimeSec: number;
        startedAtMs: number | null;
    }>;
    getSyntheticStageLyricsTime: () => number;
    syncStageLyricsClock: (timeSec: number, endTimeSec: number, nextPlayerState: PlayerState, startTimeSec?: number) => void;
    getNowPlayingDisplayTime: () => number;
    getPlayerCapDisplayTime: () => number;
    syncNowPlayingClock: (progressSec: number, durationSec: number, paused: boolean) => void;
    lyricTimelineOffsetMs: number;
    /**
     * The incoming track's own lyric offset during a blend (`lyricTimelineOffsetMs` is the displayed
     * track's): its clock is read against it, so it runs on unchanged when the settle makes it the
     * displayed track's. Left out, the displayed track's.
     */
    incomingLyricTimelineOffsetMs?: number;
    /** True while an automix handover is in progress and a deck other than the active one sounds. */
    isTransitionAudible: () => boolean;
    /**
     * The deck the on-screen track is playing on while a transition holds the picture, else null.
     *
     * The clock below has to follow whatever is on screen. From the moment a blend arms, the
     * active deck is seconds into the NEXT track while the title, cover and lyrics still belong to
     * the one finishing - so reading the active deck here puts the progress bar and the lyric
     * read-head near zero under a song that is three minutes in.
     */
    getDisplayElement?: () => HTMLAudioElement | null;
};

// Runs the requestAnimationFrame loop for audio-reactive visuals and lyric timing.
export function usePlaybackVisualizerBridge({
    audioRef,
    analyserRef,
    animationFrameRef,
    effectiveLoopMode,
    isNowPlayingStageActive,
    isPlayerCapStageActive,
    stageActiveEntryKind,
    stageLyricsSession,
    stageLyricsClockRef,
    getSyntheticStageLyricsTime,
    syncStageLyricsClock,
    getNowPlayingDisplayTime,
    getPlayerCapDisplayTime,
    syncNowPlayingClock,
    lyricTimelineOffsetMs,
    incomingLyricTimelineOffsetMs = lyricTimelineOffsetMs,
    isTransitionAudible,
    getDisplayElement,
}: UsePlaybackVisualizerBridgeParams) {
    // Read here rather than passed in: store fields and the module-level motion signals.
    const activePlaybackContext = usePlaybackStore(state => state.activePlaybackContext);
    const playerState = usePlaybackStore(state => state.playerState);
    const duration = usePlaybackStore(state => state.duration);
    // The lyrics on screen, matching the deck getDisplayElement points at.
    const lyrics = usePlaybackStore(selectDisplayLyrics);
    // The live lyrics, which during a blend are the incoming track's (null until they load).
    const incomingLyrics = usePlaybackStore(state => state.lyrics);

    const currentLineIndexRef = useRef(-1);
    // 智能动感模式: loads the track's beats while it is on; the clock is stepped below. A ref, so
    // switching it does not rebuild the frame loop.
    const beatFxWantedRef = useRef(false);
    beatFxWantedRef.current = useBeatFxTrack();
    const handoffLineIndexRef = useRef(-1);
    // The lyric offsets as the loop reads them. The settle moves the displayed one onto the incoming
    // track's as it copies that track's clock: the prop catches up a render later, and a frame read in
    // between against the outgoing track's offset would move the line by the difference.
    const displayOffsetMsRef = useRef(lyricTimelineOffsetMs);
    const incomingOffsetMsRef = useRef(incomingLyricTimelineOffsetMs);
    useEffect(() => {
        displayOffsetMsRef.current = lyricTimelineOffsetMs;
    }, [lyricTimelineOffsetMs]);
    useEffect(() => {
        incomingOffsetMsRef.current = incomingLyricTimelineOffsetMs;
    }, [incomingLyricTimelineOffsetMs]);

    // A preview clip may start somewhere inside its song: the read-head is the deck's own clock plus
    // that start. Cached per URL until the registry changes, since the frame loop asks every frame.
    const clipStartSecRef = useRef(new Map<string, number>());
    const clipStartVersionRef = useRef(-1);
    const lyricClipStartSec = useCallback((element: HTMLAudioElement | null | undefined): number => {
        const src = element?.currentSrc;
        if (!src) return 0;
        const version = omni.audioSourceMetadataVersion();
        if (clipStartVersionRef.current !== version) {
            clipStartSecRef.current.clear();
            clipStartVersionRef.current = version;
        }
        const known = clipStartSecRef.current.get(src);
        if (known !== undefined) return known;
        const seconds = omni.previewClipStartMsOfAudioSource(src) / 1000;
        const starts = clipStartSecRef.current;
        starts.set(src, seconds);
        if (starts.size > 8) {
            const oldest = starts.keys().next().value;
            if (oldest !== undefined) starts.delete(oldest);
        }
        return seconds;
    }, []);

    // The ends of a blend, written as the store changes rather than on the next frame: the visualizer
    // renders from that same change, and a frame late it would draw the incoming track's lyrics from
    // the outgoing track's clock and line (or the last blend's finished hand-off at the next one's start).
    useEffect(() => usePlaybackStore.subscribe((state, previous) => {
        if (state.transitionDisplay === previous.transitionDisplay) return;
        if (previous.transitionDisplay === null) {
            handoffProgress.set(0);
            handoffLineIndexRef.current = -1;
            setHandoffLineIndex(-1);
            return;
        }
        if (state.transitionDisplay !== null) return;
        // Handed over: the picture is now the incoming track, and its clock runs on from its own deck.
        // Only the session knows which way the blend went. A cancel keeps the outgoing deck's clock, and
        // a skip mid-blend loads some other track onto the deck that was incoming, so both are left to
        // the ordinary song change. Read from the deck here rather than from the frame loop's last
        // hand-off: that loop does not run while the window is hidden.
        // The hand-off itself is left where it stood: what plays along it (the background change, the
        // Monet cover) lets go of it at a settle or a cancel and plays the rest from there on the clock,
        // and a set here would snap it to the end first.
        const incoming = audioRef.current;
        if (state.transitionEnd !== 'handedOver' || !incoming) return;
        const clock = readIncomingLyricClock(
            incoming.currentTime + lyricClipStartSec(incoming),
            incomingOffsetMsRef.current,
            state.lyrics?.lines,
        );
        displayOffsetMsRef.current = incomingOffsetMsRef.current;
        currentTime.set(incoming.currentTime);
        lyricCurrentTime.set(clock.lyricTimeSec);
        currentLineIndexRef.current = clock.lineIndex;
        setCurrentLineIndex(clock.lineIndex);
    }), [audioRef, lyricClipStartSec]);

    // The frame loop moves the read-head only while the deck plays. A deck that loads or seeks while
    // paused - a restored session, above all a restored preview clip, which starts somewhere inside
    // its song - would leave it where the song change put it (useLyricReadHead: the top of the whole
    // song), while the remote window and OBS, which read the deck's position, show the line it is
    // really at; pressing play would then jump the main read-head forward on its first frame. So the
    // read-head is also set from those two events, and a paused deck costs nothing per frame.
    // Listened for on the document in the capture phase (media events do not bubble, but they are
    // captured), so the listener follows whichever deck is active without re-binding at a deck swap.
    // Only the main player's own clock: a stage or PlayerCap clock is written by its own branch below.
    const pausedDeckSyncRef = useRef({ ownsClock: false, lyrics });
    pausedDeckSyncRef.current = {
        ownsClock: activePlaybackContext === 'main' && !isNowPlayingStageActive && !isPlayerCapStageActive,
        lyrics,
    };
    useEffect(() => {
        if (typeof document === 'undefined') return undefined;
        const syncPausedDeck = (event: Event) => {
            const element = audioRef.current;
            if (!element || event.target !== element || !element.paused) return;
            const { ownsClock, lyrics: displayedLyrics } = pausedDeckSyncRef.current;
            // While a blend holds the picture this deck is the incoming track, not the one on screen.
            if (!ownsClock || getDisplayElement?.()) return;
            const clock = readIncomingLyricClock(
                element.currentTime + lyricClipStartSec(element),
                displayOffsetMsRef.current,
                displayedLyrics?.lines,
            );
            lyricCurrentTime.set(clock.lyricTimeSec);
            if (displayedLyrics && clock.lineIndex !== currentLineIndexRef.current) {
                currentLineIndexRef.current = clock.lineIndex;
                setCurrentLineIndex(clock.lineIndex);
            }
        };
        document.addEventListener('loadedmetadata', syncPausedDeck, true);
        document.addEventListener('seeked', syncPausedDeck, true);
        return () => {
            document.removeEventListener('loadedmetadata', syncPausedDeck, true);
            document.removeEventListener('seeked', syncPausedDeck, true);
        };
    }, [audioRef, getDisplayElement, lyricClipStartSec]);

    const updateLoop = useCallback(() => {
        // 后台节流 holds the lyric animation while the window is minimised or hidden: the clocks below
        // keep running, while the lyric read-head, the line and the audio bands stay where they are
        // until the window is back on screen (the pass that lets go catches them up).
        const backgroundHold = isBackgroundLyricHeld();
        setHeldLyricTime(null);
        const showLyricTime = (seconds: number) => {
            if (backgroundHold) setHeldLyricTime(seconds);
            else lyricCurrentTime.set(seconds);
        };
        const showLine = (index: number) => {
            if (backgroundHold || index === currentLineIndexRef.current) return;
            currentLineIndexRef.current = index;
            setCurrentLineIndex(index);
        };

        // Normally the active deck; the outgoing one for as long as a blend holds the picture on
        // the track it is finishing, so that clock and picture never describe different songs.
        const audioElement = getDisplayElement?.() ?? audioRef.current;
        const isActuallyPlaying = Boolean(audioElement && !audioElement.paused && !audioElement.ended);
        // Mid-handover a deck can be loading while the other one is still sounding. The analyser
        // is downstream of both, so it has real signal: dropping to the idle breath here would put
        // a visible stutter at exactly the moment meant to be seamless.
        const hasAudibleSignal = isActuallyPlaying || isTransitionAudible();

        if (backgroundHold) {
            // The bands keep their last values: nothing draws from them while held.
        } else if (hasAudibleSignal && analyserRef.current) {
            const bufferLength = analyserRef.current.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyserRef.current.getByteFrequencyData(dataArray);
            audioBands.spectrum?.set(dataArray);

            const getEnergy = (minHz: number, maxHz: number): number => {
                const start = Math.floor(minHz / 21.5);
                const end = Math.floor(maxHz / 21.5);
                let sum = 0;
                for (let index = start; index <= end; index += 1) {
                    sum += dataArray[index];
                }
                const count = end - start + 1;
                return count > 0 ? sum / count : 0;
            };

            const bass = getEnergy(20, 150);
            const lowMid = getEnergy(150, 400);
            const mid = getEnergy(400, 1200);
            const vocal = getEnergy(1000, 3500);
            const treble = getEnergy(3500, 12000);

            const process = (value: number, boost = 2) => {
                const normalized = value / 255;
                return Math.pow(normalized, boost) * 255;
            };

            audioPower.set(process((bass + lowMid) / 2, 3));
            audioBands.bass.set(process(bass, 1.8));
            audioBands.lowMid.set(process(lowMid, 2));
            audioBands.mid.set(process(mid, 2));
            audioBands.vocal.set(process(vocal, 1.5));
            audioBands.treble.set(process(treble, 2));
        } else {
            const time = Date.now() / 2000;
            const breath = (Math.sin(time) + 1) * 20;
            audioPower.set(breath);
            audioBands.bass.set(breath);
            audioBands.lowMid.set(breath);
            audioBands.mid.set(breath);
            audioBands.vocal.set(breath);
            audioBands.treble.set(breath);
            audioBands.spectrum?.set(new Uint8Array(0));
        }

        if (usesPlaybackBackend() && activePlaybackContext !== 'stage') {
            const time = backendPlayback.getPosition();
            currentTime.set(time);
            const effectiveLyricTime = time - displayOffsetMsRef.current / 1000;
            showLyricTime(effectiveLyricTime);
            showLine(lyrics ? findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime) : -1);
        } else if (isActuallyPlaying && audioElement) {
            const time = audioElement.currentTime;
            currentTime.set(time);

            const effectiveLyricTime = time + lyricClipStartSec(audioElement) - displayOffsetMsRef.current / 1000;
            showLyricTime(effectiveLyricTime);

            if (lyrics) {
                showLine(findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime));
            }
        } else if (isNowPlayingStageActive) {
            const nextTime = getNowPlayingDisplayTime();
            const hasReachedEnd = playerState === PlayerState.PLAYING && duration > 0 && nextTime >= duration;

            currentTime.set(nextTime);

            const effectiveLyricTime = nextTime - displayOffsetMsRef.current / 1000;
            showLyricTime(effectiveLyricTime);
            showLine(lyrics ? findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime) : -1);

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncNowPlayingClock(0, duration, false);
                    currentTime.set(0);
                    if (lyrics) {
                        showLine(findLatestActiveLineIndex(lyrics.lines, 0));
                    }
                } else {
                    syncNowPlayingClock(duration, duration, true);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        } else if (isPlayerCapStageActive) {
            // PlayerCap: clock extrapolated from progress×duration; a passive source, looping/ending is driven by the external player, so no end/loop handling here.
            const nextTime = getPlayerCapDisplayTime();
            currentTime.set(nextTime);

            const effectiveLyricTime = nextTime - displayOffsetMsRef.current / 1000;
            showLyricTime(effectiveLyricTime);
            showLine(lyrics ? findLatestActiveLineIndex(lyrics.lines, effectiveLyricTime) : -1);
        } else if (activePlaybackContext === 'stage' && stageActiveEntryKind === 'lyrics' && stageLyricsSession && lyrics) {
            const nextTime = getSyntheticStageLyricsTime();
            const clock = stageLyricsClockRef.current;
            const hasReachedEnd = playerState === PlayerState.PLAYING && nextTime >= clock.endTimeSec;

            currentTime.set(nextTime);

            showLine(findLatestActiveLineIndex(lyrics.lines, nextTime));

            if (hasReachedEnd) {
                if (effectiveLoopMode === 'one' || effectiveLoopMode === 'all') {
                    syncStageLyricsClock(clock.startTimeSec, clock.endTimeSec, PlayerState.PLAYING, clock.startTimeSec);
                    currentTime.set(clock.startTimeSec);
                    showLine(findLatestActiveLineIndex(lyrics.lines, clock.startTimeSec));
                } else {
                    syncStageLyricsClock(clock.endTimeSec, clock.endTimeSec, PlayerState.PAUSED, clock.startTimeSec);
                    setPlayerState(PlayerState.PAUSED);
                }
            }
        }

        if (beatFxWantedRef.current && !backgroundHold) {
            tickBeatFx(isActuallyPlaying ? audioElement : null, analyserRef.current?.context);
        }

        // While a blend holds the picture, the active deck is the incoming track: its hand-off, clock
        // and line for the visualizer, off this same frame rather than a second loop.
        const heldElement = getDisplayElement?.() ?? null;
        const incomingElement = heldElement ? audioRef.current : null;
        if (!backgroundHold && incomingElement && incomingElement !== heldElement) {
            handoffProgress.set(getTransitionHandoffProgress());
            const incomingClock = readIncomingLyricClock(
                incomingElement.currentTime + lyricClipStartSec(incomingElement),
                incomingOffsetMsRef.current,
                incomingLyrics?.lines,
            );
            handoffLyricCurrentTime.set(incomingClock.lyricTimeSec);
            if (incomingClock.lineIndex !== handoffLineIndexRef.current) {
                handoffLineIndexRef.current = incomingClock.lineIndex;
                setHandoffLineIndex(incomingClock.lineIndex);
            }
        }
    }, [
        activePlaybackContext,
        analyserRef,
        audioBands,
        audioPower,
        audioRef,
        currentTime,
        duration,
        effectiveLoopMode,
        getNowPlayingDisplayTime,
        getPlayerCapDisplayTime,
        getSyntheticStageLyricsTime,
        isNowPlayingStageActive,
        isPlayerCapStageActive,
        lyrics,
        incomingLyrics,
        playerState,
        setCurrentLineIndex,
        setPlayerState,
        stageActiveEntryKind,
        stageLyricsClockRef,
        stageLyricsSession,
        syncNowPlayingClock,
        syncStageLyricsClock,
        lyricCurrentTime,
        lyricClipStartSec,
        isTransitionAudible,
        getDisplayElement,
    ]);

    // Every frame normally; while 后台节流 holds the lyrics, a slow timer that keeps only the clocks. The
    // moment the hold lets go, one pass runs at once, so the lyrics have caught up before anything reads them.
    useEffect(() => {
        let heldTimer: number | undefined;
        const tick = () => {
            updateLoop();
            schedule();
        };
        const schedule = () => {
            if (isBackgroundLyricHeld()) {
                heldTimer = window.setTimeout(tick, HELD_TICK_MS);
            } else {
                animationFrameRef.current = requestAnimationFrame(tick);
            }
        };
        const cancel = () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = 0;
            }
            window.clearTimeout(heldTimer);
        };

        schedule();
        const unsubscribeHold = useBackgroundLyricHoldStore.subscribe((state, previous) => {
            if (state.held === previous.held) return;
            // A song change while held set the line in the store (-1) behind this loop's back; compare
            // against that, or a new song's first line that happens to match the held one is never written.
            if (!state.held) currentLineIndexRef.current = usePlaybackStore.getState().currentLineIndex;
            cancel();
            tick();
        });
        return () => {
            unsubscribeHold();
            cancel();
            setHeldLyricTime(null);
        };
    }, [animationFrameRef, updateLoop]);
}
