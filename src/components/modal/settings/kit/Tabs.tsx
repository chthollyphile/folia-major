import React, { useId, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { kitTransition, useKitReducedMotion } from './motion';

// src/components/modal/settings/kit/Tabs.tsx
// A strip of text tabs, closed by a hairline. The chosen tab carries a line in the accent colour,
// which slides to a new choice. A tab can carry a small dot: something on it needs attention. One
// action can sit at the strip's right end. Tabs that do not fit scroll sideways; the action stays,
// and the chosen tab is kept in sight.
//
// Keyboard: left and right go to the next tab, choose it, and go round. Tab reaches the chosen tab
// only, as in any tab list; with `contents` nothing is called a tab list, so there Tab reaches
// every tab.

/** How far from the strip's left edge a tab that was out of view is brought to. */
const TAB_REVEAL_INSET = 32;

type TabsProps = {
    tabs: ReadonlyArray<{ id: string; label: string; dot?: boolean }>;
    /** The chosen tab. */
    activeId: string | null;
    onSelect: (id: string) => void;
    /** One action at the right end. It brings its own space to the edge. */
    action?: React.ReactNode;
    /**
     * The tabs are the parts of one page, not views that take each other's place: the chosen one is
     * said as the place the page is at, and nothing is called a tab.
     */
    contents?: boolean;
    /** What the tabs choose, for a screen reader. */
    label?: string;
    /** The padding around the tabs. */
    className?: string;
};

export const Tabs: React.FC<TabsProps> = ({ tabs, activeId, onSelect, action, contents, label, className = '' }) => {
    const reduced = useKitReducedMotion();
    const stripRef = useRef<HTMLDivElement>(null);
    const activeRef = useRef<HTMLButtonElement>(null);
    const id = useId();
    // One line per set of tabs: it slides between the tabs of a set, not over from the last set's tab.
    const markId = `${id}${tabs[0]?.id ?? ''}`;
    // Where Tab lands in a tab list: on the chosen tab, or on the first where none is chosen.
    const stopId = tabs.some(tab => tab.id === activeId) ? activeId : tabs[0]?.id;

    // Before the paint, so the strip is never seen at its old place.
    useLayoutEffect(() => {
        const strip = stripRef.current;
        const tab = activeRef.current;
        if (!strip || !tab) {
            return;
        }
        if (tab.offsetLeft < strip.scrollLeft || tab.offsetLeft + tab.offsetWidth > strip.scrollLeft + strip.clientWidth) {
            strip.scrollLeft = tab.offsetLeft - TAB_REVEAL_INSET;
        }
    }, [activeId]);

    // The two keys the strip uses stop here, so nothing behind it acts on them as well.
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        const at = Array.from(event.currentTarget.children).indexOf(document.activeElement as Element);
        if (!step || at < 0 || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const next = (at + step + tabs.length) % tabs.length;
        (event.currentTarget.children[next] as HTMLElement).focus();
        onSelect(tabs[next].id);
    };

    return (
        <div className="flex border-b border-[var(--st-line)]">
            {/* layoutScroll: the line is measured inside a strip that may be scrolled sideways. */}
            <motion.div
                ref={stripRef}
                layoutScroll
                role={contents ? undefined : 'tablist'}
                aria-label={label}
                onKeyDown={handleKeyDown}
                className={`relative flex min-w-0 flex-1 gap-[18px] overflow-x-auto [scrollbar-width:none] md:gap-[22px] ${className}`}
            >
                {tabs.map((tab) => {
                    const current = tab.id === activeId;
                    return (
                        <button
                            key={tab.id}
                            ref={current ? activeRef : undefined}
                            type="button"
                            // The mark is a line and a colour; assistive tech and tests need the state said out loud.
                            role={contents ? undefined : 'tab'}
                            aria-selected={contents ? undefined : current}
                            aria-current={contents && current ? 'true' : undefined}
                            tabIndex={contents || tab.id === stopId ? 0 : -1}
                            onClick={() => onSelect(tab.id)}
                            className={`st-focus-inside st-t-fast relative -mx-1 h-9 shrink-0 whitespace-nowrap rounded-md px-1 text-[13px] transition-colors hover:text-[color:var(--st-t1)] ${current ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)]'}`}
                        >
                            {tab.label}
                            {tab.dot && <span aria-hidden className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--st-warn)] align-middle" />}
                            {current && (
                                // One line shared by the tabs: framer-motion moves it to the new one,
                                // and only when the choice changes.
                                <motion.span
                                    layoutId={markId}
                                    layoutDependency={activeId}
                                    transition={kitTransition('move', reduced)}
                                    className="absolute inset-x-1 bottom-0 h-0.5 bg-[var(--st-accent)]"
                                    style={{ borderTopLeftRadius: 2, borderTopRightRadius: 2 }}
                                />
                            )}
                        </button>
                    );
                })}
            </motion.div>
            {/* On the line of the tabs, whatever padding the strip has above them. */}
            {action !== undefined && <div className="flex h-9 shrink-0 items-center self-end pl-3">{action}</div>}
        </div>
    );
};

export default Tabs;
