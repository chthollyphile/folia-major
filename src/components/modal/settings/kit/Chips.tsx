import React from 'react';
import { Check } from 'lucide-react';
import { useRowAria } from './Row';

// src/components/modal/settings/kit/Chips.tsx
// Several on/off items in one row, each a chip with a tick box and a short name. For a handful of
// items that belong to one option; a lone on/off is a Toggle.

type ChipsProps = {
    items: ReadonlyArray<{
        /** A place a search hit or a link can land on, like a row's option id. */
        id: string;
        label: string;
        checked: boolean;
        onChange: (checked: boolean) => void;
        /** Dimmed and not clickable, keeping its tick: the item does not apply here now. */
        disabled?: boolean;
    }>;
    disabled?: boolean;
};

export const Chips: React.FC<ChipsProps> = ({ items, disabled }) => (
    <div role="group" {...useRowAria()} aria-disabled={disabled || undefined} className={`flex max-w-full flex-wrap justify-end gap-1.5${disabled ? ' pointer-events-none opacity-40' : ''}`}>
        {items.map(item => (
            <button
                key={item.id}
                type="button"
                role="checkbox"
                aria-checked={item.checked}
                disabled={disabled || item.disabled}
                data-settings-row={item.id}
                onClick={() => item.onChange(!item.checked)}
                className={`st-t-fast inline-flex h-8 items-center gap-2 rounded-lg bg-[var(--st-fill)] pl-2 pr-3 text-[13px] transition-[background-color,color,scale] hover:bg-[var(--st-fill2)] active:scale-[0.97] ${item.checked ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)]'}${item.disabled && !disabled ? ' pointer-events-none opacity-40' : ''}`}
            >
                <span
                    className={`st-t-fast grid h-4 w-4 place-items-center rounded-[5px] transition-[background-color,box-shadow] ${item.checked ? 'bg-[var(--st-accent)] text-[color:var(--st-on-accent)]' : 'shadow-[inset_0_0_0_1.5px_var(--st-t3)]'}`}
                >
                    <Check size={12} strokeWidth={3} className={`st-t-move transition-[opacity,scale] ${item.checked ? '' : 'scale-50 opacity-0'}`} />
                </span>
                {item.label}
            </button>
        ))}
    </div>
);

export default Chips;
