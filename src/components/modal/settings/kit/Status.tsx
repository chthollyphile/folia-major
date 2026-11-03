import React from 'react';

// src/components/modal/settings/kit/Status.tsx
// A state in a few words behind a small dot: connected, running, not tested yet, failed. The dot's
// colour is the tone; the words carry the meaning by themselves. It goes in a row's control slot,
// or is the `label` of a row that has no option name of its own. It is a live region: when the
// words change, a screen reader says the new ones.

const DOT_CLASS = {
    ok: 'bg-[var(--st-ok)]',
    warn: 'bg-[var(--st-warn)]',
    error: 'bg-[var(--st-err)]',
} as const;

type StatusProps = {
    /** Without a tone the dot is grey: nothing has happened yet, or the thing is off. */
    tone?: keyof typeof DOT_CLASS;
    children: React.ReactNode;
};

export const Status: React.FC<StatusProps> = ({ tone, children }) => (
    <span role="status" className="inline-flex min-w-0 items-start gap-1.5 text-xs leading-[18px] text-[color:var(--st-t2)]">
        <span aria-hidden className={`st-t-fast mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${tone ? DOT_CLASS[tone] : 'bg-[var(--st-t3)]'}`} />
        <span className="min-w-0">{children}</span>
    </span>
);

export default Status;
