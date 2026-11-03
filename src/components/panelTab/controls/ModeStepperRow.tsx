import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import QuickEffectPicker from '../QuickEffectPicker';
import type { PictureState } from '../../modal/settings/kit';
import { kitTransition, useKitReducedMotion } from '../../modal/settings/kit/motion';

// src/components/panelTab/controls/ModeStepperRow.tsx
// 「‹ 字形 说明/当前模式⌄ 主参数 ›」一行，其余参数放在下面一行、靠右和右端箭头对齐。箭头直接换到相邻模式，
// 点中间那一块才展开全部模式的小图；下拉箭头跟在模式名后面，不和右端的步进箭头挨在一起。
// 两端的步进箭头贴着内容区左右边，和上面的磁贴、下面各行对齐成同一条线。
// 行里只画当前模式的字形，不画小图：小图要把样式在窗口大小的舞台上再画一份，只在选择器开着时才值得。
// 下面那行横向能放下好几枚，放不下就换行；这个模式没有其余参数时整行收起，收放走高度动画，面板不会一下跳开。
// 切换时字形和模式名按步进方向滑入。这里刻意不做退场动画：连点箭头时退场元素会和新元素抢布局，
// 只让新内容重新挂载入场，快速连点也不会抖。从小图里直接选则没有方向，退化成淡入。

const STEP_ENTER_OFFSET_PX = 10;

interface ModeStepperRowProps<Value extends string> {
    value: Value;
    options: { value: Value; label: string; }[];
    onSelect: (value: Value) => void;
    onStep: (direction: -1 | 1) => void;
    /** Draws a mode's glyph, the row's own sign of the chosen mode. */
    renderGlyph: (value: Value) => React.ReactNode;
    /** Draws a mode's picture in the open picker; the same function each time (PictureGrid). */
    renderPicture: (value: Value, state: PictureState) => React.ReactNode;
    /** What the row chooses: the small line over the mode's name, and the row's name for assistive tech. */
    caption: string;
    /** 放在按钮右侧、步进箭头之前的那一枚参数，例如歌词样式的动画强度。 */
    aside?: React.ReactNode;
    /** 该模式其余的参数控件，放在按钮下面一行；没有（null、undefined、false）时这一行收起。 */
    params?: React.ReactNode;
    moreLabel: string;
    onOpenMore: () => void;
    /** Whether the row's picker is open; the section keeps it, so one clock serves both rows' pictures. */
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const ModeStepperRow = <Value extends string>({
    value,
    options,
    onSelect,
    onStep,
    renderGlyph,
    renderPicture,
    caption,
    aside,
    params,
    moreLabel,
    onOpenMore,
    open,
    onOpenChange,
}: ModeStepperRowProps<Value>) => {
    const canStep = options.length > 1;
    const reduced = useKitReducedMotion();
    const triggerRef = useRef<HTMLButtonElement>(null);
    // 0 表示不是箭头触发的（从小图里选或外部改），此时只淡入不滑动。
    const [stepDirection, setStepDirection] = useState<-1 | 0 | 1>(0);
    const selectedLabel = options.find(option => option.value === value)?.label ?? value;

    const enterOffset = reduced ? 0 : stepDirection * STEP_ENTER_OFFSET_PX;

    const handleSelect = (nextValue: Value) => {
        setStepDirection(0);
        onSelect(nextValue);
    };

    const renderStepButton = (direction: -1 | 1) => (
        <motion.button
            type="button"
            onClick={() => {
                setStepDirection(direction);
                onStep(direction);
            }}
            disabled={!canStep}
            whileTap={canStep && !reduced ? { scale: 0.82, x: direction * 2 } : undefined}
            transition={kitTransition('fast', reduced)}
            className="st-t-fast flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[color:var(--st-t3)] transition-colors hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)] disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={`${caption} ${direction === -1 ? '−' : '+'}`}
        >
            {direction === -1 ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </motion.button>
    );

    const hasParams = params !== null && params !== undefined && params !== false;

    return (
        <div className="py-1">
            <div className="flex items-center gap-1">
                {renderStepButton(-1)}

                <button
                    ref={triggerRef}
                    type="button"
                    onClick={() => onOpenChange(!open)}
                    className={`st-t-fast st-focus-inside flex h-12 min-w-0 flex-1 items-center rounded-[10px] pl-1.5 pr-2 text-left transition-colors hover:bg-[var(--st-fill)] ${open ? 'bg-[var(--st-fill)]' : ''}`}
                    aria-label={caption}
                    aria-haspopup="true"
                    aria-expanded={open}
                >
                    <motion.span
                        key={value}
                        initial={{ opacity: 0, x: enterOffset }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={kitTransition('move', reduced)}
                        className="flex min-w-0 flex-1 items-center gap-2.5"
                    >
                        <span className="grid h-[30px] w-12 shrink-0 place-items-center rounded-md bg-[var(--st-fill)] text-[color:var(--st-t2)] shadow-[inset_0_0_0_1px_var(--st-line)]">
                            {renderGlyph(value)}
                        </span>
                        <span className="min-w-0">
                            <span className="block text-[11.5px] leading-[15px] text-[color:var(--st-t3)]">{caption}</span>
                            {/* 下拉箭头跟着模式名走：名字太长时名字截断，箭头留着。 */}
                            <span className="flex min-w-0 items-center gap-1">
                                <span className="truncate text-sm leading-[19px]">{selectedLabel}</span>
                                <ChevronDown size={13} className={`st-t-move shrink-0 text-[color:var(--st-t3)] transition-transform ${open ? 'rotate-180' : ''}`} />
                            </span>
                        </span>
                    </motion.span>
                </button>

                {aside && (
                    <motion.div
                        key={`${value}-aside`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={kitTransition('move', reduced)}
                        className="flex shrink-0 items-center"
                    >
                        {aside}
                    </motion.div>
                )}

                {renderStepButton(1)}
            </div>

            {/* 收放的时候才裁掉溢出：放好以后开关抬起的那层阴影要露出来。 */}
            <AnimatePresence initial={false}>
                {hasParams && (
                    <motion.div
                        key="params"
                        initial={{ height: 0, opacity: 0, overflow: 'hidden' }}
                        animate={{ height: 'auto', opacity: 1, transitionEnd: { overflow: 'visible' } }}
                        exit={{ height: 0, opacity: 0, overflow: 'hidden' }}
                        transition={kitTransition('move', reduced)}
                    >
                        {/* 和按钮之间留一道缝：按钮悬停、展开时整块铺底色，贴着或压上去会和参数叠在一起。
                            按钮和参数的焦点框都画在自己里面（st-focus-inside），不伸进这道缝。 */}
                        <motion.div
                            key={value}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={kitTransition('move', reduced)}
                            className="flex min-h-7 flex-wrap items-center justify-end gap-1.5 pt-1"
                        >
                            {params}
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            <QuickEffectPicker<Value>
                anchorRef={triggerRef}
                open={open}
                onClose={() => onOpenChange(false)}
                value={value}
                options={options}
                picture={renderPicture}
                onChange={handleSelect}
                label={caption}
                moreLabel={moreLabel}
                onOpenMore={onOpenMore}
            />
        </div>
    );
};

export default ModeStepperRow;
