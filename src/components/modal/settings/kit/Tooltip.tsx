import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useSettingsKitTheme } from './kitTheme';
import { KIT_MOTION, kitTransition, useKitReducedMotion } from './motion';
import { POPOVER_GUTTER, placePopover, type PopoverPlace } from './popoverPlace';

// src/components/modal/settings/kit/Tooltip.tsx
// The kit's own tooltip, in place of the system one a `title` gives: a small label over the part it
// wraps, shown after the pointer has rested on the part and at once when the keyboard reaches it.
// It draws outside the settings window, so it takes light or dark from the kit theme, and it is
// placed against the screen: over the part, or under it where the screen ends too soon, and moved
// in where it would pass the screen's edge.

const MAX_WIDTH = 260;

type TooltipProps = {
    /** Without a text there is only the wrapping element. */
    text?: string;
    /** For the element that wraps the children. */
    className?: string;
    children: React.ReactNode;
};

export const Tooltip: React.FC<TooltipProps> = ({ text, className, children }) => {
    const { isDaylight } = useSettingsKitTheme();
    const reduced = useKitReducedMotion();
    const anchorRef = useRef<HTMLSpanElement>(null);
    const labelRef = useRef<HTMLSpanElement>(null);
    const timerRef = useRef<number | undefined>(undefined);
    const [shown, setShown] = useState(false);
    // Where the label goes: known once the label is in the page and has its size.
    const [place, setPlace] = useState<PopoverPlace | null>(null);

    const show = () => setShown(true);
    const hide = useCallback(() => {
        window.clearTimeout(timerRef.current);
        setShown(false);
    }, []);
    useEffect(() => () => window.clearTimeout(timerRef.current), []);
    // A text that is taken away takes the label with it; it does not come back by itself.
    useEffect(() => {
        if (!text) hide();
    }, [text, hide]);
    // Before the paint, so the label is never seen anywhere but at its place; again for a new text,
    // which has a new size.
    useLayoutEffect(() => {
        const anchor = anchorRef.current;
        const label = labelRef.current;
        setPlace(shown && anchor && label
            ? placePopover(
                anchor.getBoundingClientRect(),
                { width: label.offsetWidth, height: label.offsetHeight },
                { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
                { side: 'over', align: 'center' },
            )
            : null);
    }, [shown, text]);
    // The part scrolling away under the label, or Escape, takes the label down.
    useEffect(() => {
        if (!shown) {
            return;
        }
        const hideOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') hide();
        };
        window.addEventListener('scroll', hide, true);
        window.addEventListener('keydown', hideOnEscape, true);
        return () => {
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('keydown', hideOnEscape, true);
        };
    }, [shown, hide]);

    if (!text) {
        return <span className={className}>{children}</span>;
    }

    return (
        <span
            ref={anchorRef}
            className={className}
            onMouseEnter={() => {
                timerRef.current = window.setTimeout(show, KIT_MOTION.tooltipDelay * 1000);
            }}
            onMouseLeave={hide}
            onMouseDown={hide}
            onFocus={(event) => {
                // Only for the keyboard: a part that was clicked is focused too.
                if (event.target.matches(':focus-visible')) show();
            }}
            onBlur={hide}
        >
            {children}
            {createPortal(
                <AnimatePresence>
                    {shown && (
                        <motion.span
                            ref={labelRef}
                            role="tooltip"
                            initial={{ opacity: 0 }}
                            // It comes the last few pixels from the part's side.
                            animate={place ? { opacity: 1, y: [place.side === 'over' ? 4 : -4, 0] } : { opacity: 0 }}
                            exit={{ opacity: 0 }}
                            transition={kitTransition('fast', reduced)}
                            className="pointer-events-none fixed z-[210] rounded-md px-2 py-1 text-xs leading-[18px] shadow-[0_6px_18px_rgba(0,0,0,0.3)] [overflow-wrap:anywhere]"
                            style={{
                                left: place?.left ?? 0,
                                ...(place?.bottom === undefined ? { top: place?.top ?? 0 } : { bottom: place.bottom }),
                                maxWidth: Math.min(MAX_WIDTH, window.innerWidth - 2 * POPOVER_GUTTER),
                                width: 'max-content',
                                color: isDaylight ? '#ffffff' : '#17171a',
                                backgroundColor: isDaylight ? '#26262b' : '#ececee',
                            }}
                        >
                            {text}
                        </motion.span>
                    )}
                </AnimatePresence>,
                document.body,
            )}
        </span>
    );
};

export default Tooltip;
