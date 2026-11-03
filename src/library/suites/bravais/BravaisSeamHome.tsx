import React, { useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    CalendarPlus,
    Check,
    DiscAlbum,
    Folder,
    FoldHorizontal,
    History,
    LayoutGrid,
    ListFilter,
    Library,
    Maximize2,
    MicVocal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BravaisLayer, BravaisSeamTab } from './bravaisLayer';
import type { BravaisHomeAccount, BravaisHomeSection, BravaisHomeShortcut } from './bravaisHomeModels';
import type { BravaisSeamLevel } from './bravaisSeamLevel';
import BravaisSeamAccountSwitcher from './BravaisSeamAccountSwitcher';
import BravaisSeamHomeTools from './BravaisSeamHomeTools';
import { abbreviateSeamTabLabel, abbreviateSeamTabLabels } from './bravaisSeamTabLabels';
import { useBravaisSeamTabsFit } from './useBravaisSeamTabsFit';
import { BravaisSeamFlipText, useBravaisSeamFade } from './BravaisSeamFlip';
import { useBravaisReducedTransitions } from './bravaisMotion';
import { bravaisRevealMotion, BRAVAIS_SEAM_FLIP_IN_EASING_BEZIER } from './bravaisSeamMotion';
import { BRAVAIS_SEAM_FLIP_IN_MS } from './bravaisConstants';
import BravaisSeamFilterField from './BravaisSeamFilterField';
import { useBravaisUiStore } from './bravaisUiStore';
import { openBravaisFilter } from './useBravaisSeamFilter';
import './bravaisHome.css';

// src/library/suites/bravais/BravaisSeamHome.tsx
// 首页窄缝 / 首页书脊（设计稿 §5「开合」、§10.5）：折叠、竖排「书库」、页签（五个一级页签，竖排并列成一排书脊）、
// 二级切换（本地四行、Navidrome 的 section——切换整面翻牌，不换层）、管理隐藏视图的开关、扫描进度、给 B10 留的账户位，
// 底部一格格的工具按钮（搜索、目录、管理隐藏、Navidrome 刷新、队列 / 播放页 / 舞台 / 设置）与本地「⋯」。
// 文案都来自层描述（已翻译），回调都是 surface 给的；这里只排版。
// fb2 重排（用户实测：120px 里太挤、底部图标挤成一团）：
// - 从上到下：导航区（页头 + 二级切换 + 管理隐藏，唯一可伸缩的一段，放不下时可滚）→ 扫描进度 → 账户位 → 状态
//   → 工具格（BravaisSeamHomeTools：常驻图标两列，次要的收进「⋯」）。各段是自然高度、互不重叠，
//   整体在播放条安全区之上（缝内容的底部内边距）。
// - 页头：页签竖排（writing-mode: vertical-rl，与缝里竖排标题同一套排版语言），一列一个页签。最上面一行是「书库」
//   小字；折叠按钮单独一行，在标题之下、页签列之上（窄缝与书脊一样）。
// - 纵向放不下全名时页签缩成一个字（bravaisSeamTabLabels），按测量决定（useBravaisSeamTabsFit），全名留在
//   title / aria-label。
// - fb2 第二轮：「书库」是页头最上面一行小字，折叠按钮紧挨在它下面。缩减顺序：先视觉隐藏这行标题（读屏仍读得到，
//   页签列的 aria-label 也是它）→ 再把页签缩成一个字 → 再不够导航区在里面滚。三级都按测量（useBravaisSeamTabsFit）。
// fb3（用户实测）：
// - 导航区分上下两段：页头（标题、折叠、页签）贴顶；中段（扫描进度、二级切换、管理隐藏、状态、在线页签的账户入口）
//   在页头与工具格之间的剩余空间里竖直居中，不贴着页签。放不下时中段回到自然高度、与页头一起在导航区里滚。
// - 二级切换（本地的文件夹 / 专辑 / 艺术家 / 歌单，Navidrome 的 section）纵向一项一行，只有激活项显示竖排文字
//   （图标在上、文字竖写），其余只显示图标（aria-label / title 是全名）。激活项的文字与页签同级退让：short 时缩成
//   一个字。选中态与页签区分：页签是填色的块，二级切换是强调色 + 侧边一道细线。
// - 工具格固定四格（搜索、设置、队列、「⋯」），其余进「⋯」；书脊上「⋯」先展开缝再开菜单（BravaisSeamHomeTools）。
// - 未登录时账户位只是一个「连接在线平台」入口（BravaisSeamAccountSwitcher）；「先搜几首喜欢的歌」那行不再显示。
// fb4（用户实测）：账户入口（已登录的切换按钮、未登录的「连接在线平台」、书脊上的图标）不在中段了，挪到导航区与
// 工具格之间、贴着工具格（自然高度，导航区照旧是唯一可伸缩的一段）。平台列表从入口往上弹出、绝对定位盖在导航区上，
// 不推挤页签，所以页签的缩减级别与列表开合无关。中段只剩扫描进度、二级切换、管理隐藏、状态，仍按 fb3 竖直居中。
// 当前页过滤（设计稿 §7.6）：过滤输入位（BravaisSeamFilterField）只在正在输入或有过滤词时出现，排在导航区与账户入口
// 之间（自然高度，导航区照旧是唯一可伸缩的一段，页签的缩减按剩下的高度重新量）；平时不占窄缝的纵向空间，入口是墙上
// 直接打字与「⋯」里的「过滤当前页」。书脊（64px）放不下输入框：过滤中只有一个强调色的过滤图标，点它或打字先展开成窄缝。
// 动效（设计稿 §7「缝内的过渡」）：换页签时整条缝像磁贴一样翻成新页签（useBravaisSeam，2026-10-09 起与原型一致；之前
// 页签列不动、只翻中段，在线页签的中段常常是空的，看上去是硬切）；换二级切换时各行滑到新位置、新的文字翻进来；缩减
// 级别变了页头淡入新的样子；扫描进度、管理隐藏的开关淡入 / 淡出；状态文字换了翻进新的一行。降低动效时都只淡入淡出。
// 直达入口（特殊集合：我喜欢的音乐、私人 FM、全部歌曲…）：二级切换是「换这面墙看什么」（tab，选中态），入口是「打开那张
// 集合」（普通按钮），所以分开成两组、中间一道线。点它交给 stage 的 openShortcut（与点墙上那张卡同一条打开路径）。放不下时
// 入口先于二级切换让位，挪进「⋯」菜单（useBravaisSeamTabsFit）。
// fb11（用户实测：只有图标和窄缝其它部分不统一；入口孤零零浮在中间）：
// - 入口改成文字：竖排（与页签、激活的二级切换同一套 vertical-rl），各入口并排成几列竖行（一页签最多两个，并排只占
//   最长那个的高度），显示种类的固定短名（libraryBravaisHome.special.*；provider 给的卡名可能带昵称、长短不一），全名仍在
//   aria-label / title。字号小一级、字重常规、颜色是副文色——与强调色 + 粗体的激活二级切换分得开，不像又一组页签。
// - 位置靠下：入口是中段的第二块（.bravais-seam-home-jumps），贴在中段底部（离账户入口 / 工具格一个段间距）；二级切换、
//   扫描进度、状态仍在上面剩下的空间里竖直居中。

/**
 * B10 账户位：首页在线页签窄缝里的平台切换（account-select / account-logout）放在这里。B9 只给一个空容器，挂着
 * `data-bravais-account-slot=<providerId>`；里面是账户入口，点了打开共用的登录窗口。
 * 容器里是 BravaisSeamAccountSwitcher（书脊上是一个图标按钮）。
 * fb4：容器是首页窄缝的直接子级，排在工具格正上方。
 */
export const BravaisSeamAccountSlot: React.FC<{ account: BravaisHomeAccount; compact: boolean }> = ({ account, compact }) => (
    <div className="bravais-seam-account" data-bravais-account-slot={account.providerId} aria-label={account.providerLabel}>
        <BravaisSeamAccountSwitcher account={account} compact={compact} />
    </div>
);

/** 二级切换的图标（本地四行与 Navidrome 的 section 按 key 取；未知的 key 用 LayoutGrid）。 */
const SECTION_ICONS: Record<string, React.ComponentType<{ 'aria-hidden'?: boolean }>> = {
    folders: Folder,
    albums: DiscAlbum,
    artists: MicVocal,
    playlists: Library,
    'recently-added': CalendarPlus,
    'recently-played': History,
};

const SectionIcon: React.FC<{ section: BravaisHomeSection }> = ({ section }) => {
    const Icon = SECTION_ICONS[section.key] ?? LayoutGrid;
    return <Icon aria-hidden />;
};

/**
 * 二级切换（fb3）：纵向一项一行，激活项是图标 + 竖排文字（short 时文字缩成一个字），其余只有图标；全名在
 * aria-label / title。`measure` 是全名测量副本（span，不可聚焦、不进无障碍树）。
 */
export const HomeSeamSections: React.FC<{
    sections: readonly BravaisHomeSection[];
    label?: string;
    short: boolean;
    onSelect?: (key: string) => void;
    measure?: boolean;
    /** 横的缝（BravaisSeamHomeRow）里排成一行。 */
    orientation?: 'vertical' | 'horizontal';
}> = ({ sections, label, short, onSelect, measure = false, orientation = 'vertical' }) => {
    const reduced = useBravaisReducedTransitions();
    const activeKey = sections.find(section => section.active)?.key ?? '';
    const labelText = (section: BravaisHomeSection) => (short ? abbreviateSeamTabLabel(section.label) : section.label);
    const body = (section: BravaisHomeSection) => (
        <>
            <SectionIcon section={section} />
            {section.active && <span className="is-label" aria-hidden>{labelText(section)}</span>}
        </>
    );
    if (measure) {
        return (
            <div className="bravais-seam-sections">
                {sections.map(section => <span key={section.key} className={`bravais-seam-section${section.active ? ' is-active' : ''}`}>{body(section)}</span>)}
            </div>
        );
    }
    return (
        <div className={`bravais-seam-sections${short ? ' is-short' : ''}`} role="tablist" aria-label={label} aria-orientation={orientation}>
            {sections.map(section => (
                // 换激活项：文字从旧的一行挪到新的一行，各行滑到新位置（只在激活项变了时量，layoutDependency），新的文字像
                // 翻牌一样转进来；降低动效时不滑、文字淡入。
                <motion.button
                    key={section.key}
                    layout={reduced ? false : 'position'}
                    layoutDependency={activeKey}
                    transition={{ duration: BRAVAIS_SEAM_FLIP_IN_MS / 1000, ease: BRAVAIS_SEAM_FLIP_IN_EASING_BEZIER }}
                    type="button"
                    role="tab"
                    aria-selected={section.active}
                    aria-label={section.label}
                    title={section.label}
                    data-bravais-section={section.key}
                    className={`bravais-seam-section${section.active ? ' is-active' : ''}`}
                    onClick={() => onSelect?.(section.key)}
                >
                    <SectionIcon section={section} />
                    <AnimatePresence initial={false}>
                        {section.active && (
                            <motion.span
                                key="label"
                                className="is-label"
                                aria-hidden
                                initial={reduced ? { opacity: 0 } : { rotateY: -90, transformPerspective: 1400 }}
                                animate={{ rotateY: 0, opacity: 1 }}
                                transition={{ duration: (reduced ? BRAVAIS_SEAM_FLIP_IN_MS / 2 : BRAVAIS_SEAM_FLIP_IN_MS) / 1000, ease: BRAVAIS_SEAM_FLIP_IN_EASING_BEZIER }}
                            >
                                {labelText(section)}
                            </motion.span>
                        )}
                    </AnimatePresence>
                </motion.button>
            ))}
        </div>
    );
};

/**
 * 直达入口（特殊集合，fb11）：并排的几列竖排文字按钮，显示种类的短名（`names`），全名在 aria-label / title；`rule` 时上面
 * 一道分隔线（与二级切换隔开）。`measure` 是测量副本（span，不可聚焦、不进无障碍树）。
 */
export const HomeSeamShortcuts: React.FC<{
    shortcuts: readonly BravaisHomeShortcut[];
    label?: string;
    rule: boolean;
    onOpen?: (shortcut: BravaisHomeShortcut) => void;
    measure?: boolean;
}> = ({ shortcuts, label, rule, onOpen, measure = false }) => {
    const { t } = useTranslation();
    const name = (shortcut: BravaisHomeShortcut) => t(`libraryBravaisHome.special.${shortcut.special}`);
    return (
        <div className="bravais-seam-shortcuts-wrap">
            {rule && <span className="bravais-seam-shortcuts-rule" aria-hidden />}
            <div className="bravais-seam-shortcuts" role={measure ? undefined : 'group'} aria-label={measure ? undefined : label}
                data-bravais-shortcuts={measure ? undefined : ''}>
                {shortcuts.map(shortcut => (measure ? (
                    <span key={shortcut.special} className="bravais-seam-shortcut"><span className="is-label">{name(shortcut)}</span></span>
                ) : (
                    <button
                        key={shortcut.special}
                        type="button"
                        className="bravais-seam-shortcut"
                        data-bravais-seam-action={`shortcut-${shortcut.special}`}
                        data-bravais-shortcut={shortcut.special}
                        aria-label={shortcut.label}
                        title={shortcut.label}
                        onClick={() => (onOpen ? onOpen(shortcut) : shortcut.open())}
                    >
                        <span className="is-label" aria-hidden>{name(shortcut)}</span>
                    </button>
                )))}
            </div>
        </div>
    );
};

/**
 * 页头：标题与竖排页签（真按钮），或它的全名测量副本（span，不可聚焦、不进无障碍树）。`lead` 是页签那一列旁边的
 * 东西（折叠按钮；测量副本里是同尺寸的占位）：单独一行，排在页签列上面（窄缝与书脊一样）。
 * fb2 第二轮（用户看了截图）：「书库」改成页头最上面一行小字（横排），不再与页签列并排占一大块；折叠按钮紧挨在它
 * 下面单独一行（第三轮：不与第一个页签并排），再下面是页签列。空间不够时先隐藏这行标题（`hideTitle`：视觉隐藏，
 * 读屏仍读得到；折叠按钮那一行不隐藏，两份测量副本里都有它），再不够才把页签缩成一个字。
 */
const HomeSeamHead: React.FC<{
    title: string;
    hideTitle: boolean;
    tabs: readonly BravaisSeamTab[];
    shorts: readonly string[] | null;
    lead: React.ReactNode;
    onSelectTab?: (key: string) => void;
    measure?: boolean;
}> = ({ title, hideTitle, tabs, shorts, lead, onSelectTab, measure = false }) => {
    return (
        <div className="bravais-seam-home-head">
            <div className={`bravais-seam-home-title${hideTitle ? ' is-hidden' : ''}`} data-bravais-home-title={measure ? undefined : hideTitle ? 'hidden' : 'shown'}>
                {title}
            </div>
            <div className="bravais-seam-home-side">
                {lead}
                {tabs.length > 0 && (measure ? (
                    <div className="bravais-seam-tabs">
                        {tabs.map(tab => <span key={tab.key} className="bravais-seam-home-tab">{tab.label}</span>)}
                    </div>
                ) : (
                    <div className={`bravais-seam-tabs${shorts ? ' is-short' : ''}`} role="tablist" aria-label={title} aria-orientation="vertical">
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
                                onClick={() => onSelectTab?.(tab.key)}
                            >
                                {shorts ? shorts[index] : tab.label}
                            </button>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

const BravaisSeamHome: React.FC<{
    layer: BravaisLayer;
    compact: boolean;
    setLevel: (level: BravaisSeamLevel) => void;
    /** stage 的直达入口打开（墙上找得到那张卡就以它为起点磁贴）。 */
    openShortcut?: (shortcut: BravaisHomeShortcut) => void;
}> = ({ layer, compact, setLevel, openShortcut }) => {
    const { t } = useTranslation();
    const { seam } = layer;
    const home = seam.home;
    const tabs = seam.tabs ?? [];
    const sections = home?.sections && home.sections.length > 0 ? home.sections : null;
    const shortcuts = home?.shortcuts && home.shortcuts.length > 0 ? home.shortcuts : null;
    const navRef = useRef<HTMLDivElement>(null);
    const headRef = useRef<HTMLDivElement>(null);
    const middleRef = useRef<HTMLDivElement>(null);
    const bodyRef = useRef<HTMLDivElement>(null);
    const slotRef = useRef<HTMLDivElement>(null);
    const titledHeadRef = useRef<HTMLDivElement>(null);
    const bareHeadRef = useRef<HTMLDivElement>(null);
    const fullSlotRef = useRef<HTMLDivElement>(null);
    const jumpsRef = useRef<HTMLDivElement>(null);
    const jumpsMeasureRef = useRef<HTMLDivElement>(null);
    const fit = useBravaisSeamTabsFit({
        navRef, headRef, middleRef, bodyRef, slotRef, titledHeadRef, bareHeadRef, fullSlotRef, jumpsRef, jumpsMeasureRef,
    });
    const { level, overflowing } = fit;
    const short = level === 'short';
    // 直达入口放得下就在中段，否则挪进「⋯」菜单（先于二级切换让位）。
    const shortcutsInColumn = shortcuts !== null && fit.shortcuts;
    const labelsKey = tabs.map(tab => tab.label).join('\u0000');
    const shortLabels = useMemo(() => abbreviateSeamTabLabels(labelsKey.split('\u0000')), [labelsKey]);
    // 元数据行：平时是来源（在线平台名 / 本地 / Navidrome），本地导入 / 重扫时换成扫描进度。
    // fb2：来源名与账户位（在线平台名）、当前页签（本地 / Navidrome）重复，窄缝里纵向空间最紧，平时不画，只在扫描时
    // 显示进度；页签缩成一个字时全名在页签的 title / aria-label 里。
    const reduced = useBravaisReducedTransitions();
    const reveal = bravaisRevealMotion(reduced);
    const filterEditing = useBravaisUiStore(state => state.filterEditing);
    const meta = home?.scan ? <motion.div key="scan" className="bravais-seam-scan" data-bravais-scan {...reveal}>{home.scan}</motion.div> : null;
    // 缩减级别变了（标题隐藏、页签缩成一个字、入口挪进 / 挪出菜单）：页头与切换位淡入新的样子，不硬切。
    useBravaisSeamFade(`${level}|${shortcutsInColumn}`, headRef, slotRef, jumpsRef);
    const expand = () => setLevel('full');
    const foldButton = (
        <button type="button" className="bravais-seam-icon" data-bravais-seam-action="hide" onClick={() => setLevel('hidden')}
            aria-label={t('libraryBravais.seamFold')} title={t('libraryBravais.seamFold')}>
            <FoldHorizontal aria-hidden />
        </button>
    );
    return (
        <div className={`bravais-seam-home${compact ? ' is-compact' : ''}${short ? ' has-short-tabs' : ''}`} data-bravais-home-seam
            data-bravais-home-fit={level} data-bravais-home-shortcuts={shortcuts ? (shortcutsInColumn ? 'column' : 'menu') : undefined}>
            <div ref={navRef} className={`bravais-seam-home-nav${overflowing ? ' is-overflowing' : ''}`}>
                <div className="bravais-seam-home-nav-content">
                    <div ref={headRef}>
                        <HomeSeamHead title={seam.title} hideTitle={level !== 'titled'} tabs={tabs} shorts={short ? shortLabels : null}
                            lead={foldButton} onSelectTab={seam.onSelectTab} />
                    </div>
                    {/* fb3：中段在页头与工具格之间的剩余空间里竖直居中。 */}
                    <div ref={middleRef} className="bravais-seam-home-middle">
                        <div ref={bodyRef} className="bravais-seam-home-body" data-bravais-home-body>
                            <AnimatePresence initial={false}>{meta}</AnimatePresence>
                            {sections && (
                                <div ref={slotRef} className="bravais-seam-sections-slot">
                                    <HomeSeamSections sections={sections} label={seam.meta} short={short} onSelect={home?.onSelectSection} />
                                </div>
                            )}
                            <AnimatePresence initial={false}>
                                {home?.manage && (
                                    <motion.div key="manage" className="bravais-seam-manage" data-bravais-manage={home.manage.mode} {...reveal}>
                                        <span>{home.manage.title}</span>
                                        <button type="button" aria-pressed={home.manage.mode === 'manage-hidden-only'} data-bravais-seam-action="hidden-only"
                                            className={home.manage.mode === 'manage-hidden-only' ? 'is-active' : undefined} onClick={home.manage.onToggleHiddenOnly}>
                                            {home.manage.mode === 'manage-hidden-only' && <Check aria-hidden />}{home.manage.hiddenOnlyLabel}
                                        </button>
                                        <button type="button" data-bravais-seam-action="manage-done" onClick={home.manage.onDone}>{home.manage.doneLabel}</button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                            {seam.status && <BravaisSeamFlipText as="div" axis="y" flipKey={seam.status} className="bravais-seam-vstatus" data-bravais-seam-status>{seam.status}</BravaisSeamFlipText>}
                        </div>
                        {/* fb11：直达入口贴在中段底部（上面的内容在剩下的空间里居中）。 */}
                        <div ref={jumpsRef} className="bravais-seam-home-jumps" data-bravais-home-jumps>
                            {shortcuts && shortcutsInColumn && (
                                <HomeSeamShortcuts shortcuts={shortcuts} label={home?.shortcutsLabel} rule={Boolean(sections)} onOpen={openShortcut} />
                            )}
                        </div>
                    </div>
                </div>
            </div>
            {/* 全名页头的测量副本：与页头同宽、绝对定位不占位（useBravaisSeamTabsFit 量它）。
                fb2 第二轮：两份——带标题的全名页头、不带标题的全名页头。fb3：再加一份全名二级切换（容器常在）。 */}
            <div ref={titledHeadRef} className="bravais-seam-home-measure" aria-hidden>
                <HomeSeamHead title={seam.title} hideTitle={false} tabs={tabs} shorts={null} measure
                    lead={<span className="bravais-seam-icon" />} />
            </div>
            <div ref={bareHeadRef} className="bravais-seam-home-measure" aria-hidden>
                <HomeSeamHead title={seam.title} hideTitle tabs={tabs} shorts={null} measure
                    lead={<span className="bravais-seam-icon" />} />
            </div>
            {/* 全名二级切换的测量副本；直达入口一列的测量副本（fb11：入口贴在中段底部，单独量）。 */}
            <div ref={fullSlotRef} className="bravais-seam-home-measure" aria-hidden>
                {sections && (
                    <div className="bravais-seam-sections-slot">
                        <HomeSeamSections sections={sections} short={false} measure />
                    </div>
                )}
            </div>
            <div ref={jumpsMeasureRef} className="bravais-seam-home-measure" aria-hidden>
                {shortcuts && <HomeSeamShortcuts shortcuts={shortcuts} rule={Boolean(sections)} measure />}
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
            {/* fb4：账户入口贴在工具格正上方（不在中段），平台列表从它往上弹出、盖在导航区上。 */}
            {home?.account && <BravaisSeamAccountSlot account={home.account} compact={compact} />}
            {home && (
                <BravaisSeamHomeTools home={home} compact={compact} onExpand={expand}
                    menuShortcuts={shortcuts && !shortcutsInColumn ? shortcuts : null} onOpenShortcut={openShortcut} />
            )}
            {compact && (
                <button type="button" className="bravais-seam-icon" data-bravais-seam-action="expand" onClick={expand}
                    aria-label={t('libraryBravais.seamExpand')} title={t('libraryBravais.seamExpand')}>
                    <Maximize2 aria-hidden />
                </button>
            )}
        </div>
    );
};

export default BravaisSeamHome;
