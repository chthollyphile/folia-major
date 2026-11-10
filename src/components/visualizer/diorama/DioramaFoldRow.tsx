import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Reveal, Row, Toggle } from '../../modal/settings/kit';

// src/components/visualizer/diorama/DioramaFoldRow.tsx
// The head of one of Diorama's option groups: a row of the settings kit whose label opens and
// closes the rows under it, and whose switch turns the group on and off. The two are independent:
// the rows of a group that is off can still be opened and read. Closed at first.
interface DioramaFoldRowProps {
    label: string;
    checked: boolean;
    onChange: (next: boolean) => void;
    children: React.ReactNode;
}

export const DioramaFoldRow: React.FC<DioramaFoldRowProps> = ({ label, checked, onChange, children }) => {
    const [isExpanded, setIsExpanded] = useState(false);

    return (
        <>
            <Row
                label={(
                    <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={() => setIsExpanded(expanded => !expanded)}
                        className="-ml-1 flex items-center gap-1 rounded text-left"
                    >
                        <ChevronRight
                            size={16}
                            aria-hidden="true"
                            className={`st-t-unfold shrink-0 text-[color:var(--st-t2)] transition-transform${isExpanded ? ' rotate-90' : ''}`}
                        />
                        {label}
                    </button>
                )}
            >
                <Toggle checked={checked} onChange={onChange} />
            </Row>
            <Reveal when={isExpanded}>{children}</Reveal>
        </>
    );
};
