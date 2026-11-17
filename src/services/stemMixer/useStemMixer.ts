import { useEffect, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { AutomixDeckChain } from '../automix/crossfadeGraph';
import { claimStemTrack, releaseTrackStems, runTrackStems } from '../analysis/trackStemRun';
import { readTrackBytes } from '../beatFx/beatFxSource';
import { getPlaybackAnalysisTarget } from '../playbackRecovery/representationRegistry';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useAutomixSettingsStore } from '../../stores/useAutomixSettingsStore';
import { useStemMixerStore } from '../../stores/useStemMixerStore';
import { createStemMixerPlayer, type StemMixerPlayer } from './stemMixerPlayer';
import { stemMixerBlock } from './stemMixerAvailability';
import { coveredShare, nextStemGap } from './stemGaps';
import { STEM_MIXER_TASK, stemMixerTask } from './stemMixerTask';

// src/services/stemMixer/useStemMixer.ts
// 分轨调音台的调度：开关开着、automix 关着、不在 HiFi / 外部播放器上、GPU 分得了时，为正在放的歌
// 声明 'stemMixer'（analysis/trackStemRun.ts 的 claimStemTrack），在它的分轨运行上挂一个任务
// （stemMixerTask.ts），分出来的交给播放端（stemMixerPlayer.ts）。
//
// 一次分一段「空缺」：从播放头往后第一处还没分的地方到下一处已有的地方（stemGaps.ts）。分完一段再找下一段，
// 播放头以后都分完了再回头补前面的，整首都有了就放下声明。跳到离正在分的地方很远（前面 10 秒以外，或
// 它的起点之前）时，放下这个任务、从新的播放头重找。
//
// 换歌、关开关、automix 打开：放下声明（这首歌的分离在下一段之前停，除非智能动感模式还要它），交回元素发声。
// 分轨运行只在 GPU 上，按屏上（onScreen）的紧急度排队。

/** 跳到正在分的地方之后多远就不等它，从新位置重找（44.1 kHz 采样）。 */
const JUMP_AHEAD = 10 * 44100;
/** 等 AudioContext（第一次播放时才建）的间隔。 */
const CONTEXT_POLL_MS = 500;

interface UseStemMixerParams {
    audioRef: RefObject<HTMLAudioElement | null>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    getActiveChain: () => AutomixDeckChain | null;
    hifiBlocked: boolean;
    externalBlocked: boolean;
}

export function useStemMixer({ audioRef, audioContextRef, getActiveChain, hifiBlocked, externalBlocked }: UseStemMixerParams): void {
    const enabled = useStemMixerStore(state => state.stemMixerEnabled);
    const gains = useStemMixerStore(state => state.stemMixerGains);
    const automix = useAutomixSettingsStore(state => state.automixEnabled);
    // 按 audioSrc 走：它落定时 currentSong 已是这首，元素的 src 也从它写（usePlaybackAudioBridge.ts）。
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const playerRef = useRef<{ context: AudioContext; player: Promise<StemMixerPlayer | null> } | null>(null);
    const gainsRef = useRef(gains);
    gainsRef.current = gains;
    const getActiveChainRef = useRef(getActiveChain);
    getActiveChainRef.current = getActiveChain;

    const block = enabled ? stemMixerBlock({ automix, hifi: hifiBlocked, external: externalBlocked }) : null;
    const active = enabled && block === null;

    useEffect(() => {
        const { setStemMixerStatus } = useStemMixerStore.getState();
        if (!enabled) setStemMixerStatus({ phase: 'off' });
        else if (block) setStemMixerStatus({ phase: 'blocked', block });
    }, [block, enabled]);

    useEffect(() => {
        void playerRef.current?.player.then(player => player?.setGains(gains));
    }, [gains]);

    useEffect(() => {
        const { setStemMixerStatus } = useStemMixerStore.getState();
        const song = usePlaybackStore.getState().currentSong;
        if (!active || !audioSrc || !song) {
            claimStemTrack('stemMixer', null);
            void playerRef.current?.player.then((player) => {
                player?.unload();
                player?.follow(null, null);
            });
            if (active) setStemMixerStatus({ phase: 'waiting' });
            return undefined;
        }
        const { key, representation } = getPlaybackAnalysisTarget(song);
        const src = audioSrc;
        let cancelled = false;
        let pollTimer: ReturnType<typeof setTimeout> | null = null;
        /** 正在分的那段：从哪个采样起、分到了哪。 */
        let running: { from: number; reached: number } | null = null;
        let total: number | null = null;
        /** 正在分的那段因跳转被放下：回到循环从新的播放头重找。 */
        let jumped = false;
        setStemMixerStatus({ phase: 'waiting' });
        claimStemTrack('stemMixer', key);

        const playerFor = (context: AudioContext) => {
            if (playerRef.current?.context !== context) {
                const player = createStemMixerPlayer(context).then((made) => {
                    made?.setGains(gainsRef.current);
                    return made;
                });
                playerRef.current = { context, player };
            }
            return playerRef.current.player;
        };

        const readBytes = async () => (await readTrackBytes(song, key, representation)).bytes;

        const onSeeked = (player: StemMixerPlayer) => () => {
            const head = player.playhead();
            if (head === null || !running) return;
            const covered = player.covered().some(([a, b]) => a <= head && head < b);
            if (covered) return;
            if (head < running.from || head > running.reached + JUMP_AHEAD) {
                jumped = true;
                releaseTrackStems(key, STEM_MIXER_TASK);
            }
        };

        const separate = async (player: StemMixerPlayer) => {
            const element = audioRef.current;
            player.follow(getActiveChainRef.current(), element);
            const seeked = onSeeked(player);
            element?.addEventListener('seeked', seeked);
            try {
                for (;;) {
                    if (cancelled) return;
                    const gap = nextStemGap(player.loadedKey() === key ? player.covered() : [], total, player.playhead() ?? 0);
                    if (!gap) {
                        setStemMixerStatus({ phase: 'ready' });
                        // 整首都有了：不再要这首分下去（智能动感模式要的话它自己声明着）。
                        claimStemTrack('stemMixer', null);
                        return;
                    }
                    running = { from: gap.from, reached: gap.from };
                    const reached = await runTrackStems(key, readBytes, stemMixerTask(gap.from, gap.to, {
                        onTrack: (track) => {
                            if (cancelled) return;
                            total = track.left.length;
                            if (player.loadedKey() !== key) player.load({ key, src, left: track.left, right: track.right });
                            player.follow(getActiveChainRef.current(), audioRef.current);
                        },
                        onStems: (from, to, data) => {
                            if (cancelled || player.loadedKey() !== key) return;
                            player.addStems(from, to, data);
                            if (running) running.reached = to;
                            if (total) setStemMixerStatus({ phase: 'separating', share: Math.round(coveredShare(player.covered(), total) * 100) / 100 });
                        },
                    }));
                    running = null;
                    if (cancelled) return;
                    // 跳转放下的（还在等解码时放下的答 null）：从新的播放头重找。
                    if (jumped) {
                        jumped = false;
                        continue;
                    }
                    if (reached === null) {
                        // 读不到、解码不了，或任务出错：放原曲。
                        setStemMixerStatus({ phase: 'failed' });
                        return;
                    }
                    // 没分到头就停了（某段分不了、GPU 不能用了）：分好的照用，其余放原曲，不再试。
                    if (reached < Math.min(gap.to, total ?? Infinity)) {
                        setStemMixerStatus({ phase: 'failed' });
                        return;
                    }
                }
            } finally {
                element?.removeEventListener('seeked', seeked);
            }
        };

        const start = () => {
            if (cancelled) return;
            const context = audioContextRef.current;
            if (!context) {
                pollTimer = setTimeout(start, CONTEXT_POLL_MS);
                return;
            }
            void playerFor(context).then((player) => {
                if (cancelled) return;
                if (!player) {
                    setStemMixerStatus({ phase: 'failed' });
                    return;
                }
                void separate(player);
            });
        };
        start();

        return () => {
            cancelled = true;
            if (pollTimer !== null) clearTimeout(pollTimer);
            releaseTrackStems(key, STEM_MIXER_TASK);
            claimStemTrack('stemMixer', null);
            void playerRef.current?.player.then(player => player?.unload());
        };
    }, [active, audioContextRef, audioRef, audioSrc]);

    // 卸载时交回元素。
    useEffect(() => () => {
        claimStemTrack('stemMixer', null);
        void playerRef.current?.player.then(player => player?.dispose());
    }, []);
}
