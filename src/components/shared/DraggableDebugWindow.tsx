import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, useDragControls, useMotionValue } from 'framer-motion';
import { X } from 'lucide-react';

// src/components/shared/DraggableDebugWindow.tsx
// The shell both debug windows sit in: a title bar you can drag, a close button, and a position
// that is remembered.
//
// It exists because the session log was pinned to the top-right corner, which is where the thing
// you are debugging usually is. A log you have to close to see the problem is a log you read in
// halves.
//
// Three decisions worth keeping:
//
// - Dragging starts on the TITLE BAR only (`dragListener={false}` plus explicit controls). The body
//   is a log you select text in and a chart you hover; a whole-panel drag handle eats both.
// - Position is an OFFSET from a CSS anchor, not an absolute coordinate. Anchored top-right, a
//   window restored on a smaller screen comes back beside the corner it was placed near rather than
//   at coordinates that no longer exist.
// - Portalled to the body. `position: fixed` is measured against the nearest transformed ancestor,
//   not the viewport, and this app animates transformed containers all over the shell.

interface DraggableDebugWindowProps {
    /** Storage key for the remembered position. Distinct per window. */
    id: string;
    title: string;
    /** Shown small beside the title - the chord that opens this window. */
    shortcutLabel?: string;
    isDaylight: boolean;
    onClose: () => void;
    /** Tailwind width, so a chart window and a log window can be different sizes. */
    widthClass?: string;
    /**
     * Where this window sits the first time it is opened, as an offset from the anchor.
     *
     * Both windows anchor top-right, so without this the second one to open lands exactly on top of
     * the first and reads as the first having been replaced. Only a default: once it has been
     * dragged, the remembered position wins.
     */
    defaultOffset?: { x: number; y: number };
    children: React.ReactNode;
}

/** Keep at least this much of the window on screen, so it can always be grabbed back. */
const EDGE_MARGIN = 48;

const readStored = (id: string, fallback: { x: number; y: number }) => {
    try {
        const raw = localStorage.getItem(`debug_window_pos_${id}`);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw) as { x?: number; y?: number };
        return { x: Number(parsed.x) || 0, y: Number(parsed.y) || 0 };
    } catch {
        return fallback;
    }
};

const DraggableDebugWindow: React.FC<DraggableDebugWindowProps> = ({
    id,
    title,
    shortcutLabel,
    isDaylight,
    onClose,
    widthClass = 'w-[min(34rem,calc(100vw-2rem))]',
    defaultOffset = { x: 0, y: 0 },
    children,
}) => {
    const controls = useDragControls();
    const frameRef = useRef<HTMLDivElement>(null);
    const stored = useRef(readStored(id, defaultOffset)).current;
    const x = useMotionValue(stored.x);
    const y = useMotionValue(stored.y);

    /**
     * Pulls the window back if it has been dragged - or resized - off the edge, and writes the
     * position down. Without this, one drag past the bottom of the screen loses the title bar and
     * with it the only way to move it back.
     */
    const settle = useCallback(() => {
        const rect = frameRef.current?.getBoundingClientRect();
        if (rect) {
            let dx = 0;
            let dy = 0;
            if (rect.right < EDGE_MARGIN) dx = EDGE_MARGIN - rect.right;
            if (rect.left > window.innerWidth - EDGE_MARGIN) dx = window.innerWidth - EDGE_MARGIN - rect.left;
            if (rect.top < 0) dy = -rect.top;
            if (rect.top > window.innerHeight - EDGE_MARGIN) dy = window.innerHeight - EDGE_MARGIN - rect.top;
            if (dx) x.set(x.get() + dx);
            if (dy) y.set(y.get() + dy);
        }
        try {
            localStorage.setItem(`debug_window_pos_${id}`, JSON.stringify({ x: x.get(), y: y.get() }));
        } catch {
            // Blocked storage: the window still moves, it just forgets between sessions.
        }
    }, [id, x, y]);

    useEffect(() => {
        settle();
        window.addEventListener('resize', settle);
        return () => window.removeEventListener('resize', settle);
    }, [settle]);

    const shellClass = isDaylight
        ? 'bg-white/76 text-zinc-900 border border-black/10 shadow-[0_18px_60px_rgba(0,0,0,0.14)]'
        : 'bg-black/58 text-white border border-white/10 shadow-[0_18px_60px_rgba(0,0,0,0.32)]';

    return createPortal(
        // z-300: above the modals, because a dialog is often the thing being debugged. Below the
        // 9999 titlebar drag strip, which paints nothing and takes no pointer events.
        <div className={`pointer-events-none fixed top-4 right-4 z-[300] ${widthClass}`}>
            <motion.div
                ref={frameRef}
                style={{ x, y }}
                drag
                dragListener={false}
                dragControls={controls}
                dragMomentum={false}
                dragElastic={0}
                onDragEnd={settle}
                className={`pointer-events-auto flex max-h-[calc(100vh-2rem)] flex-col rounded-2xl backdrop-blur-2xl font-mono ${shellClass}`}
            >
                <div
                    // `touch-none` so a pen or touch drag moves the window instead of scrolling the
                    // page under it, which is what a title bar is for.
                    className="flex shrink-0 cursor-grab touch-none select-none items-center gap-3 px-4 pt-3 pb-2 active:cursor-grabbing"
                    onPointerDown={event => controls.start(event)}
                >
                    <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-[0.24em] opacity-60">{title}</div>
                    </div>
                    {shortcutLabel && (
                        <div className="shrink-0 text-[10px] opacity-70 whitespace-nowrap">{shortcutLabel}</div>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        // Stops the press from also starting a drag - a close button that moves the
                        // window when you miss it by a pixel reads as broken.
                        onPointerDown={event => event.stopPropagation()}
                        className={`shrink-0 rounded p-1 transition-colors ${isDaylight ? 'hover:bg-black/[0.08]' : 'hover:bg-white/[0.12]'}`}
                    >
                        <X size={12} />
                    </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
                    {children}
                </div>
            </motion.div>
        </div>,
        document.body,
    );
};

export default DraggableDebugWindow;
