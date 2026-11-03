import React from 'react';
import { Tooltip } from '../../modal/settings/kit';

// src/components/panelTab/shell/FactList.tsx
// What is known about a thing, as names and values: a file's name and size, a song's id. The name
// is at the left and the value at the right end of its line. A value that does not fit is cut with
// an ellipsis; the kit's tooltip shows all of it.

export type Fact = {
    label: string;
    value: string;
    /** For an id or a code: letters of one width. */
    mono?: boolean;
};

type FactListProps = {
    facts: ReadonlyArray<Fact>;
};

export const FactList: React.FC<FactListProps> = ({ facts }) => (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 px-1 pb-1.5 text-xs leading-[18px]">
        {facts.map(fact => (
            <React.Fragment key={fact.label}>
                <dt className="text-[color:var(--st-t3)]">{fact.label}</dt>
                <dd className="min-w-0 text-right text-[color:var(--st-t2)]">
                    <Tooltip text={fact.value} className={`block truncate${fact.mono ? ' font-mono' : ''}`}>
                        {fact.value}
                    </Tooltip>
                </dd>
            </React.Fragment>
        ))}
    </dl>
);

export default FactList;
