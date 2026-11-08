import React, { useEffect, useRef, useState } from 'react';
import { Ellipsis, Heart, ListMusic, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PlayerState } from '../../types';
import type { RemoteControlSnapshot } from '../../types/remoteControl';
import { loopModeIcon, loopModeLabelName } from '../shared/loopModeDisplay';
import { remoteCoverImage } from './RemoteSongLine';
import { REMOTE_NO_DRAG_STYLE, sendRemoteCommand } from './remoteWindowBridge';
import type { RemoteClock } from './useRemoteClock';

// src/components/remote/RemoteKeyRow.tsx
// The row under the line. Previous, play and next are always there, as bare glyphs. The time on
// the left and like / loop / queue / more on the right have their places reserved and light up with the
// pointer. Resting on previous or next swaps the slot on that side for that song; resting on a
// heart that cannot be used swaps the time for the reason.

/** How long the pointer rests on a key before what it has to say is shown. */
const PREVIEW_REST_MS = 350;

/** The keys the pointer can rest on. */
type RestTarget = 'prev' | 'next' | 'like';

const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '0:00';
    }

    const totalSeconds = Math.floor(seconds);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
};

type RemoteKeyRowProps = {
    snapshot: RemoteControlSnapshot;
    clock: RemoteClock;
    /** No song, or the main window has the controls locked. */
    primaryDisabled: boolean;
    isSheetOpen: boolean;
    isQueueOpen: boolean;
    /** A recording is busy: with the sheet closed, "more" carries a red dot. */
    isExportBusy: boolean;
    onToggleSheet: () => void;
    onToggleQueue: () => void;
    onNavigate: (direction: 'prev' | 'next') => void;
};

const RemoteKeyRow: React.FC<RemoteKeyRowProps> = ({
    snapshot,
    clock,
    primaryDisabled,
    isSheetOpen,
    isQueueOpen,
    isExportBusy,
    onToggleSheet,
    onToggleQueue,
    onNavigate,
}) => {
    const { t } = useTranslation();
    const elapsedRef = useRef<HTMLSpanElement | null>(null);
    const totalRef = useRef<HTMLElement | null>(null);
    const restTimerRef = useRef<number | undefined>(undefined);
    const [restSide, setRestSide] = useState<RestTarget | null>(null);

    // The time text follows the running clock; it is written to the DOM when a second turns over.
    useEffect(() => {
        let paintedElapsed = '';
        let paintedTotal = '';
        const paint = () => {
            const total = clock.getDuration();
            const elapsed = formatTime(total > 0 ? Math.min(clock.getShownTime(), total) : 0);
            const totalText = ` / ${formatTime(total)}`;
            if (elapsed !== paintedElapsed && elapsedRef.current) {
                paintedElapsed = elapsed;
                elapsedRef.current.textContent = elapsed;
            }
            if (totalText !== paintedTotal && totalRef.current) {
                paintedTotal = totalText;
                totalRef.current.textContent = totalText;
            }
        };

        paint();
        return clock.subscribe(paint);
    }, [clock]);

    useEffect(() => () => window.clearTimeout(restTimerRef.current), []);

    const restOn = (side: RestTarget) => {
        window.clearTimeout(restTimerRef.current);
        restTimerRef.current = window.setTimeout(() => setRestSide(side), PREVIEW_REST_MS);
    };
    const restOff = () => {
        window.clearTimeout(restTimerRef.current);
        setRestSide(null);
    };

    const isPlaying = snapshot.playerState === PlayerState.PLAYING;
    const LoopIcon = loopModeIcon(snapshot.loopMode);
    const likeUnavailableReason = snapshot.likeUnavailableProvider
        ? t('status.providerLikeUnavailable', { provider: snapshot.likeUnavailableProvider })
        : null;
    const likeLabel = likeUnavailableReason ?? (snapshot.isLiked ? t('remote.unlike') : t('remote.like'));
    const showsPrevious = restSide === 'prev' && snapshot.canGoPrevious && Boolean(snapshot.prevTrackTitle);
    const showsNext = restSide === 'next' && snapshot.canGoNext && Boolean(snapshot.nextTrackTitle);
    const showsLikeReason = restSide === 'like' && likeUnavailableReason !== null;

    return (
        <div className="remote-deck">
            <div className="remote-lit">
                <div className="remote-deck__slot remote-deck__slot--time" data-covered={showsPrevious || showsLikeReason}>
                    <span ref={elapsedRef} />
                    <i ref={totalRef} />
                </div>
                <div className="remote-preview remote-preview--prev" data-shown={showsPrevious} aria-hidden>
                    <span
                        className="remote-preview__cover"
                        style={{ backgroundImage: remoteCoverImage(snapshot.prevTrackCoverUrl) }}
                    />
                    <span className="remote-preview__title">{snapshot.prevTrackTitle}</span>
                </div>
                {/* The heart's label already says this to a screen reader. */}
                <div className="remote-preview remote-preview--prev remote-preview--note" data-shown={showsLikeReason} aria-hidden>
                    {likeUnavailableReason}
                </div>
            </div>

            <div className="remote-transport" style={REMOTE_NO_DRAG_STYLE}>
                <button
                    type="button"
                    aria-label={t('remote.previous')}
                    disabled={primaryDisabled || !snapshot.canGoPrevious}
                    className="remote-key remote-key--skip"
                    onMouseEnter={() => restOn('prev')}
                    onMouseLeave={restOff}
                    onClick={() => onNavigate('prev')}
                >
                    <SkipBack size={17} fill="currentColor" />
                </button>
                <button
                    type="button"
                    aria-label={isPlaying ? t('remote.pause') : t('remote.play')}
                    disabled={primaryDisabled}
                    className="remote-key remote-key--play"
                    onClick={() => sendRemoteCommand({ type: 'play-pause' })}
                >
                    {isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
                </button>
                <button
                    type="button"
                    aria-label={t('remote.next')}
                    disabled={primaryDisabled || !snapshot.canGoNext}
                    className="remote-key remote-key--skip"
                    onMouseEnter={() => restOn('next')}
                    onMouseLeave={restOff}
                    onClick={() => onNavigate('next')}
                >
                    <SkipForward size={17} fill="currentColor" />
                </button>
            </div>

            <div className="remote-lit">
                <div
                    className="remote-deck__slot remote-deck__slot--keys"
                    data-covered={showsNext}
                    style={REMOTE_NO_DRAG_STYLE}
                >
                    {/* A disabled button takes no pointer events, so the rest is read on this wrapper. */}
                    <span className="remote-key-rest" onMouseEnter={() => restOn('like')} onMouseLeave={restOff}>
                        <button
                            type="button"
                            aria-label={likeLabel}
                            aria-pressed={Boolean(snapshot.isLiked)}
                            data-liked={Boolean(snapshot.isLiked)}
                            disabled={primaryDisabled || snapshot.canLike === false}
                            className="remote-key remote-key--small"
                            onClick={() => sendRemoteCommand({ type: 'toggle-like' })}
                        >
                            <Heart size={15} fill={snapshot.isLiked ? 'currentColor' : 'none'} />
                        </button>
                    </span>
                    <button
                        type="button"
                        aria-label={t(`remote.${loopModeLabelName(snapshot.loopMode)}`)}
                        aria-pressed={snapshot.loopMode !== 'off'}
                        data-on={snapshot.loopMode !== 'off'}
                        disabled={primaryDisabled}
                        className="remote-key remote-key--small"
                        onClick={() => sendRemoteCommand({ type: 'cycle-loop-mode' })}
                    >
                        <LoopIcon size={15} />
                        {snapshot.loopMode !== 'off' && <span className="remote-key__dot" />}
                    </button>
                    <button
                        type="button"
                        aria-label={t('remote.queue')}
                        aria-expanded={isQueueOpen}
                        data-on={isQueueOpen}
                        className="remote-key remote-key--small"
                        onClick={onToggleQueue}
                    >
                        <ListMusic size={15} />
                    </button>
                    <button
                        type="button"
                        aria-label={t('remote.more')}
                        aria-expanded={isSheetOpen}
                        data-on={isSheetOpen}
                        className="remote-key remote-key--small"
                        onClick={onToggleSheet}
                    >
                        <Ellipsis size={16} />
                        {isExportBusy && !isSheetOpen && <span className="remote-key__dot remote-key__dot--live" />}
                    </button>
                </div>
                <div className="remote-preview remote-preview--next" data-shown={showsNext} aria-hidden>
                    <span className="remote-preview__title">{snapshot.nextTrackTitle}</span>
                    <span
                        className="remote-preview__cover"
                        style={{ backgroundImage: remoteCoverImage(snapshot.nextTrackCoverUrl) }}
                    />
                </div>
            </div>
        </div>
    );
};

export default RemoteKeyRow;
