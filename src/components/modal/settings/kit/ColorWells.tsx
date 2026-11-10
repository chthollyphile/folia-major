import React from 'react';

// src/components/modal/settings/kit/ColorWells.tsx
// A few colours that belong together (a theme's four), each a well that shows the colour, its name
// and its HEX. One of them is chosen: the one a colour picker beside the wells edits. Two wells
// side by side, or one under the other in a narrow column; a name that does not fit is cut.

type ColorWellsProps<K extends string> = {
    /** The chosen well. */
    value: K;
    wells: ReadonlyArray<{ id: K; label: string; color: string }>;
    /** Called for a new choice, not for a press on the well already chosen. */
    onChange: (id: K) => void;
    /** One well under the other, and a little lower each. */
    stacked?: boolean;
    /** What the wells are, for a screen reader. */
    label?: string;
};

export const ColorWells = <K extends string>({ value, wells, onChange, stacked, label }: ColorWellsProps<K>): React.ReactElement => (
    <div role="group" aria-label={label} className={`grid gap-2 ${stacked ? '' : 'grid-cols-2'}`}>
        {wells.map(well => (
            <button
                key={well.id}
                type="button"
                aria-pressed={well.id === value}
                onClick={() => {
                    if (well.id !== value) onChange(well.id);
                }}
                className={`st-t-fast flex min-w-0 items-center gap-2.5 rounded-[10px] bg-[var(--st-fill)] px-2.5 text-left transition-[background-color,box-shadow] hover:bg-[var(--st-fill2)] ${stacked ? 'h-12' : 'h-[52px]'} ${well.id === value ? 'shadow-[inset_0_0_0_1.5px_var(--st-accent)]' : 'shadow-[inset_0_0_0_1.5px_transparent]'}`}
            >
                <span aria-hidden className="st-t-move h-7 w-7 shrink-0 rounded-lg shadow-[inset_0_0_0_1px_var(--st-line2)] transition-colors" style={{ backgroundColor: well.color }} />
                <span className="min-w-0">
                    <span className="block truncate text-[13px] leading-[18px] text-[color:var(--st-t1)]">{well.label}</span>
                    <span className="block truncate font-mono text-[11.5px] leading-4 text-[color:var(--st-t2)]">{well.color.toUpperCase()}</span>
                </span>
            </button>
        ))}
    </div>
);

export default ColorWells;
