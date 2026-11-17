import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import type { AutomixDeckChain } from '../automix/crossfadeGraph';
import { claimStemTrack, releaseTrackStems, runTrackStems, STEM_RUN_MAX_SECONDS } from '../analysis/trackStemRun';
import { readTrackBytes } from '../beatFx/beatFxSource';
import { getPlaybackAnalysisTarget } from '../playbackRecovery/representationRegistry';
import { usePlaybackStore } from '../../stores/usePlaybackStore';
import { useAutomixSettingsStore } from '../../stores/useAutomixSettingsStore';
import { useStemMixerStore, type StemMixerStatus } from '../../stores/useStemMixerStore';
import { createStemMixerPlayer, type StemMixerPlayer } from './stemMixerPlayer';
import { stemMixerBlock } from './stemMixerAvailability';
import { STEM_MIXER_TASK, stemMixerTask } from './stemMixerTask';

// src/services/stemMixer/useStemMixer.ts
// 分轨调音台的调度：开关开着、automix 关着、不在 HiFi / 外部播放器上、GPU 分得了时，为正在放的歌
// 声明 'stemMixer'（analysis/trackStemRun.ts 的 claimStemTrack），在它的分轨运行上挂一个任务
// （stemMixerTask.ts），分出来的块交给播放端（stemMixerPlayer.ts）。
//
// 只留播放头附近的一段：往后分到 AHEAD（够远了任务就 held，等播放头走近再接着分），往前留 BEHIND，之外的块
// 丢掉。内存与歌长无关。跳到这段以外（往回跳出 BEHIND、或往前跳出正在分的地方 JUMP_AHEAD 以外）时放下任务、
// 从新的播放头重开：这首的解码还在就立刻接着分，分完放下了就重新读、重新解码（一秒左右），其间放原曲。
//
// 解码好的整首（每分钟约 21 MB）在开着调音台时留到这首放完：它是往后分的输入。超过 STEM_RUN_MAX_SECONDS 的
// 歌不分。同一首歌换了地址（流地址刷新）只更新播放端认的地址，不重分。
//
// 换歌、关开关、automix 打开：放下声明（这首歌的分离在下一段之前停，除非智能动感模式还要它），worklet
// 交叉回元素的声音。分轨运行只在 GPU 上，按屏上（onScreen）的紧急度排队。

const STEM_RATE = 44100;
/** 往后分到播放头之后多远。 */
const AHEAD = 30 * STEM_RATE;
/** 往前留多远。 */
const BEHIND = 15 * STEM_RATE;
/** 往后留到多远：分到 AHEAD 时最后一段会多出一些，往回跳以后前面那些也先留着。 */
const KEEP_AHEAD = AHEAD + 10 * STEM_RATE;
/** 跳到正在分的地方之后多远就不等它，从新位置重开。 */
const JUMP_AHEAD = 10 * STEM_RATE;
/** 多久看一次播放头（留哪段、要不要重开、状态）。 */
const TICK_MS = 500;
/** 等 AudioContext（第一次播放时才建）的间隔。 */
const CONTEXT_POLL_MS = 500;

interface UseStemMixerParams {
    audioRef: RefObject<HTMLAudioElement | null>;
    audioContextRef: MutableRefObject<AudioContext | null>;
    getActiveChain: () => AutomixDeckChain | null;
    hifiBlocked: boolean;
    externalBlocked: boolean;
}

/** 已有块的区间里含 `at` 的那段，没有时为 null。 */
const rangeAt = (covered: ReadonlyArray<readonly [number, number]>, at: number) => covered.find(([a, b]) => a <= at && at < b) ?? null;

export function useStemMixer({ audioRef, audioContextRef, getActiveChain, hifiBlocked, externalBlocked }: UseStemMixerParams): void {
    const enabled = useStemMixerStore(state => state.stemMixerEnabled);
    const gains = useStemMixerStore(state => state.stemMixerGains);
    const automix = useAutomixSettingsStore(state => state.automixEnabled);
    const audioSrc = usePlaybackStore(state => state.audioSrc);
    const song = usePlaybackStore(state => state.currentSong);
    const key = useMemo(() => (song ? getPlaybackAnalysisTarget(song).key : null), [song]);
    // 元素的 src 与它是哪首歌：audioSrc 变的那一刻 currentSong 已是这首（usePlaybackAudioBridge.ts），只在这时
    // 记下这一对，换歌后、新地址落定前不把上一首的地址认成这首的。
    const pairRef = useRef<{ key: string | null; src: string | null }>({ key: null, src: null });
    if (pairRef.current.src !== audioSrc) pairRef.current = { key, src: audioSrc };
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

    // 同一首歌换了地址：块照用。
    useEffect(() => {
        void playerRef.current?.player.then((player) => {
            const pair = pairRef.current;
            if (player && pair.src && pair.key !== null && player.loadedKey() === pair.key) player.retarget(pair.src);
        });
    }, [audioSrc]);

    const hasSrc = Boolean(audioSrc);
    useEffect(() => {
        const { setStemMixerStatus } = useStemMixerStore.getState();
        const current = usePlaybackStore.getState().currentSong;
        if (!active || !hasSrc || !current || !key || getPlaybackAnalysisTarget(current).key !== key) {
            claimStemTrack('stemMixer', null);
            void playerRef.current?.player.then((player) => {
                player?.unload();
                player?.follow(null, null);
            });
            if (active) setStemMixerStatus({ phase: 'waiting' });
            return undefined;
        }
        if (current.durationMs > STEM_RUN_MAX_SECONDS * 1000) {
            claimStemTrack('stemMixer', null);
            void playerRef.current?.player.then(player => player?.unload());
            setStemMixerStatus({ phase: 'tooLong' });
            return undefined;
        }
        const { representation } = getPlaybackAnalysisTarget(current);
        let cancelled = false;
        let pollTimer: ReturnType<typeof setTimeout> | null = null;
        let tickTimer: ReturnType<typeof setInterval> | null = null;
        let element: HTMLAudioElement | null = null;
        /** 正在跑的任务：从哪起、分到了哪。 */
        let task: { from: number; reached: number } | null = null;
        let total: number | null = null;
        /** 上一个任务读不到或没分完：不再自己重开，跳转时再试。 */
        let failed = false;
        setStemMixerStatus({ phase: 'waiting' });
        claimStemTrack('stemMixer', key);

        const playerFor = (context: AudioContext) => {
            if (playerRef.current?.context !== context) {
                const made = createStemMixerPlayer(context).then((player) => {
                    player?.setGains(gainsRef.current);
                    return player;
                });
                playerRef.current = { context, player: made };
            }
            return playerRef.current.player;
        };

        const readBytes = async () => (await readTrackBytes(current, key, representation)).bytes;
        /** 这首的地址（换歌后新地址还没落定时为 null：先不认）。 */
        const srcNow = () => (pairRef.current.key === key ? pairRef.current.src : null);

        const startTask = (player: StemMixerPlayer, from: number) => {
            if (task) releaseTrackStems(key, STEM_MIXER_TASK);
            const mine = { from, reached: from };
            task = mine;
            void runTrackStems(key, readBytes, stemMixerTask(from, {
                onTrack: (track) => {
                    if (cancelled || task !== mine) return;
                    total = track.left.length;
                    if (player.loadedKey() !== key) player.load(key, srcNow() ?? '');
                },
                onChunk: (a, b, data) => {
                    if (cancelled || task !== mine) return;
                    player.addChunk(a, b, data);
                    mine.reached = b;
                    tick(player);
                },
                held: (reached) => {
                    const head = player.playhead();
                    return head !== null && reached > head + AHEAD;
                },
            })).then((reached) => {
                if (cancelled || task !== mine) return;
                task = null;
                // 分到歌尾才是分完；读不到、解码不了、某段分不了、GPU 不能用了：放原曲，跳转时再试。
                if (reached === null || total === null || reached < total) failed = true;
                tick(player);
            });
        };

        /** 看一次播放头：留哪段、要不要（重）开任务、此刻的状态。 */
        const tick = (player: StemMixerPlayer) => {
            if (cancelled) return;
            player.follow(getActiveChainRef.current(), element);
            const head = player.playhead();
            if (head === null) return;
            if (player.loadedKey() === key) player.keep(head - BEHIND, head + KEEP_AHEAD);
            const covered = player.loadedKey() === key ? player.covered() : [];
            const here = rangeAt(covered, head);
            // 从播放头起已经连着有的地方到哪。
            const frontier = here ? here[1] : head;
            if (task) {
                // 正在分的地方和播放头连着（播放头在它分好的那段里，或在它前面不远）就等它，否则重开。
                const joined = here ? here[1] >= task.reached : head >= task.from && head <= task.reached + JUMP_AHEAD;
                if (!joined) startTask(player, frontier);
            } else if (!failed && (total === null || frontier < total) && frontier < head + AHEAD) {
                startTask(player, frontier);
            }
            let status: StemMixerStatus;
            if (failed && !here) status = { phase: 'failed' };
            else if (!here) status = task ? { phase: 'separating' } : { phase: 'waiting' };
            else if (element && !element.paused && !player.following()) status = { phase: 'notFollowing' };
            else status = { phase: 'ready' };
            setStemMixerStatus(status);
        };

        const onSeeked = (player: StemMixerPlayer) => () => {
            // 跳转了：失败过的也再试一次。
            failed = false;
            tick(player);
        };
        let seeked: (() => void) | null = null;

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
                element = audioRef.current;
                seeked = onSeeked(player);
                element?.addEventListener('seeked', seeked);
                tick(player);
                tickTimer = setInterval(() => tick(player), TICK_MS);
            });
        };
        start();

        return () => {
            cancelled = true;
            if (pollTimer !== null) clearTimeout(pollTimer);
            if (tickTimer !== null) clearInterval(tickTimer);
            if (seeked) element?.removeEventListener('seeked', seeked);
            releaseTrackStems(key, STEM_MIXER_TASK);
            claimStemTrack('stemMixer', null);
            void playerRef.current?.player.then(player => player?.unload());
        };
    }, [active, audioContextRef, audioRef, hasSrc, key]);

    // 卸载时交回元素。
    useEffect(() => () => {
        claimStemTrack('stemMixer', null);
        void playerRef.current?.player.then(player => player?.dispose());
    }, []);
}
