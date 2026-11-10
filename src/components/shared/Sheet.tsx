import React, { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent } from 'framer-motion';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Theme } from '../../types';
import { SettingsKitThemeContext, settingsTokens, useSettingsKitTheme } from '../modal/settings/kit/kitTheme';
import { KIT_EASE, KIT_MOTION, kitMotionTokens, kitTransition, useKitReducedMotion } from '../modal/settings/kit/motion';
import { Tooltip } from '../modal/settings/kit';
import { escapeCloses, tabTarget } from './sheetKeys';

// src/components/shared/Sheet.tsx
// The frame of every dialog: a title and the close button at the top, the content in the middle,
// a note at the left and the actions at the right of the bottom, in three sizes. It looks like the
// settings window and is drawn outside it, so it sets the settings kit's colour and motion
// variables on itself; parts of the kit work inside it wherever it opens. The accent is the theme's:
// the app shell and the settings window hand the theme down as the kit theme.
//
// It is drawn in a layer of the app shell, not where it is rendered: what surrounds the part that
// opened it does not reach it (a margin between siblings, or a panel with a backdrop filter or a
// transform, which a fixed overlay is measured against instead of the window). React events still
// bubble to that part.
//
// While it is open the keyboard belongs to it: focus goes in, Tab stays in, and Escape closes the
// topmost sheet and nothing under it. Closing gives focus back to what opened it.

/**
 * s: a question or a short notice. m: a dialog with content of its own. l: a work window. xl: a work
 * window with two wide panes.
 * side: a dialog with a column of choices beside its content (`aside`); it is at least 420 high,
 * or as high as the window lets it be: in a lower window its body scrolls, as in the other sizes.
 */
export type SheetSize = 's' | 'm' | 'l' | 'xl' | 'side';

const SIZE_CLASS: Record<SheetSize, string> = {
    s: 'w-[400px]',
    m: 'w-[600px]',
    l: 'h-[720px] w-[880px]',
    xl: 'h-[720px] w-[1160px]',
    side: 'min-h-[min(420px,100%)] w-[772px]',
};

const BODY_CLASS = {
    // st-scroll: the kit's thin scrollbar.
    scroll: 'st-scroll overflow-y-auto overscroll-contain',
    fill: 'flex flex-col overflow-hidden',
    panes: 'flex overflow-hidden',
} as const;

/** What Tab can stop at. */
const TAB_STOP_SELECTOR = 'a[href], button, input, select, textarea, [tabindex]';

export const tabStops = (panel: HTMLElement): HTMLElement[] => (
    Array.from(panel.querySelectorAll<HTMLElement>(TAB_STOP_SELECTOR)).filter(node => (
        node.tabIndex >= 0
        && !node.hasAttribute('disabled')
        && !node.closest('[inert]')
        && node.getClientRects().length > 0
    ))
);

/**
 * Where sheets are drawn: an element the app shell offers, inside its colour variables and over its
 * pages and windows. Null while the shell has not drawn that element yet. Without a shell (a page
 * that is not the app), the document body.
 */
export const SheetLayerContext = createContext<HTMLElement | null | undefined>(undefined);

/** The open sheets, the topmost last. The keyboard belongs to the topmost one. */
const openSheets: symbol[] = [];

/**
 * The variables of the sheet's panel: the settings kit's, and what the kit does not hold: the colour
 * of the text on a red button, and the sheet's shadow. The text colour is the app's, or the
 * overlay's stand-in where the sheet is drawn outside the app shell.
 */
const panelTokens = (isDaylight: boolean, theme: Theme | undefined, reduced: boolean): CSSProperties => ({
    '--text-primary': 'var(--sheet-ink)',
    ...settingsTokens(isDaylight, theme),
    ...kitMotionTokens(reduced),
    '--st-on-err': isDaylight ? '#ffffff' : '#1b1012',
    '--sheet-shadow': isDaylight ? '0 36px 90px rgba(0, 0, 0, 0.26)' : '0 36px 90px rgba(0, 0, 0, 0.6)',
} as CSSProperties);

/**
 * The dim layer, and the text colour for a sheet drawn outside the app shell, where its
 * --text-primary does not reach: the theme's own, or a plain one where there is no theme either.
 */
const overlayTokens = (isDaylight: boolean, theme: Theme | undefined): CSSProperties => ({
    '--sheet-scrim': isDaylight ? 'rgba(24, 18, 12, 0.36)' : 'rgba(0, 0, 0, 0.52)',
    '--sheet-ink': `var(--text-primary, ${theme?.primaryColor ?? (isDaylight ? '#18181b' : '#f4f4f5')})`,
} as CSSProperties);

type SheetProps = {
    isOpen: boolean;
    onClose: () => void;
    size?: SheetSize;
    title: string;
    /** One line under the title. */
    subtitle?: React.ReactNode;
    /** Beside the title, before the close button. */
    headerActions?: React.ReactNode;
    children: React.ReactNode;
    /** The actions, at the right of the bottom. */
    footer?: React.ReactNode;
    /** A note or a state, at the left of the bottom. */
    footerNote?: React.ReactNode;
    /**
     * Who scrolls. 'scroll', the default: the body, inside the sheet's padding. 'fill': the body is a
     * padded column that does not scroll; the content fills it and scrolls a part of itself.
     * 'panes': as fill, without the padding and side by side, with a line under the header: for a
     * work window that lays out its own panes.
     */
    body?: 'scroll' | 'fill' | 'panes';
    /** Light or dark. Left out, it is the app's, or the settings window's inside that window. */
    isDaylight?: boolean;
    /** Blocks the X, a click outside and Escape, while a close would leave work half done. */
    closeDisabled?: boolean;
    /** Shown on the dimmed X: what has to finish before the sheet can close. */
    closeDisabledTip?: string;
    /** Shown on the X while it can close. */
    closeTip?: string;
    /** Before the title, on its line: a mark of what the sheet is for. */
    titleLead?: React.ReactNode;
    /** A column at the left, over the whole height of the sheet, beside the header too. */
    aside?: React.ReactNode;
    /** Drawn on the sheet's surface, behind everything else in it: a tint. It takes no pointer. */
    underlay?: React.ReactNode;
    /**
     * The height the sheet has at rest. Its top edge stays where a sheet of that height sits when
     * centred, so content that unfolds makes it taller downwards only.
     */
    restHeight?: number;
    /** Drawn over everything in the sheet but the close button: a picture the sheet ends on. It takes no pointer. */
    overlay?: React.ReactNode;
    /** The title fades out: the sheet is about to show something over itself. The close button stays. */
    quiet?: boolean;
    /** How the sheet leaves. 'through': it grows a little and fades, as if passed through. */
    leave?: 'through';
    /** Where the sheet comes from, as an offset in px from where it rests: it arrives from that side. */
    from?: { x: number; y: number } | null;
    /** The lesson marker of the sheet, for Ponder: on the whole panel, its column and title row too. */
    ponderId?: string;
};

type SheetFrameProps = Omit<SheetProps, 'isOpen'>;

/** With a column: the column at the left and the rest beside it. Without one: the rest as it is. */
const withAside = (aside: React.ReactNode, rest: React.ReactNode): React.ReactNode => (
    aside
        ? (
            <div className="relative flex min-h-0 flex-1">
                {aside}
                <div className="flex min-w-0 flex-1 flex-col">{rest}</div>
            </div>
        )
        : rest
);

const SheetFrame: React.FC<SheetFrameProps> = ({
    onClose,
    size = 'm',
    title,
    subtitle,
    headerActions,
    children,
    footer,
    footerNote,
    body = 'scroll',
    isDaylight: isDaylightProp,
    closeDisabled = false,
    closeDisabledTip,
    closeTip,
    titleLead,
    aside,
    underlay,
    restHeight,
    overlay,
    quiet = false,
    leave,
    from,
    ponderId,
}) => {
    const { t } = useTranslation();
    const kitTheme = useSettingsKitTheme();
    const isDaylight = isDaylightProp ?? kitTheme.isDaylight;
    const theme = kitTheme.theme;
    const reduced = useKitReducedMotion();
    // False from the moment the sheet starts to leave: it lets go of the keyboard and the pointer
    // then, not when its exit has finished.
    const isPresent = useIsPresent();
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const isMouseDownOnOverlayRef = useRef(false);
    // What had focus before the sheet took it: read while rendering, before anything inside mounts.
    const [opener] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));
    const childTheme = useMemo(() => ({ isDaylight, theme }), [isDaylight, theme]);

    const requestClose = () => {
        if (!closeDisabled) onClose();
    };
    const requestCloseRef = useRef(requestClose);
    requestCloseRef.current = requestClose;
    const closeDisabledRef = useRef(closeDisabled);
    closeDisabledRef.current = closeDisabled;

    useEffect(() => {
        const panel = panelRef.current;
        if (!isPresent || !panel) {
            return undefined;
        }

        const token = Symbol('sheet');
        openSheets.push(token);
        if (!panel.contains(document.activeElement)) {
            (panel.querySelector<HTMLElement>('[data-autofocus]') ?? panel).focus({ preventScroll: true });
        }

        // On the document, so the parts inside the sheet see a key first (an open pick list closes
        // on Escape and stops the key) and the windows listening on `window` never see it.
        const handleKeyDown = (event: KeyboardEvent) => {
            if (openSheets[openSheets.length - 1] !== token) {
                return;
            }
            if (event.key === 'Escape') {
                event.stopPropagation();
                const closes = escapeCloses({
                    taken: event.defaultPrevented,
                    held: event.repeat,
                    composing: event.isComposing,
                    popupOpen: panel.querySelector('[aria-haspopup][aria-expanded="true"]') !== null,
                    closeDisabled: closeDisabledRef.current,
                });
                if (closes) {
                    event.preventDefault();
                    requestCloseRef.current();
                }
                return;
            }
            if (event.key === 'Tab') {
                // Focus is in another window that has the keyboard (the Ponder stage, opened over the sheet): Tab is that window's.
                const owner = document.activeElement?.closest('[data-folia-keyboard-window="true"]');
                if (owner && !owner.contains(panel)) {
                    return;
                }
                const stops = tabStops(panel);
                const target = tabTarget(stops.length, stops.indexOf(document.activeElement as HTMLElement), event.shiftKey);
                if (stops.length === 0 || target !== null) {
                    event.preventDefault();
                    (target === null ? panel : stops[target]).focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            openSheets.splice(openSheets.indexOf(token), 1);
            // Back to what opened the sheet, unless focus has since been put somewhere else.
            const active = document.activeElement;
            if (opener?.isConnected && (!active || active === document.body || panel.contains(active))) {
                opener.focus({ preventScroll: true });
            }
        };
    }, [isPresent, opener]);

    // Where the panel comes from and goes back to: a little lower and a little smaller.
    const away = { opacity: 0, x: 0, y: 12, scale: 0.985 };
    // Read once, when the sheet arrives: a change of `from` afterwards moves nothing.
    const [cameFrom] = useState(() => (from ? { opacity: 0, x: from.x, y: from.y, scale: 0.9 } : away));
    const exit = leave === 'through'
        ? { opacity: 0, scale: 1.08, transition: { duration: reduced ? 0 : KIT_MOTION.unfold, ease: KIT_EASE.standard } }
        : { ...away, transition: kitTransition('move', reduced) };

    return (
        <div
            data-folia-keyboard-window={isPresent ? 'true' : undefined}
            // What hasOpenSheet (utils/keyboardTargets) looks for.
            data-folia-sheet={isPresent ? 'true' : undefined}
            inert={!isPresent}
            className={`fixed inset-0 z-[200] flex justify-center p-4 ${restHeight ? 'items-start' : 'items-center'}`}
            style={restHeight
                ? { ...overlayTokens(isDaylight, theme), paddingTop: `max(16px, calc(50vh - ${restHeight / 2}px))` }
                : overlayTokens(isDaylight, theme)}
            onMouseDown={(event) => {
                isMouseDownOnOverlayRef.current = event.target === event.currentTarget;
            }}
            onClick={(event) => {
                if (event.target === event.currentTarget && isMouseDownOnOverlayRef.current) requestClose();
            }}
        >
            <motion.div
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={kitTransition('move', reduced)}
                className="pointer-events-none absolute inset-0 bg-[var(--sheet-scrim)]"
            />
            <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                data-ponder={ponderId}
                tabIndex={-1}
                initial={cameFrom}
                animate={{ opacity: 1, x: 0, y: 0, scale: 1, transition: kitTransition('unfold', reduced) }}
                exit={exit}
                className={`st-window relative flex max-h-[min(720px,100%)] max-w-full flex-col overflow-hidden rounded-2xl bg-[var(--st-win)] text-[color:var(--st-t1)] shadow-[var(--sheet-shadow),0_0_0_1px_var(--st-line2)] ${SIZE_CLASS[size]}${underlay ? ' isolate' : ''}`}
                // The panel holds focus without a mark of its own.
                style={{ outline: 'none', ...panelTokens(isDaylight, theme, reduced) }}
            >
                <SettingsKitThemeContext.Provider value={childTheme}>
                    {underlay && <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">{underlay}</div>}
                    {overlay && <div aria-hidden className="pointer-events-none absolute inset-0 z-10">{overlay}</div>}
                    {withAside(aside, <>
                    <header className={`flex shrink-0 items-start gap-3 pl-6 pr-4 pt-4 ${body === 'panes' ? 'border-b border-[var(--st-line)] pb-3' : ''}`}>
                        <div className={`st-t-fast min-w-0 flex-1 transition-opacity ${quiet ? 'opacity-0' : ''}`}>
                            <h2 id={titleId} className={`text-base font-semibold leading-8 ${titleLead ? 'flex items-center gap-2.5' : ''}`}>
                                {titleLead}
                                {titleLead ? <span className="min-w-0 truncate">{title}</span> : title}
                            </h2>
                            {subtitle && (
                                <p className="-mt-0.5 text-xs leading-[18px] text-[color:var(--st-t2)]">{subtitle}</p>
                            )}
                        </div>
                        {headerActions && (
                            <div className="flex min-h-8 shrink-0 items-center gap-2">{headerActions}</div>
                        )}
                        <Tooltip text={closeDisabled ? closeDisabledTip : closeTip} className={`inline-flex shrink-0 ${overlay ? 'relative z-20' : ''}`}>
                            <button
                                type="button"
                                onClick={requestClose}
                                aria-label={t('ui.close')}
                                // Not `disabled`: the dimmed X still takes the pointer and the keyboard, so its tip can show.
                                aria-disabled={closeDisabled || undefined}
                                className={`st-t-fast grid h-8 w-8 place-items-center rounded-lg text-[color:var(--st-t2)] transition-[background-color,color,opacity] ${closeDisabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)]'}`}
                            >
                                <X size={16} />
                            </button>
                        </Tooltip>
                    </header>

                    <div className={`min-h-0 flex-1 ${BODY_CLASS[body]} ${body === 'panes' ? '' : `px-6 ${size === 's' ? 'pb-4 pt-1' : 'pb-5 pt-3'}`}`}>
                        {children}
                    </div>

                    {(footer || footerNote) && (
                        <footer className={`flex shrink-0 flex-wrap items-center justify-end gap-2 px-4 ${size === 's' ? 'pb-4 pt-1' : 'border-t border-[var(--st-line)] py-3'}`}>
                            {footerNote && (
                                <div className="mr-auto min-w-0 flex-1 text-xs leading-[18px] text-[color:var(--st-t2)]">{footerNote}</div>
                            )}
                            {footer}
                        </footer>
                    )}
                    </>)}
                </SettingsKitThemeContext.Provider>
            </motion.div>
        </div>
    );
};

export const Sheet: React.FC<SheetProps> = ({ isOpen, ...frame }) => {
    const layer = useContext(SheetLayerContext);
    // Drawn in the body now, the sheet would be mounted again in the shell's layer one render later.
    if (layer === null) {
        return null;
    }

    return createPortal(
        <AnimatePresence>
            {isOpen && <SheetFrame {...frame} />}
        </AnimatePresence>,
        layer ?? document.body,
    );
};

const BUTTON_CLASS = 'st-t-fast inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] transition-[background-color,color,opacity,scale] enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40';

const BUTTON_VARIANT_CLASS = {
    fill: 'bg-[var(--st-fill)] text-[color:var(--st-t1)] enabled:hover:bg-[var(--st-fill2)]',
    primary: 'bg-[var(--st-accent)] text-[color:var(--st-on-accent)] enabled:hover:opacity-90',
    danger: 'bg-[var(--st-err)] text-[color:var(--st-on-err)] enabled:hover:opacity-90',
} as const;

type SheetButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'> & {
    /** primary: the one action the sheet ends on. danger: that action, when it destroys something. */
    variant?: 'primary' | 'danger';
};

/** A button of a sheet's bottom line: filled by default, as the settings kit's button is. */
export const SheetButton: React.FC<SheetButtonProps> = ({ variant, ...button }) => (
    <button type="button" {...button} className={`${BUTTON_CLASS} ${BUTTON_VARIANT_CLASS[variant ?? 'fill']}`} />
);

export default Sheet;
