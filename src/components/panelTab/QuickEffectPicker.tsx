import React from 'react';
import { ChevronRight } from 'lucide-react';
import { PictureGrid, Popover, type PictureState } from '../modal/settings/kit';

// src/components/panelTab/QuickEffectPicker.tsx
// The picker a row of the player panel opens: the options as pictures, three across and as wide as
// the panel, with a way on to the full settings at the bottom. It is the settings kit's popover
// around the kit's picture grid; the row gives the button it opens from and says when it is open.
// A choice is applied at once and the picker stays open, so several can be tried.

type QuickEffectPickerProps<Value extends string> = {
    /** The button of the row that opens the picker. */
    anchorRef: React.RefObject<HTMLElement | null>;
    open: boolean;
    onClose: () => void;
    value: Value;
    options: ReadonlyArray<{ value: Value; label: string }>;
    /** Draws an option's picture; the same function each time (PictureGrid). */
    picture: (value: Value, state: PictureState) => React.ReactNode;
    onChange: (value: Value) => void;
    /** What the picker chooses. */
    label: string;
    moreLabel: string;
    onOpenMore: () => void;
};

/** The way on to the full settings at the bottom of a panel picker; it closes the picker first. */
export const PickerMoreButton: React.FC<{ label: string; onClose: () => void; onOpenMore: () => void }> = ({ label, onClose, onOpenMore }) => (
    <button
        type="button"
        onClick={() => {
            onClose();
            onOpenMore();
        }}
        className="st-t-fast mx-3 mt-2 flex h-9 shrink-0 items-center justify-between border-t border-[var(--st-line)] px-1 text-[13px] text-[color:var(--st-t2)] transition-colors hover:text-[color:var(--st-t1)]"
    >
        <span>{label}</span>
        <ChevronRight size={14} />
    </button>
);

const QuickEffectPicker = <Value extends string>({
    anchorRef, open, onClose, value, options, picture, onChange, label, moreLabel, onOpenMore,
}: QuickEffectPickerProps<Value>) => (
    <Popover anchorRef={anchorRef} open={open} onClose={onClose} fill aria-label={label} className="flex flex-col rounded-[14px] pb-1 pt-2">
        <PictureGrid value={value} options={options} picture={picture} columns={3} onChange={onChange} label={label} maxHeight={300} />
        <PickerMoreButton label={moreLabel} onClose={onClose} onOpenMore={onOpenMore} />
    </Popover>
);

export default QuickEffectPicker;
