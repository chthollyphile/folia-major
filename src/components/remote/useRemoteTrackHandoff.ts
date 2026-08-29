import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MotionValue } from 'framer-motion';
import type { RemoteControlSnapshot } from '../../types/remoteControl';
import { useRemoteHandoffClock } from './useRemoteHandoffClock';
import type { RemoteTrackFace, RemoteTrackHandoffPair } from './remoteTrackTransition';

// src/components/remote/useRemoteTrackHandoff.ts
// 遥控窗口渲染哪几张「面」：一条 cue 锁定的 A→B，加上手动切歌的方向性短过渡。
// 走表的部分在 useRemoteHandoffClock，这里只管内容与在场与否。

/** 手动切歌意图的有效期：超过这个时间还没换歌，就当成是自然播完 */
const NAV_INTENT_TTL_MS = 5000;

type NavIntent = { direction: 'prev' | 'next'; at: number };

const IDLE_NAV_INTENT: NavIntent = { direction: 'next', at: 0 };

type UseRemoteTrackHandoffParams = {
    snapshot: RemoteControlSnapshot;
    /** 已经套过占位符的当前曲目标题与艺术家，两张面共用同一套回退规则 */
    title: string;
    artist: string;
    isPlaying: boolean;
};

export type RemoteTrackHandoff = {
    trackIdentity: string;
    /** 进场偏移；退场用它的反向，两张面朝相反方向交错 */
    trackEnterOffset: number;
    recordNavIntent: (direction: 'prev' | 'next') => void;
    /** 当前曲目的封面，交接完成后继续用已经解码好的那一张 */
    currentCoverUrl: string | null;
    faces: RemoteTrackFace[];
    coverFaces: RemoteTrackFace[];
    hasIncomingCoverFace: boolean;
    isHandoffActive: boolean;
    isIncomingDominant: boolean;
    isTransitionGlowActive: boolean;
    /** 淡入那首的标识与封面，用来取预读好的配色 */
    incomingTrackKey: string | null;
    incomingCoverUrl: string | null;
    handoffIncomingOpacity: MotionValue<number>;
    handoffOutgoingOpacity: MotionValue<number>;
};

export const useRemoteTrackHandoff = ({
    snapshot,
    title,
    artist,
    isPlaying,
}: UseRemoteTrackHandoffParams): RemoteTrackHandoff => {
    // 没有 trackKey 的旧快照（或空闲态）退回用封面/标题拼一个，保证过渡不会漏触发
    const trackIdentity = snapshot.trackKey ?? snapshot.coverUrl ?? snapshot.title ?? 'no-track';
    const nextTrackIdentity = snapshot.nextTrackKey ?? snapshot.nextTrackCoverUrl ?? snapshot.nextTrackTitle;

    const [navIntent, setNavIntent] = useState<NavIntent>(IDLE_NAV_INTENT);
    // 手动点上一首时整块内容往回滑；自然播完或点下一首都往前滑。
    // 点击当场就翻方向：AnimatePresence 让退场的那张面沿用它最后一次在场时的 props，
    // 等快照回来才翻的话，退场的那张会和进场的那张朝同一个方向走。
    // trackIdentity 一并作为依赖，好让 TTL 在每次换歌时重新判一遍。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const trackTransitionDirection = useMemo<'prev' | 'next'>(() => (
        navIntent.at > 0 && Date.now() - navIntent.at < NAV_INTENT_TTL_MS ? navIntent.direction : 'next'
    ), [navIntent, trackIdentity]);

    const recordNavIntent = useCallback((direction: 'prev' | 'next') => {
        setNavIntent({ direction, at: Date.now() });
    }, []);

    const [handoffPair, setHandoffPair] = useState<RemoteTrackHandoffPair | null>(null);
    const handoffPairRef = useRef<RemoteTrackHandoffPair | null>(null);
    const transitionStartedAtMs = snapshot.trackTransition?.startedAtMs ?? null;
    const transitionDurationSec = snapshot.trackTransition?.durationSec ?? null;

    // 一条 cue 只锁定一组 A→B，连同 B 的标题/艺术家/封面一起锁：队列推进后 next 会变成 C，
    // 而音频仍然在混 B，拿实时的 next 渲染就会淡入一首根本没在混的歌。
    useEffect(() => {
        if (
            transitionStartedAtMs === null
            || transitionDurationSec === null
            || !nextTrackIdentity
            || nextTrackIdentity === trackIdentity
            || !snapshot.canGoNext
            || handoffPairRef.current?.startedAtMs === transitionStartedAtMs
        ) {
            return;
        }

        const pair: RemoteTrackHandoffPair = {
            startedAtMs: transitionStartedAtMs,
            durationSec: transitionDurationSec,
            outgoingKey: trackIdentity,
            incoming: {
                key: nextTrackIdentity,
                title: snapshot.nextTrackTitle || 'Folia',
                artist: snapshot.nextTrackArtist || 'Unknown artist',
                coverUrl: snapshot.nextTrackCoverUrl,
            },
        };
        handoffPairRef.current = pair;
        setHandoffPair(pair);
    }, [
        nextTrackIdentity,
        trackIdentity,
        transitionStartedAtMs,
        transitionDurationSec,
        snapshot.canGoNext,
        snapshot.nextTrackTitle,
        snapshot.nextTrackArtist,
        snapshot.nextTrackCoverUrl,
    ]);

    const clock = useRemoteHandoffClock({
        transition: snapshot.trackTransition ?? null,
        isPlaying,
        trackIdentity,
        pairRef: handoffPairRef,
    });

    const isHandoffActive = Boolean(
        handoffPair
        && handoffPair.incoming.key !== trackIdentity
        && (
            (isPlaying && clock.startedAtMs !== null && handoffPair.startedAtMs === clock.startedAtMs)
            || clock.isAwaitingPromotion
        ),
    );

    // 交接淡入的那张封面已经预读解码过；换歌后发布侧会把同一首歌的封面换成播放器的
    // 实时 URL，跟着换会让复用的那个节点重新加载一次图。同一首歌就继续用手上这张。
    const currentCoverUrl = handoffPair?.incoming.key === trackIdentity && handoffPair?.incoming.coverUrl
        ? handoffPair.incoming.coverUrl
        : snapshot.coverUrl;

    const faces = useMemo<RemoteTrackFace[]>(() => {
        const currentFace: RemoteTrackFace = {
            key: trackIdentity,
            title,
            artist,
            coverUrl: currentCoverUrl,
            mode: 'current',
        };

        return isHandoffActive && handoffPair
            ? [currentFace, { ...handoffPair.incoming, mode: 'incoming' }]
            : [currentFace];
    }, [trackIdentity, title, artist, currentCoverUrl, isHandoffActive, handoffPair]);

    // 下一首没有封面（本地曲目常见）时别把当前封面淡成占位符，封面这一层就不参与交接
    const coverFaces = useMemo<RemoteTrackFace[]>(() => faces.filter(face => face.coverUrl), [faces]);

    return {
        trackIdentity,
        trackEnterOffset: trackTransitionDirection === 'next' ? 10 : -10,
        recordNavIntent,
        currentCoverUrl,
        faces,
        coverFaces,
        hasIncomingCoverFace: coverFaces.some(face => face.mode === 'incoming'),
        isHandoffActive,
        isIncomingDominant: clock.isIncomingDominant,
        isTransitionGlowActive: clock.isGlowActive,
        incomingTrackKey: isHandoffActive && handoffPair ? handoffPair.incoming.key : null,
        incomingCoverUrl: isHandoffActive && handoffPair ? handoffPair.incoming.coverUrl : null,
        handoffIncomingOpacity: clock.incomingOpacity,
        handoffOutgoingOpacity: clock.outgoingOpacity,
    };
};
