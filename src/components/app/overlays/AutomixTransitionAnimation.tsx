import React, { useCallback, useEffect, useRef, useState } from 'react';
import { animate, createTimeline, svg, type JSAnimation, type Timeline } from 'animejs';
import type { Theme } from '../../../types';
import { useSettingsUiStore } from '../../../stores/useSettingsUiStore';
import { subscribeToTransitionCue, type TransitionCue } from '../../../services/automix/transitionCue';

// src/components/app/overlays/AutomixTransitionAnimation.tsx
// What a mix looks like while it is happening: one ring, shared by two tracks.
//
// The whole picture is a single circle divided at one moving point. Behind that point is the outgoing
// track, ahead of it the incoming one, and the point sweeps once around over exactly the length of the
// blend - so the drawing is not a decoration that happens to run for a while, it IS the transition, at
// 1:1. The two things automix knows and a spinner cannot show are marked: the tick outside the ring is
// the moment the two tracks change places, and the ring breathes at the outgoing track's tempo.
//
// It draws over whatever the listener was already looking at, hence the two rules it obeys without being
// asked twice: it never takes a click (`pointer-events: none` all the way down), and any key or click at
// all makes it go away.

/** Full circle from twelve o'clock, clockwise, as two arcs - a lone arc that long is degenerate. */
const RING_PATH = 'M100 34A66 66 0 0 1 100 166A66 66 0 0 1 100 34';
const RING_RADIUS = 66;

/**
 * The shortest blend worth drawing.
 *
 * Below this the ring would spend most of its life entering and leaving, and the listener would get a
 * flash rather than a picture. Automix's short shapes - the beat cut, the splice - are all well under it,
 * which is the point: those are meant to pass unnoticed, and an animation is the opposite of unnoticed.
 */
const MIN_DRAWN_SECONDS = 5;

const ENTER_MS = 760;
const EXIT_MS = 700;
/** How long the fade takes when something ends the animation before its time. */
const DISMISS_MS = 520;
/**
 * How close to its own end an animation has to be for the session's "transition over" to be read
 * as that ending rather than as an interruption.
 *
 * The session settles 150ms after the blend, which lands in the middle of the exit above. Without
 * this the ordinary end of every transition would cut its own fade short, and only a skipped track
 * would ever look right.
 */
const NORMAL_END_SLACK_MS = 400;

type AutomixTransitionAnimationProps = {
    theme?: Theme;
    isDaylight: boolean;
};

const AutomixTransitionAnimation: React.FC<AutomixTransitionAnimationProps> = ({ theme, isDaylight }) => {
    const [cue, setCue] = useState<TransitionCue | null>(null);

    const rootRef = useRef<HTMLDivElement | null>(null);
    const bloomRef = useRef<HTMLDivElement | null>(null);
    const pulseRef = useRef<HTMLDivElement | null>(null);
    const outgoingRef = useRef<SVGPathElement | null>(null);
    const incomingRef = useRef<SVGPathElement | null>(null);
    const headRef = useRef<SVGGElement | null>(null);
    const tickRef = useRef<SVGGElement | null>(null);

    const timelineRef = useRef<Timeline | null>(null);
    const pulseAnimationRef = useRef<JSAnimation | null>(null);
    /**
     * The fade a dismissal is running, kept only so the next cue can call it off.
     *
     * The two overlap more often than the half-second they last would suggest: the settings switch
     * announces its preview from a click, and that same click has already dismissed whatever was
     * on screen. Without this the entering ring is fading out and fading in at once.
     */
    const dismissAnimationRef = useRef<JSAnimation | null>(null);
    const leavingRef = useRef(false);
    /** When the running cue says it is finished, on the same clock the dismissal check uses. */
    const endsAtRef = useRef(0);

    /** Fade out now, whoever asked. Idempotent: a keypress during the fade must not restart it. */
    const dismiss = useCallback(() => {
        if (leavingRef.current) return;
        const root = rootRef.current;
        if (!root) {
            setCue(null);
            return;
        }
        leavingRef.current = true;
        // Paused rather than reverted: revert would snap every property back to where the timeline
        // started, which is a full ring at zero opacity - visible for one frame as a flash.
        timelineRef.current?.pause();
        pulseAnimationRef.current?.pause();
        // Nothing to fade to nobody. Every animation here runs on frames, and a hidden window stops
        // delivering them - so a fade started now would sit part-finished until the window came back, and
        // the listener would return to a ring dissolving over a song that has been playing for ten minutes.
        if (document.hidden) {
            setCue(null);
            return;
        }
        dismissAnimationRef.current = animate(root, {
            opacity: 0,
            duration: DISMISS_MS,
            ease: 'outQuad',
            onComplete: () => setCue(null),
        });
    }, []);

    // Subscribed once, and the three rules are read at the moment a cue arrives rather than subscribed
    // against. Both settings are read imperatively for the same reason: the settings page announces one
    // cue as a preview the instant the switch goes on, and a subscription keyed on that switch would still
    // be tearing down its old self when the preview was announced.
    useEffect(() => subscribeToTransitionCue(next => {
        if (next === null) {
            // The blend is over. Whether that is this animation's own ending or something cutting
            // it short is a question about the clock, not about the cue.
            if (performance.now() < endsAtRef.current - NORMAL_END_SLACK_MS) dismiss();
            return;
        }
        const settings = useSettingsUiStore.getState();
        if (!settings.transitionAnimation || settings.transitionMode !== 'automix') return;
        if (!(next.seconds >= MIN_DRAWN_SECONDS)) return;
        dismissAnimationRef.current?.cancel();
        dismissAnimationRef.current = null;
        leavingRef.current = false;
        endsAtRef.current = performance.now() + next.seconds * 1000;
        setCue(next);
    }), [dismiss]);

    // Any key, any left click. Capture, because the point is to get out of the way of whatever the
    // listener is about to do - and something further down stopping the event does not make them
    // any less busy.
    useEffect(() => {
        if (!cue) return;
        const onKey = () => dismiss();
        const onMouse = (event: MouseEvent) => {
            if (event.button === 0) dismiss();
        };
        window.addEventListener('keydown', onKey, { capture: true, passive: true });
        window.addEventListener('mousedown', onMouse, { capture: true, passive: true });
        return () => {
            window.removeEventListener('keydown', onKey, { capture: true });
            window.removeEventListener('mousedown', onMouse, { capture: true });
        };
    }, [cue, dismiss]);

    useEffect(() => {
        if (!cue) return;
        const root = rootRef.current;
        const bloom = bloomRef.current;
        const pulse = pulseRef.current;
        const outgoing = outgoingRef.current;
        const incoming = incomingRef.current;
        const head = headRef.current;
        const tick = tickRef.current;
        if (!root || !bloom || !pulse || !outgoing || !incoming || !head || !tick) return;

        const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        const total = cue.seconds * 1000;
        const swap = total * cue.crossover;

        // Anime owns the dash maths for both arcs; all this file says is which way each one goes.
        const [outgoingDraw] = svg.createDrawable(outgoing);
        const [incomingDraw] = svg.createDrawable(incoming);

        const timeline = createTimeline({ defaults: { ease: 'linear' } });
        timelineRef.current = timeline;

        timeline.add(root, calm
            ? { opacity: [0, 1], duration: ENTER_MS, ease: 'outQuad' }
            : {
                opacity: [0, 1],
                scale: [0.86, 1],
                filter: ['blur(9px)', 'blur(0px)'],
                duration: ENTER_MS,
                ease: 'outExpo',
            }, 0);

        // Linear, all three, and that is deliberate: between them they are a clock. The outgoing
        // arc gives up exactly the length the incoming arc takes, so the two always tile the ring
        // and the seam between them is where the mix is up to. Easing any one of them would put
        // the seam somewhere the audio is not.
        timeline.add(outgoingDraw, { draw: ['0 1', '1 1'], duration: total }, 0);
        timeline.add(incomingDraw, { draw: ['0 0', '0 1'], duration: total }, 0);
        timeline.add(head, { rotate: [0, 360], duration: total }, 0);

        // The one place the drawing is allowed to editorialise. The glow gathers on the way to the
        // handover and lets go after it, which is the shape of the thing being listened to.
        timeline.add(bloom, {
            opacity: [0.18, 0.46],
            scale: [0.92, 1.06],
            duration: Math.max(swap, 1),
            ease: 'inOutSine',
        }, 0);
        timeline.add(bloom, {
            opacity: 0.14,
            scale: 0.95,
            duration: Math.max(total - swap, 1),
            ease: 'inOutSine',
        }, swap);

        // The tick sits outside the ring from the start, faint, so the moment is announced before
        // it arrives rather than appearing out of nowhere when the seam reaches it.
        timeline.add(tick, {
            opacity: [0.22, 0.85, 0.28],
            scale: calm ? 1 : [1, 1.35, 1],
            duration: 900,
            ease: 'outQuad',
        }, Math.max(swap - 220, 0));

        timeline.add(root, calm
            ? { opacity: 0, duration: EXIT_MS, ease: 'inOutQuad' }
            : {
                opacity: 0,
                scale: 1.06,
                filter: 'blur(6px)',
                duration: EXIT_MS,
                ease: 'inOutQuad',
            }, total);

        timeline.onComplete = () => setCue(null);

        // Free-running rather than on the timeline: this is a tempo, not a position in the blend,
        // and nothing here knows where the downbeats are. Kept small enough that being out of
        // phase with the music reads as breathing rather than as a beat in the wrong place.
        if (!calm && cue.periodSec && cue.periodSec > 0.2 && cue.periodSec < 2) {
            pulseAnimationRef.current = animate(pulse, {
                scale: [1, 1.018, 1],
                duration: cue.periodSec * 1000,
                ease: 'inOutSine',
                loop: true,
            });
        }

        return () => {
            timeline.revert();
            pulseAnimationRef.current?.revert();
            timelineRef.current = null;
            pulseAnimationRef.current = null;
        };
    }, [cue]);

    if (!cue) return null;

    const accent = theme?.accentColor || (isDaylight ? '#27272a' : '#fafafa');
    const neutral = isDaylight ? 'rgba(24, 24, 27, 0.42)' : 'rgba(255, 255, 255, 0.42)';
    const track = isDaylight ? 'rgba(24, 24, 27, 0.09)' : 'rgba(255, 255, 255, 0.09)';
    const swapRad = ((cue.crossover * 360 - 90) * Math.PI) / 180;
    const tickX = Math.cos(swapRad);
    const tickY = Math.sin(swapRad);

    return (
        <div
            ref={rootRef}
            aria-hidden
            className="fixed inset-0 z-[170] pointer-events-none flex items-center justify-center"
            style={{ opacity: 0 }}
        >
            <div className="relative" style={{ width: 176, height: 176 }}>
                <div
                    ref={bloomRef}
                    className="absolute -inset-8"
                    style={{
                        opacity: 0,
                        background: `radial-gradient(circle at 50% 50%, ${accent}2e 0%, ${accent}12 42%, transparent 68%)`,
                    }}
                />
                <div ref={pulseRef} className="absolute inset-0">
                    <svg
                        viewBox="0 0 200 200"
                        width="100%"
                        height="100%"
                        fill="none"
                        style={{
                            filter: isDaylight
                                ? 'drop-shadow(0 1px 10px rgba(255, 255, 255, 0.55))'
                                : 'drop-shadow(0 1px 12px rgba(0, 0, 0, 0.4))',
                        }}
                    >
                        <path d={RING_PATH} stroke={track} strokeWidth={1.25} />
                        <path
                            ref={outgoingRef}
                            d={RING_PATH}
                            stroke={neutral}
                            strokeWidth={1.5}
                            strokeLinecap="round"
                        />
                        <path
                            ref={incomingRef}
                            d={RING_PATH}
                            stroke={accent}
                            strokeWidth={2.25}
                            strokeLinecap="round"
                        />
                        {/* Transform box named rather than left to the default: these groups own no
                            geometry, so their own box is empty and anything turning or growing in
                            them would do it around a corner of the viewport instead of the ring. */}
                        <g
                            ref={tickRef}
                            style={{ transformBox: 'view-box', transformOrigin: '100px 100px', opacity: 0.22 }}
                        >
                            <line
                                x1={100 + tickX * (RING_RADIUS + 8)}
                                y1={100 + tickY * (RING_RADIUS + 8)}
                                x2={100 + tickX * (RING_RADIUS + 15)}
                                y2={100 + tickY * (RING_RADIUS + 15)}
                                stroke={accent}
                                strokeWidth={1.5}
                                strokeLinecap="round"
                            />
                        </g>
                        <g
                            ref={headRef}
                            style={{ transformBox: 'view-box', transformOrigin: '100px 100px' }}
                        >
                            <circle cx={100} cy={100 - RING_RADIUS} r={7} fill={accent} opacity={0.16} />
                            <circle cx={100} cy={100 - RING_RADIUS} r={2.6} fill={accent} />
                        </g>
                    </svg>
                </div>
            </div>
        </div>
    );
};

export default AutomixTransitionAnimation;
