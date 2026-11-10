import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hexToHsv, hsvToHex, isHexColorStart, parseHexColor, type Hsv } from './hexColor';
import { FIELD_CLASS } from './TextField';

// src/components/modal/settings/kit/ColorPicker.tsx
// The app's colour picker: an area for saturation and value, a line for the hue, a HEX field with
// a sample of the colour beside it, and up to twelve offered colours. It is as wide as its place.
//
// While a handle is dragged the handles and the sample follow the pointer at once, whatever the
// caller does with the colours it is told (onDrag); where the drag ends is told once more as a
// choice (onChange). A colour from outside, an offered colour or a typed HEX makes the handles
// glide to their new place.
//
// Keyboard: the area and the hue line take focus. The arrows move the handle by one step, with
// Shift by ten; both say their value. The HEX field takes six digits as they are typed, and three
// on Enter or when it is left; a text that cannot become a colour gets the error border and
// writes nothing.

const SWATCH_LIMIT = 12;
const BLACK = '#000000';

/** Where the handles stand, the colour that is, and whether they glide there or are there at once. */
type Place = Hsv & { hex: string; glide: boolean };

const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

type ColorPickerProps = {
    /** The colour, as #rrggbb. */
    value: string;
    /**
     * A colour that was chosen: an offered colour, a typed HEX, an arrow key, the end of a drag.
     * The caller writes it at once.
     */
    onChange: (color: string) => void;
    /**
     * Every colour a drag passes, many times a second: the caller throttles what it writes. Without
     * it a drag calls onChange for each of them.
     */
    onDrag?: (color: string) => void;
    /** Colours offered under the HEX field; the first twelve are shown. */
    swatches?: ReadonlyArray<string>;
    /** The small heading over the offered colours. */
    swatchesLabel?: string;
    /** What is being coloured, for a screen reader. */
    label?: string;
    /** The height of the colour area. */
    areaHeight?: number;
};

export const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange, onDrag, swatches = [], swatchesLabel, label, areaHeight = 188 }) => {
    const { t } = useTranslation();
    const color = parseHexColor(value) ?? BLACK;
    // Ahead of `value` while a handle is dragged.
    const [at, setAt] = useState<Place>(() => ({ ...(hexToHsv(color) ?? { h: 0, s: 0, v: 0 }), hex: color, glide: false }));
    const [dragging, setDragging] = useState(false);
    // The last colour a drag told: where it ended.
    const lastRef = useRef(color);
    // The pointer that holds a handle; null when none does.
    const pointerRef = useRef<number | null>(null);
    // What is being typed into the HEX field; null while the field shows the colour.
    const [typed, setTyped] = useState<string | null>(null);

    // A colour from outside: the handles glide to it. A grey or a black has no hue of its own and
    // leaves the hue line where it was.
    if (!dragging && at.hex !== color) {
        const next = hexToHsv(color) ?? { h: 0, s: 0, v: 0 };
        setAt({ ...next, h: next.s > 0 && next.v > 0 ? next.h : at.h, hex: color, glide: true });
    }

    // The handle is moved by hand: it is there at once.
    const move = (next: Hsv, chosen: boolean) => {
        const hex = hsvToHex(next);
        lastRef.current = hex;
        setAt({ h: next.h, s: next.s, v: next.v, hex, glide: false });
        (chosen ? onChange : onDrag ?? onChange)(hex);
    };

    // The pointer is kept from the press to the release, also outside the part.
    const dragBy = (pick: (x: number, y: number) => Hsv) => {
        const follow = (event: React.PointerEvent<HTMLDivElement>) => {
            const box = event.currentTarget.getBoundingClientRect();
            move(pick(clamp((event.clientX - box.left) / box.width, 1), clamp((event.clientY - box.top) / box.height, 1)), false);
        };
        return {
            onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
                // One pointer drags at a time: a second finger is not followed.
                if (event.button !== 0 || pointerRef.current !== null) {
                    return;
                }
                pointerRef.current = event.pointerId;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragging(true);
                follow(event);
            },
            onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) follow(event);
            },
            onLostPointerCapture: () => {
                pointerRef.current = null;
                setDragging(false);
                if (onDrag) onChange(lastRef.current);
            },
        };
    };

    // The arrows are the part's: nothing behind it acts on the same key.
    const stepBy = (event: React.KeyboardEvent, steps: Partial<Record<string, Hsv>>) => {
        const next = steps[event.key];
        if (!next || event.altKey || event.ctrlKey || event.metaKey) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        move(next, true);
    };

    const commitTyped = () => {
        const next = typed === null ? null : parseHexColor(typed);
        if (next) {
            if (next !== color) onChange(next);
            setTyped(null);
        }
    };

    const typedWrong = typed !== null && !isHexColorStart(typed);
    const handleClass = `pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full${at.glide ? ' st-t-move transition-[left,top]' : ''}`;
    const offered = Array.from(new Set(swatches.flatMap(swatch => parseHexColor(swatch) ?? []))).slice(0, SWATCH_LIMIT);

    return (
        <div role="group" aria-label={label} className="flex flex-col gap-3">
            <div
                role="slider"
                tabIndex={0}
                aria-label={t('options.settingsColorArea')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(at.s * 100)}
                aria-valuetext={t('options.settingsColorAreaValue', { saturation: Math.round(at.s * 100), brightness: Math.round(at.v * 100) })}
                {...dragBy((x, y) => ({ h: at.h, s: x, v: 1 - y }))}
                onKeyDown={(event) => {
                    const step = event.shiftKey ? 0.1 : 0.01;
                    stepBy(event, {
                        ArrowLeft: { ...at, s: clamp(at.s - step, 1) },
                        ArrowRight: { ...at, s: clamp(at.s + step, 1) },
                        ArrowUp: { ...at, v: clamp(at.v + step, 1) },
                        ArrowDown: { ...at, v: clamp(at.v - step, 1) },
                        Home: { ...at, s: 0 },
                        End: { ...at, s: 1 },
                    });
                }}
                className="relative cursor-crosshair touch-none select-none rounded-lg"
                style={{
                    height: areaHeight,
                    background: `linear-gradient(to top, #000, rgba(0, 0, 0, 0)), linear-gradient(to right, #fff, rgba(255, 255, 255, 0)), hsl(${at.h} 100% 50%)`,
                }}
            >
                <span
                    className={`${handleClass} border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_1px_3px_rgba(0,0,0,0.4)]`}
                    style={{ left: `${at.s * 100}%`, top: `${(1 - at.v) * 100}%` }}
                />
            </div>

            <div
                role="slider"
                tabIndex={0}
                aria-label={t('options.settingsColorHue')}
                aria-valuemin={0}
                aria-valuemax={360}
                aria-valuenow={Math.round(at.h)}
                aria-valuetext={`${Math.round(at.h)}°`}
                {...dragBy(x => ({ h: x * 360, s: at.s, v: at.v }))}
                onKeyDown={(event) => {
                    const step = event.shiftKey ? 10 : 1;
                    stepBy(event, {
                        ArrowLeft: { ...at, h: clamp(at.h - step, 360) },
                        ArrowDown: { ...at, h: clamp(at.h - step, 360) },
                        ArrowRight: { ...at, h: clamp(at.h + step, 360) },
                        ArrowUp: { ...at, h: clamp(at.h + step, 360) },
                        Home: { ...at, h: 0 },
                        End: { ...at, h: 360 },
                    });
                }}
                className="relative h-3 cursor-pointer touch-none select-none rounded-full"
                style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            >
                <span
                    className={`${handleClass} top-1/2 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.2),0_1px_3px_rgba(0,0,0,0.4)]`}
                    style={{ left: `${(at.h / 360) * 100}%` }}
                />
            </div>

            <div className="flex items-center gap-2">
                <span aria-hidden className="h-8 w-8 shrink-0 rounded-lg shadow-[inset_0_0_0_1px_var(--st-line2)]" style={{ backgroundColor: at.hex }} />
                <label className={`${FIELD_CLASS} flex min-w-0 flex-1 items-center gap-0.5 px-2.5 font-mono${typedWrong ? ' !border-[var(--st-err)]' : ''}`}>
                    <span aria-hidden className="text-[color:var(--st-t3)]">#</span>
                    <input
                        type="text"
                        aria-label="HEX"
                        aria-invalid={typedWrong || undefined}
                        value={typed ?? at.hex.slice(1)}
                        maxLength={7}
                        spellCheck={false}
                        onChange={(event) => {
                            const text = event.target.value;
                            setTyped(text);
                            // Three digits are the start of six: they wait for Enter.
                            const next = text.trim().replace('#', '').length === 6 ? parseHexColor(text) : null;
                            if (next && next !== color) onChange(next);
                        }}
                        // Leaving the field with an unfinished text puts the colour back: three digits
                        // left over from deleting must not be written by a press on Save.
                        onBlur={() => setTyped(null)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.nativeEvent.isComposing) commitTyped();
                        }}
                        className="min-w-0 flex-1 bg-transparent uppercase tracking-[0.04em] text-[color:var(--st-t1)] outline-none"
                    />
                </label>
            </div>

            {offered.length > 0 && (
                <>
                    {swatchesLabel && <div className="-mb-1 text-xs leading-[18px] text-[color:var(--st-t3)]">{swatchesLabel}</div>}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(22px,1fr))] gap-1.5">
                        {offered.map(swatch => (
                            <button
                                key={swatch}
                                type="button"
                                aria-label={swatch.toUpperCase()}
                                aria-pressed={swatch === at.hex}
                                onClick={() => {
                                    if (swatch !== color) onChange(swatch);
                                }}
                                className="st-swatch st-t-fast aspect-square rounded-full shadow-[inset_0_0_0_1px_var(--st-line2)] transition-[scale,box-shadow] hover:scale-[1.12]"
                                style={{ backgroundColor: swatch }}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default ColorPicker;
