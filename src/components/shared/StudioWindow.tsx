import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import type { Theme } from '../../types';
import { Tooltip } from '../modal/settings/kit';
import { SettingsKitThemeContext, settingsTokens } from '../modal/settings/kit/kitTheme';
import { kitMotionTokens, kitTransition, useKitReducedMotion } from '../modal/settings/kit/motion';
import { tabStops } from './Sheet';
import { tabTarget } from './sheetKeys';

// src/components/shared/StudioWindow.tsx
// The frame of a work window that shows what it edits: a header (back, title, a slot, actions), a
// stage at the left for the live sample, and a column 420px wide at the right for the options. It
// looks like the settings window and sets the settings kit's colour and motion variables on
// itself, so the kit's parts work anywhere inside it. 1240 by 780, never larger than the app's
// window. Where that window is narrower than 1024px the column goes under the stage and the two
// scroll together; the stage then has a height of its own, so what fills it still has one.
// It knows nothing of what it frames.
//
// It is drawn where it is rendered, inside an AnimatePresence: it comes in with the kit's `unfold`
// and leaves with `move`. A press on the dim layer around it, and the back button, ask to close.
// Escape is the owner's: the settings window, which opens both work windows, closes them on it.
// Tab stays inside the window; closing gives focus back to what opened it.

type StudioWindowProps = {
    title: string;
    /** Asked for by the back button and by a press outside the window. */
    onBack: () => void;
    /** What the back button is called. */
    backLabel: string;
    /** Beside the title, as wide as the header leaves: a choice of what is edited, a hint that may be cut short. */
    slot?: React.ReactNode;
    /** At the right end of the header. */
    actions?: React.ReactNode;
    /** The left part: the sample, and what belongs under it. A column; a child with a height of 100% or `flex-1` fills it. */
    stage: React.ReactNode;
    /** The right column, a bare box 420px wide: tabs at the top and a part that scrolls (StudioColumnBody), or a column that brings both. */
    children: React.ReactNode;
    /**
     * Drawn over the whole window: a picker that takes it over for a moment. While it is there the
     * header, the stage and the column cannot be reached, the keyboard is inside it, and Escape
     * asks for `onOverClose` instead of reaching the owner; when it goes, focus returns to where it was.
     */
    over?: React.ReactNode;
    onOverClose?: () => void;
    isDaylight: boolean;
    /** Gives the accent. */
    theme?: Theme;
    /** The lesson marker of the window, for Ponder. */
    ponderId?: string;
};

/** Where the window comes from: a little lower and a little smaller. It leaves a shorter way. */
const ARRIVE_FROM = { opacity: 0, y: 12, scale: 0.985 };
const LEAVE_TO = { opacity: 0, y: 8, scale: 0.99 };

export const StudioWindow: React.FC<StudioWindowProps> = ({
    title, onBack, backLabel, slot, actions, stage, children, over, onOverClose, isDaylight, theme, ponderId,
}) => {
    const reduced = useKitReducedMotion();
    // False from the moment the window starts to leave: nothing in it can be used then, and the
    // layer around it still takes the presses, so none falls through to the page behind.
    const isPresent = useIsPresent();
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const pressedOutside = useRef(false);
    // What had focus before the window took it: read while rendering, before anything inside mounts.
    const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    const kitTheme = useMemo(() => ({ isDaylight, theme }), [isDaylight, theme]);

    // The keyboard starts inside the window, and goes back to what opened it.
    useEffect(() => {
        const panel = panelRef.current;
        if (panel && !panel.contains(document.activeElement)) {
            panel.focus({ preventScroll: true });
        }
        return () => {
            const active = document.activeElement;
            if (opener?.isConnected && (!active || active === document.body || panel?.contains(active))) {
                opener.focus({ preventScroll: true });
            }
        };
    }, [opener]);

    // What had focus when the layer over the window came: read while rendering, before the parts
    // under the layer are made inert and lose it.
    const hasOver = Boolean(over);
    const overRef = useRef<HTMLDivElement>(null);
    const [overState, setOverState] = useState<{ shown: boolean; from: HTMLElement | null }>({ shown: false, from: null });
    if (hasOver !== overState.shown) {
        setOverState({ shown: hasOver, from: hasOver && document.activeElement instanceof HTMLElement ? document.activeElement : null });
    }
    const overFrom = overState.from;

    // The keyboard goes into the layer when it comes, and back to where it was when it goes: to
    // the window's own frame where what opened the layer is no longer there.
    useEffect(() => {
        if (!hasOver) {
            return undefined;
        }
        const layer = overRef.current;
        // A layer that has taken the focus itself keeps it where it put it.
        if (!layer?.contains(document.activeElement)) {
            ((layer && tabStops(layer)[0]) ?? panelRef.current)?.focus({ preventScroll: true });
        }
        return () => {
            (overFrom?.isConnected ? overFrom : panelRef.current)?.focus({ preventScroll: true });
        };
    }, [hasOver, overFrom]);

    // A key pressed with the focus on nothing (what held it was taken away) reaches no key handler
    // of the window. While a layer is open such an Escape closes the layer too: it is heard on the
    // document, before the owner hears it.
    const overCloseRef = useRef(onOverClose);
    overCloseRef.current = onOverClose;
    useEffect(() => {
        if (!hasOver) {
            return undefined;
        }
        const onKey = (event: KeyboardEvent) => {
            const onNothing = event.target === document.body || event.target === document.documentElement;
            if (onNothing && event.key === 'Escape' && overCloseRef.current && !event.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                overCloseRef.current();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [hasOver]);

    // Tab goes round inside the window. A key from a dialog opened over it is that dialog's.
    const keepTabInside = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const panel = panelRef.current;
        if (!panel || !panel.contains(event.target as Node)) {
            return;
        }
        // Escape closes the layer over the window first; the owner does not hear of that press.
        if (event.key === 'Escape' && hasOver && onOverClose && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            onOverClose();
            return;
        }
        if (event.key !== 'Tab') {
            return;
        }
        const stops = tabStops(panel);
        const target = tabTarget(stops.length, stops.indexOf(document.activeElement as HTMLElement), event.shiftKey);
        if (stops.length === 0 || target !== null) {
            event.preventDefault();
            (target === null ? panel : stops[target]).focus();
        }
    };

    return (
        <div
            className="fixed inset-0 z-[140] flex items-center justify-center p-3 sm:p-5"
            // Only a press that began on the dim layer closes: a slider let go outside the window does not.
            onMouseDown={(event) => {
                pressedOutside.current = event.target === event.currentTarget;
            }}
            onClick={(event) => {
                if (isPresent && event.target === event.currentTarget && pressedOutside.current) onBack();
            }}
        >
            <motion.div
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={kitTransition('move', reduced)}
                // The dim layer of the app's dialogs (Sheet), over a blur: the settings window lies behind.
                className={`pointer-events-none absolute inset-0 backdrop-blur-xl ${isDaylight ? 'bg-[rgba(24,18,12,0.36)]' : 'bg-[rgba(0,0,0,0.52)]'}`}
            />
            <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                inert={!isPresent}
                data-ponder={ponderId}
                onKeyDown={keepTabInside}
                initial={ARRIVE_FROM}
                animate={{ opacity: 1, y: 0, scale: 1, transition: kitTransition('unfold', reduced) }}
                exit={{ ...LEAVE_TO, transition: kitTransition('move', reduced) }}
                className="st-window relative grid h-[780px] max-h-full w-[1240px] max-w-full grid-rows-[64px_minmax(0,1fr)] overflow-hidden rounded-2xl bg-[var(--st-win)] text-[color:var(--st-t1)] shadow-[0_36px_90px_rgba(0,0,0,0.5),0_0_0_1px_var(--st-line2)]"
                // The window holds focus without a mark of its own.
                style={{ outline: 'none', ...settingsTokens(isDaylight, theme), ...kitMotionTokens(reduced) }}
            >
                <SettingsKitThemeContext.Provider value={kitTheme}>
                    <header inert={hasOver} className="flex min-w-0 items-center gap-2 pl-4 pr-5">
                        <Tooltip text={backLabel} className="inline-flex shrink-0">
                            <button
                                type="button"
                                onClick={onBack}
                                aria-label={backLabel}
                                className="st-t-fast grid h-8 w-8 place-items-center rounded-lg text-[color:var(--st-t2)] transition-colors hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)]"
                            >
                                <ChevronLeft size={18} />
                            </button>
                        </Tooltip>
                        <h2 id={titleId} className="ml-1 mr-2 shrink-0 whitespace-nowrap text-xl font-semibold leading-8">{title}</h2>
                        <div className="flex min-w-0 flex-1 items-center gap-2">{slot}</div>
                        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
                    </header>
                    <div inert={hasOver} className="st-scroll flex min-h-0 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:overflow-hidden">
                        <section className="flex h-[64vh] min-h-[380px] min-w-0 shrink-0 flex-col gap-4 px-4 pb-6 sm:px-6 lg:h-auto lg:min-h-0">{stage}</section>
                        <aside className="flex min-w-0 shrink-0 flex-col border-t border-[var(--st-line)] lg:min-h-0 lg:border-l lg:border-t-0">
                            {children}
                        </aside>
                    </div>
                    {hasOver && <div ref={overRef} className="contents">{over}</div>}
                </SettingsKitThemeContext.Provider>
            </motion.div>
        </div>
    );
};

/** The part of the column under its tabs: it holds the open tab's groups and scrolls where the window is wide enough for two columns. */
export const StudioColumnBody: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="st-scroll px-4 pb-10 sm:pl-6 sm:pr-3 lg:min-h-0 lg:flex-1 lg:overflow-y-scroll">{children}</div>
);

export default StudioWindow;
