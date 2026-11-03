import React, { useLayoutEffect, useRef, useState } from 'react';
import { KIT_MOTION, useKitReducedMotion } from './motion';

// src/components/modal/settings/kit/Reveal.tsx
// Unfolding. Unfold grows its children from no height to their own and back (the CSS is .st-unfold
// in kit.css); the note of a row and a folded group are built on it. Reveal is the one way a page
// shows rows that depend on a switch or a choice.

type UnfoldProps = {
    open: boolean;
    /**
     * Leaves the children in the document while closed. They are inert then: neither the keyboard
     * nor assistive tech reaches them, whatever is open inside them.
     */
    keep?: boolean;
    /** Opens and closes without motion. */
    instant?: boolean;
    className?: string;
    children: React.ReactNode;
};

export const Unfold: React.FC<UnfoldProps> = ({ open, keep, instant, className, children }) => {
    const reduced = useKitReducedMotion();
    const ref = useRef<HTMLDivElement>(null);
    // `present`: the children are in the document. `shown`: they have the open look, which children
    // just put in the document take one step later, so there is a closed state to move from.
    const [present, setPresent] = useState(open);
    const [shown, setShown] = useState(open);
    if (open && !present) {
        setPresent(true);
    }

    useLayoutEffect(() => {
        if (open) {
            // Reading the layout makes the browser take in the closed state before it changes.
            ref.current?.getBoundingClientRect();
            setShown(true);
            return;
        }
        setShown(false);
        if (keep) {
            return;
        }
        // Out of the document once the closing has run its time.
        const timer = window.setTimeout(() => setPresent(false), reduced ? 0 : KIT_MOTION.unfold * 1000);
        return () => window.clearTimeout(timer);
    }, [open, keep, reduced]);

    if (!keep && !present) {
        return null;
    }

    return (
        <div
            ref={ref}
            className={`st-unfold${className ? ` ${className}` : ''}`}
            data-open={(keep ? open : open && shown) || undefined}
            data-instant={instant || undefined}
            inert={keep && !open}
        >
            <div>{children}</div>
        </div>
    );
};

type RevealProps = {
    /** The rows are shown while this holds; they are not in the document while it does not. */
    when: boolean;
    children: React.ReactNode;
};

/** Rows that depend on the row above them: they unfold when it turns them on and fold away when it turns them off. */
export const Reveal: React.FC<RevealProps> = ({ when, children }) => <Unfold open={when}>{children}</Unfold>;

export default Reveal;
