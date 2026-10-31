import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Sparkles } from 'lucide-react';
import { motion, useIsPresent } from 'framer-motion';
import { PlatformMark } from '../../login/PlatformMark';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { usePlayerOverlayObstacle } from '../../../hooks/usePlayerOverlayLayout';
import { holdStatusMessage } from '../../../stores/useStatusMessageStore';
import type { AppStatusToast } from './buildAppDialogsModel';
import './statusToast.css';
import { useGlass } from '@/shinoinject/useGlass';

// src/components/app/dialogs/StatusToast.tsx
// The app's toast, one line: the platform's mark (or the type's icon), what happened, what to do, the
// platform's code, the buttons. While the pointer or the focus rests on it, a second line opens with the
// platform's whole words and the time left, and its display time stands still (runStatusMessageTime). In
// a count down the action button fills over the whole time; when it is full the action happens on its own.
// Each keyed toast retains its own player-overlay obstacle until AnimatePresence finishes its exit.

// How long the pointer rests before the second line opens, and is away before it closes.
const OPEN_AFTER_MS = 120;
const CLOSE_AFTER_MS = 300;
const EASE_OUT = [0.2, 0.8, 0.2, 1] as const;
const EASE_IN = [0.4, 0, 1, 1] as const;

export const StatusToast: React.FC<{ toast: AppStatusToast }> = ({ toast }) => {
    const calm = useReducedMotionFor('uiMicroMotion');
    const isPresent = useIsPresent();
    const { ref: toastLayoutRef, invalidate: invalidateLayout } = usePlayerOverlayObstacle('status-toast', 'notification');
    const { quote, countdown, isDaylight } = toast;

    // A quote without a code of its own is all in the chip, unless the chip had to cut it short.
    const chipRef = useRef<HTMLSpanElement>(null);
    const [chipCut, setChipCut] = useState(false);
    useLayoutEffect(() => {
        const chip = chipRef.current;
        setChipCut(Boolean(chip && chip.scrollWidth > chip.clientWidth + 1));
    }, [quote?.text, quote?.code]);
    const quoteHasMore = Boolean(quote && (quote.code ? quote.text !== quote.code : chipCut));
    const opens = quoteHasMore || Boolean(countdown);

    const [open, setOpen] = useState(false);
    const openTimer = useRef<number | null>(null);
    useEffect(() => () => {
        if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    }, []);
    const rest = (on: boolean) => {
        if (!isPresent) return;
        holdStatusMessage(on);
        if (openTimer.current !== null) window.clearTimeout(openTimer.current);
        openTimer.current = opens ? window.setTimeout(() => setOpen(on), on ? OPEN_AFTER_MS : CLOSE_AFTER_MS) : null;
    };

    const cancel = toast.onCancel && toast.cancelLabel ? toast.onCancel : undefined;
    const action = toast.onAction && toast.actionLabel ? toast.onAction : undefined;

    useGlass();
    return (
        <motion.div
            data-glass
            style={{
                  backgroundColor: isDaylight
                    ? "rgba(255,255,255,0.42)"
                    : "rgba(0, 0, 0, 0.42)",
                  borderTop: isDaylight
                    ? "1px solid rgba(0,0,0,0.08)"
                    : "1px solid rgba(255,255,255,0.12)",
                  borderBottom: isDaylight
                    ? "1px solid rgba(0,0,0,0.08)"
                    : "1px solid rgba(255,255,255,0.12)",
                  outline: "1px solid rgba(40,40,40,0.2)",
                  boxShadow: "2px 2px 8px 2px rgba(40,40,40,0.4)",
                }}
            ref={toastLayoutRef}
            onUpdate={invalidateLayout}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: -18 }}
            animate={calm ? { opacity: 1, transition: { duration: 0.15 } } : { opacity: 1, y: 0, transition: { duration: 0.32, ease: EASE_OUT } }}
            exit={calm ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, y: -10, transition: { duration: 0.22, ease: EASE_IN } }}
            className={`status-toast${isDaylight ? ' is-daylight' : ''}${cancel || action ? ' has-buttons' : ''}${open ? ' is-open' : ''}${calm ? ' is-calm' : ''}${isPresent ? '' : ' is-leaving'}`}
            onPointerEnter={() => rest(true)}
            onPointerLeave={() => rest(false)}
            onFocus={() => rest(true)}
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) rest(false);
            }}
        >
            <div className="status-toast-line">
                {/* A message about one online platform leads with that platform's mark; every other message with its type's icon. */}
                {toast.providerId
                    ? <PlatformMark providerId={toast.providerId} size={20} />
                    : toast.type === 'error'
                        ? <AlertCircle size={18} className={`shrink-0 ${isDaylight ? 'text-red-500' : 'text-red-400'}`} />
                        : toast.type === 'success'
                            ? <CheckCircle2 size={18} className={`shrink-0 ${isDaylight ? 'text-green-600' : 'text-green-400'}`} />
                            : <Sparkles size={18} className={`shrink-0 ${isDaylight ? 'text-blue-600' : 'text-blue-400'}`} />}
                <span className="status-toast-title">{toast.text}</span>
                {toast.note && (
                    <>
                        <span aria-hidden className="status-toast-sep" />
                        <span className="status-toast-note">{toast.note}</span>
                    </>
                )}
                {quote && <span ref={chipRef} className="status-toast-chip">{quote.code ?? quote.text}</span>}
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
        </motion.div>
    );
};
