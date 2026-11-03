import React from 'react';
import { RotateCcw, X } from 'lucide-react';
import PonderSurfaceStateLayer, { PonderSurfaceBase } from '../PonderSurfaceStateLayer';
import { AUDIO_EQUALIZER_GEOMETRY as G } from './audioEqualizer.geometry';
import { relativeRectStyle } from '../relativeRectStyle';
import type { PonderSurfaceDeclarations, PonderSurfaceProps as SurfaceProps } from '../surfaceDeclarations';

// src/components/ponder/surfaces/panel/audioEqualizer.surface.tsx
// 音频效果器窗口：标题和右上角的总开关，一排预设，「频段增益」十根推子，「效果链」九项。
//
// 这张图要讲的只有一件会改用户数据的事：拖任何一根推子，选中的预设就从内置那颗跳到
// 自定义槽，值也写进那个槽。所以预设排和推子排必须同屏，换槽是一整层结果。

type Paint = Pick<SurfaceProps, 'accent' | 'line' | 'outline'>;

/** 预设那一排、复位和十根推子在登记表里的名字：拖过之后那一层替换的是它。 */
const EQ_CONTROLS_STATE = 'eq-controls';

/** 一颗预设。选中的那颗是实心的。 */
const PresetChip: React.FC<Paint & { selected?: boolean }> = ({ line, outline, accent, selected }) => (
    <span
        data-ponder-eq-chip
        data-ponder-eq-chip-selected={selected || undefined}
        className="flex h-full flex-1 items-center justify-center rounded-lg"
        style={{ backgroundColor: selected ? accent : line }}
    >
        <span className="h-0.5 w-[50%] rounded-full" style={{ backgroundColor: selected ? 'var(--st-on-accent)' : outline }} />
    </span>
);

/** 推子的轨道从这一格的百分之几到百分之几。上面留给数值，下面留给频点。 */
const TRACK_TOP = 12;
const TRACK_SPAN = 76;
const knobTop = (fill: number): number => TRACK_TOP + (1 - fill) * TRACK_SPAN;

const BAND_FILLS = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
/** 拖过之后那一根的位置。只有第四根动，其余不动 —— 换槽是拖一根就发生的。 */
const DRAGGED_BAND_FILLS = BAND_FILLS.map((fill, index) => (index === 3 ? 0.92 : fill));

/**
 * 十根推子：每根上面一个数值、中间一条轨道加把手、下面一个频点，一条曲线穿过十个把手。
 * `marker` 挂在第四根上：教程拖的是那一根，锚点也要落在它身上。
 */
const Bands: React.FC<Paint & { fills: number[]; activeIndex?: number; marker: string }> = ({ line, outline, accent, fills, activeIndex, marker }) => (
    <div className="flex items-stretch" style={relativeRectStyle(G.bands)}>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polyline
                points={fills.map((fill, index) => `${index * 10 + 5},${knobTop(fill)}`).join(' ')}
                fill="none"
                stroke={outline}
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
            />
        </svg>
        {fills.map((fill, index) => {
            const active = index === activeIndex;
            return (
                <span key={index} data-ponder-eq-band {...(index === 3 ? { [marker]: true } : {})} className="relative h-full min-w-0 flex-1">
                    <span
                        className="absolute left-1/2 top-[2%] h-0.5 w-[24%] -translate-x-1/2 rounded-full"
                        style={{ backgroundColor: active ? accent : line, opacity: active ? 1 : 0.9 }}
                    />
                    <span className="absolute left-1/2 w-0.5 -translate-x-1/2 rounded-full" style={{ top: `${TRACK_TOP}%`, height: `${TRACK_SPAN}%`, backgroundColor: line }} />
                    <span
                        className="absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{ top: `${knobTop(fill)}%`, backgroundColor: active ? accent : 'var(--st-t2)' }}
                    />
                    <span className="absolute bottom-[2%] left-1/2 h-0.5 w-[30%] -translate-x-1/2 rounded-full opacity-70" style={{ backgroundColor: line }} />
                </span>
            );
        })}
    </div>
);

/** 预设那一排、复位、十根推子。selected 是选中的第几颗（0 到 5 是内置，6、7 是两个自定义槽）。 */
const Controls: React.FC<Paint & { selected: number; fills: number[]; activeBand?: number; after?: boolean }> = ({
    selected, fills, activeBand, after, ...paint
}) => (
    <>
        <div
            {...{ [after ? 'data-ponder-eq-presets-after' : 'data-ponder-eq-presets']: true }}
            className="flex items-stretch gap-[2%]"
            style={relativeRectStyle(G.presets)}
        >
            {[0, 1, 2, 3, 4, 5].map(index => <PresetChip key={index} selected={index === selected} {...paint} />)}
        </div>
        <div
            {...{ [after ? 'data-ponder-eq-custom-slots-after' : 'data-ponder-eq-custom-slots']: true }}
            className="flex items-stretch gap-[4%]"
            style={relativeRectStyle(G.customSlots)}
        >
            {[6, 7].map(index => <PresetChip key={index} selected={index === selected} {...paint} />)}
        </div>
        {/* 内置预设不可编辑，所以停在内置上时这颗是灰的。 */}
        <span
            {...{ [after ? 'data-ponder-eq-reset-on' : 'data-ponder-eq-reset']: true }}
            className={`flex items-center justify-center ${after ? '' : 'opacity-35'}`}
            style={{ ...relativeRectStyle(G.reset), color: after ? paint.accent : undefined }}
        >
            <RotateCcw className="h-[70%] w-auto" />
        </span>
        <Bands fills={fills} activeIndex={activeBand} marker={after ? 'data-ponder-eq-band-target-after' : 'data-ponder-eq-band-target'} {...paint} />
    </>
);

/**
 * 音频效果器窗口。
 *
 * 结果层只有一个 `custom-written`：拖过之后，选中的预设从内置那颗跳到自定义槽 1，
 * 而且那一根推子停在新位置上 —— 这就是「静默换槽并覆写」的全部证据。
 */
const PonderAudioEqualizerSurface: React.FC<SurfaceProps> = ({ accent, line, outline, registerStateNode }) => {
    const paint = { accent, line, outline };
    return (
        <div className="absolute inset-0 overflow-hidden" data-ponder-audio-equalizer-structure>
            <PonderSurfaceBase registerStateNode={registerStateNode}>
                <span data-ponder-eq-title className="flex flex-col justify-between" style={relativeRectStyle(G.title)}>
                    <span className="h-[34%] w-[36%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                    <span className="h-[20%] w-[48%] rounded-full opacity-55" style={{ backgroundColor: line }} />
                </span>
                {/* 总开关：左边一行字写着开没开，右边一颗开关。 */}
                <span data-ponder-eq-enable className="flex items-center justify-end gap-[8%]" style={relativeRectStyle(G.enable)}>
                    <span className="h-[14%] w-[52%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                    <span className="relative h-[78%] w-[26%] shrink-0 rounded-full" style={{ backgroundColor: accent }}>
                        <span className="absolute right-[8%] top-1/2 aspect-square h-[70%] -translate-y-1/2 rounded-full bg-white" />
                    </span>
                </span>
                <span className="flex items-center justify-center opacity-55" style={relativeRectStyle(G.close)}>
                    <X className="h-full w-full" />
                </span>

                {/* 六个内置预设，当前选中的是其中一个 —— 拖推子之前，选中的就不该是自定义槽。 */}
                <PonderSurfaceStateLayer state={EQ_CONTROLS_STATE} registerStateNode={registerStateNode} visible>
                    <Controls selected={2} fills={BAND_FILLS} {...paint} />
                </PonderSurfaceStateLayer>

                {/* 「频段增益」：一行小标题，下面一张卡；卡的左边是 +12、0、-12 三道刻度，右下角一个 Hz。 */}
                <span
                    className="rounded-full opacity-55"
                    style={{ ...relativeRectStyle({ left: 0.03, top: 0.19, width: 0.06, height: 0.008 }), backgroundColor: line }}
                />
                <div
                    data-ponder-eq-bands-card
                    className="rounded-xl"
                    style={{ ...relativeRectStyle(G.bandsCard), boxShadow: `inset 0 0 0 1px ${outline}` }}
                >
                    {[14, 50, 86].map(top => (
                        <span key={top} className="absolute left-[3%] h-0.5 w-[4%] rounded-full opacity-60" style={{ top: `${top}%`, backgroundColor: line }} />
                    ))}
                    <span className="absolute bottom-[4%] right-[2.5%] h-0.5 w-[2%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                </div>

                {/* 「效果链」：左边小标题，右端一句「在频段之后处理」；卡里三列三排九项，各是名字、数值、一条滑杆。 */}
                <span
                    className="rounded-full opacity-55"
                    style={{ ...relativeRectStyle({ left: 0.03, top: 0.69, width: 0.05, height: 0.008 }), backgroundColor: line }}
                />
                <span
                    className="rounded-full opacity-40"
                    style={{ ...relativeRectStyle({ right: 0.03, top: 0.69, width: 0.1, height: 0.008 }), backgroundColor: line }}
                />
                {/* 描边走 inset box-shadow：border 会把里面那两枚徽章的百分比挪掉 1px。 */}
                <div
                    data-ponder-eq-effects
                    className="rounded-xl"
                    style={{ ...relativeRectStyle(G.effects), boxShadow: `inset 0 0 0 1px ${outline}` }}
                >
                    <div className="absolute inset-x-[2%] bottom-[4%] top-[6%] grid grid-cols-3 grid-rows-3 gap-x-[3.4%]">
                        {Array.from({ length: 9 }, (_, index) => (
                            <span key={index} data-ponder-eq-effect className="flex flex-col justify-center gap-[22%]">
                                <span className="flex items-center justify-between">
                                    <span className="h-1 w-[20%] rounded-full" style={{ backgroundColor: line, opacity: 0.95 }} />
                                    <span className="h-0.5 w-[10%] rounded-full opacity-60" style={{ backgroundColor: line }} />
                                </span>
                                <span className="relative h-0.5 rounded-full" style={{ backgroundColor: line }}>
                                    <span
                                        className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                                        style={{ left: index === 1 ? '96%' : index === 6 ? '50%' : '3%', backgroundColor: 'var(--st-t2)' }}
                                    />
                                </span>
                            </span>
                        ))}
                    </div>
                    {/* 「会加噪」的徽章：推没推上去它都在，为的是在打开之前就回答噪声从哪来。 */}
                    {[G.noiseBadge, G.noiseBadgeSecond].map((rect, index) => (
                        <span
                            key={index}
                            {...(index === 0 ? { 'data-ponder-eq-noise-badge': true } : {})}
                            data-ponder-eq-noise
                            className="flex items-center justify-center rounded-md"
                            style={{ ...relativeRectStyle(rect), boxShadow: 'inset 0 0 0 1px var(--st-warn)' }}
                        >
                            <span className="h-0.5 w-[56%] rounded-full" style={{ backgroundColor: 'var(--st-warn)' }} />
                        </span>
                    ))}
                </div>
            </PonderSurfaceBase>

            {/* 拖过一根之后：选中态从内置那颗跳到自定义槽 1，复位也跟着亮起来。 */}
            <PonderSurfaceStateLayer state="custom-written" registerStateNode={registerStateNode} replaces={EQ_CONTROLS_STATE}>
                <Controls selected={6} fills={DRAGGED_BAND_FILLS} activeBand={3} after {...paint} />
            </PonderSurfaceStateLayer>
        </div>
    );
};

export default {
    'audio-equalizer': PonderAudioEqualizerSurface,
} satisfies PonderSurfaceDeclarations;
