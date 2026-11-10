import React, { useCallback } from 'react';
import type { Theme } from '../../../types';
import { resolveThemeFontStack } from '../../../utils/fontStacks';
import { PictureGrid } from '../../modal/settings/kit';

// src/components/visualizer/window/FontTiles.tsx
// The fonts of the lyric style window as pictures: a few letters drawn in each font, its name
// under them. Choosing a built-in font here takes a chosen custom font away (with its fallback list
// and an uploaded font file), and the 'custom' picture opens the font picker. So the arrow keys
// only move the focus in this grid: a font is chosen with Enter, Space or a press.

export type FontChoice = Theme['fontStyle'] | 'custom';

type FontTilesProps = {
    value: FontChoice;
    options: ReadonlyArray<{ value: FontChoice; label: string }>;
    /** The custom font, when one is chosen. */
    customFamily: string | null | undefined;
    label: string;
    onChange: (next: FontChoice) => void;
};

export const FontTiles: React.FC<FontTilesProps> = ({ value, options, customFamily, label, onChange }) => {
    const picture = useCallback((choice: FontChoice) => (
        <span
            className="absolute inset-0 grid place-items-center text-lg leading-none text-[color:var(--st-t1)]"
            style={{
                fontFamily: resolveThemeFontStack(choice === 'custom'
                    ? { fontStyle: 'sans', fontFamily: customFamily ?? undefined }
                    : { fontStyle: choice }),
            }}
        >
            永Aa
        </span>
    ), [customFamily]);

    return (
        <PictureGrid
            value={value}
            options={options}
            picture={picture}
            columns={4}
            onChange={onChange}
            label={label}
            arrowKeys="focus"
            className="-mx-4"
        />
    );
};

export default FontTiles;
