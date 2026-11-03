import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useReducedMotionFor } from '../../hooks/useReducedMotionFor';
import { useSupportsFinePointer } from '../../hooks/useSupportsFinePointer';
import { usePonderStore } from '../../stores/usePonderStore';
import { filterPonderIndex, type PonderIndexFilter } from '../../utils/ponder/ponderIndexFilter';
import { Group } from '../modal/settings/kit';
import { SettingsKitThemeContext } from '../modal/settings/kit/kitTheme';
import { tabStops } from '../shared/Sheet';
import { tabTarget } from '../shared/sheetKeys';
import { ponderLayerMotion, ponderSwapMotion, ponderTransition } from './ponderMotion';
import { ponderTargetsByCategory } from './ponderRegistry';
import { PONDER_ICON_BUTTON_CLASS, ponderLayerTokens, ponderWindowTokens } from './ponderTheme';
import { PONDER_QUIET_CAP, PonderKeyCombo, ponderModifierLabel } from './PonderKeyCap';
import PonderLessonRow from './PonderLessonRow';
import type { Theme } from '../../types';

// src/components/ponder/PonderNavigationPage.tsx
// 思索的全部教程：一个和设置窗口同一家的窗口。左边是搜索框和筛选（全部、未看过、各个分类，
// 各带条数），右边按分类一组一张卡，每条教程一行。
//
// 它存在的理由是总览不能无限长。原先帮助页那颗按钮直接开一段六章的教程，于是
// 「Folia 大致怎么转」和「壁纸模式怎么用」被排在同一条线上 —— 想看后者得先看完前者。
// 拆开之后，总览只剩一章（Ctrl+G 就是它），具体那一条从这里挑。
//
// 每一行都挂 data-ponder-nav-target：悬停满 600ms 出提示、长按 G 进去，和在真实组件上
// 的操作完全一样；点一下直接进。这两条路由 resolveHoveredPonderTarget 统一认。
//
// 挂 data-folia-keyboard-window 是为了让底下的全局热键让路；思索的悬停提示不受影响 ——
// ponderHintGate 对「目标就在这个窗口内部」的情况是放行的，而这里正是那种情况。

type PonderNavigationPageProps = {
    theme?: Theme;
    isDaylight: boolean;
};

const PonderNavigationPage: React.FC<PonderNavigationPageProps> = ({ theme, isDaylight }) => {
    const { t } = useTranslation();
    const calm = useReducedMotionFor('uiMicroMotion');
    const isOpen = usePonderStore(state => state.isNavigationOpen);
    const closeNavigation = usePonderStore(state => state.closeNavigation);
    const openPonder = usePonderStore(state => state.openPonder);
    const seenIds = usePonderStore(state => state.seenTargetIds);
    const supportsFinePointer = useSupportsFinePointer();
    const [filter, setFilter] = React.useState<PonderIndexFilter>('all');
    const [query, setQuery] = React.useState('');
    const scrollRef = React.useRef<HTMLDivElement>(null);
    const panelRef = React.useRef<HTMLDivElement>(null);
    // 这一下鼠标是不是按下和松开都在窗口外面：在里面按下拖到外面松手、在外面按下拖到里面松手，
    // 都不算点了外面。
    const pressedOutsideRef = React.useRef(false);

    const groups = React.useMemo(
        () => ponderTargetsByCategory()
            .map(group => ({
                ...group,
                // 目标自己说此刻讲不讲得通（桌面端那一组在浏览器里就不该出现）。
                targets: group.targets.filter(target => target.isAvailable?.() !== false),
            }))
            .filter(group => group.targets.length > 0),
        // 只在打开时求值一次：isAvailable 读的是运行时环境，而它在这一屏开着的时候不会变。
        [isOpen],
    );
    const lessons = groups.flatMap(group => group.targets);
    const shown = filterPonderIndex(groups, {
        filter,
        query,
        seen: seenIds,
        // 搜的是屏幕上写着的那两行：标题和那一句话。
        textOf: target => `${t(target.titleKey)} ${target.summaryKey ? t(target.summaryKey, { mod: ponderModifierLabel }) : ''}`,
    });
    const filters: { id: PonderIndexFilter; label: string; count: number; divided?: boolean }[] = [
        { id: 'all', label: t('ponder.navigation.all'), count: lessons.length },
        { id: 'unseen', label: t('ponder.navigation.unseen'), count: lessons.filter(target => !seenIds.has(target.id)).length },
        ...groups.map((group, index) => ({
            id: group.category,
            label: t(`ponder.categories.${group.category}`),
            count: group.targets.length,
            divided: index === 0,
        })),
    ];
    const filterLabel = filters.find(entry => entry.id === filter)?.label ?? '';

    // 开着的时候键盘归这个窗口，做法照 Sheet：焦点进来，落在窗口本身（落在搜索框上的话触屏会
    // 弹出键盘）；Tab 留在里面；Esc 关掉。关掉时搜索和筛选回到开头，焦点还给打开前拿着它的那个。
    // 教程开在上面时这个窗口还开着，不算关。
    React.useEffect(() => {
        if (!isOpen) {
            return undefined;
        }
        const panel = panelRef.current;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (panel && !panel.contains(opener)) {
            panel.focus({ preventScroll: true });
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeNavigation();
                return;
            }
            // 教程开在上面时，Tab 是教程那一层的。
            if (event.key === 'Tab' && panel && !usePonderStore.getState().session) {
                const stops = tabStops(panel);
                const target = tabTarget(stops.length, stops.indexOf(document.activeElement as HTMLElement), event.shiftKey);
                if (stops.length === 0 || target !== null) {
                    event.preventDefault();
                    (target === null ? panel : stops[target]).focus();
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            setFilter('all');
            setQuery('');
            // 打开前拿着焦点的那个还在页面里才还；焦点已经被放到别处就不动。
            const active = document.activeElement;
            if (opener?.isConnected && (!active || active === document.body || panel?.contains(active))) {
                opener.focus({ preventScroll: true });
            }
        };
    }, [isOpen, closeNavigation]);

    const selectFilter = (next: PonderIndexFilter) => {
        setFilter(next);
        setQuery('');
    };

    const handleQueryChange = (next: string) => {
        setQuery(next);
        // 搜索搜的是全部教程，不是当前这一类。
        if (next.trim() !== '') setFilter('all');
    };

    const layer = ponderLayerMotion(calm);
    const kitTheme = React.useMemo(() => ({ isDaylight, theme }), [isDaylight, theme]);

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    {...layer.backdrop}
                    // 页面级 Ctrl+G 在这一屏上打开的是总览，不是底下那一页。
                    data-ponder-page-scope="help-page"
                    data-folia-keyboard-window="true"
                    data-testid="ponder-navigation"
                    className="fixed inset-0 z-[195] flex items-center justify-center bg-[var(--pd-scrim)] px-4 py-8 backdrop-blur-[18px] sm:px-5 sm:py-12"
                    style={ponderLayerTokens(isDaylight, theme)}
                    role="dialog"
                    aria-modal="true"
                    aria-label={t('ponder.navigation.title')}
                    onMouseDown={event => { pressedOutsideRef.current = event.target === event.currentTarget; }}
                    onMouseUp={event => {
                        if (event.target !== event.currentTarget) pressedOutsideRef.current = false;
                    }}
                    onClick={event => {
                        if (pressedOutsideRef.current && event.target === event.currentTarget) closeNavigation();
                    }}
                >
                    <motion.div
                        {...layer.panel}
                        ref={panelRef}
                        tabIndex={-1}
                        className="st-window relative flex h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-[var(--st-win)] text-[color:var(--st-t1)] shadow-[0_36px_90px_rgba(0,0,0,0.5),0_0_0_1px_var(--st-line2)] md:grid md:h-[86vh] md:w-[960px] md:grid-cols-[216px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]"
                        // 窗口本身拿着焦点时不画焦点框。
                        style={{ outline: 'none', ...ponderWindowTokens(isDaylight, theme, calm) }}
                    >
                        <SettingsKitThemeContext.Provider value={kitTheme}>
                            <aside className="flex min-h-0 shrink-0 flex-col border-b border-[var(--st-line)] bg-[var(--st-side)] px-3 pb-2 pt-3 md:border-b-0 md:border-r md:pb-3.5 md:pt-4">
                                <label className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-transparent bg-[var(--st-fill)] px-2.5 text-[color:var(--st-t3)] pd-t-quick transition-colors focus-within:border-[var(--st-line2)]">
                                    <Search size={14} className="shrink-0" />
                                    <input
                                        type="search"
                                        value={query}
                                        onChange={event => handleQueryChange(event.target.value)}
                                        onKeyDown={event => {
                                            // 第一下 Esc 清空搜索；框空了它才去关窗口。
                                            if (event.key === 'Escape' && query) {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setQuery('');
                                            }
                                        }}
                                        placeholder={t('ponder.navigation.search')}
                                        aria-label={t('ponder.navigation.search')}
                                        className="min-w-0 flex-1 bg-transparent text-[13px] text-[color:var(--st-t1)] outline-none placeholder:text-[color:var(--st-t3)] [&::-webkit-search-cancel-button]:hidden"
                                    />
                                    {query && (
                                        <button
                                            type="button"
                                            onClick={() => setQuery('')}
                                            aria-label={t('options.settingsSearchClear')}
                                            className="pd-t-quick shrink-0 transition-colors hover:text-[color:var(--st-t1)]"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </label>
                                {/* 窄窗口下这一列排成一条能横向滑的带子。 */}
                                <nav className="mt-2 flex min-h-0 gap-1 overflow-x-auto [scrollbar-width:none] md:mt-3 md:flex-1 md:flex-col md:gap-0 md:overflow-y-auto md:overflow-x-hidden">
                                    {filters.map(entry => {
                                        const isActive = entry.id === filter;
                                        return (
                                            <React.Fragment key={entry.id}>
                                                {entry.divided && <hr className="mx-2.5 my-2.5 hidden h-px shrink-0 border-0 bg-[var(--st-line)] md:block" />}
                                                <button
                                                    type="button"
                                                    aria-current={isActive ? 'true' : undefined}
                                                    onClick={() => selectFilter(entry.id)}
                                                    className={`st-focus-inside pd-t-quick relative flex h-[34px] shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-lg px-2.5 text-left text-[13px] transition-colors hover:text-[color:var(--st-t1)] md:w-full ${isActive ? 'text-[color:var(--st-t1)]' : 'text-[color:var(--st-t2)]'}`}
                                                >
                                                    {isActive && (
                                                        // 选中的底色只有一块，换选时从上一项滑到这一项。
                                                        <motion.span
                                                            layoutId="ponder-index-filter"
                                                            transition={ponderTransition('move', calm, 'travel')}
                                                            className="absolute inset-0 rounded-lg bg-[var(--st-fill2)]"
                                                        />
                                                    )}
                                                    <span className="relative min-w-0 truncate">{entry.label}</span>
                                                    <span className="relative flex-none text-xs tabular-nums text-[color:var(--st-t3)]">{entry.count}</span>
                                                </button>
                                            </React.Fragment>
                                        );
                                    })}
                                </nav>
                                {/* 两行键位只对有键盘和指针的人有用。 */}
                                {supportsFinePointer && (
                                    <div className="hidden shrink-0 gap-2 border-t border-[var(--st-line)] px-2.5 pt-3 text-xs text-[color:var(--st-t2)] md:grid">
                                        <div className="flex items-center gap-2">
                                            <PonderKeyCombo combo="G" {...PONDER_QUIET_CAP} />
                                            {t('ponder.title')}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <PonderKeyCombo combo="Ctrl G" {...PONDER_QUIET_CAP} />
                                            {t('ponder.hintCapsulePage')}
                                        </div>
                                    </div>
                                )}
                            </aside>
                            <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                                <header className="flex shrink-0 items-center justify-between gap-4 pl-4 pr-3 pt-4 md:pl-8 md:pr-4 md:pt-5">
                                    <div className="flex min-w-0 items-baseline gap-3.5">
                                        <h2 className="text-xl font-semibold leading-8">{t('ponder.title')}</h2>
                                        <span className="truncate text-[13px] text-[color:var(--st-t2)]">{filterLabel}</span>
                                    </div>
                                    <button
                                        type="button"
                                        data-testid="ponder-navigation-close"
                                        onClick={closeNavigation}
                                        aria-label={t('ui.close')}
                                        className={PONDER_ICON_BUTTON_CLASS}
                                    >
                                        <X size={16} aria-hidden="true" />
                                    </button>
                                </header>
                                <div
                                    ref={scrollRef}
                                    className="st-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-12 md:px-8"
                                >
                                    {/* 换筛选时旧的一屏先退、新的再上来；搜索只是就地过滤，不带动效。 */}
                                    <AnimatePresence
                                        mode="wait"
                                        initial={false}
                                        onExitComplete={() => scrollRef.current?.scrollTo({ top: 0 })}
                                    >
                                        <motion.div key={filter} {...ponderSwapMotion(calm)}>
                                            {shown.length === 0 && (
                                                <p className="my-[72px] text-center text-[13px] text-[color:var(--st-t2)]">
                                                    {t('ponder.navigation.empty')}
                                                </p>
                                            )}
                                            {shown.map(group => (
                                                <Group
                                                    key={group.category}
                                                    def={{ id: `ponder-${group.category}`, titleKey: `ponder.categories.${group.category}` }}
                                                    // 只看一类时左边已经写着是哪一类，不再重复一遍标题。
                                                    bare={filter === group.category}
                                                    action={(
                                                        <span className="text-xs tabular-nums text-[color:var(--st-t3)]">{group.targets.length}</span>
                                                    )}
                                                >
                                                    {group.targets.map(target => (
                                                        <PonderLessonRow
                                                            key={target.id}
                                                            target={target}
                                                            seen={seenIds.has(target.id)}
                                                            onOpen={() => openPonder(target.id)}
                                                        />
                                                    ))}
                                                </Group>
                                            ))}
                                        </motion.div>
                                    </AnimatePresence>
                                </div>
                            </section>
                        </SettingsKitThemeContext.Provider>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
};

export default PonderNavigationPage;
