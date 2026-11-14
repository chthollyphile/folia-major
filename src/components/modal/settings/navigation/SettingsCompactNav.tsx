import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu as MenuIcon, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReducedMotionFor } from '../../../../hooks/useReducedMotionFor';
import { tabTarget } from '../../../shared/sheetKeys';
import { kitTransition } from '../kit/motion';
import SettingsSearchField from './SettingsSearchField';
import SettingsSideList from './SettingsSideList';
import type { SettingsNavGroup, SettingsSectionId } from './settingsNavModel';
// src/components/modal/settings/navigation/SettingsCompactNav.tsx
// 紧凑档（窄于 768px）的设置导航：顶上一行只有菜单按钮、搜索框和关闭按钮，没有横排的分类条。
// 菜单按钮打开的就是宽屏那个侧栏（分组标题、Help 在底部），只是不带搜索框——搜索框留在顶栏上。
// 关闭按钮也在这条栏的右端，所以页眉那边不再画（`PageHeader showClose={false}`）。
// 选完一个类别、按 Escape、点遮罩都会把它收起；收起后焦点回到菜单按钮。

type SettingsCompactNavProps = {
    groups: SettingsNavGroup[];
    /** The category on screen, 'help', or null while search results are shown. */
    activeId: SettingsSectionId | 'help' | null;
    onSelectSection: (sectionId: SettingsSectionId) => void;
    onSelectHelp: () => void;
    query: string;
    onQueryChange: (query: string) => void;
    /** Enter in the search field. */
    onSubmitQuery: () => void;
    /** 遮罩跟着日夜走：日光主题下一层黑太重，和弹窗自己的遮罩不一致。 */
    isDaylight: boolean;
    /** 关闭整个设置弹窗：紧凑档的关闭按钮在这条顶栏的右端，页眉里不再有第二颗。 */
    onClose: () => void;
    closeLabel: string;
};

const DRAWER_ID = 'settings-nav-drawer';
/** What Tab stops at inside the drawer. */
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export const SettingsCompactNav: React.FC<SettingsCompactNavProps> = ({
    groups,
    activeId,
    onSelectSection,
    onSelectHelp,
    query,
    onQueryChange,
    onSubmitQuery,
    isDaylight,
    onClose,
    closeLabel,
}) => {
    const { t } = useTranslation();
    const calm = useReducedMotionFor('uiMicroMotion');
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLButtonElement>(null);
    const drawerRef = useRef<HTMLDivElement>(null);
    const navLabel = t('options.settingsNavMenu');

    // 打开时把焦点直接放到第一个分类上：键盘用户接着 Tab 就走得下去，读屏也念得出进来的是什么。
    useEffect(() => {
        if (isOpen) {
            drawerRef.current?.querySelector<HTMLElement>('nav button')?.focus({ preventScroll: true });
        }
    }, [isOpen]);

    const close = () => {
        setIsOpen(false);
        // 焦点回到打开抽屉的那颗按钮，不留在正在退场的抽屉里。
        menuRef.current?.focus({ preventScroll: true });
    };

    // 抽屉开着时 Escape 只收起抽屉。挂在 window 的捕获阶段：弹窗自己的 Escape 在冒泡阶段，
    // 而焦点不一定在抽屉里（点了抽屉里的空白处焦点就落到 body），挂在抽屉元素上会漏掉。
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing) return;
            event.preventDefault();
            event.stopPropagation();
            setIsOpen(false);
            menuRef.current?.focus({ preventScroll: true });
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [isOpen]);

    // Tab 只在这个抽屉里转：鼠标点不到遮罩后面的顶栏和内容，键盘也不该跑出去。
    const handleDrawerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Tab' || !drawerRef.current) {
            return;
        }
        const focusables = [...drawerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const current = focusables.indexOf(document.activeElement as HTMLElement);
        const target = tabTarget(focusables.length, current, event.shiftKey);
        if (target === null) {
            return;
        }
        event.preventDefault();
        focusables[target]?.focus();
    };

    return (
        <>
            <div className="relative z-20 flex shrink-0 items-center gap-2 border-b border-[var(--st-line)] bg-[var(--st-side)] px-3 py-2">
                <button
                    ref={menuRef}
                    type="button"
                    onClick={() => setIsOpen(true)}
                    aria-expanded={isOpen}
                    aria-controls={DRAWER_ID}
                    aria-label={navLabel}
                    title={navLabel}
                    data-testid="settings-nav-toggle"
                    className="st-t-fast grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[color:var(--st-t2)] transition-colors hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)]"
                >
                    <MenuIcon size={16} />
                </button>
                <SettingsSearchField
                    query={query}
                    onQueryChange={onQueryChange}
                    onSubmitQuery={onSubmitQuery}
                    className="min-w-0 flex-1"
                />
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={closeLabel}
                    title={closeLabel}
                    data-testid="settings-close"
                    className="st-t-fast grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[color:var(--st-t2)] transition-colors hover:bg-[var(--st-fill)] hover:text-[color:var(--st-t1)]"
                >
                    <X size={16} />
                </button>
            </div>
            <AnimatePresence>
                {isOpen && (
                    <div key="drawer" className="absolute inset-0 z-40">
                        {/* 遮罩挡住的只是弹窗里这一层：点它收起抽屉，不关设置。
                            遮罩渐显、抽屉整个从左边滑进来，两者同一个时长（设置 kit 的 unfold）。 */}
                        <motion.div
                            className={`absolute inset-0 ${isDaylight ? 'bg-black/30' : 'bg-black/50'}`}
                            onClick={close}
                            role="presentation"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={kitTransition('unfold', calm)}
                        />
                        <motion.div
                            ref={drawerRef}
                            id={DRAWER_ID}
                            role="dialog"
                            aria-modal="true"
                            aria-label={navLabel}
                            onKeyDown={handleDrawerKeyDown}
                            data-testid="settings-nav-drawer"
                            initial={{ x: '-100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '-100%' }}
                            transition={kitTransition('unfold', calm)}
                            className="absolute inset-y-0 left-0 flex w-[248px] max-w-[82%] flex-col shadow-[0_18px_48px_rgba(0,0,0,0.35)]"
                        >
                            <SettingsSideList
                                groups={groups}
                                activeId={activeId}
                                onSelectSection={sectionId => {
                                    close();
                                    onSelectSection(sectionId);
                                }}
                                onSelectHelp={() => {
                                    close();
                                    onSelectHelp();
                                }}
                                query={query}
                                onQueryChange={onQueryChange}
                                onSubmitQuery={onSubmitQuery}
                                showSearch={false}
                            />
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
};

export default SettingsCompactNav;
