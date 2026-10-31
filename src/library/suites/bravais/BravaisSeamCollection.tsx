import React, { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ChevronLeft, ChevronRight, Inbox, List, Loader2, MoreHorizontal, RefreshCw, SearchX, Star } from 'lucide-react';
import type {
    BravaisSeamCollection as BravaisSeamCollectionModel,
    BravaisSeamStatus,
    BravaisSeamSubscribe,
    BravaisSeamTone,
} from './bravaisSeamModels';
import { BravaisSeamFlipText } from './BravaisSeamFlip';
import { useBravaisReducedTransitions } from './bravaisMotion';
import { bravaisPopMotion, bravaisRevealMotion, seamPopAnchorFor } from './bravaisSeamMotion';
import './bravaisCollection.css';
import { useGlass } from '@/shinoinject/useGlass';

// src/library/suites/bravais/BravaisSeamCollection.tsx
// 完整信息条里集合层的那几块（设计稿 §10.1 放置原则、§10.2、§10.6）：
// （过滤输入位每面墙都有，在 BravaisSeamFilterField。）
// - 收藏星标（subscribing 时转圈；fb10 起在按钮行末尾）；元数据行的补页进度（中断时整行是「续传」）；每日推荐的日期步进；
// - 状态行：加载中、错误（重试）、空、过滤无结果（清除过滤）——图标与文案各不相同；
// - 高频动作之外的「列表」与「⋯ 更多」（低频的集合动作，内联展开，不弹浮层）；fb10：「⋯ 更多」末尾是「折叠信息条」
//   （原来面包屑行右侧的「折叠」按钮挪进来，歌手页没有集合动作时菜单里只有它）；
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
 * 收藏星标（订阅 / 取消订阅；subscribing 时转圈、禁用）。fb10：不再在描述下面单独占一行，挪到「播放全部 / 加入队列」
 * 那一行的末尾（BravaisSeamContent），是那一排动作里的一个图标按钮。
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

/** 元数据行的补页进度、每日推荐的日期步进。 */
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
            {daily && (
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

/** 「列表」与「⋯ 更多」；以及缝底的结果提示。`fold` 排在菜单最后，与集合动作之间一道分隔线。
 *  菜单悬浮在按钮行上方（绝对定位，不推挤缝里的其它内容，实测反馈）；点别处或 Esc 收起。 */
export const BravaisSeamCollectionMenu: React.FC<{
    collection?: BravaisSeamCollectionModel;
    onOpenList?: () => void;
    fold?: BravaisSeamMenuFold;
}> = ({ collection, onOpenList, fold }) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const reduced = useBravaisReducedTransitions();
    const anchorRef = useRef<HTMLDivElement>(null);
    // 横的信息条在视口上半时菜单往下弹（按钮行一直挂着，anchorRef 在打开菜单的那次渲染里已经有值）。
    const pop = bravaisPopMotion(seamPopAnchorFor(anchorRef.current), reduced);
    const reveal = bravaisRevealMotion(reduced);
    const items = collection?.menu ?? [];
    const hasMenu = items.length > 0 || Boolean(fold);

    // 菜单开着时点别处收起（缝里、墙上都算）。
    useEffect(() => {
        if (!isOpen) return undefined;
        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && anchorRef.current?.contains(event.target)) return;
            setIsOpen(false);
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [isOpen]);

    // 菜单开着时 Esc 先收起它（preventDefault 让墙的 Esc 阶梯跳过这次按键）。
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || !isOpen) return;
        event.preventDefault();
        setIsOpen(false);
    };
    useGlass();
    return (
        <>
            <div ref={anchorRef} className="bravais-seam-more-anchor" onKeyDown={onKeyDown}>
            <div className="bravais-seam-actions">
                {collection?.listLabel && onOpenList && (
                    <button type="button" className="bravais-chrome-button" data-bravais-seam-action="list" onClick={onOpenList}>
                        <List aria-hidden />{collection.listLabel}
                    </button>
                )}
                {hasMenu && (
                    <button type="button" className="bravais-chrome-button" data-bravais-seam-action="more" aria-expanded={isOpen}
                        onClick={() => setIsOpen(open => !open)}>
                        <MoreHorizontal aria-hidden />{collection?.moreLabel ?? t('libraryBravaisCollection.more')}
                    </button>
                )}
            </div>
            <AnimatePresence>
                {isOpen && (
                    <motion.div key="menu" data-glass className="bravais-seam-menu" role="menu" data-bravais-seam-menu {...pop}>
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
