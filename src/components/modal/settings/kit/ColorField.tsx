import React, { useId, useRef, useState } from 'react';
import { useColorPreviewThrottle } from '../../../shared/useColorPreviewThrottle';
import { ColorPicker } from './ColorPicker';
import { Popover } from './Popover';

// src/components/modal/settings/kit/ColorField.tsx
// A colour as a small swatch that opens the colour picker in a layer beside it: for a colour that
// sits in a row among other things (a word's colour). What a drag in the picker passes is written
// at the pace of the app's colour previews; a choice is written at once.

type ColorFieldProps = {
    /** The colour, as #rrggbb. */
    value: string;
    onChange: (color: string) => void;
    /** What the colour is of: the name of the swatch and of the picker. */
    label: string;
    /** Colours the picker offers. */
    swatches?: ReadonlyArray<string>;
    swatchesLabel?: string;
};

export const ColorField: React.FC<ColorFieldProps> = ({ value, onChange, label, swatches, swatchesLabel }) => {
    const anchorRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const id = useId();
    const { previewColor, flushColor } = useColorPreviewThrottle(onChange);

    return (
        <>
            <button
                ref={anchorRef}
                type="button"
                aria-label={label}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                onClick={() => setOpen(shown => !shown)}
                className="st-t-fast h-7 w-7 shrink-0 rounded-lg shadow-[inset_0_0_0_1px_var(--st-line2)] transition-transform hover:scale-[1.08]"
                style={{ backgroundColor: value }}
            />
            {/* --st-swatch-gap: the ring of the chosen offered colour stands on the layer's surface. */}
            <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} id={id} role="dialog" aria-label={label} className="p-3 [--st-swatch-gap:var(--st-menu)]">
                <div className="w-60">
                    <ColorPicker
                        value={value}
                        onDrag={previewColor}
                        onChange={(color) => {
                            // What the drag still held back is the colour it ended on.
                            flushColor();
                            onChange(color);
                        }}
                        swatches={swatches}
                        swatchesLabel={swatchesLabel}
                        areaHeight={140}
                    />
                </div>
            </Popover>
        </>
    );
};

export default ColorField;
