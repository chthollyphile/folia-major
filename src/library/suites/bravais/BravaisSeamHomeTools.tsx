import React, { useEffect, useRef, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    Disc3,
    EyeOff,
    FolderTree,
    ListFilter,
    MonitorPlay,
    MoreHorizontal,
    PanelsTopLeft,
    RefreshCw,
    Search,
    Settings,
} from 'lucide-react';
import type { BravaisHomeSeam, BravaisHomeShortcut, BravaisHomeTool, BravaisHomeToolId } from './bravaisHomeModels';
import { BRAVAIS_SPECIAL_ICONS } from './bravaisSpecialIcons';
import { closeBravaisHomePopover, setBravaisHomeOpenRequest, setBravaisHomePopover, useBravaisHomeUiStore } from './bravaisHomeUiStore';
import { useBravaisReducedTransitions } from './bravaisMotion';
import { bravaisPopMotion, seamPopAnchorFor } from './bravaisSeamMotion';

// src/library/suites/bravais/BravaisSeamHomeTools.tsx
// 首页窄缝底部的工具格。
// fb3（用户实测）：工具格固定四格——搜索、设置、播放队列、「⋯」（窄缝两列 40px 排成 2×2，书脊上一列 36px）。
// 其余全部收进「⋯」菜单：本页签的项在前（目录、管理隐藏、Navidrome 刷新，以及本地的导入文件夹 / 刷新 / 导入歌单
// 文件；当前页过滤的「过滤当前页」排在最前），app 级的在后（回到播放页、舞台播放器），中间一道分隔线。菜单从工具格上方弹出、盖在导航区上，不推挤别的
// 内容；Esc 或点别处收起。开关类的项（目录、管理隐藏）在菜单里是 menuitemcheckbox，按下时 aria-checked。
// 书脊（64px）放不下文字菜单：一列只有搜索、设置、队列与「⋯」；点「⋯」先把缝展开成窄缝，窄缝渲染出来后再打开菜单
// （经 bravaisHomeUiStore 的 openRequest）。
// 各按钮的 data-bravais-seam-action 仍是工具 id / 菜单项 id（用例与探针按它找）。
// 菜单开合是弹出动画（从工具格那一侧放大、上移、淡入，收起反过来；降低动效时只淡入淡出，bravaisSeamMotion）。
// 用户实测（菜单透明、与账户入口叠字）：根因不是弹出动画——framer 的 motion.div 保留了 is-home 的不透明底——而是 fb4 给
// 账户位加了 position: relative + z-index: 3，工具格（dock）没有层级，菜单的 z-index: 2 只在窄缝这一层里比，于是被账户
// 入口盖在上面。修法：dock 的层级抬到账户位之上（bravaisHome.css）；菜单两侧比工具格各宽一些、项不折行。
// 菜单开没开记在 bravaisHomeUiStore 的 popover。
// 直达入口（特殊集合）在窄缝中段放不下时挪进菜单（menuShortcuts）：排在最前，图标 + 全名，与后面的项隔一道分隔线。
// fb11（用户要求）：舞台模式开着时（宿主给了 onOpenStagePlayer 且 stageEnabled，即有 stage 这个工具）舞台入口不再在「⋯」
// 的 app 组里，而是单独占工具格最上面一整行（窄缝里是图标 + 短名「舞台」的一条，宽同两格；书脊上是一列最上面的一个图标），
// 下面的 2×2（搜索、设置 / 队列、⋯）不变——「⋯」一直在右下角，舞台关着时工具格与原来完全一样。单独一行而不是排成
// 3 + 2：窄缝只有约 100px 宽，三格 40px 放不下；五格两列会剩一个空洞、「⋯」的位置也会变。舞台与 grid 首页那一排的
// 「舞台」一样是「去哪儿」，所以带字。正在用舞台播放（stageIsActive）时与 grid 一样只标 data-stage-active，不画选中态
// （它不是开关，点它总是打开舞台）。
// 工具带 badge（设置：发现新版本）时说明拼进 aria-label / title；窄缝里工具格下方另起一行可点的说明文字（点它与点那一格相同），
// 书脊上放不下文字，改在图标右上角画一个强调色的点。

const TOOL_ICONS: Record<BravaisHomeToolId, React.ComponentType<{ 'aria-hidden'?: boolean; className?: string }>> = {
    search: Search,
    filter: ListFilter,
    directory: FolderTree,
    'manage-hidden': EyeOff,
    'refresh-navidrome': RefreshCw,
    'refresh-explore': RefreshCw,
    // 进 Lattice（播放队列）：与 grid 首页 Grid3D 的 Lattice 入口同一个图标（home-lattice-pill）。
    queue: PanelsTopLeft,
    player: Disc3,
    stage: MonitorPlay,
    settings: Settings,
};

/** 工具格里固定的三格（加「⋯」共四格），按这个顺序；舞台（有时）单独一行排在最前。 */
const DOCK_TOOLS: readonly BravaisHomeToolId[] = ['stage', 'search', 'settings', 'queue'];
/** 「⋯」里分隔线之后的 app 级入口。 */
const APP_TOOLS: ReadonlySet<BravaisHomeToolId> = new Set(['player']);

/** 把工具分成工具格里的（固定顺序）、「⋯」里本页签的、「⋯」里 app 级的（后两组保持原顺序）。 */
export const splitHomeTools = (tools: readonly BravaisHomeTool[]) => ({
    dock: DOCK_TOOLS.flatMap(id => tools.filter(tool => tool.id === id)),
    page: tools.filter(tool => !DOCK_TOOLS.includes(tool.id) && !APP_TOOLS.has(tool.id)),
    app: tools.filter(tool => APP_TOOLS.has(tool.id)),
});

const BravaisSeamHomeTools: React.FC<{
    home: BravaisHomeSeam;
    compact: boolean;
    onExpand: () => void;
    /** 中段放不下、挪进菜单的直达入口（在中段时为 null）。 */
    menuShortcuts?: readonly BravaisHomeShortcut[] | null;
    onOpenShortcut?: (shortcut: BravaisHomeShortcut) => void;
}> = ({ home, compact, onExpand, menuShortcuts, onOpenShortcut }) => {
    const menuOpen = useBravaisHomeUiStore(state => state.popover === 'menu');
    const dockRef = useRef<HTMLDivElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);
    const request = useBravaisHomeUiStore(state => state.openRequest);
    const { dock, page, app } = splitHomeTools(home.tools);
    const notice = dock.find(tool => tool.badge);
    const local = home.menu ?? [];
    const jumps = menuShortcuts ?? [];
    const hasMenu = jumps.length > 0 || page.length > 0 || local.length > 0 || app.length > 0;
    const open = menuOpen && hasMenu && !compact;
    // 横的信息条在视口上半时菜单往下弹（工具格一直挂着，dockRef 在打开菜单的那次渲染里已经有值）。
    const pop = bravaisPopMotion(seamPopAnchorFor(dockRef.current), useBravaisReducedTransitions());

    // 书脊上点了「⋯」：缝展开成窄缝后在这里把菜单打开。
    useEffect(() => {
        if (compact || request !== 'menu') return;
        setBravaisHomeOpenRequest(null);
        setBravaisHomePopover('menu');
    }, [compact, request]);

    // 卸载时收起自己开着的菜单，下次挂载不带着旧的开合。只收「这个实例开着的」：书脊翻成窄缝时新实例先挂上、经
    // openRequest 打开菜单，旧的书脊实例后卸载，它没开过菜单，不能把新开的收掉。
    const shownRef = useRef(false);
    shownRef.current = open;
    useEffect(() => () => {
        if (shownRef.current) closeBravaisHomePopover('menu');
    }, []);

    // 菜单开着时点别处收起（缝里、墙上都算）。
    useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && dockRef.current?.contains(event.target)) return;
            closeBravaisHomePopover('menu');
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        return () => document.removeEventListener('pointerdown', onPointerDown, true);
    }, [open]);

    // 菜单开着时 Esc 先收起它（preventDefault 让墙的 Esc 阶梯跳过这次按键）。
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || !open) return;
        event.preventDefault();
        closeBravaisHomePopover('menu');
        // 菜单要放完收起动画才卸载：焦点在菜单里的话先交回「⋯」，不跟着卸载的菜单丢掉。
        if (event.target instanceof Node && !moreRef.current?.contains(event.target)) moreRef.current?.focus({ preventScroll: true });
    };

    const runItem = (run: () => void) => {
        closeBravaisHomePopover('menu');
        run();
    };

    const onMore = () => {
        if (compact) {
            setBravaisHomeOpenRequest('menu');
            onExpand();
            return;
        }
        setBravaisHomePopover(menuOpen ? null : 'menu');
    };

    const menuTool = (tool: BravaisHomeTool) => {
        const Icon = TOOL_ICONS[tool.id];
        const toggle = tool.pressed !== undefined;
        return (
            <button key={tool.id} type="button" role={toggle ? 'menuitemcheckbox' : 'menuitem'} aria-checked={toggle ? tool.pressed : undefined}
                disabled={tool.disabled} data-bravais-seam-action={tool.id} className={`is-tool${tool.pressed ? ' is-pressed' : ''}`}
                onClick={() => runItem(tool.run)}>
                <Icon aria-hidden className={tool.busy ? 'animate-spin' : undefined} />{tool.label}
            </button>
        );
    };

    return (
        <div ref={dockRef} className="bravais-seam-dock" onKeyDown={onKeyDown}>
            <AnimatePresence>
                {open && (
                    <motion.div key="menu" className="bravais-seam-menu is-home" role="menu" aria-label={home.menuLabel} data-bravais-seam-menu {...pop}>
                        {jumps.map(shortcut => {
                            const Icon = BRAVAIS_SPECIAL_ICONS[shortcut.special];
                            return (
                                <button key={shortcut.special} type="button" role="menuitem" className="is-shortcut"
                                    data-bravais-seam-action={`shortcut-${shortcut.special}`} data-bravais-shortcut={shortcut.special}
                                    onClick={() => runItem(() => (onOpenShortcut ? onOpenShortcut(shortcut) : shortcut.open()))}>
                                    <Icon aria-hidden />{shortcut.label}
                                </button>
                            );
                        })}
                        {jumps.length > 0 && (page.length > 0 || local.length > 0 || app.length > 0) && <div className="bravais-seam-menu-rule" role="separator" />}
                        {page.map(menuTool)}
                        {local.map(item => (
                            <button key={item.id} type="button" role="menuitem" disabled={item.disabled} data-bravais-seam-action={item.id}
                                className={item.danger ? 'is-danger' : undefined} onClick={() => runItem(item.run)}>
                                {item.label}
                            </button>
                        ))}
                        {(page.length > 0 || local.length > 0) && app.length > 0 && <div className="bravais-seam-menu-rule" role="separator" />}
                        {app.map(menuTool)}
                    </motion.div>
                )}
            </AnimatePresence>
            <div className="bravais-seam-tools">
                {dock.map((tool) => {
                    const Icon = TOOL_ICONS[tool.id];
                    const wide = tool.id === 'stage';
                    const label = tool.badge ? `${tool.label} · ${tool.badge}` : tool.label;
                    return (
                        <button
                            key={tool.id}
                            type="button"
                            className={`bravais-seam-icon${tool.pressed ? ' is-pressed' : ''}${wide ? ' is-wide' : ''}`}
                            data-bravais-seam-action={tool.id}
                            data-stage-active={wide ? String(Boolean(tool.active)) : undefined}
                            data-bravais-badge={tool.badge ? 'true' : undefined}
                            aria-label={label}
                            aria-pressed={tool.pressed}
                            title={label}
                            disabled={tool.disabled}
                            onClick={tool.run}
                        >
                            <Icon aria-hidden className={tool.busy ? 'animate-spin' : undefined} />
                            {wide && !compact && tool.shortLabel && <span className="is-label" aria-hidden>{tool.shortLabel}</span>}
                            {tool.badge && compact && <span className="is-badge" aria-hidden />}
                        </button>
                    );
                })}
                {hasMenu && (
                    <button ref={moreRef} type="button" className={`bravais-seam-icon${open ? ' is-pressed' : ''}`} data-bravais-seam-action="more"
                        aria-haspopup="menu" aria-expanded={open} aria-label={home.menuLabel} title={home.menuLabel}
                        onClick={onMore}>
                        <MoreHorizontal aria-hidden />
                    </button>
                )}
            </div>
            {notice && !compact && (
                <button type="button" className="bravais-seam-notice" data-bravais-seam-action={`${notice.id}-notice`}
                    title={notice.badge} onClick={notice.run}>
                    <span className="is-dot" aria-hidden />
                    <span className="is-text">{notice.badge}</span>
                </button>
            )}
        </div>
    );
};

export default BravaisSeamHomeTools;
