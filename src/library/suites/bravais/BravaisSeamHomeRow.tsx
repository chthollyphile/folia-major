import React, { useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, FoldHorizontal, ListFilter, Maximize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer, BravaisSeamTab } from './bravaisLayer';
import type { BravaisHomeShortcut } from './bravaisHomeModels';
import type { BravaisSeamLevel } from './bravaisSeamLevel';
import BravaisSeamHomeTools from './BravaisSeamHomeTools';
import BravaisSeamAccountSwitcher from './BravaisSeamAccountSwitcher';
import { BravaisSeamAccountSlot, HomeSeamSections, HomeSeamShortcuts } from './BravaisSeamHome';
import { BravaisSeamFlipText, useBravaisSeamFade } from './BravaisSeamFlip';
import { useBravaisReducedTransitions } from './bravaisMotion';
import { bravaisRevealMotion } from './bravaisSeamMotion';
import { abbreviateSeamTabLabels } from './bravaisSeamTabLabels';
import BravaisSeamFilterField from './BravaisSeamFilterField';
import { useBravaisUiStore } from './bravaisUiStore';
import { openBravaisFilter } from './useBravaisSeamFilter';
import { useBravaisSeamRowFit } from './useBravaisSeamRowFit';
import './bravaisHome.css';
import './bravaisSeamRow.css';

// src/library/suites/bravais/BravaisSeamHomeRow.tsx
// 信息条横向时的首页窄缝 / 首页书脊（横条，见 bravaisSeamRow.css）：一行从左到右是折叠、导航段（「书库」、横排的一级页签、
// 扫描进度、二级切换、直达入口、管理隐藏、状态）、过滤输入位（正在输入或有过滤词时）、账户入口、工具格。书脊（compact）
// 的导航段只有页签，末尾多一个展开。
// 放不下时与竖的窄缝同一套退让（useBravaisSeamRowFit 按宽度量）：先藏「书库」（读屏仍读得到）→ 直达入口挪进「⋯」→
// 账户入口只留头像 → 页签与激活的二级切换缩成一个字（bravaisSeamTabLabels，全名在 title / aria-label）→ 还放不下，
// 导航段在里面横向滚（右边淡出提示）。
// 控件、文案、data 属性与竖的窄缝（BravaisSeamHome）相同。

/** 一级页签：真按钮，或测量副本（span，不可聚焦、不进无障碍树）。 */
const RowTabs: React.FC<{
    tabs: readonly BravaisSeamTab[];
    label: string;
    shorts: readonly string[] | null;
    onSelect?: (key: string) => void;
    measure?: boolean;
}> = ({ tabs, label, shorts, onSelect, measure = false }) => {
    if (tabs.length === 0) return null;
    const className = `bravais-seam-tabs${shorts ? ' is-short' : ''}`;
    if (measure) {
        return (
            <div className={className}>
                {tabs.map((tab, index) => <span key={tab.key} className="bravais-seam-home-tab">{shorts ? shorts[index] : tab.label}</span>)}
            </div>
        );
    }
    return (
        <div className={className} role="tablist" aria-label={label} aria-orientation="horizontal">
            {tabs.map((tab, index) => (
                <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={tab.active}
                    aria-label={shorts ? tab.label : undefined}
                    title={tab.label}
                    disabled={tab.disabled}
                    data-bravais-tab={tab.key}
                    data-bravais-tab-short={shorts ? 'true' : undefined}
                    className={`bravais-seam-home-tab${tab.active ? ' is-active' : ''}`}
                    onClick={() => onSelect?.(tab.key)}
                >
                    {shorts ? shorts[index] : tab.label}
                </button>
            ))}
        </div>
    );
};

const BravaisSeamHomeRow: React.FC<{
    layer: BravaisLayer;
    compact: boolean;
    setLevel: (level: BravaisSeamLevel) => void;
    openShortcut?: (shortcut: BravaisHomeShortcut) => void;
}> = ({ layer, compact, setLevel, openShortcut }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const home = seam.home;
    const tabs = seam.tabs ?? [];
    // 书脊不画中段（二级切换、直达入口等），只排页签。
    const sections = !compact && home?.sections && home.sections.length > 0 ? home.sections : null;
    const shortcuts = home?.shortcuts && home.shortcuts.length > 0 ? home.shortcuts : null;
    const rowShortcuts = compact ? null : shortcuts;
    const reveal = bravaisRevealMotion(useBravaisReducedTransitions());
    const filterEditing = useBravaisUiStore(state => state.filterEditing);
    const labelsKey = tabs.map(tab => tab.label).join('\u0000');
    const shortLabels = useMemo(() => abbreviateSeamTabLabels(labelsKey.split('\u0000')), [labelsKey]);

    const rowRef = useRef<HTMLDivElement>(null);
    const navRef = useRef<HTMLDivElement>(null);
    const accountRef = useRef<HTMLDivElement>(null);
    const measureRef = useRef<HTMLDivElement>(null);
    const fit = useBravaisSeamRowFit({ rowRef, navRef, accountRef, measureRef });
    const short = fit.level === 'short';
    const titled = !compact && fit.level === 'titled';
    const shortcutsInRow = rowShortcuts !== null && fit.shortcuts;
    // 缩减级别变了：导航段淡入新的样子，不硬切。
    useBravaisSeamFade(`${fit.level}|${fit.shortcuts}|${fit.accountCompact}`, navRef);
    const expand = () => setLevel('full');

    /** 导航段里随级别变的那几块（测量副本用；真的那份在下面按 fit 画）。 */
    const measureNav = (name: string, { title, jumps, abbreviated }: { title: boolean; jumps: boolean; abbreviated: boolean }) => (
        <div className="bravais-seam-home-row-nav" data-bravais-row-measure={name}>
            {title && !compact && <div className="bravais-seam-home-title">{seam.title}</div>}
            <RowTabs tabs={tabs} label={seam.title} shorts={abbreviated ? shortLabels : null} measure />
            {sections && (
                <div className="bravais-seam-sections-slot">
                    <HomeSeamSections sections={sections} short={abbreviated} measure />
                </div>
            )}
            {jumps && rowShortcuts && (
                <div className="bravais-seam-home-jumps">
                    <HomeSeamShortcuts shortcuts={rowShortcuts} rule={Boolean(sections)} measure />
                </div>
            )}
        </div>
    );

    return (
        <div ref={rowRef} className={`bravais-seam-home-row${compact ? ' is-compact' : ''}${short ? ' has-short-tabs' : ''}`} data-bravais-home-seam
            data-bravais-home-fit={fit.level} data-bravais-home-shortcuts={rowShortcuts ? (shortcutsInRow ? 'column' : 'menu') : undefined}>
            <button type="button" className="bravais-seam-icon" data-bravais-seam-action="hide" onClick={() => setLevel('hidden')}
                aria-label={t('libraryBravais.seamFold')} title={t('libraryBravais.seamFold')}>
                <FoldHorizontal aria-hidden />
            </button>
            <div ref={navRef} className={`bravais-seam-home-row-nav${fit.overflowing ? ' is-overflowing' : ''}`}>
                {/* 「书库」放不下时视觉隐藏（读屏仍读得到，页签列的 aria-label 也是它）。 */}
                {!compact && (
                    <div className={`bravais-seam-home-title${titled ? '' : ' is-hidden'}`} data-bravais-home-title={titled ? 'shown' : 'hidden'}>
                        {seam.title}
                    </div>
                )}
                <RowTabs tabs={tabs} label={seam.title} shorts={short ? shortLabels : null} onSelect={seam.onSelectTab} />
                {!compact && (
                    <div className="bravais-seam-home-row-body" data-bravais-home-body>
                        <AnimatePresence initial={false}>
                            {home?.scan && <motion.div key="scan" className="bravais-seam-scan" data-bravais-scan data-bravais-row-extra {...reveal}>{home.scan}</motion.div>}
                        </AnimatePresence>
                        {sections && (
                            <div className="bravais-seam-sections-slot">
                                <HomeSeamSections sections={sections} label={seam.meta} short={short} onSelect={home?.onSelectSection} orientation="horizontal" />
                            </div>
                        )}
                        {shortcutsInRow && (
                            <div className="bravais-seam-home-jumps" data-bravais-home-jumps>
                                <HomeSeamShortcuts shortcuts={rowShortcuts} label={home?.shortcutsLabel} rule={Boolean(sections)} onOpen={openShortcut} />
                            </div>
                        )}
                        <AnimatePresence initial={false}>
                            {home?.manage && (
                                <motion.div key="manage" className="bravais-seam-manage" data-bravais-manage={home.manage.mode} data-bravais-row-extra {...reveal}>
                                    <span>{home.manage.title}</span>
                                    <button type="button" aria-pressed={home.manage.mode === 'manage-hidden-only'} data-bravais-seam-action="hidden-only"
                                        className={home.manage.mode === 'manage-hidden-only' ? 'is-active' : undefined} onClick={home.manage.onToggleHiddenOnly}>
                                        {home.manage.mode === 'manage-hidden-only' && <Check aria-hidden />}{home.manage.hiddenOnlyLabel}
                                    </button>
                                    <button type="button" data-bravais-seam-action="manage-done" onClick={home.manage.onDone}>{home.manage.doneLabel}</button>
                                </motion.div>
                            )}
                        </AnimatePresence>
                        {seam.status && (
                            <BravaisSeamFlipText as="div" flipKey={seam.status} className="bravais-seam-row-status" data-bravais-seam-status data-bravais-row-extra>
                                {seam.status}
                            </BravaisSeamFlipText>
                        )}
                    </div>
                )}
            </div>
            <AnimatePresence initial={false}>
                {seam.filter && !compact && (filterEditing || seam.filter.query) && (
                    <motion.div key="filter" className="bravais-seam-home-filter" {...reveal}>
                        <BravaisSeamFilterField filter={seam.filter} variant="home" />
                    </motion.div>
                )}
            </AnimatePresence>
            {seam.filter?.query && compact && (
                <button type="button" className="bravais-seam-icon is-filtering" data-bravais-seam-action="filter" onClick={openBravaisFilter}
                    aria-label={seam.filter.placeholder} title={`${seam.filter.placeholder} · ${seam.filter.query}`}>
                    <ListFilter aria-hidden />
                </button>
            )}
            {home?.account && (
                <div ref={accountRef} className="bravais-seam-row-account">
                    <BravaisSeamAccountSlot account={home.account} compact={compact || fit.accountCompact} />
                </div>
            )}
            {home && (
                <BravaisSeamHomeTools home={home} compact={compact} onExpand={expand}
                    menuShortcuts={rowShortcuts && !shortcutsInRow ? rowShortcuts : null} onOpenShortcut={openShortcut} />
            )}
            {compact && (
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="expand" onClick={expand}
                    aria-label={t('libraryBravais.seamExpand')} title={t('libraryBravais.seamExpand')}>
                    <Maximize2 aria-hidden />
                </button>
            )}
            {/* 各级导航段与两种账户入口的测量副本：绝对定位、看不见、不占位（useBravaisSeamRowFit 量它们）。 */}
            <div ref={measureRef} className="bravais-seam-home-row-measure" aria-hidden inert>
                {measureNav('titled', { title: true, jumps: true, abbreviated: false })}
                {measureNav('untitled', { title: false, jumps: true, abbreviated: false })}
                {measureNav('no-shortcuts', { title: false, jumps: false, abbreviated: false })}
                {measureNav('short', { title: false, jumps: false, abbreviated: true })}
                {home?.account && (
                    <>
                        <div data-bravais-row-measure="account-full"><BravaisSeamAccountSwitcher account={home.account} compact={compact} measure /></div>
                        <div data-bravais-row-measure="account-compact"><BravaisSeamAccountSwitcher account={home.account} compact measure /></div>
                    </>
                )}
            </div>
        </div>
    );
};

export default BravaisSeamHomeRow;
