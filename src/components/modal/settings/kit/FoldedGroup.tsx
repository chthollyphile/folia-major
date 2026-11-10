import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SettingsAnchor } from '../navigation/SettingsAnchorContext';
import { GROUP_CARD_CLASS, GROUP_SPACING_CLASS } from './Group';
import type { SettingsGroupDef } from './options';
import { Unfold } from './Reveal';

// src/components/modal/settings/kit/FoldedGroup.tsx
// A rarely used group, folded into one row that opens it. The rows stay in the document while it
// is closed, so a landing can find a row inside; it finds the group through data-settings-fold and
// opens it with openFoldedGroup.

const OPEN_REQUEST = 'settings-fold-open';

/**
 * Opens the folded group `fold` is the root of and then runs `then`, with the rows already where
 * they end up: a landing scrolls to one of them next, so this opening has no motion.
 */
export const openFoldedGroup = (fold: Element, then: () => void) => {
    fold.dispatchEvent(new CustomEvent(OPEN_REQUEST, { detail: then }));
};

type FoldedGroupProps = {
    def: SettingsGroupDef;
    /** The group's current state in a word or two, shown on the closed row. */
    summary?: React.ReactNode;
    children: React.ReactNode;
};

export const FoldedGroup: React.FC<FoldedGroupProps> = ({ def, summary, children }) => {
    const { t } = useTranslation();
    const title = t(def.titleKey);
    const bodyId = useId();
    const rootRef = useRef<HTMLDivElement>(null);
    const [open, setOpen] = useState(false);
    // Set while the group was opened by a landing rather than by its own row.
    const [instant, setInstant] = useState(false);
    // What landings asked to run, and how many asked: each is answered, also when the group was
    // open already.
    const afterOpenRef = useRef<Array<() => void>>([]);
    const [requests, setRequests] = useState(0);

    useEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const handleRequest = (event: Event) => {
            afterOpenRef.current.push((event as CustomEvent<() => void>).detail);
            // Also for a group that is open and still unfolding: its rows go to where they end up.
            setInstant(true);
            setOpen(true);
            setRequests(count => count + 1);
        };
        root.addEventListener(OPEN_REQUEST, handleRequest);
        return () => root.removeEventListener(OPEN_REQUEST, handleRequest);
    }, []);

    // Runs what the landings asked for once the open group is in the document's layout.
    useLayoutEffect(() => {
        const waiting = afterOpenRef.current;
        afterOpenRef.current = [];
        waiting.forEach(then => then());
    }, [requests]);

    return (
        <SettingsAnchor anchorId={def.id} label={title} className={GROUP_SPACING_CLASS}>
            <div ref={rootRef} data-settings-fold className={GROUP_CARD_CLASS}>
                <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => {
                        setInstant(false);
                        setOpen(value => !value);
                    }}
                    className="st-focus-inside st-t-fast flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--st-fill)] focus-visible:rounded-[10px]"
                >
                    <span className="min-w-0 flex-1 text-sm leading-5 text-[color:var(--st-t1)]">{title}</span>
                    {summary && <span className="text-[13px] text-[color:var(--st-t2)]">{summary}</span>}
                    <ChevronRight size={16} className={`st-t-unfold shrink-0 text-[color:var(--st-t2)] transition-transform${open ? ' rotate-90' : ''}`} />
                </button>
                <Unfold keep open={open} instant={instant}>
                    <div id={bodyId}>{children}</div>
                </Unfold>
            </div>
        </SettingsAnchor>
    );
};

export default FoldedGroup;
