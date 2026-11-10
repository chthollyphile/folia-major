import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { List, useListRef, type RowComponentProps } from 'react-window';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';

// CustomSelectMenu.tsx
// Renders the viewport-anchored option menu used by CustomSelect.
//
// 选项超过 VIRTUALIZE_THRESHOLD 时改走 react-window。命令面板的固定命令设置和自定义快捷键
// 选择器各要铺约 125 条命令，是仓库里最长的两个下拉；其余三十来个下拉只有 2-8 项，走原来的
// 分支，标记除了读屏要用的选项 id 之外不变，不承担任何风险。
//
// 高度策略：**不引入任何新测量**。虚拟化分支消费的是 CustomSelect.updateDropdownPosition
// 已经算好的 position.maxHeight（开合与 resize/scroll 时更新），只是把它减去内边距当成列表高度。
//
// 高亮项（activeIndex）由 CustomSelect 的 useCustomSelectNavigation 持有：指针移动和键盘都改它，
// 两个分支的底色都从它渲染。只有键盘移动或用键盘打开（followActive）才把高亮项滚进视野，指针高亮不滚，
// 免得列表在鼠标下面跑。
//
// 读屏：菜单从不拿焦点（mousedown 上 preventDefault），焦点一直留在触发按钮（role=combobox）上，由它的
// aria-activedescendant 指向高亮项，所以每个选项都有由 listboxId 和下标拼成的 id（customSelectOptionId，
// 两个分支一样）。虚拟化分支里 react-window 的容器默认是 role=list，夹在 listbox 和 option 之间会断开
// 归属，这里改成 presentation；没渲染出来的行由 aria-setsize / aria-posinset 补上「第几项，共几项」。

export interface CustomSelectOption {
    /** What tells the option from the others of its list: no two options of a list have the same value. */
    value: string;
    label: string;
}

export interface CustomSelectMenuPosition {
    /** A menu as wide as its trigger gives left and width; a compact one gives right and a width range. */
    left?: number;
    right?: number;
    width?: number;
    minWidth?: number;
    maxWidth?: number;
    maxHeight: number;
    top?: number;
    bottom?: number;
    placement: 'top' | 'bottom' | 'viewport';
}

/** 选项的 DOM id：触发按钮的 aria-activedescendant 用它指向高亮项。 */
export const customSelectOptionId = (listboxId: string, index: number) => `${listboxId}-option-${index}`;

interface CustomSelectMenuProps {
    menuRef: React.RefObject<HTMLDivElement | null>;
    /** 列表的 id：触发按钮的 aria-controls 指向它，选项的 id 也由它派生。 */
    listboxId: string;
    position: CustomSelectMenuPosition;
    options: CustomSelectOption[];
    value: string;
    ariaLabel?: string;
    /** Names the listbox when there is no `ariaLabel`. */
    ariaLabelledBy?: string;
    /** The menu of a compact trigger: smaller rows on an opaque surface. */
    compact: boolean;
    isDaylight: boolean;
    accentColor: string;
    textColor: string;
    borderColor: string;
    /** 高亮项下标，-1 表示没有。 */
    activeIndex: number;
    /** 高亮来自键盘：要把它滚进视野。 */
    followActive: boolean;
    /** 指针移到某个选项上，参数是它的值。 */
    onActivate: (value: string) => void;
    onPointerLeave: () => void;
    onSelect: (value: string) => void;
}

const VIRTUALIZE_THRESHOLD = 24;
/** 对应 space-y-0.5。虚拟化分支里改成行容器的下内边距，视觉一致。 */
const OPTION_ROW_GAP = 2;
/** px-3 py-2.5 text-sm：10 + 20 + 10；p-1.5，上下各 6。 */
const REGULAR_METRICS = { rowHeight: 40, menuPadding: 12 };
/** A 30px row of 13px text; p-1. */
const COMPACT_METRICS = { rowHeight: 30, menuPadding: 8 };
/** 菜单刚挂上时 react-window 的容器元素可能还没登记到 listRef，最多再等这么多帧。 */
const LIST_READY_MAX_FRAMES = 5;

/** How many options a menu of this height shows at once: what PageUp and PageDown move by. */
export const optionsPerPage = (maxHeight: number, compact: boolean): number => {
    const { rowHeight, menuPadding } = compact ? COMPACT_METRICS : REGULAR_METRICS;
    return Math.max(1, Math.floor((maxHeight - menuPadding + OPTION_ROW_GAP) / (rowHeight + OPTION_ROW_GAP)));
};

/** How tall a menu is with all of its options showing, its padding and its border counted. */
export const menuHeightOf = (optionCount: number, compact: boolean): number => {
    const { rowHeight, menuPadding } = compact ? COMPACT_METRICS : REGULAR_METRICS;
    return Math.max(1, optionCount) * (rowHeight + OPTION_ROW_GAP) - OPTION_ROW_GAP + menuPadding + 2;
};

type OptionRowProps = {
    listboxId: string;
    options: CustomSelectOption[];
    value: string;
    activeIndex: number;
    compact: boolean;
    reducedMotion: boolean;
    isDaylight: boolean;
    accentColor: string;
    textColor: string;
    onActivate: (value: string) => void;
    onSelect: (value: string) => void;
};

// 选中项用强调色底；高亮（悬停或键盘）的非选中项用悬停底色。
const optionBackground = (isSelected: boolean, isActive: boolean, isDaylight: boolean, accentColor: string) => {
    if (isSelected) return isDaylight ? `${accentColor}12` : `${accentColor}18`;
    if (isActive) return isDaylight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.06)';
    return 'transparent';
};

const OptionButton: React.FC<Pick<OptionRowProps, 'compact' | 'reducedMotion' | 'isDaylight' | 'accentColor' | 'textColor' | 'onActivate' | 'onSelect'> & {
    id: string;
    option: CustomSelectOption;
    index: number;
    /** 虚拟化分支：选项总数，与 index 一起写成 aria-setsize / aria-posinset。 */
    setSize?: number;
    isSelected: boolean;
    isActive: boolean;
    fixedHeight?: number;
}> = ({ id, option, index, setSize, isSelected, isActive, compact, reducedMotion, isDaylight, accentColor, textColor, fixedHeight, onActivate, onSelect }) => (
    <button
        type="button"
        id={id}
        role="option"
        aria-selected={isSelected}
        aria-setsize={setSize}
        aria-posinset={setSize === undefined ? undefined : index + 1}
        data-option-index={index}
        data-active={isActive ? 'true' : undefined}
        tabIndex={-1}
        onClick={() => onSelect(option.value)}
        className={`${compact
            ? 'flex h-[30px] w-full cursor-pointer items-center justify-between rounded-md px-2.5 text-left text-[13px]'
            : 'w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-lg text-left cursor-pointer'}${reducedMotion ? '' : ' transition-colors'}`}
        style={{
            color: textColor,
            backgroundColor: optionBackground(isSelected, isActive, isDaylight, accentColor),
            ...(fixedHeight ? { height: fixedHeight, paddingTop: 0, paddingBottom: 0 } : {}),
        }}
        // mousemove 而不是 mouseenter：键盘把列表滚动后，停着不动的指针下面换了一行，不该把高亮抢走。
        onMouseMove={isActive ? undefined : () => onActivate(option.value)}
    >
        <span className="truncate mr-2">{option.label}</span>
        {isSelected && (
            <Check
                size={14}
                className="shrink-0"
                style={{ color: accentColor }}
            />
        )}
    </button>
);

const CustomSelectMenuRow = ({
    index,
    style,
    listboxId,
    options,
    value,
    activeIndex,
    ...optionProps
}: RowComponentProps<OptionRowProps>): React.ReactElement | null => {
    const option = options[index];
    if (!option) {
        return null;
    }

    return (
        <div style={{ ...style, paddingBottom: OPTION_ROW_GAP }}>
            <OptionButton
                {...optionProps}
                id={customSelectOptionId(listboxId, index)}
                option={option}
                index={index}
                setSize={options.length}
                isSelected={option.value === value}
                isActive={index === activeIndex}
                fixedHeight={(optionProps.compact ? COMPACT_METRICS : REGULAR_METRICS).rowHeight}
            />
        </div>
    );
};

export const CustomSelectMenu: React.FC<CustomSelectMenuProps> = ({
    menuRef,
    listboxId,
    position,
    options,
    value,
    ariaLabel,
    ariaLabelledBy,
    compact,
    isDaylight,
    accentColor,
    textColor,
    borderColor,
    activeIndex,
    followActive,
    onActivate,
    onPointerLeave,
    onSelect,
}) => {
    const isVirtualized = options.length >= VIRTUALIZE_THRESHOLD;
    const { rowHeight, menuPadding } = compact ? COMPACT_METRICS : REGULAR_METRICS;
    const listRef = useListRef(null);
    // react-window has nothing to scroll until after its first commit; it reports its size then.
    const [listReady, setListReady] = useState(false);
    const reducedMotion = useReducedMotionFor('uiMicroMotion');

    const rowProps = useMemo(() => ({
        listboxId,
        options,
        value,
        activeIndex,
        compact,
        reducedMotion,
        isDaylight,
        accentColor,
        textColor,
        onActivate,
        onSelect,
    }), [listboxId, options, value, activeIndex, compact, reducedMotion, isDaylight, accentColor, textColor, onActivate, onSelect]);

    const listHeight = Math.max(
        rowHeight,
        Math.min(
            position.maxHeight - menuPadding,
            options.length * (rowHeight + OPTION_ROW_GAP) - OPTION_ROW_GAP,
        ),
    );

    // 键盘移动高亮、或用键盘打开菜单后，把高亮项滚进视野（就近对齐，已经看得见就不动）。
    useEffect(() => {
        if (!followActive || activeIndex < 0 || activeIndex >= options.length) return undefined;
        if (!isVirtualized) {
            const row = menuRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
            row?.scrollIntoView?.({ block: 'nearest' });
            return undefined;
        }
        // react-window 把容器元素记在自己的 state 里，菜单刚挂上的这一轮里 listRef 可能还拿不到
        // 元素（scrollToRow 会什么都不做）；那就等下一帧再滚，它报出尺寸时（listReady）也再滚一次。
        let frame = 0;
        let framesLeft = LIST_READY_MAX_FRAMES;
        const scrollToActive = () => {
            const list = listRef.current;
            if (list?.element) {
                list.scrollToRow({ index: activeIndex, align: 'auto' });
            } else if (framesLeft > 0) {
                framesLeft -= 1;
                frame = requestAnimationFrame(scrollToActive);
            }
        };
        scrollToActive();
        return () => cancelAnimationFrame(frame);
    }, [activeIndex, followActive, isVirtualized, listRef, listReady, menuRef, options.length]);

    // With reduced motion the menu is simply there and gone.
    const hidden = reducedMotion
        ? { opacity: 0 }
        : { opacity: 0, y: position.placement === 'top' ? 8 : -8, scale: 0.96 };

    return (
        <motion.div
            ref={menuRef}
            id={listboxId}
            initial={hidden}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={hidden}
            transition={{ duration: reducedMotion ? 0 : 0.15, ease: 'easeOut' }}
            className={`fixed z-[200] border overscroll-contain custom-scrollbar ${compact ? 'rounded-[10px]' : 'rounded-xl shadow-xl backdrop-blur-md'}${isVirtualized ? '' : ' overflow-y-auto'}`}
            data-wheel-scroll-region
            role="listbox"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            // Keeps focus on the trigger, which closes the menu when it loses it.
            onMouseDown={event => event.preventDefault()}
            onMouseLeave={onPointerLeave}
            style={{
                left: position.left,
                right: position.right,
                top: position.top,
                bottom: position.bottom,
                width: position.width,
                minWidth: position.minWidth,
                maxWidth: position.maxWidth,
                maxHeight: position.maxHeight,
                borderColor,
                color: textColor,
                ...(compact
                    ? {
                        backgroundColor: isDaylight ? '#ffffff' : '#2b2b30',
                        boxShadow: '0 14px 36px rgba(0, 0, 0, 0.36)',
                        // Grows out of the corner of the trigger it hangs from.
                        originX: 1,
                        originY: position.placement === 'top' ? 1 : 0,
                    }
                    : { backgroundColor: isDaylight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(24, 24, 27, 0.96)' }),
            }}
        >
            {isVirtualized ? (
                <div className={compact ? 'p-1' : 'p-1.5'}>
                    <List
                        listRef={listRef}
                        rowCount={options.length}
                        rowHeight={rowHeight + OPTION_ROW_GAP}
                        rowComponent={CustomSelectMenuRow}
                        rowProps={rowProps}
                        overscanCount={4}
                        onResize={() => setListReady(true)}
                        // The options belong to the listbox around this, not to a list of their own.
                        role="presentation"
                        className="custom-scrollbar"
                        style={{ height: listHeight, width: '100%' }}
                    />
                </div>
            ) : (
                <div className={compact ? 'p-1 space-y-0.5' : 'p-1.5 space-y-0.5'}>
                    {options.map((option, index) => (
                        <OptionButton
                            key={option.value}
                            id={customSelectOptionId(listboxId, index)}
                            option={option}
                            index={index}
                            isSelected={option.value === value}
                            isActive={index === activeIndex}
                            compact={compact}
                            reducedMotion={reducedMotion}
                            isDaylight={isDaylight}
                            accentColor={accentColor}
                            textColor={textColor}
                            onActivate={onActivate}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </motion.div>
    );
};
