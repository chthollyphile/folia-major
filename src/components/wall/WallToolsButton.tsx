import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useIsPresent, useTransform, type MotionStyle } from 'framer-motion';
import { CircleHelp, Command, Layers3, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLatticeSettingsStore } from '../../stores/useLatticeSettingsStore';
import { openCommandPalette } from '../../stores/useAppViewStore';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePlayerBottomBarBottomPx } from '../../hooks/usePlayerBottomBarBottomPx';
import { SlideActionButton } from '../shared/SlideActionButton';
import { WallToolsQuickRow, WallToolsRow, type WallToolsEntry, type WallToolsQuickAction } from './WallToolsRows';
import { useWallToolsCommonActions } from './useWallToolsCommonActions';
import { WallToolsQueueIsland } from './WallToolsQueueIsland';
import { useWallToolsHost } from './wallToolsHost';
import './WallToolsButton.css';
import { useGlass } from '@/shinoinject/useGlass';

// src/components/wall/WallToolsButton.tsx
// 海报墙右下角的工具按钮（Lattice 与 bravais 共用）：点按打开锚定的玻璃面板，向左滑打开命令面板。
// 面板从上到下：一排纯图标快捷格 → 音量 → 墙自己的条目 → 海报叠色 → 开灯 / 关灯与帮助。
// 两面墙结构一致，只有和场景有关的部分由使用方传入：按钮上方的定位按钮（above）、快捷排里的 destination
// （bravais 前往 Lattice、Lattice 回到首页）、自己的条目（bravais 的「墙面外观」与透光、Lattice 的「墙面」与切歌自动聚焦）
// 和帮助内容。洗牌、主题、队列、播放器、设置五格与音量滑条是公共部分，由 useWallToolsCommonActions 从宿主（wallToolsHost）组装；
// 快捷格的固定顺序是 shuffle-queue / generate-theme / queue / destination / open-player / open-settings，缺的跳过。
// 面板与队列浮岛（WallToolsQueueIsland，由快捷排的「队列」格开合、偏好记在 useLatticeSettingsStore）都放在
// .lattice-tools-stack 里、都在 rootRef 之内：点外部关闭天然把浮岛算作「里面」。stack 是 column-reverse：DOM 里面板在前、
// 浮岛在后（Tab 顺序面板 → 浮岛 → 按钮），视觉上浮岛在面板上方。浮岛只在面板打开、偏好展开、有宿主且不在私人 FM 时显示；
// Esc 先由浮岛撤自己的那一步（拖拽、内联输入、清空待确认，preventDefault），没有可撤的才收起面板与浮岛（偏好不变）。
// 叠色与灯光读写同一个 useLatticeSettingsStore——一套墙面外观设置同时作用于 Lattice 与资料库墙。
// 从 LatticeFocusButton 抽出（实测反馈 1），条目的行组件在 WallToolsRows。
// 翻牌交接（设计稿 §7「进入队列」）：App 在首页层与 Lattice 之上挂一个 WallToolsDock，两面墙的按钮都「认领」进同一个
// dock、由它画出唯一的一颗——进 / 出 Lattice 时按钮节点不重建、原地不动，只换条目与帮助（idPrefix 变了就先收起面板）。
// 没有 dock 的地方（组件探针、Ponder 的合成界面）照旧就地渲染。

export type { WallToolsEntry, WallToolsQuickAction };

/** 快捷格的槽：给函数时只在面板打开着渲染时求值（可用性随时变，例如正在播放的那首在不在墙上）。 */
export type WallToolsQuickSlot = WallToolsQuickAction | (() => WallToolsQuickAction);

export type WallToolsButtonProps = {
    /** 面板与帮助的 id 前缀（`<前缀>-panel` / `<前缀>-help`）。 */
    idPrefix: string;
    /** 按钮的 title 与面板的可访问名。 */
    label: string;
    isDaylight: boolean;
    /** 快捷排第四格（播放器、设置之前）：这面墙的去处（bravais 是 open-lattice，Lattice 是 go-home）；不给时没有这一格。 */
    destination?: WallToolsQuickSlot;
    /** 音量下面那几行（墙自己的条目）；给函数时只在面板打开着渲染时求值（条目的可用性随时变）。 */
    entries: readonly WallToolsEntry[] | (() => readonly WallToolsEntry[]);
    /** 帮助列表的内容（若干 `<li>`）。 */
    help: ReactNode;
    /**
     * 按钮正上方、面板之下的一样东西（Lattice 的定位按钮，与集合页的同一个）：与按钮排成一列，面板与浮岛整体上移让开。
     * Lattice 与 bravais 都给（有歌在放时）。
     */
    above?: ReactNode;
    /**
     * 在 dock 里时要不要认领（缺省要）：墙此刻不显示（首页层被盖住、当前层不归这面墙）时不认领，dock 里就没有它这一份。
     * 不在 dock 里（就地渲染）时不看它。
     */
    claimed?: boolean;
};

/** dock 的登记处（WallToolsDock 提供）：按钮把自己的 props 认领进去，dock 画最后认领的那一份。 */
export type WallToolsDockRegistry = {
    claim: (id: string, props: WallToolsButtonProps) => void;
    release: (id: string) => void;
};

export const WallToolsDockContext = createContext<WallToolsDockRegistry | null>(null);

const resolveSlot = (slot: WallToolsQuickSlot | undefined): WallToolsQuickAction | null => (
    slot ? (typeof slot === 'function' ? slot() : slot) : null
);

/** 按钮与面板本身（dock 里与就地渲染都画这一份）。 */
export function WallToolsSurface({ idPrefix, label, isDaylight, destination, entries, help, above }: WallToolsButtonProps) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    // 面板正在随这次打开浮现：浮岛与它同时挂上时晚一拍出现（下面的面板先到，浮岛跟上）；面板入场动画结束后复位，
    // 之后在开着的面板上点「队列」格展开浮岛不再等。
    const [islandTrailsPanel, setIslandTrailsPanel] = useState(false);
    // dock 里换了墙（Ctrl+B 进 / 出 Lattice、翻牌交接）：idPrefix 变了就收起面板，不让新墙接着开着旧墙的面板。
    const [shownPrefix, setShownPrefix] = useState(idPrefix);
    if (shownPrefix !== idPrefix) {
        setShownPrefix(idPrefix);
        setIsOpen(false);
        setShowHelp(false);
    }
    const rootRef = useRef<HTMLDivElement>(null);
    const lightsOn = useLatticeSettingsStore(state => state.latticeLightsOn);
    const handleToggleLatticeLights = useLatticeSettingsStore(state => state.handleToggleLatticeLights);
    const tintEnabled = useLatticeSettingsStore(state => state.latticePosterTintEnabled);
    const handleToggleLatticePosterTint = useLatticeSettingsStore(state => state.handleToggleLatticePosterTint);
    const isWideLayout = useMediaQuery('(min-width: 640px)');
    const bottomPx = usePlayerBottomBarBottomPx(isWideLayout ? 24 : 16);
    // stack 的 max-height 要减掉按钮此刻的底距（随底栏抬升量变），经 CSS 变量交给样式。
    const bottomVar = useTransform(bottomPx, value => `${value}px`);
    const host = useWallToolsHost();

    const close = () => {
        setIsOpen(false);
        setShowHelp(false);
    };

    useEffect(() => {
        if (!isOpen) return undefined;

        const handlePointerDown = (event: PointerEvent) => {
            if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
                setIsOpen(false);
                setShowHelp(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                // 面板里的东西（队列浮岛的拖拽、内联输入）已经用掉了这次 Esc：只撤那一步，面板不收。
                if (event.defaultPrevented) return;
                // 这次 Esc 只用来收起面板：墙自己的 Esc 阶梯（bravais 在 window 上听、认 defaultPrevented）不再处理它。
                event.preventDefault();
                setIsOpen(false);
                setShowHelp(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    const handleOpenCommandPalette = () => {
        close();
        openCommandPalette();
    };

    const panelId = `${idPrefix}-panel`;
    const helpId = `${idPrefix}-help`;
    const queueIslandId = `${idPrefix}-queue-island`;
    const common = useWallToolsCommonActions({ queueIslandId });
    const showQueueIsland = isOpen && common.queueIslandShown && host !== null;
    const rows = isOpen ? (typeof entries === 'function' ? entries() : entries) : [];
    // 快捷排的固定顺序：洗牌、主题、队列、去处、播放器、设置；缺的跳过。
    const quick: WallToolsQuickAction[] = isOpen
        ? [common.shuffle, common.theme, common.queue, resolveSlot(destination), common.openPlayer, common.settings]
            .filter((action): action is WallToolsQuickAction => action !== null)
        : [];
    // 叠色开关两边都有（颜色与强度的细调仍在设置页与命令面板）。
    const tintRow: WallToolsEntry = {
        kind: 'toggle',
        id: 'poster-tint',
        icon: Layers3,
        label: t('options.latticePosterTint'),
        checked: tintEnabled,
        onToggle: handleToggleLatticePosterTint,
    };
    useGlass();
    return (
        <motion.div
            ref={rootRef}
            style={{ bottom: bottomPx, '--wall-tools-bottom': bottomVar } as unknown as MotionStyle}
            className={`lattice-tools group ${above ? 'has-above' : ''} ${isDaylight ? 'is-daylight' : ''}`}
        >
            {/* 面板与队列浮岛叠在按钮上方的一列里（column-reverse：面板在下、浮岛在上）：定位在 stack 上，面板自己不再 absolute。 */}
            <div className={showQueueIsland ? 'lattice-tools-stack has-queue-island' : 'lattice-tools-stack'}>
                <AnimatePresence initial={false}>
                    {isOpen && (
                        <motion.div
                            id={panelId}
                            role="menu"
                            aria-label={label}
                            initial={{ opacity: 0, scale: 0.9, originX: 1, originY: 1 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            onAnimationComplete={() => setIslandTrailsPanel(false)}
                        className={quick.length > 0 ? 'lattice-tools-panel has-quick-actions' : 'lattice-tools-panel'}
                        data-glass
                    >
                            {quick.length > 0 && <WallToolsQuickRow actions={quick} onDone={close} />}
                            <WallToolsRow entry={common.volume} onDone={close} />
                            {rows.map(entry => <WallToolsRow key={entry.id} entry={entry} onDone={close} />)}
                            <WallToolsRow entry={tintRow} onDone={close} />
                            <div className="lattice-tools-help-section" role="none">
                                <button
                                    type="button"
                                    role="menuitemcheckbox"
                                    aria-checked={lightsOn}
                                    aria-label={t('home.latticeLights')}
                                    className="lattice-tools-lights-toggle"
                                    onClick={() => handleToggleLatticeLights(!lightsOn)}
                                >
                                    <span className={lightsOn ? 'is-active' : ''}>{t('home.latticeLightsOn')}</span>
                                    <span className={lightsOn ? '' : 'is-active'}>{t('home.latticeLightsOff')}</span>
                                </button>
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="lattice-tools-action lattice-tools-help-trigger"
                                    aria-label={t('home.latticeHelp')}
                                    title={t('home.latticeHelp')}
                                    aria-expanded={showHelp}
                                    aria-controls={helpId}
                                    onClick={() => setShowHelp(visible => !visible)}
                                >
                                    <CircleHelp aria-hidden="true" />
                                </button>
                                <AnimatePresence initial={false}>
                                    {showHelp && (
                                        <motion.div
                                            id={helpId}
                                            role="note"
                                            className="lattice-tools-help"
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.18, ease: 'easeOut' }}
                                        >
                                            <ul>{help}</ul>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                <AnimatePresence initial={false}>
                    {showQueueIsland && <WallToolsQueueIsland key="queue-island" id={queueIslandId} host={host} trailsPanel={islandTrailsPanel} />}
                </AnimatePresence>
            </div>

            {above}
            <SlideActionButton
                icon={isOpen ? X : Settings2}
                title={label}
                onActivate={() => {
                    setIslandTrailsPanel(!isOpen);
                    setIsOpen(open => {
                        if (open) setShowHelp(false);
                        return !open;
                    });
                }}
                slideIcon={Command}
                slideTitle={t('options.gridSlideTargetCommandPalette')}
                onSlide={handleOpenCommandPalette}
                isDaylight={isDaylight}
                accentColor="var(--text-accent)"
                accentForeground="var(--text-on-accent, #ffffff)"
            />
        </motion.div>
    );
}

/**
 * 墙用的入口：外面有 dock 时把 props 认领进去、自己不画（dock 画唯一的一颗）；没有 dock 时就地渲染。
 * 在 AnimatePresence 里退场途中（Lattice 整层淡出）就撤回认领，免得按钮在已经离开的墙上多停一会儿。
 */
export default function WallToolsButton(props: WallToolsButtonProps) {
    const dock = useContext(WallToolsDockContext);
    const id = useId();
    const present = useIsPresent();
    const claimed = (props.claimed ?? true) && present;
    // 每次提交都把最新的 props 交给 dock（条目、帮助随墙的状态变）；不认领时撤回。
    useLayoutEffect(() => {
        if (!dock) return;
        if (claimed) dock.claim(id, props);
        else dock.release(id);
    });
    useLayoutEffect(() => (dock ? () => dock.release(id) : undefined), [dock, id]);
    return dock ? null : <WallToolsSurface {...props} />;
}
