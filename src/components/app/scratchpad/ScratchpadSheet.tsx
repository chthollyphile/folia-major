import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft } from 'lucide-react';
import type { ScratchpadTab } from '../../../stores/useScratchpadStore';
import ScratchpadBand, { ScratchpadSlim } from './ScratchpadBand';
import ScratchpadGreeting from './ScratchpadGreeting';
import ScratchpadShape from './ScratchpadShape';
import { useScratchpadHistory } from './useScratchpadHistory';
import { SCRATCHPAD_TABS, SCRATCHPAD_TAB_SHAPES } from './scratchpadLook';
import { PRIMARY_MODIFIER_LABEL } from '../../../utils/platform';

// src/components/app/scratchpad/ScratchpadSheet.tsx
// 展开整页（设计稿 F 定稿）：整张纸向右下转 6°（降低动态效果时不转，同歌手页），这一页的米白信息条横贯整张纸，
// 下面是这一页的卡片（宿主交进来的 children：画布、跳到栏与操作提示），另外两页收成两条细纸带压在左下角
// （右边转出屏幕、被播放胶囊挡住），点它换过去。右上角一块黑色直角三角（不转）：放大的问候、收回侧栏、面包屑。
// 纸后面是这一页几何体的低可见度大构图（照搜索页的至上主义构图：大空心形、淡色块、实心小形、发丝线、斜线小方块、竖排大字）。
// 信息条右端的按钮由各页自己画进来（ScratchpadBandActions，经 portal 放进条上的空位）。
// 信息条上「‹ 三行总览」换成三行总览（ScratchpadOverview，宿主经 overview 交进来）：三条信息条各带一行头几张卡。

/** 信息条右端的空位：各页把自己的按钮画进去。 */
const BandSlotContext = createContext<HTMLElement | null>(null);

/** 把这一页的按钮画到展开整页信息条的右端（不在展开整页时什么都不画）。 */
export const ScratchpadBandActions: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const slot = useContext(BandSlotContext);
    return slot ? createPortal(children, slot) : null;
};

/** 纸比窗口每边多出来的（转过之后四角不露底）：左右 160px、上下 130px。 */
const SHEET_BLEED_X = 160;

const TITLE_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.title', history: 'scratchpad.history', queue: 'scratchpad.queue' };
const META_KEYS: Record<ScratchpadTab, string> = { notes: 'scratchpad.hint', history: 'scratchpad.historyHint', queue: 'scratchpad.queueHint' };

type ScratchpadSheetProps = {
    tab: ScratchpadTab;
    notesCount: number;
    queueCount: number;
    /** 纸转几度（降低动态效果时 0）。 */
    tilt: number;
    onSelectTab: (tab: ScratchpadTab) => void;
    /** 收回左缘的面板。 */
    onCollapse: () => void;
    collapseLabel: string;
    collapseRef?: React.Ref<HTMLButtonElement>;
    /** 三行总览：给了就画它（参数是纸的宽度），不画这一页。 */
    overview?: ((sheetWidth: number, viewHeight: number) => React.ReactNode) | null;
    /** 展开整页的信息条上「‹ 三行总览」。 */
    onShowOverview?: () => void;
    children: React.ReactNode;
};

/** 纸后面的大构图：这一页的几何体放大、几乎看不见（只在展开整页时画，不转）。 */
const Backdrop: React.FC<{ tab: ScratchpadTab; word: string }> = ({ tab, word }) => {
    const kind = SCRATCHPAD_TAB_SHAPES[tab];
    const turn = (deg: number): React.CSSProperties => (kind === 'circle' ? {} : { transform: `rotate(${deg}deg)` });
    return (
        <div className="scratchpad-backdrop" aria-hidden="true">
            <span className="scratchpad-backdrop-wedge" />
            <ScratchpadShape kind={kind} size={680} fill="none" stroke="currentColor" strokeWidth={1.5} className="scratchpad-backdrop-shape is-big" style={turn(-8)} />
            <ScratchpadShape kind={kind} size={250} fill="none" stroke="currentColor" strokeWidth={1.5} className="scratchpad-backdrop-shape is-mid" style={turn(14)} />
            <ScratchpadShape kind={kind} size={320} fill="var(--scratchpad-mark-wall)" className="scratchpad-backdrop-shape is-tint" style={turn(12)} />
            <ScratchpadShape kind={kind} size={46} fill="currentColor" className="scratchpad-backdrop-shape is-small" style={turn(-18)} />
            <span className="scratchpad-backdrop-hair is-upper" />
            <span className="scratchpad-backdrop-hair is-lower" />
            <span className="scratchpad-backdrop-hatch" />
            <span className="scratchpad-backdrop-word">{word}</span>
        </div>
    );
};

const ScratchpadSheet: React.FC<ScratchpadSheetProps> = ({
    tab, notesCount, queueCount, tilt, onSelectTab, onCollapse, collapseLabel, collapseRef, overview, onShowOverview, children,
}) => {
    const { t } = useTranslation();
    const historyCount = useScratchpadHistory().length;
    const counts: Record<ScratchpadTab, number> = { notes: notesCount, history: historyCount, queue: queueCount };
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    // 信息条的装饰按纸的宽度撒（窗口宽 + 两边多出来的）。
    const [sheetWidth, setSheetWidth] = useState(() => (typeof window === 'undefined' ? 1760 : window.innerWidth + SHEET_BLEED_X * 2));
    // 三行总览按窗口高度排行（矮的窗口里挤一挤，第三行不出窗口）。
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
        }, 400);
        return () => window.clearTimeout(timer);
    }, [showsOverview, tab]);
    const others = useMemo(() => SCRATCHPAD_TABS.filter(id => id !== tab), [tab]);
    const title = t(TITLE_KEYS[tab]);

    return (
        <div ref={rootRef} className={`scratchpad-f${tilt === 0 ? ' is-flat' : ''}`} tabIndex={-1} style={{ '--scratchpad-tilt': `${tilt}deg` } as React.CSSProperties}>
            <Backdrop tab={tab} word={title} />
            {overview ? (
                <div className="scratchpad-f-sheet">{overview(sheetWidth, viewHeight)}</div>
            ) : (
                <div className="scratchpad-f-sheet">
                    <div className="scratchpad-f-band">
                        <ScratchpadBand
                            variant="full"
                            tab={tab}
                            index={indexOf(tab)}
                            title={title}
                            meta={t(META_KEYS[tab])}
                            count={counts[tab]}
                            width={sheetWidth}
                            actionsRef={setSlot}
                            link={onShowOverview ? { label: `‹ ${t('scratchpad.overview')}`, onClick: onShowOverview } : undefined}
                        />
                    </div>
                    <div className="scratchpad-f-body">
                        <BandSlotContext.Provider value={slot}>{children}</BandSlotContext.Provider>
                    </div>
                    {others.map((id, order) => (
                        <div key={id} className={`scratchpad-f-slim is-${order === 0 ? 'upper' : 'lower'}`}>
                            <ScratchpadSlim
                                tab={id}
                                index={indexOf(id)}
                                title={t(TITLE_KEYS[id])}
                                countLabel={t('scratchpad.count', { count: counts[id] })}
                                openLabel={t('scratchpad.expandPage')}
                                onOpen={onSelectTab}
                            />
                        </div>
                    ))}
                </div>
            )}
            {/* 右上角的黑色直角三角：字右对齐，顺着斜边一行比一行收进去（左下半是一块 shape-outside 的浮动）。 */}
            <div className="scratchpad-triangle">
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
            </div>
            {overview && helpOpen && (
                <p id="scratchpad-overview-help" className="scratchpad-overview-help" role="note">
                    {t('scratchpad.overviewHelp', { mod: PRIMARY_MODIFIER_LABEL })}
                </p>
            )}
        </div>
    );
};

export default ScratchpadSheet;
