import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
    AUDIO_EQUALIZER_BANDS,
    AUDIO_EQUALIZER_MAX_GAIN_DB,
    AUDIO_EQUALIZER_MIN_GAIN_DB,
} from '../../../utils/audioEqualizer';
import EqualizerSection from './EqualizerSection';
import Fader from './Fader';

// src/components/panelTab/equalizer/EqualizerBandGrid.tsx
// The band section of the audio effect window: ten faders, the gain above each and its frequency
// under it, the scale at the left, and a curve through the thumbs. The faders are as tall as the
// section has room for. In a narrow window the ten scroll sideways.
//
// A gain a fader set is there at once, and the curve with it. Gains that come from outside (a
// preset, the reset) make the thumbs and the curve glide to their new place.

/** A fader's thumb is 16 px: its centre stops this far inside each end of the fader. */
const THUMB_INSET_PX = 8;
/** From a band's top to its fader, and from the fader to the band's bottom: a 16 px line of text and the 6 px gap. */
const TEXT_ROW_PX = 22;

const MINUS = '−';
const signed = (gain: number) => `${gain > 0 ? '+' : gain < 0 ? MINUS : ''}${Math.abs(gain)}`;

const gainAt = (gains: number[], index: number) => gains[index] ?? 0;

/**
 * The curve through the thumbs, for a drawing ten wide and a hundred tall that is stretched over
 * the thumbs' travel: a band's thumb is at the middle of its tenth, max at the top.
 */
const curvePath = (gains: number[]): string => {
    const span = AUDIO_EQUALIZER_MAX_GAIN_DB - AUDIO_EQUALIZER_MIN_GAIN_DB;
    const points = AUDIO_EQUALIZER_BANDS.map((_, index) => (
        [index + 0.5, ((AUDIO_EQUALIZER_MAX_GAIN_DB - gainAt(gains, index)) / span) * 100] as const
    ));
    return points.slice(1).reduce((path, [x, y], index) => {
        const [fromX, fromY] = points[index];
        const middle = (fromX + x) / 2;
        return `${path} C${middle},${fromY} ${middle},${y} ${x},${y}`;
    }, `M${points[0][0]},${points[0][1]}`);
};

type EqualizerBandGridProps = {
    gains: number[];
    onBandChange: (index: number, value: number) => void;
    onCommit: () => void;
    /**
     * The faders are out of reach (inert), and the strip still scrolls sideways: a narrow window shows the
     * last bands only that way. The scroll container itself is never inert.
     */
    readOnly?: boolean;
};

const EqualizerBandGrid: React.FC<EqualizerBandGridProps> = ({ gains, onBandChange, onCommit, readOnly = false }) => {
    const { t } = useTranslation();
    // The gains as the faders last set them: gains that differ from these came from outside. Once
    // gains have come from outside nothing is "set by hand" until a fader moves again, so going back
    // to the earlier gains by a preset glides too.
    const setByHandRef = useRef<number[] | null>(gains);
    const byHand = setByHandRef.current;
    const glide = byHand === null || AUDIO_EQUALIZER_BANDS.some((_, index) => gainAt(gains, index) !== gainAt(byHand, index));
    useEffect(() => {
        if (glide) setByHandRef.current = null;
    });

    const changeBand = (index: number, value: number) => {
        setByHandRef.current = AUDIO_EQUALIZER_BANDS.map((_, at) => (at === index ? value : gainAt(gains, at)));
        onBandChange(index, value);
    };

    return (
        <EqualizerSection title={t('ui.equalizerGain')} grow>
            {/* st-scroll styles the bar; the height is set here, because the kit's bar is only ever upright. */}
            <div className="st-scroll flex flex-1 gap-2 overflow-x-auto px-4 pb-3 pt-3.5 [&::-webkit-scrollbar]:h-3">
                <div
                    aria-hidden
                    className="flex w-11 shrink-0 flex-col justify-between text-right font-mono text-[11px] leading-[14px] text-[color:var(--st-t3)]"
                    style={{ marginBlock: TEXT_ROW_PX }}
                >
                    <span>+{AUDIO_EQUALIZER_MAX_GAIN_DB} dB</span>
                    <span>0</span>
                    <span>{MINUS}{Math.abs(AUDIO_EQUALIZER_MIN_GAIN_DB)} dB</span>
                </div>
                <div inert={readOnly} className="relative grid min-w-[360px] flex-1 grid-cols-10">
                    {/* Laid over the travel of the thumbs' centres, so the drawing needs no measuring. */}
                    <svg
                        aria-hidden
                        viewBox="0 0 10 100"
                        preserveAspectRatio="none"
                        className="pointer-events-none absolute inset-x-0 w-full overflow-visible"
                        style={{
                            top: TEXT_ROW_PX + THUMB_INSET_PX,
                            height: `calc(100% - ${2 * (TEXT_ROW_PX + THUMB_INSET_PX)}px)`,
                        }}
                    >
                        <line x1={0.5} x2={9.5} y1={50} y2={50} stroke="var(--st-line2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                        <path
                            d={curvePath(gains)}
                            fill="none"
                            stroke="var(--st-accent)"
                            strokeWidth={1.5}
                            strokeOpacity={0.5}
                            vectorEffect="non-scaling-stroke"
                            className={glide ? 'st-t-move transition-[d]' : undefined}
                        />
                    </svg>
                    {AUDIO_EQUALIZER_BANDS.map((band, index) => {
                        const gain = gainAt(gains, index);
                        return (
                            <div key={band.frequency} className="flex min-h-[192px] flex-col items-center gap-1.5 font-mono text-[11px] leading-4">
                                <span aria-hidden className="text-[color:var(--st-t2)]">{signed(gain)}</span>
                                <Fader
                                    value={gain}
                                    min={AUDIO_EQUALIZER_MIN_GAIN_DB}
                                    max={AUDIO_EQUALIZER_MAX_GAIN_DB}
                                    label={`${band.label} Hz`}
                                    valueText={`${signed(gain)} dB`}
                                    onPreview={value => changeBand(index, value)}
                                    onCommit={onCommit}
                                    glide={glide}
                                />
                                <span aria-hidden className="text-[color:var(--st-t3)]">{band.label}</span>
                            </div>
                        );
                    })}
                </div>
                <span aria-hidden className="w-5 shrink-0 self-end font-mono text-[11px] leading-4 text-[color:var(--st-t3)]">Hz</span>
            </div>
        </EqualizerSection>
    );
};

export default EqualizerBandGrid;
