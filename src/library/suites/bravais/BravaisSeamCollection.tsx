import React, { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ChevronDown, ChevronLeft, ChevronRight, Inbox, List, Loader2, MoreHorizontal, RefreshCw, SearchX, SlidersHorizontal, Star, Tags } from 'lucide-react';
import type {
    BravaisSeamCollection as BravaisSeamCollectionModel,
    BravaisSeamReload,
    BravaisSeamStatus,
    BravaisSeamSubscribe,
    BravaisSeamTone,
} from './bravaisSeamModels';
import { BravaisSeamFlipText } from './BravaisSeamFlip';
import { useBravaisReducedTransitions } from './bravaisMotion';
import { bravaisPopMotion, bravaisRevealMotion, seamPopAnchorFor } from './bravaisSeamMotion';
import { planQuickCells, quickBusyIcon } from './bravaisSeamQuickCells';
import { useBravaisSeamQuickSlots } from './useBravaisSeamQuickSlots';
import './bravaisCollection.css';

// src/library/suites/bravais/BravaisSeamCollection.tsx
// 完整信息条里集合层的那几块（设计稿 §10.1 放置原则、§10.2、§10.6）：
// （过滤输入位每面墙都有，在 BravaisSeamFilterField。）
// - 元数据行（「N 首」）：集合能重新拉取时整行是一个按钮，计数后面一个刷新图标（不再进「⋯ 更多」）；
// - 收藏星标（subscribing 时转圈；fb10 起在按钮行末尾）；元数据行的补页进度（中断时整行是「续传」）；每日推荐的日期步进
//   （平台有风格推荐时上面多一行「默认推荐 / 风格推荐」，看风格推荐时步进换成选中的风格；平台声明了偏好入口时那个位置是「偏好设置」）；
// - 状态行：加载中、错误（重试）、空、过滤无结果（清除过滤）——图标与文案各不相同；
// - 高频动作之外的「列表」与「⋯ 更多」（低频的集合动作，内联展开，不弹浮层）；fb10：「⋯ 更多」末尾是「折叠信息条」
//   （原来面包屑行右侧的「折叠」按钮挪进来，歌手页没有集合动作时菜单里只有它）；
//   方案 C（2026-11-13 用户选定，「让关键功能更容易直达，不要全都收在更多菜单里」）：播放 / 入队那一行下面是一排同样大小的
//   图标格——收藏星标、列表是固定格，剩下的格子按优先级从菜单里补（加入歌单、收进速记簿、改名、设置封面……，
//   bravaisSeamQuickCells），放不下的和删除、折叠才在「⋯」里。格子数按这一排的宽度量（竖条、横条、海报各自放得下几格）；
// - 缝底的结果提示（几秒后由 surface 撤掉，不走 toast）。
// 动效（设计稿 §7「缝内的过渡」）：状态行、日期换了，新的一行翻进来；「⋯ 更多」是弹出（从按钮下方长出来），结果提示淡入 / 淡出。

const TONE_ICONS: Record<BravaisSeamTone, React.ComponentType<{ 'aria-hidden'?: boolean; className?: string }>> = {
    loading: Loader2,
    error: AlertCircle,
    empty: Inbox,
    'no-match': SearchX,
};

export const BravaisSeamStatusLine: React.FC<{ status: BravaisSeamStatus }> = ({ status }) => {
    const Icon = TONE_ICONS[status.tone];
    return (
        <BravaisSeamFlipText as="div" flipKey={`${status.tone}|${status.text}`} className={`bravais-seam-status-line is-${status.tone}`}
            data-bravais-seam-status={status.tone}>
            <Icon aria-hidden className={status.tone === 'loading' ? 'animate-spin' : undefined} />
            <span>{status.text}</span>
            {status.action && (
                <button type="button" className="bravais-seam-link" data-bravais-seam-action={status.action.id} onClick={status.action.run}>
                    {status.action.label}
                </button>
            )}
        </BravaisSeamFlipText>
    );
};

/**
 * 收藏星标（订阅 / 取消订阅；subscribing 时转圈、禁用）。方案 C 起是动作格的第一格（BravaisSeamCollectionMenu），
 * 不再挤在「播放全部 / 加入队列」那一行的末尾（拆出随机播放后那一行放不下它）。
 */
export const BravaisSeamStar: React.FC<{ subscribe: BravaisSeamSubscribe }> = ({ subscribe }) => (
    <button
        type="button"
        className={`bravais-seam-star${subscribe.subscribed ? ' is-on' : ''}`}
        data-bravais-seam-action="subscribe"
        data-bravais-subscribe={subscribe.pending ? 'pending' : subscribe.subscribed ? 'on' : 'off'}
        aria-pressed={subscribe.subscribed}
        disabled={subscribe.pending}
        title={subscribe.title}
        aria-label={subscribe.title}
        onClick={subscribe.onToggle}
    >
        {subscribe.pending ? <Loader2 aria-hidden className="animate-spin" /> : <Star aria-hidden />}
    </button>
);

/**
 * 元数据行（「N 首」，过滤中是匹配数）。给了 `reload` 时计数就是「重新拉取」按钮：计数照常翻页，后面跟一个刷新图标，
 * 读首页时图标转圈、按钮禁用。完整信息条（竖 / 横）与专辑海报共用，外观的类名由各处给；按钮套在带这个类名的
 * 元素里面，所在行的排版（专辑海报事实行的基线对齐与「·」分隔）照旧落在外层。
 */
export const BravaisSeamMetaLine: React.FC<{
    meta: string;
    reload?: BravaisSeamReload;
    className: string;
    as?: 'div' | 'span';
}> = ({ meta, reload, className, as = 'div' }) => {
    if (!reload) return <BravaisSeamFlipText as={as} flipKey={meta} className={className}>{meta}</BravaisSeamFlipText>;
    const Tag = as;
    return (
        <Tag className={className}>
            <button type="button" className="bravais-seam-meta-reload" data-bravais-seam-action="reload"
                disabled={reload.disabled} title={reload.label} aria-label={meta ? `${meta} · ${reload.label}` : reload.label} onClick={reload.run}>
                {meta && <BravaisSeamFlipText flipKey={meta}>{meta}</BravaisSeamFlipText>}
                <RefreshCw aria-hidden className={reload.pending ? 'animate-spin' : undefined} />
            </button>
        </Tag>
    );
};

/** 元数据行的补页进度、每日推荐的日期步进与风格推荐。 */
export const BravaisSeamCollectionMeta: React.FC<{ collection: BravaisSeamCollectionModel }> = ({ collection }) => {
    const { sync, daily } = collection;
    return (
        <>
            {sync && (sync.onResume ? (
                <button type="button" className="bravais-seam-sync is-interrupted" data-bravais-sync="interrupted" title={sync.title} onClick={sync.onResume}>
                    <RefreshCw aria-hidden />
                    {sync.label}
                </button>
            ) : (
                <div className="bravais-seam-sync" data-bravais-sync="syncing">
                    <RefreshCw aria-hidden className="animate-spin" />
                    {sync.label}
                </div>
            ))}
            {daily?.preferences && (
                <button type="button" className="bravais-seam-daily-style" data-bravais-seam-action="daily-preferences"
                    title={daily.preferences.label} onClick={daily.preferences.onOpen}>
                    <SlidersHorizontal aria-hidden />
                    <span className="bravais-seam-daily-label">{daily.preferences.label}</span>
                </button>
            )}
            {daily?.modes && (
                <div className="bravais-seam-daily-modes" role="group" aria-label={daily.modes.ariaLabel} data-bravais-daily-modes>
                    {daily.modes.items.map(item => (
                        <button key={item.id} type="button" className={`bravais-seam-daily-mode${item.active ? ' is-active' : ''}`}
                            data-bravais-seam-action={`daily-mode-${item.id}`} aria-pressed={item.active} disabled={daily.disabled}
                            onClick={item.active ? undefined : item.run}>
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
            {daily?.style && (
                <button type="button" className="bravais-seam-daily-style" data-bravais-seam-action="daily-style" disabled={daily.disabled}
                    title={daily.style.title} aria-label={daily.style.title} onClick={daily.style.onOpen}>
                    <Tags aria-hidden />
                    <BravaisSeamFlipText flipKey={daily.style.label} className="bravais-seam-daily-label">{daily.style.label}</BravaisSeamFlipText>
                    <ChevronDown aria-hidden />
                </button>
            )}
            {daily && !daily.style && (
                <div className="bravais-seam-daily" role="group" aria-label={daily.ariaLabel} data-bravais-daily>
                    <button type="button" className="bravais-seam-icon" data-bravais-seam-action="daily-previous" disabled={daily.disabled || !daily.onPrevious}
                        onClick={daily.onPrevious} aria-label="‹">
                        <ChevronLeft aria-hidden />
                    </button>
                    <BravaisSeamFlipText flipKey={daily.label} className="bravais-seam-daily-label" data-bravais-daily-date>{daily.label}</BravaisSeamFlipText>
                    <button type="button" className="bravais-seam-icon" data-bravais-seam-action="daily-next" disabled={daily.disabled || !daily.onNext}
                        onClick={daily.onNext} aria-label="›">
                        <ChevronRight aria-hidden />
                    </button>
                    {daily.onRefresh && (
                        <button type="button" className="bravais-seam-icon" data-bravais-seam-action="daily-refresh" disabled={daily.disabled}
                            onClick={daily.onRefresh} aria-label={daily.refreshLabel} title={daily.refreshLabel}>
                            <RefreshCw aria-hidden />
                        </button>
                    )}
                </div>
            )}
        </>
    );
};

/** 「⋯ 更多」末尾的开口动作（折叠信息条）。 */
export type BravaisSeamMenuFold = { label: string; run: () => void };

/**
 * 动作格（方案 C）与「⋯ 更多」；以及缝底的结果提示。格子从左到右：收藏星标、「列表」、按优先级补上的菜单项、「⋯」。
 * `fold` 排在菜单最后，与集合动作之间一道分隔线。菜单悬浮在按钮行上方（绝对定位，不推挤缝里的其它内容，实测反馈）；
 * 点别处或 Esc 收起。`cellClassName` 是格子的样式（缝里是 bravais-seam-quick-cell，海报上再加海报的按钮样式）。
 */
export const BravaisSeamCollectionMenu: React.FC<{
    collection?: BravaisSeamCollectionModel;
    onOpenList?: () => void;
    fold?: BravaisSeamMenuFold;
    cellClassName?: string;
}> = ({ collection, onOpenList, fold, cellClassName = 'bravais-seam-quick-cell' }) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const reduced = useBravaisReducedTransitions();
    const anchorRef = useRef<HTMLDivElement>(null);
    const stripRef = useRef<HTMLDivElement>(null);
    const slots = useBravaisSeamQuickSlots(stripRef);
    // 横的信息条在视口上半时菜单往下弹（按钮行一直挂着，anchorRef 在打开菜单的那次渲染里已经有值）。
    const pop = bravaisPopMotion(seamPopAnchorFor(anchorRef.current), reduced);
    const reveal = bravaisRevealMotion(reduced);
    const subscribe = collection?.subscribe;
    const listLabel = collection?.listLabel && onOpenList ? collection.listLabel : null;
    const plan = planQuickCells(collection?.menu ?? [], slots, (subscribe ? 1 : 0) + (listLabel ? 1 : 0), Boolean(fold));
    const items = plan.rest;
    const hasMenu = plan.more;
    const moreLabel = collection?.moreLabel ?? t('libraryBravaisCollection.more');
    const menuOpen = isOpen && hasMenu;

    // 菜单开着时点别处收起（缝里、墙上都算）。
    useEffect(() => {
        if (!menuOpen) return undefined;
        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && anchorRef.current?.contains(event.target)) return;
            setIsOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [menuOpen]);

    // 菜单开着时 Esc 先收起它（preventDefault 让墙的 Esc 阶梯跳过这次按键）。
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || !menuOpen) return;
        event.preventDefault();
        setIsOpen(false);
    };

    return (
        <>
            <div ref={anchorRef} className="bravais-seam-more-anchor" onKeyDown={onKeyDown}>
            <div ref={stripRef} className="bravais-seam-actions is-quick" data-bravais-seam-quick={slots ?? undefined}>
                {subscribe && <BravaisSeamStar subscribe={subscribe} />}
                {listLabel && (
                    <button type="button" className={cellClassName} data-bravais-seam-action="list" onClick={onOpenList}
                        aria-label={listLabel} title={listLabel}>
                        <List aria-hidden />
                    </button>
                )}
                {plan.promoted.map(item => {
                    const Icon = item.busy ? quickBusyIcon(item.icon ?? MoreHorizontal) : item.icon ?? MoreHorizontal;
                    return (
                        <button key={item.id} type="button" className={`${cellClassName}${item.danger ? ' is-danger' : ''}`} data-bravais-seam-action={item.id}
                            data-bravais-seam-quick-item disabled={item.disabled} aria-label={item.label} title={item.label} onClick={() => {
                                setIsOpen(false);
                                item.run();
                            }}>
                            <Icon aria-hidden className={item.busy ? 'animate-spin' : undefined} />
                        </button>
                    );
                })}
                {hasMenu && (
                    <button type="button" className={`${cellClassName}${menuOpen ? ' is-pressed' : ''}`} data-bravais-seam-action="more"
                        aria-haspopup="menu" aria-expanded={menuOpen} aria-label={moreLabel} title={moreLabel}
                        onClick={() => setIsOpen(open => !open)}>
                        <MoreHorizontal aria-hidden />
                    </button>
                )}
            </div>
            <AnimatePresence>
                {menuOpen && (
                    <motion.div key="menu" className="bravais-seam-menu" role="menu" data-bravais-seam-menu {...pop}>
                        {items.map(item => (
                            <button
                                key={item.id}
                                type="button"
                                role="menuitem"
                                className={item.danger ? 'is-danger' : undefined}
                                disabled={item.disabled}
                                data-bravais-seam-action={item.id}
                                onClick={() => {
                                    setIsOpen(false);
                                    item.run();
                                }}
                            >
                                {item.label}
                            </button>
                        ))}
                        {fold && items.length > 0 && <div className="bravais-seam-menu-rule" role="separator" />}
                        {fold && (
                            <button
                                type="button"
                                role="menuitem"
                                data-bravais-seam-action="hide"
                                onClick={() => {
                                    setIsOpen(false);
                                    fold.run();
                                }}
                            >
                                {fold.label}
                            </button>
                        )}
                    </motion.div>
                )}
            </AnimatePresence>
            </div>
            <AnimatePresence initial={false}>
                {collection?.notice && (
                    <motion.div key="notice" className={`bravais-seam-notice is-${collection.notice.tone}`} role="status"
                        data-bravais-seam-notice={collection.notice.tone} {...reveal}>
                        {collection.notice.text}
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
};
