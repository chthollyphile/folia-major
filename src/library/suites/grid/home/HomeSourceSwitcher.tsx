import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Settings2 } from 'lucide-react';
import type { LibraryHomeGroupView, LibraryHomeOnlineSwitcher } from '../../../core/home/homeModel.contract';

// src/library/suites/grid/home/HomeSourceSwitcher.tsx
// 首页顶部胶囊里「当前在线音源」那一格：名字是当前音源的列表名（只有文字，超出最大宽度截断，全名在 title），
// 同时是音源切换器——已经在这个组上时再点一下名字，或者任何时候点旁边的小箭头，弹出已启用音源的列表。
// 列表与选择都来自 core（useLibraryHomeSources 的 onlineSwitcher，走账户 controller 的 selectProvider）；这里只画。
// 一个音源都没启用时名字是通用的词、没有箭头，点它去在线组（那一页引到「设置 → 音源」）。
// 键盘：名字与箭头都是按钮；列表开着时 ↑↓ / Home / End 移动，Enter / 空格选，Esc 或 Tab 收起并把焦点还给箭头。
// 网格首页的 Tab 被页签循环拿走（useGrid3DTabKeys），所以另有命令面板的「切换在线音源」经 openSignal 把列表打开。

type HomeSourceSwitcherProps = {
    group: LibraryHomeGroupView;
    switcher: LibraryHomeOnlineSwitcher;
    isDaylight: boolean;
    /** 选中与未选中的文字样式（与同一排别的页签一致，Grid3D 给）。 */
    activeClassName: string;
    inactiveClassName: string;
    /** 滑动高亮的 layoutId（与同一排别的页签共用一个）。 */
    highlightLayoutId: string;
    /** 去在线组（不在这个组上时点名字）。 */
    onSelectGroup: () => void;
    /** 选了一个音源；pressed 是按下去的那一行（登录窗口从它那一边出来）。 */
    onSelectSource: (providerId: string, pressed: Element | null) => void;
    /** 打开「设置 → 音源」；不给时列表里没有这一行。 */
    onManageSources?: () => void;
    /** 每变一次就把列表打开一次（命令面板的「切换在线音源」）；0 不算。 */
    openSignal?: number;
    /** 命令面板打开的列表收起后，焦点交回哪里（不给就留在小箭头上）。 */
    onDismissed?: () => void;
};

export const HomeSourceSwitcher: React.FC<HomeSourceSwitcherProps> = ({
    group,
    switcher,
    isDaylight,
    activeClassName,
    inactiveClassName,
    highlightLayoutId,
    onSelectGroup,
    onSelectSource,
    onManageSources,
    openSignal = 0,
    onDismissed,
}) => {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLSpanElement>(null);
    const arrowRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const menuId = useId();
    const hasMenu = !switcher.empty;
    const isOpen = open && hasMenu;
    const textClass = group.active ? activeClassName : inactiveClassName;

    // 命令面板要它打开：只认变化（挂载时带着的旧值不算，否则这一格重新挂载时列表会自己弹开）。
    // 这样打开的列表收起时焦点不留在小箭头上（没人把焦点带到过这里），交回首页（onDismissed）。
    const seenSignalRef = useRef(openSignal);
    const openedBySignalRef = useRef(false);
    useEffect(() => {
        if (openSignal === seenSignalRef.current) return;
        seenSignalRef.current = openSignal;
        openedBySignalRef.current = true;
        setOpen(true);
    }, [openSignal]);

    // 打开时焦点进列表（当前音源那一行）；点别处收起。
    useEffect(() => {
        if (!isOpen) return undefined;
        const rows = menuRef.current?.querySelectorAll<HTMLElement>('[data-source-row]:not(:disabled)');
        const current = menuRef.current?.querySelector<HTMLElement>('[data-source-row][aria-checked="true"]:not(:disabled)');
        (current ?? rows?.[0])?.focus({ preventScroll: true });
        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
            openedBySignalRef.current = false;
            setOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [isOpen]);

    const close = (restoreFocus: boolean) => {
        setOpen(false);
        const bySignal = openedBySignalRef.current;
        openedBySignalRef.current = false;
        if (!restoreFocus) return;
        if (bySignal && onDismissed) onDismissed();
        else arrowRef.current?.focus({ preventScroll: true });
    };
    const toggle = () => {
        openedBySignalRef.current = false;
        setOpen(previous => !previous);
    };

    const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        // 列表开着时按键都留在这里（网格首页的 Tab 循环、海报轨道的方向键不接）。
        event.stopPropagation();
        const rows = [...(menuRef.current?.querySelectorAll<HTMLElement>('[data-source-row]:not(:disabled)') ?? [])];
        const index = rows.findIndex(row => row === document.activeElement);
        const focusRow = (next: number) => {
            event.preventDefault();
            rows[(next + rows.length) % rows.length]?.focus({ preventScroll: true });
        };
        if (event.key === 'ArrowDown') focusRow(index + 1);
        else if (event.key === 'ArrowUp') focusRow(index - 1);
        else if (event.key === 'Home') focusRow(0);
        else if (event.key === 'End') focusRow(rows.length - 1);
        else if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            close(true);
        }
    };

    const surface = isDaylight
        ? 'bg-white/95 border-black/10 text-zinc-800 shadow-[0_18px_40px_rgba(15,23,42,0.18)]'
        : 'bg-zinc-950/95 border-white/10 text-zinc-100 shadow-[0_18px_40px_rgba(0,0,0,0.45)]';
    const rowHover = isDaylight ? 'hover:bg-black/[0.06] focus-visible:bg-black/[0.06]' : 'hover:bg-white/10 focus-visible:bg-white/10';
    const openLabel = t('home.sourceSwitcherOpen', { source: group.label });

    return (
        <span ref={rootRef} className="relative inline-flex" data-home-source-switcher>
            <span className={`relative inline-flex items-center rounded-full text-xs md:text-sm font-medium transition-colors duration-300 ${textClass}`}>
                {group.active && (
                    <motion.span
                        layoutId={highlightLayoutId}
                        className="absolute inset-0 rounded-full bg-white shadow-sm"
                        transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.9 }}
                    />
                )}
                <button
                    type="button"
                    data-home-group="online"
                    title={hasMenu && group.active ? `${group.label} · ${openLabel}` : group.label}
                    aria-label={group.label}
                    aria-current={group.active ? 'page' : undefined}
                    aria-haspopup={group.active && hasMenu ? 'menu' : undefined}
                    aria-expanded={group.active && hasMenu ? isOpen : undefined}
                    onClick={() => {
                        if (group.active && hasMenu) toggle();
                        else onSelectGroup();
                    }}
                    className={`relative z-10 inline-flex items-center rounded-full py-1.5 pl-4 ${hasMenu ? 'pr-1' : 'pr-4'}`}
                >
                    <span className="block max-w-[9rem] truncate">{group.label}</span>
                </button>
                {hasMenu && (
                    <button
                        ref={arrowRef}
                        type="button"
                        data-home-source-arrow
                        title={openLabel}
                        aria-label={openLabel}
                        aria-haspopup="menu"
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? menuId : undefined}
                        onClick={toggle}
                        onKeyDown={(event) => {
                            if (event.key !== 'ArrowDown' || isOpen) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setOpen(true);
                        }}
                        className="relative z-10 inline-flex items-center rounded-full py-1.5 pl-0.5 pr-2.5 opacity-60 transition-opacity hover:opacity-100 focus-visible:opacity-100"
                    >
                        <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                    </button>
                )}
            </span>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        ref={menuRef}
                        id={menuId}
                        role="menu"
                        aria-label={t('home.sourceSwitcherList')}
                        data-home-source-menu
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.16 }}
                        onKeyDown={onMenuKeyDown}
                        className={`absolute left-1/2 top-full z-40 mt-2 w-60 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl border p-1.5 text-left backdrop-blur-xl ${surface}`}
                    >
                        <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wide opacity-50">
                            {t('home.sourceSwitcherList')}
                        </div>
                        <div className="max-h-[min(22rem,60vh)] overflow-y-auto custom-scrollbar">
                            {switcher.options.map(option => (
                                <button
                                    key={option.providerId}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={option.active}
                                    data-source-row={option.providerId}
                                    disabled={option.disabled}
                                    title={`${option.label} · ${option.detail}`}
                                    onClick={(event) => {
                                        const pressed = event.currentTarget;
                                        close(true);
                                        if (!option.active) onSelectSource(option.providerId, pressed);
                                    }}
                                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${rowHover}`}
                                >
                                    <span className="flex w-4 shrink-0 justify-center">
                                        {option.active && <Check size={14} aria-hidden />}
                                    </span>
                                    <span className="min-w-0 flex-1 text-left">
                                        <span className={`block truncate ${option.active ? 'font-semibold' : 'font-medium'}`}>{option.label}</span>
                                        <span className="block truncate text-[11px] opacity-55">{option.detail}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                        {onManageSources && (
                            <>
                                <div role="separator" className={`mx-2 my-1 h-px ${isDaylight ? 'bg-black/10' : 'bg-white/10'}`} />
                                <button
                                    type="button"
                                    role="menuitem"
                                    data-source-row="manage"
                                    onClick={() => {
                                        close(false);
                                        onManageSources();
                                    }}
                                    className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm outline-none transition-colors ${rowHover}`}
                                >
                                    <span className="flex w-4 shrink-0 justify-center"><Settings2 size={14} aria-hidden /></span>
                                    <span className="truncate opacity-80">{t('home.sourceSwitcherManage')}</span>
                                </button>
                            </>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
        </span>
    );
};

export default HomeSourceSwitcher;
