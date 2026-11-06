import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useIsPresent, type Transition } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';
import ScratchpadBand, { ScratchpadSlim } from './ScratchpadBand';
import ScratchpadGreeting from './ScratchpadGreeting';
import ScratchpadShape from './ScratchpadShape';
import { useScratchpadHistory } from './useScratchpadHistory';
import { SCRATCHPAD_TABS, SCRATCHPAD_TAB_SHAPES } from './scratchpadLook';
import { overviewBottomInset, overviewRowTops, tiltDrop } from './canvasLayout';
import {
    PANEL_SLIM_SHIFT,
    PAPER_EASE,
    PAPER_FACE_VARIANTS,
    SLIM_HEIGHT,
    panelPaperFrame,
    usePaperMotions,
    type PaperFrame,
    type PaperMotion,
} from './scratchpadPaper';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';

// src/components/app/scratchpad/ScratchpadSheet.tsx
// 展开整页（设计稿 F 定稿）：整张纸向右下转 4°（设计稿 6°，用户嫌斜，2026-11-06 改小；降低动态效果时不转，同歌手页），这一页的米白信息条横贯整张纸，
// 下面是这一页的卡片（宿主交进来的 children：画布、跳到栏与操作提示），另外两页收成两条细纸带压在左下角
// （右边转出屏幕、被播放胶囊挡住），点它换过去。右上角一块黑色直角三角（不转）：放大的问候与面包屑。
// 返回（收回左缘的面板）是压在顶上那条信息条左端的一颗墨色大方钮（用户要的，放在左边、显眼）：整页里在这一页的条上，
// 总览里在第一行的条上，进出总览时跟着条挪。
// 纸后面是这一页几何体的低可见度大构图（照搜索页的至上主义构图：大空心形、淡色块、实心小形、发丝线、斜线小方块、竖排大字）。
// 信息条右端的按钮由各页自己画进来（ScratchpadBandActions，经 portal 放进条上的空位）。
// 信息条上「‹ 三行总览」换成三行总览（ScratchpadOverview，宿主经 overview 交进来）：三条信息条各带一行头几张卡。
//
// 三条信息条一直都在、各自一层（用户要的「整个信息条移动展开」）：总览里是三行 72px 的条，整页里这一页是顶上 120px 的条、
// 另外两条是左下角 36px 的细纸带。换页、进出总览时每一条从现在的位置挪到新位置、长高或变矮，条里的内容交叉淡入；
// 怎么挪（直接挪，或先从上方出去、再从下面升回底部）与左缘面板共用（scratchpadPaper.ts）。
// 展开与收回是同一张纸的一次连续动作（用户要的，2026-11-07）：左缘面板也是这三条纸（顶上信息条、底部两条细纸带），
// 展开时三条各自从面板里的位置长出去——这一页的条从面板顶上那条（同一个位置、同一个样子，面板那一面，ENTER_*）
// 一边长到整页那条、一边换成整页的样子；另外两条从面板底部那两格拉长成左下角的细纸带，字不动（--scratchpad-slim-shift 跟着变）。
// 纸同时转到 tilt；墙上的纱单独淡入（.scratchpad-f-scrim），面板在纱底下待着再淡掉。收回时倒过来：三条缩回面板里各自那一格
// （总览里的三行也一样），纱淡掉；面板已经在原位（不再从左边滑进来），条落定的那一刻整页才淡掉，看不出接缝。
// 降低动态效果时不挪，只淡入淡出。

/** 信息条右端的空位：各页把自己的按钮画进去。 */
const BandSlotContext = createContext<HTMLElement | null>(null);

/** 把这一页的按钮画到展开整页信息条的右端（不在展开整页时什么都不画）。 */
export const ScratchpadBandActions: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const slot = useContext(BandSlotContext);
    return slot ? createPortal(children, slot) : null;
};

/** 纸比窗口每边多出来的（转过之后四角不露底）：左右 160px、上下 130px。 */
const SHEET_BLEED_X = 160;
const SHEET_BLEED_Y = 130;

const TITLE_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.title', history: 'scratchpad.history', queue: 'scratchpad.queue' };
const META_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.hint', history: 'scratchpad.historyHint', queue: 'scratchpad.queueHint' };

/** 一条信息条此刻的样子：整页顶上那条、总览里的一行、左下角的细纸带。 */
type BandMode = 'full' | 'row' | 'slim';
/** 条里那一面：除了上面三种，展开开头与收回末尾是左缘面板顶上那条的样子。 */
type FaceMode = BandMode | 'panel';

/** 左缘面板里一条纸在纸上的位置（纸还没转时）：面板里的窗口坐标挪到纸上；细纸带的字在面板里那个位置。 */
const fromPanel = (frame: PaperFrame) => ({
    top: frame.top + SHEET_BLEED_Y,
    left: frame.left + SHEET_BLEED_X,
    width: frame.width,
    height: frame.height,
    '--scratchpad-slim-shift': `${PANEL_SLIM_SHIFT}px`,
});
/** 落定之后细纸带的字回到纸上 186px（scratchpadPaper.ts 的 PANEL_SLIM_SHIFT）。 */
const SETTLE = { '--scratchpad-slim-shift': '0px' };
/** 整页那条信息条：离纸顶 230px（转过之后左端离窗口顶约 25px），120px 高。 */
const FULL_BAND_TOP = 230;
const FULL_BAND_HEIGHT = 120;
const ROW_BAND_HEIGHT = 72;
/**
 * 细纸带、卡片区底边离纸底边多远。不倾斜时细纸带整条挪进窗口（窗口底边在纸上 100% − 130px），卡片区让到它们上面；
 * 倾斜时纸的左半边被抬起来，两样都往下压 tiltSink（按 sin(tilt) 算，6° 时 54px）。
 */
const SLIM_FROM_BOTTOM_FLAT = [214, 172] as const;
const BODY_FROM_BOTTOM_FLAT = 220;
const tiltSink = (tilt: number): number => Math.round((54 * Math.sin((tilt * Math.PI) / 180)) / Math.sin((6 * Math.PI) / 180));
/** 卡片区与右边那一列在纸上的右边界（离纸右边多远）：右边那一列 124px 宽、与卡片区隔 26px。 */
const SIDE_RIGHT = 184;
const CARDS_RIGHT = SIDE_RIGHT + 124 + 26;
/** 返回钮：在纸上的左边（纸左边多出来 160px，转过之后约在窗口左边 15–50px）、边长。 */
const BACK_LEFT = 174;
const BACK_SIZE = 48;

/**
 * 纸上不算空白的地方：点空白处收回左缘的面板（用户要的，2026-11-06，与 Esc 一样），这些不算——信息条、细纸带、按钮、
 * 黑三角，以及卡片画布与三行总览（它们自己判断：在空着的地方点一下、又没有选中什么时才收，见 ScratchpadCanvas / ScratchpadOverview）。
 */
const SHEET_NOT_BLANK_SELECTOR = 'button, a[href], input, .scratchpad-sheet-band, .scratchpad-triangle, .scratchpad-overview-help, .scratchpad-canvas, .scratchpad-overview, .scratchpad-canvas-side .scratchpad-jump, [role="menu"], [role="dialog"]';
const CLICK_SLOP_PX = 6;

/** 安全区：转过之后的底边离窗口底边至少留这么多。 */
const SAFE_MARGIN = 20;

/**
 * 展开：条里先是面板那一面，下一帧换成整页那一面——面板那一面马上淡掉，整页那一面在它快淡完时接上，条长到大半时淡满。
 * 收回：整页那一面马上淡掉，面板那一面接着淡入，条落定前淡满；条缩回去比展开快一点。两面之间不留一段空白的纸。
 */
const ENTER_FACE: Pick<PaperMotion, 'faceIn' | 'faceOut'> = { faceIn: { duration: 0.26, delay: 0.04 }, faceOut: { duration: 0.16 } };
const LEAVE_FACE: Pick<PaperMotion, 'faceIn' | 'faceOut'> = { faceIn: { duration: 0.24, delay: 0.06 }, faceOut: { duration: 0.14 } };
const LEAVE_DURATION = 0.44;

/** 绕一圈去底部时，离开时在纸上要到多高、从多低回来（纸的上下各比窗口多 130px，再留出转过之后右端压低、左端抬高的那一截）。 */
const WRAP_ABOVE = -60;
const WRAP_BELOW = 60;

type ScratchpadSheetProps = {
    tab: ScratchpadTab;
    notesCount: number;
    queueCount: number;
    /** 纸转几度（降低动态效果时 0）。 */
    tilt: number;
    /** 降低动态效果：信息条不挪，只淡入淡出。 */
    calm: boolean;
    /** 左下角两条细纸带的上下次序（与左缘面板共用，useSlimOrder）。 */
    slimOrder: readonly ScratchpadTab[];
    /** 换到这一页（细纸带、总览里的「展开整页 ›」）。 */
    onOpenPage: (tab: ScratchpadTab) => void;
    /** 收回左缘的面板。 */
    onCollapse: () => void;
    collapseLabel: string;
    collapseRef?: React.Ref<HTMLButtonElement>;
    /** 三行总览：给了就画它（参数是纸的宽度与窗口高度），不画这一页。 */
    overview?: ((sheetWidth: number, viewHeight: number) => React.ReactNode) | null;
    /** 展开整页的信息条上「‹ 三行总览」。 */
    onShowOverview?: () => void;
    children: React.ReactNode;
};

/** 纸后面的大构图：这一页的几何体放大、几乎看不见（不转）。 */
const Backdrop: React.FC<{ tab: ScratchpadTab; word: string }> = ({ tab, word }) => {
    const kind = SCRATCHPAD_TAB_SHAPES[tab];
    const turn = (deg: number): React.CSSProperties => (kind === 'circle' ? {} : { transform: `rotate(${deg}deg)` });
    return (
        <>
            <span className="scratchpad-backdrop-wedge" />
            <ScratchpadShape kind={kind} size={680} fill="none" stroke="currentColor" strokeWidth={1.5} className="scratchpad-backdrop-shape is-big" style={turn(-8)} />
            <ScratchpadShape kind={kind} size={250} fill="none" stroke="currentColor" strokeWidth={1.5} className="scratchpad-backdrop-shape is-mid" style={turn(14)} />
            <ScratchpadShape kind={kind} size={320} fill="var(--scratchpad-mark-wall)" className="scratchpad-backdrop-shape is-tint" style={turn(12)} />
            <ScratchpadShape kind={kind} size={46} fill="currentColor" className="scratchpad-backdrop-shape is-small" style={turn(-18)} />
            <span className="scratchpad-backdrop-hair is-upper" />
            <span className="scratchpad-backdrop-hair is-lower" />
            <span className="scratchpad-backdrop-hatch" />
            <span className="scratchpad-backdrop-word">{word}</span>
        </>
    );
};

const ScratchpadSheet: React.FC<ScratchpadSheetProps> = ({
    tab, notesCount, queueCount, tilt, calm, slimOrder, onOpenPage, onCollapse, collapseLabel, collapseRef, overview, onShowOverview, children,
}) => {
    const { t } = useTranslation();
    // 收回时（整页正在退场）这一页的条换回面板那一面；展开的头一帧也是面板那一面，下一帧再换成整页的（entering）。
    const isPresent = useIsPresent();
    const [entering, setEntering] = useState(!calm);
    useEffect(() => {
        if (entering) setEntering(false);
    }, [entering]);
    const historyCount = useScratchpadHistory().length;
    const counts: Record<ScratchpadTab, number> = { notes: notesCount, history: historyCount, queue: queueCount };
    // 每一页的信息条各有一个按钮空位（换页时新旧两条同时在场），这一页的按钮画进这一页的那个。
    const [slots, setSlots] = useState<Partial<Record<ScratchpadTab, HTMLElement | null>>>({});
    const slotRefs = useMemo(() => Object.fromEntries(SCRATCHPAD_TABS.map(id => [id, (element: HTMLElement | null) => {
        setSlots(current => (current[id] === element ? current : { ...current, [id]: element }));
    }])) as Record<ScratchpadTab, (element: HTMLElement | null) => void>, []);
    // 信息条的装饰按纸的宽度撒（窗口宽 + 两边多出来的）；三行总览与细纸带按窗口高度排。
    const [sheetWidth, setSheetWidth] = useState(() => (typeof window === 'undefined' ? 1760 : window.innerWidth + SHEET_BLEED_X * 2));
    const [viewHeight, setViewHeight] = useState(() => (typeof window === 'undefined' ? 900 : window.innerHeight));
    useEffect(() => {
        const onResize = () => {
            setSheetWidth(window.innerWidth + SHEET_BLEED_X * 2);
            setViewHeight(window.innerHeight);
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    const indexOf = (id: ScratchpadTab) => String(SCRATCHPAD_TABS.indexOf(id) + 1).padStart(2, '0');
    // 兜底：换页、进出总览之后（这一页是空的、没有画布来接焦点时）焦点还在 body 上，就交给整页自己，
    // Esc 冒到抽屉上收回侧栏，按键不落到被盖住的墙上。等换页的动画（先退后进）走完再看。
    const rootRef = useRef<HTMLDivElement>(null);
    const showsOverview = Boolean(overview);
    // 总览右上角「?」点开的一行操作说明（离开总览就收起）。
    const [helpOpen, setHelpOpen] = useState(false);
    useEffect(() => {
        if (!showsOverview) setHelpOpen(false);
    }, [showsOverview]);
    useEffect(() => {
        const timer = window.setTimeout(() => {
            const active = document.activeElement;
            if (!active || active === document.body) rootRef.current?.focus({ preventScroll: true });
        }, 600);
        return () => window.clearTimeout(timer);
    }, [showsOverview, tab]);
    const title = t(TITLE_KEYS[tab]);
    // 点纸上的空白处收回：按下时记下位置，松开时没挪开才算点。
    const pressRef = useRef<{ x: number; y: number } | null>(null);
    const handleBlankPointerDown = (event: React.PointerEvent) => {
        pressRef.current = event.button === 0 && event.isPrimary ? { x: event.clientX, y: event.clientY } : null;
    };
    const handleBlankClick = (event: React.MouseEvent) => {
        const start = pressRef.current;
        pressRef.current = null;
        if (!start || event.defaultPrevented || !(event.target instanceof Element) || event.target.closest(SHEET_NOT_BLANK_SELECTOR)) return;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP_PX) return;
        onCollapse();
    };

    // 每一条此刻该在哪、多高。
    const sheetHeight = viewHeight + SHEET_BLEED_Y * 2;
    const rowTops = useMemo(() => overviewRowTops(viewHeight, overviewBottomInset(sheetWidth, tilt)), [sheetWidth, tilt, viewHeight]);
    const sink = tiltSink(tilt);
    const bodyFromBottom = BODY_FROM_BOTTOM_FLAT - sink;
    const slimFromBottom = useMemo(() => SLIM_FROM_BOTTOM_FLAT.map(offset => offset - sink), [sink]);
    // 内容安全区（用户反馈：右下角的操作提示在有的窗口比例下被裁）：纸往右下转，越靠右越低，右边那一列（跳到栏、贴底的操作提示）
    // 与卡片区右下角会转出窗口底边。按这一刻的窗口算它们的底边低出去多少（纸上的 px），往上收这么多，再留 SAFE_MARGIN。
    const safe = useMemo(() => {
        const cos = Math.cos((tilt * Math.PI) / 180);
        const bodyBottom = sheetHeight - bodyFromBottom;
        const lift = (fromRight: number) => {
            const screenBottom = viewHeight / 2 + tiltDrop(sheetWidth / 2 - fromRight, tilt) + (bodyBottom - sheetHeight / 2) * cos;
            return Math.max(0, Math.ceil((screenBottom - (viewHeight - SAFE_MARGIN)) / cos));
        };
        return { side: lift(SIDE_RIGHT), cards: lift(CARDS_RIGHT) };
    }, [bodyFromBottom, sheetHeight, sheetWidth, tilt, viewHeight]);
    const modeOf = (id: ScratchpadTab): BandMode => (showsOverview ? 'row' : id === tab ? 'full' : 'slim');
    const frameOf = (id: ScratchpadTab): PaperFrame => {
        const across = { left: 0, width: sheetWidth };
        if (showsOverview) return { ...across, top: SHEET_BLEED_Y + rowTops[SCRATCHPAD_TABS.indexOf(id)], height: ROW_BAND_HEIGHT };
        if (id === tab) return { ...across, top: FULL_BAND_TOP, height: FULL_BAND_HEIGHT };
        return { ...across, top: sheetHeight - slimFromBottom[slimOrder.indexOf(id)], height: SLIM_HEIGHT };
    };
    const move: Transition = calm ? { duration: 0 } : { duration: 0.52, ease: PAPER_EASE };
    const faceOut: Transition = { duration: calm ? 0.08 : 0.14 };
    const motionOf = usePaperMotions<BandMode>('slim');
    const wrap = { calm, above: WRAP_ABOVE, below: sheetHeight + WRAP_BELOW, settle: SETTLE };
    // 展开的头一帧、收回的一路上：细纸带右端「展开整页 ›」不显示（面板里没有它），淡入淡出（scratchpad.css 的 .is-handoff）。
    const handoff = !calm && (entering || !isPresent);
    const layerIn: Transition = { duration: calm ? 0.12 : 0.3, delay: calm ? 0 : 0.2, ease: PAPER_EASE };

    const face = (id: ScratchpadTab, mode: FaceMode) => {
        if (mode === 'panel') {
            return <ScratchpadBand tab={id} index={indexOf(id)} title={t(TITLE_KEYS[id])} count={counts[id]} />;
        }
        if (mode === 'slim') {
            return (
                <ScratchpadSlim
                    tab={id}
                    index={indexOf(id)}
                    title={t(TITLE_KEYS[id])}
                    countLabel={t('scratchpad.count', { count: counts[id] })}
                    openLabel={t('scratchpad.expandPage')}
                    onOpen={onOpenPage}
                />
            );
        }
        const full = mode === 'full';
        return (
            <ScratchpadBand
                variant={mode}
                tab={id}
                index={indexOf(id)}
                title={t(TITLE_KEYS[id])}
                meta={t(META_KEYS[id])}
                count={counts[id]}
                width={sheetWidth}
                actionsRef={full ? slotRefs[id] : undefined}
                link={full
                    ? (onShowOverview ? { label: `‹ ${t('scratchpad.overview')}`, onClick: onShowOverview } : undefined)
                    : { label: `${t('scratchpad.expandPage')} ›`, onClick: () => onOpenPage(id) }}
            />
        );
    };

    return (
        <div
            ref={rootRef}
            className={`scratchpad-f${handoff ? ' is-handoff' : ''}`}
            tabIndex={-1}
            onPointerDown={handleBlankPointerDown}
            onClick={handleBlankClick}
            style={{
                '--scratchpad-safe-side': `${safe.side}px`,
                '--scratchpad-safe-cards': `${safe.cards}px`,
                '--scratchpad-body-bottom': `${bodyFromBottom}px`,
            } as React.CSSProperties}
        >
            {/* 墙上的纱：单独淡入淡出（不让整页一起淡，长出来的那条信息条从头到尾是不透明的）。收回时稍晚一点开始淡。 */}
            <motion.div
                className="scratchpad-f-scrim"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { duration: calm ? 0.12 : 0.3 } }}
                exit={{ opacity: 0, transition: { duration: calm ? 0.12 : 0.34, delay: calm ? 0 : 0.06 } }}
            />
            {/* 纸后面的大构图跟着这一页换，交叉淡入；收回时跟着纱一起淡掉（包一层，理由同下面卡片那一层）。 */}
            <motion.div className="scratchpad-f-content" exit={{ opacity: 0, transition: { duration: calm ? 0.08 : 0.2 } }}>
                <AnimatePresence initial={false}>
                    <motion.div
                        key={tab}
                        className="scratchpad-backdrop"
                        aria-hidden="true"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: calm ? 0.12 : 0.45 } }}
                        exit={{ opacity: 0, transition: { duration: calm ? 0.08 : 0.3 } }}
                    >
                        <Backdrop tab={tab} word={title} />
                    </motion.div>
                </AnimatePresence>
            </motion.div>
            {/* 纸：展开时从不转长到 tilt，收回时转回去（纸的四角比窗口大，转着也不露底）。 */}
            <motion.div
                className="scratchpad-f-sheet"
                initial={{ rotate: 0 }}
                animate={{ rotate: tilt }}
                exit={{ rotate: 0, transition: calm ? move : { duration: LEAVE_DURATION, ease: PAPER_EASE } }}
                transition={move}
            >
                {SCRATCHPAD_TABS.map(id => {
                    const mode = modeOf(id);
                    const frame = frameOf(id);
                    const bandMotion = motionOf(id, mode, frame, wrap);
                    // 展开时三条各自从面板里那一格长出来（这一页的从顶上那条，另外两条从底部那两格）；收回时缩回去，
                    // 总览里的三行也缩回各自那一格。
                    const origin = fromPanel(panelPaperFrame(id === tab ? 'band' : slimOrder.indexOf(id), sheetWidth - SHEET_BLEED_X * 2, viewHeight));
                    // 展开的头一帧、收回的一路上是面板里的样子：这一页是面板顶上那条，另外两条是细纸带（见文件头）。
                    const faceMode: FaceMode = handoff ? (id === tab ? 'panel' : 'slim') : mode;
                    const faceMotion: PaperMotion = calm
                        ? bandMotion
                        : !isPresent ? { ...bandMotion, ...LEAVE_FACE } : id === tab && !showsOverview ? { ...bandMotion, ...ENTER_FACE } : bandMotion;
                    return (
                        <motion.div
                            key={id}
                            className={`scratchpad-sheet-band is-${mode}`}
                            data-page={id}
                            initial={calm ? false : origin}
                            animate={bandMotion.animate}
                            exit={calm ? undefined : { ...origin, transition: { duration: LEAVE_DURATION, ease: PAPER_EASE } }}
                            transition={bandMotion.transition}
                        >
                            {/* 退场的那一面拿的是 AnimatePresence 的 custom（这一次的动法），不是它自己上一次的：绕一圈时它要留到出了视口才换。 */}
                            <AnimatePresence initial={false} custom={faceMotion}>
                                <motion.div
                                    key={faceMode}
                                    className="scratchpad-sheet-band-face"
                                    custom={faceMotion}
                                    variants={PAPER_FACE_VARIANTS}
                                    initial="hidden"
                                    animate="shown"
                                    exit="gone"
                                >
                                    {face(id, faceMode)}
                                </motion.div>
                            </AnimatePresence>
                        </motion.div>
                    );
                })}
                {/* 返回：压在顶上那条信息条的左端（整页里这一页的条、总览里第一行的条），竖着居中，跟着条挪；展开时等条长出来再出现。 */}
                <motion.button
                    ref={collapseRef}
                    type="button"
                    className="scratchpad-sheet-back"
                    title={collapseLabel}
                    aria-label={collapseLabel}
                    onClick={onCollapse}
                    style={{ left: BACK_LEFT, width: BACK_SIZE, height: BACK_SIZE }}
                    initial={{ opacity: 0, top: FULL_BAND_TOP + (FULL_BAND_HEIGHT - BACK_SIZE) / 2 }}
                    animate={{
                        opacity: 1,
                        top: showsOverview
                            ? SHEET_BLEED_Y + rowTops[0] + (ROW_BAND_HEIGHT - BACK_SIZE) / 2
                            : FULL_BAND_TOP + (FULL_BAND_HEIGHT - BACK_SIZE) / 2,
                        transition: { opacity: { duration: 0.2, delay: calm ? 0 : 0.3 }, top: move },
                    }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                >
                    <ChevronLeft aria-hidden="true" />
                </motion.button>
                {/* 条下面的东西（这一页的卡片，或总览里的三行卡）：先退后进，等条挪得差不多了再浮上来。 */}
                {/* 收回时卡片这一层一开始就淡掉：里面那层 AnimatePresence 不跟着整页退场（不传下去），不包这一层的话
                    纱都淡完了、面板都出来了，卡片还整片留在上面（用户看到的中间状态）。 */}
                <motion.div className="scratchpad-f-content" exit={{ opacity: 0, transition: { duration: calm ? 0.08 : 0.12 } }}>
                    <AnimatePresence mode="wait">
                        {overview ? (
                            <motion.div
                                key="overview"
                                className="scratchpad-f-layer"
                                initial={{ opacity: 0, y: calm ? 0 : 28 }}
                                animate={{ opacity: 1, y: 0, transition: layerIn }}
                                exit={{ opacity: 0, transition: faceOut }}
                            >
                                {overview(sheetWidth, viewHeight)}
                            </motion.div>
                        ) : (
                            <motion.div
                                key="page"
                                className="scratchpad-f-body"
                                initial={{ opacity: 0, y: calm ? 0 : 28 }}
                                animate={{ opacity: 1, y: 0, transition: layerIn }}
                                exit={{ opacity: 0, transition: faceOut }}
                            >
                                <BandSlotContext.Provider value={slots[tab] ?? null}>{children}</BandSlotContext.Provider>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </motion.div>
            </motion.div>
            {/* 右上角的黑色直角三角：字右对齐，顺着斜边一行比一行收进去（左下半是一块 shape-outside 的浮动）。展开时从上面落下来。 */}
            <motion.div
                className="scratchpad-triangle"
                initial={calm ? { opacity: 0 } : { opacity: 0, y: -80 }}
                animate={{ opacity: 1, y: 0 }}
                exit={calm ? { opacity: 0 } : { opacity: 0, y: -80 }}
                transition={move}
            >
                <span className="scratchpad-triangle-float" aria-hidden="true" />
                {/* 宽的写长版；窄屏（手机）三角收小，换成短版、不写面包屑（scratchpad.css，用户定 2026-11-07）。 */}
                <ScratchpadGreeting long headline className="is-wide" />
                <ScratchpadGreeting long={false} headline className="is-narrow" />
                <span className="scratchpad-intro-rule" aria-hidden="true" />
                <span className="scratchpad-triangle-row">
                    <span className="scratchpad-triangle-crumb">
                        {overview ? t('scratchpad.crumbOverview', { title: t('scratchpad.title') }) : t('scratchpad.crumb', { page: title })}
                    </span>
                    {overview && (
                        <button
                            type="button"
                            className="scratchpad-pill is-icon is-small scratchpad-triangle-help"
                            title={t('scratchpad.overviewHelpLabel')}
                            aria-label={t('scratchpad.overviewHelpLabel')}
                            aria-expanded={helpOpen}
                            aria-controls="scratchpad-overview-help"
                            onClick={() => setHelpOpen(open => !open)}
                        >
                            ?
                        </button>
                    )}
                </span>
            </motion.div>
            {overview && helpOpen && (
                <motion.p
                    id="scratchpad-overview-help"
                    className="scratchpad-overview-help"
                    role="note"
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                >
                    {t('scratchpad.overviewHelp', { mod: PRIMARY_MODIFIER_LABEL })}
                </motion.p>
            )}
        </div>
    );
};

export default ScratchpadSheet;
