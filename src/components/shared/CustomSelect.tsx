import React, { useState, useRef, useLayoutEffect, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Theme } from '../../types';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import {
    CustomSelectMenu,
    customSelectOptionId,
    menuHeightOf,
    optionsPerPage,
    type CustomSelectMenuPosition,
    type CustomSelectOption,
} from './CustomSelectMenu';
import { useCustomSelectNavigation } from './useCustomSelectNavigation';

// CustomSelect.tsx
// A custom dropdown select component designed to replace the browser's default select element.
// Styled to match the rest of the application, handling light/dark mode and dynamic themes.
//
// 开合、外部点击收起与键盘操作在 useCustomSelectNavigation（那里的文件头写着全部规则），对全仓所有用法都
// 生效，没有开关，改动时要逐处想到。焦点在列表开着时也留在触发按钮上。
// - 触发按钮是 select-only combobox：role=combobox，aria-controls 指向列表，aria-activedescendant
//   指向高亮项，读屏能逐项听到移到了哪一项。combobox 不从内容取名字，所以既没有 ariaLabel 也没有
//   ariaLabelledBy 时，按钮由显示值的 span 命名，和原先按钮读内容一样。
// - ariaLabelledBy：触发按钮改由这些 id（例如字段或设置行的可见标签）加上显示值的 span 命名，读屏读出
//   「字段名 当前值」，与原生 select 的名字 + 值相当；这时 ariaLabel 只给列表命名。只给 ariaLabel 时按钮
//   名字只有 ariaLabel，当前值靠 combobox 的值报出。
// - compact：设置行里的触发按钮（32px、实底、无描边），菜单按选项需要的宽度从触发按钮右边缘挂下，
//   页面滚动时收起。
// - size="compact"：触发按钮与 Folium 表单的文本框（px-2.5 py-1.5 text-xs，约 30px）同高。
// - triggerClassName / triggerStyle：由调用方接管触发按钮的底色与描边（Folium 表单把输入框的 class /
//   style 原样传进来）。
// - placeholder 缺省走 i18n（ui.selectPlaceholder）。

interface CustomSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: CustomSelectOption[];
    /** Fired right before the menu opens, so callers can populate `options` on first demand. */
    onOpen?: () => void;
    placeholder?: string;
    /** Names the trigger and the menu. With `ariaLabelledBy` it names only the menu. */
    ariaLabel?: string;
    /**
     * Space-separated ids of the elements that name the trigger, such as a visible field label.
     * The trigger's own value text is appended, so a screen reader announces the field and its
     * current choice, as with a native select; `ariaLabel` alone would hide the value.
     */
    ariaLabelledBy?: string;
    disabled?: boolean;
    /** The trigger of a settings row: 32px high, filled, without a border. Its menu is as wide as its options need, ends at the trigger's right edge, and closes when the page under it scrolls. */
    compact?: boolean;
    /** Opens the menu above the trigger where it fits there: for a select near the bottom of a surface the menu would otherwise cover. */
    preferAbove?: boolean;
    isDaylight?: boolean;
    theme?: Theme;
    /** Density of the bordered trigger. `compact` lines up with the 30px text fields of Folium forms. */
    size?: 'default' | 'compact';
    /** Extra trigger classes. With this or `triggerStyle`, the trigger's background and border colour belong to the caller. */
    triggerClassName?: string;
    /** Inline trigger style, merged over the text colour (see `triggerClassName`). */
    triggerStyle?: React.CSSProperties;
}

const DROPDOWN_GAP = 4;
const DROPDOWN_VIEWPORT_GUTTER = 8;
const DROPDOWN_MAX_HEIGHT = 240;
const DROPDOWN_MIN_PREFERRED_HEIGHT = 160;
/** A compact trigger is often narrower than its longest option. */
const COMPACT_MENU_MIN_WIDTH = 160;
const COMPACT_MENU_MAX_WIDTH = 320;

const TRIGGER_BASE_CLASS = 'w-full flex items-center justify-between border focus:outline-none disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer';
const TRIGGER_SIZE_CLASS: Record<NonNullable<CustomSelectProps['size']>, string> = {
    default: 'rounded-xl px-4 py-3 text-sm',
    compact: 'gap-1.5 rounded-lg px-2.5 py-1.5 text-xs min-w-0',
};
const CHEVRON_SIZE: Record<NonNullable<CustomSelectProps['size']>, number> = { default: 16, compact: 14 };

export const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    onOpen,
    placeholder,
    ariaLabel,
    ariaLabelledBy,
    disabled = false,
    compact = false,
    preferAbove = false,
    isDaylight = false,
    theme,
    size = 'default',
    triggerClassName,
    triggerStyle,
}) => {
    const { t } = useTranslation();
    const [dropdownPosition, setDropdownPosition] = useState<CustomSelectMenuPosition | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const baseId = useId();
    const valueId = `${baseId}value`;
    const listboxId = `${baseId}listbox`;
    const reducedMotion = useReducedMotionFor('uiMicroMotion');
    const optionCount = options.length;
    const {
        isOpen,
        close,
        activeIndex,
        followActive,
        select,
        activateFromPointer,
        releasePointer,
        handleTriggerClick,
        handleTriggerKeyDown,
        handleTriggerKeyUp,
    } = useCustomSelectNavigation({
        options,
        value,
        disabled,
        onOpen,
        onChange,
        containerRef,
        menuRef,
        triggerRef,
        optionsPerPage: () => optionsPerPage(dropdownPosition?.maxHeight ?? DROPDOWN_MAX_HEIGHT, compact),
    });

    // Positions the portaled menu against the trigger and flips it when viewport space is limited.
    const updateDropdownPosition = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - DROPDOWN_GAP - DROPDOWN_VIEWPORT_GUTTER;
        const spaceAbove = rect.top - DROPDOWN_GAP - DROPDOWN_VIEWPORT_GUTTER;
        const useViewportPlacement = Math.max(spaceAbove, spaceBelow) < DROPDOWN_MIN_PREFERRED_HEIGHT;
        // A list asked to open above does so where the whole of it shows there.
        const fitsAbove = spaceAbove >= Math.min(DROPDOWN_MAX_HEIGHT, menuHeightOf(optionCount, compact));
        const placement: CustomSelectMenuPosition['placement'] = preferAbove && fitsAbove
            ? 'top'
            : useViewportPlacement
                ? 'viewport'
                : spaceBelow < DROPDOWN_MIN_PREFERRED_HEIGHT && spaceAbove > spaceBelow
                    ? 'top'
                    : 'bottom';
        const availableHeight = placement === 'viewport'
            ? window.innerHeight - DROPDOWN_VIEWPORT_GUTTER * 2
            : placement === 'top'
                ? spaceAbove
                : spaceBelow;
        const width = Math.min(rect.width, window.innerWidth - DROPDOWN_VIEWPORT_GUTTER * 2);
        // A compact menu hangs from the trigger's right edge and grows to the left with its longest
        // option, so it never passes the end of the row the trigger sits in.
        const horizontal = compact
            ? {
                right: Math.max(DROPDOWN_VIEWPORT_GUTTER, window.innerWidth - rect.right),
                // Neither bound lets the menu pass the left edge of the window.
                minWidth: Math.min(
                    Math.max(rect.width, COMPACT_MENU_MIN_WIDTH),
                    Math.max(rect.width, rect.right - DROPDOWN_VIEWPORT_GUTTER),
                ),
                maxWidth: Math.max(rect.width, Math.min(COMPACT_MENU_MAX_WIDTH, rect.right - DROPDOWN_VIEWPORT_GUTTER)),
            }
            : {
                left: Math.max(
                    DROPDOWN_VIEWPORT_GUTTER,
                    Math.min(rect.left, window.innerWidth - width - DROPDOWN_VIEWPORT_GUTTER),
                ),
                width,
            };

        setDropdownPosition({
            ...horizontal,
            maxHeight: Math.max(
                72,
                placement === 'viewport'
                    ? availableHeight
                    : Math.min(DROPDOWN_MAX_HEIGHT, availableHeight),
            ),
            placement,
            ...(placement === 'viewport'
                ? { top: DROPDOWN_VIEWPORT_GUTTER }
                : placement === 'top'
                ? { bottom: window.innerHeight - rect.top + DROPDOWN_GAP }
                : { top: rect.bottom + DROPDOWN_GAP }),
        });
    }, [compact, optionCount, preferAbove]);

    useLayoutEffect(() => {
        if (!isOpen) {
            setDropdownPosition(null);
            return;
        }

        // The list scrolling itself moves nothing. Anything else scrolling moves the trigger: a
        // compact menu closes, so it cannot follow a trigger that has left the view.
        const handleScroll = (event: Event) => {
            if (menuRef.current?.contains(event.target as Node)) {
                return;
            }
            if (compact) {
                close();
            } else {
                updateDropdownPosition();
            }
        };

        updateDropdownPosition();
        window.addEventListener('resize', updateDropdownPosition);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            window.removeEventListener('resize', updateDropdownPosition);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [close, compact, isOpen, updateDropdownPosition]);

    const selectedOption = options.find((opt) => opt.value === value);
    // 列表真正挂出来以后（dropdownPosition 在打开后的布局阶段才算好）才让触发按钮指向它和它的选项。
    const isMenuShown = isOpen && dropdownPosition !== null;
    // combobox 不从内容取名字：调用方什么名字都没给时，用显示值命名，和原先按钮读内容一样。
    const triggerLabelledBy = ariaLabelledBy
        ? `${ariaLabelledBy} ${valueId}`
        : ariaLabel ? undefined : valueId;
    const accentColor = theme?.accentColor || (isDaylight ? '#44403c' : '#f4f4f5');
    // The menu is portaled to document.body, so it cannot inherit the app container's theme variables.
    const textColor = theme?.primaryColor || (isDaylight ? '#1c1917' : '#f4f4f5');
    const borderColor = isDaylight ? 'rgba(28, 25, 23, 0.14)' : 'rgba(244, 244, 245, 0.14)';
    const openRing = isOpen ? `0 0 0 1px ${accentColor}` : undefined;
    // 调用方接管底色与描边时不再写 borderColor：它的 style 可能用 border 简写，混用会被 React 警告。
    const callerOwnsSurface = triggerClassName !== undefined || triggerStyle !== undefined;
    const triggerClass = compact
        ? `flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-lg pl-3 pr-2 text-[13px] ${reducedMotion ? '' : 'transition-colors '}focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${isOpen ? 'bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)]' : 'bg-[color-mix(in_srgb,var(--text-primary)_7%,transparent)] enabled:hover:bg-[color-mix(in_srgb,var(--text-primary)_12%,transparent)]'}`
        : `${TRIGGER_BASE_CLASS} ${reducedMotion ? '' : 'transition-all '}${TRIGGER_SIZE_CLASS[size]}${triggerClassName ? ` ${triggerClassName}` : ''}`;
    const triggerInlineStyle: React.CSSProperties = compact
        ? { color: 'var(--text-primary)' }
        : callerOwnsSurface
            ? { color: 'var(--text-primary)', ...triggerStyle, boxShadow: openRing ?? triggerStyle?.boxShadow }
            : {
                backgroundColor: 'var(--overlay-medium)',
                borderColor: isOpen ? accentColor : 'var(--border-color)',
                color: 'var(--text-primary)',
                boxShadow: openRing,
            };

    return (
        <div ref={containerRef} className={compact ? 'relative min-w-[136px] max-w-[240px]' : 'relative w-full'}>
            <button
                ref={triggerRef}
                type="button"
                role="combobox"
                onClick={handleTriggerClick}
                onKeyDown={handleTriggerKeyDown}
                onKeyUp={handleTriggerKeyUp}
                onBlur={close}
                disabled={disabled}
                aria-label={ariaLabelledBy ? undefined : ariaLabel}
                aria-labelledby={triggerLabelledBy}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                aria-controls={isMenuShown ? listboxId : undefined}
                aria-activedescendant={isMenuShown && activeIndex >= 0 ? customSelectOptionId(listboxId, activeIndex) : undefined}
                className={triggerClass}
                style={triggerInlineStyle}
            >
                <span id={triggerLabelledBy ? valueId : undefined} className="truncate">
                    {selectedOption ? selectedOption.label : (placeholder ?? t('ui.selectPlaceholder'))}
                </span>
                <ChevronDown
                    size={compact ? 16 : CHEVRON_SIZE[size]}
                    className={`${reducedMotion ? '' : 'transition-transform duration-200 '}shrink-0 opacity-70 ${isOpen ? 'rotate-180' : ''}`}
                    style={{ color: 'var(--text-secondary)' }}
                />
            </button>

            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence>
                    {isOpen && dropdownPosition && (
                        <CustomSelectMenu
                            menuRef={menuRef}
                            listboxId={listboxId}
                            position={dropdownPosition}
                            options={options}
                            value={value}
                            ariaLabel={ariaLabel}
                            ariaLabelledBy={ariaLabel ? undefined : ariaLabelledBy}
                            compact={compact}
                            isDaylight={isDaylight}
                            accentColor={accentColor}
                            textColor={textColor}
                            borderColor={borderColor}
                            activeIndex={activeIndex}
                            followActive={followActive}
                            onActivate={activateFromPointer}
                            onPointerLeave={releasePointer}
                            onSelect={select}
                        />
                    )}
                </AnimatePresence>,
                document.body,
            )}
        </div>
    );
};
