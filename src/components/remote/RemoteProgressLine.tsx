import React, { useEffect, useRef } from 'react';
import { REMOTE_NO_DRAG_STYLE } from './remoteWindowBridge';
import type { RemoteClock } from './useRemoteClock';

// src/components/remote/RemoteProgressLine.tsx
// The one thin line of the remote window: the divider between the type and the keys, and the
// progress bar. It reads the same running clock as the lyric, so it moves every frame rather than
// once per 500 ms snapshot, and it is dragged to seek.

/** A change made with the keyboard is sent this long after the last one, unless the key came up first. */
const KEY_SEEK_SETTLE_MS = 150;

type RemoteProgressLineProps = {
    clock: RemoteClock;
    duration: number;
    disabled: boolean;
    /** An audio transition (AutoMix / crossfade) is audible: the played part glows. */
    isTransitionGlowActive: boolean;
    seekLabel: string;
    onSeek: (time: number) => void;
};

const RemoteProgressLine: React.FC<RemoteProgressLineProps> = ({
    clock,
    duration,
    disabled,
    isTransitionGlowActive,
    seekLabel,
    onSeek,
}) => {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const isPointerDownRef = useRef(false);
    const keySeekTimerRef = useRef<number | undefined>(undefined);
    const isDisabled = disabled || duration <= 0;

    useEffect(() => {
        let paintedProgress = '';
        let paintedSecond = -1;
        const paint = () => {
            const total = clock.getDuration();
            const shown = total > 0 ? Math.max(0, Math.min(clock.getShownTime(), total)) : 0;
            const progress = `${(total > 0 ? (shown / total) * 100 : 0).toFixed(2)}%`;
            if (progress !== paintedProgress) {
                paintedProgress = progress;
                rootRef.current?.style.setProperty('--remote-progress', progress);
            }

            // The hidden slider follows too, so a key press starts from where the song is.
            const second = Math.floor(shown);
            if (second !== paintedSecond && !isPointerDownRef.current && inputRef.current) {
                paintedSecond = second;
                inputRef.current.value = String(second);
            }
        };

        paint();
        return clock.subscribe(paint);
    }, [clock]);

    const commit = () => {
        window.clearTimeout(keySeekTimerRef.current);
        const time = clock.releaseSeek();
        if (time !== null) {
            onSeek(time);
        }
    };
    /** A seek that ends without its release: nothing is sent and the line goes back to the song. */
    const abandonSeek = () => {
        window.clearTimeout(keySeekTimerRef.current);
        isPointerDownRef.current = false;
        clock.cancelSeek();
    };
    const abandonDrag = () => {
        if (isPointerDownRef.current) {
            abandonSeek();
        }
    };

    // Locked in the middle of a seek: a disabled control gets no events, so the release would never come.
    useEffect(() => {
        if (isDisabled) {
            abandonSeek();
        }
    }, [isDisabled]);

    useEffect(() => () => window.clearTimeout(keySeekTimerRef.current), []);

    return (
        <div ref={rootRef} className="remote-line" style={REMOTE_NO_DRAG_STYLE}>
            <input
                ref={inputRef}
                aria-label={seekLabel}
                type="range"
                min={0}
                max={duration || 1}
                step={1}
                defaultValue={0}
                disabled={isDisabled}
                className="remote-line__input"
                onPointerDown={() => {
                    isPointerDownRef.current = true;
                }}
                onPointerUp={() => {
                    isPointerDownRef.current = false;
                    commit();
                }}
                onPointerCancel={abandonSeek}
                onLostPointerCapture={abandonDrag}
                onBlur={abandonDrag}
                onChange={event => {
                    clock.previewSeek(Number(event.currentTarget.value));
                    // A change from the keyboard has no release of the pointer to wait for. It is sent
                    // when the key comes up, or a moment after the last change: a held key repeats
                    // about 30 times a second, and every repeat would be a seek of its own.
                    if (!isPointerDownRef.current) {
                        window.clearTimeout(keySeekTimerRef.current);
                        keySeekTimerRef.current = window.setTimeout(commit, KEY_SEEK_SETTLE_MS);
                    }
                }}
                onKeyUp={() => {
                    if (!isPointerDownRef.current) {
                        commit();
                    }
                }}
            />
            <div className="remote-line__track">
                <div className="remote-line__fill" />
                {isTransitionGlowActive && (
                    <div aria-hidden className="remote-line__glow remote-progress-transition-glow" />
                )}
            </div>
            <div className="remote-line__knob remote-lit" />
        </div>
    );
};

export default RemoteProgressLine;
