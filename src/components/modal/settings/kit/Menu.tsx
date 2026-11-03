import React, { useRef } from 'react';
import { Check, type LucideIcon } from 'lucide-react';
import { Popover } from './Popover';
import type { PopoverAlign, PopoverSide } from './popoverPlace';

// src/components/modal/settings/kit/Menu.tsx
// A list of actions that opens from a control, on the kit's Popover. The caller draws the control,
// keeps `open`, and marks the control with aria-haspopup="menu", aria-expanded and aria-controls.
//
// Keyboard: opening puts focus on the chosen entry, or on the first; the up and down arrows move
// and go round, Home and End jump, Enter and Space choose, Escape and Tab close the list and give
// focus back to the control.

export type MenuItem = {
    id: string;
    label: string;
    /** In front of the label. */
    icon?: LucideIcon;
    /** A short text or an icon at the entry's end. */
    end?: React.ReactNode;
    /** In a list that is a choice: the chosen entry carries a tick, the others keep its place free. */
    chosen?: boolean;
    disabled?: boolean;
    onSelect: () => void;
};

type MenuProps = {
    /** The control the list opens from. */
    anchorRef: React.RefObject<HTMLElement | null>;
    open: boolean;
    onClose: () => void;
    /** What the list holds, for a screen reader. */
    label: string;
    items: ReadonlyArray<MenuItem>;
    /** Lines under the list. */
    notes?: ReadonlyArray<string>;
    /** For the control's aria-controls. */
    id?: string;
    side?: PopoverSide;
    align?: PopoverAlign;
};

export const Menu: React.FC<MenuProps> = ({ anchorRef, open, onClose, label, items, notes = [], id, side, align }) => {
    const chosenRef = useRef<HTMLButtonElement>(null);

    // The keys the list moves by stop here. Space and Enter are the focused entry's own; the app's
    // shortcuts leave every bare key on a menu's entry alone (isTextEntryTarget, utils/keyboardTargets).
    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        const entries = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:enabled'));
        const at = entries.indexOf(document.activeElement as HTMLElement);
        const last = entries.length - 1;
        if (event.key === 'Tab') {
            onClose();
        } else if (event.key === 'ArrowDown') {
            entries[at < last ? at + 1 : 0]?.focus();
        } else if (event.key === 'ArrowUp') {
            entries[at > 0 ? at - 1 : last]?.focus();
        } else if (event.key === 'Home') {
            entries[0]?.focus();
        } else if (event.key === 'End') {
            entries[last]?.focus();
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    return (
        <Popover anchorRef={anchorRef} open={open} onClose={onClose} side={side} align={align} focusRef={chosenRef}>
            <div id={id} role="menu" aria-label={label} onKeyDown={handleKeyDown} className="p-1">
                {items.map(({ icon: Icon, ...item }) => (
                    <button
                        key={item.id}
                        ref={item.chosen ? chosenRef : undefined}
                        type="button"
                        role={item.chosen === undefined ? 'menuitem' : 'menuitemradio'}
                        aria-checked={item.chosen}
                        disabled={item.disabled}
                        onClick={() => {
                            item.onSelect();
                            onClose();
                        }}
                        className="st-focus-inside st-t-fast flex h-8 w-full min-w-[176px] items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-left text-[13px] text-[color:var(--st-t1)] transition-colors hover:bg-[var(--st-fill)] disabled:pointer-events-none disabled:opacity-40"
                    >
                        {Icon && <Icon size={15} className="shrink-0 text-[color:var(--st-t2)]" />}
                        <span className="flex-1">{item.label}</span>
                        {item.end !== undefined && <span className="ml-3 flex shrink-0 items-center text-xs text-[color:var(--st-t3)]">{item.end}</span>}
                        {item.chosen !== undefined && (
                            <Check size={14} className={`ml-3 shrink-0 text-[color:var(--st-accent)] ${item.chosen ? '' : 'invisible'}`} />
                        )}
                    </button>
                ))}
                {notes.length > 0 && (
                    <div className="mt-1 max-w-[264px] space-y-1 border-t border-[var(--st-line)] px-2 pb-1.5 pt-2 text-xs leading-[19px] text-[color:var(--st-t2)]">
                        {notes.map(note => <p key={note}>{note}</p>)}
                    </div>
                )}
            </div>
        </Popover>
    );
};

export default Menu;
