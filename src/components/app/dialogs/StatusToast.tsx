import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Sparkles, X } from 'lucide-react';
import { motion, useIsPresent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { PlatformMark } from '../../login/PlatformMark';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { usePlayerOverlayObstacle } from '../../../hooks/usePlayerOverlayLayout';
import { dismissToast } from '../../../stores/useStatusMessageStore';
import type { AppStatusToast } from './buildAppDialogsModel';
import { LoadingBars } from '../../shared/LoadingBars';
import './statusToast.css';

// src/components/app/dialogs/StatusToast.tsx
// The app's toast: a coloured icon tile, a bold title and a quiet second line (the note, a quoted
// platform answer or a count down). The close button dismisses this one toast by key; its own
// display time stands still while the pointer or focus rests on it, then runs on for what is left.
// A count down fills its action button over the whole time and fires it when full. Each keyed toast
// keeps its own player-overlay obstacle until AnimatePresence finishes its exit. The stack shows at
// most five; a sixth pushes the oldest one off, which unmounts and clears its clock here.

// How long the pointer rests before the second line opens, and is away before it closes.
const OPEN_AFTER_MS = 120;
const CLOSE_AFTER_MS = 300;
const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;

/**
 * Counts one toast's display time on its own clock. Resting pauses it and resumes with the time
 * that was left; it holds no global flag, so other toasts keep running while this one is read.
 * The bottom drain bar is the same clock: its CSS animation is paused/resumed alongside the timer,
 * so the bar always shows the time actually left rather than running on while the toast is held.
 * The pause/resume pair is kept in a ref so the effect owns one clock for the toast's whole life.
 */
const useToastTime = (key: string, ms: number | undefined, persistent: boolean | undefined) => {
    const control = useRef<{ pause: () => void; resume: () => void } | null>(null);
    const barRef = useRef<HTMLSpanElement | null>(null);
    useEffect(() => {
        if (persistent || !ms) return;
        let left = ms;
        let startedAt = 0;
        let timer: number | null = null;
        const bar = barRef.current;
        const hold = (paused: boolean) => {
            if (bar) bar.style.animationPlayState = paused ? 'paused' : 'running';
        };
        const pause = () => {
            if (timer === null) return;
            window.clearTimeout(timer);
            timer = null;
            left -= Date.now() - startedAt;
            hold(true);
        };
        const resume = () => {
            if (timer !== null || left <= 0) return;
            startedAt = Date.now();
            timer = window.setTimeout(() => dismissToast(key), left);
            hold(false);
        };
        control.current = { pause, resume };
        resume();
        return () => {
            pause();
            control.current = null;
        };
    }, [key, ms, persistent]);
    return { control, barRef };
};

export const StatusToast: React.FC<{
    toast: AppStatusToast;
}> = ({ toast }) => {
    const calm = useReducedMotionFor('uiMicroMotion');
    const isPresent = useIsPresent();
    const { t } = useTranslation();
    const { ref: toastLayoutRef, invalidate: invalidateLayout } = usePlayerOverlayObstacle('status-toast', 'notification');
    const { control: clock, barRef } = useToastTime(toast.toastKey, toast.durationMs ?? 3000, toast.persistent);
    const { quote, countdown, isDaylight } = toast;

    // Once dismissed the card is only playing its exit animation: freeze its bar where it was.
    useEffect(() => {
        if (!isPresent) clock.current?.pause();
    }, [isPresent, clock]);

    // A quote without a code of its own is all in the chip, unless the chip had to cut it short.
    const chipRef = useRef<HTMLSpanElement>(null);
    const [chipCut, setChipCut] = useState(false);
    useLayoutEffect(() => {
        const chip = chipRef.current;
        setChipCut(Boolean(chip && chip.scrollWidth > chip.clientWidth + 1));
    }, [quote?.text, quote?.code]);
    const quoteHasMore = Boolean(quote && (quote.code ? quote.text !== quote.code : chipCut));
    const opens = quoteHasMore || Boolean(countdown);
    const hasSub = Boolean(toast.note || quote || countdown);

    const [open, setOpen] = useState(false);
    const openTimer = useRef<number | null>(null);
    useEffect(() => () => {
        if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    }, []);
    const rest = (on: boolean) => {
        if (!isPresent) return;
        if (on) clock.current?.pause(); else clock.current?.resume();
        if (openTimer.current !== null) window.clearTimeout(openTimer.current);
        openTimer.current = opens ? window.setTimeout(() => setOpen(on), on ? OPEN_AFTER_MS : CLOSE_AFTER_MS) : null;
    };

    const cancel = toast.onCancel && toast.cancelLabel ? toast.onCancel : undefined;
    const action = toast.onAction && toast.actionLabel ? toast.onAction : undefined;

    // An activity keeps its own colour through loading → result; a plain message uses its type.
    const iconTone = toast.activity
        ? toast.activity === 'error' ? 'is-error' : toast.activity === 'success' ? 'is-success' : 'is-loading'
        : toast.providerId
            ? 'is-provider'
            : toast.type === 'error' ? 'is-error' : toast.type === 'success' ? 'is-success' : 'is-info';

    return (
        <motion.div
            ref={toastLayoutRef}
            onUpdate={invalidateLayout}
            initial={calm ? { opacity: 0 } : { opacity: 0, x: 16 }}
            animate={calm ? { opacity: 1, transition: { duration: 0.15 } }
                : { opacity: 1, x: 0, transition: { duration: 0.28, ease: EASE_OUT } }}
            exit={calm ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, x: 8, transition: { duration: 0.2, ease: EASE_IN } }}
            className={`status-toast${toast.activity ? ' has-activity' : ''}${isDaylight ? ' is-daylight' : ''}${cancel || action ? ' has-buttons' : ''}${open ? ' is-open' : ''}${calm ? ' is-calm' : ''}${isPresent ? '' : ' is-leaving'}`}
            role={toast.activity ? 'status' : undefined}
            aria-live={toast.activity ? 'polite' : undefined}
            onPointerEnter={() => rest(true)}
            onPointerLeave={() => rest(false)}
            onFocus={() => rest(true)}
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) rest(false);
            }}
        >
            <div className="status-toast-line">
                <span className={`status-toast-icon-tile ${iconTone}`}>
                    {/* A message about one online platform leads with that platform's mark; every other message with its type's icon. */}
                    {toast.activity
                        ? <LoadingBars size={22} status={toast.activity} />
                        : toast.providerId
                            ? <PlatformMark providerId={toast.providerId} size={20} />
                            : toast.type === 'error'
                                ? <AlertCircle size={18} strokeWidth={2.4} className="status-toast-glyph" />
                                : toast.type === 'success'
                                    ? <Check size={19} strokeWidth={3} className="status-toast-glyph" />
                                    : <Sparkles size={18} className="status-toast-glyph" />}
                </span>
                <div className="status-toast-copy">
                    <div className="status-toast-title-row">
                        <span className="status-toast-title">{toast.text}</span>
                        <button
                            type="button"
                            onClick={() => dismissToast(toast.toastKey)}
                            aria-label={t('ui.close')}
                            title={t('ui.close')}
                            className="status-toast-close"
                        >
                            <X size={13} strokeWidth={2.5} />
                        </button>
                    </div>
                    {hasSub && (
                        <div className="status-toast-sub">
                            {toast.note && <span className="status-toast-note">{toast.note}</span>}
                            {quote && <span ref={chipRef} className="status-toast-chip">{quote.code ?? quote.text}</span>}
                            {countdown && <span className="status-toast-count-inline">{countdown.text}</span>}
                        </div>
                    )}
                    {(cancel || action) && (
                        <span className="status-toast-buttons">
                            {cancel && (
                                <button type="button" onClick={cancel} className="status-toast-button is-ghost">
                                    {toast.cancelLabel}
                                </button>
                            )}
                            {action && (countdown ? (
                                <button type="button" onClick={action} aria-label={`${toast.actionLabel} ${countdown.text}`} className="status-toast-button is-skip">
                                    <span>
                                        {toast.actionLabel}
                                        <span className="status-toast-seconds">{countdown.seconds}</span>
                                    </span>
                                    <span aria-hidden className="status-toast-fill" style={{ animationDuration: `${countdown.totalMs}ms` }}>
                                        {toast.actionLabel}
                                    </span>
                                </button>
                            ) : (
                                <button type="button" onClick={action} className="status-toast-button is-primary">
                                    {toast.actionIcon && <toast.actionIcon size={14} className={isDaylight ? 'text-amber-300' : 'text-amber-500'} />}
                                    {toast.actionLabel}
                                </button>
                            ))}
                        </span>
                    )}
                </div>
            </div>
            {opens && (
                <div className="status-toast-more">
                    <div className="status-toast-more-in">
                        <div className="status-toast-more-row">
                            {quoteHasMore && <span className="status-toast-quote">“{quote?.text}”</span>}
                            {countdown && <span className="status-toast-countdown">{countdown.text}</span>}
                        </div>
                    </div>
                </div>
            )}
            {!toast.persistent && (
                <div className="status-toast-timer" aria-hidden>
                    <span
                        ref={barRef}
                        className="status-toast-timer-track"
                        style={{ animationDuration: `${toast.durationMs ?? 3000}ms` }}
                    />
                </div>
            )}
        </motion.div>
    );
};
