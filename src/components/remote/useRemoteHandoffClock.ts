import { useEffect, useState, type MutableRefObject } from 'react';
import { animate, useMotionValue, useTransform, type MotionValue } from 'framer-motion';
import type { RemoteTrackTransition } from '../../types/remoteControl';
import {
    mapTrackHandoffProgress,
    resolveStoppedTrackHandoffProgress,
    resolveTransitionClock,
    type RemoteTrackHandoffPair,
} from './remoteTrackTransition';

// src/components/remote/useRemoteHandoffClock.ts
// 交接的本地时间轴：快照只负责起表，走表交给 MotionValue，避免 500ms 一格的阶梯感。

/**
 * cue 结束到显示曲目推进之间允许的空档。settle 是同步清 cue 的，而显示曲目来自 React
 * state，要等下一次提交才换；夹在中间的那次 500ms 发布会送来「没有 cue 的上一首」。
 * 这段时间继续按完成态挂住交接，超出则认为推进没来，放手回到常规渲染。
 */
const HANDOFF_PROMOTION_GRACE_MS = 1500;

type UseRemoteHandoffClockParams = {
    transition: RemoteTrackTransition | null;
    isPlaying: boolean;
    trackIdentity: string;
    /** 本条 cue 锁定的 A→B；停表时要靠它判断是走完了还是被取消了 */
    pairRef: MutableRefObject<RemoteTrackHandoffPair | null>;
};

export type RemoteHandoffClock = {
    incomingOpacity: MotionValue<number>;
    outgoingOpacity: MotionValue<number>;
    /** cue 时间窗内点亮进度条 */
    isGlowActive: boolean;
    /** 越过 crossover：背景该换成下一首的配色了 */
    isIncomingDominant: boolean;
    /** cue 已走完、显示曲目还没跟上的那段空档 */
    isAwaitingPromotion: boolean;
    startedAtMs: number | null;
};

export const useRemoteHandoffClock = ({
    transition,
    isPlaying,
    trackIdentity,
    pairRef,
}: UseRemoteHandoffClockParams): RemoteHandoffClock => {
    const startedAtMs = transition?.startedAtMs ?? null;
    const durationSec = transition?.durationSec ?? null;
    const crossover = Math.max(0, Math.min(1, transition?.crossover ?? 0.5));

    const timeProgress = useMotionValue(0);
    // crossover 也走 MotionValue：放进 ref 的话 useTransform 只在时间进度变化时重算，
    // 新 cue 换了 crossover 而进度恰好落回同一个数值时会继续用上一条 cue 的映射。
    const crossoverValue = useMotionValue(crossover);
    useEffect(() => {
        crossoverValue.set(crossover);
    }, [crossoverValue, crossover]);

    const incomingOpacity = useTransform(
        [timeProgress, crossoverValue],
        ([progress, activeCrossover]: number[]) => mapTrackHandoffProgress(progress, activeCrossover),
    );
    const outgoingOpacity = useTransform(incomingOpacity, (progress: number) => 1 - progress);

    const [isGlowActive, setIsGlowActive] = useState(false);
    const [isIncomingDominant, setIsIncomingDominant] = useState(false);
    const [isAwaitingPromotion, setIsAwaitingPromotion] = useState(false);

    useEffect(() => {
        timeProgress.stop();
        let endTimer: number | null = null;
        let dominanceTimer: number | null = null;
        let promotionTimer: number | null = null;
        let playback: ReturnType<typeof animate> | null = null;

        if (
            !isPlaying
            || startedAtMs === null
            || durationSec === null
            || !Number.isFinite(startedAtMs)
            || !Number.isFinite(durationSec)
            || durationSec <= 0
        ) {
            const nowMs = Date.now();
            const pair = pairRef.current;
            timeProgress.set(resolveStoppedTrackHandoffProgress(pair, trackIdentity, nowMs));
            setIsGlowActive(false);

            // 整段 cue 都走完了、当前曲目却还停在交接的上一首：这是 settle 与 React 提交
            // 之间的空档，继续按完成态挂住。真正被中途取消的（cue 没走完）不会落进这里。
            const sinceCueEndMs = pair ? nowMs - (pair.startedAtMs + pair.durationSec * 1000) : Number.NaN;
            const isAwaiting = Boolean(
                pair
                && pair.outgoingKey === trackIdentity
                && sinceCueEndMs >= 0
                && sinceCueEndMs < HANDOFF_PROMOTION_GRACE_MS,
            );
            setIsAwaitingPromotion(isAwaiting);
            setIsIncomingDominant(isAwaiting);
            if (isAwaiting) {
                promotionTimer = window.setTimeout(
                    () => setIsAwaitingPromotion(false),
                    HANDOFF_PROMOTION_GRACE_MS - sinceCueEndMs,
                );
            }

            return () => {
                if (promotionTimer !== null) window.clearTimeout(promotionTimer);
            };
        }

        setIsAwaitingPromotion(false);

        const clock = resolveTransitionClock({
            transition: { startedAtMs, durationSec, crossover },
            isPlaying: true,
            nowMs: Date.now(),
        });
        if (!clock || clock.timeProgress >= 1) {
            timeProgress.set(1);
            setIsGlowActive(false);
            setIsIncomingDominant(true);
            return;
        }

        timeProgress.set(clock.timeProgress);
        setIsGlowActive(true);

        const remainingSec = Math.max(0, durationSec - Math.max(0, clock.elapsedSec));
        playback = animate(timeProgress, 1, { duration: remainingSec, ease: 'linear' });
        endTimer = window.setTimeout(() => setIsGlowActive(false), remainingSec * 1000);

        // 背景主导权只在 crossover 那一个时刻翻一次，按时间排一个 timeout 就够；
        // 订阅 MotionValue 会在整条 cue 上每帧调一次 setState。
        const untilCrossoverMs = (durationSec * crossover - clock.elapsedSec) * 1000;
        setIsIncomingDominant(untilCrossoverMs <= 0);
        if (untilCrossoverMs > 0) {
            dominanceTimer = window.setTimeout(() => setIsIncomingDominant(true), untilCrossoverMs);
        }

        return () => {
            playback?.stop();
            if (endTimer !== null) window.clearTimeout(endTimer);
            if (dominanceTimer !== null) window.clearTimeout(dominanceTimer);
        };
    }, [timeProgress, pairRef, isPlaying, trackIdentity, crossover, durationSec, startedAtMs]);

    return {
        incomingOpacity,
        outgoingOpacity,
        isGlowActive,
        isIncomingDominant,
        isAwaitingPromotion,
        startedAtMs,
    };
};
