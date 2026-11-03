import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PictureChecks, Popover } from '../../modal/settings/kit';
import { PickerMoreButton } from '../../panelTab/QuickEffectPicker';
import { drawRandomPoolChoice } from './lyricStyleChoices';
import { useRandomPool } from './useRandomPool';

// src/components/visualizer/random/RandomPoolPicker.tsx
// The layer the player panel's 「选择随机池」 chip opens: the random pool laid out as the panel's
// pickers lay out their choices (QuickEffectPicker), as wide as the panel, each tile switched on and
// off by itself, with a way on to the lyric style window at the bottom. A tile shows the style's
// glyph, not a live picture, so opening the layer starts no preview clock and makes no images. A
// press applies at once and the layer stays open. The panel keeps `open`.

type RandomPoolPickerProps = {
    /** The chip the layer opens from. */
    anchorRef: React.RefObject<HTMLElement | null>;
    open: boolean;
    onClose: () => void;
    moreLabel: string;
    onOpenMore: () => void;
};

const RandomPoolPicker: React.FC<RandomPoolPickerProps> = ({ anchorRef, open, onClose, moreLabel, onOpenMore }) => {
    const { t } = useTranslation();
    const pool = useRandomPool();
    const gridRef = useRef<HTMLDivElement>(null);

    return (
        <Popover anchorRef={anchorRef} open={open} onClose={onClose} fill aria-label={t('options.randomPool')} className="flex flex-col rounded-[14px] pb-1 pt-2">
            <div className="mb-1 flex min-h-7 shrink-0 items-center justify-between gap-3 pl-4 pr-3">
                <span className="text-[13px] font-semibold leading-5 text-[color:var(--st-t2)]">{t('options.randomPool')}</span>
                <span className="flex items-center gap-1.5">
                    <span className="text-xs text-[color:var(--st-t3)]">{pool.countLabel}</span>
                    <Button variant="quiet" disabled={pool.allOn} onClick={() => pool.selectAll(gridRef.current)}>{t('options.randomVisualizerSelectAll')}</Button>
                </span>
            </div>
            {/* min-h-0: where the window is short, the grid is what scrolls (Popover). */}
            <div ref={gridRef} className="flex min-h-0 flex-col">
                <PictureChecks
                    value={pool.modes}
                    options={pool.options}
                    picture={drawRandomPoolChoice}
                    columns={4}
                    compact
                    onChange={pool.setModes}
                    least={1}
                    onRefuse={pool.refuse}
                    label={t('options.randomPool')}
                    maxHeight={300}
                />
            </div>
            <PickerMoreButton label={moreLabel} onClose={onClose} onOpenMore={onOpenMore} />
        </Popover>
    );
};

export default RandomPoolPicker;
