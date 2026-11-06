import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, type Transition } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';
import ScratchpadBand, { ScratchpadSlim } from './ScratchpadBand';
import ScratchpadGreeting from './ScratchpadGreeting';
import ScratchpadShape from './ScratchpadShape';
import { useScratchpadHistory } from './useScratchpadHistory';
import { SCRATCHPAD_TABS, SCRATCHPAD_TAB_SHAPES } from './scratchpadLook';
import { overviewRowTops } from './canvasLayout';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';

// src/components/app/scratchpad/ScratchpadSheet.tsx
// 展开整页（设计稿 F 定稿）：整张纸向右下转 6°（降低动态效果时不转，同歌手页），这一页的米白信息条横贯整张纸，
// 下面是这一页的卡片（宿主交进来的 children：画布、跳到栏与操作提示），另外两页收成两条细纸带压在左下角
// （右边转出屏幕、被播放胶囊挡住），点它换过去。右上角一块黑色直角三角（不转）：放大的问候、收回侧栏、面包屑。
// 纸后面是这一页几何体的低可见度大构图（照搜索页的至上主义构图：大空心形、淡色块、实心小形、发丝线、斜线小方块、竖排大字）。
// 信息条右端的按钮由各页自己画进来（ScratchpadBandActions，经 portal 放进条上的空位）。
// 信息条上「‹ 三行总览」换成三行总览（ScratchpadOverview，宿主经 overview 交进来）：三条信息条各带一行头几张卡。
//
// 三条信息条一直都在、各自一层（用户要的「整个信息条移动展开」）：总览里是三行 72px 的条，整页里这一页是顶上 120px 的条、
// 另外两条是左下角 36px 的细纸带。换页、进出总览时每一条从现在的位置挪到新位置、长高或变矮，条里的内容交叉淡入。
// 所有的条都朝上走（用户定，2026-11-06）：要去左下角当细纸带的条（从顶上那条、从总览的一行）先从上方离开视口，
// 再从窗口下面升回到底部（WRAP_*，它在视口外的那一下换高度、换样子）；往上去的条直接挪；两条细纸带之间对调直接挪。
// 展开时这一页的条从左缘面板顶上那条的位置长出来（纸同时转到 6°），收回时缩回去。降低动态效果时不挪，只淡入淡出。

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

/** 一条信息条在纸上的框（纸上坐标，px）。 */
type BandFrame = { top: number; left: number; width: number; height: number };
/** 一条信息条此刻的样子：整页顶上那条、总览里的一行、左下角的细纸带。 */
type BandMode = 'full' | 'row' | 'slim';

/** 左缘面板顶上那条信息条在纸上的位置（纸还没转时，面板 64px 的页签列右边、离窗口顶 40px，340 × 64）。 */
const PANEL_BAND_FRAME: BandFrame = { top: SHEET_BLEED_Y + 40, left: SHEET_BLEED_X + 64, width: 340, height: 64 };
/** 整页那条信息条：离纸顶 230px（转过之后左端离窗口顶约 25px），120px 高。 */
const FULL_BAND_TOP = 230;
const FULL_BAND_HEIGHT = 120;
const ROW_BAND_HEIGHT = 72;
const SLIM_HEIGHT = 36;
/** 细纸带离纸底边多远：倾斜时左半边会被纸抬起来，所以压得低一些；不倾斜时整条挪进窗口（窗口底边在纸上 100% − 130px）。 */
const SLIM_FROM_BOTTOM = { tilted: [160, 118], flat: [214, 172] } as const;
/** 挪动、长高的曲线（与抽屉滑出同一条）。 */
const MOVE_EASE = [0.22, 1, 0.36, 1] as const;
/**
 * 绕一圈去底部：一共多久，离开视口用掉的那一段占多少（之后在视口外一下子跳到窗口下面，再升上来）；
 * 离开时在纸上要到多高、从多低回来（纸的上下各比窗口多 130px，再留出转 6° 时右端压低、左端抬高的那一截）。
 */
const WRAP_DURATION = 0.82;
const WRAP_LEAVE = 0.4;
const WRAP_ABOVE = -60;
const WRAP_BELOW = 60;

/** 信息条里那一面的淡入淡出，时机按这一次的动法（custom）。 */
const FACE_VARIANTS = {
    hidden: { opacity: 0 },
    shown: (motion: BandMotion) => ({ opacity: 1, transition: motion.faceIn }),
    gone: (motion: BandMotion) => ({ opacity: 0, transition: motion.faceOut }),
};

/** 一条信息条这一次怎么动：直接挪到新的框，或绕一圈（先往上出去、再从下面上来）；里面的样子什么时候换。 */
type BandMotion = {
    key: string;
    animate: Record<string, number | number[]>;
    transition: Transition;
    faceIn: Transition;
    faceOut: Transition;
};

type ScratchpadSheetProps = {
    tab: ScratchpadTab;
    notesCount: number;
    queueCount: number;
    /** 纸转几度（降低动态效果时 0）。 */
    tilt: number;
    /** 降低动态效果：信息条不挪，只淡入淡出。 */
    calm: boolean;
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
    tab, notesCount, queueCount, tilt, calm, onOpenPage, onCollapse, collapseLabel, collapseRef, overview, onShowOverview, children,
}) => {
    const { t } = useTranslation();
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
    const others = useMemo(() => SCRATCHPAD_TABS.filter(id => id !== tab), [tab]);
    const title = t(TITLE_KEYS[tab]);

    // 每一条此刻该在哪、多高。
    const sheetHeight = viewHeight + SHEET_BLEED_Y * 2;
    const rowTops = useMemo(() => overviewRowTops(viewHeight), [viewHeight]);
    const slimFromBottom = tilt === 0 ? SLIM_FROM_BOTTOM.flat : SLIM_FROM_BOTTOM.tilted;
    const modeOf = (id: ScratchpadTab): BandMode => (showsOverview ? 'row' : id === tab ? 'full' : 'slim');
    const frameOf = (id: ScratchpadTab): BandFrame => {
        const across = { left: 0, width: sheetWidth };
        if (showsOverview) return { ...across, top: SHEET_BLEED_Y + rowTops[SCRATCHPAD_TABS.indexOf(id)], height: ROW_BAND_HEIGHT };
        if (id === tab) return { ...across, top: FULL_BAND_TOP, height: FULL_BAND_HEIGHT };
        return { ...across, top: sheetHeight - slimFromBottom[others.indexOf(id)], height: SLIM_HEIGHT };
    };
    const move: Transition = calm ? { duration: 0 } : { duration: 0.52, ease: MOVE_EASE };
    const faceIn: Transition = { duration: calm ? 0.12 : 0.22, delay: calm ? 0 : 0.14 };
    const faceOut: Transition = { duration: calm ? 0.08 : 0.14 };

    // 每一条这一次怎么动。框或样子变了才重算，之后（动画途中别的状态变了、重渲染）原样复用同一个对象：
    // 换一个 animate 对象 framer 就会从半路直接改道去终点，绕一圈的那一下会被截断。
    const motionsRef = useRef<Partial<Record<ScratchpadTab, BandMotion & { mode: BandMode; frame: BandFrame }>>>({});
    const motionOf = (id: ScratchpadTab, mode: BandMode, frame: BandFrame): BandMotion => {
        const key = `${mode}|${frame.top}|${frame.left}|${frame.width}|${frame.height}|${calm ? 1 : 0}`;
        const previous = motionsRef.current[id];
        if (previous?.key === key) return previous;
        const toBottom = !calm && previous !== undefined && previous.mode !== 'slim' && mode === 'slim';
        const next: BandMotion = toBottom
            ? {
                key,
                // null：从此刻的位置（可能还在半路）起；离开视口、在视口外跳到窗口下面、升到细纸带的位置。
                // 高度在视口外的那一下换；宽、左边总览与整页一样（横贯整张纸），也在那一下对齐。
                animate: {
                    top: [null as unknown as number, WRAP_ABOVE - previous.frame.height, sheetHeight + WRAP_BELOW, frame.top],
                    height: [previous.frame.height, previous.frame.height, frame.height, frame.height],
                    left: [previous.frame.left, previous.frame.left, frame.left, frame.left],
                    width: [previous.frame.width, previous.frame.width, frame.width, frame.width],
                },
                transition: {
                    duration: WRAP_DURATION,
                    times: [0, WRAP_LEAVE, WRAP_LEAVE + 0.0005, 1],
                    ease: ['easeIn', 'linear', 'easeOut'],
                },
                // 样子在视口外换：离开途中仍是原来的样子，回来时已经是细纸带。
                faceIn: { duration: 0.01, delay: WRAP_DURATION * WRAP_LEAVE },
                faceOut: { duration: 0.01, delay: WRAP_DURATION * WRAP_LEAVE },
            }
            : { key, animate: { ...frame }, transition: move, faceIn, faceOut };
        motionsRef.current[id] = { ...next, mode, frame };
        return next;
    };
    const layerIn: Transition = { duration: calm ? 0.12 : 0.3, delay: calm ? 0 : 0.2, ease: MOVE_EASE };

    const face = (id: ScratchpadTab, mode: BandMode) => {
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
        <div ref={rootRef} className={`scratchpad-f${tilt === 0 ? ' is-flat' : ''}`} tabIndex={-1}>
            {/* 纸后面的大构图跟着这一页换，交叉淡入。 */}
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
            {/* 纸：展开时从不转长到 tilt，收回时转回去（纸的四角比窗口大，转着也不露底）。 */}
            <motion.div
                className="scratchpad-f-sheet"
                initial={{ rotate: 0 }}
                animate={{ rotate: tilt }}
                exit={{ rotate: 0 }}
                transition={move}
            >
                {SCRATCHPAD_TABS.map(id => {
                    const mode = modeOf(id);
                    const frame = frameOf(id);
                    const bandMotion = motionOf(id, mode, frame);
                    // 展开时这一页的条从面板顶上那条长出来，另外两条从纸下面滑上来；收回时反过来。
                    const away: BandFrame = { ...frame, top: sheetHeight };
                    const origin = id === tab && !showsOverview ? PANEL_BAND_FRAME : away;
                    return (
                        <motion.div
                            key={id}
                            className={`scratchpad-sheet-band is-${mode}`}
                            data-page={id}
                            initial={calm ? false : origin}
                            animate={bandMotion.animate}
                            exit={calm ? undefined : { ...origin, transition: move }}
                            transition={bandMotion.transition}
                        >
                            {/* 退场的那一面拿的是 AnimatePresence 的 custom（这一次的动法），不是它自己上一次的：绕一圈时它要留到出了视口才换。 */}
                            <AnimatePresence initial={false} custom={bandMotion}>
                                <motion.div
                                    key={mode}
                                    className="scratchpad-sheet-band-face"
                                    custom={bandMotion}
                                    variants={FACE_VARIANTS}
                                    initial="hidden"
                                    animate="shown"
                                    exit="gone"
                                >
                                    {face(id, mode)}
                                </motion.div>
                            </AnimatePresence>
                        </motion.div>
                    );
                })}
                {/* 条下面的东西（这一页的卡片，或总览里的三行卡）：先退后进，等条挪得差不多了再浮上来。 */}
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
            {/* 右上角的黑色直角三角：字右对齐，顺着斜边一行比一行收进去（左下半是一块 shape-outside 的浮动）。展开时从上面落下来。 */}
            <motion.div
                className="scratchpad-triangle"
                initial={calm ? { opacity: 0 } : { opacity: 0, y: -80 }}
                animate={{ opacity: 1, y: 0 }}
                exit={calm ? { opacity: 0 } : { opacity: 0, y: -80 }}
                transition={move}
            >
                <span className="scratchpad-triangle-float" aria-hidden="true" />
                <ScratchpadGreeting long headline />
                <span className="scratchpad-intro-rule" aria-hidden="true" />
                <span className="scratchpad-triangle-row">
                    <button ref={collapseRef} type="button" className="scratchpad-pill is-icon is-small" title={collapseLabel} aria-label={collapseLabel} onClick={onCollapse}>
                        <ChevronLeft aria-hidden="true" />
                    </button>
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
                <p id="scratchpad-overview-help" className="scratchpad-overview-help" role="note">
                    {t('scratchpad.overviewHelp', { mod: PRIMARY_MODIFIER_LABEL })}
                </p>
            )}
        </div>
    );
};

export default ScratchpadSheet;
