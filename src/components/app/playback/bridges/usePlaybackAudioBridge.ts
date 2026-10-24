import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { PlayerState } from '../../../../types';
import type { ReplayGainInfo, ReplayGainMode, SongResult, StatusMessage } from '../../../../types';
import type { LocalSong } from '../../../../types';
import { resolveNavidromePlaybackCarrier } from '../../../../utils/appPlaybackGuards';
import { calculateReplayGain } from '../../../../utils/replayGain';
import { applyAudioEqualizerSettings, planAudioEqualizerApply } from '../../../../services/audioEqualizerGraph';
import { type AudioEffectChain } from '../../../../services/audioEffects/effectChain';
import { buildPlaybackGraph } from '../../../../services/playbackGraph';
import { cachePlayedTrackAssets } from '../../../../services/playedTrackCache';
import { registerPlaybackFadeGraph } from '../../../../services/playbackFade';
import { rampGain, type AutomixDeckChain } from '../../../../services/automix/crossfadeGraph';
import { onTrackProfile } from '../../../../services/automix/profileService';
import { onPlayWrapped } from '../../../../services/volumeBalance/balanceMeter';
import { createBalancePlay } from '../../../../services/volumeBalance/balancePlay';
import { onBalanceRecord } from '../../../../services/volumeBalance/balanceRecords';
import { setStatusMessage as setStatusMsg } from '../../../../stores/useStatusMessageStore';
import { useAudioSettingsStore } from '../../../../stores/useAudioSettingsStore';
import { setPlayerState, setReplayGainAppliedDb, setReplayGainEstimated } from '../../../../stores/usePlaybackStore';
import { useTranslation } from 'react-i18next';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { resolveHeardAudioEqualizerSettings } from '../../../../utils/audioEqualizerModCurve';

// src/components/app/playback/bridges/usePlaybackAudioBridge.ts

type UsePlaybackAudioBridgeParams = {

    audioRef: RefObject<HTMLAudioElement | null>;
    localSongs: LocalSong[];
    isLyricsLoading: boolean;
    shouldAutoPlayRef: MutableRefObject<boolean>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    analyserRef: MutableRefObject<AnalyserNode | null>;
    gainNodeRef: MutableRefObject<GainNode | null>;
    /** Wires both automix decks into the shared mix point. Returns false if a deck is missing. */
    connectDecks: (context: AudioContext, output: AudioNode) => boolean;
    /** The deck the app is currently listening through, for per-track loudness compensation. */
    getActiveChain: () => AutomixDeckChain | null;
    /** Set when a pause interrupted an armed transition; suppresses exactly one autoplay. */
    suppressAutoplayRef: MutableRefObject<boolean>;
    /** True while automix has the next track loaded but its blend is not due to start yet. */
    isAutoplayHeld: boolean;
    syncOutputGain: (targetVolume: number, smoothing?: number) => void;
    getTargetPlaybackVolume: () => number;
    getCoverUrl: () => string | null;
    /** Whether an automix blend can be heard now; a mod's equalizer change waits until it cannot. */
    isTransitionAudible?: () => boolean;
};

/** How often a mod's equalizer change held back for a blend checks whether the blend has ended. */
const DEFERRED_EQUALIZER_POLL_MS = 250;
/** How often 智能平衡 looks again at a playing song: its deck's meter, a blend that ended. */
const BALANCE_POLL_MS = 500;

// Bridges audio element setup, autoplay, replay gain, and media caching.
export function usePlaybackAudioBridge({
    audioRef,
    localSongs,
    isLyricsLoading,
    shouldAutoPlayRef,
    audioContextRef,
    analyserRef,
    gainNodeRef,
    connectDecks,
    getActiveChain,
    suppressAutoplayRef,
    isAutoplayHeld,
    syncOutputGain,
    getTargetPlaybackVolume,
    getCoverUrl,
    isTransitionAudible,
}: UsePlaybackAudioBridgeParams) {
    // Read here rather than passed in: all store fields or i18n.
    const { t } = useTranslation();
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const replayGainMode = usePlaybackStore(state => state.replayGainMode);
    const enableMediaCache = useAudioSettingsStore(state => state.enableMediaCache);

    const previousAudioSrcRef = useRef<string | null>(null);
    const replayGainLogSignatureRef = useRef<string | null>(null);
    const balancePlayRef = useRef<ReturnType<typeof createBalancePlay> | null>(null);
    balancePlayRef.current ??= createBalancePlay();
    const equalizerNodesRef = useRef<BiquadFilterNode[]>([]);
    const effectChainRef = useRef<AudioEffectChain | null>(null);
    const audioEqualizerSettings = useAudioSettingsStore(state => state.audioEqualizerSettings);
    // What is heard: the listener's own settings with a mod's curve over the gains (Folium 1.7). Worked out
    // here rather than in a selector, which would hand useSyncExternalStore a new object on every read.
    const modCurve = useAudioSettingsStore(state => state.audioEqualizerModCurve);
    const modCurveSuspended = useAudioSettingsStore(state => state.audioEqualizerModCurveSuspended);
    const equalizerOrigin = useAudioSettingsStore(state => state.audioEqualizerChangeOrigin);
    const heardEqualizerSettings = useMemo(
        () => resolveHeardAudioEqualizerSettings(audioEqualizerSettings, modCurve, modCurveSuspended),
        [audioEqualizerSettings, modCurve, modCurveSuspended],
    );
    const heardEqualizerSettingsRef = useRef(heardEqualizerSettings);
    const isTransitionAudibleRef = useRef(isTransitionAudible);
    // Read only in the equalizer effect and its timer; written in an effect, not while rendering.
    useEffect(() => {
        isTransitionAudibleRef.current = isTransitionAudible;
    }, [isTransitionAudible]);

    // Recalculates source-specific gain after the audio graph or playback settings become ready.
    const applyReplayGain = useCallback(() => {
        if (!currentSong || !gainNodeRef.current || !audioContextRef.current) return;

        let replayGainInfo: ReplayGainInfo | undefined;
        const localSongId = (currentSong as SongResult & { localRef?: { songId: string } }).localRef?.songId;
        const localData = localSongId ? localSongs.find(song => song.id === localSongId) : undefined;
        if ((currentSong as SongResult & { isLocal?: boolean }).isLocal && localData) {
            replayGainInfo = {
                trackGain: typeof localData.replayGainTrackGain === 'number'
                    ? localData.replayGainTrackGain
                    : localData.replayGain,
                trackPeak: localData.replayGainTrackPeak,
                albumGain: localData.replayGainAlbumGain,
                albumPeak: localData.replayGainAlbumPeak,
            };
        }

        const navidromeSong = resolveNavidromePlaybackCarrier(currentSong);
        const navidromeReplayGain = navidromeSong?.navidromeData.replayGain;
        if (navidromeReplayGain) {
            replayGainInfo = navidromeReplayGain;
        }

        if (currentSong.sourceRef?.kind === 'online') {
            replayGainInfo = currentSong.replayGain;
        }

        try {
            // Onto the deck rather than the shared output: loudness compensation is a per-track
            // value, so during a blend the two decks legitimately need different ones.
            const activeChain = getActiveChain();
            // 智能平衡 decides per play, from what it knows of the song (services/volumeBalance).
            if (replayGainMode === 'auto') {
                const applied = balancePlayRef.current!.apply({
                    song: currentSong,
                    info: replayGainInfo,
                    chain: activeChain,
                    context: audioContextRef.current,
                    transitionAudible: isTransitionAudibleRef.current?.() ?? false,
                });
                // With no deck to take it nothing is applied, and the last song's figure must not stay shown.
                setReplayGainAppliedDb(applied?.gainDb ?? 0);
                setReplayGainEstimated(applied?.estimated ?? false);
                return;
            }
            balancePlayRef.current!.reset();
            setReplayGainEstimated(false);
            const calculation = calculateReplayGain(replayGainInfo, replayGainMode);
            if (activeChain) {
                rampGain(audioContextRef.current, activeChain.replayGain, calculation.linearGain, 0.1);
                setReplayGainAppliedDb(calculation.effectiveGainDb);
            }

            const replayGainLogSignature = JSON.stringify({
                songId: currentSong.id,
                mode: replayGainMode,
                raw: calculation.gainDb,
                effective: calculation.effectiveGainDb,
                peak: calculation.peak ?? null,
            });

            if (replayGainLogSignatureRef.current !== replayGainLogSignature) {
                replayGainLogSignatureRef.current = replayGainLogSignature;
                console.log(`[AudioContext] ReplayGain mode=${replayGainMode} gain=${calculation.effectiveGainDb}dB (raw=${calculation.gainDb}dB, peak=${calculation.peak ?? 'n/a'}, linear=${calculation.linearGain.toFixed(2)})`);
            }
        } catch (error) {
            console.warn('[AudioContext] Failed to apply ReplayGain', error);
        }
    }, [audioContextRef, currentSong, gainNodeRef, getActiveChain, localSongs, replayGainMode]);

    const setupAudioAnalyzer = useCallback(() => {
        // The context is the sentinel, not the source node: a deck that failed to connect must
        // not let this run twice, because createMediaElementSource throws on a second call.
        if (!audioRef.current || audioContextRef.current) return;
        try {
            const AudioContextClass = window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioContextRef.current = ctx;

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.6;
            analyserRef.current = analyser;

            const { gainNode, fadeNode, effectChain, decksConnected } = buildPlaybackGraph({
                context: ctx,
                analyser,
                connectDecks,
                equalizerNodesRef,
                settings: heardEqualizerSettings,
            });
            gainNodeRef.current = gainNode;
            // Hands the transport its own fade node; until this runs (or if setup fails) pause and
            // resume see no graph and fall back to plain element pause/play.
            registerPlaybackFadeGraph({ context: ctx, gain: fadeNode });
            effectChainRef.current = effectChain;
            if (!decksConnected) {
                console.warn('[AudioContext] Deck setup incomplete, automix will stay idle');
            }
            applyReplayGain();
            syncOutputGain(getTargetPlaybackVolume(), 0);
        } catch (error) {
            console.error('Audio Context Setup Failed:', error);
        }
    }, [analyserRef, applyReplayGain, audioContextRef, audioRef, connectDecks, gainNodeRef, getTargetPlaybackVolume, heardEqualizerSettings, syncOutputGain]);

    /**
     * Writes a fully-played track's audio and cover into the media cache.
     *
     * Takes the song and its source explicitly rather than reading `currentSong`/`audioSrc`, because
     * the automix settle path caches the track that just faded OUT - and by then the app's own state
     * already names the track that arrived. `coverUrl` is passed for the currently-displayed track
     * (which may carry a user override); left undefined - the automix path - the cover is taken from
     * the song's own metadata instead.
     *
     * The writes themselves live in `cachePlayedTrackAssets`, which is where the audio and cover
     * conditions are kept apart from each other; this only adds the setting gate, which does not
     * belong in a service.
     */
    const cacheSongAssetsFor = useCallback(async (
        song: SongResult | null,
        src: string | null,
        coverUrl?: string | null,
    ) => {
        if (!enableMediaCache) return;

        await cachePlayedTrackAssets(song, src, coverUrl);
    }, [enableMediaCache]);

    const cacheSongAssets = useCallback(
        () => cacheSongAssetsFor(currentSong, audioSrc, getCoverUrl()),
        [audioSrc, cacheSongAssetsFor, currentSong, getCoverUrl],
    );

    useEffect(() => {
        if (audioRef.current) {
            syncOutputGain(getTargetPlaybackVolume(), 0.015);
        }
    }, [audioRef, getTargetPlaybackVolume, syncOutputGain]);

    useEffect(() => {
        localStorage.setItem('local_replaygain_mode', replayGainMode);
    }, [replayGainMode]);

    useEffect(() => {
        applyReplayGain();
    }, [applyReplayGain]);

    // 智能平衡 looks again when a reading lands - a profile, the song's own record, the deck's meter once it
    // has heard enough - and when a blend ends; the rules decide whether a playing song may still move. A loop
    // come round is a new play, set at once rather than at the next poll.
    useEffect(() => {
        if (replayGainMode !== 'auto') return undefined;
        const offProfile = onTrackProfile(() => applyReplayGain());
        const offRecord = onBalanceRecord(() => applyReplayGain());
        const offWrap = onPlayWrapped(() => applyReplayGain());
        const timer = setInterval(() => applyReplayGain(), BALANCE_POLL_MS);
        return () => {
            offProfile();
            offRecord();
            offWrap();
            clearInterval(timer);
        };
    }, [applyReplayGain, replayGainMode]);

    /*
     * Writes what is heard into the graph. A mod's change waits while an automix blend can be heard and is
     * then applied as it stands by then; any later change re-runs this, which drops the wait and applies at
     * once by its own origin (planAudioEqualizerApply).
     */
    useEffect(() => {
        heardEqualizerSettingsRef.current = heardEqualizerSettings;
        const context = audioContextRef.current;
        if (!context || equalizerNodesRef.current.length === 0) {
            return;
        }
        const plan = planAudioEqualizerApply({
            origin: equalizerOrigin,
            transitionAudible: isTransitionAudibleRef.current?.() ?? false,
        });
        const apply = (settings: typeof heardEqualizerSettings) => {
            applyAudioEqualizerSettings(context, equalizerNodesRef.current, settings, plan.timeConstant);
            effectChainRef.current?.apply(settings.effects, settings.enabled);
        };
        if (!plan.defer) {
            apply(heardEqualizerSettings);
            return;
        }
        const timer = setInterval(() => {
            if (isTransitionAudibleRef.current?.()) {
                return;
            }
            clearInterval(timer);
            apply(heardEqualizerSettingsRef.current);
        }, DEFERRED_EQUALIZER_POLL_MS);
        return () => clearInterval(timer);
    }, [audioContextRef, heardEqualizerSettings, equalizerOrigin]);

    useEffect(() => () => {
        effectChainRef.current?.dispose();
        effectChainRef.current = null;
    }, []);

    useEffect(() => {
        const audioElement = audioRef.current;
        if (!audioElement) {
            previousAudioSrcRef.current = audioSrc;
            return;
        }

        if (audioSrc && previousAudioSrcRef.current && previousAudioSrcRef.current !== audioSrc) {
            audioElement.pause();
            audioElement.load();
        }

        previousAudioSrcRef.current = audioSrc;
    }, [audioRef, audioSrc]);

    useEffect(() => {
        if (audioSrc && audioRef.current) {
            // `audioRef` and `audioSrc` describe the same track almost always - but not while a
            // blend is being armed. Automix repoints the ref at the incoming deck the instant it
            // arms, and `audioSrc` keeps naming the OUTGOING track until playSong has resolved the
            // next URL, which takes an await or two. Playing in that window starts whatever the
            // incoming deck still had loaded from an earlier song AND spends the autoplay intent
            // on it, so when the real source lands there is nothing left to press play with: the
            // deck sits fully buffered at currentTime 0 in silence.
            //
            // The deck's own src attribute is written from `audioSrc`, so an exact match is the
            // whole test. Bail WITHOUT spending the intent - this effect runs again on the commit
            // that gives the deck its real source, and that run is the one meant to start it.
            if (audioRef.current.getAttribute('src') !== audioSrc) return;

            // The deck has already failed on this exact source and something else - the transcode
            // fallback - is off resolving it. play() on an element in error state cannot start
            // anything; it rejects with NotSupportedError. Pressing it here only spends the intent,
            // so when the recovered source lands there is nothing left to start the deck with.
            // Bail WITHOUT spending it, the same way the autoplay hold below does: replacing the
            // source runs this effect again, and that run is the one meant to start it.
            if (audioRef.current.error) return;

            if (shouldAutoPlayRef.current && !isLyricsLoading) {
                // The deck has its source and is buffering, but its blend is not due yet. Bail
                // WITHOUT spending the intent - this effect runs again when the hold lifts, and
                // that run is the one meant to start it.
                //
                // This is what keeps the load out of the blend. Pressing play here instead starts
                // the fade wherever loading happened to finish, which took the same second or two
                // off every transition and capped an eight second plan at three.
                if (isAutoplayHeld) {
                    // The outgoing deck is still sounding. playSong dropped the state to IDLE on
                    // its way past and nothing else puts it back until this deck starts, so left
                    // alone the transport reads "stopped" for the whole lead - and the play button
                    // it offers would start this deck early and take the blend with it.
                    setPlayerState(PlayerState.PLAYING);
                    return;
                }

                shouldAutoPlayRef.current = false;

                // Automix starts the next track seconds early, so a pause can land after the
                // advance is already in flight and too late to recall. Honour the pause instead:
                // without this the listener presses pause and the next song starts anyway.
                if (suppressAutoplayRef.current) {
                    suppressAutoplayRef.current = false;
                    setPlayerState(PlayerState.PAUSED);
                    return;
                }

                syncOutputGain(getTargetPlaybackVolume(), 0);
                const playPromise = audioRef.current.play();
                if (playPromise !== undefined) {
                    playPromise
                        .then(() => {
                            setPlayerState(PlayerState.PLAYING);
                            setupAudioAnalyzer();
                        })
                        .catch(error => {
                            if (audioRef.current && !audioRef.current.paused && !audioRef.current.ended) {
                                setPlayerState(PlayerState.PLAYING);
                                return;
                            }

                            // A load() landing between play() and its promise aborts the play.
                            // That happens whenever the source changes again while a track is
                            // still starting - skipping during an automix transition is the
                            // reliable way to see it - and the autoplay flag was spent before
                            // play() was ever called, so nothing would press play again and the
                            // app sits silent. Put the intent back for the next run.
                            if (error.name === 'AbortError') {
                                shouldAutoPlayRef.current = true;
                                return;
                            }

                            if (error.name === 'NotAllowedError') {
                                setStatusMsg({ type: 'info', text: t('status.clickToPlay') });
                                setPlayerState(PlayerState.PAUSED);
                            }
                        });
                }
            }
        }
    }, [audioRef, audioSrc, getTargetPlaybackVolume, isAutoplayHeld, isLyricsLoading, setPlayerState, setStatusMsg, setupAudioAnalyzer, shouldAutoPlayRef, suppressAutoplayRef, syncOutputGain, t]);

    // Tells this bridge that the active deck ALREADY holds `src` and is sounding it, so the next time
    // `audioSrc` settles on that value the reload effect above treats it as a no-op instead of calling
    // load(). Used when a transition is cancelled back onto the deck still playing the outgoing track:
    // that deck has the song loaded and playing, and reloading it would run the whole song-change
    // shape - a fresh load, a visible hitch - for a track that never actually left.
    const adoptActiveDeckSource = useCallback((src: string) => {
        previousAudioSrcRef.current = src;
    }, []);

    return {
        setupAudioAnalyzer,
        cacheSongAssets,
        cacheSongAssetsFor,
        adoptActiveDeckSource,
    };
}
