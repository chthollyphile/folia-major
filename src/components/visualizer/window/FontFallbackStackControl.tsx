import React, { useEffect, useState } from 'react';
import { normalizeFontFamilyStack } from '../../../utils/fontStacks';
import { TextArea } from '../../modal/settings/kit';

// src/components/visualizer/window/FontFallbackStackControl.tsx
// Edits an ordered CSS font-family fallback list while keeping normalization in the shared font utility.
interface FontFallbackStackControlProps {
    label: string;
    value: string[];
    onChange?: (families: string[]) => void;
    placeholder?: string;
}

const parseDraftFontFamilies = (draft: string) => normalizeFontFamilyStack(draft.split(/[,\n]/));

const areFontStacksEqual = (left: string[], right: string[]) => (
    left.length === right.length && left.every((family, index) => family === right[index])
);

const FontFallbackStackControl: React.FC<FontFallbackStackControlProps> = ({
    label,
    value,
    onChange,
    placeholder,
}) => {
    const [draft, setDraft] = useState(value.join(', '));

    useEffect(() => {
        setDraft(value.join(', '));
    }, [value]);

    const commitDraft = () => {
        const next = parseDraftFontFamilies(draft);
        setDraft(next.join(', '));
        if (!areFontStacksEqual(next, value)) {
            onChange?.(next);
        }
    };

    return (
        <label className="flex shrink-0 flex-col gap-1.5">
            <span className="text-xs leading-[18px] text-[color:var(--st-t3)]">{label}</span>
            <TextArea value={draft} onChange={setDraft} onCommit={commitDraft} placeholder={placeholder} />
        </label>
    );
};

export default FontFallbackStackControl;
