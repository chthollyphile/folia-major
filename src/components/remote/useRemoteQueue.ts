import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteQueueExpansion } from '../../types/remoteControl';

// src/components/remote/useRemoteQueue.ts
// Whether the remote window shows the play queue, and where. The queue key opens and closes it;
// Esc clears the search, then closes it; it leaves by itself when the pointer stays away, except
// while the search is being typed. Opening asks the main process which side has room, anchors the
// card on that side, then has the window grow (electron/remoteControlWindowGeometry.cjs).
// Growing up (or shrinking back down, or changing height while up) moves the window's top edge,
// and the compositor shows the last frame at the new spot before the page has laid itself out
// again: the card would jump for a frame. So the page fades out first, the window moves while
// nothing is drawn, and the page fades back in once it has painted at the new size.
// The list itself unfolds out of the card's edge and folds back into it (RemoteQueue). Below the
// card a queue that gets longer has the window grow first and the list slide down into the room;
// one that gets shorter has the list slide up first and the window shrink after.

/** The queue goes this long after the pointer leaves, as the sheet does. */
const QUEUE_IDLE_CLOSE_MS = 6000;
/** How long the list takes to unfold out of the card (RemoteQueue's animation). */
export const REMOTE_QUEUE_UNFOLD_MS = 340;
/** How long it takes to fold back in; the window shrinks after. */
export const REMOTE_QUEUE_FOLD_MS = 200;
/** How long the list's height takes to follow a longer or shorter queue below the card (RemoteQueue.css). */
const QUEUE_RESIZE_MS = 220;
/** How long the whole page takes to fade out before the window's top edge moves. */
const SHIFT_FADE_MS = 90;
/** The window's height without the queue (electron/remoteControlWindowGeometry.cjs). */
const REMOTE_WINDOW_HEIGHT = 184;

export const REMOTE_QUEUE_ROW_HEIGHT = 36;
export const REMOTE_QUEUE_MAX_VISIBLE_ROWS = 8;
/** The search field at the top of the list block. */
const QUEUE_SEARCH_HEIGHT = 40;
/** Space between the card and the list block, and under the last row. */
export const REMOTE_QUEUE_GAP = 6;
const QUEUE_GAP = REMOTE_QUEUE_GAP;

/** How much taller the window wants to be for a queue of `count` songs (an empty queue keeps one row for its note). */
export const remoteQueueWantedHeight = (count: number) => (
    QUEUE_GAP + QUEUE_SEARCH_HEIGHT + Math.max(1, Math.min(count, REMOTE_QUEUE_MAX_VISIBLE_ROWS)) * REMOTE_QUEUE_ROW_HEIGHT + QUEUE_GAP
);

type UseRemoteQueueParams = {
    queueLength: number;
    pointerInside: boolean;
    /** A click-through window is a display: the queue never shows. */
    isDisplayOnly: boolean;
    /** The sheet takes Esc first. */
    isSheetOpen: boolean;
};

export type RemoteQueueState = {
    /** Asked for: the key reads pressed. */
    isOpen: boolean;
    /** The side the card is anchored to: set before the window grows, cleared after it shrinks. */
    direction: RemoteQueueExpansion['direction'] | null;
    /** The list is drawn: open, and the window has grown. */
    isShown: boolean;
    /** The list block's height in px: what the window grew by, less the gap to the card. */
    panelHeight: number;
    /** The page is faded out while the window's top edge moves. */
    isShifting: boolean;
    query: string;
    setQuery: (query: string) => void;
    toggle: () => void;
    close: () => void;
};

const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));

/** Resolves once the page has the window's new height (or after a short while if it never comes), then two frames on. */
const settleAtHeight = async (height: number) => {
    await new Promise<void>(resolve => {
        if (Math.abs(window.innerHeight - height) <= 1) {
            resolve();
            return;
        }
        const done = () => {
            window.removeEventListener('resize', onResize);
            window.clearTimeout(timer);
            resolve();
        };
        const onResize = () => {
            if (Math.abs(window.innerHeight - height) <= 1) done();
        };
        window.addEventListener('resize', onResize);
        const timer = window.setTimeout(done, 300);
    });
    await nextFrame();
    await nextFrame();
};

export const useRemoteQueue = ({ queueLength, pointerInside, isDisplayOnly, isSheetOpen }: UseRemoteQueueParams): RemoteQueueState => {
    const [requested, setRequested] = useState(false);
    const [query, setQuery] = useState('');
    const [direction, setDirection] = useState<RemoteQueueExpansion['direction'] | null>(null);
    const [expansion, setExpansionState] = useState<RemoteQueueExpansion | null>(null);
    const expansionRef = useRef(expansion);
    const setExpansion = useCallback((next: RemoteQueueExpansion | null) => {
        expansionRef.current = next;
        setExpansionState(next);
    }, []);
    const [isShifting, setIsShifting] = useState(false);
    /** Bumped by every resize step; a fade is lifted only by the step that started it. */
    const shiftTokenRef = useRef(0);
    const directionRef = useRef(direction);
    directionRef.current = direction;
    const isOpen = requested && !isDisplayOnly;
    const wantedHeight = remoteQueueWantedHeight(queueLength);

    // A page that loads (a reload in development) starts closed: the window must not stay grown.
    useEffect(() => {
        void window.electron?.setRemoteControlQueueExpansion?.(null)?.catch(error => (
            console.warn('[RemoteQueue] Failed to reset the window height', error)
        ));
    }, []);

    // Turning click-through on closes the queue for good, not only for as long as it lasts.
    useEffect(() => {
        if (isDisplayOnly) {
            setRequested(false);
        }
    }, [isDisplayOnly]);

    // Grow, follow the queue's length, or shrink back. A newer request cancels a step still waiting.
    useEffect(() => {
        const resize = window.electron?.setRemoteControlQueueExpansion;
        let cancelled = false;

        // Fades the page out, runs `move`, and fades it back in once it has painted at the new height.
        const withPageHidden = async (move: () => Promise<number | null>) => {
            const token = ++shiftTokenRef.current;
            setIsShifting(true);
            try {
                await wait(SHIFT_FADE_MS);
                await nextFrame();
                await nextFrame();
                if (cancelled) return;
                const height = await move();
                if (height !== null) await settleAtHeight(height);
            } finally {
                if (shiftTokenRef.current === token) setIsShifting(false);
            }
        };

        const run = async () => {
            if (!resize) {
                // Opened in a browser: nothing to grow, the page shows the list as if it had.
                setDirection(isOpen ? 'down' : null);
                setExpansion(isOpen ? { direction: 'down', height: wantedHeight } : null);
                return;
            }

            if (isOpen) {
                if (!directionRef.current) {
                    const plan = await resize(wantedHeight, { preview: true });
                    if (cancelled || !plan) return;
                    // At the window's own height the card sits the same anchored to either side,
                    // so it does not move now, nor when the window grows on that side.
                    setDirection(plan.direction);
                    await nextFrame();
                    await nextFrame();
                    if (cancelled) return;
                }
                const apply = async () => {
                    // The side the card is anchored for goes along: a window that grew meanwhile, or a
                    // queue that got longer, does not make the main process pick the other side by itself.
                    const applied = await resize(wantedHeight, { direction: directionRef.current ?? undefined });
                    if (cancelled) return null;
                    // It only picks another side when the anchored one has no room left; follow it.
                    if (applied) setDirection(applied.direction);
                    return applied;
                };
                if (directionRef.current === 'up') {
                    let applied: RemoteQueueExpansion | null = null;
                    await withPageHidden(async () => {
                        applied = await apply();
                        return applied ? REMOTE_WINDOW_HEIGHT + (applied as RemoteQueueExpansion).height : null;
                    });
                    if (!cancelled) setExpansion(applied);
                } else {
                    shiftTokenRef.current++;
                    setIsShifting(false);
                    const shown = expansionRef.current;
                    if (shown && shown.direction === 'down' && wantedHeight < shown.height) {
                        // Shorter: the list slides up first, the window follows once it has.
                        setExpansion({ direction: 'down', height: wantedHeight });
                        await wait(QUEUE_RESIZE_MS);
                        if (cancelled) return;
                    }
                    // Longer (or opening): the window grows first, then the list slides into the room.
                    const applied = await apply();
                    if (!cancelled) setExpansion(applied);
                }
                return;
            }

            if (!directionRef.current) return;
            setExpansion(null);
            const shrink = async () => {
                await resize(null);
                if (!cancelled) setDirection(null);
                return REMOTE_WINDOW_HEIGHT;
            };
            // The list folds back into the card first; the page only fades once it is nearly in.
            if (directionRef.current === 'up') {
                await wait(REMOTE_QUEUE_FOLD_MS - SHIFT_FADE_MS / 2);
                if (cancelled) return;
                await withPageHidden(shrink);
            } else {
                await wait(REMOTE_QUEUE_FOLD_MS);
                if (cancelled) return;
                await shrink();
            }
        };

        run().catch(error => console.warn('[RemoteQueue] Failed to resize the window', error));
        return () => {
            cancelled = true;
        };
    }, [isOpen, wantedHeight, setExpansion]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || isSheetOpen) return;
            if (query) setQuery('');
            else setRequested(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, isSheetOpen, query]);

    // The search is being typed: its field has the caret and the window has the system's focus.
    const [isTyping, setIsTyping] = useState(false);
    useEffect(() => {
        if (!isOpen) {
            setIsTyping(false);
            return;
        }

        const sync = () => {
            const focused = document.activeElement;
            setIsTyping(document.hasFocus() && focused instanceof HTMLInputElement && focused.dataset.remoteQueueSearch !== undefined);
        };
        const stop = () => setIsTyping(false);
        sync();
        document.addEventListener('focusin', sync);
        document.addEventListener('focusout', sync);
        window.addEventListener('focus', sync);
        window.addEventListener('blur', stop);
        return () => {
            document.removeEventListener('focusin', sync);
            document.removeEventListener('focusout', sync);
            window.removeEventListener('focus', sync);
            window.removeEventListener('blur', stop);
        };
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || pointerInside || isTyping) {
            return;
        }

        const timer = window.setTimeout(() => setRequested(false), QUEUE_IDLE_CLOSE_MS);
        return () => window.clearTimeout(timer);
    }, [isOpen, pointerInside, isTyping]);

    // A closed queue starts again from the whole list next time.
    useEffect(() => {
        if (!isOpen) setQuery('');
    }, [isOpen]);

    const toggle = useCallback(() => setRequested(previous => !previous), []);
    const close = useCallback(() => setRequested(false), []);

    return {
        isOpen,
        direction,
        isShown: isOpen && expansion !== null,
        panelHeight: expansion ? expansion.height - QUEUE_GAP : 0,
        isShifting,
        query,
        setQuery,
        toggle,
        close,
    };
};
