import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';
import ScratchpadBand, { ScratchpadSlim } from './ScratchpadBand';
import ScratchpadGreeting from './ScratchpadGreeting';
import { useScratchpadHistory } from './useScratchpadHistory';
import { SCRATCHPAD_TABS } from './scratchpadLook';
import { PAPER_FACE_VARIANTS, panelPaperFrame, usePaperMotions, useViewSize } from './scratchpadPaper';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';

// src/components/app/scratchpad/ScratchpadPanel.tsx
// 左缘的面板（设计稿 A 按 F 定稿适配；盖在墙上，不推开墙）：三页各一条米白的纸——这一页是顶上的信息条（ScratchpadBand），
// 另外两页是压在底部的两条细纸带（ScratchpadSlim），点一下换过去；与展开整页一一对应（scratchpadPaper.ts 的文件头）。
// 原来左边一列竖排页签，用户嫌占地方（2026-11-07），换成这样，展开 / 收起时三条纸各自从原位长过去、缩回来。
// 换页时三条纸照展开整页的走法挪：底部那条升到顶上、长高；顶上那条从上方出去，再从下面升回到底部。
// 信息条下面是放大的问候和一道点缀色的短杠，再下面是这一页（宿主交进来的 children：说明、列表、底部按钮）。
// 信息条左端是收起（返回箭头，用户定），右端探出面板的那一截上是「展开整页」。分区靠深浅不同的黑，不画描边与分割线。
// 展开整页时不用它，换成 ScratchpadSheet（倾斜的纸）。

const TAB_TITLE_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.title', history: 'scratchpad.history', queue: 'scratchpad.queue' };

type PaperMode = 'band' | 'slim';

type ScratchpadPanelProps = {
    tab: ScratchpadTab;
    notesCount: number;
    queueCount: number;
    /** 底部两条细纸带的上下次序（与展开整页共用，useSlimOrder）。 */
    slimOrder: readonly ScratchpadTab[];
    onSelectTab: (tab: ScratchpadTab) => void;
    onClose: () => void;
    expandLabel: string;
    expandDisabled: boolean;
    onExpand: () => void;
    expandRef: React.Ref<HTMLButtonElement>;
    children: React.ReactNode;
};

const ScratchpadPanel: React.FC<ScratchpadPanelProps> = ({
    tab, notesCount, queueCount, slimOrder, onSelectTab, onClose, expandLabel, expandDisabled, onExpand, expandRef, children,
}) => {
    const { t } = useTranslation();
    const calm = useReducedMotionFor('uiMicroMotion');
    // 纸上写播放历史有几首：只在面板开着时读（面板关着不挂这个组件）。
    const historyCount = useScratchpadHistory().length;
    const counts: Record<ScratchpadTab, number> = { notes: notesCount, history: historyCount, queue: queueCount };
    const view = useViewSize();
    const motionOf = usePaperMotions<PaperMode>('slim');
    const indexOf = (id: ScratchpadTab) => String(SCRATCHPAD_TABS.indexOf(id) + 1).padStart(2, '0');

    return (
        <>
            {SCRATCHPAD_TABS.map(id => {
                const mode: PaperMode = id === tab ? 'band' : 'slim';
                const frame = panelPaperFrame(mode === 'band' ? 'band' : slimOrder.indexOf(id), view.width, view.height);
                // 绕一圈去底部时从窗口上方出去、从窗口下面回来。
                const paperMotion = motionOf(id, mode, frame, { calm, above: -24, below: view.height + 24 });
                const title = t(TAB_TITLE_KEYS[id]);
                const countLabel = t('scratchpad.count', { count: counts[id] });
                return (
                    <motion.div
                        key={id}
                        className={`scratchpad-panel-paper is-${mode}`}
                        data-page={id}
                        initial={false}
                        animate={paperMotion.animate}
                        transition={paperMotion.transition}
                    >
                        <div className="scratchpad-panel-paper-sheet">
                            {/* 退场的那一面拿的是 AnimatePresence 的 custom（这一次的动法）：绕一圈时它要留到出了视口才换。 */}
                            <AnimatePresence initial={false} custom={paperMotion}>
                                <motion.div
                                    key={mode}
                                    className="scratchpad-sheet-band-face"
                                    custom={paperMotion}
                                    variants={PAPER_FACE_VARIANTS}
                                    initial="hidden"
                                    animate="shown"
                                    exit="gone"
                                >
                                    {mode === 'band' ? (
                                        <ScratchpadBand tab={id} index={indexOf(id)} title={title} count={counts[id]} />
                                    ) : (
                                        <ScratchpadSlim
                                            tab={id}
                                            index={indexOf(id)}
                                            title={title}
                                            countLabel={countLabel}
                                            openLabel={t('scratchpad.expandPage')}
                                            ariaLabel={`${title} · ${countLabel}`}
                                            onOpen={onSelectTab}
                                        />
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </motion.div>
                );
            })}
            <div className="scratchpad-sheet">
                {/* 顶上那条信息条的位子（纸本身在上面那一层里挪）：左端收起，右端探出面板的那一截上是「展开整页」（用户定，2026-11-06）。
                    两颗都不放进纸里：换页时纸在挪，按钮要是跟着走，收回整页时焦点要落回的那一颗会被换掉。 */}
                <div className="scratchpad-panel-band">
                    <button type="button" className="scratchpad-band-fold" title={t('scratchpad.close')} aria-label={t('scratchpad.close')} onClick={onClose}>
                        <ChevronLeft aria-hidden="true" />
                    </button>
                    <button
                        ref={expandRef}
                        type="button"
                        className="scratchpad-band-expand"
                        data-scratchpad-action="toggle-canvas"
                        disabled={expandDisabled}
                        title={expandLabel}
                        aria-label={expandLabel}
                        aria-pressed={false}
                        onClick={onExpand}
                    >
                        <Maximize2 aria-hidden="true" />
                    </button>
                </div>
                {/* 按时段的问候放大（短版，用户定 2026-11-06：长版留给展开整页），下面一道短杠；这一页的说明在 children 的最上面（随页换）。 */}
                <div className="scratchpad-intro">
                    <ScratchpadGreeting long={false} headline />
                    <span className="scratchpad-intro-rule" aria-hidden="true" />
                </div>
                {children}
            </div>
        </>
    );
};

export default ScratchpadPanel;
