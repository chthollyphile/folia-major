import React from 'react';
import { X } from 'lucide-react';
import { Tabs } from './Tabs';

// src/components/modal/settings/kit/PageHeader.tsx
// The head of a settings page: a row with its title and the close button, and under it the kit's
// Tabs, one tab for each group on the page. The tab of the group in view carries the line, which
// slides to another tab as the page scrolls; a click on a tab goes to its group. A hairline closes
// the head. A page of one group has no tabs, and a `summary` takes their place.

type PageHeaderProps = {
    title: string;
    /** The page's groups, in the order they are on the page. */
    contents: ReadonlyArray<{ id: string; label: string }>;
    /** The group in view. */
    activeId: string | null;
    onSelect: (id: string) => void;
    /** Shown in place of the tabs, e.g. how many options a search found. */
    summary?: string;
    closeLabel: string;
    onClose: () => void;
};

const UNDER_ROW_PADDING = 'px-4 pt-1 md:px-8 md:pt-2';

export const PageHeader: React.FC<PageHeaderProps> = ({ title, contents, activeId, onSelect, summary, closeLabel, onClose }) => {
    const hasTabs = summary === undefined && contents.length > 1;

    return (
        <header className="shrink-0">
            <div className={`flex items-center justify-between gap-3 pl-4 pr-3 pt-4 md:pl-8 md:pr-4 md:pt-5${hasTabs || summary !== undefined ? '' : ' border-b border-[var(--st-line)] pb-3 md:pb-4'}`}>
                <h2 className="min-w-0 truncate text-xl font-semibold leading-8 text-[color:var(--st-t1)]">{title}</h2>
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={closeLabel}
                    className="st-t-fast grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[color:var(--st-t2)] transition-colors hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)]"
                >
                    <X size={16} />
                </button>
            </div>
            {summary !== undefined && (
                <div className={`border-b border-[var(--st-line)] ${UNDER_ROW_PADDING} truncate text-[13px] leading-9 text-[color:var(--st-t2)]`}>{summary}</div>
            )}
            {hasTabs && <Tabs contents tabs={contents} activeId={activeId} onSelect={onSelect} className={UNDER_ROW_PADDING} />}
        </header>
    );
};

export default PageHeader;
