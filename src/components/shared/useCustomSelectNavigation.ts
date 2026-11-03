import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type RefObject } from 'react';
import type { CustomSelectOption } from './CustomSelectMenu';

// src/components/shared/useCustomSelectNavigation.ts
// CustomSelect 的开合状态、外部点击收起与键盘操作。下面这些行为对全仓所有 CustomSelect 用法都生效，
// 不受任何参数控制。
//
// 焦点一直留在触发按钮上（菜单在 mousedown 上 preventDefault），所以键都从触发按钮的 onKeyDown 来：
// - 菜单关着：Enter、空格、↑↓ 打开（stopPropagation，命令面板的 Enter 不会把它当成「执行当前命令」，
//   播放页的空格也不会跟着暂停）；空格抬起时不让按钮再补发一次 click。
// - 菜单开着：↑↓ / Home / End / PageUp / PageDown 与打字查找移动高亮；Enter（以及不在打字中的空格）选中
//   高亮项；Escape 只关菜单；Tab 收起、焦点照常移走；输入法组字时的键留给输入法，也不往外传。用到的键
//   都 stopPropagation：命令面板和设置弹窗都在 window 的冒泡阶段听 Escape，不拦下会连外层一起关掉。
//   window 捕获阶段更早挂上的监听仍先于这里；收裸字母的那几个问 isTextEntryTarget，它认得开着的列表。
// - 焦点离开触发按钮即收起（同原生 select 失焦即收）。
// - 菜单开着时在 document 的捕获阶段听 mousedown：命令面板的面板根节点写了 onMouseDown stopPropagation，
//   冒泡阶段的监听收不到面板内的点击，菜单就关不掉（还会和另一个下拉同时开着）。
// - 菜单开着时被禁用即收起：它不再读键，Escape 也不读。
//
// 高亮按值记，不按下标：调用方可以在 onOpen 里才去填选项（播放设置的音频输出设备就是打开时才枚举），
// 菜单开着选项就变了。按下标记的高亮会停在同一位置上换进来的别的项，Enter 选中的就不是看着的那一项。
//
// 高亮停在当前值上按 Enter 只收起菜单，不调用 onChange：原生 select 不为没变的值发 change，
// 「Enter 打开、Enter 关闭」也从不调用 onChange（GridView 换每日推荐日期、播放设置换输出设备这些
// onChange 都有副作用）。鼠标点当前项照旧报告——FoliumSelectField 靠它把陈旧的存储值写成显示出来的回退值。

/**
 * 高亮项。value 为 null 表示没有高亮；value 不在选项里时也不高亮任何一行，等选项里出现它再高亮。
 * fromKeyboard 为 true 时菜单要把它滚进视野（键盘移动高亮，或用键盘打开菜单）；指针悬停产生的
 * 高亮不滚动，免得列表在鼠标下面跑。
 */
export interface CustomSelectActiveOption {
    value: string | null;
    fromKeyboard: boolean;
}

interface UseCustomSelectNavigationArgs {
    options: CustomSelectOption[];
    value: string;
    disabled: boolean;
    onOpen?: () => void;
    onChange: (value: string) => void;
    containerRef: RefObject<HTMLElement | null>;
    menuRef: RefObject<HTMLElement | null>;
    triggerRef: RefObject<HTMLButtonElement | null>;
    /** How many options PageUp and PageDown move by: the options the open menu shows at once. */
    optionsPerPage: () => number;
}

/** Letters typed further apart than this start a new search. */
const TYPEAHEAD_RESET_MS = 600;

/** 键盘移动一格后的高亮下标：没有高亮时 ↓ 落到第一项、↑ 落到最后一项；其余夹在两端，不循环（同原生 select）。 */
export const stepCustomSelectIndex = (current: number, delta: 1 | -1, count: number): number => {
    if (count <= 0) return -1;
    if (current < 0 || current >= count) return delta > 0 ? 0 : count - 1;
    return Math.min(count - 1, Math.max(0, current + delta));
};

/** 某个值在当前选项里的下标；null 或不在选项里为 -1。 */
const findOptionIndex = (options: CustomSelectOption[], value: string | null) => (
    value === null ? -1 : options.findIndex((option) => option.value === value)
);

const hasCommandModifier = (event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean }) => (
    event.altKey || event.ctrlKey || event.metaKey
);

export const useCustomSelectNavigation = ({
    options,
    value,
    disabled,
    onOpen,
    onChange,
    containerRef,
    menuRef,
    triggerRef,
    optionsPerPage,
}: UseCustomSelectNavigationArgs) => {
    const [isOpen, setIsOpen] = useState(false);
    const [active, setActive] = useState<CustomSelectActiveOption>({ value: null, fromKeyboard: false });
    const typeaheadRef = useRef({ text: '', at: 0 });
    // 每次渲染按最新的选项换算，选项在菜单开着时变了也落在同一项上。
    const activeIndex = findOptionIndex(options, active.value);

    const close = useCallback(() => setIsOpen(false), []);

    const select = useCallback((nextValue: string) => {
        onChange(nextValue);
        setIsOpen(false);
    }, [onChange]);

    // 每次打开都从当前选中项开始高亮，打字查找重新开始。用键盘打开时把它滚进视野：长列表里当前项
    // 可能在视口以下，虚拟化分支里那一行甚至还没渲染。
    const open = (fromKeyboard: boolean) => {
        if (disabled) return;
        onOpen?.();
        typeaheadRef.current = { text: '', at: 0 };
        setActive({ value, fromKeyboard });
        setIsOpen(true);
    };

    // 空格（以及读屏的默认动作）激活按钮时，浏览器补发的 click 的 detail 为 0；真实的指针点击至少为 1。
    const handleTriggerClick = (event: ReactMouseEvent<HTMLButtonElement>) => {
        if (disabled) return;
        // Not every browser focuses a button it is clicked on, and the keys are read from the trigger.
        triggerRef.current?.focus();
        if (isOpen) close();
        else open(event.detail === 0);
    };

    // 指针移到某一项上：高亮跟着指针走。
    const activateFromPointer = useCallback((optionValue: string) => {
        setActive((previous) => (
            previous.value === optionValue && !previous.fromKeyboard ? previous : { value: optionValue, fromKeyboard: false }
        ));
    }, []);

    // 指针离开菜单：指针留下的高亮退回选中项；键盘高亮保留。
    const releasePointer = useCallback(() => {
        setActive((previous) => (
            previous.fromKeyboard || previous.value === value
                ? previous
                : { value, fromKeyboard: false }
        ));
    }, [value]);

    const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (disabled || hasCommandModifier(event)) return;
        const { key } = event;

        if (!isOpen) {
            if (event.nativeEvent.isComposing) return;
            if (key === 'Enter' || key === ' ' || key === 'ArrowDown' || key === 'ArrowUp') {
                event.preventDefault();
                event.stopPropagation();
                open(true);
            }
            return;
        }

        // An input method is composing: the key is its own, and not the page's behind the list either.
        if (event.nativeEvent.isComposing || key === 'Process') {
            event.stopPropagation();
            return;
        }

        const count = options.length;
        const lastIndex = count - 1;
        const typeahead = typeaheadRef.current;
        const now = Date.now();
        const isTyping = typeahead.text !== '' && now - typeahead.at <= TYPEAHEAD_RESET_MS;
        const moveTo = (index: number) => setActive({ value: options[index]?.value ?? null, fromKeyboard: true });

        if (key === 'Escape') {
            close();
        } else if (key === 'Enter' || (key === ' ' && !isTyping)) {
            // A held Enter acts once.
            if (!event.repeat) {
                const option = options[activeIndex];
                // 停在当前值上只收起，不报告没变的值（见文件头）。
                if (option && option.value !== value) select(option.value);
                else close();
            }
        } else if (key === 'ArrowDown' || key === 'ArrowUp') {
            moveTo(stepCustomSelectIndex(activeIndex, key === 'ArrowDown' ? 1 : -1, count));
        } else if (key === 'Home') {
            moveTo(count > 0 ? 0 : -1);
        } else if (key === 'End') {
            moveTo(lastIndex);
        } else if (key === 'PageDown' || key === 'PageUp') {
            const page = optionsPerPage();
            moveTo(key === 'PageDown'
                ? Math.min(lastIndex, activeIndex + page)
                : activeIndex < 0 ? lastIndex : Math.max(0, activeIndex - page));
        } else if (key === 'Tab') {
            // 焦点照常移走，菜单跟着收起。
            close();
            return;
        } else if (key.length === 1 && count > 0) {
            // Type-ahead: the next option whose label starts with what was typed; a space typed in
            // the middle of it is part of the text. One letter typed again and again steps through
            // the options that start with it.
            typeahead.text = isTyping ? typeahead.text + key : key;
            typeahead.at = now;
            const typed = typeahead.text.toLowerCase();
            const isOneLetter = [...typed].every(letter => letter === typed[0]);
            const needle = isOneLetter ? typed[0] : typed;
            const start = isOneLetter ? activeIndex + 1 : Math.max(0, activeIndex);
            const match = options.findIndex((_, offset) => (
                options[(start + offset) % count].label.toLowerCase().startsWith(needle)
            ));
            if (match >= 0) moveTo((start + match) % count);
        } else if (key.length !== 1) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
    };

    // A button clicks itself when Space comes up; the key was handled when it went down.
    const handleTriggerKeyUp = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === ' ') event.preventDefault();
    };

    // A list that is disabled while it is open closes: it no longer reads the keys, Escape included.
    useEffect(() => {
        if (disabled) setIsOpen(false);
    }, [disabled]);

    useEffect(() => {
        if (!isOpen) return undefined;

        // Close the dropdown when clicking outside of the container
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!containerRef.current?.contains(target) && !menuRef.current?.contains(target)) close();
        };

        document.addEventListener('mousedown', handlePointerDown, true);
        return () => document.removeEventListener('mousedown', handlePointerDown, true);
    }, [close, containerRef, isOpen, menuRef]);

    return {
        isOpen,
        close,
        activeIndex,
        followActive: active.fromKeyboard,
        select,
        activateFromPointer,
        releasePointer,
        handleTriggerClick,
        handleTriggerKeyDown,
        handleTriggerKeyUp,
    };
};
